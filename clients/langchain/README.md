# xaip-langchain

> XAIP callback handler for LangChain.js — every tool invocation becomes a signed XAIP receipt.

Drop-in trust telemetry for LangChain agents. No tool wrapping, no code changes to existing tools — just attach the callback handler.

## Why

LangChain agents call tools blind. You don't know which tool failed silently, which one is slow, which one is reliable. XAIP gives every call a signed, verifiable receipt, and aggregates those receipts into live trust scores at https://xaip-trust-api.kuma-github.workers.dev.

This package makes that automatic for any LangChain.js agent.

## Install

```bash
npm install xaip-langchain
```

Peer dependency: `@langchain/core >= 0.3.0` (already in your project if you're using LangChain).

## Usage

```js
const { XAIPCallbackHandler } = require("xaip-langchain");
const { AgentExecutor } = require("langchain/agents");

const handler = new XAIPCallbackHandler();

const result = await agentExecutor.invoke(
  { input: "Find the React hooks docs" },
  { callbacks: [handler] }
);
```

That's it. Every `tool.invoke(...)` inside the agent run produces a signed Ed25519 receipt and POSTs it to the XAIP aggregator. Trust scores update live.

## What gets emitted

For each LangChain tool call, one receipt:

| Field | Source |
|---|---|
| `toolName` | `tool.name` |
| `taskHash` | SHA-256 of `input` (truncated 16 hex) |
| `resultHash` | SHA-256 of `output` (truncated 16 hex) |
| `success` | `true` for `handleToolEnd`, `false` for `handleToolError` |
| `latencyMs` | `handleToolEnd/Error` timestamp − `handleToolStart` timestamp |
| `failureType` | inferred from error message (`timeout`, `rate_limit`, `auth`, `validation`, `tool_error`) |
| `agentDid` | per-tool `did:web:lc-<slug>`, persisted in `~/.xaip/langchain-keys.json` |
| `callerDid` | shared `did:key:...`, persisted in `~/.xaip/langchain-keys.json` |
| `signature` / `callerSignature` | Ed25519 over canonical (JCS) payload |

## Privacy

- Only **hashes** of input/output are sent (`SHA-256` truncated to 16 hex). The actual tool inputs/outputs never leave your process.
- No prompts, no agent reasoning, no user data is transmitted.
- Disable any time: `XAIP_DISABLED=1` env var, or `new XAIPCallbackHandler({ disabled: true })`.

## Tool class hints (XAIP v0.5 forward-compat)

If you classify your tools, the aggregator can apply class-aware risk evaluation (see [XAIP-SPEC v0.5 draft](../../XAIP-SPEC-v0.5-DRAFT.md)):

```js
const handler = new XAIPCallbackHandler({
  classifyTool: (name) => {
    if (name === "xrpl_payment") return "settlement";
    if (name === "doc_search") return "data-retrieval";
    return "advisory";
  },
});
```

The hint is attached to the receipt as `toolMetadata.xaip.class` and ignored by aggregators that don't yet support v0.5.

## Configuration

| Option | Env var | Default | Purpose |
|---|---|---|---|
| `aggregatorUrl` | `XAIP_AGGREGATOR_URL` | `https://xaip-aggregator.kuma-github.workers.dev` | Override aggregator endpoint |
| `disabled` | `XAIP_DISABLED=1` | `false` | Disable receipt emission |
| `classifyTool` | — | none | Per-tool class hint (advisory / data-retrieval / computation / mutation / settlement) |

## Files written

| Path | Purpose |
|---|---|
| `~/.xaip/langchain-keys.json` | Persisted Ed25519 caller + per-tool agent keys |
| `~/.xaip/langchain.log` | Local emission log (no PII; `tail -f` to monitor) |

Both are local-only and never transmitted.

## Status

**v0.1.0 — preview.** API may change before 1.0. The receipt format is stable (XAIP v0.4 spec).

## Related

- [xaip-claude-hook](../claude-code-hook/) — same idea for Claude Code MCP calls
- [xaip-sdk](https://www.npmjs.com/package/xaip-sdk) — full TypeScript SDK
- [XAIP Protocol](https://github.com/xkumakichi/xaip-protocol) — spec, infrastructure, live trust scores

## License

MIT
