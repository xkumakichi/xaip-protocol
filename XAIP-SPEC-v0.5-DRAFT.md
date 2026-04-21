# XAIP Protocol Specification v0.5 (DRAFT)

**Status:** Draft — subject to change
**Authors:** xkumakichi
**Date:** 2026-04-21
**License:** MIT

> This is a delta document over [XAIP-SPEC.md](./XAIP-SPEC.md) (v0.4.0). Sections that are unchanged are referenced, not repeated. v0.5 is additive: a v0.4 implementation that ignores the v0.5 fields remains conformant for v0.4.

---

## v0.5 Goals

1. **Provider-agnostic clarification.** Make explicit that XAIP receipts are agent-framework-neutral. MCP is the first reference integration; LangChain, OpenAI tool calling, A2A, and proprietary stacks are first-class.
2. **Tool Class Taxonomy.** Introduce a small, fixed set of tool classes so trust evaluation can be class-aware. Same trust model can no longer be fairly applied to (e.g.) settlement tools and advisory tools without distinguishing them.
3. **Capability Hints.** Allow tool/server manifests to declare capability hints that aggregators consume to gate risk-flag evaluation.
4. **Class-aware risk flag evaluation.** Define which risk flags from §2.3 of v0.4 apply to which classes.

This draft does NOT change: receipt schema, signing algorithm, JCS canonicalization, BFT quorum, MAD outlier detection, DID priors, or the core trust formula.

---

## §10. Tool Class Taxonomy (NEW)

### 10.1 Classes

A tool MUST be assigned exactly one **primary class**. Optional **secondary classes** MAY be declared.

| Class | Definition | Examples |
|---|---|---|
| `advisory` | Tool returns information or recommendations. Output is consumed by the agent for downstream reasoning. Failure is recoverable. | doc retrieval, summarization, search, reasoning chains |
| `data-retrieval` | Tool fetches authoritative data from a known source. Correctness is verifiable against the source. | API queries, file reads, DB SELECT |
| `computation` | Tool performs deterministic computation. Same input → same output. | code execution, math, format conversion |
| `mutation` | Tool modifies state in an external system. Failure may be partially observable; rollback is system-dependent. | DB writes, file writes, git commit, HTTP POST |
| `settlement` | Tool executes a transaction on a settlement layer (blockchain, payment rail, escrow). Outcome is anchored to an external verifiable record. | XRPL payment, on-chain escrow, Lightning, ACH transfer |

### 10.2 Class Declaration

A tool's class is declared in the **server manifest** (extension to existing MCP/LangChain/OpenAI tool descriptors):

```json
{
  "name": "xrpl-payment",
  "xaip": {
    "class": "settlement",
    "secondaryClasses": [],
    "settlementLayer": "xrpl-mainnet",
    "verifiabilityHint": "anchored"
  }
}
```

Where:

| Field | Type | Meaning |
|---|---|---|
| `class` | enum (10.1) | Primary class. Required if any `xaip` block is present. |
| `secondaryClasses` | enum[] | Optional, for tools that span classes. |
| `settlementLayer` | string | Required for `settlement` class. Identifier of the settlement layer (e.g., `xrpl-mainnet`, `eth-mainnet`, `lightning`). |
| `verifiabilityHint` | enum: `anchored` \| `attestable` \| `none` | How outcomes can be independently verified. Defaults to `none`. |

If no `xaip` block is present, aggregators MUST treat the tool as `advisory` for backwards compatibility.

### 10.3 Class-Aware Risk Flag Evaluation

The risk flags defined in v0.4 §2.3 apply differently per class:

| Flag | advisory | data-retrieval | computation | mutation | settlement |
|---|---|---|---|---|---|
| `insufficient_data` | apply | apply | apply | apply | apply |
| `bootstrap_period` | apply | apply | apply | apply | apply |
| `low_sample_size` | apply | apply | apply | apply | apply |
| `high_error_rate` | apply | apply | apply | apply | apply |
| `high_timeout_rate` | apply | apply | apply | apply | **skip** (settlement layer has independent finality) |
| `declining_performance` | apply | apply | apply | apply | apply |
| `low_caller_diversity` | apply | apply | apply | apply | **skip** (each settlement is anchored; caller can't forge outcome) |
| `low_cosign_rate` | apply | apply | apply | apply | apply |
| `no_cosignatures` | apply | apply | apply | apply | apply |

**Rationale for settlement skips:**

For `settlement` tools, every successful call is reconciled at the settlement layer. The receipt is verifiable against an external record (e.g., XRPL ledger transaction). This means:

- **`low_caller_diversity` is not a trust signal**: even a single high-volume caller cannot fabricate settled outcomes — the settlement layer is the source of truth.
- **`high_timeout_rate` is decoupled from trust**: settlement finality timing is a property of the underlying layer, not the tool's reliability.

Aggregators MUST consult `xaip.class` and `verifiabilityHint` before computing the `riskFlags` array. Implementations MAY add settlement-specific flags (e.g., `settlement_layer_unreachable`) outside this spec.

### 10.4 Trust Score Composition (Class-Aware)

The base trust formula from v0.4 §2.3 is unchanged:

```
trust = bayesianScore × callerDiversity × coSignFactor
```

For `settlement` class, `callerDiversity` is replaced with `settlementVerifiability`:

```
trust_settlement = bayesianScore × settlementVerifiability × coSignFactor
```

Where `settlementVerifiability` is computed from the `verifiabilityHint`:

| Hint | Value |
|---|---|
| `anchored` | 1.0 (every receipt has an external anchor that can be verified) |
| `attestable` | 0.85 (receipts can be verified on demand but not by default) |
| `none` | fallback to `callerDiversity` |

Aggregators SHOULD attempt periodic anchor verification for `anchored` settlement tools. Verified anchors increase confidence; mismatched anchors trigger a `settlement_anchor_mismatch` flag (out of scope for this draft, planned v0.6).

---

## §11. Provider-Agnostic Receipt Production (CLARIFICATION)

The receipt schema (v0.4 §2.2) is independent of the agent framework that produced the call. v0.5 makes explicit that conformant receipt producers exist for:

- **MCP clients** (reference: `xaip-claude-hook`, `xaip-sdk` middleware) — captures `mcp__<server>__<tool>` tool calls
- **LangChain** (planned: `xaip-langchain`) — wraps `BaseTool` / `StructuredTool` `_call()` invocations
- **OpenAI tool calling** (planned: `xaip-openai`) — wraps the `tools` parameter in chat completions
- **A2A / proprietary** — direct use of `xaip-sdk`'s `signReceipt(...)` and `postReceipt(...)`

Receipts produced by any conformant producer are interchangeable at the aggregator. The `toolName` field MAY include a framework prefix (e.g., `mcp:context7/get_docs`, `lc:DocSearchTool`, `oai:web_search`) but this is convention, not normative.

---

## §12. Aggregator Conformance Additions (v0.5)

In addition to v0.4 §9 conformance items, a v0.5-conformant aggregator:

1. Accepts and stores the optional `xaip.class` and `xaip.verifiabilityHint` fields when present in receipts (carried via `toolMetadata`, schema TBD in §13).
2. Applies the class-aware risk flag table (§10.3) when computing `riskFlags`.
3. Substitutes `settlementVerifiability` for `callerDiversity` when `class == "settlement"` (§10.4).
4. Treats absent `xaip.class` as `advisory` (backwards compatibility).

---

## §13. Open Questions (To Resolve Before v0.5 Final)

1. **How does class metadata reach the aggregator?** Options: (a) carried inside each receipt as `toolMetadata`, (b) registered ahead-of-time per `agentDid+toolName`, (c) discovered via well-known endpoint on the server. Trade-offs: (a) is simplest but adds bytes; (b) requires registry; (c) requires server cooperation.
2. **Is `verifiabilityHint: anchored` self-declarable?** A malicious settlement tool could declare `anchored` to inflate trust. Mitigation: aggregators SHOULD periodically verify a sample of anchored receipts against the declared `settlementLayer`.
3. **Class disputes.** What if two callers disagree on a tool's class? Likely resolution: server's manifest is authoritative; callers MAY annotate but MAY NOT override.
4. **Multi-class tools.** A tool that both writes to a database AND emits a settlement transaction — how is that scored? Proposed: primary class determines risk flag table; secondary classes inform the human-facing description only.

---

## §14. Migration from v0.4

v0.4 implementations remain conformant for v0.4 indefinitely. To upgrade to v0.5:

1. **Receipt producers**: optionally include `xaip.class` and `xaip.verifiabilityHint` in tool metadata. No receipt schema change required.
2. **Aggregators**: implement class-aware risk flag table and settlement substitution. Continue to default to `advisory` for un-annotated tools.
3. **Decision engines** (`/v1/select`): MAY use class metadata as a soft input (e.g., prefer `settlement` tools with `anchored` verifiability for high-stakes operations).

No breaking changes to receipt schema, signing, or BFT quorum.

---

## Acknowledgements

The class-aware risk evaluation design originated in feedback received during community discussion of v0.4. Specific insight: settlement tools whose outcomes are anchored to an external layer should not be penalized by `low_caller_diversity`, because every receipt is anchored to a non-forgeable settlement record.
