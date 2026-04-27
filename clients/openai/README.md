# xaip-openai

> XAIP wrapper for OpenAI tool calling — every tool execution becomes a signed XAIP receipt.

Zero-dep, drop-in trust telemetry for any OpenAI-compatible tool-calling loop. Works with `openai`, Azure OpenAI, Groq, Together, or any provider implementing the OpenAI tool-calling shape.

## Why

When OpenAI returns `tool_calls`, your code decides how to execute them. That's also where you need to know: did it succeed? how long? is this tool reliable? XAIP gives every call a signed, verifiable receipt and aggregates them into live trust scores at https://xaip-trust-api.kuma-github.workers.dev.

This package wraps the execution boundary so every call produces a receipt automatically.

## Install

```bash
npm install xaip-openai
```

No runtime dependencies. Requires Node >= 18.

## Usage — wrap the whole loop

```js
const OpenAI = require("openai");
const { executeToolCalls } = require("xaip-openai");

const openai = new OpenAI();

const toolMap = {
  get_weather: async ({ city }) => ({ temp: 22, city }),
  search_docs: async ({ q }) => ({ hits: ["..."] }),
};

const resp = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages,
  tools: [
    { type: "function", function: { name: "get_weather", parameters: {/*...*/} } },
    { type: "function", function: { name: "search_docs",  parameters: {/*...*/} } },
  ],
});

const toolCalls = resp.choices[0].message.tool_calls || [];
const toolMessages = await executeToolCalls(toolCalls, toolMap);
messages.push(resp.choices[0].message, ...toolMessages);
```

Every tool call inside `executeToolCalls` emits one signed XAIP receipt.

## Usage — wrap a single call

If you already have a custom loop:

```js
const { runWithXAIP } = require("xaip-openai");

const result = await runWithXAIP({
  toolName: "get_weather",
  input: args,
  run: () => getWeather(args),
});
```

## What gets emitted

For each tool call, one receipt:

| Field | Source |
|---|---|
| `toolName` | function name from the tool call |
| `taskHash` | SHA-256 of parsed arguments (truncated 16 hex) |
| `resultHash` | SHA-256 of output (truncated 16 hex) |
| `success` | `true` if `run()` resolved, `false` if it threw |
| `latencyMs` | wall-clock duration of `run()` |
| `failureType` | inferred from error message (`timeout`, `rate_limit`, `auth`, `validation`, `tool_error`) |
| `agentDid` | per-tool `did:web:oai-<slug>`, persisted in `~/.xaip/openai-keys.json` |
| `callerDid` | shared `did:key:...`, persisted in `~/.xaip/openai-keys.json` |
| `signature` / `callerSignature` | Ed25519 over canonical (JCS) payload |

## Privacy

- Only **hashes** of input/output are sent (`SHA-256` truncated to 16 hex). Actual arguments and results never leave your process.
- No prompts, no completions, no chat history is transmitted.
- Receipt posting is **fire-and-forget**: tool latency in your user path is not blocked on the aggregator response.
- Disable any time: `XAIP_DISABLED=1` env var, or `{ disabled: true }` in options.

## Tool class hints (XAIP v0.5 forward-compat)

If you classify your tools, future v0.5 aggregator support can apply class-aware risk evaluation (see [XAIP-SPEC v0.5 draft](../../XAIP-SPEC-v0.5-DRAFT.md)):

```js
await executeToolCalls(toolCalls, toolMap, {
  classifyTool: (name) => {
    if (name === "send_payment") return "settlement";
    if (name === "search_docs")  return "data-retrieval";
    if (name === "execute_sql")  return "mutation";
    return "advisory";
  },
});
```

The hint is attached to the receipt as `receipt.toolMetadata.xaip.class` and ignored by aggregators that don't yet support v0.5.

## Configuration

| Option | Env var | Default | Purpose |
|---|---|---|---|
| `aggregatorUrl` | `XAIP_AGGREGATOR_URL` | `https://xaip-aggregator.kuma-github.workers.dev` | Override aggregator endpoint |
| `disabled` | `XAIP_DISABLED=1` | `false` | Disable receipt emission |
| `classifyTool` | — | none | Per-tool class hint |

## Files written

| Path | Purpose |
|---|---|
| `~/.xaip/openai-keys.json` | Persisted Ed25519 caller + per-tool agent keys |
| `~/.xaip/openai.log` | Local emission log (no PII; `tail -f` to monitor) |

Both are local-only and never transmitted.

## Status

**v0.1.0 — preview.** API may change before 1.0. Receipt format is stable (XAIP v0.4 spec).

## Related

- [xaip-claude-hook](../claude-code-hook/) — same idea for Claude Code MCP calls
- [xaip-langchain](../langchain/) — callback handler for LangChain.js agents
- [xaip-sdk](https://www.npmjs.com/package/xaip-sdk) — full TypeScript SDK
- [XAIP Protocol](https://github.com/xkumakichi/xaip-protocol) — spec, infrastructure, live trust scores

## License

MIT
