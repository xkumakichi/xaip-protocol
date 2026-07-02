/**
 * XAIP Identity — Multi-method DID + Ed25519 signing + JCS canonicalization
 *
 * v0.3 changes:
 *   - JCS (RFC 8785) canonical payload replaces pipe-delimited format
 *   - Co-signature support (caller + executor)
 *
 * Supports did:key, did:web, did:xrpl, did:ethr.
 */

import * as crypto from "crypto";
import {
  ParsedDID,
  DIDMethod,
  SigningDelegate,
  ExecutionReceipt,
} from "./types";

/**
 * JCS (RFC 8785) canonicalization — deterministic JSON serialization.
 * Keys sorted lexicographically by Unicode code point, no whitespace.
 */
function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!isFinite(value)) throw new Error("JCS: non-finite numbers not allowed");
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map((v) => canonicalize(v)).join(",") + "]";
  }
  // Object: sort keys by Unicode code point order
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const pairs = keys.map(
    (k) =>
      JSON.stringify(k) +
      ":" +
      canonicalize((value as Record<string, unknown>)[k])
  );
  return "{" + pairs.join(",") + "}";
}

/** Parse a DID string into method and id. */
export function parseDID(did: string): ParsedDID {
  const match = did.match(/^did:(\w+):(.+)$/);
  if (!match) throw new Error(`Invalid DID: ${did}`);
  const method = match[1] as DIDMethod;
  return { method, id: did };
}

/** Generate a new did:key backed by an Ed25519 key pair. */
export function generateDIDKey(): {
  did: ParsedDID;
  publicKey: string;
  privateKey: string;
} {
  const pair = crypto.generateKeyPairSync("ed25519");
  const pubDer = pair.publicKey.export({ type: "spki", format: "der" });
  const privDer = pair.privateKey.export({ type: "pkcs8", format: "der" });

  // Extract raw 32-byte public key from SPKI envelope
  const raw = pubDer.subarray(pubDer.length - 32);
  const didId = `did:key:${raw.toString("hex")}`;

  return {
    did: parseDID(didId),
    publicKey: pubDer.toString("hex"),
    privateKey: privDer.toString("hex"),
  };
}

/**
 * Build the canonical payload for a receipt using JCS (RFC 8785).
 * Deterministic JSON serialization — no key-order ambiguity.
 */
export function receiptPayload(
  r: Omit<ExecutionReceipt, "signature" | "callerSignature">
): string {
  const obj: Record<string, unknown> = {
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
  if (r.formatVersion !== undefined) {
    obj.formatVersion = r.formatVersion;
  }
  // toolMetadata is deliberately EXCLUDED from the canonical payload: it is
  // unsigned, deployment-defined hint data (draft §3.1 / §6). Consumers that
  // want to trust it must validate it out of band. Pre-formatVersion SDK
  // releases incorrectly signed it when present; formatVersion "1" receipts
  // never include it in the signed bytes.
  return canonicalize(obj);
}

/** Sign a string with an Ed25519 private key (DER hex). */
export function sign(data: string, privateKeyHex: string): string {
  const key = crypto.createPrivateKey({
    key: Buffer.from(privateKeyHex, "hex"),
    format: "der",
    type: "pkcs8",
  });
  return crypto.sign(null, Buffer.from(data), key).toString("hex");
}

/** Verify an Ed25519 signature. */
export function verify(
  data: string,
  signatureHex: string,
  publicKeyHex: string
): boolean {
  const key = crypto.createPublicKey({
    key: Buffer.from(publicKeyHex, "hex"),
    format: "der",
    type: "spki",
  });
  return crypto.verify(
    null,
    Buffer.from(data),
    key,
    Buffer.from(signatureHex, "hex")
  );
}

/**
 * Create a SigningDelegate from a raw Ed25519 private key.
 * Convenience for callers who don't use HSM/external signing.
 */
export function createSigningDelegate(
  did: string,
  privateKeyHex: string
): SigningDelegate {
  return {
    did,
    async sign(payload: string): Promise<string> {
      return sign(payload, privateKeyHex);
    },
  };
}

/**
 * SHA-256 hash of a task input / result — full 64 lowercase hex chars.
 *
 * Preimage profile (pinned; draft -03 RECOMMENDED):
 *   - string values hash their raw UTF-8 bytes
 *   - null / undefined / absent values hash the empty string
 *     (empty-input sentinel: e3b0c442...)
 *   - all other JSON values hash the UTF-8 bytes of their JCS canonical
 *     form, so key order cannot change the hash
 *
 * NOTE: pre-formatVersion (legacy) SDK releases truncated this digest to
 * 16 hex chars. A 64-bit digest is collision-findable (~2^32 work) and is
 * never produced for formatVersion "1" receipts. Legacy receipts already
 * stored remain readable; their hashes are simply legacy-format.
 */
export function hash(value: unknown): string {
  const str =
    value === undefined || value === null
      ? ""
      : typeof value === "string"
        ? value
        : canonicalize(value);
  return crypto.createHash("sha256").update(str).digest("hex");
}
