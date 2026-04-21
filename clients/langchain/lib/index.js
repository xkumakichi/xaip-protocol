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
const XAIP_DIR = path.join(os.homedir(), ".xaip");
const KEY_FILE = path.join(XAIP_DIR, "langchain-keys.json");
const LOG_FILE = path.join(XAIP_DIR, "langchain.log");

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
   *        "computation" | "mutation" | "settlement"). Carried alongside
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

  async handleToolStart(tool, input, runId) {
    if (this.disabled) return;
    const toolName = (tool && (tool.name || tool.id)) || "unknown_tool";
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

      // v0.5 forward-compat: attach optional class hint.
      if (this.classifyTool) {
        try {
          const cls = this.classifyTool(toolName);
          if (cls) body.toolMetadata = { xaip: { class: cls } };
        } catch (_) {}
      }

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
