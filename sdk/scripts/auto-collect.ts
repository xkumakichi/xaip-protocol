/**
 * XAIP Auto-Collection Script
 *
 * Connects to real MCP servers, runs a small set of tool calls per server,
 * signs Ed25519 receipts, and POSTs them directly to the XAIP Aggregator.
 *
 * Designed to run daily via GitHub Actions (no local DB, no browser servers).
 * Keys are generated fresh each run for caller diversity; agent keys are
 * persisted to ~/.xaip/agent-keys.json when running locally.
 *
 * Run:
 *   cd sdk && npx tsx scripts/auto-collect.ts
 *   AGGREGATOR_URL=https://... npx tsx scripts/auto-collect.ts
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const AGGREGATOR_URL =
  process.env.AGGREGATOR_URL ??
  "https://xaip-aggregator.kuma-github.workers.dev";
const KEYS_FILE = path.join(os.homedir(), ".xaip", "agent-keys.json");
const NPX = process.platform === "win32" ? "npx.cmd" : "npx";
const CONNECT_TIMEOUT_MS = 15_000;
const CALL_TIMEOUT_MS = 15_000;
const CLOSE_TIMEOUT_MS = 3_000;

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

interface ServerResult {
  slug: string;
  callsMade: number;
  successes: number;
  failures: number;
  receiptsPosted: number;
  receiptsFailed: number;
}

// ─── Crypto Helpers (mirrored from seed-aggregator.ts) ───────────────────────

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
  callerDid: string;
  failureType?: string;
  latencyMs: number;
  resultHash: string;
  success: boolean;
  taskHash: string;
  timestamp: string;
  toolName: string;
}): string {
  return canonicalize({
    agentDid: r.agentDid,
    callerDid: r.callerDid,
    failureType: r.failureType ?? "",
    latencyMs: r.latencyMs,
    resultHash: r.resultHash,
    success: r.success,
    taskHash: r.taskHash,
    timestamp: r.timestamp,
    toolName: r.toolName,
  });
}

// ─── Key Management ───────────────────────────────────────────────────────────

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
    const kp = generateKeyPair("did:key");
    kp.did = `did:web:${serverName}`;
    keys.agents[serverName] = kp;
    saveKeys(keys);
  }
  return keys.agents[serverName]!;
}

function ensureCallerKey(keys: KeysFile): KeyPair {
  if (keys.callers.length === 0) keys.callers.push(generateKeyPair("did:key"));
  return keys.callers[0]!;
}

// ─── Aggregator POST ─────────────────────────────────────────────────────────

async function postReceipt(params: {
  agentKp: KeyPair;
  callerKp: KeyPair;
  toolName: string;
  taskInput: unknown;
  result: unknown;
  success: boolean;
  latencyMs: number;
  failureType?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const timestamp = new Date().toISOString();
  const taskHash = sha256short(JSON.stringify(params.taskInput));
  const resultHash = sha256short(JSON.stringify(params.result));

  const base = {
    agentDid: params.agentKp.did,
    callerDid: params.callerKp.did,
    toolName: params.toolName,
    taskHash,
    resultHash,
    success: params.success,
    latencyMs: params.latencyMs,
    failureType: params.failureType,
    timestamp,
  };

  const payload = buildPayload({
    agentDid: base.agentDid,
    callerDid: base.callerDid,
    failureType: base.failureType,
    latencyMs: base.latencyMs,
    resultHash: base.resultHash,
    success: base.success,
    taskHash: base.taskHash,
    timestamp: base.timestamp,
    toolName: base.toolName,
  });

  const signature = signPayload(payload, params.agentKp.privateKey);
  const callerSignature = signPayload(payload, params.callerKp.privateKey);

  try {
    const res = await fetch(`${AGGREGATOR_URL}/receipts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        receipt: { ...base, signature, callerSignature },
        publicKey: params.agentKp.publicKey,
        callerPublicKey: params.callerKp.publicKey,
      }),
    });
    const body = await res.json() as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: String(body["error"] ?? res.status) };
    return { ok: true };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── MCP Connect with Timeout ────────────────────────────────────────────────

async function connectMcp(
  args: string[],
  env?: Record<string, string>
): Promise<{ ok: true; client: Client } | { ok: false; error: string }> {
  const transport = new StdioClientTransport({
    command: NPX,
    args,
    env: { ...process.env, ...env } as Record<string, string>,
    stderr: "pipe",
  });
  const client = new Client(
    { name: "xaip-auto-collect", version: "1.0.0" },
    { capabilities: {} }
  );
  try {
    await Promise.race([
      client.connect(transport),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error("connect timeout")), CONNECT_TIMEOUT_MS)
      ),
    ]);
    return { ok: true, client };
  } catch (err) {
    try { await client.close(); } catch { /* ignore */ }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function closeMcp(client: Client): Promise<void> {
  try {
    await Promise.race([
      client.close(),
      new Promise<void>((resolve) => setTimeout(resolve, CLOSE_TIMEOUT_MS)),
    ]);
  } catch { /* ignore */ }
}

// ─── Tool Call with Timeout ───────────────────────────────────────────────────

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>
): Promise<{ ok: boolean; result: unknown; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    const result = await Promise.race([
      client.callTool({ name, arguments: args }),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error("call timeout")), CALL_TIMEOUT_MS)
      ),
    ]);
    const latencyMs = Date.now() - start;
    const isError = (result as { isError?: boolean }).isError === true;
    return { ok: !isError, result, latencyMs };
  } catch (err) {
    return {
      ok: false,
      result: null,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Per-Server Runners ───────────────────────────────────────────────────────

async function runContext7(
  client: Client,
  agentKp: KeyPair,
  callerKp: KeyPair
): Promise<{ calls: number; successes: number; failures: number; receiptsPosted: number; receiptsFailed: number }> {
  let calls = 0, successes = 0, failures = 0, receiptsPosted = 0, receiptsFailed = 0;

  // 3 resolve-library-id calls
  const resolveLibraries = ["react", "typescript", "zod"];
  const resolvedIds: string[] = [];

  for (const libraryName of resolveLibraries) {
    const { ok, result, latencyMs } = await callTool(client, "resolve-library-id", {
      query: `How to use ${libraryName}`,
      libraryName,
    });
    calls++;
    if (ok) {
      successes++;
      // Extract library ID from result for use in query-docs
      const text = (result as { content?: Array<{ text?: string }> })?.content?.[0]?.text ?? "";
      const match = text.match(/(\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/);
      if (match) resolvedIds.push(match[1]);
    } else {
      failures++;
    }
    const post = await postReceipt({
      agentKp, callerKp,
      toolName: "resolve-library-id",
      taskInput: { query: `How to use ${libraryName}`, libraryName },
      result,
      success: ok,
      latencyMs,
    });
    post.ok ? receiptsPosted++ : receiptsFailed++;
    process.stdout.write(ok ? "." : "x");
  }

  // 2 query-docs calls using resolved IDs (or fallback)
  const idsToUse = resolvedIds.length > 0 ? resolvedIds : ["/facebook/react", "/microsoft/typescript"];
  const docQueries = ["hooks overview", "type inference"];

  for (let i = 0; i < 2; i++) {
    const libraryId = idsToUse[i % idsToUse.length]!;
    const query = docQueries[i]!;
    const { ok, result, latencyMs } = await callTool(client, "get-library-docs", {
      context7CompatibleLibraryID: libraryId,
      topic: query,
      tokens: 3000,
    });
    calls++;
    if (ok) successes++; else failures++;
    const post = await postReceipt({
      agentKp, callerKp,
      toolName: "get-library-docs",
      taskInput: { context7CompatibleLibraryID: libraryId, topic: query },
      result,
      success: ok,
      latencyMs,
    });
    post.ok ? receiptsPosted++ : receiptsFailed++;
    process.stdout.write(ok ? "." : "x");
  }

  return { calls, successes, failures, receiptsPosted, receiptsFailed };
}

async function runSequentialThinking(
  client: Client,
  agentKp: KeyPair,
  callerKp: KeyPair
): Promise<{ calls: number; successes: number; failures: number; receiptsPosted: number; receiptsFailed: number }> {
  let calls = 0, successes = 0, failures = 0, receiptsPosted = 0, receiptsFailed = 0;

  const topics: Array<[string, number]> = [
    ["What are the key tradeoffs when designing trust scoring for AI agents?", 3],
    ["How should distributed systems handle cascading failures?", 2],
  ];

  for (const [topic, totalThoughts] of topics) {
    for (let i = 1; i <= totalThoughts; i++) {
      const thought = i === 1
        ? topic
        : `Continuing: ${topic} — step ${i}/${totalThoughts}`;
      const args = {
        thought,
        thoughtNumber: i,
        totalThoughts,
        nextThoughtNeeded: i < totalThoughts,
      };
      const { ok, result, latencyMs } = await callTool(client, "sequentialthinking", args);
      calls++;
      if (ok) successes++; else failures++;
      const post = await postReceipt({
        agentKp, callerKp,
        toolName: "sequentialthinking",
        taskInput: args,
        result,
        success: ok,
        latencyMs,
      });
      post.ok ? receiptsPosted++ : receiptsFailed++;
      process.stdout.write(ok ? "." : "x");
    }
  }

  return { calls, successes, failures, receiptsPosted, receiptsFailed };
}

async function runMemory(
  client: Client,
  agentKp: KeyPair,
  callerKp: KeyPair
): Promise<{ calls: number; successes: number; failures: number; receiptsPosted: number; receiptsFailed: number }> {
  let calls = 0, successes = 0, failures = 0, receiptsPosted = 0, receiptsFailed = 0;

  // create_entities — 2 entities
  const entities = [
    { name: "XAIP Protocol", entityType: "project", observations: ["Cross-Agent Identity Protocol", "Provides trust infrastructure"] },
    { name: "Trust Score",   entityType: "metric",  observations: ["Numerical measure of reliability", "Range 0.0 to 1.0"] },
  ];
  for (const entity of entities) {
    const args = { entities: [entity] };
    const { ok, result, latencyMs } = await callTool(client, "create_entities", args);
    calls++;
    if (ok) successes++; else failures++;
    const post = await postReceipt({ agentKp, callerKp, toolName: "create_entities", taskInput: args, result, success: ok, latencyMs });
    post.ok ? receiptsPosted++ : receiptsFailed++;
    process.stdout.write(ok ? "." : "x");
  }

  // search_nodes — 2 queries
  for (const query of ["XAIP", "trust"]) {
    const args = { query };
    const { ok, result, latencyMs } = await callTool(client, "search_nodes", args);
    calls++;
    if (ok) successes++; else failures++;
    const post = await postReceipt({ agentKp, callerKp, toolName: "search_nodes", taskInput: args, result, success: ok, latencyMs });
    post.ok ? receiptsPosted++ : receiptsFailed++;
    process.stdout.write(ok ? "." : "x");
  }

  // read_graph
  {
    const args = {};
    const { ok, result, latencyMs } = await callTool(client, "read_graph", args);
    calls++;
    if (ok) successes++; else failures++;
    const post = await postReceipt({ agentKp, callerKp, toolName: "read_graph", taskInput: args, result, success: ok, latencyMs });
    post.ok ? receiptsPosted++ : receiptsFailed++;
    process.stdout.write(ok ? "." : "x");
  }

  // delete_entities
  {
    const args = { entityNames: ["Trust Score"] };
    const { ok, result, latencyMs } = await callTool(client, "delete_entities", args);
    calls++;
    if (ok) successes++; else failures++;
    const post = await postReceipt({ agentKp, callerKp, toolName: "delete_entities", taskInput: args, result, success: ok, latencyMs });
    post.ok ? receiptsPosted++ : receiptsFailed++;
    process.stdout.write(ok ? "." : "x");
  }

  return { calls, successes, failures, receiptsPosted, receiptsFailed };
}

async function runFilesystem(
  client: Client,
  agentKp: KeyPair,
  callerKp: KeyPair
): Promise<{ calls: number; successes: number; failures: number; receiptsPosted: number; receiptsFailed: number }> {
  let calls = 0, successes = 0, failures = 0, receiptsPosted = 0, receiptsFailed = 0;

  // Use cwd (sdk/) which exists in CI, plus its parent (repo root)
  const repoRoot = path.resolve(process.cwd(), "..");
  const sdkDir = process.cwd();

  // read_file — 2 files known to exist
  const filesToRead = [
    path.join(repoRoot, "README.md"),
    path.join(sdkDir, "package.json"),
  ];
  for (const filePath of filesToRead) {
    const args = { path: filePath };
    const { ok, result, latencyMs } = await callTool(client, "read_file", args);
    calls++;
    if (ok) successes++; else failures++;
    const post = await postReceipt({ agentKp, callerKp, toolName: "read_file", taskInput: args, result, success: ok, latencyMs });
    post.ok ? receiptsPosted++ : receiptsFailed++;
    process.stdout.write(ok ? "." : "x");
  }

  // list_directory — 2 directories
  const dirsToList = [sdkDir, repoRoot];
  for (const dirPath of dirsToList) {
    const args = { path: dirPath };
    const { ok, result, latencyMs } = await callTool(client, "list_directory", args);
    calls++;
    if (ok) successes++; else failures++;
    const post = await postReceipt({ agentKp, callerKp, toolName: "list_directory", taskInput: args, result, success: ok, latencyMs });
    post.ok ? receiptsPosted++ : receiptsFailed++;
    process.stdout.write(ok ? "." : "x");
  }

  return { calls, successes, failures, receiptsPosted, receiptsFailed };
}

async function runEverything(
  client: Client,
  agentKp: KeyPair,
  callerKp: KeyPair
): Promise<{ calls: number; successes: number; failures: number; receiptsPosted: number; receiptsFailed: number }> {
  let calls = 0, successes = 0, failures = 0, receiptsPosted = 0, receiptsFailed = 0;

  // echo — 2 calls
  for (const message of ["hello from XAIP", "trust score test"]) {
    const args = { message };
    const { ok, result, latencyMs } = await callTool(client, "echo", args);
    calls++;
    if (ok) successes++; else failures++;
    const post = await postReceipt({ agentKp, callerKp, toolName: "echo", taskInput: args, result, success: ok, latencyMs });
    post.ok ? receiptsPosted++ : receiptsFailed++;
    process.stdout.write(ok ? "." : "x");
  }

  // get-sum — 2 calls
  for (const [a, b] of [[2, 3], [100, 234]] as [number, number][]) {
    const args = { a, b };
    const { ok, result, latencyMs } = await callTool(client, "get-sum", args);
    calls++;
    if (ok) successes++; else failures++;
    const post = await postReceipt({ agentKp, callerKp, toolName: "get-sum", taskInput: args, result, success: ok, latencyMs });
    post.ok ? receiptsPosted++ : receiptsFailed++;
    process.stdout.write(ok ? "." : "x");
  }

  // get-tiny-image — 1 call
  {
    const args = {};
    const { ok, result, latencyMs } = await callTool(client, "get-tiny-image", args);
    calls++;
    if (ok) successes++; else failures++;
    const post = await postReceipt({ agentKp, callerKp, toolName: "get-tiny-image", taskInput: args, result, success: ok, latencyMs });
    post.ok ? receiptsPosted++ : receiptsFailed++;
    process.stdout.write(ok ? "." : "x");
  }

  return { calls, successes, failures, receiptsPosted, receiptsFailed };
}

async function runFetch(
  client: Client,
  agentKp: KeyPair,
  callerKp: KeyPair
): Promise<{ calls: number; successes: number; failures: number; receiptsPosted: number; receiptsFailed: number }> {
  let calls = 0, successes = 0, failures = 0, receiptsPosted = 0, receiptsFailed = 0;

  // get_raw_text — JSON/text endpoints
  for (const url of [
    "https://xaip-trust-api.kuma-github.workers.dev/health",
    "https://jsonplaceholder.typicode.com/posts/1",
  ]) {
    const args = { url };
    const { ok, result, latencyMs } = await callTool(client, "get_raw_text", args);
    calls++;
    if (ok) successes++; else failures++;
    const post = await postReceipt({ agentKp, callerKp, toolName: "get_raw_text", taskInput: args, result, success: ok, latencyMs });
    post.ok ? receiptsPosted++ : receiptsFailed++;
    process.stdout.write(ok ? "." : "x");
  }

  // get_markdown — HTML pages
  for (const url of [
    "https://example.com",
    "https://github.com/xkumakichi/xaip-protocol",
  ]) {
    const args = { url };
    const { ok, result, latencyMs } = await callTool(client, "get_markdown", args);
    calls++;
    if (ok) successes++; else failures++;
    const post = await postReceipt({ agentKp, callerKp, toolName: "get_markdown", taskInput: args, result, success: ok, latencyMs });
    post.ok ? receiptsPosted++ : receiptsFailed++;
    process.stdout.write(ok ? "." : "x");
  }

  return { calls, successes, failures, receiptsPosted, receiptsFailed };
}

// ─── Server Definitions ───────────────────────────────────────────────────────

interface ServerDef {
  slug: string;
  args: string[];
  env?: Record<string, string>;
  run: (client: Client, agentKp: KeyPair, callerKp: KeyPair) => Promise<{
    calls: number; successes: number; failures: number;
    receiptsPosted: number; receiptsFailed: number;
  }>;
}

function getServers(): ServerDef[] {
  const repoRoot = path.resolve(process.cwd(), "..");
  return [
    {
      slug: "context7",
      args: ["-y", "@upstash/context7-mcp"],
      run: runContext7,
    },
    {
      slug: "sequential-thinking",
      args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
      run: runSequentialThinking,
    },
    {
      slug: "memory",
      args: ["-y", "@modelcontextprotocol/server-memory"],
      run: runMemory,
    },
    {
      slug: "filesystem",
      args: ["-y", "@modelcontextprotocol/server-filesystem", repoRoot],
      run: runFilesystem,
    },
    {
      slug: "everything",
      args: ["-y", "@modelcontextprotocol/server-everything"],
      run: runEverything,
    },
    {
      slug: "fetch",
      args: ["-y", "mcp-server-fetch-typescript"],
      run: runFetch,
    },
  ];
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("XAIP Auto-Collection Script");
  console.log(`Target: ${AGGREGATOR_URL}`);
  console.log(`Platform: ${process.platform}, NPX: ${NPX}`);
  console.log("");

  // Health check
  try {
    const r = await fetch(`${AGGREGATOR_URL}/health`);
    const health = await r.json() as Record<string, unknown>;
    console.log("Aggregator health:", JSON.stringify(health));
  } catch (err) {
    console.error(`ERROR: Aggregator not reachable: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  console.log("");

  // Keys — load persisted keys (locally) or generate fresh (CI)
  const keys = loadKeys();
  const callerKp = ensureCallerKey(keys);
  // Save caller key (no-op in CI since ~/.xaip won't persist, but safe to call)
  try { saveKeys(keys); } catch { /* ignore in restricted envs */ }
  console.log(`Caller DID: ${callerKp.did.slice(0, 32)}...`);
  console.log("");

  const servers = getServers();
  const results: ServerResult[] = [];

  for (const server of servers) {
    console.log(`── ${server.slug} ────────────────────────────────`);
    const agentKp = ensureAgentKey(keys, server.slug);
    console.log(`Agent DID: ${agentKp.did}`);
    process.stdout.write("  ");

    let serverResult: ServerResult = {
      slug: server.slug,
      callsMade: 0,
      successes: 0,
      failures: 0,
      receiptsPosted: 0,
      receiptsFailed: 0,
    };

    const conn = await connectMcp(server.args, server.env);
    if (!conn.ok) {
      console.log(`\n  SKIP: failed to connect — ${conn.error}`);
      results.push(serverResult);
      console.log("");
      continue;
    }

    const { client } = conn;

    try {
      const r = await server.run(client, agentKp, callerKp);
      serverResult = {
        slug: server.slug,
        callsMade: r.calls,
        successes: r.successes,
        failures: r.failures,
        receiptsPosted: r.receiptsPosted,
        receiptsFailed: r.receiptsFailed,
      };
    } catch (err) {
      console.log(`\n  ERROR during run: ${err instanceof Error ? err.message : String(err)}`);
    }

    await closeMcp(client);
    console.log("");
    console.log(
      `  Done: ${serverResult.callsMade} calls, ` +
      `${serverResult.successes} success, ${serverResult.failures} fail | ` +
      `${serverResult.receiptsPosted} receipts posted, ${serverResult.receiptsFailed} failed`
    );
    results.push(serverResult);
    console.log("");
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const totalCalls    = results.reduce((s, r) => s + r.callsMade, 0);
  const totalSuccess  = results.reduce((s, r) => s + r.successes, 0);
  const totalFailures = results.reduce((s, r) => s + r.failures, 0);
  const totalPosted   = results.reduce((s, r) => s + r.receiptsPosted, 0);
  const totalPFailed  = results.reduce((s, r) => s + r.receiptsFailed, 0);

  console.log("══════════════════════════════════════════════");
  console.log("Summary");
  console.log("══════════════════════════════════════════════");
  console.log(`${"Server".padEnd(22)} ${"Calls".padStart(5)} ${"Succ".padStart(5)} ${"Fail".padStart(5)} ${"Posted".padStart(7)}`);
  console.log("─".repeat(52));
  for (const r of results) {
    const rate = r.callsMade > 0
      ? ((r.successes / r.callsMade) * 100).toFixed(0) + "%"
      : "N/A";
    console.log(
      `${r.slug.padEnd(22)} ` +
      `${String(r.callsMade).padStart(5)} ` +
      `${String(r.successes).padStart(5)} ` +
      `${String(r.failures).padStart(5)} ` +
      `${String(r.receiptsPosted).padStart(7)}` +
      `  (${rate})`
    );
  }
  console.log("─".repeat(52));
  console.log(
    `${"TOTAL".padEnd(22)} ` +
    `${String(totalCalls).padStart(5)} ` +
    `${String(totalSuccess).padStart(5)} ` +
    `${String(totalFailures).padStart(5)} ` +
    `${String(totalPosted).padStart(7)}`
  );
  if (totalPFailed > 0) {
    console.log(`  (${totalPFailed} receipt POST failures)`);
  }

  // ── Verify scores via Trust API ───────────────────────────────────────────
  const slugsWithReceipts = results.filter(r => r.receiptsPosted > 0).map(r => r.slug);
  if (slugsWithReceipts.length > 0) {
    const TRUST_API = "https://xaip-trust-api.kuma-github.workers.dev";
    console.log(`\nUpdated trust scores (${TRUST_API}):`);
    try {
      const url = `${TRUST_API}/v1/trust?slugs=${slugsWithReceipts.join(",")}`;
      const res = await fetch(url);
      const data = await res.json() as { results?: Array<{ slug: string; trust: number | null; receipts: number; verdict: string }> };
      const rows = data.results ?? [];
      for (const info of rows) {
        const bar = info.trust != null ? "█".repeat(Math.round(info.trust * 20)) : "";
        console.log(
          `  ${info.slug.padEnd(22)} ${info.verdict.padEnd(8)} trust=${info.trust?.toFixed(3) ?? "N/A"} n=${info.receipts} ${bar}`
        );
      }
    } catch (err) {
      console.log(`  (trust query failed: ${err instanceof Error ? err.message : String(err)})`);
    }
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
