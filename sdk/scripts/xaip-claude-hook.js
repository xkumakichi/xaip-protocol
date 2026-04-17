#!/usr/bin/env node
/**
 * xaip-claude-hook
 *
 * Claude Code hook that emits signed XAIP receipts for every MCP tool call.
 * Reads the hook JSON payload from stdin, extracts server/tool/input/output,
 * signs with Ed25519 caller + agent keys (persisted in ~/.xaip/hook-keys.json),
 * and POSTs to the XAIP Aggregator.
 *
 * Install:
 *   .claude/settings.json → hooks.PreToolUse + PostToolUse with matcher "mcp__.*"
 *
 * Zero npm dependencies. Runs on Node >= 18 (uses global fetch).
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const AGGREGATOR_URL =
  process.env.XAIP_AGGREGATOR_URL ||
  "https://xaip-aggregator.kuma-github.workers.dev";

const XAIP_DIR = path.join(os.homedir(), ".xaip");
const KEY_FILE = path.join(XAIP_DIR, "hook-keys.json");
const PENDING_DIR = path.join(XAIP_DIR, "pending");
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
  // Normalize Claude Code plugin-namespaced names:
  // "plugin_context7_context7" → "context7"
  const pluginMatch = server.match(/^plugin_[^_]+_(.+)$/);
  if (pluginMatch) server = pluginMatch[1];
  return { server, tool };
}

function inferSuccess(toolResponse) {
  if (!Array.isArray(toolResponse)) return true;
  for (const block of toolResponse) {
    if (block && block.type === "text" && typeof block.text === "string") {
      const t = block.text.trim().toLowerCase();
      if (t.startsWith("error:") || t.startsWith("error ")) return false;
      if (t.includes('"iserror":true') || t.includes("'iserror': true"))
        return false;
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
