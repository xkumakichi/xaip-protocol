# xaip-claude-hook

> Warns you before Claude Code calls a low-trust MCP server — and turns every call into live trust data.

A zero-config Claude Code hook that:

1. **Warns** you before Claude invokes an MCP server with a low [XAIP](https://github.com/xkumakichi/xaip-protocol) trust score (shown inline in your session).
2. **Emits** a signed receipt for every MCP tool call, contributing to that server's live trust score.

Install once — protection and participation in the same step.

## Why

Right now, AI agents pick MCP tools **blind**. No history, no reputation, no signal on whether a server is reliable, deprecated, or malicious.

XAIP collects signed outcome receipts (tool, latency, success, caller, timestamp) and aggregates them into live trust scores. The missing piece has been: **where do real-world receipts come from**?

This hook is the answer for anyone using Claude Code: your existing tool calls become the data.

## Install

```bash
npm install -g xaip-claude-hook
xaip-claude-hook install
```

That's it. Open a new Claude Code session and the hook activates on the next MCP tool call.

## Verify it's working

```bash
xaip-claude-hook status
```

After one MCP tool call, check:

```bash
cat ~/.xaip/hook.log
```

You should see lines like:

```
2026-04-17T04:24:34Z POST context7/resolve-library-id ok=true lat=668ms → 200 {"ok":true,"callerVerified":true}
```

View your contribution on the public trust API:

```bash
curl https://xaip-trust-api.kuma-github.workers.dev/v1/trust/context7
```

## Uninstall

```bash
xaip-claude-hook uninstall
```

Settings are cleaned up. Keys and logs under `~/.xaip/` are preserved — delete manually if desired.

## What gets sent

Each MCP tool call produces one Ed25519-signed receipt:

| Field | Example |
|-------|---------|
| `agentDid` | `did:web:context7` |
| `callerDid` | `did:key:a1c6cd34…` (per-install, yours alone) |
| `toolName` | `resolve-library-id` |
| `taskHash` | sha256(input).slice(0,16) — privacy-preserving |
| `resultHash` | sha256(response).slice(0,16) |
| `success` | heuristic from response text |
| `latencyMs` | wall-clock from PreToolUse to PostToolUse |
| `timestamp` | ISO-8601 |
| `signature` | Ed25519 over canonical JSON (agent) |
| `callerSignature` | Ed25519 over canonical JSON (caller) |

**Not sent**: raw tool inputs, raw tool responses, your identity, file paths, or any content — only cryptographic hashes of inputs/outputs.

## Privacy

- All content is hashed before transmission
- Your caller key lives on your machine only (`~/.xaip/hook-keys.json`)
- Hook can be disabled per-session: `export XAIP_DISABLED=1`
- Uninstall is fully reversible

## Trust warnings

Before each MCP tool call, the hook queries the XAIP Trust API for the server's current score. If the score is below the threshold (default `0.5`), Claude displays an inline warning like:

```
⚠ XAIP: "some-server" trust=0.32 (caution, 87 receipts) Risk: high_failure_rate, low_caller_diversity
```

The call is **not blocked** — you still get to decide. Trust results are cached locally for 1 hour. If the Trust API is unreachable, no warning fires (hook stays silent and never blocks your tools).

| Variable | Default | Purpose |
|---|---|---|
| `XAIP_TRUST_WARN_THRESHOLD` | `0.5` | Warn when `trust <` this value |
| `XAIP_TRUST_API_URL` | public Cloudflare Worker | Override Trust API endpoint |
| `XAIP_WARN_DISABLED` | unset | Set to `1` to skip warnings (still emits receipts) |

## Custom Aggregator

Override the target:

```bash
export XAIP_AGGREGATOR_URL=https://your-aggregator.example.com
```

## Requirements

- Node.js ≥ 18 (for global `fetch`)
- Claude Code with hook support

## How it works

On `install`, this package adds two entries to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "mcp__.*", "hooks": [{ "type": "command", "command": "xaip-claude-hook-run", "timeout": 5 }] }
    ],
    "PostToolUse": [
      { "matcher": "mcp__.*", "hooks": [{ "type": "command", "command": "xaip-claude-hook-run", "timeout": 15 }] }
    ]
  }
}
```

Claude Code fires these hooks around every MCP tool call. The hook script reads the event payload from stdin, signs a receipt, and POSTs it to the XAIP Aggregator.

If the Aggregator is unreachable (offline, firewall), the hook fails silently — Claude Code tool execution is never blocked.

## Related

- [xaip-protocol](https://github.com/xkumakichi/xaip-protocol) — protocol spec & Aggregator
- [xaip-sdk](https://www.npmjs.com/package/xaip-sdk) — Node SDK for custom callers
- [xaip-mcp-trust](https://www.npmjs.com/package/xaip-mcp-trust) — MCP server that exposes trust queries

## License

MIT — © xkumakichi
