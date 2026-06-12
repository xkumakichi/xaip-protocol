"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const { XAIPCallbackHandler, __internals } = require("../lib/index.js");
const { canonicalize } = __internals;

function tempFile(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return path.join(dir, "keys.json");
}

function captureFetch() {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      text: async () => "ok",
    };
  };
  return calls;
}

function clearFetch() {
  delete globalThis.fetch;
}

function verifyEd25519(payload, signatureHex, publicKeyHex) {
  const key = crypto.createPublicKey({
    key: Buffer.from(publicKeyHex, "hex"),
    format: "der",
    type: "spki",
  });
  return crypto.verify(null, Buffer.from(payload), key, Buffer.from(signatureHex, "hex"));
}

function makeKeyPair(did) {
  const pair = crypto.generateKeyPairSync("ed25519");
  const pubDer = pair.publicKey.export({ type: "spki", format: "der" });
  const privDer = pair.privateKey.export({ type: "pkcs8", format: "der" });
  return {
    did,
    publicKey: pubDer.toString("hex"),
    privateKey: privDer.toString("hex"),
  };
}

function recreatePayload(receipt) {
  // Mirror the canonical payload object built in _emit.
  const payloadObject = {
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
  if (receipt.toolMetadata) payloadObject.toolMetadata = receipt.toolMetadata;
  return canonicalize(payloadObject);
}

describe("XAIPCallbackHandler integration", () => {
  let prevKeyFile;
  let prevLogFile;
  let prevFetch;

  beforeEach(() => {
    prevKeyFile = process.env.XAIP_LANGCHAIN_KEYS_FILE;
    prevLogFile = process.env.XAIP_LANGCHAIN_LOG_FILE;
    prevFetch = globalThis.fetch;
    process.env.XAIP_LANGCHAIN_KEYS_FILE = tempFile("xaip-test-");
    process.env.XAIP_LANGCHAIN_LOG_FILE = tempFile("xaip-log-");
  });

  afterEach(() => {
    if (prevKeyFile === undefined) delete process.env.XAIP_LANGCHAIN_KEYS_FILE;
    else process.env.XAIP_LANGCHAIN_KEYS_FILE = prevKeyFile;
    if (prevLogFile === undefined) delete process.env.XAIP_LANGCHAIN_LOG_FILE;
    else process.env.XAIP_LANGCHAIN_LOG_FILE = prevLogFile;
    if (prevFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = prevFetch;
  });

  test("handleToolEnd posts a verifiable receipt", async () => {
    const calls = captureFetch();
    const handler = new XAIPCallbackHandler({ aggregatorUrl: "https://example.invalid" });
    const runId = "run-1";
    await handler.handleToolStart({ name: "doc_search" }, { q: "react hooks" }, runId);
    await new Promise((r) => setTimeout(r, 5));
    await handler.handleToolEnd({ result: "ok" }, runId);

    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("https://example.invalid/receipts");
    const body = JSON.parse(calls[0].init.body);

    expect(body.receipt.toolName).toBe("doc_search");
    expect(body.receipt.success).toBe(true);
    expect(body.receipt.agentDid).toMatch(/^did:web:lc-doc-search$/);
    expect(body.receipt.callerDid).toMatch(/^did:key:[0-9a-f]+$/);
    expect(body.receipt.taskHash).toMatch(/^[0-9a-f]{16}$/);
    expect(body.receipt.resultHash).toMatch(/^[0-9a-f]{16}$/);
    expect(typeof body.receipt.latencyMs).toBe("number");
    expect(body.receipt.latencyMs).toBeGreaterThanOrEqual(0);
    expect(body.publicKey).toMatch(/^[0-9a-f]+$/);
    expect(body.callerPublicKey).toMatch(/^[0-9a-f]+$/);

    const payload = recreatePayload(body.receipt);
    expect(verifyEd25519(payload, body.receipt.signature, body.publicKey)).toBe(true);
    expect(verifyEd25519(payload, body.receipt.callerSignature, body.callerPublicKey)).toBe(true);
  });

  test("handleToolError posts a failure receipt with inferred failureType", async () => {
    const calls = captureFetch();
    const handler = new XAIPCallbackHandler({ aggregatorUrl: "https://example.invalid" });
    const runId = "run-err";
    await handler.handleToolStart({ name: "flaky_api" }, { q: "x" }, runId);
    await handler.handleToolError(new Error("Request timed out"), runId);

    expect(calls.length).toBe(1);
    const body = JSON.parse(calls[0].init.body);
    expect(body.receipt.success).toBe(false);
    expect(body.receipt.failureType).toBe("timeout");
    expect(body.receipt.toolName).toBe("flaky_api");

    const payload = recreatePayload(body.receipt);
    expect(verifyEd25519(payload, body.receipt.signature, body.publicKey)).toBe(true);
  });

  test("disabled handler does not post", async () => {
    const calls = captureFetch();
    const handler = new XAIPCallbackHandler({ disabled: true });
    await handler.handleToolStart({ name: "x" }, { a: 1 }, "r");
    await handler.handleToolEnd({ b: 2 }, "r");
    expect(calls.length).toBe(0);
  });

  test("XAIP_DISABLED=1 disables emission", async () => {
    const calls = captureFetch();
    const prev = process.env.XAIP_DISABLED;
    process.env.XAIP_DISABLED = "1";
    try {
      const handler = new XAIPCallbackHandler();
      await handler.handleToolStart({ name: "x" }, { a: 1 }, "r");
      await handler.handleToolEnd({ b: 2 }, "r");
      expect(calls.length).toBe(0);
    } finally {
      if (prev === undefined) delete process.env.XAIP_DISABLED;
      else process.env.XAIP_DISABLED = prev;
    }
  });

  test("classifyTool attaches toolMetadata.xaip.class", async () => {
    const calls = captureFetch();
    const handler = new XAIPCallbackHandler({
      aggregatorUrl: "https://example.invalid",
      classifyTool: (name) => (name === "settle" ? "settlement" : "advisory"),
    });
    await handler.handleToolStart({ name: "settle" }, { x: 1 }, "r");
    await handler.handleToolEnd({ ok: true }, "r");

    const body = JSON.parse(calls[0].init.body);
    expect(body.receipt.toolMetadata).toEqual({ xaip: { class: "settlement" } });

    // Signature must remain valid with toolMetadata included in the payload.
    const payload = recreatePayload(body.receipt);
    expect(verifyEd25519(payload, body.receipt.signature, body.publicKey)).toBe(true);
  });

  test("keys persist across handler instances", async () => {
    captureFetch();
    const h1 = new XAIPCallbackHandler({ aggregatorUrl: "https://example.invalid" });
    await h1.handleToolStart({ name: "t" }, { a: 1 }, "r1");
    await h1.handleToolEnd({ b: 2 }, "r1");
    const keysAfter1 = JSON.parse(fs.readFileSync(process.env.XAIP_LANGCHAIN_KEYS_FILE, "utf8"));

    const h2 = new XAIPCallbackHandler({ aggregatorUrl: "https://example.invalid" });
    await h2.handleToolStart({ name: "t" }, { a: 1 }, "r2");
    await h2.handleToolEnd({ b: 2 }, "r2");
    const keysAfter2 = JSON.parse(fs.readFileSync(process.env.XAIP_LANGCHAIN_KEYS_FILE, "utf8"));

    expect(keysAfter2.caller.did).toBe(keysAfter1.caller.did);
    expect(keysAfter2.agents.t.did).toBe(keysAfter1.agents.t.did);
  });

  test("loaded keys are cached across emissions on one handler", async () => {
    const keyFile = process.env.XAIP_LANGCHAIN_KEYS_FILE;
    const keys = {
      version: "1.0",
      caller: makeKeyPair("did:key:test-caller"),
      agents: {
        t: makeKeyPair("did:web:lc-t"),
      },
    };
    fs.mkdirSync(path.dirname(keyFile), { recursive: true });
    fs.writeFileSync(keyFile, JSON.stringify(keys, null, 2));

    const calls = captureFetch();
    const readSpy = jest.spyOn(fs, "readFileSync");
    try {
      const handler = new XAIPCallbackHandler({ aggregatorUrl: "https://example.invalid" });
      await handler.handleToolStart({ name: "t" }, { a: 1 }, "r1");
      await handler.handleToolEnd({ b: 2 }, "r1");
      await handler.handleToolStart({ name: "t" }, { a: 3 }, "r2");
      await handler.handleToolEnd({ b: 4 }, "r2");

      expect(calls.length).toBe(2);
      const keyReads = readSpy.mock.calls.filter(
        ([file]) => path.resolve(String(file)) === path.resolve(keyFile)
      );
      expect(keyReads.length).toBe(1);
    } finally {
      readSpy.mockRestore();
    }
  });

  test("handleToolEnd without prior handleToolStart is a no-op", async () => {
    const calls = captureFetch();
    const handler = new XAIPCallbackHandler({ aggregatorUrl: "https://example.invalid" });
    await handler.handleToolEnd({ ok: true }, "unknown-run");
    expect(calls.length).toBe(0);
  });

  test("aggregatorUrl can be overridden via XAIP_AGGREGATOR_URL env", async () => {
    const calls = captureFetch();
    const prev = process.env.XAIP_AGGREGATOR_URL;
    process.env.XAIP_AGGREGATOR_URL = "https://override.example/agg";
    try {
      const handler = new XAIPCallbackHandler();
      await handler.handleToolStart({ name: "t" }, { a: 1 }, "r");
      await handler.handleToolEnd({ b: 2 }, "r");
      expect(calls[0].url).toBe("https://override.example/agg/receipts");
    } finally {
      if (prev === undefined) delete process.env.XAIP_AGGREGATOR_URL;
      else process.env.XAIP_AGGREGATOR_URL = prev;
    }
  });
});
