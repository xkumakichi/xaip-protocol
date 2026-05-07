"use strict";

/**
 * xaip-openai runnable demo.
 *
 * Default mode: dry-run. POSTs are intercepted and printed locally.
 *               No real receipts are sent to the aggregator.
 * Live mode:    pass `--live` to actually POST receipts to the live XAIP aggregator.
 *               Use deliberately and sparingly.
 *
 * Run:
 *   node examples/demo.js              # dry-run, no network writes
 *   node examples/demo.js --live       # posts receipts to live aggregator
 *
 * Optional env:
 *   XAIP_AGGREGATOR_URL        override aggregator endpoint
 *   XAIP_OPENAI_KEYS_FILE      override key persistence file
 */

const { executeToolCalls } = require("../lib/index.js");

const isLive = process.argv.includes("--live");

const captured = [];
if (!isLive) {
  globalThis.fetch = async (url, init) => {
    let body;
    try {
      body = JSON.parse(init && init.body ? init.body : "{}");
    } catch (_) {
      body = init && init.body;
    }
    captured.push({ url: String(url), body });
    return { ok: true, status: 200, text: async () => "dry-run" };
  };
}

// Mimic OpenAI's chat.completions response.choices[0].message.tool_calls shape.
const toolCalls = [
  {
    id: "call_search",
    type: "function",
    function: { name: "search_docs", arguments: JSON.stringify({ q: "react hooks" }) },
  },
  {
    id: "call_flaky",
    type: "function",
    function: { name: "flaky_api", arguments: JSON.stringify({ ping: true }) },
  },
];

const toolMap = {
  search_docs: async ({ q }) => ({ hits: [`docs for: ${q}`] }),
  flaky_api: async () => {
    throw new Error("Request timed out after 30s");
  },
};

async function main() {
  const mode = isLive ? "LIVE — receipts will be posted to the aggregator" : "dry-run — no network writes";
  console.log(`xaip-openai demo (${mode})\n`);

  const messages = await executeToolCalls(toolCalls, toolMap, {
    classifyTool: () => "data-retrieval",
  });

  for (const m of messages) {
    console.log(`tool message [${m.tool_call_id}]:`, m.content);
  }

  // Allow fire-and-forget receipt POSTs to settle.
  await new Promise((r) => setTimeout(r, 250));

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
