/**
 * Wire format v1 receipt construction (draft-xkumakichi-xaip-receipts-03).
 *
 * Kept as a separate, side-effect-free module so the signing-critical logic
 * (preimage profile, canonical payload shape) can be pinned by tests against
 * the published conformance vectors.
 */

import * as crypto from "node:crypto";

export interface KeyPair {
  did: string;
  publicKey: string;   // hex-encoded SPKI DER
  privateKey: string;  // hex-encoded PKCS8 DER
}

export function generateKeyPair(didBase: string): KeyPair {
  const pair = crypto.generateKeyPairSync("ed25519");
  const pubDer  = pair.publicKey.export({ type: "spki",  format: "der" }) as Buffer;
  const privDer = pair.privateKey.export({ type: "pkcs8", format: "der" }) as Buffer;
  const raw = pubDer.subarray(pubDer.length - 32);
  return {
    did: `${didBase}:${raw.toString("hex")}`,
    publicKey:  pubDer.toString("hex"),
    privateKey: privDer.toString("hex"),
  };
}

export function canonicalize(value: unknown): string {
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
    keys
      .map(k => JSON.stringify(k) + ":" + canonicalize((value as Record<string, unknown>)[k]))
      .join(",") +
    "}"
  );
}

export function signPayload(payload: string, privateKeyHex: string): string {
  const key = crypto.createPrivateKey({
    key: Buffer.from(privateKeyHex, "hex"),
    format: "der",
    type: "pkcs8",
  });
  return crypto.sign(null, Buffer.from(payload), key).toString("hex");
}

// Wire format v1 preimage profile (draft -03 §3.5): strings hash their raw
// UTF-8 bytes, absent/null hashes the empty string (the empty-input
// sentinel), structured values hash their JCS form. Full 64-char digest.
export function hash(value: unknown): string {
  const str =
    value === undefined || value === null
      ? ""
      : typeof value === "string"
        ? value
        : canonicalize(value);
  return crypto.createHash("sha256").update(str).digest("hex");
}

export interface ReportParams {
  agentKp: KeyPair;
  callerKp: KeyPair;
  tool: string;
  success: boolean;
  latencyMs: number;
  /** Raw output (or failure description) to commit to. When absent, the
   *  receipt commits to no output: resultHash is the empty-input sentinel. */
  result?: string;
  timestamp?: string;
}

export interface BuiltReport {
  base: Record<string, unknown>;
  payload: string;
  signature: string;
  callerSignature: string;
}

export function buildReport(p: ReportParams): BuiltReport {
  const timestamp   = p.timestamp ?? new Date().toISOString();
  const taskHash    = hash(p.tool);
  const resultHash  = hash(p.result); // absent → empty-input sentinel (§3.5)
  const failureType = p.success ? "" : "error";

  const base = {
    agentDid:      p.agentKp.did,
    callerDid:     p.callerKp.did,
    toolName:      p.tool,
    taskHash,
    resultHash,
    success:       p.success,
    failureType,
    latencyMs:     p.latencyMs,
    timestamp,
    formatVersion: "1",
  };

  // Canonical payload for signing (wire format v1: formatVersion is part of
  // the signed payload; failureType is always present, "" on success)
  const payloadObj = {
    agentDid:      base.agentDid,
    callerDid:     base.callerDid,
    failureType:   base.failureType,
    formatVersion: base.formatVersion,
    latencyMs:     base.latencyMs,
    resultHash:    base.resultHash,
    success:       base.success,
    taskHash:      base.taskHash,
    timestamp:     base.timestamp,
    toolName:      base.toolName,
  };
  const payload = canonicalize(payloadObj);

  return {
    base,
    payload,
    signature:       signPayload(payload, p.agentKp.privateKey),
    callerSignature: signPayload(payload, p.callerKp.privateKey),
  };
}
