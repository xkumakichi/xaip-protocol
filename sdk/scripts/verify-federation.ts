/**
 * XAIP Federation Verify Script
 *
 * Queries multiple Aggregator nodes, shows BFT consensus scores,
 * and verifies each node's Ed25519 response signature.
 *
 * Run:
 *   cd sdk && npx tsx scripts/verify-federation.ts
 *   NODES=https://node1,https://node2 npx tsx scripts/verify-federation.ts
 *   AGENT_DID=did:web:context7 npx tsx scripts/verify-federation.ts
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const RAW_NODES = process.env.NODES ?? "https://xaip-aggregator.kuma-github.workers.dev";
const NODES = RAW_NODES.split(",").map((u) => u.trim()).filter(Boolean);

const KEYS_FILE = path.join(os.homedir(), ".xaip", "agent-keys.json");

// Default: first agent in keys file, or env override
function resolveAgentDid(serverName?: string): string {
  if (process.env.AGENT_DID) return process.env.AGENT_DID;
  if (fs.existsSync(KEYS_FILE)) {
    const keys = JSON.parse(fs.readFileSync(KEYS_FILE, "utf8")) as {
      agents?: Record<string, { did: string }>;
    };
    if (keys.agents) {
      const name = serverName ?? Object.keys(keys.agents)[0];
      if (name && keys.agents[name]) return keys.agents[name]!.did;
    }
  }
  return "did:web:context7"; // fallback
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface QueryResult {
  verdict: "yes" | "caution" | "no" | "unknown";
  trust: number;
  riskFlags: string[];
  score: { overall: number };
  meta: {
    sampleSize: number;
    bayesianScore: number;
    callerDiversity: number;
    coSignedRate: number;
    lastUpdated: string;
    quorumSize?: number;
  };
}

interface NodeResponse {
  result: QueryResult;
  source: string;
  timestamp: string;
  signature?: string;
  publicKey?: string;
}

interface NodeResult {
  url: string;
  response: NodeResponse | null;
  latencyMs: number;
  sigOk: boolean | null;
  error: string | null;
}

// ─── Crypto Helpers ───────────────────────────────────────────────────────────

function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!isFinite(value)) throw new Error("JCS: non-finite number");
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const pairs = keys.map(
    (k) =>
      JSON.stringify(k) +
      ":" +
      canonicalize((value as Record<string, unknown>)[k])
  );
  return "{" + pairs.join(",") + "}";
}

function hexToBytes(hex: string): Buffer {
  return Buffer.from(hex, "hex");
}

function verifySignature(
  result: QueryResult,
  signatureHex: string,
  publicKeyHex: string
): boolean {
  try {
    const payload = canonicalize(result);
    const key = crypto.createPublicKey({
      key: hexToBytes(publicKeyHex),
      format: "der",
      type: "spki",
    });
    return crypto.verify(null, Buffer.from(payload), key, hexToBytes(signatureHex));
  } catch {
    return false;
  }
}

// ─── Query Nodes ─────────────────────────────────────────────────────────────

async function queryNode(url: string, agentDid: string): Promise<NodeResult> {
  const t0 = Date.now();
  try {
    const res = await fetch(
      `${url}/query?agentDid=${encodeURIComponent(agentDid)}`
    );
    const latencyMs = Date.now() - t0;
    if (!res.ok) {
      return { url, response: null, latencyMs, sigOk: null, error: `HTTP ${res.status}` };
    }
    const body = await res.json() as NodeResponse;
    let sigOk: boolean | null = null;
    if (body.signature && body.publicKey) {
      sigOk = verifySignature(body.result, body.signature, body.publicKey);
    }
    return { url, response: body, latencyMs, sigOk, error: null };
  } catch (err: unknown) {
    return {
      url,
      response: null,
      latencyMs: Date.now() - t0,
      sigOk: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── BFT Quorum (MAD) ────────────────────────────────────────────────────────

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1]! + sorted[mid]!) / 2)
    : sorted[mid]!;
}

function computeMAD(values: number[], med: number): number {
  const deviations = values.map((v) => Math.abs(v - med));
  return median(deviations);
}

interface QuorumResult {
  quorumTrust: number;
  quorumVerdict: QueryResult["verdict"];
  quorumNodes: NodeResult[];
  outlierNodes: NodeResult[];
  quorumSize: number;
  degraded: boolean;
}

function computeQuorum(nodes: NodeResult[]): QuorumResult {
  const successful = nodes.filter((n) => n.response !== null);

  if (successful.length === 0) {
    return {
      quorumTrust: 0,
      quorumVerdict: "unknown",
      quorumNodes: [],
      outlierNodes: [],
      quorumSize: 0,
      degraded: true,
    };
  }

  if (successful.length === 1) {
    const n = successful[0]!;
    return {
      quorumTrust: n.response!.result.trust,
      quorumVerdict: n.response!.result.verdict,
      quorumNodes: successful,
      outlierNodes: [],
      quorumSize: 1,
      degraded: true,
    };
  }

  const trusts = successful.map((n) => n.response!.result.trust);
  const med = median(trusts);

  let outliers: NodeResult[] = [];
  if (successful.length === 2) {
    if (Math.abs(trusts[0]! - trusts[1]!) > 0.1) {
      // Pick the node closer to 0.5 (safer heuristic)
      const closer = trusts[0]! < trusts[1]! ? successful[0]! : successful[1]!;
      outliers = [closer === successful[0] ? successful[1]! : successful[0]!];
    }
  } else {
    const mad = computeMAD(trusts, med);
    const threshold = Math.max(3 * mad, 0.1);
    outliers = successful.filter((n) => Math.abs(n.response!.result.trust - med) > threshold);
  }

  const quorumNodes = successful.filter((n) => !outliers.includes(n));
  const quorumTrusts = quorumNodes.map((n) => n.response!.result.trust);
  const quorumTrust = quorumTrusts.length > 0 ? median(quorumTrusts) : med;

  // Pick verdict from node closest to quorum median
  const representative = quorumNodes.reduce((best, n) => {
    return Math.abs(n.response!.result.trust - quorumTrust) <
      Math.abs(best.response!.result.trust - quorumTrust)
      ? n
      : best;
  }, quorumNodes[0]!);

  return {
    quorumTrust,
    quorumVerdict: representative.response!.result.verdict,
    quorumNodes,
    outlierNodes: outliers,
    quorumSize: quorumNodes.length,
    degraded: quorumNodes.length < 3,
  };
}

// ─── Display Helpers ─────────────────────────────────────────────────────────

function trustBar(trust: number): string {
  const filled = Math.round(trust * 20);
  return "█".repeat(filled) + "░".repeat(20 - filled);
}

function verdictIcon(verdict: string): string {
  return verdict === "yes" ? "✓" : verdict === "caution" ? "⚠" : verdict === "no" ? "✗" : "?";
}

function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\.[a-z]+\.[a-z]+$/, "...");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function verifyAgent(agentDid: string): Promise<void> {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`Agent: ${agentDid}`);
  console.log(`Nodes: ${NODES.length}`);
  console.log("");

  // Query all nodes in parallel
  const results = await Promise.all(NODES.map((url) => queryNode(url, agentDid)));

  // Per-node results
  console.log("Node responses:");
  for (const r of results) {
    const nodeLabel = shortUrl(r.url);
    if (r.error) {
      console.log(`  [✗] ${nodeLabel.padEnd(35)} ERROR: ${r.error}`);
      continue;
    }
    const res = r.response!.result;
    const sig = r.sigOk === null ? "no-sig" : r.sigOk ? "sig:OK" : "sig:FAIL";
    console.log(
      `  [${verdictIcon(res.verdict)}] ${nodeLabel.padEnd(35)} ` +
        `trust=${res.trust.toFixed(3)} n=${res.meta.sampleSize} ` +
        `${r.latencyMs}ms  ${sig}`
    );
  }

  // BFT quorum
  const quorum = computeQuorum(results);
  console.log("");
  console.log("BFT Quorum:");
  console.log(`  quorumSize: ${quorum.quorumSize}/${results.filter((r) => !r.error).length}`);
  console.log(`  trust:      ${quorum.quorumTrust.toFixed(3)}  ${trustBar(quorum.quorumTrust)}`);
  console.log(`  verdict:    ${verdictIcon(quorum.quorumVerdict)} ${quorum.quorumVerdict}`);
  if (quorum.degraded) {
    console.log(`  ⚠ quorum_degraded (fewer than 3 consensus nodes)`);
  }
  if (quorum.outlierNodes.length > 0) {
    const outlierUrls = quorum.outlierNodes.map((n) => shortUrl(n.url)).join(", ");
    console.log(`  outliers:   ${outlierUrls}`);
  }
}

async function main(): Promise<void> {
  console.log("XAIP Federation Verify");
  console.log(`Nodes: ${NODES.join(", ")}`);

  if (NODES.length === 0) {
    console.error("No nodes configured. Set NODES env var.");
    process.exit(1);
  }

  // Health check all nodes
  console.log("\nHealth checks:");
  const healths = await Promise.all(
    NODES.map((url) =>
      fetch(`${url}/health`)
        .then((r) => r.json())
        .then((h) => ({ url, health: h as Record<string, unknown>, error: null }))
        .catch((err: unknown) => ({
          url,
          health: null,
          error: err instanceof Error ? err.message : String(err),
        }))
    )
  );
  for (const { url, health, error } of healths) {
    if (error) {
      console.log(`  [✗] ${shortUrl(url)}: ${error}`);
    } else {
      const h = health as Record<string, unknown> | null;
      console.log(`  [✓] ${shortUrl(url)}: receipts=${h?.["receipts"] ?? "?"} v=${h?.["version"] ?? "?"}`);
    }
  }

  // Determine agents to verify
  const agents: string[] = [];
  if (process.env.AGENT_DID) {
    agents.push(process.env.AGENT_DID);
  } else if (fs.existsSync(KEYS_FILE)) {
    const keys = JSON.parse(fs.readFileSync(KEYS_FILE, "utf8")) as {
      agents?: Record<string, { did: string }>;
    };
    if (keys.agents) {
      for (const kp of Object.values(keys.agents)) {
        agents.push(kp.did);
      }
    }
  }

  if (agents.length === 0) {
    // Use default did:web names
    agents.push("did:web:context7", "did:web:sequential-thinking", "did:web:filesystem");
  }

  for (const did of agents) {
    await verifyAgent(did);
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
