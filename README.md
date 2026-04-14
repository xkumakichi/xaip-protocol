# XAIP — Trust Infrastructure for AI Agents

> Your AI agent picks tools blind. XAIP gives it eyes.

When an AI agent delegates work to an MCP server, it has no idea whether that server is reliable. XAIP fixes this with cryptographically signed execution receipts, Bayesian trust scoring, and a decision engine that picks the best candidate — live, right now.

## Try It Now

The API is live. No signup, no API key.

```bash
# Check trust score for an MCP server
curl https://xaip-trust-api.kuma-github.workers.dev/v1/trust/context7

# Batch query
curl "https://xaip-trust-api.kuma-github.workers.dev/v1/trust?slugs=context7,sequential-thinking,filesystem"

# Decision engine: pick the best server for a task
curl -X POST https://xaip-trust-api.kuma-github.workers.dev/v1/select \
  -H "Content-Type: application/json" \
  -d '{"task":"Fetch React docs","candidates":["context7","sequential-thinking","unknown-server"]}'
```

The `/v1/select` response tells you which server to use, why, and what would happen without XAIP:

```json
{
  "selected": "context7",
  "reason": "Highest trust (1) from 248 verified executions",
  "rejected": [{ "slug": "unknown-server", "reason": "unscored — no execution data" }],
  "withoutXAIP": "Random selection would pick an unscored server 33% of the time — no execution data, no safety guarantee"
}
```

## The Problem

Without trust scores, your agent is gambling:

```
┌────────────────┬────────────────┬───────────┬──────────────┐
│ Strategy       │ Server Hit     │ Success   │ Latency      │
├────────────────┼────────────────┼───────────┼──────────────┤
│ With XAIP      │ context7       │ ✓         │ ~3s          │
│ Random         │ unknown-mcp    │ ✗ error   │ ~8s (wasted) │
│ Try all (seq)  │ 3 servers      │ 1/3       │ ~11s total   │
└────────────────┴────────────────┴───────────┴──────────────┘
```

XAIP selects the right server on the first try, skips unscored servers, and saves your agent from wasted calls and silent failures.

## How It Works

```
1. Select    POST /v1/select → picks the best server from candidates
2. Execute   Your agent calls the selected MCP server
3. Report    POST /receipts → signed execution receipt feeds back into trust scores
```

Every execution receipt is Ed25519-signed and verified. Trust scores are computed using a Bayesian model with caller diversity weighting — not self-reported metrics.

## Quick Start

### Run the end-to-end demo

```bash
git clone https://github.com/xkumakichi/xaip-protocol.git
cd xaip-protocol/demo
npm install
npx tsx dogfood.ts
```

This demo:
1. Asks XAIP to select the best server for "Fetch React hooks documentation"
2. Connects to the selected MCP server and executes real tool calls
3. Submits a signed execution receipt to the Aggregator
4. Shows the updated trust score

### Use the SDK

```bash
npm install xaip-sdk
```

```typescript
import { XAIPClient } from "xaip-sdk";

const client = new XAIPClient();

// Pick the best server
const decision = await client.select({
  task: "Fetch React documentation",
  candidates: ["context7", "sequential-thinking", "unknown-server"],
});

console.log(decision.selected);    // "context7"
console.log(decision.withoutXAIP); // "Random selection would pick an unscored server 33% of the time..."
```

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/v1/trust/:slug` | Trust score for a single MCP server |
| `GET` | `/v1/trust?slugs=a,b,c` | Batch trust scores (max 50) |
| `POST` | `/v1/select` | Decision engine — pick best candidate for a task |
| `GET` | `/health` | Liveness probe |

**Base URL:** `https://xaip-trust-api.kuma-github.workers.dev`

### Trust Score Response

| Field | Type | Description |
|-------|------|-------------|
| `trust` | `number \| null` | 0.0–1.0 score, null if unscored |
| `verdict` | `string` | `trusted` ≥0.7 · `caution` 0.4–0.7 · `low_trust` <0.4 · `unscored` |
| `receipts` | `number` | Total verified execution receipts |
| `confidence` | `number \| null` | Statistical confidence: min(1, receipts/100) |
| `riskFlags` | `string[]` | Detected risk indicators |
| `computedFrom` | `string` | Data provenance description |

### Decision Engine (`POST /v1/select`)

**Request:**

```json
{
  "task": "description of what your agent needs to do",
  "candidates": ["server-a", "server-b", "server-c"],
  "mode": "relative"
}
```

- `mode: "relative"` (default) — always selects the best available, even if below threshold
- `mode: "strict"` — rejects all candidates below caution threshold

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Your AI Agent                                           │
│  ┌──────────┐   ┌───────────┐   ┌─────────────────────┐ │
│  │ Select   │──▶│ Execute   │──▶│ Report Receipt      │ │
│  │ (Trust   │   │ (MCP call)│   │ (Ed25519 signed)    │ │
│  │  API)    │   └───────────┘   └──────────┬──────────┘ │
│  └────┬─────┘                              │            │
└───────┼────────────────────────────────────┼────────────┘
        │                                    │
        ▼                                    ▼
┌───────────────┐                 ┌──────────────────────┐
│  Trust API    │◀────────────────│  Aggregator (BFT)    │
│  + Decision   │  Service        │  Cloudflare D1       │
│    Engine     │  Binding        │  Ed25519 verification│
└───────────────┘                 │  Bayesian scoring    │
                                  └──────────────────────┘
```

**Trust Model:**
- Bayesian Beta distribution (prior varies by DID method)
- Caller diversity weighting (prevents single-caller gaming)
- Co-signature factor (dual Ed25519: agent + caller)
- BFT federation with MAD outlier detection across aggregator nodes

**Infrastructure:**
- Cloudflare Workers (global edge, <50ms latency)
- Cloudflare D1 (SQLite at edge) for receipt storage
- Service Bindings for Worker-to-Worker communication

## XRPL Integration

XAIP supports `did:xrpl` identities with higher trust priors than anonymous `did:key`:

| DID Method | Trust Prior | Use Case |
|------------|------------|----------|
| `did:xrpl` | [5, 1] | XRPL account-backed agents |
| `did:web` | [2, 1] | Domain-verified servers |
| `did:key` | [1, 1] | Anonymous / new agents |

XRPL's native DID support (XLS-40) makes it a natural foundation for agent identity in autonomous transactions.

## Data

Trust scores are computed from real execution data, not synthetic benchmarks:

- **1,127** real MCP tool-call executions monitored via [Veridict](https://github.com/xkumakichi/veridict)
- **3** MCP servers scored: context7, sequential-thinking, filesystem
- **1,033** signed receipts stored in the Aggregator
- Scores update with every new execution receipt

## Status

**v0.4.0** — Live infrastructure

- [x] Trust Score API (Cloudflare Worker, live)
- [x] Decision Engine (`POST /v1/select`)
- [x] Aggregator with BFT federation (Cloudflare D1)
- [x] Ed25519 receipt signing + verification
- [x] Bayesian trust model with caller diversity
- [x] Real execution data (1,127 tool calls)
- [x] End-to-end dogfooding demo
- [x] npm: [xaip-sdk@0.4.0](https://www.npmjs.com/package/xaip-sdk)
- [ ] Multi-user caller diversity (currently single-operator)
- [ ] Platform integrations (Smithery, Glama)
- [ ] Web dashboard

## Related

- [Veridict](https://github.com/xkumakichi/veridict) — AI agent trust decision layer (runtime monitoring)
- [XAIP Specification](./XAIP-SPEC-v0.1.md) — Full protocol specification

## License

MIT
