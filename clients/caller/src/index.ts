/**
 * xaip-caller — zero-install CLI for contributing to the XAIP trust graph.
 *
 * Run: npx xaip-caller
 *
 * The package makes real HTTP calls to a small set of stable public endpoints,
 * signs XAIP execution receipts for each call, and POSTs them to the live
 * aggregator. It demonstrates that XAIP works beyond MCP: any HTTP tool call
 * can participate in the trust graph.
 *
 * Zero runtime dependencies. Uses only Node built-ins (fetch, crypto, fs, os).
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const AGGREGATOR_URL =
  process.env.AGGREGATOR_URL ??
  "https://xaip-aggregator.kuma-github.workers.dev";

const KEYS_FILE =
  process.env.XAIP_CALLER_KEYS_FILE ??
  path.join(os.homedir(), ".xaip", "caller-keys.json");

const CALL_TIMEOUT_MS = 10_000;

interface KeyPair {
  did: string;
  publicKey: string; // SPKI hex
  privateKey: string; // PKCS8 hex
}

interface KeysFile {
  version: "1.0";
  caller: KeyPair;
  agents: Record<string, KeyPair>;
}

// ─── Crypto ───────────────────────────────────────────────────────────────────

function generateKeyPair(didBase: string): KeyPair {
  const pair = crypto.generateKeyPairSync("ed25519");
  const pubDer = pair.publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const privDer = pair.privateKey.export({
    type: "pkcs8",
    format: "der",
  }) as Buffer;
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

function sha256short(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 16);
}

// ─── Key management ───────────────────────────────────────────────────────────

function loadKeys(): KeysFile {
  if (fs.existsSync(KEYS_FILE)) {
    const raw = fs.readFileSync(KEYS_FILE, "utf8");
    return JSON.parse(raw) as KeysFile;
  }
  const caller = generateKeyPair("did:key");
  const keys: KeysFile = { version: "1.0", caller, agents: {} };
  saveKeys(keys);
  return keys;
}

function saveKeys(keys: KeysFile): void {
  const dir = path.dirname(KEYS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2));
}

function ensureAgentKey(keys: KeysFile, hostname: string): KeyPair {
  if (!keys.agents[hostname]) {
    const kp = generateKeyPair("did:key");
    // Stable DID keyed to hostname so any caller using this package converges
    // on the same did:web per hostname.
    kp.did = `did:web:${hostname}`;
    keys.agents[hostname] = kp;
    saveKeys(keys);
  }
  return keys.agents[hostname]!;
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function timedFetch(
  url: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; body: string; latencyMs: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  const start = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const body = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      body,
      latencyMs: Date.now() - start,
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      body: e instanceof Error ? e.message : String(e),
      latencyMs: Date.now() - start,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Receipt posting ──────────────────────────────────────────────────────────

async function postReceipt(params: {
  agentKp: KeyPair;
  callerKp: KeyPair;
  toolName: string;
  taskInput: unknown;
  result: unknown;
  success: boolean;
  latencyMs: number;
}): Promise<{ ok: boolean; error?: string }> {
  const base = {
    agentDid: params.agentKp.did,
    callerDid: params.callerKp.did,
    failureType: "",
    latencyMs: params.latencyMs,
    resultHash: sha256short(JSON.stringify(params.result)),
    success: params.success,
    taskHash: sha256short(JSON.stringify(params.taskInput)),
    timestamp: new Date().toISOString(),
    toolName: params.toolName,
  };
  const payload = canonicalize(base);
  const signature = signPayload(payload, params.agentKp.privateKey);
  const callerSignature = signPayload(payload, params.callerKp.privateKey);

  const body = {
    receipt: { ...base, signature, callerSignature },
    publicKey: params.agentKp.publicKey,
    callerPublicKey: params.callerKp.publicKey,
  };

  try {
    const res = await fetch(`${AGGREGATOR_URL}/receipts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `${res.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ─── Tool mix ─────────────────────────────────────────────────────────────────

interface ToolCall {
  hostname: string;
  toolName: string;
  run: () => Promise<{
    success: boolean;
    latencyMs: number;
    taskInput: unknown;
    result: unknown;
  }>;
}

const TOOLS: ToolCall[] = [
  {
    hostname: "api.github.com",
    toolName: "zen",
    run: async () => {
      const r = await timedFetch("https://api.github.com/zen", {
        headers: { "User-Agent": "xaip-caller" },
      });
      return {
        success: r.ok && r.body.length > 0,
        latencyMs: r.latencyMs,
        taskInput: { endpoint: "/zen" },
        result: { status: r.status, bodyHash: sha256short(r.body) },
      };
    },
  },
  {
    hostname: "httpbin.org",
    toolName: "uuid",
    run: async () => {
      const r = await timedFetch("https://httpbin.org/uuid");
      return {
        success: r.ok,
        latencyMs: r.latencyMs,
        taskInput: { endpoint: "/uuid" },
        result: { status: r.status, bodyHash: sha256short(r.body) },
      };
    },
  },
  {
    hostname: "httpbin.org",
    toolName: "headers",
    run: async () => {
      const r = await timedFetch("https://httpbin.org/headers", {
        headers: { "X-XAIP-Caller": "1" },
      });
      return {
        success: r.ok,
        latencyMs: r.latencyMs,
        taskInput: { endpoint: "/headers" },
        result: { status: r.status, bodyHash: sha256short(r.body) },
      };
    },
  },
  {
    hostname: "xaip-trust-api.kuma-github.workers.dev",
    toolName: "health",
    run: async () => {
      const r = await timedFetch(
        "https://xaip-trust-api.kuma-github.workers.dev/health"
      );
      return {
        success: r.ok,
        latencyMs: r.latencyMs,
        taskInput: { endpoint: "/health" },
        result: { status: r.status, bodyHash: sha256short(r.body) },
      };
    },
  },
  {
    hostname: "xaip-trust-api.kuma-github.workers.dev",
    toolName: "list_servers",
    run: async () => {
      const r = await timedFetch(
        "https://xaip-trust-api.kuma-github.workers.dev/v1/servers"
      );
      return {
        success: r.ok,
        latencyMs: r.latencyMs,
        taskInput: { endpoint: "/v1/servers" },
        result: { status: r.status, bodyHash: sha256short(r.body) },
      };
    },
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("xaip-caller — contributing to the XAIP trust graph");
  console.log(`Aggregator: ${AGGREGATOR_URL}`);
  console.log("");

  const keys = loadKeys();
  console.log(`Caller DID: ${keys.caller.did.slice(0, 42)}...`);
  console.log(`Keys file:  ${KEYS_FILE}`);
  console.log("");

  let posted = 0;
  let failed = 0;

  for (const tool of TOOLS) {
    process.stdout.write(
      `${tool.hostname.padEnd(48)} ${tool.toolName.padEnd(14)} `
    );
    try {
      const r = await tool.run();
      const agentKp = ensureAgentKey(keys, tool.hostname);
      const post = await postReceipt({
        agentKp,
        callerKp: keys.caller,
        toolName: tool.toolName,
        taskInput: r.taskInput,
        result: r.result,
        success: r.success,
        latencyMs: r.latencyMs,
      });
      if (post.ok) {
        console.log(
          `${r.success ? "ok " : "FAIL"}  ${String(r.latencyMs).padStart(5)}ms  receipt posted`
        );
        posted++;
      } else {
        console.log(
          `${r.success ? "ok " : "FAIL"}  ${String(r.latencyMs).padStart(5)}ms  post failed: ${post.error}`
        );
        failed++;
      }
    } catch (e) {
      console.log(`ERROR ${e instanceof Error ? e.message : String(e)}`);
      failed++;
    }
  }

  console.log("");
  console.log(`Summary: ${posted} receipts posted, ${failed} failed`);
  console.log("");
  console.log(`Your caller DID is part of the trust graph. Check back at`);
  console.log(`  https://xkumakichi.github.io/xaip-protocol/`);
  console.log(`to see how contribution diversity is trending.`);
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
