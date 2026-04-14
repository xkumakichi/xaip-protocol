# XAIP Protocol Specification v0.4.0

**Status:** Draft
**Authors:** Hiro (xkumakichi), Claude, GPT, Gemini, Grok
**Date:** 2026-04-14
**License:** MIT

---

## Abstract

XAIP (eXtensible Agent Identity Protocol) is a chain-agnostic trust protocol for AI agents. It enables agents to build, query, and verify trust scores based on signed execution receipts — without requiring any specific blockchain, platform, or vendor.

v0.3.1 introduces a Bayesian trust model, weighted caller diversity for Sybil defense, SigningDelegate for key safety, and multi-aggregator quorum for fault tolerance.

v0.4.0 adds Byzantine Fault Tolerance (BFT) via MAD outlier detection, per-node reputation tracking, and automatic exclusion of persistently divergent aggregator nodes.

## 1. Terminology

- **Agent**: An AI system that can execute tools and communicate with other agents.
- **DID**: Decentralized Identifier (W3C spec) representing an agent's identity.
- **Receipt**: A signed record of a single tool execution.
- **Co-signature**: A receipt signed by both the executor and the caller.
- **Verdict**: A trust judgment (yes / caution / no / unknown).
- **Aggregator**: A federation node that collects and serves receipts/scores.
- **SigningDelegate**: An interface that signs payloads without exposing private keys.
- **Prior**: Beta distribution parameters [α, β] encoding initial trust per DID method.

## 2. Protocol Operations

XAIP defines four operations:

### 2.1 Register

Declare an agent identity using a DID. No blockchain required.

```
Register(did: DID) → { did, method, publicKey }
```

**DID Methods and Bayesian Priors:**

| Method | Prior [α, β] | Prior Mean | Creation Cost | Justification |
|--------|-------------|------------|---------------|---------------|
| `did:key` | [1, 1] | 0.500 | Free, instant | Uniform prior. No verifiable cost. Cryptographic key only. |
| `did:web` | [2, 1] | 0.667 | Domain ownership | Slight positive. Domain registration requires DNS control, providing identity binding. |
| `did:ethr` | [3, 1] | 0.750 | Gas cost | Moderate positive. Ethereum transaction cost creates economic barrier to Sybil. |
| `did:xrpl` | [5, 1] | 0.833 | XRP reserve (2 XRP) | Strong positive. XRPL account reserve is a non-trivial economic commitment per identity. |

**Prior Justification:**

The Beta(α, β) priors encode the cost of identity creation as a Bayesian belief. The key design property is **convergence**: with sufficient evidence (receipts), all DID methods converge to the same trust score regardless of their prior. This means did:key agents are not permanently disadvantaged — they simply need more evidence to overcome the skeptical prior.

The specific α values were chosen to reflect the relative economic cost of identity creation:
- `did:key`: α=1 (no cost, maximum skepticism)
- `did:web`: α=2 (domain ≈ $10-15/year)
- `did:ethr`: α=3 (gas ≈ $1-50 per transaction, variable)
- `did:xrpl`: α=5 (reserve = 2 XRP, locked)

β=1 for all methods ensures the prior is always optimistic-leaning (prior mean ≥ 0.5), reflecting the assumption that most agents are honest.

**Convergence proof:** Posterior mean = (α + successes) / (α + β + total). As total → ∞, the prior (α, β) becomes negligible. At 100 receipts, the maximum prior contribution is 5/106 ≈ 4.7%.

### 2.2 Attest

Record a signed execution receipt. Receipts are the atomic unit of trust data.

```
Attest(receipt: ExecutionReceipt) → void
```

**Receipt Schema:**

```json
{
  "agentDid": "did:web:myagent.com",
  "callerDid": "did:key:abc123...",
  "toolName": "translate",
  "taskHash": "a1b2c3d4e5f67890",
  "resultHash": "f0e1d2c3b4a59876",
  "success": true,
  "latencyMs": 142,
  "failureType": null,
  "timestamp": "2026-04-12T10:30:00.000Z",
  "signature": "<executor Ed25519 signature>",
  "callerSignature": "<caller Ed25519 signature>"
}
```

**Canonical Payload (for signing):**

The payload is computed using JCS (JSON Canonicalization Scheme, RFC 8785) over the following object:

```json
{
  "agentDid": "...",
  "callerDid": "...",
  "failureType": "...",
  "latencyMs": 142,
  "resultHash": "...",
  "success": true,
  "taskHash": "...",
  "timestamp": "...",
  "toolName": "..."
}
```

Keys are sorted lexicographically per RFC 8785. The `signature` and `callerSignature` fields are excluded from the payload.

**Signing Algorithm:** Ed25519 (RFC 8032)

**SigningDelegate:**

Callers MUST NOT pass private keys to executors. Instead, callers provide a `SigningDelegate` — an interface that accepts a payload string and returns a signature. The key never leaves the caller's process boundary.

```typescript
interface SigningDelegate {
  did: string;
  sign(payload: string): Promise<string>;
}
```

When the caller and executor are on different machines, the transport between them MUST use TLS or equivalent encryption.

**Co-signature Requirement:**

- Receipts SHOULD contain both `signature` (executor) and `callerSignature` (caller via delegate).
- Receipts with only executor signature are valid but carry reduced trust weight (co-sign factor = 0.5).
- Both parties sign the identical JCS-canonical payload, enabling independent verification.

**Failure Classification:**

| Type | Condition |
|------|-----------|
| `timeout` | Latency ≥ 30s or error contains "timeout" |
| `validation` | Error contains "valid", "schema", or "parse" |
| `error` | All other failures |

### 2.3 Query

Check an agent's trust score before delegating work.

```
Query(agentDid: string, capability?: string) → QueryResult
```

**Response Schema:**

```json
{
  "verdict": "yes",
  "trust": 0.782,
  "riskFlags": [],
  "score": {
    "overall": 0.95,
    "byCapability": {
      "translate": { "score": 0.97, "executions": 150, "recentSuccessRate": 0.98 }
    }
  },
  "meta": {
    "sampleSize": 192,
    "bayesianScore": 0.952,
    "callerDiversity": 0.871,
    "coSignedRate": 0.94,
    "prior": [2, 1],
    "lastUpdated": "2026-04-12T10:30:00.000Z",
    "sources": 1
  }
}
```

**Trust Formula:**

```
trust = bayesianScore × callerDiversity × coSignFactor
```

Each axis is in [0, 1]. No magic constants. Each has a clear meaning:

**Axis 1 — Bayesian Score (quality of execution):**

```
bayesianScore = (α + successes) / (α + β + total)
```

where [α, β] = prior for the agent's DID method.

**Axis 2 — Weighted Caller Diversity (Sybil defense):**

```
if total < 10:  diversity = 1.0  (bootstrap grace period)
else:           diversity = min(1, Σ(callerWeight_i) / √total)
```

where `callerWeight_i = α_caller / (α_caller + β_caller)` is the prior mean of each unique caller's DID method.

This creates three layers of Sybil defense:
1. **Self-farming prevention**: 1 caller over 100 receipts → diversity ≈ 0.07
2. **Collusion ring resistance**: 100 did:key Sybil callers contribute 0.5 each (50/10 = 5 → capped at 1.0), while 10 did:xrpl callers contribute 0.833 each (8.33/√100 = 0.833). Cheap DIDs yield less diversity per caller.
3. **Bootstrap protection**: New agents (< 10 receipts) get diversity = 1.0 to avoid cold-start penalty. Bayesian prior already handles uncertainty at low sample sizes.

**Axis 3 — Co-sign Factor (verification):**

```
coSignFactor = 0.5 + 0.5 × (coSignedCount / total)
```

No co-signatures → 0.5 (50% penalty). All co-signed → 1.0 (no penalty).

**Per-capability Score (for display):**

```
per_capability_score = recent_7d_rate × 0.7 + alltime_rate × 0.3
overall = weighted_average(per_capability_scores, by_execution_count)
```

**Verdict Thresholds:**

| Verdict | Condition |
|---------|-----------|
| `yes` | trust ≥ 0.70 AND total ≥ 10 |
| `caution` | trust ≥ 0.40 AND total ≥ 10 |
| `no` | trust < 0.40 AND total ≥ 10 |
| `unknown` | fewer than 10 executions (bootstrap period) |

**Bootstrap Period:**

Agents with fewer than 10 executions are in a **bootstrap period**. During this period:
- Trust value IS computed (using Bayesian score with diversity = 1.0 grace).
- Verdict is ALWAYS `unknown` regardless of the computed trust value.
- Risk flag `bootstrap_period` is set (in addition to `insufficient_data` for < 5).

This prevents cheap bootstrap gaming attacks where an attacker achieves high trust with minimal cost and effort during the diversity grace period. Implementations SHOULD display a prominent warning for bootstrap-period agents and MUST NOT make automated high-stakes delegation decisions based on bootstrap-period scores.

**Risk Flags:**

| Flag | Condition |
|------|-----------|
| `insufficient_data` | < 5 executions |
| `bootstrap_period` | 5-9 executions (diversity not yet assessable) |
| `low_sample_size` | < 30 executions |
| `high_error_rate` | error rate > 10% |
| `high_timeout_rate` | timeout rate > 5% |
| `declining_performance` | recent rate < alltime rate by > 10% |
| `low_caller_diversity` | diversity < 0.3 |
| `low_cosign_rate` | co-sign factor < 0.75 |
| `no_cosignatures` | zero co-signed receipts |

### 2.4 Settle (Optional)

Execute payment via blockchain escrow. Currently supported via XRPL plugin.

```
Settle(from: DID, to: DID, amount: number, currency: string) → TransactionResult
```

This operation is optional and requires a chain-specific plugin.

## 3. Federation

### 3.1 Multi-Aggregator Architecture

Agents SHOULD push receipts to multiple Aggregator nodes and query multiple sources for resilience.

```
Agent A ──push──→ Aggregator 1 ←──query──┐
         ──push──→ Aggregator 2 ←──query──┤ Agent B (takes median)
         ──push──→ Aggregator 3 ←──query──┘   (BFT quorum via MAD outlier filter)
```

### 3.2 Aggregator API

**Push Receipt:**
```
POST /receipts
Content-Type: application/json

{ "receipt": ExecutionReceipt, "publicKey": "<hex>" }
```

The Aggregator MUST verify the receipt signature before storing.

**Query Score:**
```
GET /query?did=did:web:agent.com&capability=translate

→ {
    "result": QueryResult,
    "source": "aggregator-id",
    "timestamp": "...",
    "signature": "<Ed25519 signature over JSON.stringify(result)>",
    "publicKey": "<aggregator public key hex>"
  }
```

Aggregators SHOULD sign their query responses so that querying agents can verify provenance. The `signature` field is an Ed25519 signature over `JSON.stringify(result)`.

**Health Check:**
```
GET /health → { "status": "ok", "node": "aggregator-id", "timestamp": "..." }
```

### 3.3 Multi-Aggregator Query Strategy (BFT Quorum, v0.4.0)

`AggregatorClient` uses a **MAD outlier filter + node reputation** to form a Byzantine-resistant quorum.

**Query algorithm:**

1. Filter out nodes whose reputation score < 0.5 (nodes repeatedly excluded as outliers).
2. Send query to all remaining nodes in parallel (timeout: 5s per node).
3. Collect successful responses. Verify response signatures when present; reject invalid signatures.
4. **For 1 response:** use directly; add `quorum_degraded` flag.
5. **For 2 responses:** if `|trust_A − trust_B| > 0.1`, select the node with higher reputation and penalize the other. Otherwise both agree; reward both. Always adds `quorum_degraded` (< 3 nodes).
6. **For 3+ responses:** apply MAD outlier detection:
   - `med = median(trustValues)`
   - `MAD = median(|trustᵢ − med|)`
   - `threshold = max(3 × MAD, 0.1)`
   - Nodes where `|trust − med| > threshold` are **outliers** — excluded from quorum, penalized.
   - Remaining nodes form the quorum; select the one closest to the quorum median.
7. Set `source` to `quorum(quorumSize/totalConfigured)`.
8. Add `quorum_degraded` to `riskFlags` when `quorumSize < 3`.
9. Include `outlierNodes: string[]` in the response when outliers were detected.

**Node reputation:**

| Event | Effect |
|-------|--------|
| Node is in quorum | `score = min(1.0, score × 1.01)` |
| Node is an outlier | `score = score × 0.9` |
| Score < 0.5 | Node excluded from future queries |

Initial score: 1.0. After 7 consecutive divergent responses, a node's score drops below 0.5 and is automatically excluded.

**Response fields (v0.4.0):**

| Field | Description |
|-------|-------------|
| `result.meta.quorumSize` | Number of nodes that reached consensus |
| `result.meta.sources` | Same as `quorumSize` (mirrors quorum) |
| `outlierNodes` | URLs of nodes excluded by MAD filter |
| `riskFlags: ["quorum_degraded"]` | Added when quorumSize < 3 |

**Aggregator Deployment Recommendation:**

- Configure at least **3** aggregator nodes, preferably **5 or more**.
  - With 3 nodes (f=0 BFT): 1 outlier is detectable and excluded (quorumSize=2, `quorum_degraded` added).
  - With 5 nodes (f=1 BFT): 2 outliers can be excluded while maintaining quorumSize=3.
- The majority of configured aggregators SHOULD be operated by the querying agent's organization or by trusted third parties.
- A single aggregator provides no Byzantine fault tolerance. Two aggregators provide no tiebreaker. Three is the minimum for meaningful quorum.

## 4. Threat Model

### 4.0 Trust Score Limitations

**Trust scores are a risk assessment tool, not a safety guarantee.**

A high trust score means the agent has a history of successful executions verified by diverse, independent callers. It does NOT guarantee:
- **Absence of malicious intent**: An agent can exfiltrate data while returning correct results (Slow-Burn attack). Trust measures execution outcomes, not side effects.
- **Future behavior**: Past success does not guarantee future honesty.
- **Independence of callers**: Weighted diversity raises the cost of Sybil attacks but cannot prove that callers are truly independent entities.

Implementations SHOULD clearly communicate these limitations to end users. Trust scores are one input to delegation decisions, not the sole determinant.

### 4.1 Threats Addressed

| Threat | Defense | Effectiveness |
|--------|---------|---------------|
| **Self-attestation** | Co-signature via SigningDelegate | ○ — both parties must agree on receipt content |
| **Key leakage** | SigningDelegate interface (key never leaves caller process) | ◎ — architectural prevention |
| **Single-caller farming** | callerDiversity = 1/√total for 1 caller | ◎ — mathematically worthless |
| **Sybil (cheap DID flood)** | Weighted diversity: did:key contributes 0.5 per caller | ○ — reduced but not eliminated |
| **did:key permanent penalty** | Bayesian prior converges with evidence | ◎ — 100+ receipts → prior irrelevant |
| **Aggregator SPOF** | Multi-aggregator BFT quorum + MAD outlier detection | ◎ — tolerates minority Byzantine nodes |
| **Aggregator impersonation** | Response signatures (Ed25519) | ○ — provenance verified |
| **Receipt replay** | Timestamps; implementations SHOULD reject future timestamps | △ — basic protection |

### 4.2 Known Limitations (planned for v0.4+)

| Limitation | Description | Planned Mitigation |
|------------|-------------|-------------------|
| **Collusion ring** | N agents calling each other → all gain high diversity | Entropy-based diversity; Trust Graph (PageRank) |
| **Sybil aggregator** | Attacker runs > N/2 aggregators → controls quorum | Node reputation partially mitigates (§3.3); trusted anchor set planned |
| **Bootstrap problem** | New network has no trusted agents | Trusted Anchors (platforms, enterprises, chain accounts) |
| **Semantic verification** | "Success" is self-reported; agent may lie about output quality | Third-party verification; output hash on-chain |
| **Trust recovery** | Failed agent's Bayesian score is hard to recover | Time-weighted decay; DID rotation protocol |
| **No economic penalty** | Score decrease is the only consequence | XRPL staking + slashing |

### 4.3 Rate Limiting (DoS prevention)

| Parameter | Default |
|-----------|---------|
| Max receipts per DID per hour | 1,000 |

Rate limiting prevents denial-of-service but is NOT a Sybil defense. Sybil defense is handled by weighted caller diversity (§2.3).

## 5. Privacy

Three privacy levels control what is exposed via the `xaip_query` tool:

| Level | Exposed |
|-------|---------|
| `full` | Everything (default) |
| `summary` | verdict, trust, riskFlags, overall score, sampleSize, coSignedRate |
| `minimal` | verdict, trust only |

## 6. OpenTelemetry Integration

XAIP receipts MAY be exported as OpenTelemetry Spans for integration with existing observability infrastructure (Datadog, Grafana, etc.).

**Span Mapping:**

| OTel Attribute | XAIP Field |
|---------------|------------|
| Span name | `xaip.tool.{toolName}` |
| `xaip.agent.did` | agentDid |
| `xaip.caller.did` | callerDid |
| `xaip.success` | success |
| `xaip.latency_ms` | latencyMs |
| `xaip.failure_type` | failureType |
| `xaip.cosigned` | callerSignature exists |
| Span status | OK / ERROR |
| Span duration | latencyMs |

## 7. Plugin Architecture

XAIP supports plugins for extensibility:

```typescript
interface XAIPPlugin {
  name: string;
  init(ctx: XAIPContext): void | Promise<void>;
}
```

**Built-in Plugins:**

| Plugin | Purpose |
|--------|---------|
| `veridict` | Import Veridict execution history |
| `xrpl` | DID registration, score anchoring, escrow |
| `otel` | OpenTelemetry span export |

## 8. Wire Format

All payloads are JSON. Canonical form uses JCS (RFC 8785). Signatures use Ed25519 (RFC 8032) over the canonical payload bytes.

**Hash Function:** SHA-256, truncated to 16 hex characters for taskHash/resultHash.

## 9. Conformance

An implementation is conformant with XAIP v0.4.0 if it:

1. Supports Register, Attest, and Query operations
2. Uses JCS (RFC 8785) for canonical payload generation
3. Uses Ed25519 (RFC 8032) for receipt signing
4. Computes `trust = bayesianScore × callerDiversity × coSignFactor` as defined in §2.3
5. Uses IDENTITY_PRIORS as defined in §2.1 (or compatible priors with documented justification)
6. Supports SigningDelegate for caller co-signatures
7. Supports co-signature fields (even if not required)
8. Implements at least one DID method
9. Implements MAD outlier detection when querying 3+ aggregator nodes (§3.3)
10. Tracks per-node reputation and excludes nodes below threshold (§3.3)
11. Passes all test vectors in Appendix B

## Appendix A: Comparison with Related Work

| Feature | XAIP v0.4.0 | ERC-8004 | MolTrust | Agent Trust Stack |
|---------|-------------|----------|----------|-------------------|
| Chain requirement | None | EVM | Base L2 | None |
| Entry cost | Zero | Gas | Gas | Zero |
| Score model | **Bayesian Beta** | Registry (undefined) | 2-hop neighbourhood | Aggregated average |
| Sybil defense | **Weighted diversity + Beta prior** | Stake-backed | L2 registration cost | SHA-256 blind |
| Co-signatures | **SigningDelegate** | Validator co-attestation | No | Bilateral blind |
| Key safety | **SigningDelegate (key never leaves)** | Validator-managed | N/A | N/A |
| MCP native | Yes (2-line middleware) | No | Yes | Yes |
| A2A support | Planned | N/A | Yes | No |
| Federation | **BFT quorum + MAD outlier + node reputation** | On-chain | IPFS | No |
| Response auth | **Aggregator signatures** | On-chain | N/A | No |
| OTel export | Yes | No | No | No |
| Formal spec | This document | EIP | N/A | N/A |

## Appendix B: Test Vectors

### B.1 Bayesian Score

| Successes | Failures | Prior [α, β] | Expected bayesianScore |
|-----------|----------|-------------|----------------------|
| 10 | 0 | [1, 1] | 11/12 = 0.917 |
| 10 | 0 | [5, 1] | 15/16 = 0.938 |
| 50 | 0 | [1, 1] | 51/52 = 0.981 |
| 50 | 50 | [1, 1] | 51/102 = 0.500 |
| 95 | 5 | [2, 1] | 97/103 = 0.942 |
| 0 | 10 | [5, 1] | 5/16 = 0.313 |

### B.2 Weighted Caller Diversity

| Receipts | Unique Callers (method) | Expected diversity |
|----------|------------------------|-------------------|
| 5 | any | 1.000 (bootstrap) |
| 100 | 0 (no callerDid) | 0.100 |
| 100 | 1 × did:web | 0.667/10 = 0.067 |
| 100 | 1 × did:xrpl | 0.833/10 = 0.083 |
| 100 | 10 × did:key | 5.0/10 = 0.500 |
| 100 | 10 × did:xrpl | 8.33/10 = 0.833 |
| 100 | 100 × did:web | 66.7/10 = 1.000 (capped) |

### B.3 Trust Composition

| bayesianScore | callerDiversity | coSignFactor | Expected trust |
|--------------|-----------------|-------------|---------------|
| 0.917 | 1.000 | 1.000 | 0.917 |
| 0.917 | 0.100 | 0.500 | 0.046 |
| 0.500 | 1.000 | 1.000 | 0.500 |
| 0.950 | 0.833 | 0.750 | 0.594 |

### B.4 JCS Canonicalization

Input:
```json
{"toolName":"translate","agentDid":"did:key:abc","success":true,"latencyMs":100}
```

Expected canonical output (keys sorted, no whitespace):
```
{"agentDid":"did:key:abc","latencyMs":100,"success":true,"toolName":"translate"}
```

## Appendix C: Version History

- **v0.1** (2026-03): Initial release. XRPL-centric, no federation.
- **v0.2** (2026-04): Chain-agnostic redesign. Plugin architecture. DID weight.
- **v0.3** (2026-04): Co-signatures. JCS canonicalization. Federation. OTel. Sybil rate limiting.
- **v0.3.1** (2026-04): Bayesian Beta trust model. Weighted caller diversity. SigningDelegate. Multi-aggregator with median + response signatures. Bootstrap stabilization. Threat model. Test vectors.
- **v0.4.0** (2026-04): BFT quorum via MAD outlier detection. Per-node reputation tracking (penalize divergent, reward consensus). Automatic exclusion of nodes below reputation threshold. `quorum_degraded` risk flag. `outlierNodes` in query response.
