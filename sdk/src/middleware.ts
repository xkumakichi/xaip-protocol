/**
 * XAIP Middleware — MCP server integration (v0.3.1)
 *
 * v0.3.1 changes:
 *   - SigningDelegate replaces callerPrivateKey (key never leaves caller)
 *   - Multi-aggregator: push to all, query quorum
 *   - Bayesian trust model (no magic constants)
 *   - Protocol version XAIP/0.3.1
 *
 * Usage:
 *   import { withXAIP } from "xaip-sdk";
 *   withXAIP(server, { did: "did:web:myagent.com" });
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { XAIPConfig, XAIPContext, ExecutionReceipt, FailureType, XAIP_PROTOCOL_ID } from "./types";
import { parseDID, generateDIDKey, receiptPayload, sign, hash } from "./identity";
import { ReceiptStore } from "./store";
import { computeQueryResult } from "./score";

const TIMEOUT_THRESHOLD_MS = 30_000;

/** Classify a failure from error + latency. */
function classifyFailure(error: any, latencyMs: number): FailureType {
  const msg = (error?.message || String(error)).toLowerCase();
  if (
    latencyMs >= TIMEOUT_THRESHOLD_MS ||
    msg.includes("timeout") ||
    msg.includes("etimedout")
  ) {
    return "timeout";
  }
  if (
    msg.includes("valid") ||
    msg.includes("schema") ||
    msg.includes("parse")
  ) {
    return "validation";
  }
  return "error";
}

interface ReceiptParams {
  did: string;
  toolName: string;
  taskHash: string;
  resultHash: string;
  success: boolean;
  latencyMs: number;
  failureType?: FailureType;
  privateKey: string;
  config?: XAIPConfig;
  store: ReceiptStore;
  publicKey: string;
  log: (msg: string) => void;
}

/**
 * Build a receipt, sign it (executor + optional caller delegate), store, push.
 */
async function createReceipt(p: ReceiptParams): Promise<void> {
  const receiptData: Omit<ExecutionReceipt, "signature" | "callerSignature"> = {
    agentDid: p.did,
    toolName: p.toolName,
    taskHash: p.taskHash,
    resultHash: p.resultHash,
    success: p.success,
    latencyMs: p.latencyMs,
    failureType: p.failureType,
    timestamp: new Date().toISOString(),
    callerDid: p.config?.callerSigner?.did,
  };

  const payload = receiptPayload(receiptData);
  const sig = sign(payload, p.privateKey);

  // Co-signature via SigningDelegate — key never leaves caller's process
  let callerSig: string | undefined;
  if (p.config?.callerSigner) {
    callerSig = await p.config.callerSigner.sign(payload);
  }

  const receipt: ExecutionReceipt = {
    ...receiptData,
    signature: sig,
    callerSignature: callerSig,
  };

  await p.store.log(receipt);

  // Push to all aggregators (fire-and-forget)
  if (p.config?.aggregatorUrls?.length) {
    for (const url of p.config.aggregatorUrls) {
      pushToAggregator(url, receipt, p.publicKey).catch(
        (e) => p.log(`aggregator push failed (${url}): ${e?.message || e}`)
      );
    }
  }
}

/**
 * Wrap an MCP server with XAIP trust infrastructure.
 *
 * Call AFTER registering tools, BEFORE server.connect().
 */
export async function withXAIP(
  server: McpServer,
  config?: XAIPConfig
): Promise<XAIPContext> {
  const store = new ReceiptStore(config?.dbPath);
  const verbose = config?.verbose ?? false;
  const privacy = config?.privacy ?? "full";

  const log = (msg: string) => {
    if (verbose) console.error(`[xaip] ${msg}`);
  };

  if (config?.aggregatorUrls && config.aggregatorUrls.length > 0 && config.aggregatorUrls.length < 3) {
    console.warn(
      `[xaip] WARNING: ${config.aggregatorUrls.length} aggregator(s) configured. ` +
      `Minimum 3 recommended for Byzantine fault tolerance.`
    );
  }

  // ─── 1. Resolve identity ───────────────────────────

  let did = config?.did ? parseDID(config.did) : null;
  let publicKey: string;
  let privateKey: string;

  if (did) {
    const existing = await store.getKeys(did.id);
    if (existing) {
      publicKey = existing.publicKey;
      privateKey = existing.privateKey;
    } else {
      const gen = generateDIDKey();
      publicKey = gen.publicKey;
      privateKey = gen.privateKey;
      await store.saveKeys(did.id, publicKey, privateKey);
    }
  } else {
    const gen = generateDIDKey();
    did = gen.did;
    publicKey = gen.publicKey;
    privateKey = gen.privateKey;
    await store.saveKeys(did.id, publicKey, privateKey);
  }

  log(`identity: ${did.id} (${did.method})`);

  // ─── 2. Wrap all registered tool handlers ──────────

  // MCP SDK ≥1.13 changed _registeredTools from Map to plain Object,
  // and renamed `callback` to `handler`. Support both APIs.
  const registeredTools = (server as any)._registeredTools as
    | Record<string, any>
    | undefined;

  if (registeredTools) {
    for (const [toolName, toolDef] of Object.entries(registeredTools)) {
      if (toolName.startsWith("xaip_")) continue;
      const originalHandler = toolDef.handler ?? toolDef.callback;
      if (!originalHandler) continue;

      const wrappedHandler = async (...args: any[]) => {
        const startTime = Date.now();
        const inputH = hash(args[0]);

        try {
          const result = await originalHandler(...args);
          const latencyMs = Date.now() - startTime;

          await createReceipt({
            did: did!.id, toolName, taskHash: inputH, resultHash: hash(result),
            success: true, latencyMs, privateKey, config, store, publicKey, log,
          });

          log(`${toolName} ok ${latencyMs}ms`);
          return result;
        } catch (error: any) {
          const latencyMs = Date.now() - startTime;
          const failureType = classifyFailure(error, latencyMs);

          await createReceipt({
            did: did!.id, toolName, taskHash: inputH, resultHash: "",
            success: false, latencyMs, failureType, privateKey, config, store, publicKey, log,
          });

          log(`${toolName} FAIL [${failureType}] ${latencyMs}ms — ${error?.message || error}`);
          throw error;
        }
      };

      // Use RegisteredTool.update() if available (maps `callback` → `handler` internally),
      // otherwise assign directly to whichever property the SDK version uses.
      if (typeof toolDef.update === "function") {
        toolDef.update({ callback: wrappedHandler });
      } else {
        toolDef.callback = wrappedHandler;
        toolDef.handler = wrappedHandler;
      }
    }
  }

  // ─── 3. Register XAIP tools ────────────────────────

  server.tool(
    "xaip_identity",
    "Get this agent's XAIP identity and public key",
    {},
    async () => {
      const info = {
        did: did!.id,
        method: did!.method,
        publicKey,
        protocol: XAIP_PROTOCOL_ID,
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(info, null, 2) }],
      };
    }
  );

  server.tool(
    "xaip_query",
    "Query trust score for this agent. Returns verdict (yes/caution/no/unknown), trust score, and per-capability breakdown.",
    {
      capability: z
        .string()
        .optional()
        .describe("Specific capability/tool to check"),
    },
    async ({ capability }) => {
      const receipts = await store.getReceipts(did!.id, capability);
      const result = computeQueryResult(receipts, did!, capability);

      // Apply privacy filter
      if (privacy === "minimal") {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                verdict: result.verdict,
                trust: result.trust,
              }),
            },
          ],
        };
      }
      if (privacy === "summary") {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                verdict: result.verdict,
                trust: result.trust,
                riskFlags: result.riskFlags,
                score: { overall: result.score.overall },
                meta: {
                  sampleSize: result.meta.sampleSize,
                  coSignedRate: result.meta.coSignedRate,
                },
              }),
            },
          ],
        };
      }

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
      };
    }
  );

  // ─── 4. Initialize plugins ─────────────────────────

  const ctx: XAIPContext = { did, publicKey, store };

  if (config?.plugins?.length) {
    for (const plugin of config.plugins) {
      log(`plugin: ${plugin.name} init`);
      await plugin.init(ctx);
      log(`plugin: ${plugin.name} ready`);
    }
  }

  log("ready");

  return ctx;
}

// ─── Aggregator Push ─────────────────────────────────

async function pushToAggregator(
  baseUrl: string,
  receipt: ExecutionReceipt,
  publicKey: string
): Promise<void> {
  const url = `${baseUrl.replace(/\/$/, "")}/receipts`;
  const body = JSON.stringify({ receipt, publicKey });

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`Aggregator responded ${response.status}`);
  }
}
