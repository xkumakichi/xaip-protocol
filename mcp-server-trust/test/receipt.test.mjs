/**
 * Pins the signing-critical logic (preimage profile, canonical payload shape)
 * to the values published in docs/spec/test-vectors/receipts-v1-vectors.json.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { hash, canonicalize, buildReport, generateKeyPair } from "../dist/receipt.js";

// Preimage profile vectors (draft -03 §3.5 / Appendix D)
const HELLO_RAW      = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
const EMPTY_SENTINEL = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const JCS_AB         = "43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777";

test("preimage profile: string hashes raw UTF-8 content bytes", () => {
  assert.equal(hash("hello"), HELLO_RAW);
});

test("preimage profile: absent/null hash the empty-input sentinel", () => {
  assert.equal(hash(undefined), EMPTY_SENTINEL);
  assert.equal(hash(null), EMPTY_SENTINEL);
});

test("preimage profile: structured values hash their JCS form, member-order invariant", () => {
  assert.equal(hash({ a: 1, b: 2 }), JCS_AB);
  assert.equal(hash({ b: 2, a: 1 }), JCS_AB);
});

test("canonical payload: JCS member order, formatVersion 1, failureType present", () => {
  const agentKp  = generateKeyPair("did:key");
  const callerKp = generateKeyPair("did:key");
  const ts = "2026-07-10T00:00:00.000Z";
  const r = buildReport({
    agentKp, callerKp, tool: "query-docs", success: true, latencyMs: 42, timestamp: ts,
  });

  const expected =
    `{"agentDid":${JSON.stringify(agentKp.did)},` +
    `"callerDid":${JSON.stringify(callerKp.did)},` +
    `"failureType":"",` +
    `"formatVersion":"1",` +
    `"latencyMs":42,` +
    `"resultHash":"${EMPTY_SENTINEL}",` +
    `"success":true,` +
    `"taskHash":"${hash("query-docs")}",` +
    `"timestamp":"${ts}",` +
    `"toolName":"query-docs"}`;
  assert.equal(r.payload, expected);
});

test("resultHash: commits to result when provided, sentinel when absent (§2)", () => {
  const agentKp  = generateKeyPair("did:key");
  const callerKp = generateKeyPair("did:key");

  const withResult = buildReport({
    agentKp, callerKp, tool: "t", success: true, latencyMs: 1, result: "hello",
  });
  assert.equal(withResult.base.resultHash, HELLO_RAW);

  const failureNoOutput = buildReport({
    agentKp, callerKp, tool: "t", success: false, latencyMs: 1,
  });
  assert.equal(failureNoOutput.base.resultHash, EMPTY_SENTINEL);
  assert.equal(failureNoOutput.base.failureType, "error");
});

test("hashes are full 64-char lowercase hex (v1 fail-closed requirement)", () => {
  const agentKp  = generateKeyPair("did:key");
  const callerKp = generateKeyPair("did:key");
  const r = buildReport({ agentKp, callerKp, tool: "t", success: true, latencyMs: 0 });
  assert.match(r.base.taskHash, /^[0-9a-f]{64}$/);
  assert.match(r.base.resultHash, /^[0-9a-f]{64}$/);
});

test("both signatures verify over the canonical payload", () => {
  const agentKp  = generateKeyPair("did:key");
  const callerKp = generateKeyPair("did:key");
  const r = buildReport({ agentKp, callerKp, tool: "t", success: false, latencyMs: 5 });

  for (const [sig, kp] of [[r.signature, agentKp], [r.callerSignature, callerKp]]) {
    const key = crypto.createPublicKey({
      key: Buffer.from(kp.publicKey, "hex"), format: "der", type: "spki",
    });
    assert.equal(
      crypto.verify(null, Buffer.from(r.payload), key, Buffer.from(sig, "hex")),
      true,
    );
  }
});

test("JCS: non-finite numbers are rejected", () => {
  assert.throws(() => canonicalize(Infinity));
});
