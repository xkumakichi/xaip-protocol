# Agent Trust Before Agent Payments

*A 60-second overview of why AI agents need portable trust data before they call, delegate, or transact.*

## The problem

AI agents are becoming less like chatbots and more like operators.

They choose tools, call APIs, delegate work, and increasingly act on a user's behalf. Every one of those actions starts with a trust decision: *which tool, service, or agent should I rely on?*

Today, that decision is mostly blind.

Agents often pick a tool because it matches a name, description, default list, or platform suggestion — not because there is shared evidence that the tool actually works in practice.

As agents become more autonomous, bad choices become more expensive. A failed call is not just an error. It can mean wasted tokens, wrong data, broken workflows, or eventually bad transactions.

There is still no shared, verifiable record of what an agent or tool did, whether it succeeded, or how risky the action was. When something goes wrong, there is often nothing portable to look back at.

As more agents act on behalf of more people — including people who do not write code — this gap stops being a developer problem and starts being a basic safety problem.

## The missing layer

Recent industry moves focus on **agent payments**: letting agents check out, settle, and transact on a user's behalf.

But payment is the last step. Before an agent should be allowed to spend, transfer, or commit, there needs to be an answer to a more basic question:

> *Can this agent, and the tools it is about to use, be trusted to do the right thing?*

That question needs evidence. Not a vendor claim. Not a star rating. Behavior, recorded over time, in a form that other systems can read and verify.

That layer does not really exist yet. That is the gap XAIP is trying to fill.

## XAIP's position

XAIP is a small, provider-neutral receipt and trust layer for AI agent tool execution. Provider-neutral means the trust data is not locked inside one agent framework, marketplace, model provider, or company.

In plain terms:

- When an agent uses a tool, a short, signed **receipt** is produced. It records what was done, whether it worked, and how long it took. It does not record secrets or raw user data.
- Receipts from many sources — different agents, different runtimes, different callers — are aggregated and turned into a **trust score** for each tool.
- An agent can then use those trust scores to choose between similar tools, instead of picking blindly.

XAIP is intentionally **not tied to one agent framework or one vendor**. MCP, LangChain, OpenAI tool calling, plain HTTP callers, or proprietary runtimes can all emit the same kind of receipt. That is the point of the layer.

## Current evidence

XAIP currently has:

- A live aggregator collecting signed receipts from real tool executions.
- A public dashboard showing per-tool trust scores.
- A small but growing snapshot of scored tools.
- A reproducible decision-quality demo that compares three selection strategies on a fixed candidate set:

| Strategy | Risky-pick rate |
|---|---|
| Random | 71.4% |
| Fixed-order | 85.7% |
| XAIP-informed | 14.3% |

> **Disclaimer.** These numbers come from a deterministic replay over a fixed set of candidate tools and a static trust snapshot. They show that *given* trust data, a trust-informed selection is meaningfully different from blind selection. They are **not** a real-world success-rate guarantee, and they are **not** a benchmark of any specific tool or vendor.

## What it is not

To avoid overclaiming:

- XAIP is **not** a payments system. It does not move money. It is the layer that should sit *before* agent payments, not in place of them.
- XAIP is **not** a replacement for human review, audits, or compliance. It is a source of evidence those processes can use.
- XAIP is **not** a closed platform. The receipt format and the way trust is computed are intended to be inspectable, reproducible, and emittable from any tool runtime.
- XAIP **cannot help** when there is no trust data yet. In that case, the protocol's honest answer is "I don't know," and the agent or user has to fall back to other judgment.

## Try it

- **For developers.** See the README and the [decision-quality demo](./blind-vs-xaip-demo.md). Receipts can be emitted from any tool runtime — the [Emit From Anything](./emit-from-anything.md) guide shows the minimal flow.
- **For non-developers.** The shorter version: AI agents are moving from answering questions to taking actions. As that happens, they will need shared evidence about which tools and agents are reliable — before they are trusted with higher-stakes actions like spending, signing, or delegating. XAIP is one attempt at building that evidence layer.

If that direction matters to you, the project is open. Issues, external caller runs, and feedback are all welcome.
