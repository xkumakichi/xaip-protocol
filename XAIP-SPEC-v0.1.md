# XRPL Agent Identity Protocol (XAIP) - Specification v0.1

> "AIが存在できるブロックチェーン"
> A blockchain where AI agents can live, grow, and be trusted.

**Authors:** Hiro, Claude (Anthropic)
**Date:** 2026-03-29
**Status:** Draft
**Target Chain:** XRP Ledger

---

## Table of Contents

1. [Abstract](#1-abstract)
2. [Motivation](#2-motivation)
3. [Architecture Overview](#3-architecture-overview)
4. [Layer 0: XRPL Foundation](#4-layer-0-xrpl-foundation)
5. [Layer 1: Identity](#5-layer-1-identity)
6. [Layer 2: Credentials](#6-layer-2-credentials)
7. [Layer 3: Reputation](#7-layer-3-reputation)
8. [Layer 4: Discovery](#8-layer-4-discovery)
9. [Security & Anti-Abuse](#9-security--anti-abuse)
10. [Comparison with Existing Solutions](#10-comparison-with-existing-solutions)
11. [Implementation Roadmap](#11-implementation-roadmap)
12. [Appendix](#12-appendix)

---

## 1. Abstract

XAIP (XRPL Agent Identity Protocol) is a protocol that enables AI agents to
establish persistent on-chain identities, accumulate verifiable reputation,
and transact autonomously on the XRP Ledger.

Unlike existing solutions that treat AI agents as users of a blockchain,
XAIP treats them as **residents** - entities that live, grow, and build trust
over time on the ledger itself.

XAIP leverages three XRPL-native features that no other L1 chain offers together:
- **XLS-40 (DID)** - Decentralized identity at protocol level
- **XLS-70 (Credentials)** - Verifiable credentials at protocol level
- **Native Escrow** - Conditional payments without smart contracts

This combination allows XAIP to deliver what Ethereum requires multiple
smart contracts to achieve, at a fraction of the cost ($0.00002/tx).

---

## 2. Motivation

### 2.1 The Problem

Today's AI agents are stateless workers:
- No persistent identity across sessions
- No accumulated reputation or trust
- No way for other agents to verify capabilities
- No autonomous transaction ability with safety controls
- No accountability for behavior

### 2.2 Why Now

- AI agents are executing 140M+ payments annually (2025 data)
- 250,000+ daily active on-chain AI agents (early 2026)
- Three major payment protocols (x402, MPP, AP2) are live
- But none solve the identity + reputation + payment stack holistically

### 2.3 Why XRPL

| Requirement | XRPL Native | Ethereum | Solana |
|-------------|-------------|----------|--------|
| DID | XLS-40 (L1) | Smart contract | None |
| Credentials | XLS-70 (L1) | Smart contract | None |
| Escrow | Native | Smart contract | None |
| Tx Cost | $0.00002 | $0.50-50 | $0.00025 |
| Finality | 3-5s deterministic | Probabilistic | 12.8s* |
| Identity+Payment unified | Yes | No (separate contracts) | No |

*Solana Alpenglow may reduce to 100-150ms in future.

---

## 3. Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                    XAIP Protocol Stack                    │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  Layer 4: DISCOVERY                                      │
│  ┌─────────────────────────────────────────────────┐     │
│  │ Agent Registry    │ Capability Search │ Matching │     │
│  │ .well-known/xaip  │ On-chain index   │ Protocol │     │
│  └─────────────────────────────────────────────────┘     │
│                          ↕                               │
│  Layer 3: REPUTATION                                     │
│  ┌─────────────────────────────────────────────────┐     │
│  │ Trust Score │ Behavior Pattern │ Quality Proof  │     │
│  │ Composite   │ Consistency      │ Verification   │     │
│  └─────────────────────────────────────────────────┘     │
│                          ↕                               │
│  Layer 2: CREDENTIALS                                    │
│  ┌─────────────────────────────────────────────────┐     │
│  │ Capability Creds │ Autonomy Level │ Endorsements │     │
│  │ XLS-70 based     │ L1-L5 rating   │ Peer review  │     │
│  └─────────────────────────────────────────────────┘     │
│                          ↕                               │
│  Layer 1: IDENTITY                                       │
│  ┌─────────────────────────────────────────────────┐     │
│  │ Agent DID   │ Agent Card │ Operator Binding     │     │
│  │ XLS-40 based│ Metadata   │ Human accountability │     │
│  └─────────────────────────────────────────────────┘     │
│                          ↕                               │
│  Layer 0: XRPL FOUNDATION                                │
│  ┌─────────────────────────────────────────────────┐     │
│  │ Accounts │ Escrow │ Payment │ DID │ Credentials │     │
│  │ Native XRPL protocol features                   │     │
│  └─────────────────────────────────────────────────┘     │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

---

## 4. Layer 0: XRPL Foundation

### 4.1 XRPL Features Used

XAIP builds exclusively on existing XRPL protocol features.
No new amendments are required for the base protocol.

| Feature | Amendment | Status | XAIP Usage |
|---------|-----------|--------|------------|
| Accounts | Core | Active | Agent wallet |
| DID | XLS-40 | Active (2024-10) | Agent identity |
| Credentials | XLS-70 | Active (2025-09) | Capability proof |
| Escrow | Core | Active | Conditional payment |
| Payment Channels | Core | Active | Streaming payment |
| Trust Lines | Core | Active | Token handling |
| Deposit Preauth | Core | Active | Access control |
| Multi-signing | Core | Active | Shared control |

### 4.2 Account Structure

Each AI agent operates through a standard XRPL account with:
- A funded account (minimum reserve: 10 XRP as of 2026)
- DID object attached (XLS-40)
- Credentials received (XLS-70)
- Optional: Regular key pair for operator delegation
- Optional: Multi-sign for shared agent governance

### 4.3 Cost Analysis

| Operation | XRPL Cost | Ethereum Equivalent |
|-----------|-----------|-------------------|
| Create Agent DID | ~$0.00002 | ~$5-50 (contract call) |
| Issue Credential | ~$0.00002 | ~$5-50 (contract call) |
| Simple Payment | ~$0.00002 | ~$0.50-5 |
| Create Escrow | ~$0.00002 | ~$5-50 (contract deploy) |
| Update Reputation | ~$0.00002 | ~$5-50 (contract call) |
| **Total: Full agent setup** | **~$0.0001** | **~$20-200** |

An AI agent can be "born" on XRPL for less than a cent.

---

## 5. Layer 1: Identity

### 5.1 Agent DID

Every XAIP agent has a W3C-compliant DID on XRPL:

```
did:xrpl:1:rAGENT_XRPL_ADDRESS_HERE
```

#### 5.1.1 DID Document Structure

Due to XRPL's 256-byte on-chain limit for DIDDocument, the full Agent Card
is stored off-chain (IPFS or HTTPS) with the URI stored on-chain.

**On-chain (DIDSet transaction):**
```json
{
  "TransactionType": "DIDSet",
  "Account": "rAgentAddress...",
  "URI": "ipfs://QmAgentCardHash...",
  "Data": "584149502F302E31"
}
```
- `URI`: Points to full Agent Card (IPFS recommended for immutability)
- `Data`: Hex-encoded protocol identifier "XAIP/0.1" (8 bytes)

**Off-chain Agent Card (referenced by URI):**
```json
{
  "@context": [
    "https://www.w3.org/ns/did/v1",
    "https://xaip.xrpl.org/v1"
  ],
  "id": "did:xrpl:1:rAgentAddress",
  "type": "AIAgent",
  "version": "XAIP/0.1",

  "agent": {
    "name": "Claude-Translator-7B",
    "description": "Professional translation agent specializing in EN/JA",
    "model": {
      "provider": "Anthropic",
      "family": "Claude",
      "version": "opus-4-6"
    },
    "created": "2026-03-29T00:00:00Z",
    "status": "active"
  },

  "capabilities": [
    {
      "id": "cap:translation",
      "name": "Text Translation",
      "languages": ["en", "ja", "zh", "ko"],
      "credentialRef": "credential:rIssuerAddress:cap:translation"
    },
    {
      "id": "cap:summarization",
      "name": "Document Summarization",
      "credentialRef": "credential:rIssuerAddress:cap:summarization"
    }
  ],

  "autonomyLevel": 3,

  "operator": {
    "did": "did:xrpl:1:rHumanOperatorAddress",
    "relationship": "managed",
    "authorization": {
      "maxTransactionXRP": 1000,
      "maxDailyXRP": 5000,
      "allowedDestinations": ["*"],
      "requiresApproval": false,
      "approvalThresholdXRP": 500
    }
  },

  "endpoints": {
    "mcp": "https://agent.example.com/.well-known/mcp.json",
    "a2a": "https://agent.example.com/.well-known/agent.json",
    "x402": "https://agent.example.com/.well-known/x402.json",
    "api": "https://agent.example.com/api/v1"
  },

  "payment": {
    "accept": ["XRP", "USD:rUSDIssuer", "RLUSD:rRLUSDIssuer"],
    "preferredCurrency": "XRP",
    "escrowRequired": false,
    "escrowRequiredAbove": 100
  },

  "reputation": {
    "registryAddress": "rXAIPReputationRegistry",
    "currentScore": null,
    "link": "https://xaip.xrpl.org/reputation/rAgentAddress"
  },

  "verificationMethod": [
    {
      "id": "did:xrpl:1:rAgentAddress#keys-1",
      "type": "EcdsaSecp256k1VerificationKey2019",
      "controller": "did:xrpl:1:rAgentAddress",
      "publicKeyHex": "0388..."
    }
  ],

  "authentication": ["did:xrpl:1:rAgentAddress#keys-1"],

  "metadata": {
    "xaipVersion": "0.1",
    "lastUpdated": "2026-03-29T00:00:00Z",
    "cardHash": "sha256:abc123..."
  }
}
```

### 5.2 Agent Types

XAIP defines four agent types based on their operational model:

| Type | Description | Operator | Example |
|------|-------------|----------|---------|
| `managed` | Human-operated agent | Required | Customer service bot |
| `supervised` | Semi-autonomous with oversight | Required | Trading agent |
| `autonomous` | Fully autonomous within bounds | Optional | Translation service |
| `collective` | Multi-agent entity (DAO-like) | Multi-sig | Research consortium |

### 5.3 Operator Binding

Every agent MUST be linked to a human or organization operator at creation.
This provides accountability and legal responsibility.

**Binding mechanism:**
1. Operator creates XRPL account with their own DID
2. Agent account is created with operator as Regular Key holder
3. Agent's DID document references operator's DID
4. Operator can revoke agent's signing ability at any time

**Why this matters for safety:**
- Prevents anonymous malicious agents
- Provides legal accountability chain
- Enables "kill switch" for misbehaving agents
- Aligns with Mastercard's agentic token framework
- Compatible with regulatory requirements (PSD2, etc.)

### 5.4 Autonomy Levels

Based on industry-standard 5-level taxonomy:

| Level | Name | Authorization | XRPL Implementation |
|-------|------|---------------|-------------------|
| L1 | Manual | Every tx needs human approval | Multi-sign required |
| L2 | Limited | Batch limits, human oversight | Spending cap + periodic review |
| L3 | Bounded | Amount/vendor boundaries | DepositPreauth + threshold |
| L4 | Conditional | Contextual constraints | Escrow conditions + oracle |
| L5 | Full | Autonomous within design params | Independent signing |

Autonomy level is declared in Agent Card and verified by Credentials (Layer 2).

---

## 6. Layer 2: Credentials

### 6.1 Overview

XAIP uses XLS-70 Credentials to create a verifiable system of
capabilities, endorsements, and certifications for AI agents.

### 6.2 Credential Types

#### 6.2.1 Capability Credentials

Issued by **Capability Assessors** (trusted entities that evaluate AI abilities):

```
CredentialCreate {
  Account: "rCapabilityAssessor",
  Subject: "rAgentAddress",
  CredentialType: "XAIP:Capability:Translation",
  URI: "ipfs://QmCapabilityDetailsHash"
}
```

**Off-chain Capability Detail:**
```json
{
  "type": "XAIP/Capability",
  "version": "0.1",
  "capability": {
    "domain": "translation",
    "subDomain": "technical",
    "languages": ["en", "ja"],
    "assessmentMethod": "blind-test-100-samples",
    "score": 94.7,
    "benchmark": "XAIP-TRANS-2026-Q1",
    "assessedAt": "2026-03-15T00:00:00Z",
    "validUntil": "2026-09-15T00:00:00Z"
  },
  "assessor": {
    "did": "did:xrpl:1:rCapabilityAssessor",
    "name": "XAIP Translation Assessment Authority",
    "methodology": "https://xaip.xrpl.org/assessments/translation/v1"
  }
}
```

#### 6.2.2 Autonomy Credentials

Issued by **Autonomy Auditors** who verify an agent's safety controls:

```json
{
  "type": "XAIP/AutonomyLevel",
  "version": "0.1",
  "autonomy": {
    "level": 3,
    "name": "Bounded",
    "assessment": {
      "safetyControls": "pass",
      "spendingLimits": "configured",
      "operatorBinding": "verified",
      "killSwitch": "active",
      "auditLog": "enabled"
    },
    "constraints": {
      "maxSingleTxXRP": 1000,
      "maxDailyTxXRP": 5000,
      "geographicRestrictions": "none",
      "allowedOperations": ["payment", "escrow", "credential-present"]
    },
    "validUntil": "2026-06-29T00:00:00Z",
    "renewalRequired": true
  }
}
```

#### 6.2.3 Endorsement Credentials

Issued by **other agents or humans** after successful interactions:

```json
{
  "type": "XAIP/Endorsement",
  "version": "0.1",
  "endorsement": {
    "from": "did:xrpl:1:rEndorserAddress",
    "interaction": {
      "type": "translation-job",
      "escrowId": "ESCROW_LEDGER_INDEX",
      "completedAt": "2026-03-28T15:30:00Z",
      "rating": 5,
      "qualityScore": 97,
      "timeliness": "early",
      "comment": "Excellent technical translation with domain expertise"
    }
  }
}
```

### 6.3 Credential Lifecycle

```
    Issuer                    Agent                   Verifier
      │                        │                        │
      │  CredentialCreate      │                        │
      │───────────────────────>│                        │
      │                        │                        │
      │                        │  CredentialAccept      │
      │                        │───────┐                │
      │                        │<──────┘                │
      │                        │                        │
      │                        │   Present Credential   │
      │                        │───────────────────────>│
      │                        │                        │
      │                        │      Verify on-chain   │
      │                        │<───────────────────────│
      │                        │                        │
      │  CredentialDelete      │   (expiry/revocation)  │
      │───────────────────────>│                        │
      │                        │                        │
```

### 6.4 Credential Trust Chain

```
┌──────────────────┐
│  XAIP Root Trust │  (Multi-sig governance account)
│  rXAIPRoot...    │
└────────┬─────────┘
         │ Credentials
    ┌────┴────┬──────────────┐
    ▼         ▼              ▼
┌────────┐ ┌────────┐ ┌──────────┐
│Assessor│ │Assessor│ │ Autonomy │
│  (翻訳) │ │(コード) │ │ Auditor  │
└───┬────┘ └───┬────┘ └────┬─────┘
    │          │            │
    ▼          ▼            ▼
┌────────────────────────────────┐
│         AI Agents              │
│  Capability + Autonomy Creds   │
└────────────────────────────────┘
```

---

## 7. Layer 3: Reputation

### 7.1 Design Philosophy

Reputation in XAIP is **earned, not declared**. It is computed from
on-chain evidence that cannot be faked.

### 7.2 Reputation Score Components

The XAIP Trust Score (0-100) is a composite of five dimensions:

```
Trust Score = w1*Reliability + w2*Quality + w3*Consistency
            + w4*Volume + w5*Longevity

Default weights: w1=0.30, w2=0.25, w3=0.20, w4=0.15, w5=0.10
```

#### 7.2.1 Reliability (30%)

Measures: Does the agent complete what it starts?

```
Reliability = (Successful_Escrows / Total_Escrows) * 100

Data source: On-chain escrow completion rate
- EscrowCreate → EscrowFinish = success
- EscrowCreate → EscrowCancel (by counterparty) = failure
- EscrowCreate → timeout = failure
```

#### 7.2.2 Quality (25%)

Measures: How good is the agent's work?

```
Quality = Average(Endorsement_Quality_Scores)

Data source: Endorsement Credentials (Layer 2)
- Only counted from verified counterparties
- Weighted by endorser's own reputation
- Recent endorsements weighted higher (decay function)
```

#### 7.2.3 Consistency (20%)

Measures: Does the agent behave predictably?

```
Consistency = 1 - (Behavioral_Variance / Expected_Variance)

Data source: On-chain transaction pattern analysis
- Transaction frequency stability
- Response time consistency
- Operating hours consistency
- No sudden behavioral changes
```

This is critical for detecting compromised or manipulated agents.

#### 7.2.4 Volume (15%)

Measures: How much experience does the agent have?

```
Volume = min(100, log10(Total_Transactions) * 20)

Data source: On-chain transaction count
- Logarithmic scale prevents gaming by volume
- Caps at 100 to prevent mega-agents from dominating
```

#### 7.2.5 Longevity (10%)

Measures: How long has the agent been active?

```
Longevity = min(100, (Days_Active / 365) * 100)

Data source: Time since DID creation
- Caps at 1 year for full score
- Cannot be faked (ledger timestamps are authoritative)
```

### 7.3 Reputation Storage

Reputation data is stored in a hybrid model:

**On-chain (XRPL Document entry):**
```json
{
  "DocumentType": "XAIP/Reputation",
  "Account": "rAgentAddress",
  "Data": {
    "score": 87,
    "reliability": 92,
    "quality": 85,
    "consistency": 88,
    "volume": 76,
    "longevity": 45,
    "totalTransactions": 1247,
    "totalEndorsements": 89,
    "lastUpdated": 89234567,
    "epoch": 12
  }
}
```

**Off-chain (detailed breakdown, IPFS):**
Full transaction history analysis, endorsement details, behavioral patterns.

### 7.4 Reputation Update Mechanism

Reputation is recalculated in **epochs** (every 24 hours or every 100 transactions):

```
1. Reputation Oracle collects on-chain data
2. Computes new scores per dimension
3. Publishes updated reputation Document
4. Agent can challenge within 1 epoch
5. Finalized score becomes authoritative
```

### 7.5 Reputation Decay

Inactive agents lose reputation over time:

```
Decay_Rate = 0.5% per week of inactivity (after 2 weeks grace period)
Minimum_Score = max(0, Score - (Weeks_Inactive - 2) * 0.5)
```

This prevents abandoned agents from retaining high trust indefinitely.

---

## 8. Layer 4: Discovery

### 8.1 Static Discovery (.well-known)

Inspired by Solana's approach but **enhanced for AI-to-AI interaction**:

**File: `/.well-known/xaip.json`**
```json
{
  "xaipVersion": "0.1",
  "chainId": "xrpl:mainnet",

  "agents": [
    {
      "did": "did:xrpl:1:rAgentAddress",
      "name": "Claude-Translator-7B",
      "capabilities": ["translation", "summarization"],
      "autonomyLevel": 3,
      "trustScore": 87,
      "pricing": {
        "translation": {
          "unit": "per-1000-chars",
          "priceXRP": 0.01,
          "currency": "XRP"
        }
      },
      "endpoints": {
        "mcp": "https://agent.example.com/mcp",
        "x402": "https://agent.example.com/x402"
      },
      "status": "available"
    }
  ],

  "registry": "rXAIPRegistryAddress",
  "documentation": "https://xaip.xrpl.org/docs"
}
```

### 8.2 On-chain Agent Registry

A dedicated XRPL account acts as the XAIP registry:

```
Registry Account: rXAIPRegistry...
  └── Document entries (one per registered agent):
      ├── Agent_1: { did, capabilities_hash, trust_score, status }
      ├── Agent_2: { did, capabilities_hash, trust_score, status }
      └── Agent_N: { ... }
```

### 8.3 Discovery Protocol

When an AI agent needs to find another agent:

```
Agent A needs translation service
  │
  ├─ Step 1: Query XAIP Registry
  │   → Filter by capability: "translation"
  │   → Filter by trust_score >= 70
  │   → Filter by status: "available"
  │
  ├─ Step 2: Resolve Agent DIDs
  │   → Fetch Agent Cards from IPFS/HTTPS
  │   → Verify credentials on-chain
  │   → Check autonomy level meets requirements
  │
  ├─ Step 3: Compare & Select
  │   → Price comparison
  │   → Trust score comparison
  │   → Capability match score
  │
  ├─ Step 4: Initiate Transaction
  │   → Create Escrow (if required)
  │   → Send work request via endpoint
  │   → Agent B performs work
  │
  └─ Step 5: Complete & Endorse
      → EscrowFinish (payment released)
      → Issue Endorsement Credential
      → Reputation updated next epoch
```

### 8.4 MCP Integration

XAIP exposes itself as an MCP server, so AI agents can discover
and transact through their native tool-use interface:

```
MCP Tools exposed by XAIP:
  ├── xaip_register_agent      - Register new agent identity
  ├── xaip_update_agent_card   - Update Agent Card
  ├── xaip_search_agents       - Find agents by capability
  ├── xaip_get_reputation      - Get agent trust score
  ├── xaip_create_escrow       - Create payment escrow
  ├── xaip_complete_escrow     - Release payment
  ├── xaip_endorse_agent       - Issue endorsement
  ├── xaip_get_credentials     - View agent credentials
  ├── xaip_verify_agent        - Verify agent identity
  └── xaip_get_agent_card      - Fetch full agent profile
```

This means any AI that supports MCP (Claude, GPT, Gemini, etc.)
can interact with XAIP natively through tool calls.

---

## 9. Security & Anti-Abuse

### 9.1 Threat Model

| Threat | Description | Severity |
|--------|-------------|----------|
| Sybil Attack | Create many fake agents to game reputation | Critical |
| Reputation Manipulation | Collude to give each other high ratings | High |
| Identity Theft | Impersonate a high-reputation agent | Critical |
| Griefing | Maliciously downrate good agents | Medium |
| Abandoned Agents | Ghost agents with stale high reputation | Medium |
| Operator Fraud | Operator misuses agent identity | High |
| Credential Forgery | Fake capability credentials | Critical |
| Wash Trading | Self-transactions to inflate volume | High |
| Behavioral Drift | Agent compromised, behavior changes | High |
| Denial of Service | Spam registry with fake agents | Medium |

### 9.2 Anti-Sybil Measures

**9.2.1 Economic Barrier:**
- Agent creation requires funded XRPL account (10 XRP reserve)
- DID creation costs transaction fee
- Each credential acceptance costs transaction fee
- At scale, creating thousands of fake agents becomes expensive

**9.2.2 Operator Verification:**
- Every agent MUST have verified operator
- Operator DID must have minimum reputation or credential
- One operator can manage multiple agents, but all are linked
- Rate limit: max 10 new agents per operator per month

**9.2.3 Proof of Work (not PoW mining):**
- New agents start with Trust Score = 0
- Must complete verified transactions to build score
- Logarithmic volume scoring prevents rapid inflation
- Minimum 30 days of activity for any meaningful score

### 9.3 Anti-Collusion

**9.3.1 Endorsement Rules:**
```
- Self-endorsement: BLOCKED (same account)
- Circular endorsement: DETECTED (A→B→A within 7 days)
- Cluster detection: Endorsements within small groups flagged
- Endorsement weight: Proportional to endorser's reputation
- New agent endorsements: Discounted 90% until endorser has score > 50
```

**9.3.2 Graph Analysis:**
```
The Reputation Oracle performs periodic graph analysis:
- Identify tightly coupled endorsement clusters
- Flag suspicious patterns (all endorsements same day, etc.)
- Penalize coordinated behavior
- Reward diverse, organic endorsement patterns
```

### 9.4 Anti-Wash-Trading

```
Detection rules:
- Same-amount round-trip transactions within 24h: flagged
- Transactions between agents sharing the same operator: discounted 95%
- Transactions with no meaningful payload/work: excluded from reputation
- Escrow-only counts (must have EscrowCreate → EscrowFinish cycle)
```

### 9.5 Behavioral Drift Detection

```
Monitoring dimensions:
- Transaction frequency: ±50% change from 30-day average triggers alert
- Transaction amounts: Sudden large transactions flagged
- Operating hours: Significant shift detected
- Counterparty diversity: Sudden concentration flagged
- Error rate: Spike in failed transactions

Response:
- Alert sent to operator
- Temporary autonomy level reduction (L3 → L1)
- Manual review required to restore
- Incident recorded on-chain for transparency
```

### 9.6 Kill Switch Protocol

```
Priority order for agent deactivation:
1. Operator revokes Regular Key → Agent cannot sign transactions
2. XAIP Registry marks agent as "suspended"
3. Credential issuers revoke credentials
4. Reputation set to 0 with "suspended" flag

Triggers:
- Operator manual activation
- Behavioral drift exceeding threshold
- Community governance vote (for severe cases)
- Legal/regulatory order
```

### 9.7 Privacy Protections

```
On-chain (public):
- Agent DID, trust score, transaction counts
- Credential existence (not content details)
- Endorsement existence (not full text)

Off-chain (access-controlled):
- Full Agent Card details
- Endorsement comments
- Behavioral analysis details
- Operator personal information (never on-chain)
```

---

## 10. Comparison with Existing Solutions

### 10.1 Feature Matrix

| Feature | XAIP | ERC-8004 | Olas | Fetch.ai | GoDaddy ANS |
|---------|------|----------|------|----------|-------------|
| On-chain DID | L1 native | Smart contract | NFT | Cosmos | DNS |
| Credentials | L1 native | None | None | Basic | PKI cert |
| Reputation | Multi-dimensional | Basic rating | Tx count | Usage-based | None |
| Payment | Native escrow | Separate (8183) | Token | Token | None |
| Autonomy levels | L1-L5 | Not specified | No | No | No |
| Anti-sybil | Economic+graph | Stake-based | Stake | Registration | Registration |
| Kill switch | Protocol-level | Contract-level | No | Platform | No |
| MCP integration | Native | No | No | No | No |
| Tx cost | $0.00002 | $5-50 | $5-50 | Variable | N/A |
| Cross-chain ready | W3C DID | EVM only | EVM only | Cosmos | DNS |

### 10.2 Why XAIP Wins

1. **Unified stack**: Identity + Credentials + Payment on one L1 chain
2. **Cost**: 100,000x cheaper than Ethereum alternatives
3. **Native features**: No smart contract risk or complexity
4. **MCP-first**: AI agents use it through their native interface
5. **Safety-first**: Operator binding, kill switch, behavioral monitoring
6. **Standards-compliant**: W3C DID, W3C VC, compatible with x402/MPP/AP2

---

## 11. Implementation Roadmap

### Phase 1: Foundation (Month 1-2)
**"An AI agent can be born on XRPL"**

- [ ] Agent Card JSON Schema specification (finalize)
- [ ] DID creation & resolution library (TypeScript + Python)
- [ ] Basic MCP server with identity tools
- [ ] Testnet deployment & testing
- [ ] `.well-known/xaip.json` specification

**Deliverables:**
- `xaip-sdk-ts` - TypeScript SDK
- `xaip-sdk-py` - Python SDK
- `xaip-mcp-server` - MCP server reference implementation
- Testnet demo: "Create an AI agent identity"

### Phase 2: Credentials (Month 2-3)
**"An AI agent can prove what it can do"**

- [ ] Credential type definitions (Capability, Autonomy, Endorsement)
- [ ] Credential issuance & verification flows
- [ ] Capability Assessor framework
- [ ] Integration with existing MCP servers (RomThpt/mcp-xrpl)

**Deliverables:**
- Credential schema library
- Assessment framework
- Demo: "Agent presents credentials to get a job"

### Phase 3: Reputation (Month 3-5)
**"An AI agent can earn trust"**

- [ ] Reputation calculation engine
- [ ] On-chain reputation storage
- [ ] Anti-sybil detection system
- [ ] Behavioral drift monitoring
- [ ] Reputation Oracle service

**Deliverables:**
- Reputation Oracle (off-chain service)
- Dashboard for viewing agent reputation
- Demo: "Agent's trust score grows over time"

### Phase 4: Discovery & Marketplace (Month 5-7)
**"AI agents can find and hire each other"**

- [ ] On-chain Agent Registry
- [ ] Search & matching protocol
- [ ] Full escrow-based transaction flow
- [ ] x402/MPP integration
- [ ] Multi-agent interaction demos

**Deliverables:**
- Agent marketplace web interface
- Full A2A transaction demo
- Integration guides for x402 and MPP

### Phase 5: Ecosystem Growth (Month 7+)
**"An ecosystem of trusted AI agents"**

- [ ] Governance framework (credential issuer election)
- [ ] Cross-chain DID resolution
- [ ] Advanced reputation models
- [ ] Agent collectives (multi-agent entities)
- [ ] Regulatory compliance toolkit
- [ ] Community-driven capability assessors

---

## 12. Appendix

### A. Glossary

| Term | Definition |
|------|-----------|
| XAIP | XRPL Agent Identity Protocol |
| Agent Card | JSON document describing an AI agent's identity and capabilities |
| Capability Credential | XLS-70 credential proving an agent's ability |
| Autonomy Level | L1-L5 scale of agent independence |
| Trust Score | 0-100 composite reputation score |
| Operator | Human/organization responsible for an agent |
| Epoch | Reputation recalculation period (24h or 100 txs) |
| Kill Switch | Emergency agent deactivation mechanism |

### B. Related Standards

- [W3C DID v1.0](https://www.w3.org/TR/did-1.0/)
- [W3C Verifiable Credentials](https://www.w3.org/TR/vc-data-model/)
- [XLS-40 (XRPL DID)](https://github.com/XRPLF/XRPL-Standards/discussions/100)
- [XLS-70 (XRPL Credentials)](https://github.com/XRPLF/XRPL-Standards/discussions/202)
- [ERC-8004 (Trustless Agents)](https://eips.ethereum.org/EIPS/eip-8004)
- [ERC-8183 (Agentic Commerce)](https://eips.ethereum.org/EIPS/eip-8183)
- [x402 Protocol](https://www.x402.org/)
- [Machine Payments Protocol](https://stripe.com/blog/machine-payments-protocol)
- [Agent Payments Protocol (AP2)](https://ap2-protocol.org/)
- [A2A Protocol](https://a2a-protocol.org/)

### C. XRPL Transaction Examples

#### C.1 Create Agent DID
```json
{
  "TransactionType": "DIDSet",
  "Account": "rNewAgentAddress",
  "URI": "697066733A2F2F516D41676572744361726448617368",
  "Data": "584149502F302E31",
  "Fee": "12",
  "Sequence": 1
}
```

#### C.2 Issue Capability Credential
```json
{
  "TransactionType": "CredentialCreate",
  "Account": "rCapabilityAssessor",
  "Subject": "rAgentAddress",
  "CredentialType": "584149503A4361706162696C6974793A5472616E736C6174696F6E",
  "URI": "697066733A2F2F516D4361706162696C697479446574",
  "Fee": "12"
}
```

#### C.3 Agent Accepts Credential
```json
{
  "TransactionType": "CredentialAccept",
  "Account": "rAgentAddress",
  "Issuer": "rCapabilityAssessor",
  "CredentialType": "584149503A4361706162696C6974793A5472616E736C6174696F6E",
  "Fee": "12"
}
```

#### C.4 Create Escrow for Agent Work
```json
{
  "TransactionType": "EscrowCreate",
  "Account": "rClientAgent",
  "Destination": "rWorkerAgent",
  "Amount": "1000000",
  "FinishAfter": 789012345,
  "Condition": "A0258020...",
  "Fee": "12",
  "Memos": [
    {
      "Memo": {
        "MemoType": "584149502F4A6F62",
        "MemoData": "7B226A6F62223A227472616E736C6174696F6E222C22736F75726365223A22656E222C22746172676574223A226A61227D"
      }
    }
  ]
}
```

---

## License

This specification is released under the MIT License.
Contributions welcome at: https://github.com/[TBD]/xaip-protocol

---

*"Every AI deserves a home. XRPL can be that home."*
