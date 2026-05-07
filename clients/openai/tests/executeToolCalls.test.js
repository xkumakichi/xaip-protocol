"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { executeToolCalls } = require("../lib/index.js");

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

async function flush() {
  await new Promise((r) => setTimeout(r, 30));
}

describe("executeToolCalls", () => {
  let prevKeyFile, prevLogFile, prevFetch;

  beforeEach(() => {
    prevKeyFile = process.env.XAIP_OPENAI_KEYS_FILE;
    prevLogFile = process.env.XAIP_OPENAI_LOG_FILE;
    prevFetch = globalThis.fetch;
    process.env.XAIP_OPENAI_KEYS_FILE = tempFile("xaip-oai-loop-");
    process.env.XAIP_OPENAI_LOG_FILE = tempFile("xaip-oai-loop-log-");
  });

  afterEach(() => {
    if (prevKeyFile === undefined) delete process.env.XAIP_OPENAI_KEYS_FILE;
    else process.env.XAIP_OPENAI_KEYS_FILE = prevKeyFile;
    if (prevLogFile === undefined) delete process.env.XAIP_OPENAI_LOG_FILE;
    else process.env.XAIP_OPENAI_LOG_FILE = prevLogFile;
    if (prevFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = prevFetch;
  });

  function makeToolCall(id, name, args) {
    return {
      id,
      type: "function",
      function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) },
    };
  }

  test("returns tool messages with shape { role, tool_call_id, content }", async () => {
    captureFetch();
    const toolMap = {
      search_docs: async ({ q }) => ({ hits: [q] }),
    };
    const messages = await executeToolCalls(
      [makeToolCall("call_1", "search_docs", { q: "react" })],
      toolMap,
      { aggregatorUrl: "https://example.invalid" }
    );
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("tool");
    expect(messages[0].tool_call_id).toBe("call_1");
    expect(JSON.parse(messages[0].content)).toEqual({ hits: ["react"] });
  });

  test("emits one receipt per executed tool call (mixed success/error)", async () => {
    const calls = captureFetch();
    const toolMap = {
      search_docs: async () => ({ ok: true }),
      flaky_api: async () => {
        throw new Error("Request timed out");
      },
    };
    const messages = await executeToolCalls(
      [
        makeToolCall("a", "search_docs", { q: "x" }),
        makeToolCall("b", "flaky_api", { x: 1 }),
      ],
      toolMap,
      { aggregatorUrl: "https://example.invalid" }
    );
    expect(messages).toHaveLength(2);
    await flush();

    expect(calls.length).toBe(2);
    const bodies = calls.map((c) => JSON.parse(c.init.body));
    const successReceipt = bodies.find((b) => b.receipt.toolName === "search_docs");
    const failReceipt = bodies.find((b) => b.receipt.toolName === "flaky_api");
    expect(successReceipt.receipt.success).toBe(true);
    expect(failReceipt.receipt.success).toBe(false);
    expect(failReceipt.receipt.failureType).toBe("timeout");

    // The failing tool's content captures the error message; the loop never throws.
    const failMsg = messages.find((m) => m.tool_call_id === "b");
    expect(JSON.parse(failMsg.content)).toEqual({ error: "Request timed out" });
  });

  test("unregistered tool returns error content but does NOT emit a receipt", async () => {
    const calls = captureFetch();
    const messages = await executeToolCalls(
      [makeToolCall("c", "nope", { x: 1 })],
      {},
      { aggregatorUrl: "https://example.invalid" }
    );
    await flush();
    expect(messages).toHaveLength(1);
    expect(JSON.parse(messages[0].content)).toEqual({ error: "No tool registered: nope" });
    expect(calls.length).toBe(0);
  });

  test("malformed arguments fall back to { _raw } and still emit", async () => {
    const calls = captureFetch();
    let receivedArgs;
    const toolMap = {
      capture: async (args) => {
        receivedArgs = args;
        return "ok";
      },
    };
    const malformed = { id: "d", type: "function", function: { name: "capture", arguments: "not-json{" } };
    await executeToolCalls([malformed], toolMap, { aggregatorUrl: "https://example.invalid" });
    await flush();
    expect(receivedArgs).toEqual({ _raw: "not-json{" });
    expect(calls.length).toBe(1);
  });

  test("classifyTool callback adds toolMetadata.xaip.class to each receipt", async () => {
    const calls = captureFetch();
    const toolMap = {
      search_docs: async () => "ok",
      summarize: async () => "ok",
    };
    await executeToolCalls(
      [
        makeToolCall("e", "search_docs", {}),
        makeToolCall("f", "summarize", {}),
      ],
      toolMap,
      {
        aggregatorUrl: "https://example.invalid",
        classifyTool: (name) => (name === "search_docs" ? "data-retrieval" : "advisory"),
      }
    );
    await flush();
    const bodies = calls.map((c) => JSON.parse(c.init.body));
    const search = bodies.find((b) => b.receipt.toolName === "search_docs");
    const summarize = bodies.find((b) => b.receipt.toolName === "summarize");
    expect(search.receipt.toolMetadata).toEqual({ xaip: { class: "data-retrieval" } });
    expect(summarize.receipt.toolMetadata).toEqual({ xaip: { class: "advisory" } });
  });

  test("disabled option skips emission for the entire batch", async () => {
    const calls = captureFetch();
    const toolMap = { x: async () => "ok" };
    await executeToolCalls([makeToolCall("g", "x", {})], toolMap, { disabled: true });
    await flush();
    expect(calls.length).toBe(0);
  });

  test("null/undefined toolCalls returns empty array", async () => {
    captureFetch();
    expect(await executeToolCalls(null, {})).toEqual([]);
    expect(await executeToolCalls(undefined, {})).toEqual([]);
  });
});
