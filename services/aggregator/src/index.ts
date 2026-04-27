/**
 * XAIP Aggregator — Cloudflare Worker + D1
 *
 * Independent aggregator node: stores signed execution receipts in D1,
 * computes Bayesian trust scores, signs responses with its own Ed25519 key.
 *
 * Endpoints:
 *   POST /receipts  — submit a signed execution receipt
 *   GET  /query     — get trust score for an agent DID
 *   GET  /health    — liveness probe
 *
 * Trust model: Bayesian Beta × caller diversity × co-sign factor
 * Verification: Web Crypto Ed25519 (SPKI / PKCS8 hex)
 */

interface Env {
  DB: D1Database;
  NODE_ID: string;
  XAIP_VERSION: string;
}

// ─── JCS (RFC 8785) ──────────────────────────────────────────────────────────

function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!isFinite(value)) throw new Error("JCS: non-finite number");
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalize).join(",") + "]";
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const pairs = keys.map(
    (k) =>
      JSON.stringify(k) +
      ":" +
      canonicalize((value as Record<string, unknown>)[k])
  );
  return "{" + pairs.join(",") + "}";
}

// ─── Receipt Payload ─────────────────────────────────────────────────────────

interface ReceiptData {
  agentDid: string;
  toolName: string;
  taskHash: string;
  resultHash?: string;
  success: boolean;
  latencyMs: number;
  failureType?: string;
  timestamp: string;
  callerDid?: string;
  toolMetadata?: ToolMetadata;
  signature: string;
  callerSignature?: string;
}

interface ToolMetadata {
  xaip?: {
    class?: string;
    secondaryClasses?: string[];
    settlementLayer?: string;
    verifiabilityHint?: string;
    anchorTxHash?: string;
    anchorLedgerIndex?: number;
  };
  [key: string]: unknown;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function receiptPayload(r: Omit<ReceiptData, "signature" | "callerSignature">): string {
  const obj: Record<string, unknown> = {
    agentDid: r.agentDid,
    callerDid: r.callerDid ?? "",
    failureType: r.failureType ?? "",
    latencyMs: r.latencyMs,
    resultHash: r.resultHash ?? "",
    success: r.success,
    taskHash: r.taskHash,
    timestamp: r.timestamp,
    toolName: r.toolName,
  };
  if (r.toolMetadata !== undefined) {
    obj.toolMetadata = r.toolMetadata;
  }
  return canonicalize(obj);
}

// ─── Hex Utilities ───────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─── Web Crypto Ed25519 ──────────────────────────────────────────────────────

async function verifyEd25519(
  payload: string,
  signatureHex: string,
  publicKeyHex: string
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "spki",
      hexToBytes(publicKeyHex),
      { name: "Ed25519" },
      false,
      ["verify"]
    );
    return await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      hexToBytes(signatureHex),
      new TextEncoder().encode(payload)
    );
  } catch {
    return false;
  }
}

async function signEd25519(payload: string, privateKeyHex: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    hexToBytes(privateKeyHex),
    { name: "Ed25519" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    { name: "Ed25519" },
    key,
    new TextEncoder().encode(payload)
  );
  return bytesToHex(new Uint8Array(sig));
}

/**
 * Derive SPKI hex from a did:key DID (raw 32-byte Ed25519 public key).
 * Ed25519 SPKI prefix: 302a300506032b6570032100 (12 bytes).
 */
function callerDIDToSPKI(callerDid: string): string | null {
  const m = callerDid.match(/^did:key:([0-9a-f]{64})$/i);
  if (!m) return null;
  return "302a300506032b6570032100" + m[1]!.toLowerCase();
}

// ─── Node Key Management ─────────────────────────────────────────────────────

interface NodeKeyRow {
  public_key: string;
  private_key: string;
}

async function getOrCreateNodeKeys(db: D1Database): Promise<NodeKeyRow> {
  const row = await db
    .prepare("SELECT public_key, private_key FROM node_keys WHERE id = 1")
    .first<NodeKeyRow>();

  if (row) return row;

  // Generate key pair
  const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ]) as CryptoKeyPair;
  const pubDer = await crypto.subtle.exportKey("spki", kp.publicKey) as ArrayBuffer;
  const privDer = await crypto.subtle.exportKey("pkcs8", kp.privateKey) as ArrayBuffer;
  const pub = bytesToHex(new Uint8Array(pubDer));
  const priv = bytesToHex(new Uint8Array(privDer));

  await db
    .prepare(
      "INSERT OR IGNORE INTO node_keys (id, public_key, private_key) VALUES (1, ?, ?)"
    )
    .bind(pub, priv)
    .run();

  return { public_key: pub, private_key: priv };
}

// ─── Rate Limit ──────────────────────────────────────────────────────────────

const MAX_RECEIPTS_PER_DID_PER_HOUR = 1000;

async function checkRateLimit(db: D1Database, agentDid: string): Promise<boolean> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const row = await db
    .prepare(
      "SELECT COUNT(*) as cnt FROM receipts WHERE agent_did = ? AND timestamp > ?"
    )
    .bind(agentDid, oneHourAgo)
    .first<{ cnt: number }>();
  return (row?.cnt ?? 0) < MAX_RECEIPTS_PER_DID_PER_HOUR;
}

async function updateDidRegistry(
  db: D1Database,
  agentDid: string,
  timestamp: string
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO did_registry (did, first_seen, receipt_count, last_receipt)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(did) DO UPDATE SET
         receipt_count = receipt_count + 1,
         last_receipt  = excluded.last_receipt`
    )
    .bind(agentDid, timestamp, timestamp)
    .run();
}

// ─── D1 Queries ──────────────────────────────────────────────────────────────

interface ReceiptRow {
  tool_name: string;
  success: number;
  latency_ms: number;
  failure_type: string | null;
  timestamp: string;
  caller_did: string | null;
  caller_signature: string | null;
  tool_metadata_json: string | null;
  tool_class: string | null;
  verifiability_hint: string | null;
  settlement_layer: string | null;
}

interface StoredReceipt {
  toolName: string;
  success: boolean;
  latencyMs: number;
  failureType: string | null;
  timestamp: string;
  callerDid: string | null;
  callerSignature: string | null;
  toolMetadata: ToolMetadata | null;
  toolClass: string | null;
  verifiabilityHint: string | null;
  settlementLayer: string | null;
}

async function getReceipts(
  db: D1Database,
  agentDid: string,
  toolName?: string
): Promise<StoredReceipt[]> {
  const stmt = toolName
    ? db
        .prepare(
          `SELECT tool_name, success, latency_ms, failure_type, timestamp,
                  caller_did, caller_signature, tool_metadata_json,
                  tool_class, verifiability_hint, settlement_layer
           FROM receipts
           WHERE agent_did = ? AND tool_name = ?
           ORDER BY timestamp DESC
           LIMIT 2000`
        )
        .bind(agentDid, toolName)
    : db
        .prepare(
          `SELECT tool_name, success, latency_ms, failure_type, timestamp,
                  caller_did, caller_signature, tool_metadata_json,
                  tool_class, verifiability_hint, settlement_layer
           FROM receipts
           WHERE agent_did = ?
           ORDER BY timestamp DESC
           LIMIT 2000`
        )
        .bind(agentDid);

  const { results } = await stmt.all<ReceiptRow>();
  return results.map((r) => ({
    toolName: r.tool_name,
    success: r.success === 1,
    latencyMs: r.latency_ms,
    failureType: r.failure_type,
    timestamp: r.timestamp,
    callerDid: r.caller_did,
    callerSignature: r.caller_signature,
    toolMetadata: r.tool_metadata_json ? JSON.parse(r.tool_metadata_json) : null,
    toolClass: r.tool_class,
    verifiabilityHint: r.verifiability_hint,
    settlementLayer: r.settlement_layer,
  }));
}

// ─── Trust Computation (inlined from sdk/src/score.ts) ───────────────────────

const IDENTITY_PRIORS: Record<string, [number, number]> = {
  key:  [1, 1],
  web:  [2, 1],
  ethr: [3, 1],
  xrpl: [5, 1],
};

const RECENT_DAYS = 7;
const RECENT_WEIGHT = 0.7;
const ALLTIME_WEIGHT = 0.3;
const MIN_RECENT_FOR_BLEND = 3;
const MIN_EXECUTIONS = 5;
const DIVERSITY_MIN_SAMPLE = 10;
const RECENT_MS = RECENT_DAYS * 24 * 60 * 60 * 1000;

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

function parseDIDMethod(did: string): string {
  const m = did.match(/^did:(\w+):/);
  return m?.[1] ?? "key";
}

function getPrior(did: string): [number, number] {
  const method = parseDIDMethod(did);
  return IDENTITY_PRIORS[method] ?? [1, 1];
}

function bayesianScore(
  successes: number,
  failures: number,
  prior: [number, number]
): number {
  const a = prior[0] + successes;
  const b = prior[1] + failures;
  return a / (a + b);
}

function callerWeight(callerDid: string): number {
  const method = parseDIDMethod(callerDid);
  const p = IDENTITY_PRIORS[method] ?? [1, 1];
  return p[0] / (p[0] + p[1]);
}

function callerDiversity(receipts: StoredReceipt[]): number {
  if (receipts.length === 0) return 0;
  if (receipts.length < DIVERSITY_MIN_SAMPLE) return 1;

  const callers = new Map<string, number>();
  for (const r of receipts) {
    if (r.callerDid && !callers.has(r.callerDid)) {
      callers.set(r.callerDid, callerWeight(r.callerDid));
    }
  }
  if (callers.size === 0) return 0.1;

  const weightedSum = Array.from(callers.values()).reduce((a, b) => a + b, 0);
  return Math.min(1, weightedSum / Math.sqrt(receipts.length));
}

function coSignFactor(receipts: StoredReceipt[]): number {
  if (receipts.length === 0) return 0.5;
  const coSigned = receipts.filter(
    (r) => r.callerDid && r.callerSignature
  ).length;
  return 0.5 + 0.5 * (coSigned / receipts.length);
}

function blendedRate(receipts: StoredReceipt[]): number {
  if (receipts.length === 0) return 0;
  const now = Date.now();
  const cutoff = now - RECENT_MS;
  const recent = receipts.filter(
    (r) => new Date(r.timestamp).getTime() >= cutoff
  );
  const alltimeRate =
    receipts.filter((r) => r.success).length / receipts.length;
  if (recent.length >= MIN_RECENT_FOR_BLEND) {
    const recentRate = recent.filter((r) => r.success).length / recent.length;
    return recentRate * RECENT_WEIGHT + alltimeRate * ALLTIME_WEIGHT;
  }
  return alltimeRate;
}

function detectRiskFlags(
  receipts: StoredReceipt[],
  diversity: number,
  cosign: number
): string[] {
  const flags: string[] = [];
  const n = receipts.length;
  if (n < 30) flags.push("low_sample_size");

  const failures = receipts.filter((r) => !r.success);
  if (n > 0 && failures.length / n > 0.1) flags.push("high_error_rate");

  const timeouts = failures.filter((r) => r.failureType === "timeout");
  if (n > 0 && timeouts.length / n > 0.05) flags.push("high_timeout_rate");

  const now = Date.now();
  const cutoff = now - RECENT_MS;
  const recent = receipts.filter(
    (r) => new Date(r.timestamp).getTime() >= cutoff
  );
  if (recent.length >= MIN_RECENT_FOR_BLEND) {
    const recentRate = recent.filter((r) => r.success).length / recent.length;
    const alltimeRate = receipts.filter((r) => r.success).length / n;
    if (alltimeRate - recentRate > 0.1) flags.push("declining_performance");
  }

  if (diversity < 0.3) flags.push("low_caller_diversity");
  if (cosign < 0.75) flags.push("low_cosign_rate");
  if (cosign === 0.5 && n > 0) flags.push("no_cosignatures");

  return flags;
}

interface CapabilityScore {
  score: number;
  executions: number;
  recentSuccessRate: number;
}

interface QueryResult {
  verdict: "yes" | "caution" | "no" | "unknown";
  trust: number;
  riskFlags: string[];
  score: { overall: number; byCapability: Record<string, CapabilityScore> };
  meta: {
    sampleSize: number;
    bayesianScore: number;
    callerDiversity: number;
    coSignedRate: number;
    prior: [number, number];
    lastUpdated: string;
    sources: number;
  };
}

function computeQueryResult(
  receipts: StoredReceipt[],
  agentDid: string,
  capability?: string
): QueryResult {
  const total = receipts.length;
  const prior = getPrior(agentDid);

  if (total < MIN_EXECUTIONS) {
    return {
      verdict: "unknown",
      trust: 0,
      riskFlags: ["insufficient_data"],
      score: { overall: 0, byCapability: {} },
      meta: {
        sampleSize: total,
        bayesianScore: 0,
        callerDiversity: 0,
        coSignedRate: 0,
        prior,
        lastUpdated:
          total > 0 ? receipts[0]!.timestamp : new Date().toISOString(),
        sources: 1,
      },
    };
  }

  const byTool = new Map<string, StoredReceipt[]>();
  for (const r of receipts) {
    const list = byTool.get(r.toolName) ?? [];
    list.push(r);
    byTool.set(r.toolName, list);
  }

  const byCapability: Record<string, CapabilityScore> = {};
  let weightedSum = 0;
  let totalWeight = 0;

  for (const [tool, toolReceipts] of byTool) {
    const rate = blendedRate(toolReceipts);
    const now = Date.now();
    const cutoff = now - RECENT_MS;
    const recent = toolReceipts.filter(
      (r) => new Date(r.timestamp).getTime() >= cutoff
    );
    const recentRate =
      recent.length > 0
        ? recent.filter((r) => r.success).length / recent.length
        : rate;
    byCapability[tool] = {
      score: round3(rate),
      executions: toolReceipts.length,
      recentSuccessRate: round3(recentRate),
    };
    weightedSum += rate * toolReceipts.length;
    totalWeight += toolReceipts.length;
  }

  const overall =
    capability && byCapability[capability]
      ? byCapability[capability]!.score
      : totalWeight > 0
      ? weightedSum / totalWeight
      : 0;

  const successes = receipts.filter((r) => r.success).length;
  const failures = total - successes;
  const bs = bayesianScore(successes, failures, prior);
  const div = callerDiversity(receipts);
  const csf = coSignFactor(receipts);
  // Diversity is a modifier (floor 0.5), not a killer.
  // Sybil defense is preserved; bootstrap collapse is prevented.
  const trust = round3(bs * (0.5 + 0.5 * div) * csf);

  const riskFlags = detectRiskFlags(receipts, div, csf);

  let verdict: QueryResult["verdict"];
  if (total < DIVERSITY_MIN_SAMPLE) {
    verdict = "unknown";
    riskFlags.push("bootstrap_period");
  } else if (trust >= 0.7) {
    verdict = "yes";
  } else if (trust >= 0.4) {
    verdict = "caution";
  } else {
    verdict = "no";
  }

  const coSignedCount = receipts.filter(
    (r) => r.callerDid && r.callerSignature
  ).length;

  return {
    verdict,
    trust,
    riskFlags,
    score: { overall: round3(overall), byCapability },
    meta: {
      sampleSize: total,
      bayesianScore: round3(bs),
      callerDiversity: round3(div),
      coSignedRate: round3(coSignedCount / total),
      prior,
      lastUpdated: receipts[0]?.timestamp ?? new Date().toISOString(),
      sources: 1,
    },
  };
}

// ─── CORS + JSON ─────────────────────────────────────────────────────────────

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "public, max-age=60",
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

// ─── POST /receipts ───────────────────────────────────────────────────────────

interface PushPayload {
  receipt: ReceiptData;
  publicKey: string;         // agent SPKI hex
  callerPublicKey?: string;  // caller SPKI hex (optional; derived from did:key if absent)
}

async function handlePostReceipts(
  request: Request,
  env: Env
): Promise<Response> {
  let body: PushPayload;
  try {
    body = await request.json() as PushPayload;
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const { receipt, publicKey, callerPublicKey } = body;
  if (
    !receipt?.agentDid ||
    !receipt?.toolName ||
    !receipt?.signature ||
    !publicKey
  ) {
    return jsonResponse(
      {
        error:
          "Required: receipt.agentDid, receipt.toolName, receipt.signature, publicKey",
      },
      400
    );
  }

  // Validate timestamp (reject receipts >48h old or >5min in future)
  const ts = new Date(receipt.timestamp).getTime();
  const now = Date.now();
  if (isNaN(ts) || ts < now - 48 * 60 * 60 * 1000 || ts > now + 5 * 60 * 1000) {
    return jsonResponse({ error: "Receipt timestamp out of acceptable range" }, 400);
  }

  // Rate limit
  const allowed = await checkRateLimit(env.DB, receipt.agentDid);
  if (!allowed) {
    return jsonResponse({ error: "Rate limit exceeded (1000/hour per DID)" }, 429);
  }

  // Verify agent signature
  const payload = receiptPayload(receipt);
  const agentOk = await verifyEd25519(payload, receipt.signature, publicKey);
  if (!agentOk) {
    return jsonResponse({ error: "Invalid agent signature" }, 400);
  }

  // Verify caller co-signature (optional but recorded)
  let callerVerified = false;
  if (receipt.callerDid && receipt.callerSignature) {
    const spki =
      callerPublicKey ?? callerDIDToSPKI(receipt.callerDid);
    if (spki) {
      callerVerified = await verifyEd25519(
        payload,
        receipt.callerSignature,
        spki
      );
    }
  }

  // Store in D1. v0.5 metadata is preserved for future class-aware scoring,
  // but it does not affect scoring in this PR.
  const toolMetadataJson = receipt.toolMetadata
    ? JSON.stringify(receipt.toolMetadata)
    : null;
  const xaipMetadata = receipt.toolMetadata?.xaip;
  await env.DB.prepare(
    `INSERT INTO receipts
      (agent_did, tool_name, task_hash, result_hash, success, latency_ms,
       failure_type, timestamp, signature, caller_did, caller_signature,
       public_key, tool_metadata_json, tool_class, verifiability_hint,
       settlement_layer)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      receipt.agentDid,
      receipt.toolName,
      receipt.taskHash ?? "",
      receipt.resultHash ?? null,
      receipt.success ? 1 : 0,
      receipt.latencyMs,
      receipt.failureType ?? null,
      receipt.timestamp,
      receipt.signature,
      receipt.callerDid ?? null,
      // Only store co-sig if verified; still record callerDid for diversity
      callerVerified ? (receipt.callerSignature ?? null) : null,
      publicKey,
      toolMetadataJson,
      stringOrNull(xaipMetadata?.class),
      stringOrNull(xaipMetadata?.verifiabilityHint),
      stringOrNull(xaipMetadata?.settlementLayer)
    )
    .run();

  await updateDidRegistry(env.DB, receipt.agentDid, receipt.timestamp);

  return jsonResponse({
    ok: true,
    agentDid: receipt.agentDid,
    callerVerified,
  });
}

// ─── GET /query ───────────────────────────────────────────────────────────────

async function handleGetQuery(
  url: URL,
  env: Env
): Promise<Response> {
  const agentDid = url.searchParams.get("agentDid");
  const capability = url.searchParams.get("capability") ?? undefined;

  if (!agentDid) {
    return jsonResponse({ error: "Required query param: agentDid" }, 400);
  }

  const receipts = await getReceipts(env.DB, agentDid, capability);
  const result = computeQueryResult(receipts, agentDid, capability);

  // Sign the response
  const keys = await getOrCreateNodeKeys(env.DB);
  const responsePayload = canonicalize(result);
  const signature = await signEd25519(responsePayload, keys.private_key);

  return jsonResponse({
    result,
    source: env.NODE_ID,
    timestamp: new Date().toISOString(),
    signature,
    publicKey: keys.public_key,
  });
}

// ─── Router ──────────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (path === "/health") {
      const row = await env.DB
        .prepare("SELECT COUNT(*) as cnt FROM receipts")
        .first<{ cnt: number }>();
      return jsonResponse({
        status: "ok",
        nodeId: env.NODE_ID,
        version: env.XAIP_VERSION,
        receipts: row?.cnt ?? 0,
        timestamp: new Date().toISOString(),
      });
    }

    if (path === "/receipts" && request.method === "POST") {
      return handlePostReceipts(request, env);
    }

    if (path === "/query" && request.method === "GET") {
      return handleGetQuery(url, env);
    }

    return jsonResponse(
      {
        error: "Not found",
        docs: "POST /receipts  GET /query?agentDid=<did>  GET /health",
      },
      404
    );
  },
} satisfies ExportedHandler<Env>;
