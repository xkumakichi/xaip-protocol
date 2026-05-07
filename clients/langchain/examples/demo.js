"use strict";

/**
 * xaip-langchain runnable demo.
 *
 * Default mode: dry-run. POSTs are intercepted and printed locally.
 *               No real receipts are sent to the aggregator.
 * Live mode:    pass `--live` to actually POST receipts to the live XAIP aggregator.
 *               This contributes signed LangChain-origin receipts to the public
 *               trust graph. Use deliberately and sparingly.
 *
 * Run:
 *   node examples/demo.js              # dry-run, no network writes
 *   node examples/demo.js --live       # posts receipts to live aggregator
 *
 * Optional env:
 *   XAIP_AGGREGATOR_URL        override aggregator endpoint
 *   XAIP_LANGCHAIN_KEYS_FILE   override key persistence file
 */

const { DynamicTool } = require("@langchain/core/tools");
const { XAIPCallbackHandler } = require("../lib/index.js");

const isLive = process.argv.includes("--live");

const captured = [];
if (!isLive) {
  // Intercept fetch so dry-run mode never reaches the aggregator.
  globalThis.fetch = async (url, init) => {
    let body;
    try {
      body = JSON.parse(init && init.body ? init.body : "{}");
    } catch (_) {
      body = init && init.body;
    }
    captured.push({ url: String(url), body });
    return {
      ok: true,
      status: 200,
      text: async () => "dry-run",
    };
  };
}

const handler = new XAIPCallbackHandler({
  // Tag a class hint so receipts carry forward-compatible v0.5 metadata.
  classifyTool: (name) => {
    if (name === "flaky_api") return "data-retrieval";
    if (name === "doc_search") return "data-retrieval";
    return "advisory";
  },
});

const docSearch = new DynamicTool({
  name: "doc_search",
  description: "Look up documentation by query.",
  func: async (q) => `Top result for "${q}": LangChain core docs.`,
});

const flakyApi = new DynamicTool({
  name: "flaky_api",
  description: "Sometimes times out.",
  func: async () => {
    throw new Error("Request timed out after 30s");
  },
});

async function main() {
  const mode = isLive ? "LIVE — receipts will be posted to the aggregator" : "dry-run — no network writes";
  console.log(`xaip-langchain demo (${mode})\n`);

  // Successful tool call.
  const result = await docSearch.invoke("react hooks", { callbacks: [handler] });
  console.log("doc_search →", result);

  // Failing tool call.
  try {
    await flakyApi.invoke("ping", { callbacks: [handler] });
  } catch (e) {
    console.log("flaky_api → error:", e.message);
  }

  // Allow any in-flight emit() to settle.
  await new Promise((r) => setTimeout(r, 200));

  if (!isLive) {
    console.log(`\n[dry-run] captured ${captured.length} receipt(s):`);
    for (const c of captured) {
      console.log(`POST ${c.url}`);
      console.log(JSON.stringify(c.body.receipt, null, 2));
      console.log("");
    }
    console.log("To actually post to the aggregator, re-run with --live.");
  } else {
    console.log("\nLive run complete. Check the aggregator dashboard for new receipts.");
  }
}

main().catch((e) => {
  console.error("demo failed:", e);
  process.exit(1);
});
