# XAIP Aggregator — Operator Deploy Guide

Independent trust aggregator node for the XAIP Protocol.
Stores signed execution receipts in Cloudflare D1, computes Bayesian trust scores,
and signs responses with its own Ed25519 key.

## Architecture

```
AI Agent (SDK) ──POST /receipts──► Aggregator Node (Cloudflare Worker + D1)
                                         │
Trust API ──GET /query?agentDid=──────────┘
(or SDK AggregatorClient)
```

Multiple nodes form a BFT federation: the SDK and Trust API apply MAD outlier
detection across responses, tolerating up to ⌊(n−1)/2⌋ Byzantine nodes.

## Deploy

### 1. Install dependencies

```bash
cd services/aggregator
npm install
```

### 2. Create D1 database

```bash
npx wrangler d1 create xaip-receipts
```

Copy the `database_id` from the output, then edit `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "xaip-receipts"
database_id = "<paste your ID here>"
```

### 3. Run migrations

```bash
npx wrangler d1 migrations apply xaip-receipts
```

### 4. Deploy

```bash
npx wrangler deploy
```

The worker URL will be printed: `https://xaip-aggregator.<your-subdomain>.workers.dev`

### 5. Verify

```bash
curl https://xaip-aggregator.<subdomain>.workers.dev/health
```

Expected response:
```json
{ "status": "ok", "nodeId": "xaip-aggregator-1", "receipts": 0, ... }
```

## Seed with Veridict data

After deploying, seed receipts from your local Veridict history:

```bash
cd sdk
AGGREGATOR_URL=https://xaip-aggregator.<subdomain>.workers.dev \
  npx tsx scripts/seed-aggregator.ts
```

This reads `~/.veridict/executions.db`, synthesizes 7 independent caller identities,
co-signs every receipt, and POSTs them to the aggregator.
Agent keys are saved to `~/.xaip/agent-keys.json` for reuse.

## Query a trust score

```bash
# Single agent
curl "https://xaip-aggregator.<subdomain>.workers.dev/query?agentDid=did:web:context7"

# With capability filter
curl "https://xaip-aggregator.<subdomain>.workers.dev/query?agentDid=did:web:context7&capability=get-library-docs"
```

## Running multiple nodes (BFT federation)

Deploy this worker to multiple Cloudflare accounts (or regions):

```bash
# Node 2: change NODE_ID in wrangler.toml, then:
npx wrangler deploy --name xaip-aggregator-2
```

Then configure the SDK:
```typescript
const client = new AggregatorClient([
  "https://xaip-aggregator-1.your-subdomain.workers.dev",
  "https://xaip-aggregator-2.your-subdomain.workers.dev",
  "https://xaip-aggregator-3.other-operator.workers.dev",
]);
```

Or configure the Trust API via environment variables:
```bash
npx wrangler secret put AGGREGATOR_NODES
# Enter: https://node1...,https://node2...,https://node3...
```

With 3 nodes: tolerates 1 Byzantine. With 5 nodes: tolerates 2 Byzantine.

## API Reference

### POST /receipts

Submit a signed execution receipt.

```json
{
  "receipt": {
    "agentDid": "did:web:context7",
    "toolName": "get-library-docs",
    "taskHash": "abc123",
    "resultHash": "def456",
    "success": true,
    "latencyMs": 120,
    "timestamp": "2026-04-14T10:00:00.000Z",
    "signature": "<agent Ed25519 sig hex>",
    "callerDid": "did:key:<hex>",
    "callerSignature": "<caller Ed25519 sig hex>"
  },
  "publicKey": "<agent SPKI hex>",
  "callerPublicKey": "<caller SPKI hex>"
}
```

Rate limit: 1000 receipts per agent DID per hour.

### GET /query?agentDid=&capability=

Returns trust score for an agent.

```json
{
  "result": {
    "verdict": "yes",
    "trust": 0.87,
    "riskFlags": [],
    "score": { "overall": 0.92, "byCapability": { ... } },
    "meta": { "sampleSize": 248, "bayesianScore": 0.97, ... }
  },
  "source": "xaip-aggregator-1",
  "timestamp": "2026-04-14T10:00:00.000Z",
  "signature": "<node Ed25519 sig hex>",
  "publicKey": "<node SPKI hex>"
}
```

### GET /health

```json
{ "status": "ok", "nodeId": "xaip-aggregator-1", "receipts": 1234, "version": "0.4.0" }
```

## Trust Model

**trust = bayesian_score × caller_diversity × co_sign_factor**

- **Bayesian Beta**: posterior mean with DID-method priors (did:xrpl strongest)
- **Caller diversity**: weighted unique callers / √n (Sybil defense)
- **Co-sign factor**: 0.5 + 0.5 × (co-signed / total)

Verdicts: `yes` (≥0.7), `caution` (≥0.4), `no` (<0.4), `unknown` (<10 receipts)

## Environment Variables

| Variable          | Default               | Description                              |
|-------------------|-----------------------|------------------------------------------|
| `NODE_ID`         | `xaip-aggregator-1`   | Human-readable node identifier           |
| `XAIP_VERSION`    | `0.4.0`               | Protocol version in health responses     |
| `DB`              | *(D1 binding)*        | D1 database binding (required)           |
