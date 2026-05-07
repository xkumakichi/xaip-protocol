"use strict";
/**
 * xaip-langchain — XAIP callback handler for LangChain.js.
 *
 * Drop-in: pass an XAIPCallbackHandler instance into runtime callbacks and
 * every tool invocation (handleToolStart / handleToolEnd / handleToolError)
 * produces an Ed25519-signed XAIP receipt that is POSTed to the aggregator.
 *
 * Usage:
 *   const { XAIPCallbackHandler } = require("xaip-langchain");
 *   const handler = new XAIPCallbackHandler();
 *   await agent.invoke(input, { callbacks: [handler] });
 *
 * Zero npm dependencies (LangChain is a peer dep). Requires Node >= 18.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const DEFAULT_AGGREGATOR_URL = "https://xaip-aggregator.kuma-github.workers.dev";

function defaultXaipDir() {
  return path.join(os.homedir(), ".xaip");
}

function getKeyFile() {
  return process.env.XAIP_LANGCHAIN_KEYS_FILE || path.join(defaultXaipDir(), "langchain-keys.json");
}

function getLogFile() {
  return process.env.XAIP_LANGCHAIN_LOG_FILE || path.join(defaultXaipDir(), "langchain.log");
}

function log(msg) {
  try {
    const file = getLogFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${new Date().toISOString()} ${msg}\n`);
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
  const file = getKeyFile();
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    }
  } catch (e) {
    log(`loadKeys error: ${e.message}`);
  }
  return { version: "1.0", caller: null, agents: {} };
}

function saveKeys(keys) {
  const file = getKeyFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(keys, null, 2));
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
    kp.did = `did:web:lc-${slugify(toolName)}`;
    keys.agents[toolName] = kp;
    saveKeys(keys);
  }
  return keys.agents[toolName];
}

function slugify(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
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

/**
 * Resolve a stable string tool name from LangChain's callback arguments.
 *
 * LangChain passes a Serialized form to handleToolStart, where:
 *   tool.id     is the constructor namespace path (e.g. ["langchain", "tools", "DynamicTool"])
 *   tool.kwargs is the constructor kwargs, which usually contains the actual `name`.
 * Some integrations pass an explicit `runName` as the 7th argument instead.
 * Older or test paths may pass a plain object with a `name` string.
 *
 * Order of preference:
 *   runName  > tool.kwargs.name  > tool.name (when string)  > tool.id (when string)  > "unknown_tool"
 */
function resolveToolName(tool, runName) {
  if (typeof runName === "string" && runName) return runName;
  if (tool && typeof tool === "object") {
    if (tool.kwargs && typeof tool.kwargs.name === "string" && tool.kwargs.name) {
      return tool.kwargs.name;
    }
    if (typeof tool.name === "string" && tool.name) return tool.name;
    if (typeof tool.id === "string" && tool.id) return tool.id;
  }
  return "unknown_tool";
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

/**
 * Try to load LangChain's BaseCallbackHandler at construction time.
 * If LangChain is not installed, fall back to a duck-typed base class
 * so the handler is still usable in tests / minimal setups.
 */
function resolveBase() {
  try {
    return require("@langchain/core/callbacks/base").BaseCallbackHandler;
  } catch (_) {
    return class FallbackBase {
      copy() {
        return this;
      }
    };
  }
}

const BaseCallbackHandler = resolveBase();

class XAIPCallbackHandler extends BaseCallbackHandler {
  /**
   * @param {object} [opts]
   * @param {string} [opts.aggregatorUrl]      Override aggregator endpoint.
   * @param {boolean} [opts.disabled]          If true, no receipts are emitted.
   * @param {(toolName: string) => string} [opts.classifyTool]
   *        Optional XAIP class hint per tool ("advisory" | "data-retrieval" |
   *        "computation" | "mutation" | "settlement"). Carried inside
   *        receipts as future-compatible metadata; aggregators that don't
   *        recognize the field ignore it.
   */
  constructor(opts) {
    super();
    const o = opts || {};
    this.name = "XAIPCallbackHandler";
    this.aggregatorUrl =
      o.aggregatorUrl ||
      process.env.XAIP_AGGREGATOR_URL ||
      DEFAULT_AGGREGATOR_URL;
    this.disabled = o.disabled === true || process.env.XAIP_DISABLED === "1";
    this.classifyTool = typeof o.classifyTool === "function" ? o.classifyTool : null;
    this._pending = new Map();
  }

  /** LangChain calls this when cloning the handler for parallel runs. */
  copy() {
    return this;
  }

  async handleToolStart(tool, input, runId, parentRunId, tags, metadata, runName) {
    if (this.disabled) return;
    const toolName = resolveToolName(tool, runName);
    this._pending.set(runId, {
      start: Date.now(),
      toolName,
      input,
    });
  }

  async handleToolEnd(output, runId) {
    if (this.disabled) return;
    const pending = this._pending.get(runId);
    if (!pending) return;
    this._pending.delete(runId);
    await this._emit({
      ...pending,
      output,
      success: true,
      err: null,
    });
  }

  async handleToolError(err, runId) {
    if (this.disabled) return;
    const pending = this._pending.get(runId);
    if (!pending) return;
    this._pending.delete(runId);
    await this._emit({
      ...pending,
      output: String(err && err.message ? err.message : err),
      success: false,
      err,
    });
  }

  async _emit({ toolName, input, output, success, err, start }) {
    try {
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
      if (this.classifyTool) {
        try {
          const cls = this.classifyTool(toolName);
          if (cls) base.toolMetadata = { xaip: { class: cls } };
        } catch (_) {}
      }

      const payloadObject = {
        agentDid: base.agentDid,
        callerDid: base.callerDid,
        failureType: base.failureType,
        latencyMs: base.latencyMs,
        resultHash: base.resultHash,
        success: base.success,
        taskHash: base.taskHash,
        timestamp: base.timestamp,
        toolName: base.toolName,
      };
      if (base.toolMetadata) payloadObject.toolMetadata = base.toolMetadata;
      const payload = canonicalize(payloadObject);

      const signature = sign(payload, agent.privateKey);
      const callerSignature = sign(payload, caller.privateKey);

      const body = {
        receipt: { ...base, signature, callerSignature },
        publicKey: agent.publicKey,
        callerPublicKey: caller.publicKey,
      };

      const res = await fetch(`${this.aggregatorUrl}/receipts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      log(
        `POST ${toolName} ok=${success} lat=${latencyMs}ms → ${res.status} ${text.slice(0, 120)}`
      );
    } catch (e) {
      log(`emit error: ${e.message}`);
    }
  }
}

module.exports = { XAIPCallbackHandler };
module.exports.default = XAIPCallbackHandler;

// Internal helpers exposed for tests only. Not part of the stable public API.
module.exports.__internals = {
  canonicalize,
  sha256short,
  inferFailureType,
  slugify,
  resolveToolName,
  getKeyFile,
  getLogFile,
};
