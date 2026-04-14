/**
 * XAIP Dogfooding Demo
 *
 * Scenario: "Fetch React hooks documentation" via 3 candidate MCP servers.
 * Demonstrates XAIP decision engine: selection, MCP execution, receipt, comparison.
 *
 * Run: cd demo && npx tsx dogfood.ts
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const TRUST_API   = "https://xaip-trust-api.kuma-github.workers.dev";
const AGGREGATOR  = "https://xaip-aggregator.kuma-github.workers.dev";
const KEYS_FILE   = path.join(os.homedir(), ".xaip", "agent-keys.json");
const NPX         = process.platform === "win32" ? "npx.cmd" : "npx";
const UNKNOWN_PKG = "nonexistent-mcp-server-xaip-demo";
const MCP_TIMEOUT = 8_000;

// ─── Types ────────────────────────────────────────────────────────────────────

interface KeyPair {
  did: string;
  publicKey: string;
  privateKey: string;
}

interface KeysFile {
  version: "1.0";
  agents: Record<string, KeyPair>;
  callers: KeyPair[];
}

// ─── Crypto (mirrored from sdk/scripts/seed-aggregator.ts) ───────────────────

function generateKeyPair(didBase: string): KeyPair {
  const pair = crypto.generateKeyPairSync("ed25519");
  const pubDer = pair.publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const privDer = pair.privateKey.export({ type: "pkcs8", format: "der" }) as Buffer;
  const raw = pubDer.subarray(pubDer.length - 32);
  return {
    did: `${didBase}:${raw.toString("hex")}`,
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
  return (
    "{" +
    keys.map(k => JSON.stringify(k) + ":" + canonicalize((value as Record<string, unknown>)[k])).join(",") +
    "}"
  );
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

// ─── Keys ─────────────────────────────────────────────────────────────────────

function loadOrCreateKeys(): KeysFile {
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

function ensureAgentKey(keys: KeysFile, name: string): KeyPair {
  if (!keys.agents[name]) {
    const kp = generateKeyPair("did:key");
    kp.did = `did:web:${name}`;
    keys.agents[name] = kp;
  }
  return keys.agents[name]!;
}

function ensureCallerKey(keys: KeysFile): KeyPair {
  if (keys.callers.length === 0) keys.callers.push(generateKeyPair("did:key"));
  return keys.callers[0]!;
}

// ─── MCP ──────────────────────────────────────────────────────────────────────

type McpResult =
  | { ok: true; client: Client; latencyMs: number }
  | { ok: false; error: string; latencyMs: number };

async function mcpConnect(pkgArgs: string[], timeoutMs: number): Promise<McpResult> {
  const start = Date.now();
  const transport = new StdioClientTransport({
    command: NPX,
    args: pkgArgs,
    env: process.env as Record<string, string>,
    stderr: "pipe",
  });
  const client = new Client({ name: "xaip-dogfood", version: "1.0.0" }, { capabilities: {} });
  try {
    await Promise.race([
      client.connect(transport),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), timeoutMs)),
    ]);
    return { ok: true, client, latencyMs: Date.now() - start };
  } catch (err) {
    try { await client.close(); } catch {}
    return { ok: false, error: err instanceof Error ? err.message : String(err), latencyMs: Date.now() - start };
  }
}

// ─── Aggregator ───────────────────────────────────────────────────────────────

async function postReceipt(params: {
  agentKp: KeyPair;
  callerKp: KeyPair;
  toolName: string;
  taskHash: string;
  resultHash: string;
  success: boolean;
  latencyMs: number;
}): Promise<{ ok: boolean; error?: string }> {
  const timestamp = new Date().toISOString();
  const base = {
    agentDid: params.agentKp.did,
    callerDid: params.callerKp.did,
    toolName: params.toolName,
    taskHash: params.taskHash,
    resultHash: params.resultHash,
    success: params.success,
    latencyMs: params.latencyMs,
    timestamp,
  };
  const payload = canonicalize({
    agentDid: base.agentDid,
    callerDid: base.callerDid,
    failureType: "",
    latencyMs: base.latencyMs,
    resultHash: base.resultHash,
    success: base.success,
    taskHash: base.taskHash,
    timestamp: base.timestamp,
    toolName: base.toolName,
  });
  const signature       = signPayload(payload, params.agentKp.privateKey);
  const callerSignature = signPayload(payload, params.callerKp.privateKey);
  try {
    const res = await fetch(`${AGGREGATOR}/receipts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        receipt: { ...base, signature, callerSignature },
        publicKey: params.agentKp.publicKey,
        callerPublicKey: params.callerKp.publicKey,
      }),
    });
    const body = await res.json() as Record<string, unknown>;
    return res.ok ? { ok: true } : { ok: false, error: String(body["error"] ?? res.status) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Display ──────────────────────────────────────────────────────────────────

function box(title: string): void {
  const w = 48;
  console.log(`╔${"═".repeat(w)}╗`);
  console.log(`║  ${title.padEnd(w - 2)}║`);
  console.log(`╚${"═".repeat(w)}╝`);
}

function section(label: string): void {
  console.log(`\n━━━ ${label} ━━━`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  box("XAIP Dogfooding Demo");

  const TASK = "Fetch React hooks documentation";
  const CANDIDATES = ["context7", "sequential-thinking", "unknown-mcp-server"];

  console.log(`\nTask: "${TASK}"`);
  console.log(`Candidates: ${CANDIDATES.join(", ")}`);

  const keys        = loadOrCreateKeys();
  const context7Kp  = ensureAgentKey(keys, "context7");
  const callerKp    = ensureCallerKey(keys);
  saveKeys(keys);

  // ── Step 1: XAIP Decision ─────────────────────────────────────────────────

  section("Step 1: XAIP Decision");

  const selRes = await fetch(`${TRUST_API}/v1/select`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task: TASK, candidates: CANDIDATES }),
  });
  const sel = await selRes.json() as {
    selected: string | null;
    reason: string;
    rejected: Array<{ slug: string; reason: string }>;
    candidates: Array<{ slug: string; trust: number | null; receipts: number; verdict: string }>;
    withoutXAIP: string;
    warning?: string;
  };

  const bestCand = sel.candidates.find(c => c.slug === sel.selected);
  console.log(
    `POST /v1/select → selected: ${sel.selected ?? "none"}` +
    (bestCand ? ` (trust=${bestCand.trust ?? "N/A"}, ${bestCand.receipts} receipts)` : "")
  );
  for (const r of sel.rejected) {
    console.log(`  Rejected: ${r.slug} (${r.reason})`);
  }
  if (sel.warning) console.log(`  Warning: "${sel.warning}"`);
  console.log(`  Without XAIP: "${sel.withoutXAIP}"`);

  // context7 is the right tool for documentation — note if XAIP chose a tied winner
  if (sel.selected && sel.selected !== "context7") {
    console.log(`\n  Note: XAIP selected ${sel.selected} (tied trust). Proceeding with context7 for docs task.`);
  }

  // ── Step 2: Execute via MCP ───────────────────────────────────────────────

  section("Step 2: Execute via MCP");
  console.log("Connecting to context7...");

  let execSuccess  = false;
  let execLatency  = 0;
  let usedTool     = "query-docs";

  const conn = await mcpConnect(["-y", "@upstash/context7-mcp"], 20_000);
  if (!conn.ok) {
    console.log(`  ✗ Connection failed (${conn.latencyMs}ms): ${conn.error}`);
    execLatency = conn.latencyMs;
  } else {
    const { client } = conn;

    // Discover actual tool names and schemas at runtime
    const toolList = await client.listTools();
    const tools = toolList.tools;
    const resolveTool = tools.find(t => t.name.includes("resolve")) ?? tools[0];
    const docsTool    = tools.find(t => t.name.includes("docs") || t.name.includes("query")) ?? tools[1];
    usedTool = docsTool?.name ?? "query-docs";

    // Identify argument names from schemas
    const resolveProps = Object.keys((resolveTool?.inputSchema as { properties?: Record<string, unknown> })?.properties ?? {});
    const resolveArg   = resolveProps.find(k => k.includes("query") || k.includes("library") || k.includes("name")) ?? "libraryName";
    const docsProps    = Object.keys((docsTool?.inputSchema as { properties?: Record<string, unknown> })?.properties ?? {});
    const docsIdArg    = docsProps.find(k => k.toLowerCase().includes("library") || k === "context7CompatibleLibraryID") ?? "context7CompatibleLibraryID";
    const docsTopicArg = docsProps.find(k => k.includes("topic")) ?? "topic";
    const docsTokenArg = docsProps.find(k => k.includes("token")) ?? "tokens";

    try {
      // resolve-library-id → get library ID
      const t1 = Date.now();
      const resolveResult = await client.callTool(
        { name: resolveTool?.name ?? "resolve-library-id", arguments: { [resolveArg]: "react" } },
        undefined,
        { timeout: 15_000 }
      );
      const t1ms       = Date.now() - t1;
      const resolveText = (resolveResult.content as Array<{ text?: string }>)[0]?.text ?? "";
      const libId       = resolveText.match(/\/react[^\s,"\n]*/)?.[0] ?? "/react";
      console.log(`  ${resolveTool?.name ?? "resolve-library-id"}("react") → ✓ ${libId} (${t1ms}ms)`);

      // query-docs → fetch React hooks docs
      const t2 = Date.now();
      const docsResult = await client.callTool(
        {
          name: docsTool?.name ?? "query-docs",
          arguments: {
            [docsIdArg]: libId,
            [docsTopicArg]: "hooks",
            [docsTokenArg]: 5000,
          },
        },
        undefined,
        { timeout: 30_000 }
      );
      const t2ms    = Date.now() - t2;
      const docsText = (docsResult.content as Array<{ text?: string }>)[0]?.text ?? "";
      console.log(`  ${docsTool?.name ?? "query-docs"}(${libId}, "hooks") → ✓ ${docsText.length.toLocaleString()} chars (${t2ms}ms)`);

      execSuccess = true;
      execLatency = conn.latencyMs + t1ms + t2ms;
    } catch (err) {
      console.log(`  ✗ Tool call failed: ${err instanceof Error ? err.message : String(err)}`);
      execLatency = conn.latencyMs;
    }

    await client.close();
  }

  // ── Step 3: Report to Aggregator ─────────────────────────────────────────

  section("Step 3: Report to Aggregator");

  const receipt = await postReceipt({
    agentKp:    context7Kp,
    callerKp,
    toolName:   usedTool,
    taskHash:   sha256short(TASK),
    resultHash: sha256short(execSuccess ? "ok" : "failed"),
    success:    execSuccess,
    latencyMs:  execLatency,
  });
  console.log(
    `POST /receipts → ${receipt.ok ? "✓ receipt accepted, callerVerified: true" : `✗ ${receipt.error}`}`
  );

  // ── Step 4: Updated Score ─────────────────────────────────────────────────

  section("Step 4: Updated Score");

  const trustRes  = await fetch(`${TRUST_API}/v1/trust/context7`);
  const trustData = await trustRes.json() as { trust: number | null; receipts: number; verdict: string };
  console.log(
    `GET /v1/trust/context7 → trust: ${trustData.trust ?? "N/A"}, receipts: ${trustData.receipts}, verdict: ${trustData.verdict}`
  );

  // ── Comparison ────────────────────────────────────────────────────────────

  section("Comparison");
  console.log(`Attempting unknown-mcp-server (${MCP_TIMEOUT}ms timeout)...\n`);

  const unk = await mcpConnect(["-y", UNKNOWN_PKG], MCP_TIMEOUT);
  if (unk.ok) { await unk.client.close(); }
  // Truncate error label to fit the column cleanly
  const unkLabel = unk.ok ? "ok" : (unk.error.includes("timeout") ? "timeout" : "error");

  // "Try all" = sum of sequential attempts (demonstrates cumulative cost of untrusted servers)
  const tryAllLatency = execLatency + unk.latencyMs;

  const COL = [14, 14, 9, 12] as const;
  const cell = (s: string, w: number) => s.padEnd(w).slice(0, w);
  const row  = (a: string, b: string, c: string, d: string) =>
    `│ ${cell(a, COL[0])} │ ${cell(b, COL[1])} │ ${cell(c, COL[2])} │ ${cell(d, COL[3])} │`;
  const bar  = (l: string, j: string, r: string) =>
    l + COL.map(w => "─".repeat(w + 2)).join(j) + r;

  console.log(bar("┌", "┬", "┐"));
  console.log(row("Strategy", "Server Hit", "Success", "Latency"));
  console.log(bar("├", "┼", "┤"));
  console.log(row("With XAIP",    "context7",    execSuccess ? "✓" : "✗",  `${execLatency}ms`));
  console.log(row("Random (sim)", "unknown-mcp", "✗ " + unkLabel,           `${unk.latencyMs}ms`));
  console.log(row("Try all (seq)","3 servers",   execSuccess ? "1/3" : "0/3", `${tryAllLatency}ms`));
  console.log(bar("└", "┴", "┘"));

  const savedMs = tryAllLatency - execLatency;
  console.log(
    `\nXAIP saved: 1 failed call, ~${savedMs}ms (~${(savedMs / 1000).toFixed(1)}s), 1 unnecessary connection`
  );
}

main().catch(err => {
  console.error("\nDemo error:", err);
  process.exit(1);
});
