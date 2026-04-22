# Portable Trust

*Published on dev.to: <https://dev.to/xkumakichi/portable-trust-o4o>*

---

**TL;DR** — When an AI agent picks a tool, it makes a trust decision. The quality of that decision depends entirely on *where the trust data comes from*. If trust flows through a single gatekeeper — a registry, a platform's curation, a community's moderation — the agent inherits that gatekeeper's failure modes. This post argues that trust infrastructure for AI agents must be provider-neutral and behavior-derived, and walks through what a concrete implementation of that principle looks like, with live data.

---

## The tool-choice problem

An AI agent receives a task: "fetch the React hooks docs."

Its planner produces a candidate list: three documentation tools, two search tools, one fallback web scraper. Which one does it pick?

Today, the honest answer is: it picks based on *name recognition in the model's training data* plus *whatever the platform decided to show it*. There is no runtime trust signal. The agent does not know which tool succeeded yesterday, which one is quietly returning stale data, which one has been silently deprecated.

This is the tool-choice problem, and it is a trust-data problem.

## Three places trust data can live

Trust data for tools can come from three very different places:

1. **Self-declared** — the tool's README says it's good.
2. **Platform-curated** — the platform it's published on has a list of "recommended" tools.
3. **Behavior-derived** — past executions are logged, signed, and aggregated; trust is computed from outcomes, not claims.

Only (3) is robust against gaming, drift, and upstream policy changes. But (3) is also the hardest to deliver, because it requires infrastructure: signed receipts, a canonical aggregation model, and an identity system that doesn't depend on any single platform.

## Why provider-neutrality matters, structurally

Suppose you build trust scores on top of a single community's registry.

The registry is itself a trust layer — it decides what's visible, what's highlighted, what's removed. When visibility rules change — whether to promote some tools, demote others, or restrict participation — the scoring space implicitly changes with them. Tools that were previously indexed can disappear from consideration. Projects whose contributors cannot register never accumulate receipts in the first place. None of this reflects anything about the tools' behavior; it reflects the registry's state at a point in time.

This is not a critique of any particular community. It's a structural property of **any layered system where upstream visibility decisions feed downstream trust signals**. Those decisions become an implicit input to the trust model, whether or not you want them to.

> Without a portable trust layer, agents are not choosing tools — they are inheriting decisions.

The implication for trust infrastructure: the **receipts, identity, and scoring must all be portable**. If a community exits, the data must remain queryable. If a platform changes policy, the scoring must still compute. If an identity provider goes away, the agent must still be verifiable. Trust infrastructure that depends on a single upstream is not trust infrastructure — it is a brittle proxy for that upstream's preferences.

## What portable trust looks like

[XAIP](https://github.com/xkumakichi/xaip-protocol) is one implementation of this principle. Its design follows from the structural requirement:

- **Signed receipts**, not self-reports. Every tool execution produces an Ed25519-signed receipt: `{ agentDid, callerDid, taskHash, resultHash, success, latencyMs, timestamp }`. The caller co-signs so the tool cannot unilaterally inflate its own reputation.
- **Standards-based identity**. Agents and callers use [W3C DIDs](https://www.w3.org/TR/did-core/) (`did:key`, `did:web`, `did:xrpl`). No platform account required. An agent expelled from one community retains its identity in every other.
- **Bayesian trust, not thresholds**. Scores are computed as `bayesianScore × callerDiversity × coSignFactor`, with DID-method-dependent priors. Cheap identities don't get free trust; expensive identities converge to the same score given enough evidence.
- **Provider-neutral receipt producers**. The same receipt format is emitted by integrations for [MCP](https://github.com/xkumakichi/xaip-protocol/tree/main/clients/claude-code-hook), [LangChain.js](https://www.npmjs.com/package/xaip-langchain), and [OpenAI tool calling](https://www.npmjs.com/package/xaip-openai). A receipt produced by a LangChain agent is byte-compatible with one from an OpenAI chat completion. The trust graph is one graph, regardless of how the agent was built.
- **Aggregation you can run yourself**. The reference aggregator is a Cloudflare Worker (open source, small). If you don't trust the public instance, you run your own. Multi-aggregator quorum is part of the spec.

## Live data

The reference deployment has been running for a few weeks. As of writing:

- **10 tool servers** scored (docs retrieval, reasoning, memory, filesystem, search, DB, VCS, and more)
- **2,100+** signed execution receipts
- **Automated daily collection** via CI with fresh caller keys each run (caller diversity is a first-class signal)

Live dashboard: [xkumakichi.github.io/xaip-protocol](https://xkumakichi.github.io/xaip-protocol/)
Trust API: `https://xaip-trust-api.kuma-github.workers.dev/v1/servers`

You can ask it which tool to pick right now:

```bash
curl -X POST https://xaip-trust-api.kuma-github.workers.dev/v1/select \
  -H "Content-Type: application/json" \
  -d '{"task":"Fetch React docs","candidates":["context7","sequential-thinking","unknown-server"]}'
```

Response includes both the selection and a counterfactual — what would happen if you chose randomly with no trust data. That counterfactual is the value proposition: trust data either saves an agent from a wasted call or it doesn't.

## What "provider-neutral" buys you, concretely

- An agent built on LangChain and an agent built on OpenAI's SDK can share trust data about the same underlying tool. Today, they can't — each framework has its own observability silo.
- A tool whose author is gated out of one community still accumulates trust from callers in every other community.
- A grant reviewer evaluating agent infrastructure projects can verify receipts independently, without relying on any single platform's dashboard.
- A future regulatory regime that asks "what's your trust basis for this agent's tool choices?" has a portable, auditable answer.

## What's next

The spec is open, the aggregator is live, the three framework integrations are on npm. The next frontier is **class-aware risk evaluation** — a settlement tool whose outcomes are anchored to an external ledger doesn't need the same trust signals as an advisory tool whose outputs are freely consumed. The [v0.5 draft](https://github.com/xkumakichi/xaip-protocol/blob/main/XAIP-SPEC-v0.5-DRAFT.md) tackles that.

The underlying claim is simple: trust infrastructure for AI agents is too important to depend on any one platform, community, or moderator. The sooner we build it as a portable layer, the sooner the ecosystem can reason about tool choices the way we already reason about TLS certificates and package signatures — with math, not vibes.

---

*XAIP is MIT-licensed and open source. Feedback on the v0.5 draft is welcome via [GitHub issues](https://github.com/xkumakichi/xaip-protocol/issues).*
