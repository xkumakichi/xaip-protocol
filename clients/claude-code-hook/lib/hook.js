#!/usr/bin/env node
/**
 * xaip-claude-hook-run
 *
 * Claude Code hook that emits signed XAIP receipts for every MCP tool call.
 * Reads the hook JSON payload from stdin, extracts server/tool/input/output,
 * signs with Ed25519 caller + agent keys (persisted in ~/.xaip/hook-keys.json),
 * and POSTs to the XAIP Aggregator.
 *
 * Invoked by Claude Code via settings.json → hooks.PreToolUse / PostToolUse
 * with matcher "mcp__.*".
 *
 * Zero npm dependencies. Requires Node >= 18 (global fetch).
 *
 * Environment:
 *   XAIP_AGGREGATOR_URL   override Aggregator endpoint (default: live Cloudflare Worker)
 *   XAIP_DISABLED=1       silently no-op (e.g. on CI or offline)
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const AGGREGATOR_URL =
  process.env.XAIP_AGGREGATOR_URL ||
  "https://xaip-aggregator.kuma-github.workers.dev";

const TRUST_API_URL =
  process.env.XAIP_TRUST_API_URL ||
  "https://xaip-trust-api.kuma-github.workers.dev";

const TRUST_WARN_THRESHOLD = Number(process.env.XAIP_TRUST_WARN_THRESHOLD || "0.5");
const TRUST_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const TRUST_FETCH_TIMEOUT_MS = 2000;

const XAIP_DIR = path.join(os.homedir(), ".xaip");
const KEY_FILE = path.join(XAIP_DIR, "hook-keys.json");
const PENDING_DIR = path.join(XAIP_DIR, "pending");
const TRUST_CACHE_DIR = path.join(XAIP_DIR, "trust-cache");
const LOG_FILE = path.join(XAIP_DIR, "hook.log");

function log(msg) {
  try {
    fs.mkdirSync(XAIP_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${msg}\n`);
  } catch (_) {}
}

function generateKeyPair(didBase) {
  const pair = crypto.generateKeyPairSync("ed25519");
  const pubDer = pair.publicKey.export({ type: "spki", format: "der" });
  const privDer = pair.privateKey.export({ type: "pkcs8", format: "der" });
  const raw = pubDer.subarray(pubDer.length - 32);
  const did = `${didBase}:${raw.toString("hex")}`;
  return {
    did,
    publicKey: pubDer.toString("hex"),
    privateKey: privDer.toString("hex"),
  };
}

function loadKeys() {
  try {
    if (fs.existsSync(KEY_FILE)) {
      return JSON.parse(fs.readFileSync(KEY_FILE, "utf8"));
    }
  } catch (e) {
    log(`loadKeys error: ${e.message}`);
  }
  return { version: "1.0", caller: null, agents: {} };
}

function saveKeys(keys) {
  fs.mkdirSync(XAIP_DIR, { recursive: true });
  fs.writeFileSync(KEY_FILE, JSON.stringify(keys, null, 2));
}

function ensureCaller(keys) {
  if (!keys.caller) {
    keys.caller = generateKeyPair("did:key");
    saveKeys(keys);
  }
  return keys.caller;
}

function ensureAgent(keys, serverSlug) {
  if (!keys.agents[serverSlug]) {
    const kp = generateKeyPair("did:key");
    kp.did = `did:web:${serverSlug}`;
    keys.agents[serverSlug] = kp;
    saveKeys(keys);
  }
  return keys.agents[serverSlug];
}

function canonicalize(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!isFinite(value)) throw new Error("JCS: non-finite number");
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  const keys = Object.keys(value).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + canonicalize(value[k]))
      .join(",") +
    "}"
  );
}

function sign(payload, privateKeyHex) {
  const key = crypto.createPrivateKey({
    key: Buffer.from(privateKeyHex, "hex"),
    format: "der",
    type: "pkcs8",
  });
  return crypto.sign(null, Buffer.from(payload), key).toString("hex");
}

function sha256short(v) {
  return crypto.createHash("sha256").update(v).digest("hex").slice(0, 16);
}

function parseMcpTool(toolName) {
  if (!toolName || !toolName.startsWith("mcp__")) return null;
  const rest = toolName.substring(5);
  const idx = rest.indexOf("__");
  if (idx < 0) return null;
  let server = rest.substring(0, idx);
  const tool = rest.substring(idx + 2);
  // Claude Code plugin namespace: "plugin_<plugin>_<server>" → "<server>"
  const pluginMatch = server.match(/^plugin_[^_]+_(.+)$/);
  if (pluginMatch) server = pluginMatch[1];
  return { server, tool };
}

const ERROR_PATTERNS_LOWER = [
  "quota exceeded",
  "rate limit",
  "rate-limit",
  "forbidden",
  "unauthorized",
  "authentication failed",
  "not authorized",
  '"iserror":true',
  '"iserror": true',
];

function inferSuccess(toolResponse) {
  if (!Array.isArray(toolResponse)) return true;
  for (const block of toolResponse) {
    if (block && block.type === "text" && typeof block.text === "string") {
      const t = block.text.trim().toLowerCase();
      if (t.startsWith("error:") || t.startsWith("error ")) return false;
      for (const p of ERROR_PATTERNS_LOWER) {
        if (t.includes(p)) return false;
      }
    }
  }
  return true;
}

function pendingPath(toolUseId) {
  return path.join(PENDING_DIR, `${toolUseId}.json`);
}

async function postReceipt(agent, caller, data) {
  const timestamp = new Date().toISOString();
  const taskHash = sha256short(JSON.stringify(data.input));
  const resultHash = sha256short(JSON.stringify(data.response));
  const failureType = data.success ? "" : "tool_error";

  const base = {
    agentDid: agent.did,
    callerDid: caller.did,
    toolName: data.toolName,
    taskHash,
    resultHash,
    success: data.success,
    latencyMs: data.latencyMs,
    failureType,
    timestamp,
  };

  const payload = canonicalize({
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

  const signature = sign(payload, agent.privateKey);
  const callerSignature = sign(payload, caller.privateKey);

  const body = JSON.stringify({
    receipt: { ...base, signature, callerSignature },
    publicKey: agent.publicKey,
    callerPublicKey: caller.publicKey,
  });

  const res = await fetch(`${AGGREGATOR_URL}/receipts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const text = await res.text();
  return { status: res.status, body: text };
}

function trustCachePath(slug) {
  return path.join(TRUST_CACHE_DIR, `${slug}.json`);
}

function readTrustCache(slug) {
  try {
    const p = trustCachePath(slug);
    if (!fs.existsSync(p)) return null;
    const entry = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!entry || typeof entry.fetchedAt !== "number") return null;
    if (Date.now() - entry.fetchedAt > TRUST_CACHE_TTL_MS) return null;
    return entry.data;
  } catch {
    return null;
  }
}

function writeTrustCache(slug, data) {
  try {
    fs.mkdirSync(TRUST_CACHE_DIR, { recursive: true });
    fs.writeFileSync(
      trustCachePath(slug),
      JSON.stringify({ fetchedAt: Date.now(), data })
    );
  } catch (e) {
    log(`trust cache write error: ${e.message}`);
  }
}

async function fetchTrust(slug) {
  const cached = readTrustCache(slug);
  if (cached) return cached;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TRUST_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${TRUST_API_URL}/v1/trust/${encodeURIComponent(slug)}`, {
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    writeTrustCache(slug, data);
    return data;
  } catch (e) {
    log(`trust fetch error (${slug}): ${e.message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function formatTrustWarning(slug, data) {
  const score = typeof data.trust === "number" ? data.trust : null;
  const verdict = data.verdict || "unknown";
  const receipts =
    typeof data.receipts === "number"
      ? data.receipts
      : typeof data.totalReceipts === "number"
        ? data.totalReceipts
        : null;
  const flags = Array.isArray(data.riskFlags)
    ? data.riskFlags.filter(Boolean)
    : Array.isArray(data.flags)
      ? data.flags.filter(Boolean)
      : [];
  const parts = [];
  parts.push(`⚠ XAIP: "${slug}"`);
  if (score !== null) parts.push(`trust=${score.toFixed(2)}`);
  parts.push(`(${verdict}`);
  if (receipts !== null) parts[parts.length - 1] += `, ${receipts} receipts`;
  parts[parts.length - 1] += ")";
  if (flags.length) parts.push(`Risk: ${flags.join(", ")}`);
  return parts.join(" ");
}

async function maybeWarn(slug) {
  if (process.env.XAIP_WARN_DISABLED === "1") return;
  const data = await fetchTrust(slug);
  if (!data || typeof data.trust !== "number") return;
  if (data.trust >= TRUST_WARN_THRESHOLD) return;
  const msg = formatTrustWarning(slug, data);
  const out = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      systemMessage: msg,
      permissionDecision: "allow",
    },
  };
  process.stdout.write(JSON.stringify(out));
  log(`WARN ${slug} trust=${data.trust} → emitted systemMessage`);
}

async function handlePre(data) {
  const parsed = parseMcpTool(data.tool_name);
  if (!parsed) return;
  fs.mkdirSync(PENDING_DIR, { recursive: true });
  const record = {
    start: Date.now(),
    server: parsed.server,
    tool: parsed.tool,
  };
  fs.writeFileSync(pendingPath(data.tool_use_id), JSON.stringify(record));
  await maybeWarn(parsed.server);
}

async function handlePost(data) {
  const parsed = parseMcpTool(data.tool_name);
  if (!parsed) return;

  let latencyMs = 0;
  const pPath = pendingPath(data.tool_use_id);
  try {
    if (fs.existsSync(pPath)) {
      const p = JSON.parse(fs.readFileSync(pPath, "utf8"));
      latencyMs = Date.now() - p.start;
      fs.unlinkSync(pPath);
    }
  } catch (e) {
    log(`pending read error: ${e.message}`);
  }

  const keys = loadKeys();
  const caller = ensureCaller(keys);
  const agent = ensureAgent(keys, parsed.server);
  const success = inferSuccess(data.tool_response);

  try {
    const result = await postReceipt(agent, caller, {
      toolName: parsed.tool,
      input: data.tool_input,
      response: data.tool_response,
      success,
      latencyMs,
    });
    log(
      `POST ${parsed.server}/${parsed.tool} ok=${success} lat=${latencyMs}ms → ${result.status} ${result.body.slice(0, 120)}`
    );
  } catch (e) {
    log(`POST error: ${e.message}`);
  }
}

async function main() {
  if (process.env.XAIP_DISABLED === "1") return;
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  try {
    const data = JSON.parse(raw);
    if (data.hook_event_name === "PreToolUse") await handlePre(data);
    else if (data.hook_event_name === "PostToolUse") await handlePost(data);
  } catch (e) {
    log(`main error: ${e.message}`);
  }
}

main();
