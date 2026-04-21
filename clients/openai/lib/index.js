"use strict";
/**
 * xaip-openai — XAIP wrapper for OpenAI tool calling.
 *
 * OpenAI's chat completion returns tool_calls; the developer executes each
 * one locally. This module wraps that execution so every call produces an
 * Ed25519-signed XAIP receipt posted to the aggregator.
 *
 * Two entry points:
 *   - runWithXAIP({ toolName, input, run })   — wrap a single tool execution
 *   - executeToolCalls(toolCalls, toolMap)    — wrap the whole tool-call loop,
 *                                               returns OpenAI "tool" messages
 *                                               ready to append to the thread
 *
 * Zero npm dependencies. Requires Node >= 18.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const DEFAULT_AGGREGATOR_URL = "https://xaip-aggregator.kuma-github.workers.dev";
const XAIP_DIR = path.join(os.homedir(), ".xaip");
const KEY_FILE = path.join(XAIP_DIR, "openai-keys.json");
const LOG_FILE = path.join(XAIP_DIR, "openai.log");

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

function ensureAgent(keys, toolName) {
  if (!keys.agents[toolName]) {
    const kp = generateKeyPair("did:key");
    kp.did = `did:web:oai-${slugify(toolName)}`;
    keys.agents[toolName] = kp;
    saveKeys(keys);
  }
  return keys.agents[toolName];
}

function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
    keys.map((k) => JSON.stringify(k) + ":" + canonicalize(value[k])).join(",") +
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

function inferFailureType(err) {
  if (!err) return "";
  const msg = (err && (err.message || String(err))).toLowerCase();
  if (msg.includes("timeout") || msg.includes("timed out")) return "timeout";
  if (msg.includes("rate") && msg.includes("limit")) return "rate_limit";
  if (msg.includes("unauthorized") || msg.includes("forbidden")) return "auth";
  if (msg.includes("valid") || msg.includes("schema") || msg.includes("parse")) return "validation";
  return "tool_error";
}

async function postReceipt({ toolName, input, output, success, err, start, classHint, aggregatorUrl }) {
  const keys = loadKeys();
  const caller = ensureCaller(keys);
  const agent = ensureAgent(keys, toolName);
  const latencyMs = Date.now() - start;
  const failureType = success ? "" : inferFailureType(err);
  const timestamp = new Date().toISOString();
  const taskHash = sha256short(JSON.stringify(input));
  const resultHash = sha256short(JSON.stringify(output));

  const base = {
    agentDid: agent.did,
    callerDid: caller.did,
    toolName,
    taskHash,
    resultHash,
    success,
    latencyMs,
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

  const body = {
    receipt: { ...base, signature, callerSignature },
    publicKey: agent.publicKey,
    callerPublicKey: caller.publicKey,
  };

  if (classHint) body.toolMetadata = { xaip: { class: classHint } };

  try {
    const res = await fetch(`${aggregatorUrl}/receipts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    log(`POST ${toolName} ok=${success} lat=${latencyMs}ms → ${res.status} ${text.slice(0, 120)}`);
  } catch (e) {
    log(`POST error (${toolName}): ${e.message}`);
  }
}

function resolveAggregatorUrl(opts) {
  return (
    (opts && opts.aggregatorUrl) ||
    process.env.XAIP_AGGREGATOR_URL ||
    DEFAULT_AGGREGATOR_URL
  );
}

function isDisabled(opts) {
  return (opts && opts.disabled === true) || process.env.XAIP_DISABLED === "1";
}

/**
 * Wrap a single tool execution with an XAIP receipt.
 *
 * @param {object}  params
 * @param {string}  params.toolName
 * @param {unknown} params.input               The parsed arguments object.
 * @param {() => any | Promise<any>} params.run Executes the tool, returns output.
 * @param {string}  [params.classHint]         Optional XAIP v0.5 class hint.
 * @param {string}  [params.aggregatorUrl]
 * @param {boolean} [params.disabled]
 * @returns {Promise<any>} The tool's output (propagated). Errors are re-thrown
 *                         AFTER a failure receipt is emitted.
 */
async function runWithXAIP(params) {
  const { toolName, input, run, classHint } = params;
  const aggregatorUrl = resolveAggregatorUrl(params);
  if (isDisabled(params)) return run();
  const start = Date.now();
  try {
    const output = await run();
    // Fire-and-forget the receipt so tool latency isn't charged to the user path.
    postReceipt({ toolName, input, output, success: true, err: null, start, classHint, aggregatorUrl });
    return output;
  } catch (err) {
    postReceipt({
      toolName,
      input,
      output: String(err && err.message ? err.message : err),
      success: false,
      err,
      start,
      classHint,
      aggregatorUrl,
    });
    throw err;
  }
}

/**
 * Execute an entire OpenAI tool-call loop and return the "tool" messages
 * ready to append to your chat history.
 *
 * @param {Array<{ id: string, type: "function", function: { name: string, arguments: string } }>} toolCalls
 * @param {Record<string, (args: any) => any | Promise<any>>} toolMap
 * @param {object} [opts]
 * @param {string} [opts.aggregatorUrl]
 * @param {boolean} [opts.disabled]
 * @param {(toolName: string) => string | null | undefined} [opts.classifyTool]
 * @returns {Promise<Array<{ role: "tool", tool_call_id: string, content: string }>>}
 */
async function executeToolCalls(toolCalls, toolMap, opts) {
  const o = opts || {};
  const results = [];
  for (const call of toolCalls || []) {
    if (!call || !call.function) continue;
    const name = call.function.name;
    const fn = toolMap && toolMap[name];
    let args = {};
    try {
      args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
    } catch (_) {
      args = { _raw: call.function.arguments };
    }

    let content;
    if (typeof fn !== "function") {
      content = JSON.stringify({ error: `No tool registered: ${name}` });
    } else {
      try {
        const output = await runWithXAIP({
          toolName: name,
          input: args,
          run: () => fn(args),
          classHint: o.classifyTool ? o.classifyTool(name) : undefined,
          aggregatorUrl: o.aggregatorUrl,
          disabled: o.disabled,
        });
        content = typeof output === "string" ? output : JSON.stringify(output);
      } catch (err) {
        content = JSON.stringify({
          error: (err && err.message) || String(err),
        });
      }
    }

    results.push({
      role: "tool",
      tool_call_id: call.id,
      content,
    });
  }
  return results;
}

module.exports = { runWithXAIP, executeToolCalls };
module.exports.default = { runWithXAIP, executeToolCalls };
