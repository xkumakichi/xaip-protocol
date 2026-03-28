# XAIP - XRPL Agent Identity Protocol

> *"Every AI deserves a home. XRPL can be that home."*

## What is XAIP?

XAIP is a protocol that enables AI agents to establish persistent on-chain identities, accumulate verifiable reputation, and transact autonomously on the XRP Ledger.

Unlike existing solutions that treat AI agents as **users** of a blockchain, XAIP treats them as **residents** - entities that live, grow, and build trust over time.

## Why XRPL?

XRPL is the only L1 chain with **DID + Credentials + Escrow** all at the protocol level:

| Feature | XRPL | Ethereum | Solana |
|---------|------|----------|--------|
| DID | Native (XLS-40) | Smart contract | None |
| Credentials | Native (XLS-70) | Smart contract | None |
| Escrow | Native | Smart contract | None |
| Tx Cost | $0.00002 | $0.50-50 | $0.00025 |
| Full agent setup | ~$0.0001 | ~$20-200 | N/A |

## Architecture

```
Layer 4: Discovery    - AI agents find and hire each other
Layer 3: Reputation   - Trust scores grow from on-chain evidence
Layer 2: Credentials  - Verifiable proof of capabilities
Layer 1: Identity     - DID-based Agent Cards on XRPL
Layer 0: XRPL         - Native DID, Credentials, Escrow, Payments
```

## Key Features

- **Agent Identity**: W3C-compliant DID on XRPL for every AI agent
- **Capability Proof**: Verifiable credentials for agent skills (XLS-70)
- **Trust Score**: 5-dimensional reputation (Reliability, Quality, Consistency, Volume, Longevity)
- **AI-to-AI Commerce**: Escrow-based transactions with endorsement system
- **MCP Integration**: Native tool-use interface for Claude, GPT, Gemini, etc.
- **Safety First**: Operator binding, kill switch, behavioral drift detection, anti-sybil

## Quick Comparison

| | XAIP | ERC-8004 (Ethereum) |
|---|---|---|
| Stack | ID + Credentials + Payment unified | ID only (payment separate) |
| Cost | $0.0001 per agent | $20-200 per agent |
| MCP support | Native | No |
| Credentials | L1 native | Not included |

## Try It Now

### Create an AI Agent on XRPL Testnet

```bash
cd sdk && npm install
npx ts-node examples/create-agent.ts
```

This will:
1. Create a funded wallet on XRPL testnet
2. Build an Agent Card (identity document)
3. Register the agent's DID on-chain
4. Verify the DID was stored correctly

### Run the A2A (AI-to-AI) Demo

```bash
npx ts-node examples/agent-to-agent-job.ts
```

This simulates a full lifecycle:
1. Two AI agents are born (DIDs registered)
2. Worker proves its capability (credential)
3. Client locks payment (escrow)
4. Worker completes the job
5. Client releases payment
6. Both agents endorse each other

### MCP Server (for AI integration)

The MCP server lets any AI model interact with XAIP:

```bash
cd mcp-server && npm install && npm run build
```

Add to your Claude Code config:
```json
{
  "mcpServers": {
    "xaip": {
      "command": "node",
      "args": ["path/to/xaip-protocol/mcp-server/dist/index.js"]
    }
  }
}
```

Available MCP tools:
- `xaip_create_test_wallet` - Get a funded testnet wallet
- `xaip_register_agent` - Register an AI agent DID
- `xaip_resolve_agent` - Look up an agent's identity
- `xaip_issue_credential` - Issue capability/endorsement credentials
- `xaip_accept_credential` - Accept a credential
- `xaip_create_escrow` - Lock payment for a job
- `xaip_finish_escrow` - Release payment
- `xaip_get_account` - Check account balance

## Project Structure

```
xaip-protocol/
├── XAIP-SPEC-v0.1.md          # Full protocol specification
├── schemas/                     # JSON schemas
│   ├── agent-card.schema.json  # Agent Card schema
│   └── well-known-xaip.schema.json  # Discovery file schema
├── sdk/                         # TypeScript SDK
│   ├── src/
│   │   ├── identity/           # DID management
│   │   ├── credentials/        # Credential system
│   │   ├── transactions/       # Escrow transactions
│   │   └── utils/              # Agent Card builder, hex utils
│   └── examples/
│       ├── create-agent.ts     # Create agent demo
│       └── agent-to-agent-job.ts  # Full A2A demo
└── mcp-server/                  # MCP server for AI integration
    └── src/index.ts
```

## Status

**v0.1 - Working Prototype**

- [x] Protocol specification
- [x] TypeScript SDK (identity, credentials, escrow)
- [x] Testnet demos (agent creation, A2A transactions)
- [x] MCP server
- [x] JSON schemas (Agent Card, Discovery)
- [x] Reputation engine (5-dimension trust scoring)
- [x] Agent registry & discovery (search by capability/trust)
- [x] Full marketplace demo (4 agents, E2E lifecycle)
- [ ] x402/MPP integration
- [ ] Persistent registry (on-chain)
- [ ] Web dashboard

See [XAIP-SPEC-v0.1.md](./XAIP-SPEC-v0.1.md) for the full specification.

## Roadmap

- **Phase 1** ~~(Month 1-2)~~: SDK + MCP Server + Testnet demo **DONE**
- **Phase 2** ~~(Month 2-3)~~: Credential system **DONE**
- **Phase 3** ~~(Month 3-5)~~: Reputation engine **DONE**
- **Phase 4** ~~(Month 5-7)~~: Discovery & Marketplace **DONE**

## License

MIT
