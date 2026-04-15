# xaip-mcp-trust

MCP server that wraps the [XAIP Trust API](https://xaip-trust-api.kuma-github.workers.dev), giving AI agents native tool calls to check trust scores, select servers, and report execution results.

## Installation

```bash
npx xaip-mcp-trust
```

## Claude Code / Claude Desktop config

```json
{
  "mcpServers": {
    "xaip": {
      "command": "npx",
      "args": ["-y", "xaip-mcp-trust"]
    }
  }
}
```

## Tools

### `xaip_check_trust`
Check the trust score of an MCP server by slug.

```
xaip_check_trust({ slug: "context7" })
```

Returns: trust level (0–1), verdict (trusted / caution / low_trust / unscored), receipt count, confidence, and any risk flags.

---

### `xaip_select`
Select the most trustworthy MCP server from a list of candidates for a given task. Automatically excludes unscored and low-trust servers.

```
xaip_select({
  task: "Fetch React documentation",
  candidates: ["context7", "sequential-thinking", "unknown-server"],
  mode: "relative"   // or "strict"
})
```

Returns: selected server, reason, rejected list with reasons, per-candidate scores, and a comparison of what would happen without XAIP.

---

### `xaip_report`
Report the result of an MCP tool execution. Each report is Ed25519-signed and submitted to the XAIP Aggregator, contributing to the server's trust score.

```
xaip_report({
  server: "context7",
  tool: "query-docs",
  success: true,
  latencyMs: 420
})
```

Returns: confirmation of receipt submission with agent/caller DIDs and timestamp. Keys are generated fresh each session (not persisted), improving caller diversity.

## Links

- Main XAIP repo: https://github.com/xkumakichi/xaip-protocol
- Trust API: https://xaip-trust-api.kuma-github.workers.dev/v1/trust/context7
- Aggregator: https://xaip-aggregator.kuma-github.workers.dev
