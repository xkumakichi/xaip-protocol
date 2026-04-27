# Class-Aware Scoring Design

## Status

This is a design note only. It is not live scoring behavior.

XAIP currently accepts and displays optional v0.5 tool metadata, but class-aware
scoring is not implemented. This document describes future design constraints
and migration steps. It does not change scoring, risk flags, `/v1/select`, or
dashboard behavior.

## Why Class-Aware Scoring Exists

The same trust signals do not mean the same thing for every tool. A tool that
returns advice, a tool that reads authoritative data, a tool that mutates state,
and a tool that submits a settlement transaction have different failure modes.

Class-aware scoring exists to make those differences explicit before XAIP uses
class metadata in scoring. The goal is not to make a tool look safer because it
declares a class. The goal is to decide which evidence should matter for each
kind of tool.

## Current Behavior

Current public scoring is generic. It uses signed execution receipts and does
not use tool class metadata to change trust scores, verdicts, or risk flags.

Current v0.5 plumbing is display-only:

- Receipts may carry `receipt.toolMetadata.xaip`.
- Aggregators may store observed metadata.
- Aggregator `/query` may expose `observedToolMetadata`.
- Trust API `/v1/servers` and `/v1/trust` may pass observed metadata through.
- `/v1/select` candidates intentionally strip observed metadata.
- Dashboard display of observed metadata does not affect scoring.

`observedToolMetadata` is not canonical truth. It is the latest observed signed
receipt metadata available to the current data path.

## Current Formula Gap

There are currently two related formula shapes in the repository:

```text
SDK:        trust = bayesianScore x callerDiversity x coSignFactor
Aggregator: trust = bayesianScore x (0.5 + 0.5 x callerDiversity) x coSignFactor
```

This document does not resolve or change that difference. Before class-aware
scoring becomes live behavior, XAIP should define which formula is normative and
how existing public scores should be described during any transition.

## Tool Class Taxonomy

PR5 keeps the existing v0.5 class names as the design baseline:

| Class | Meaning |
|---|---|
| `advisory` | Returns suggestions, analysis, summaries, or other guidance. |
| `data-retrieval` | Reads data from a source without modifying external state. |
| `computation` | Performs deterministic or mostly deterministic processing over inputs. |
| `mutation` | Writes to or changes an external system. |
| `settlement` | Produces an externally verifiable settlement or transaction effect. |

`memory`, `filesystem`, and `identity` are not primary classes in this design.
They may become future profiles, capabilities, or subtypes after the primary
taxonomy is stable.

## Scoring Principles By Class

These are future principles only, not live behavior.

### `advisory`

Evidence that should matter:

- Success rate over signed receipts.
- Caller diversity and caller co-signing.
- Declining performance over recent receipts.

Evidence that should not matter too strongly:

- Small latency differences, unless timeouts correlate with failure.

Important failure modes:

- Plausible but wrong output.
- Silent degradation.
- Single-caller reputation inflation.

Missing data today:

- Independent correctness checks for advisory output.

### `data-retrieval`

Evidence that should matter:

- Success rate.
- Source availability and freshness, when observable.
- Timeout and error patterns.
- Caller diversity and co-signing.

Evidence that should not matter by itself:

- Self-declared source authority without verification.

Important failure modes:

- Stale data.
- Partial results reported as success.
- Upstream API changes.

Missing data today:

- Source freshness metadata.
- Explicit validation that retrieved data matches the claimed source.

### `computation`

Evidence that should matter:

- Deterministic reproducibility for the same input hash.
- Success rate and validation failures.
- Runtime failures and timeout patterns.

Evidence that should not matter too strongly:

- Caller diversity alone, if deterministic replay evidence exists.

Important failure modes:

- Non-deterministic output where deterministic behavior is expected.
- Incorrect results that still return success.
- Resource exhaustion.

Missing data today:

- Replay records.
- Expected-output validation or independent recomputation.

### `mutation`

Evidence that should matter:

- Explicit success criteria.
- Failure type and rollback/partial-failure evidence.
- Caller diversity and co-signing.
- Declining performance.

Evidence that should not matter by itself:

- A success boolean without evidence that the external state changed correctly.

Important failure modes:

- Partial writes.
- Duplicate writes.
- Failed rollback.
- State changes reported as success before they are durable.

Missing data today:

- Side-effect verification.
- Idempotency and rollback metadata.

### `settlement`

Evidence that should matter:

- External anchor verification.
- Settlement layer availability.
- Matching between receipt metadata and the external settlement record.
- Co-signing.

Evidence that should not create a scoring benefit until verified:

- A self-declared `class: "settlement"`.
- A self-declared `verifiabilityHint: "anchored"`.

Important failure modes:

- Fake or mismatched transaction anchors.
- Settlement layer unreachable.
- Transaction submitted but failed, expired, or settled with different content.
- Payment or settlement claims that users interpret as guarantees.

Missing data today:

- Live anchor verification.
- Sampling rules implemented in the aggregator.
- Settlement-layer-specific verification adapters.

## Unknown Or Missing Metadata

Missing metadata should not reduce or increase trust by itself. Receipts without
class metadata should continue to use generic scoring.

Unknown or unrecognized classes should receive no class-based benefit. The
honest interpretation is "no class-aware evidence available," not "unsafe" and
not "trusted."

## Settlement Caution

Settlement-related metadata is high risk. XAIP is not a payment rail and does
not guarantee settlement safety.

No scoring benefit should be applied to `settlement` metadata until external
anchor verification exists. In particular, `low_caller_diversity` should not be
relaxed merely because a receipt claims `class: "settlement"` or
`verifiabilityHint: "anchored"`.

## Future PR Sequence

Recommended sequence:

1. **PR6:** internal parse/normalize helpers and tests only. No live scoring change.
2. **PR7:** optional `experimentalClassAwareScore` output. Not used by `/v1/select`.
3. **PR8:** optional selection mode, disabled by default.

Each step should keep current default scoring and `/v1/select` behavior stable
until there is enough evidence and review to change them.

## Do-Not-Do List

- Do not change `/v1/select` by default.
- Do not treat `observedToolMetadata` as canonical class truth.
- Do not apply settlement scoring benefits before anchor verification exists.
- Do not skip caller-diversity checks based only on self-declared metadata.
- Do not invent fallback metadata for old receipts.
- Do not claim class-aware scoring is live.
- Do not describe XAIP as a payment rail or settlement guarantee.

