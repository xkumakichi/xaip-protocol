"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const { runWithXAIP, __internals } = require("../lib/index.js");
const { canonicalize } = __internals;

function tempFile(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return path.join(dir, "keys.json");
}

function captureFetch() {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return { ok: true, status: 200, text: async () => "ok" };
  };
  return calls;
}

function verifyEd25519(payload, signatureHex, publicKeyHex) {
  const key = crypto.createPublicKey({
    key: Buffer.from(publicKeyHex, "hex"),
    format: "der",
    type: "spki",
  });
  return crypto.verify(null, Buffer.from(payload), key, Buffer.from(signatureHex, "hex"));
}

function recreatePayload(receipt) {
  // Mirrors the spec's canonical-payload rule: formatVersion is signed when
  // present; toolMetadata is NEVER part of the signed payload (unsigned hints).
  const obj = {
    agentDid: receipt.agentDid,
    callerDid: receipt.callerDid,
    failureType: receipt.failureType,
    latencyMs: receipt.latencyMs,
    resultHash: receipt.resultHash,
    success: receipt.success,
    taskHash: receipt.taskHash,
    timestamp: receipt.timestamp,
    toolName: receipt.toolName,
  };
  if (receipt.formatVersion !== undefined) obj.formatVersion = receipt.formatVersion;
  return canonicalize(obj);
}

async function flush() {
  // Receipts are fire-and-forget, give the microtask + timer queue time to drain.
  await new Promise((r) => setTimeout(r, 30));
}

describe("runWithXAIP", () => {
  let prevKeyFile, prevLogFile, prevFetch, prevDisabled;

  beforeEach(() => {
    prevKeyFile = process.env.XAIP_OPENAI_KEYS_FILE;
    prevLogFile = process.env.XAIP_OPENAI_LOG_FILE;
    prevDisabled = process.env.XAIP_DISABLED;
    prevFetch = globalThis.fetch;
    process.env.XAIP_OPENAI_KEYS_FILE = tempFile("xaip-oai-test-");
    process.env.XAIP_OPENAI_LOG_FILE = tempFile("xaip-oai-log-");
  });

  afterEach(() => {
    if (prevKeyFile === undefined) delete process.env.XAIP_OPENAI_KEYS_FILE;
    else process.env.XAIP_OPENAI_KEYS_FILE = prevKeyFile;
    if (prevLogFile === undefined) delete process.env.XAIP_OPENAI_LOG_FILE;
    else process.env.XAIP_OPENAI_LOG_FILE = prevLogFile;
    if (prevDisabled === undefined) delete process.env.XAIP_DISABLED;
    else process.env.XAIP_DISABLED = prevDisabled;
    if (prevFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = prevFetch;
  });

  test("success path posts a verifiable receipt and returns output", async () => {
    const calls = captureFetch();
    const out = await runWithXAIP({
      toolName: "search_docs",
      input: { q: "react" },
      run: async () => ({ hits: ["a", "b"] }),
      aggregatorUrl: "https://example.invalid",
    });
    expect(out).toEqual({ hits: ["a", "b"] });
    await flush();

    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("https://example.invalid/receipts");
    const body = JSON.parse(calls[0].init.body);
    expect(body.receipt.toolName).toBe("search_docs");
    expect(body.receipt.success).toBe(true);
    expect(body.receipt.agentDid).toBe("did:web:oai-search-docs");
    expect(body.receipt.callerDid).toMatch(/^did:key:[0-9a-f]+$/);
    expect(body.receipt.taskHash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.receipt.formatVersion).toBe("1");

    const payload = recreatePayload(body.receipt);
    expect(verifyEd25519(payload, body.receipt.signature, body.publicKey)).toBe(true);
    expect(verifyEd25519(payload, body.receipt.callerSignature, body.callerPublicKey)).toBe(true);
  });

  test("error path posts failure receipt and re-throws", async () => {
    const calls = captureFetch();
    await expect(
      runWithXAIP({
        toolName: "flaky_api",
        input: { x: 1 },
        run: async () => {
          throw new Error("Request timed out");
        },
        aggregatorUrl: "https://example.invalid",
      })
    ).rejects.toThrow("Request timed out");
    await flush();

    expect(calls.length).toBe(1);
    const body = JSON.parse(calls[0].init.body);
    expect(body.receipt.success).toBe(false);
    expect(body.receipt.failureType).toBe("timeout");
    expect(body.receipt.toolName).toBe("flaky_api");

    const payload = recreatePayload(body.receipt);
    expect(verifyEd25519(payload, body.receipt.signature, body.publicKey)).toBe(true);
  });

  test("disabled option skips emission", async () => {
    const calls = captureFetch();
    const out = await runWithXAIP({
      toolName: "x",
      input: {},
      run: async () => "ok",
      disabled: true,
    });
    expect(out).toBe("ok");
    await flush();
    expect(calls.length).toBe(0);
  });

  test("XAIP_DISABLED=1 skips emission", async () => {
    const calls = captureFetch();
    process.env.XAIP_DISABLED = "1";
    const out = await runWithXAIP({
      toolName: "x",
      input: {},
      run: async () => "ok",
    });
    expect(out).toBe("ok");
    await flush();
    expect(calls.length).toBe(0);
  });

  test("classHint adds toolMetadata.xaip.class and signature still verifies", async () => {
    const calls = captureFetch();
    await runWithXAIP({
      toolName: "search_docs",
      input: { q: "x" },
      run: async () => "ok",
      classHint: "data-retrieval",
      aggregatorUrl: "https://example.invalid",
    });
    await flush();

    const body = JSON.parse(calls[0].init.body);
    expect(body.receipt.toolMetadata).toEqual({ xaip: { class: "data-retrieval" } });
    const payload = recreatePayload(body.receipt);
    expect(verifyEd25519(payload, body.receipt.signature, body.publicKey)).toBe(true);
  });

  test("circular reference output does not crash and still emits a receipt", async () => {
    const calls = captureFetch();
    const cyclic = {};
    cyclic.self = cyclic;
    const out = await runWithXAIP({
      toolName: "weird_tool",
      input: { a: 1 },
      run: async () => cyclic,
      aggregatorUrl: "https://example.invalid",
    });
    expect(out).toBe(cyclic);
    await flush();

    expect(calls.length).toBe(1);
    const body = JSON.parse(calls[0].init.body);
    expect(body.receipt.success).toBe(true);
    expect(body.receipt.resultHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("XAIP_AGGREGATOR_URL env override is honored", async () => {
    const calls = captureFetch();
    const prev = process.env.XAIP_AGGREGATOR_URL;
    process.env.XAIP_AGGREGATOR_URL = "https://override.example/agg";
    try {
      await runWithXAIP({
        toolName: "x",
        input: {},
        run: async () => "ok",
      });
      await flush();
      expect(calls[0].url).toBe("https://override.example/agg/receipts");
    } finally {
      if (prev === undefined) delete process.env.XAIP_AGGREGATOR_URL;
      else process.env.XAIP_AGGREGATOR_URL = prev;
    }
  });

  test("keys persist across calls", async () => {
    captureFetch();
    await runWithXAIP({
      toolName: "t",
      input: { a: 1 },
      run: async () => "ok",
      aggregatorUrl: "https://example.invalid",
    });
    await flush();
    const after1 = JSON.parse(fs.readFileSync(process.env.XAIP_OPENAI_KEYS_FILE, "utf8"));

    await runWithXAIP({
      toolName: "t",
      input: { a: 1 },
      run: async () => "ok",
      aggregatorUrl: "https://example.invalid",
    });
    await flush();
    const after2 = JSON.parse(fs.readFileSync(process.env.XAIP_OPENAI_KEYS_FILE, "utf8"));

    expect(after2.caller.did).toBe(after1.caller.did);
    expect(after2.agents.t.did).toBe(after1.agents.t.did);
  });
});
