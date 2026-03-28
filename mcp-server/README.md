# xaip-mcp-server

MCP server for the **XRPL Agent Identity Protocol (XAIP)**.

Lets any AI (Claude, GPT, Gemini, etc.) create identities, verify credentials, build trust, and transact autonomously on the XRP Ledger.

## Install

```bash
npm install -g xaip-mcp-server
```

## Setup with Claude Code

Add to your Claude Code MCP config:

```json
{
  "mcpServers": {
    "xaip": {
      "command": "xaip-mcp-server"
    }
  }
}
```

## Available Tools

| Tool | Description |
|------|-------------|
| `xaip_connect` | Connect to XRPL (testnet/devnet/mainnet) |
| `xaip_create_test_wallet` | Get a funded testnet wallet |
| `xaip_register_agent` | Register an AI agent DID on-chain |
| `xaip_resolve_agent` | Look up an agent's identity |
| `xaip_issue_credential` | Issue capability/endorsement credentials |
| `xaip_accept_credential` | Accept a credential |
| `xaip_create_escrow` | Lock payment for a job |
| `xaip_finish_escrow` | Release payment to worker |
| `xaip_get_reputation` | Get agent's trust score (0-100) |
| `xaip_get_account` | Check account balance |

## Links

- [XAIP SDK](https://www.npmjs.com/package/xaip-sdk)
- [Full Specification](https://github.com/xkumakichi/xaip-protocol/blob/main/XAIP-SPEC-v0.1.md)
- [GitHub](https://github.com/xkumakichi/xaip-protocol)

## License

MIT
