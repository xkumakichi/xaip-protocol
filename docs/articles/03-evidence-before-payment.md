# The agent-payment stack is taking shape. Portable execution evidence is still missing.

---

**TL;DR** — By mid-2026, agent-specific payment infrastructure had expanded quickly: delegated authority, transaction constraints, checkout coordination, and mechanisms for initiating and settling payments on a principal's behalf.

These systems increasingly describe the transaction at hand — who authorized it, what may be purchased, under what constraints, and how payment should proceed. What remains thin is evidence about prior execution. Before an agent invokes a paid tool, delegates work to another agent, or authorizes payment for a service, it usually has little portable, attributable evidence of how that execution subject performed on earlier calls.

This post defines that design problem and outlines what a usable execution history would technically require, independent of any one implementation.

---

## The agent-payment stack filled in quickly

Across late 2025 and the first half of 2026, substantial pieces of agent-specific commerce infrastructure appeared in close succession.

Taken together, they address several distinct problems:

**Delegated authority** — establishing what a principal has authorized an agent to do.

**Transaction policy** — expressing budgets, permitted instruments, spending limits, and other constraints.

**Checkout coordination** — binding the agent's intent to a particular offer, amount, and merchant interaction.

**Payment and settlement coordination** — initiating value transfer and recording the transaction state.

This is meaningful progress. The infrastructure for an agent to participate in a transaction is taking shape.

## The transaction is described. Prior execution usually is not.

The emerging stack can answer questions such as:

- Who authorized this transaction?
- What constraints apply?
- What is being purchased?
- Was payment initiated or completed?

Even where merchant-side information is present, it generally describes the current offer or transaction. It does not provide a portable history of how the service executed previous calls.

That distinction matters when an agent is about to invoke a paid API, call a closed-source skill, or delegate a subtask to another agent for a fee. A listing may provide a name, description, price, and platform-specific reputation signal. It rarely provides attributable, machine-checkable records from prior executions.

The payment stack can make an agent an authorized buyer. By itself, it does not make the agent an informed one.

## The missing input: pre-delegation execution evidence

Call the missing input **pre-delegation execution evidence**: structured, attributable records of prior execution attempts that are available before a new tool call, delegation, or paid invocation.

This is not the same as a rating. A rating aggregates opinions or platform-defined judgments. An execution receipt describes an individual execution attempt in a machine-readable form.

Nor is a signed receipt proof that an execution was correct.

A signature can establish the provenance and integrity of an assertion: who signed a particular record and whether that record was modified afterward. It does not, by itself, establish that the record is complete, that its success criterion was appropriate, or that the underlying execution was correct.

The value is narrower but still useful: execution claims become attributable, tamper-evident, and comparable across calls.

The same requirement exists when no money moves. Delegation itself creates a need to evaluate an execution subject. Payment simply makes the missing input easier to see.

## What "seeing a track record" actually requires

### What is the subject of the evidence?

The payee, service operator, tool endpoint, and actual executor may be different entities. A receipt therefore needs to identify precisely which subject performed the execution, as well as the tool or operation, version, and relevant execution context.

### What is the unit of evidence?

A single tool call, a multi-step task, and a complete agent session answer different questions. Per-call receipts and session-level records are not interchangeable, although they can be composed.

### What is being asserted?

"Success" is not self-explanatory. A format needs explicit semantics for status, errors, latency, success criteria, and any other outcome fields. Otherwise two implementations may sign identical field names while asserting different things.

### Content, hashes, or references?

Embedding content improves interpretability but increases disclosure, retention, and privacy obligations.

Hash commitments reduce what a receipt reveals and allow later-disclosed content to be checked against the committed value. They do not make guessable data private, and a hash cannot be interpreted without access to the referenced content.

### Who signs, and what does each signature mean?

An executor-only signature makes the assertion attributable to the executor. A caller co-signature adds a second attestation to the same canonical record.

Neither model automatically establishes truth. Co-signing also does not, by itself, prevent collusion, selective disclosure, or the creation of many weak identities.

### Can verification happen independently?

A verifier should be able to validate the signature and canonical payload without relying on the issuer's dashboard or scoring service.

That requires defined canonicalization, signature algorithms, key representation, and identity resolution. A claim of offline verification should also state what public-key or trust-anchor material the verifier must already possess.

### What prevents selective history?

A valid receipt proves something about the execution attempt it describes. It does not prove that unfavorable calls were not omitted.

Coverage, publication, sampling, retention, and query policy are separate design problems. A receipt format can support those systems, but it cannot solve completeness merely by signing individual records.

### Who turns evidence into a decision?

A receipt format can expose prior execution evidence. It does not determine whether an agent should proceed.

Aggregation, scoring, eligibility thresholds, risk tolerance, and approval policy belong to the consuming system. Execution evidence is an input to a decision, not the decision itself.

None of these questions is resolved merely by adding a payment mechanism. They are adjacent to payment authorization and settlement, not substitutes for them.

## Adjacent work

Per-call execution receipts and session-level integrity bundles are both being explored in W3C Community Group discussions and individual Internet-Drafts.

They address different scopes and can be composed: a session bundle may embed or reference per-call receipts, while a per-call receipt may carry a reference to the session in which it occurred.

These are active proposals, not adopted standards. The important point is the architectural requirement: evidence available before delegation is a layer, not a product.

## Closing

By mid-2026, substantial work had gone into agent authorization, transaction constraints, checkout, and payment coordination.

The separate question — what attributable evidence exists about the service's prior execution behavior? — remains weakly specified and inconsistently portable.

Signed execution receipts are one concrete approach. To be useful beyond a local log, they need explicit semantics for identity, canonicalization, disclosure, signatures, independent verification, and the limits of what the receipt establishes.

[XAIP](https://github.com/xkumakichi/xaip-protocol) is one open protocol and reference implementation exploring that design.

---

*Scope note: XAIP does not define payment, settlement, sandboxing, or approval policy, and it does not determine whether a counterparty should be relied on. The reference implementation is MIT-licensed. Its receipt format is published as an individual Internet-Draft, [draft-xkumakichi-xaip-receipts](https://datatracker.ietf.org/doc/draft-xkumakichi-xaip-receipts/); it is not an IETF standard or IETF-approved work.*
