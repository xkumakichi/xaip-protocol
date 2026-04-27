# Future Direction: Portable Trust Before Agent Transactions

XAIP is an early attempt to test a simple hypothesis:

> As AI agents begin to select tools, call services, and eventually transact on behalf of users, they may need portable trust evidence before delegation or payment.

Today, most agent tool selection is still based on local configuration, framework defaults, registry visibility, or model/planner output. XAIP explores whether behavior-derived execution receipts can become a portable trust signal across those systems.

This document uses two terms repeatedly:

- *Portable* — not locked inside one agent framework, marketplace, or vendor.
- *Behavior-derived* — computed from how tools actually performed in real calls, not from self-reported metadata or claims.

This document separates what exists today from what is being tested, what depends on more data, and what may never happen. For the boundaries of what XAIP claims to be, see [Agent Trust Before Agent Payments](./agent-trust-overview.md).

## Now: shipped

XAIP currently has:

- A signed execution receipt format for AI tool calls.
- A Trust API that exposes behavior-derived trust scores.
- A live dashboard showing the current public dataset.
- A deterministic Blind vs XAIP replay demo using a static trust snapshot.
- A provider-neutral receipt model: any system that can hash input/output and sign a receipt can participate.
- Preview receipt producers for LangChain.js and OpenAI-compatible tool-call loops.
- An HTTP caller path via `npx xaip-caller`, which does not require MCP.
- v0.5 metadata plumbing for tool class hints inside signed receipts.

The current public dataset is still MCP-heavy because MCP was the first integration target. That is a dataset reality, not the intended protocol boundary.

## Near-term: being tested

The near-term work is not about adding more claims. It is about testing whether the existing claims hold outside the maintainer's own environment.

Open questions:

- Can receipts be contributed from independent caller environments?
- Can non-MCP tools produce useful XAIP receipts?
- Can LangChain and OpenAI-style integrations produce receipts compatible with the same trust graph?
- Can tool class metadata be collected consistently before being used for scoring?
- Can the protocol remain provider-neutral in practice, not only in design?

Tool class metadata is plumbed through receipts and storage. Class-aware scoring is not live yet.

## Longer-term: depends on data and feedback

If the receipt layer proves useful, XAIP may move toward class-specific trust models. A documentation lookup tool, a filesystem mutation tool, a database write tool, a code execution tool, and a settlement-related tool have different risk profiles. A single generic score may be too blunt.

Possible directions:

- Class-specific risk models for different tool categories.
- Trust checks before agent-to-agent tool delegation.
- Trust evidence before agent-mediated payments or settlement flows.
- Cross-framework trust graphs that include MCP, LangChain, OpenAI-compatible tools, HTTP callers, and future agent frameworks.
- Better separation between advisory tools, mutation tools, and externally verifiable tools.

These depend on data and should not be treated as production claims.

## Speculative: may not happen

Some outcomes remain speculative.

XAIP may never become widely adopted. Frameworks may prefer their own scoring systems. A simpler reputation model may win. Tool selection may become bundled into platforms rather than exposed as a portable layer.

Speculative directions:

- Broad trust portability across agent ecosystems.
- Shared conventions around signed execution receipts.
- Audit-friendly evidence trails for agent governance.
- Trust signals consumed before agent-to-agent transactions.

These are not promises. They become meaningful only if independent usage and feedback appear.

## What "working" would look like at this stage

"Working" at this stage is not a market-share claim. It means: independent callers contribute receipts in a sustained way, non-MCP receipt sources exist, and external feedback has substantively shaped the design.

## What we need from others

The current bottleneck is not polish. It is external evidence.

The public trust graph is still too dependent on the maintainer's own runs. Even a small number of independent caller runs helps test whether receipts can be contributed outside the maintainer environment.

Useful contributions, by effort:

### 30 seconds

- Run `npx xaip-caller` once and share only the final summary line.

### 30 minutes

- Try the LangChain or OpenAI preview receipt producer and report where it fails.
- Emit a single receipt from a non-MCP tool you already use.
- Open an issue describing a confusing wording or unclear claim in the docs.

### Deeper involvement

- Challenge the tool class taxonomy.
- Point out cases where XAIP should not apply.
- Share failure cases where a trust score would not have helped.
- Open issues for trust-model weaknesses or overclaims.

A small external run matters because it helps answer one narrow question:

> Can XAIP receipts be produced and submitted from environments the maintainer does not control?

That question has to be answered before stronger claims are justified.

## Why this might not work

XAIP has several real risks.

- Caller diversity may not grow enough for scores to become meaningful.
- Behavior-derived receipts may not predict future tool usefulness.
- Provider-neutral design may not matter if platforms keep trust data inside their own ecosystems.
- Identity priors may be wrong or too easy to game.
- Tool class metadata may be too inconsistent to support class-aware scoring.
- Simpler reputation systems may be easier to adopt.
- The current dataset may remain too MCP-heavy to prove cross-framework portability.
- Agent-to-agent transactions may develop in a way that does not need XAIP.

These are not edge cases. They are central risks for the project.

Feedback that argues XAIP is the wrong design is useful. A trust protocol should become stronger by being criticized early.

---

*Last reviewed: 2026-04-27. This document is expected to change as the project changes.*
