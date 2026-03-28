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

## Status

**v0.1 - Draft Specification**

See [XAIP-SPEC-v0.1.md](./XAIP-SPEC-v0.1.md) for the full specification.

## Roadmap

- **Phase 1** (Month 1-2): SDK + MCP Server + Testnet demo
- **Phase 2** (Month 2-3): Credential system
- **Phase 3** (Month 3-5): Reputation engine
- **Phase 4** (Month 5-7): Discovery & Marketplace

## License

MIT
