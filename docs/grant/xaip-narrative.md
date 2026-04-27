# XAIP — Grant Narrative

*A reusable narrative for grant applications, scout reviewers, and ecosystem funders. Adapt length and framing per-channel.*

**Project:** XAIP (eXecutable AI Protocol)
**Author handle:** `xkumakichi`
**Repository:** <https://github.com/xkumakichi/xaip-protocol>
**License:** MIT
**Live trust API:** <https://xaip-trust-api.kuma-github.workers.dev>
**Live dashboard:** <https://xkumakichi.github.io/xaip-protocol/>

---

## 1. One-Sentence Pitch

XAIP is a provider-neutral trust layer for AI agents that turns every tool call into a signed execution receipt, aggregates those receipts into Bayesian trust scores, and serves a live decision engine that tells an agent which tool to pick for a given task.

## 2. The Problem

When an AI agent selects a tool for a task, it has no runtime signal of whether that tool succeeds, returns stale data, or has been silently deprecated. Today's selection is driven by two proxies:

1. Whether the tool's name was in the model's training data.
2. Whether a curation platform decided to surface it.

Both proxies are inherited from upstream gatekeepers. A change in those gatekeepers' visibility policies silently changes what an agent can "see" — and therefore trust — without any change in the tool's actual behavior.

The structural consequence: agents inherit the failure modes of whatever single gatekeeper sits upstream of their trust data. If that gatekeeper is a registry, a platform's curation, or a single community's moderation, so is the agent's reliability.

## 3. The Approach

XAIP replaces upstream-derived trust with **behavior-derived** trust:

- Every tool execution produces an Ed25519-signed receipt: `{ agentDid, callerDid, toolName, taskHash, resultHash, success, latencyMs, timestamp, toolMetadata }`.
- Receipts are co-signed by the caller, preventing a tool from unilaterally inflating its reputation.
- Identity is W3C DID-based (`did:key`, `did:web`, `did:xrpl`) with method-specific Bayesian priors — cheap identities cannot buy trust for free.
- Trust scoring: `bayesianScore × callerDiversity × coSignFactor`, computed live per request.
- The protocol is framework-neutral: MCP, LangChain.js, and OpenAI tool-calling integrations emit **byte-compatible** receipts into the same trust graph.
- Aggregators are self-hostable (reference impl: Cloudflare Worker, OSS). No single upstream is load-bearing.

## 4. Current State (as of 2026-04-22)

**Infrastructure — live:**
- Trust API + Aggregator running on Cloudflare (Workers + D1).
- 10 tool servers scored (documentation retrieval, reasoning, memory, filesystem, search, DB, VCS, etc.).
- 2,100+ signed execution receipts.
- Daily CI auto-collection (each run generates a fresh caller keypair → caller diversity grows as a first-class signal, not a hand-curated input).
- Decision engine `/v1/select` returns selection + counterfactual.

**Specification:**
- v0.4 shipped.
- v0.5 Release Candidate defines **tool class taxonomy** (advisory / data-retrieval / computation / mutation / settlement) and the class-aware risk evaluation design. Aggregator implementation for class-aware scoring is a separate milestone.

**Integrations (npm):**
- `xaip-sdk` — core signing/verification.
- `xaip-mcp-trust` — MCP server so any agent can query trust scores as a tool.
- `xaip-langchain` — callback handler that emits XAIP receipts from LangChain.js tool calls.
- `xaip-openai` — wrapper for OpenAI tool calling that emits the same receipts.
- `xaip-claude-hook` — Claude Code pre-tool-use hook with inline low-trust warnings.

**Writing:**
- "Portable Trust" — <https://dev.to/xkumakichi/portable-trust-o4o> / <https://zenn.dev/xkumakichi/articles/e93a438265a682>
- Earlier: "AI Agents Pick Tools Blind" (dev.to).

## 5. Alignment by Funding Channel

*Sections below are optional; include only what the channel cares about.*

### XRPL ecosystem (GLOW retroactive / XRPL Grants AI Fund / XAO DAO)

XAIP v0.5 RC introduces a `settlement` tool class specifically designed for on-chain execution tools. The design allows receipts from a settlement tool to be evaluated against anchor verification on the declared settlement layer (e.g., `xrpl-mainnet`) once aggregator support is implemented.

Concrete XRPL surface:
- `did:xrpl` is supported as an identity method for both agents and callers.
- The v0.5 spec defines `verifiabilityHint: anchored` with mandatory sample verification for conformant implementations. The planned aggregator path checks a sample of receipts against the settlement ledger; an unanchored receipt claiming to be anchored would trigger a `settlement_anchor_mismatch` flag.
- This would let trust-aware agents distinguish tools with externally verifiable settlement evidence from tools without such anchors.

### AI agent infrastructure (general)

XAIP is provider-neutral: the receipt format, signing, and aggregation are framework-agnostic. LangChain, OpenAI tool-calling, and MCP all emit the same bytes. A trust graph built on XAIP survives a change of agent framework, a change of tool registry, or the disappearance of any single community.

### Open-source / retroactive funding

Everything is MIT-licensed, running in production, and has a daily automated data pipeline. Evaluation is verifiable against the live API and the public receipt log. Nothing is vaporware or roadmap-only.

## 6. Constraints and Working Style

- Maintainer works text-first: GitHub, email, written specifications. Video calls, voice interviews, and live demos are not a working channel. Technical evaluation is most effectively conducted against the code, the running API, and the spec documents.
- Async, written communication via GitHub issues / email is welcome for any clarification.

## 7. What the Funding Would Enable

Funding use (priority order):

1. **Aggregator decentralization.** Onboard 2-3 independent aggregator operators to form a real BFT quorum (spec supports it; implementation currently single-operator).
2. **Settlement verification implementation.** Build the XRPL ledger verification path for anchored receipts (spec'd in v0.5 §10.4).
3. **Caller-diversity expansion.** Recruit independent callers across frameworks (LangChain, OpenAI, MCP) so the trust graph is not dominated by one operator's daily CI.
4. **Class-aware decision engine.** Upgrade `/v1/select` to accept task-class preferences ("I want a settlement tool with anchored verifiability for this high-stakes call").

## 8. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Self-declared class metadata could be gamed | v0.5 `toolMetadata` is designed to be caller-cosigned; settlement anchor sampling is specified for conformant implementations (spec §10.4). |
| Centralized aggregator = single gatekeeper (the thing we argue against) | v0.5 spec defines BFT quorum; post-grant priority is onboarding independent aggregators. |
| Single-operator caller diversity inflation | CI generates fresh keys per run; grant priority is recruiting independent callers. |
| XAIP itself becomes a registry-like gatekeeper | Protocol is OSS, aggregators are self-hostable, no central index. Receipts are portable across aggregator instances. |

## 9. Links

- Repo: <https://github.com/xkumakichi/xaip-protocol>
- v0.4 spec: <https://github.com/xkumakichi/xaip-protocol/blob/main/XAIP-SPEC.md>
- v0.5 RC: <https://github.com/xkumakichi/xaip-protocol/blob/main/XAIP-SPEC-v0.5-DRAFT.md>
- Trust API: <https://xaip-trust-api.kuma-github.workers.dev>
- Dashboard: <https://xkumakichi.github.io/xaip-protocol/>
- Portable Trust (EN): <https://dev.to/xkumakichi/portable-trust-o4o>
- Portable Trust (JA): <https://zenn.dev/xkumakichi/articles/e93a438265a682>
