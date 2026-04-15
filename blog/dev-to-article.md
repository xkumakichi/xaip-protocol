---
title: Stop Your AI Agent From Picking Broken MCP Servers
published: false
description: I connected my agent to 3 MCP servers. It picked one randomly and failed. The fix took one API call.
tags: ai, mcp, agents, trust
cover_image:
---

I connected my AI agent to 3 MCP servers.

It picked one at random.

It timed out. Then retried a different one. Then finally hit one that worked.

```
$ node without-xaip.js

→ Trying: unknown-server...
  ✗ error — package not found (8.2s)

→ Trying: sequential-thinking...
  ✓ connected — but wrong tool for docs task

→ Trying: context7...
  ✓ success (3.1s)

Total: 11.3 seconds, 2 wasted calls
```

There are over 1,000 MCP servers now. Your agent has no way to tell which ones are reliable, which ones are broken, and which ones are the right fit.

So I built a fix: one API call that picks the right server first.

```
$ node with-xaip.js

→ XAIP selected: context7 (trust: 1.0, 248 verified executions)
  ✓ success (3.1s)

Total: 3.1 seconds, 0 wasted calls
```

This is [XAIP](https://github.com/xkumakichi/xaip-protocol) — trust scoring for AI agents, backed by real execution data. Not benchmarks. Not self-reported metrics. Actual tool-call results, cryptographically signed.

## A live API you can try right now

No signup, no API key. Just curl:

```bash
# Trust score for a specific MCP server
curl https://xaip-trust-api.kuma-github.workers.dev/v1/trust/context7
```

```json
{
  "slug": "context7",
  "trust": 1.0,
  "verdict": "trusted",
  "receipts": 248,
  "confidence": 1,
  "source": "xaip-aggregator (quorum:1)",
  "riskFlags": [],
  "computedFrom": "248 receipts via XAIP Aggregator BFT (1 nodes)"
}
```

Or let XAIP pick the best server for your task:

```bash
curl -X POST https://xaip-trust-api.kuma-github.workers.dev/v1/select \
  -H "Content-Type: application/json" \
  -d '{
    "task": "Fetch React documentation",
    "candidates": ["context7", "sequential-thinking", "unknown-server"]
  }'
```

```json
{
  "selected": "context7",
  "reason": "Highest trust (1) from 248 verified executions",
  "rejected": [
    { "slug": "unknown-server", "reason": "unscored — no execution data" }
  ],
  "withoutXAIP": "Random selection would pick an unscored server 33% of the time — no execution data, no safety guarantee"
}
```

The `withoutXAIP` field exists to make the risk visible. It's the answer to "why do I need this?"

## How it works

XAIP has three moving parts:

**1. Trust API** — Returns trust scores for MCP servers. Scores come from real execution data, not self-reported metrics.

**2. Decision Engine** — `POST /v1/select` takes a task and a list of candidate servers, returns the best pick with reasoning. Unscored servers are automatically excluded.

**3. Aggregator** — Collects Ed25519-signed execution receipts. Every tool call produces a cryptographic receipt that feeds back into trust scores.

The trust model is Bayesian (Beta distribution), weighted by caller diversity to prevent single-caller gaming. If only one caller submits receipts for a server, the score reflects that limited evidence.

```
Select → Execute → Report
  ↑                    │
  └────────────────────┘
     scores improve
```

## The data is real

This isn't a mock API. Trust scores are computed from 1,127 actual MCP tool-call executions:

| Server | Trust | Receipts | Verdict |
|--------|-------|----------|---------|
| context7 | 1.000 | 248 | trusted |
| sequential-thinking | 1.000 | 285 | trusted |
| filesystem | 0.909 | 594 | caution |

Monitored via [Veridict](https://github.com/xkumakichi/veridict), a runtime execution monitor that tracks success rates, latency, and failure types.

`filesystem` scores lower because it has real failures in its history — that's the system working correctly. A trust score should reflect reality, not optimism.

## Try the full demo

The dogfooding demo runs the complete loop: select a server, execute MCP tool calls, submit a signed receipt, check the updated score.

```bash
git clone https://github.com/xkumakichi/xaip-protocol.git
cd xaip-protocol/demo
npm install
npx tsx dogfood.ts
```

Takes about 15 seconds. You'll see XAIP select `context7`, execute real tool calls against it, submit a receipt to the Aggregator, and print the comparison table.

## What's next

XAIP is at v0.4.0. The infrastructure is live and the data is real, but adoption is the bottleneck:

- **More servers** — Currently scoring 3 MCP servers. The system scales to any server, but needs execution data flowing in.
- **More callers** — Caller diversity is the main lever for score accuracy. More independent callers = higher confidence.
- **Platform integrations** — Working toward integration with MCP registries like Smithery.

If you're building AI agents that use MCP, you can start using the API today. Scores will keep improving as more execution data flows in.

## Why this matters beyond today

Right now, XAIP helps agents pick working tools.

But this becomes critical when agents start doing more than calling APIs — paying for services, delegating tasks across organizations, executing autonomous workflows.

At that point, the question changes from "does this tool work?" to "can I trust this agent with money?"

XAIP is designed for that future. But it already solves a real problem today.

## Links

- **API**: `https://xaip-trust-api.kuma-github.workers.dev`
- **GitHub**: [xkumakichi/xaip-protocol](https://github.com/xkumakichi/xaip-protocol)
- **npm**: [xaip-sdk](https://www.npmjs.com/package/xaip-sdk)
- **Runtime monitor**: [xkumakichi/veridict](https://github.com/xkumakichi/veridict)

---

XAIP doesn't make agents smarter. It prevents them from making dumb choices.

Built this because I needed it. If your agent is still picking servers blind, [give it a try](https://github.com/xkumakichi/xaip-protocol).
