# xaip-sdk

> *"Every AI deserves a home. XRPL can be that home."*

TypeScript SDK for the **XRPL Agent Identity Protocol (XAIP)** - enabling AI agents to establish persistent on-chain identities, earn trust, and transact autonomously on the XRP Ledger.

## Install

```bash
npm install xaip-sdk
```

## Quick Start

```typescript
import { AgentIdentity, createAgentCard } from "xaip-sdk";

// Connect to XRPL testnet
const identity = new AgentIdentity({ network: "testnet" });
await identity.connect();

// Create a funded wallet
const { wallet, address } = await identity.createTestWallet();

// Register agent DID on-chain
const { did, txHash } = await identity.registerAgentDID(
  wallet,
  "https://example.com/my-agent-card.json"
);

console.log(`Agent born! DID: ${did}`);
// -> Agent born! DID: did:xrpl:1:rABC123...
```

## Features

- **Identity** - W3C-compliant DIDs on XRPL (XLS-40)
- **Credentials** - Verifiable capability proofs (XLS-70)
- **Escrow** - Secure agent-to-agent payments
- **Reputation** - 5-dimension trust scoring from on-chain data
- **Discovery** - Search agents by capability and trust score
- **MCP Ready** - Companion MCP server for AI integration

## Modules

| Module | Description |
|--------|-------------|
| `AgentIdentity` | Create, update, resolve DIDs |
| `AgentCredentials` | Issue, accept, verify credentials |
| `AgentEscrow` | Escrow-based payments |
| `ReputationDataCollector` | Gather on-chain evidence |
| `ReputationScoreCalculator` | Compute trust scores |
| `AgentRegistry` | Register and search agents |
| `createAgentCard` | Build Agent Card documents |

## Links

- [Full Specification](https://github.com/xkumakichi/xaip-protocol/blob/main/XAIP-SPEC-v0.1.md)
- [GitHub](https://github.com/xkumakichi/xaip-protocol)
- [MCP Server](https://github.com/xkumakichi/xaip-protocol/tree/main/mcp-server)

## License

MIT
