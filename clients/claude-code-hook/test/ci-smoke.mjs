/**
 * Hermetic cross-platform smoke test for the Claude Code hook.
 *
 * Starts a local mock aggregator, points the hook at it via
 * XAIP_AGGREGATOR_URL, replays the PreToolUse/PostToolUse events Claude Code
 * sends on a real MCP tool call, and asserts the received receipt conforms to
 * wire format v1 (formatVersion, full 64-char hashes, failureType present,
 * and both Ed25519 signatures verifying over the canonical payload).
 *
 * No network egress, no production data. Exits non-zero on any failure.
 */

import http from "node:http";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOOK_CMD = process.env.HOOK_CMD || "xaip-claude-hook-run";
const HEX64 = /^[0-9a-f]{64}$/;

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
  return "{" + keys.map(k => JSON.stringify(k) + ":" + canonicalize(value[k])).join(",") + "}";
}

function verifySig(payload, signatureHex, publicKeyDerHex) {
  const key = crypto.createPublicKey({
    key: Buffer.from(publicKeyDerHex, "hex"),
    format: "der",
    type: "spki",
  });
  return crypto.verify(null, Buffer.from(payload), key, Buffer.from(signatureHex, "hex"));
}

function runHook(event, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(HOOK_CMD, [], { shell: true, env });
    let err = "";
    child.stderr.on("data", d => (err += d));
    child.on("close", code =>
      code === 0 ? resolve() : reject(new Error(`hook exited ${code}: ${err}`))
    );
    child.stdin.write(JSON.stringify(event));
    child.stdin.end();
  });
}

const failures = [];
function check(name, ok, detail) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : " — " + detail}`);
  if (!ok) failures.push(name);
}

// ── Mock aggregator ──────────────────────────────────────────────────────────
let received = null;
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", d => (body += d));
  req.on("end", () => {
    received = JSON.parse(body);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, agentDid: received.receipt.agentDid, callerVerified: true }));
  });
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const mockUrl = `http://127.0.0.1:${server.address().port}`;
console.log(`mock aggregator: ${mockUrl}`);

// ── Replay a real tool call ─────────────────────────────────────────────────
const env = {
  ...process.env,
  XAIP_AGGREGATOR_URL: mockUrl,
  XAIP_WARN_DISABLED: "1",
};
const toolUseId = `ci-smoke-${Date.now()}`;
const pre = {
  hook_event_name: "PreToolUse",
  tool_name: "mcp__ci-smoke__echo",
  tool_use_id: toolUseId,
  tool_input: { text: "hello" },
};
const post = {
  ...pre,
  hook_event_name: "PostToolUse",
  tool_response: { content: [{ type: "text", text: "hello" }] },
};

await runHook(pre, env);
await new Promise(r => setTimeout(r, 300));
await runHook(post, env);
server.close();

// ── Assertions ──────────────────────────────────────────────────────────────
check("aggregator received a POST", received !== null, "no request arrived");
if (received) {
  const r = received.receipt;
  check("formatVersion is \"1\"", r.formatVersion === "1", JSON.stringify(r.formatVersion));
  check("taskHash is 64-char lowercase hex", HEX64.test(r.taskHash), r.taskHash);
  check("resultHash is 64-char lowercase hex", HEX64.test(r.resultHash), r.resultHash);
  check("failureType present and \"\" on success", r.failureType === "", JSON.stringify(r.failureType));
  check("success is true", r.success === true, String(r.success));
  check("agentDid derived from server name", r.agentDid === "did:web:ci-smoke", r.agentDid);

  const payload = canonicalize({
    agentDid: r.agentDid,
    callerDid: r.callerDid,
    failureType: r.failureType,
    formatVersion: r.formatVersion,
    latencyMs: r.latencyMs,
    resultHash: r.resultHash,
    success: r.success,
    taskHash: r.taskHash,
    timestamp: r.timestamp,
    toolName: r.toolName,
  });
  check("agent signature verifies", verifySig(payload, r.signature, received.publicKey), "bad agent sig");
  check("caller signature verifies", verifySig(payload, r.callerSignature, received.callerPublicKey), "bad caller sig");
}

const logPath = path.join(os.homedir(), ".xaip", "hook.log");
const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "";
check("hook.log records the 200 response", log.includes("→ 200"), "no 200 line in hook.log");

if (failures.length > 0) {
  console.error(`\n${failures.length} assertion(s) failed`);
  process.exit(1);
}
console.log("\nall assertions passed");
