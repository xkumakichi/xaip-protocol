#!/usr/bin/env node
/**
 * Self-verifies receipts-v1-vectors.json for draft-xkumakichi-xaip-receipts-03.
 *
 * Re-derives every hash and canonical payload from the vector inputs, and
 * verifies every Ed25519 signature against the embedded test keys. Exits
 * non-zero on any drift, printing exactly which vector failed and why.
 *
 * Requirements: Node >= 18. No dependencies (node:crypto only).
 * Usage: node check.mjs
 */
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(readFileSync(join(here, "receipts-v1-vectors.json"), "utf8"));

// ── JCS (RFC 8785) canonical serialization ──────────────────────────────────
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
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(value[k])).join(",") + "}";
}

// ── Hash preimage profile (formatVersion 1) ─────────────────────────────────
// Text hashes raw UTF-8 content bytes; absent values hash the empty string;
// structured JSON hashes its JCS form.
function hashValue(value) {
  const str = value === undefined || value === null ? "" : typeof value === "string" ? value : canonicalize(value);
  return crypto.createHash("sha256").update(str).digest("hex");
}

// ── Canonical payload: nine base fields + formatVersion when present ────────
function receiptPayload(r) {
  const obj = {
    agentDid: r.agentDid,
    callerDid: r.callerDid ?? "",
    failureType: r.failureType ?? "",
    latencyMs: r.latencyMs,
    resultHash: r.resultHash ?? "",
    success: r.success,
    taskHash: r.taskHash,
    timestamp: r.timestamp,
    toolName: r.toolName,
  };
  if (r.formatVersion !== undefined) obj.formatVersion = r.formatVersion;
  return canonicalize(obj);
}

function verifySig(payload, sigHex, spkiHex) {
  const key = crypto.createPublicKey({ key: Buffer.from(spkiHex, "hex"), format: "der", type: "spki" });
  return crypto.verify(null, Buffer.from(payload), key, Buffer.from(sigHex, "hex"));
}

// ── formatVersion 1 fail-closed format checks ───────────────────────────────
const HEX64 = /^[0-9a-f]{64}$/;
function v1FormatViolation(fragment) {
  if (fragment.taskHash !== undefined && !HEX64.test(fragment.taskHash)) {
    return "taskHash is not 64 lowercase hex characters";
  }
  if (fragment.resultHash !== undefined && !HEX64.test(fragment.resultHash)) {
    return "resultHash is not 64 lowercase hex characters";
  }
  if (fragment.success === true && fragment.failureType !== undefined && fragment.failureType !== "") {
    return 'failureType must be "" when success is true';
  }
  if (fragment.success === false && !fragment.failureType) {
    return "failureType is required when success is false";
  }
  return null;
}

// ── Runner ───────────────────────────────────────────────────────────────────
let failures = 0;
const seen = new Set();
function check(name, cond, detail) {
  if (seen.has(name)) {
    failures++;
    console.error(`FAIL  ${name}: duplicate vector name`);
    return;
  }
  if (cond) console.log(`ok    ${name}`);
  else {
    failures++;
    console.error(`FAIL  ${name}: ${detail}`);
  }
}

for (const v of vectors.preimageVectors) {
  if (v.name === "json_key_order_invariance") {
    const a = hashValue(v.valueSpellingA);
    const b = hashValue(v.valueSpellingB);
    check(v.name, a === v.expectedHash && b === v.expectedHash, `got ${a} / ${b}, expected ${v.expectedHash}`);
  } else {
    const h = hashValue(v.value);
    let ok = h === v.expectedHash;
    let detail = `got ${h}, expected ${v.expectedHash}`;
    if (ok && v.expectedCanonical !== undefined) {
      const c = canonicalize(v.value);
      ok = c === v.expectedCanonical;
      detail = `canonical form drift: got ${c}`;
    }
    if (ok && v.wrongHashJsonForm !== undefined) {
      const wrong = crypto.createHash("sha256").update(JSON.stringify(v.value)).digest("hex");
      ok = wrong === v.wrongHashJsonForm && wrong !== v.expectedHash;
      detail = `wrongHashJsonForm drift: got ${wrong}`;
    }
    check(v.name, ok, detail);
  }
  seen.add(v.name);
}

for (const v of vectors.payloadVectors) {
  const p = receiptPayload(v.fields);
  check(v.name, p === v.expectedPayload, `payload drift:\n  got      ${p}\n  expected ${v.expectedPayload}`);
  seen.add(v.name);
}

for (const v of vectors.receiptVectors) {
  const payload = receiptPayload(v.receipt);
  let ok = true;
  const details = [];
  if (v.expect.agentSignatureValid !== undefined) {
    const got = verifySig(payload, v.receipt.signature, vectors.keys.agent.publicKeySpkiHex);
    if (got !== v.expect.agentSignatureValid) {
      ok = false;
      details.push(`agent signature: got ${got}, expected ${v.expect.agentSignatureValid}`);
    }
  }
  if (v.expect.callerSignatureValid !== undefined) {
    const got = verifySig(payload, v.receipt.callerSignature, vectors.keys.caller.publicKeySpkiHex);
    if (got !== v.expect.callerSignatureValid) {
      ok = false;
      details.push(`caller signature: got ${got}, expected ${v.expect.callerSignatureValid}`);
    }
  }
  check(v.name, ok, details.join("; "));
  seen.add(v.name);
}

for (const v of vectors.rejectionVectors) {
  const violation = v1FormatViolation(v.receiptFragment);
  check(v.name, violation === v.mustReject, `got ${JSON.stringify(violation)}, expected ${JSON.stringify(v.mustReject)}`);
  seen.add(v.name);
}

if (failures > 0) {
  console.error(`\n${failures} vector(s) FAILED`);
  process.exit(1);
}
console.log(`\nAll ${seen.size} vectors verified.`);
