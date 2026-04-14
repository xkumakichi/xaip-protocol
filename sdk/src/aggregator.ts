/**
 * XAIP Aggregator — Federation module for distributed trust queries (v0.4.0)
 *
 * v0.4.0 changes:
 *   - BFT quorum: MAD outlier detection removes Byzantine nodes before consensus
 *   - Node reputation: nodes repeatedly diverging are penalized and eventually excluded
 *   - quorumSize in QueryResult.meta (number of nodes that reached consensus)
 *   - quorum_degraded risk flag when quorumSize < 3
 *   - outlierNodes in AggregatorQueryResponse (URLs of excluded nodes)
 *
 * Provides two components:
 *   - AggregatorClient: push receipts to, and query scores from, multiple nodes
 *   - createAggregatorServer: lightweight Node.js http server (no Express)
 *
 * Server endpoints:
 *   POST /receipts  — accept signed receipts from remote agents
 *   GET  /query     — return trust score for a given DID (+ optional capability)
 *   GET  /health    — liveness check
 */

import * as http from "http";
import {
  ExecutionReceipt,
  AggregatorPushPayload,
  AggregatorQueryResponse,
  QueryResult,
} from "./types";
import { verify, sign, receiptPayload, parseDID } from "./identity";
import { ReceiptStore } from "./store";
import { computeQueryResult } from "./score";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function jsonResponse(
  res: http.ServerResponse,
  status: number,
  body: unknown
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function parseQuery(url: string): Record<string, string> {
  const idx = url.indexOf("?");
  if (idx === -1) return {};
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(url.slice(idx + 1)).entries()) {
    params[k] = v;
  }
  return params;
}

/** Median of a numeric array. Returns 0 for empty arrays. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// ─── AggregatorClient ────────────────────────────────────────────────────────

/** Entry tracking a node's URL alongside its response. */
interface NodeResponse {
  url: string;
  response: AggregatorQueryResponse;
}

/**
 * HTTP client for pushing receipts to, and querying scores from,
 * one or more remote XAIP aggregator nodes.
 *
 * Push: fire-and-forget to all nodes.
 * Query: BFT quorum — MAD outlier detection removes Byzantine nodes,
 *        node reputation degrades on repeated divergence.
 */
export class AggregatorClient {
  private urls: string[];
  private nodeReputation: Map<string, number> = new Map();

  constructor(urls: string | string[]) {
    const list = Array.isArray(urls) ? urls : [urls];
    if (list.length < 3) {
      console.warn(
        `[AggregatorClient] WARNING: ${list.length} aggregator(s) configured. ` +
        `Minimum 3 recommended for Byzantine fault tolerance.`
      );
    }
    this.urls = list.map((u) => u.replace(/\/$/, ""));
  }

  /** Get node reputation score (0–1). Defaults to 1.0 for new nodes. */
  nodeScore(url: string): number {
    return this.nodeReputation.get(url) ?? 1.0;
  }

  private penalizeNode(url: string): void {
    const next = +(this.nodeScore(url) * 0.9).toFixed(4);
    this.nodeReputation.set(url, Math.max(0, next));
  }

  private rewardNode(url: string): void {
    const next = +(this.nodeScore(url) * 1.01).toFixed(4);
    this.nodeReputation.set(url, Math.min(1.0, next));
  }

  /** Push a signed receipt to all aggregator nodes (bypasses reputation filter). */
  async pushReceipt(
    receipt: ExecutionReceipt,
    publicKey: string
  ): Promise<void> {
    const payload: AggregatorPushPayload = { receipt, publicKey };
    const body = JSON.stringify(payload);

    await Promise.allSettled(
      this.urls.map(async (baseUrl) => {
        const res = await fetch(`${baseUrl}/receipts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) {
          throw new Error(`${baseUrl} responded ${res.status}`);
        }
      })
    );
  }

  /**
   * Query all nodes for a trust score; return a BFT quorum result.
   *
   * Strategy:
   *   1. Filter nodes below reputation threshold (< 0.5).
   *   2. Query all active nodes in parallel; verify signatures.
   *   3. For 3+ successes: use MAD outlier detection to remove Byzantine nodes.
   *      outlierThreshold = max(3 × MAD, 0.1)
   *   4. For 2 successes: fall back to absolute divergence (> 0.1 = outlier).
   *   5. Build result from quorum median; update node reputations.
   *   6. Add "quorum_degraded" flag if quorumSize < 3.
   */
  async query(
    agentDid: string,
    capability?: string
  ): Promise<AggregatorQueryResponse> {
    const params = new URLSearchParams({ did: agentDid });
    if (capability) params.set("capability", capability);
    const qs = params.toString();

    // Exclude nodes with reputation below threshold
    const activeUrls = this.urls.filter((url) => this.nodeScore(url) >= 0.5);
    if (activeUrls.length === 0) {
      throw new Error("All aggregator nodes excluded by reputation filter");
    }

    const settled = await Promise.allSettled(
      activeUrls.map(async (baseUrl) => {
        const res = await fetch(`${baseUrl}/query?${qs}`, {
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) throw new Error(`${baseUrl} responded ${res.status}`);
        const body = (await res.json()) as AggregatorQueryResponse;

        // Verify response signature when present
        if (body.signature && body.publicKey) {
          const payload = JSON.stringify(body.result);
          if (!verify(payload, body.signature, body.publicKey)) {
            throw new Error(`${baseUrl} returned invalid signature`);
          }
        }

        return { url: baseUrl, response: body } as NodeResponse;
      })
    );

    const successes = settled
      .filter((r): r is PromiseFulfilledResult<NodeResponse> => r.status === "fulfilled")
      .map((r) => r.value);

    if (successes.length === 0) {
      throw new Error("All aggregator nodes failed");
    }

    // Single node — return directly with quorum metadata
    if (successes.length === 1) {
      return this.buildResult(successes, [], this.urls.length);
    }

    // Two nodes — MAD is unreliable; use absolute divergence threshold
    if (successes.length === 2) {
      const [s0, s1] = successes;
      const diff = Math.abs(s0.response.result.trust - s1.response.result.trust);

      if (diff > 0.1) {
        // Pick from higher-reputation node; penalize the other
        const [winner, loser] =
          this.nodeScore(s0.url) >= this.nodeScore(s1.url)
            ? [s0, s1]
            : [s1, s0];
        this.rewardNode(winner.url);
        this.penalizeNode(loser.url);
        return this.buildResult([winner], [loser.url], this.urls.length);
      }

      // Both agree — reward both
      this.rewardNode(s0.url);
      this.rewardNode(s1.url);
      return this.buildResult(successes, [], this.urls.length);
    }

    // 3+ nodes — MAD outlier detection
    const trustValues = successes.map((s) => s.response.result.trust);
    const med = median(trustValues);
    const deviations = trustValues.map((v) => Math.abs(v - med));
    const mad = median(deviations);
    // Minimum threshold 0.1 handles the case where MAD≈0 (tight cluster + clear outlier)
    const outlierThreshold = Math.max(3 * mad, 0.1);

    const quorumNodes: NodeResponse[] = [];
    const outlierUrls: string[] = [];

    for (const s of successes) {
      if (Math.abs(s.response.result.trust - med) <= outlierThreshold) {
        quorumNodes.push(s);
        this.rewardNode(s.url);
      } else {
        outlierUrls.push(s.url);
        this.penalizeNode(s.url);
      }
    }

    // Fallback: if MAD removed all (theoretical edge case), use full set
    const finalNodes = quorumNodes.length > 0 ? quorumNodes : successes;

    return this.buildResult(finalNodes, outlierUrls, this.urls.length);
  }

  /**
   * Build the final AggregatorQueryResponse from a quorum of nodes.
   * Picks the node closest to the quorum median; patches meta + riskFlags.
   */
  private buildResult(
    quorumNodes: NodeResponse[],
    outlierUrls: string[],
    totalUrls: number
  ): AggregatorQueryResponse {
    const quorumSize = quorumNodes.length;

    // Pick quorum member closest to quorum median
    const qTrusts = quorumNodes.map((s) => s.response.result.trust);
    const qMed = median(qTrusts);

    let best = quorumNodes[0];
    let bestDist = Math.abs(best.response.result.trust - qMed);
    for (let i = 1; i < quorumNodes.length; i++) {
      const dist = Math.abs(quorumNodes[i].response.result.trust - qMed);
      if (dist < bestDist) {
        best = quorumNodes[i];
        bestDist = dist;
      }
    }

    // Deduplicate risk flags; add quorum_degraded if needed
    const flags = new Set(best.response.result.riskFlags);
    if (quorumSize < 3) flags.add("quorum_degraded");

    const result: QueryResult = {
      ...best.response.result,
      riskFlags: [...flags],
      meta: {
        ...best.response.result.meta,
        quorumSize,
        sources: quorumSize,
      },
    };

    return {
      ...best.response,
      result,
      source: `quorum(${quorumSize}/${totalUrls})`,
      ...(outlierUrls.length > 0 ? { outlierNodes: outlierUrls } : {}),
    };
  }
}

// ─── createAggregatorServer ───────────────────────────────────────────────────

export interface AggregatorServerOptions {
  /** Port to listen on. Default: 4000 */
  port?: number;
  /** Hostname. Default: "0.0.0.0" */
  host?: string;
  /** ReceiptStore instance. A new in-memory store is created if omitted. */
  store?: ReceiptStore;
  /** Identifier returned in /health and query responses. Default: hostname */
  nodeId?: string;
  /** Ed25519 keypair for signing query responses (proves aggregator identity). */
  signingKey?: { publicKey: string; privateKey: string };
}

/**
 * Create and start a lightweight XAIP aggregator HTTP server.
 *
 * Endpoints:
 *   POST /receipts  — Accept + verify + store a receipt from a remote agent.
 *   GET  /query     — Return trust score for ?did=xxx[&capability=yyy].
 *   GET  /health    — Liveness probe.
 *
 * Returns the http.Server instance (already listening).
 */
export function createAggregatorServer(
  opts: AggregatorServerOptions = {}
): http.Server {
  const port = opts.port ?? 4000;
  const host = opts.host ?? "0.0.0.0";
  const store = opts.store ?? new ReceiptStore();
  const nodeId =
    opts.nodeId ?? `xaip-aggregator@${require("os").hostname()}`;

  const server = http.createServer(
    async (req: http.IncomingMessage, res: http.ServerResponse) => {
      const method = req.method ?? "GET";
      const rawUrl = req.url ?? "/";
      const path = rawUrl.split("?")[0];

      try {
        // ── GET /health ──────────────────────────────────────────────────────
        if (method === "GET" && path === "/health") {
          return jsonResponse(res, 200, {
            status: "ok",
            node: nodeId,
            timestamp: new Date().toISOString(),
          });
        }

        // ── POST /receipts ───────────────────────────────────────────────────
        if (method === "POST" && path === "/receipts") {
          let parsed: AggregatorPushPayload;
          try {
            const raw = await readBody(req);
            parsed = JSON.parse(raw) as AggregatorPushPayload;
          } catch {
            return jsonResponse(res, 400, { error: "Invalid JSON body" });
          }

          const { receipt, publicKey } = parsed;

          // Basic shape validation
          if (!receipt || !publicKey) {
            return jsonResponse(res, 400, {
              error: "Missing required fields: receipt, publicKey",
            });
          }
          if (
            !receipt.agentDid ||
            !receipt.toolName ||
            !receipt.taskHash ||
            !receipt.timestamp ||
            !receipt.signature
          ) {
            return jsonResponse(res, 422, {
              error: "Incomplete receipt: missing required fields",
            });
          }

          // Signature verification — reject before touching the DB
          let canonical: string;
          try {
            canonical = receiptPayload(receipt);
          } catch (e) {
            return jsonResponse(res, 422, {
              error: `Failed to canonicalize receipt: ${(e as Error).message}`,
            });
          }

          const sigValid = verify(canonical, receipt.signature, publicKey);
          if (!sigValid) {
            return jsonResponse(res, 403, {
              error: "Signature verification failed",
            });
          }

          // Persist
          try {
            await store.log(receipt);
          } catch (e) {
            // Rate limit or other store error
            return jsonResponse(res, 429, { error: (e as Error).message });
          }

          return jsonResponse(res, 201, { ok: true });
        }

        // ── GET /query ───────────────────────────────────────────────────────
        if (method === "GET" && path === "/query") {
          const params = parseQuery(rawUrl);
          const agentDid = params["did"];
          const capability = params["capability"];

          if (!agentDid) {
            return jsonResponse(res, 400, {
              error: "Missing required query param: did",
            });
          }

          // Parse DID — fail fast if malformed
          let did;
          try {
            did = parseDID(agentDid);
          } catch (e) {
            return jsonResponse(res, 400, {
              error: `Invalid DID: ${(e as Error).message}`,
            });
          }

          // Fetch receipts
          const receipts = await store.getReceipts(agentDid, capability);

          // Compute trust score
          const result = computeQueryResult(receipts, did, capability);

          const response: AggregatorQueryResponse = {
            result,
            source: nodeId,
            timestamp: new Date().toISOString(),
          };

          // Sign response if signing key is configured
          if (opts.signingKey) {
            const payload = JSON.stringify(result);
            response.signature = sign(payload, opts.signingKey.privateKey);
            response.publicKey = opts.signingKey.publicKey;
          }

          return jsonResponse(res, 200, response);
        }

        // ── 404 ──────────────────────────────────────────────────────────────
        return jsonResponse(res, 404, { error: "Not found" });
      } catch (err) {
        // Unexpected server error
        console.error("[AggregatorServer] Unhandled error:", err);
        return jsonResponse(res, 500, {
          error: "Internal server error",
        });
      }
    }
  );

  server.listen(port, host, () => {
    console.log(`[AggregatorServer] Listening on http://${host}:${port}  node=${nodeId}`);
  });

  return server;
}
