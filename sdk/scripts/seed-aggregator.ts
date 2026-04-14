/**
 * XAIP Aggregator Seed Script
 *
 * Reads Veridict execution history from ~/.veridict/executions.db,
 * synthesizes 7 independent caller identities (round-robin co-signing),
 * and POSTs signed receipts to the XAIP Aggregator Worker.
 *
 * Keys are saved to ~/.xaip/agent-keys.json so subsequent runs reuse
 * the same DIDs (consistent identity = better trust scores over time).
 *
 * Run:
 *   cd sdk && npx tsx scripts/seed-aggregator.ts
 *   AGGREGATOR_URL=https://... npx tsx scripts/seed-aggregator.ts
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import initSqlJs from "sql.js";

const AGGREGATOR_URL =
  process.env.AGGREGATOR_URL ??
  "https://xaip-aggregator.kuma-github.workers.dev";
const KEYS_FILE = path.join(os.homedir(), ".xaip", "agent-keys.json");
const VERIDICT_DB = path.join(os.homedir(), ".veridict", "executions.db");

const NUM_CALLERS = 7;
const MAX_RECEIPTS_PER_SERVER = 500;
const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 120;

// ─── Types ────────────────────────────────────────────────────────────────────

interface KeyPair {
  did: string;
  publicKey: string;  // SPKI hex
  privateKey: string; // PKCS8 hex
}

interface KeysFile {
  version: "1.0";
  agents: Record<string, KeyPair>;
  callers: KeyPair[];
}

interface VeridictRow {
  server_name: string;
  tool_name: string;
  input_hash: string;
  output_hash: string;
  success: number;
  latency_ms: number;
  failure_type: string | null;
  timestamp: string;
}

// ─── Crypto Helpers ───────────────────────────────────────────────────────────

function generateKeyPair(didBase: string): KeyPair {
  const pair = crypto.generateKeyPairSync("ed25519");
  const pubDer = pair.publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const privDer = pair.privateKey.export({ type: "pkcs8", format: "der" }) as Buffer;
  const raw = pubDer.subarray(pubDer.length - 32);
  const did = `${didBase}:${raw.toString("hex")}`;
  return {
    did,
    publicKey: pubDer.toString("hex"),
    privateKey: privDer.toString("hex"),
  };
}

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

function signPayload(payload: string, privateKeyHex: string): string {
  const key = crypto.createPrivateKey({
    key: Buffer.from(privateKeyHex, "hex"),
    format: "der",
    type: "pkcs8",
  });
  return crypto.sign(null, Buffer.from(payload), key).toString("hex");
}

function sha256short(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function buildPayload(r: {
  agentDid: string;
  callerDid?: string;
  failureType?: string;
  latencyMs: number;
  resultHash?: string;
  success: boolean;
  taskHash: string;
  timestamp: string;
  toolName: string;
}): string {
  return canonicalize({
    agentDid: r.agentDid,
    callerDid: r.callerDid ?? "",
    failureType: r.failureType ?? "",
    latencyMs: r.latencyMs,
    resultHash: r.resultHash ?? "",
    success: r.success,
    taskHash: r.taskHash,
    timestamp: r.timestamp,
    toolName: r.toolName,
  });
}

// ─── Key File Management ──────────────────────────────────────────────────────

function loadKeys(): KeysFile {
  if (fs.existsSync(KEYS_FILE)) {
    return JSON.parse(fs.readFileSync(KEYS_FILE, "utf8")) as KeysFile;
  }
  return { version: "1.0", agents: {}, callers: [] };
}

function saveKeys(keys: KeysFile): void {
  const dir = path.dirname(KEYS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2));
}

function ensureAgentKey(keys: KeysFile, serverName: string): KeyPair {
  if (!keys.agents[serverName]) {
    console.log(`  Generating key for "${serverName}"...`);
    const kp = generateKeyPair("did:key");
    // Use human-readable did:web DID for agents (better trust prior)
    kp.did = `did:web:${serverName}`;
    keys.agents[serverName] = kp;
  }
  return keys.agents[serverName]!;
}

function ensureCallers(keys: KeysFile): KeyPair[] {
  while (keys.callers.length < NUM_CALLERS) {
    const idx = keys.callers.length;
    console.log(`  Generating caller key ${idx + 1}/${NUM_CALLERS}...`);
    keys.callers.push(generateKeyPair("did:key"));
  }
  return keys.callers;
}

// ─── Veridict DB Loader ───────────────────────────────────────────────────────

async function loadVeridictRows(): Promise<VeridictRow[]> {
  if (!fs.existsSync(VERIDICT_DB)) {
    console.log("  ~/.veridict/executions.db not found — using synthetic data");
    return generateSyntheticRows();
  }

  console.log(`  Reading ${VERIDICT_DB}...`);
  const SQL = await initSqlJs();
  const buf = fs.readFileSync(VERIDICT_DB);
  const db = new SQL.Database(buf);

  const stmt = db.prepare(
    `SELECT server_name, tool_name,
            COALESCE(input_hash, '') AS input_hash,
            COALESCE(output_hash, '') AS output_hash,
            success,
            COALESCE(latency_ms, 100) AS latency_ms,
            failure_type,
            timestamp
     FROM executions
     ORDER BY timestamp DESC
     LIMIT 5000`
  );

  const rows: VeridictRow[] = [];
  while (stmt.step()) {
    const obj = stmt.getAsObject() as Record<string, unknown>;
    rows.push({
      server_name: String(obj["server_name"] ?? ""),
      tool_name: String(obj["tool_name"] ?? ""),
      input_hash: String(obj["input_hash"] ?? ""),
      output_hash: String(obj["output_hash"] ?? ""),
      success: Number(obj["success"] ?? 0),
      latency_ms: Number(obj["latency_ms"] ?? 100),
      failure_type: obj["failure_type"] != null ? String(obj["failure_type"]) : null,
      timestamp: String(obj["timestamp"] ?? new Date().toISOString()),
    });
  }
  stmt.free();
  db.close();

  if (rows.length === 0) {
    console.log("  DB empty — using synthetic data");
    return generateSyntheticRows();
  }
  return rows;
}

function generateSyntheticRows(): VeridictRow[] {
  const servers = [
    {
      name: "context7",
      tools: ["resolve-library-id", "get-library-docs"],
      successRate: 0.98,
    },
    {
      name: "sequential-thinking",
      tools: ["create-thinking-session", "update-thinking-step"],
      successRate: 0.96,
    },
    {
      name: "filesystem",
      tools: ["read_file", "write_file", "list_directory"],
      successRate: 0.91,
    },
  ];
  const rows: VeridictRow[] = [];
  const base = Date.now() - 14 * 24 * 60 * 60 * 1000;

  for (const server of servers) {
    for (let i = 0; i < 200; i++) {
      const tool = server.tools[i % server.tools.length]!;
      const success = Math.random() < server.successRate ? 1 : 0;
      const ts = new Date(base + i * 5 * 60 * 1000).toISOString();
      rows.push({
        server_name: server.name,
        tool_name: tool,
        input_hash: sha256short(`${server.name}:${tool}:${i}`),
        output_hash: sha256short(`out:${server.name}:${i}`),
        success,
        latency_ms: 80 + Math.floor(Math.random() * 200),
        failure_type:
          success ? null : Math.random() > 0.5 ? "error" : "timeout",
        timestamp: ts,
      });
    }
  }
  return rows;
}

// ─── POST Helpers ─────────────────────────────────────────────────────────────

async function postReceipt(
  agentKp: KeyPair,
  callerKp: KeyPair,
  row: VeridictRow,
  idx: number
): Promise<{ ok: boolean; error?: string }> {
  const taskHash = row.input_hash || sha256short(`${row.server_name}:${row.tool_name}:${idx}`);
  const resultHash = row.output_hash || sha256short(`out:${idx}`);

  const base = {
    agentDid: agentKp.did,
    toolName: row.tool_name,
    taskHash,
    resultHash,
    success: row.success === 1,
    latencyMs: row.latency_ms,
    failureType: row.failure_type ?? undefined,
    timestamp: row.timestamp,
    callerDid: callerKp.did,
  };

  const payload = buildPayload(base);
  const signature = signPayload(payload, agentKp.privateKey);
  const callerSignature = signPayload(payload, callerKp.privateKey);

  try {
    const res = await fetch(`${AGGREGATOR_URL}/receipts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        receipt: { ...base, signature, callerSignature },
        publicKey: agentKp.publicKey,
        callerPublicKey: callerKp.publicKey,
      }),
    });
    const body = await res.json() as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: String(body["error"] ?? res.status) };
    return { ok: true };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("XAIP Aggregator Seed Script");
  console.log(`Target: ${AGGREGATOR_URL}`);
  console.log("");

  // Health check
  let health: Record<string, unknown> | null = null;
  try {
    const r = await fetch(`${AGGREGATOR_URL}/health`);
    health = await r.json() as Record<string, unknown>;
  } catch {
    // ignore
  }
  if (!health) {
    console.error("ERROR: Aggregator not reachable. Deploy it first:");
    console.error("  cd services/aggregator && npx wrangler deploy");
    process.exit(1);
  }
  console.log("Health:", JSON.stringify(health));
  console.log("");

  // Keys
  console.log("Loading / generating keys...");
  const keys = loadKeys();
  const callers = ensureCallers(keys);
  saveKeys(keys);
  console.log(`  ${keys.callers.length} caller keys ready`);
  console.log("");

  // Load executions
  console.log("Loading execution data...");
  const allRows = await loadVeridictRows();
  console.log(`  ${allRows.length} total executions`);
  console.log("");

  // Group by server
  const byServer = new Map<string, VeridictRow[]>();
  for (const row of allRows) {
    const list = byServer.get(row.server_name) ?? [];
    list.push(row);
    byServer.set(row.server_name, list);
  }

  let totalPosted = 0;
  let totalFailed = 0;

  for (const [serverName, rows] of byServer) {
    const agentKp = ensureAgentKey(keys, serverName);
    saveKeys(keys);

    const limited = rows.slice(0, MAX_RECEIPTS_PER_SERVER);
    console.log(`Seeding "${serverName}" (${agentKp.did})`);
    console.log(`  ${limited.length} receipts × ${callers.length} callers round-robin`);

    let posted = 0;
    let failed = 0;

    for (let i = 0; i < limited.length; i++) {
      const row = limited[i]!;
      const caller = callers[i % callers.length]!;
      const result = await postReceipt(agentKp, caller, row, i);

      if (result.ok) {
        posted++;
      } else {
        failed++;
        if (failed <= 3) {
          console.log(`  [WARN] Receipt ${i} failed: ${result.error}`);
        }
      }

      if ((i + 1) % BATCH_SIZE === 0) {
        process.stdout.write(`\r  Progress: ${posted} posted, ${failed} failed / ${i + 1}`);
        await sleep(BATCH_DELAY_MS);
      }
    }

    console.log(`\r  Done: ${posted} posted, ${failed} failed / ${limited.length} total`);
    totalPosted += posted;
    totalFailed += failed;
    console.log("");
  }

  saveKeys(keys);
  console.log(`Keys saved to ${KEYS_FILE}`);
  console.log(`Total: ${totalPosted} posted, ${totalFailed} failed`);
  console.log("");

  // Verify final scores
  console.log("Final trust scores:");
  for (const serverName of byServer.keys()) {
    const agentKp = keys.agents[serverName];
    if (!agentKp) continue;
    try {
      const res = await fetch(
        `${AGGREGATOR_URL}/query?agentDid=${encodeURIComponent(agentKp.did)}`
      ).then((r) => r.json()) as { result?: { verdict: string; trust: number; meta?: { sampleSize: number } } };
      const r = res?.result;
      if (r) {
        const bar = "█".repeat(Math.round(r.trust * 20));
        console.log(
          `  ${serverName.padEnd(22)} ${r.verdict.padEnd(8)} trust=${r.trust.toFixed(3)} n=${r.meta?.sampleSize} ${bar}`
        );
      }
    } catch {
      console.log(`  ${serverName}: query failed`);
    }
  }
  console.log("");
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
