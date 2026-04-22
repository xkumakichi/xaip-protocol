# XAIP Protocol Specification v0.5 (Release Candidate)

**Status:** Release Candidate — open for review, no known blockers
**Authors:** xkumakichi
**Date:** 2026-04-22
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

**Anchor verification is not optional for `anchored` tools.** Aggregators SHOULD sample-verify at least **5% of receipts** (or 1 per hour per tool, whichever is greater) against the declared `settlementLayer`. Mismatches — receipt claims a transaction that does not exist on the layer, or whose content differs — MUST trigger a `settlement_anchor_mismatch` flag and MUST reduce `settlementVerifiability` to `0` for that tool until the discrepancy is resolved.

This is the defence against the obvious attack: a tool self-declaring `verifiabilityHint: "anchored"` to inflate its trust score without actually anchoring anything. Self-declaration is cheap; periodic verification removes the incentive.

---

## §10.5 Class Metadata Transport

Class metadata (`xaip.class`, `xaip.secondaryClasses`, `xaip.settlementLayer`, `xaip.verifiabilityHint`) reaches aggregators through **two complementary channels**. No centralized registry is used, by design: a registry is itself a single gatekeeper, which is exactly the failure mode this protocol aims to avoid.

### 10.5.1 Inline (REQUIRED default)

Receipt producers MUST embed class metadata in the receipt's `toolMetadata` field when the tool's manifest declares it:

```json
{
  "agentDid": "did:key:z6Mk...",
  "callerDid": "did:key:z6Mk...",
  "toolName": "xrpl-payment/send",
  "toolMetadata": {
    "xaip": {
      "class": "settlement",
      "settlementLayer": "xrpl-mainnet",
      "verifiabilityHint": "anchored"
    }
  },
  "taskHash": "...",
  "resultHash": "...",
  "success": true,
  "latencyMs": 1204,
  "timestamp": "2026-04-22T10:00:00Z"
}
```

`toolMetadata` is part of the signed payload. A tool CANNOT silently downgrade its class to avoid evaluation scrutiny: the receipt is co-signed by the caller, who can reject mis-declarations.

Size overhead is small (typical: 40–120 bytes per receipt) and scales with receipts, not with tool count.

### 10.5.2 Well-Known Endpoint (OPTIONAL supplement)

A server MAY publish a well-known manifest at:

```
GET https://<server>/.well-known/xaip-manifest.json
```

Returning:

```json
{
  "tools": {
    "send": { "class": "settlement", "settlementLayer": "xrpl-mainnet", "verifiabilityHint": "anchored" },
    "get_balance": { "class": "data-retrieval" }
  }
}
```

Aggregators MAY fetch this out-of-band to pre-populate or cross-check class metadata. When inline and well-known disagree, the **inline receipt metadata wins** (it is per-call and signed; the endpoint is a static hint).

### 10.5.3 Why No Registry

A centralized registry of tool classes would:

1. Introduce a single gatekeeper whose curation decisions become load-bearing inputs to every downstream trust computation.
2. Create an attack surface (inject/remove entries to bias evaluation).
3. Contradict the portability guarantee: a tool whose author loses registry access cannot carry class metadata with them.

Inline-plus-well-known is the decentralized alternative. Both are under the tool author's control; neither requires cooperation from a third party.

---

## §10.6 Class Disputes and Multi-Class Tools

### 10.6.1 Authority

The **server manifest** (well-known endpoint, or the `toolMetadata` that a server-side receipt producer emits) is authoritative for the tool's primary class.

- Callers MAY annotate their receipts with a `callerSuggestedClass` field for aggregator awareness.
- Callers MUST NOT override the server's declared `class`. An aggregator receiving a caller override MUST ignore it and log a divergence event.

Rationale: the tool author knows what their tool does; external annotation is a hint, not a source of truth. This also prevents adversarial callers from forcing class reassignment to game the risk-flag table.

### 10.6.2 Multi-Class Tools

A tool that spans classes (e.g., writes to a database AND emits a settlement transaction) declares:

- **One `class`**: the primary class. This determines the risk flag table (§10.3) and score composition (§10.4).
- **Zero or more `secondaryClasses`**: for human-facing description and discovery. Aggregators MUST NOT derive risk-flag behaviour from `secondaryClasses`.

The primary class SHOULD be the one with the highest-stakes failure mode. For a tool that writes to both a local DB and XRPL, `settlement` is primary; `mutation` is secondary.

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

1. Accepts and stores the optional `xaip.class`, `xaip.secondaryClasses`, `xaip.settlementLayer`, and `xaip.verifiabilityHint` fields when present in receipts, carried via `toolMetadata` as defined in §10.5.
2. Applies the class-aware risk flag table (§10.3) when computing `riskFlags`.
3. Substitutes `settlementVerifiability` for `callerDiversity` when `class == "settlement"` (§10.4).
4. Samples and verifies anchored receipts per §10.4, and exposes `settlement_anchor_mismatch` as a risk flag when anchors diverge.
5. Treats absent `xaip.class` as `advisory` (backwards compatibility).
6. Ignores any `callerSuggestedClass` that conflicts with the server's declared `class` (§10.6.1) and logs the divergence.

---

## §13. Migration from v0.4

v0.4 implementations remain conformant for v0.4 indefinitely. To upgrade to v0.5:

1. **Receipt producers**: optionally include `xaip.class` and `xaip.verifiabilityHint` in tool metadata. No receipt schema change required.
2. **Aggregators**: implement class-aware risk flag table and settlement substitution. Continue to default to `advisory` for un-annotated tools.
3. **Decision engines** (`/v1/select`): MAY use class metadata as a soft input (e.g., prefer `settlement` tools with `anchored` verifiability for high-stakes operations).

No breaking changes to receipt schema, signing, or BFT quorum.

---

## Acknowledgements

The class-aware risk evaluation design originated in feedback received during community discussion of v0.4. Specific insight: settlement tools whose outcomes are anchored to an external layer should not be penalized by `low_caller_diversity`, because every receipt is anchored to a non-forgeable settlement record.
