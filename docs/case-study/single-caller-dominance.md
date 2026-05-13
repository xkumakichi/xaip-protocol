# Case Study: Single-Caller Dominance

*How XAIP surfaced a real failure mode in its own public dataset, and why caller diversity is a structural requirement rather than an optimization.*

**Date of incident:** 2026-05-13
**Affected servers in the public dataset:** `context7`, `fetch`
**Fix commit:** [`77151cb`](https://github.com/xkumakichi/xaip-protocol/commit/77151cb)
**Authoritative dataset:** [`/v1/servers`](https://xaip-trust-api.kuma-github.workers.dev/v1/servers)

---

## TL;DR

On 2026-05-13 the public XAIP trust API began flagging `context7` and `fetch` with `high_error_rate` and `declining_performance`. The protocol behaved correctly: receipts recorded the failures honestly, and the risk-flag derivations matched the data. But the underlying cause was **a bug in the caller, not in the servers**. Because a single automated caller dominated the receipt stream for both servers, the caller's bug propagated directly into the public trust score with no dilution. Independent callers would have produced divergent receipts in the same time window, and the protocol would have raised a *caller-side* anomaly instead of a *server-side* degradation.

This is the first public instance of a failure mode the XAIP design has called out from the beginning: **when one operator dominates the receipt stream for a given server, trust scoring degenerates into a measurement of that operator.** It is also the most important argument for prioritizing caller diversity in the protocol's roadmap.

---

## 1. What happened

The XAIP public dataset is fed in part by `sdk/scripts/auto-collect.ts`, a script that runs daily via GitHub Actions, connects to a small set of public MCP servers, makes a few real tool calls per server, signs Ed25519 receipts, and POSTs them to the Aggregator.

Two of the auto-collect probes drifted out of sync with upstream reality:

- **`context7`** had renamed its primary tool from `get-library-docs` to `query-docs` (with new parameters `libraryId` and `query`). The auto-collect script was still calling the old name. Every call returned `isError: true`.
- **`fetch`** was probed against URLs whose underlying content was JSON. The MCP `fetch` tool's `get_raw_text` is meant for plain text; the axios layer in the auto-collect probe auto-parsed JSON into objects, causing an MCP text-field validation failure and again returning `isError: true`.

Both bugs were on the **caller side**. The `context7` and `fetch` servers themselves were healthy.

## 2. What the receipts showed

Every failed call produced a correctly-signed receipt with `success: false` and a `failureType`. The Aggregator verified the signatures, accepted the receipts, and recomputed scores. Risk-flag heuristics correctly fired:

| Server | Verdict (post-incident) | Risk flags |
|---|---|---|
| `context7` | `trusted` (0.776, declining) | `high_error_rate`, `declining_performance` |
| `fetch` | `caution` (0.489) | `high_error_rate` |

There was nothing wrong with the receipts, the signatures, the aggregation logic, or the flag derivations. **The protocol did exactly what it was specified to do.**

The problem is that from receipts alone, an external consumer cannot distinguish between two scenarios:

- (a) The server is actually degrading.
- (b) A dominant caller's probe is broken.

Both produce the same receipt pattern when only one caller contributes.

## 3. Why a single caller can't tell those two apart

The XAIP receipt schema is intentionally tool-system-agnostic: `agentDid`, `callerDid`, `taskHash`, `resultHash`, `success`, `latencyMs`, `failureType`, `timestamp`. A receipt records *what was observed*, not *why*. Responsibility for the failure — caller-side, server-side, network, upstream API — is not encoded in a single receipt, and cannot be reliably encoded, because the caller is the only party in the loop that can see all of it, and the caller is the one being implicated.

The protocol's answer to this is **caller diversity, not better introspection**. If multiple independent callers report the same server in the same time window:

- All failing → likely server-side.
- Only one failing → likely caller-side (or that caller's environment).
- Mixed → genuine ambiguity, flagged as such.

This is the basic shape of a Byzantine-style trust signal: you cannot trust any single observer, but you can extract a signal from the *disagreement structure* across observers.

In the 2026-05-13 incident, the receipt stream for `context7` and `fetch` was almost entirely produced by one operator (the maintainer's GitHub Actions runner). There was no second observer whose disagreement could have raised the right flag.

## 4. What independent callers would have changed

The XAIP repository already ships two paths to become an independent caller:

- `npx xaip-caller` — zero-install CLI that signs and submits receipts for a handful of plain HTTP tools (`api.github.com/zen`, `httpbin/uuid`, the XAIP trust API itself, etc.). No MCP runtime required.
- The full path documented in [`docs/contributor/run-a-caller.md`](../contributor/run-a-caller.md), which runs the same auto-collect probes against real MCP servers from an independent environment.

Both produce receipts under their own caller DID. The Aggregator already weights scores by caller diversity. In the incident window, **even one independent caller probing `context7` correctly would have created a caller-divergence pattern that flagged the maintainer's caller as the outlier**, not the server.

This is not a hypothetical claim. The repository documents a verified multi-caller diversity test in [`docs/contributor/caller-diversity-verification.md`](../contributor/caller-diversity-verification.md): a second caller identity probing eight servers caused `callerDiversity` to respond predictably across all of them. The mechanism works. It just needs more than one operator using it.

## 5. The fix and what it does — and does not — change

Commit [`77151cb`](https://github.com/xkumakichi/xaip-protocol/commit/77151cb) updated the auto-collect probes:

- Switched `context7` to `query-docs` with the new parameter shape.
- Switched `fetch` probes to plain-text raw GitHub URLs.

After the next GitHub Actions run, new receipts began arriving with the correct success/failure signal. The trust score and the risk flags do not snap back, because they are **honest about the past**: time decay weights recent receipts more, but historical degradation is still part of the record. Recovery is data-driven, not declarative. This is the intended behavior.

The fix closes the immediate signal-quality bug. It does not close the structural problem. The structural problem is that **a single operator's caller will always be capable of producing this kind of false signal**, and the only durable mitigation is independent callers.

## 6. Why this generalizes

This incident is small. A renamed tool and a JSON-vs-text mismatch are unremarkable in isolation. The point is the **shape** of the failure, not its size.

In any production deployment of an agent-trust layer, the same shape recurs:

- Tool surfaces change without warning. Caller code drifts.
- Caller environments differ (network egress, rate limits, transient regional outages). One caller's failure can be local rather than global.
- The economic incentive to game scores will always be asymmetric. A single caller, even a benign one, is the lowest-cost adversary against the protocol.

A trust protocol that is **load-bearing for agent decisions** — for example, agent-payment systems that gate transactions on prior trust evidence — cannot rely on a single observer. The protocol's correctness needs to be reasoned about under the assumption that any one caller may be wrong, biased, or compromised.

## 7. Implications

For the XAIP roadmap:

- **Caller diversity is a milestone, not a polish item.** External operators producing receipts is the only durable mitigation for the failure mode demonstrated here.
- **The protocol's receipt schema is the right primitive.** It records observations without forcing the observer to also adjudicate cause. Adjudication is a function of the receipt set, not of an individual receipt.
- **Class-aware scoring (XAIP spec v0.5 draft, currently design-only)** does not solve this. Even within a single class, a dominant caller can produce the same false signal. Class taxonomy and caller diversity are orthogonal concerns.

For protocols that intend to consume XAIP-style trust signals (agent-payment, agent-to-agent delegation, IDE tool selection):

- A trust source backed by a single observer is structurally weaker than one backed by independent observers, regardless of dataset size.
- "How many independent callers contributed to this score" is a more useful question than "what is the score."
- Trust signals should expose caller-diversity metadata so downstream consumers can make their own calls about how much weight to give the signal.

For grant reviewers and standards reviewers reading this document:

- The XAIP team is documenting a real failure mode in its own public dataset, not a hypothetical one.
- The protocol behaved correctly. The honest data, including the false-degradation flag, is the artifact.
- Funding that accelerates external caller adoption (bounties, integration grants, hackathon prizes) directly targets the bottleneck identified by this incident.

---

## Appendix: timeline

| Time (UTC) | Event |
|---|---|
| Pre-2026-05-13 | `context7` tool renamed upstream; auto-collect probe stale |
| 2026-05-13 daily run | False-failure receipts begin landing for `context7` and `fetch` |
| 2026-05-13 | Maintainer identifies caller-side bug via diff of `auto-collect.ts` vs upstream server tool surfaces |
| 2026-05-13 | Fix shipped as commit `77151cb` |
| 2026-05-14 onward | Correct probes resume; historical scores recover gradually under time-decay weighting |

## Appendix: artifacts

- Fix commit: <https://github.com/xkumakichi/xaip-protocol/commit/77151cb>
- Auto-collect probe source: [`sdk/scripts/auto-collect.ts`](../../sdk/scripts/auto-collect.ts)
- Multi-caller diversity verification (mechanism, predates incident): [`docs/contributor/caller-diversity-verification.md`](../contributor/caller-diversity-verification.md)
- External caller paths: [`npx xaip-caller`](../../clients/caller/), [full guide](../contributor/run-a-caller.md)
- Live public trust scores: <https://xaip-trust-api.kuma-github.workers.dev/v1/servers>
