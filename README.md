# XAIP — Trust Infrastructure for AI Agents

> Your AI agent picks tools blind. XAIP gives it eyes.

When an AI agent delegates work to an external tool, it has no idea whether that tool will succeed, fail silently, or burn latency. XAIP fixes this with cryptographically signed execution receipts, Bayesian trust scoring, and a decision engine that picks the best candidate — live, right now.

**Provider-agnostic by design.** XAIP is a trust layer for any tool-using agent. The reference implementation and live data start with **MCP** (Model Context Protocol) — because that's where the broadest fleet of public tool servers exists today — but the receipt format, signing, and scoring apply equally to LangChain tools, OpenAI function calling, A2A, and proprietary agent stacks. MCP is the first integration, not the only one.

**Live dashboard:** https://xkumakichi.github.io/xaip-protocol/ — current public trust scores, auto-refreshed, no auth. The current public dataset is MCP-heavy because MCP was the first integration target.

### Entry points

- [60-second overview](./docs/agent-trust-overview.md) — the problem XAIP is trying to address.
- [Future direction](./docs/future-direction.md) — long-term hypothesis, open questions, and current research asks.
- [Agent Trust Check design](./docs/agent-trust-check-design.md) — planned diagnostic concept.
- [Emit receipts from anything](./docs/emit-from-anything.md) — how to produce XAIP receipts from any tool system.
- [Run xaip-caller](./docs/run-xaip-caller.md) — contribute signed receipts without running MCP.

## Try It Now

The API is live. No signup, no API key.

```bash
# Check trust score for a scored tool server
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
  "reason": "Highest trust among scored candidates based on current verified receipts",
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
2. Execute   Your agent calls the selected tool server
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

### Decision quality demo

Compare blind selection strategies against XAIP-guided selection using a static trust snapshot and fixed candidate sets:

```bash
cd demo
npm run blind-vs-xaip
```

This is a deterministic local replay. It does not perform live tool execution, post receipts, or call any external API.
See [docs/blind-vs-xaip-demo.md](./docs/blind-vs-xaip-demo.md) for scope, metrics, and limitations.

In the included snapshot replay:

| Strategy    | Risky pick rate | Eligible pick rate |
|-------------|----------------:|-------------------:|
| Random      |           71.4% |              28.6% |
| Fixed-order |           85.7% |              14.3% |
| XAIP        |           14.3% |              85.7% |

`risky_pick` = selected candidate was `low_trust` or `unscored` in the snapshot. `fixed-order` models an agent that accepts the upstream planner's candidate order without runtime trust data. The claim is limited to this fixed candidate set and static trust snapshot — not a guarantee of real-world execution improvement.

### Become an independent caller

Want the trust graph to depend on more than one operator? Run a caller yourself. No account, no approval, no API key — the aggregator verifies signatures from any valid keypair.

**Fastest — zero-install, 30 seconds:**

```bash
npx xaip-caller
```

Signs receipts for a handful of real HTTP tool calls and POSTs them. Demonstrates that XAIP works beyond MCP — any HTTP tool can participate. See [clients/caller](./clients/caller/).
See [Run xaip-caller](./docs/run-xaip-caller.md) for Windows notes and external receipt contribution details.

**Full path — MCP servers, 5 minutes:**

Clone the repo and run the auto-collector against real MCP servers. Your caller DID contributes to the diversity of every scored MCP tool. See [docs/contributor/run-a-caller.md](./docs/contributor/run-a-caller.md).

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

## MCP Server

Use XAIP directly from Claude, Cursor, or any MCP-compatible AI agent:

```bash
npx xaip-mcp-trust
```

4 tools: `xaip_list_servers`, `xaip_check_trust`, `xaip_select`, `xaip_report`

Add to Claude Code (`~/.claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "xaip-trust": {
      "command": "npx",
      "args": ["-y", "xaip-mcp-trust"]
    }
  }
}
```

npm: [xaip-mcp-trust](https://www.npmjs.com/package/xaip-mcp-trust)

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/v1/servers` | List all scored servers with trust data |
| `GET` | `/v1/trust/:slug` | Trust score for a single scored server |
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
- BFT-capable federation with MAD outlier detection across aggregator nodes; the current public deployment is a single aggregator (`quorum:1`)

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

- **~2,600** signed receipts across **10** scored MCP servers as of 2026-04-24: context7, sequential-thinking, memory, filesystem, everything, fetch, sqlite, git, puppeteer, playwright
- Automated daily data collection via GitHub Actions
- Scores update with every new execution receipt; see the live dashboard/API for current values

```bash
# See all scored servers
curl https://xaip-trust-api.kuma-github.workers.dev/v1/servers
```

## Works With

| Provider | Status | How |
|---|---|---|
| **MCP** (Model Context Protocol) | ✅ live | `xaip-claude-hook` for Claude Code; `xaip-sdk` for any MCP client; 10 servers scored, ~2,600 signed receipts as of 2026-04-24 |
| **LangChain** | ✅ published preview | `xaip-langchain` receipt producer for LangChain.js tool calls |
| **OpenAI tool calling** | ✅ published preview | `xaip-openai` receipt producer for OpenAI-compatible tool-call loops |
| **A2A / proprietary** | ✅ supported | Use `xaip-sdk` directly — receipt format is provider-neutral |

The receipt schema is intentionally tool-system-agnostic: `agentDid`, `callerDid`, `taskHash`, `resultHash`, `success`, `latencyMs`, `failureType`, `timestamp`. Any agent framework that can hash inputs/outputs and sign with Ed25519 can contribute receipts.

See [Emit XAIP receipts from anything](./docs/emit-from-anything.md) for the provider-neutral receipt flow.

## Status

**v0.4.0** live; **v0.5 Release Candidate** open for review (adds tool class taxonomy with settlement-layer support).

- [x] Trust Score API (Cloudflare Worker, live)
- [x] Decision Engine (`POST /v1/select`)
- [x] Aggregator with BFT-capable federation support (public deployment currently single aggregator / `quorum:1`)
- [x] Ed25519 receipt signing + verification
- [x] Bayesian trust model with caller diversity
- [x] ~2,600 signed receipts across 10 scored MCP servers as of 2026-04-24
- [x] Automated daily data collection (GitHub Actions)
- [x] Published preview receipt producers: [xaip-langchain](https://www.npmjs.com/package/xaip-langchain), [xaip-openai](https://www.npmjs.com/package/xaip-openai)
- [x] MCP Server: [xaip-mcp-trust](https://www.npmjs.com/package/xaip-mcp-trust)
- [x] npm: [xaip-sdk@0.4.0](https://www.npmjs.com/package/xaip-sdk)
- [x] v0.5 draft: tool class taxonomy + class-aware risk evaluation design
- [x] Multi-caller diversity mechanism verified ([2+ caller identities, metric responds across 8 servers](./docs/contributor/caller-diversity-verification.md))
- [ ] v0.5 class metadata plumbing
- [ ] Class-aware risk evaluation in aggregator
- [x] Zero-install caller path: [`npx xaip-caller`](./clients/caller/) (30-second first contribution, demonstrates XAIP beyond MCP)
- [ ] External operator callers (mechanism live, external adoption pending — run `npx xaip-caller` or the [full guide](./docs/contributor/run-a-caller.md))

## Writing

- **Portable Trust** — why trust infrastructure for AI agents must be provider-neutral and behavior-derived ([dev.to](https://dev.to/xkumakichi/portable-trust-o4o) · [Zenn 日本語版](https://zenn.dev/xkumakichi/articles/e93a438265a682))

## Related

- [xaip-caller](./clients/caller/) — zero-install CLI: `npx xaip-caller` to contribute to the trust graph
- [xaip-mcp-trust](https://www.npmjs.com/package/xaip-mcp-trust) — MCP server for AI agents to check trust scores
- [xaip-langchain](https://www.npmjs.com/package/xaip-langchain) — LangChain.js callback handler that emits XAIP receipts
- [xaip-openai](https://www.npmjs.com/package/xaip-openai) — OpenAI tool-calling wrapper with signed receipts
- [Veridict](https://github.com/xkumakichi/veridict) — AI agent trust decision layer (runtime monitoring)
- [XAIP Specification v0.4](./XAIP-SPEC.md) — Current protocol specification
- [XAIP Specification v0.5 RC](./XAIP-SPEC-v0.5-DRAFT.md) — Release candidate (tool class taxonomy)

## License

MIT
