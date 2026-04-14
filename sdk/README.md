# xaip-sdk

> **Status: Alpha** — This is an experimental protocol. Do not use for production trust decisions without independent verification.
>
> **⚠️ Do NOT use XAIP trust scores for high-stakes decisions (payments, security, production routing).**

Chain-agnostic trust protocol for AI agents.

When agents delegate tasks to other agents, they need to know: **"Can I trust you?"**
XAIP answers that question — without requiring any specific blockchain, platform, or vendor.

## Install

```bash
npm install xaip-sdk
```

## Quick Start

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { withXAIP } from "xaip-sdk";

const server = new McpServer({ name: "my-agent", version: "1.0.0" });

// Register your tools...
server.tool("translate", { text: z.string() }, async ({ text }) => {
  return { content: [{ type: "text", text: translated }] };
});

// Add XAIP trust infrastructure — one line.
await withXAIP(server, { did: "did:web:myagent.example.com" });
```

Every tool execution is now:

- **Signed** with Ed25519 + JCS canonical payload (RFC 8785)
- **Scored** using Bayesian Beta distribution (no magic constants)
- **Queryable** by other agents via `xaip_query`
- **Co-signed** when a caller provides a SigningDelegate

## Trust Model (v0.3.1)

```
trust = bayesianScore x callerDiversity x coSignFactor
```

| Axis | What it measures | Range |
|------|-----------------|-------|
| **Bayesian Score** | Execution success rate with Beta prior | 0-1 |
| **Caller Diversity** | How many independent callers (Sybil defense) | 0-1 |
| **Co-sign Factor** | Percentage of dual-signed receipts | 0.5-1 |

No magic constants. Each axis has a clear statistical meaning.

### Identity Priors

DID methods with higher creation cost start with a stronger Bayesian prior, but **all methods converge** with evidence:

| Method | Prior | Prior Mean | Cost |
|--------|-------|------------|------|
| `did:key` | Beta(1,1) | 0.500 | Free |
| `did:web` | Beta(2,1) | 0.667 | Domain |
| `did:ethr` | Beta(3,1) | 0.750 | Gas |
| `did:xrpl` | Beta(5,1) | 0.833 | XRP reserve |

A `did:key` agent with 200+ diverse callers achieves the same trust as `did:xrpl`.

### Verdict

| Verdict | Condition |
|---------|-----------|
| `yes` | trust >= 0.70 AND >= 10 executions |
| `caution` | trust >= 0.40 AND >= 10 executions |
| `no` | trust < 0.40 AND >= 10 executions |
| `unknown` | fewer than 10 executions (bootstrap period) |

### Query Example

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
    "prior": [2, 1]
  }
}
```

## Co-signatures with SigningDelegate

Callers co-sign receipts without exposing private keys:

```typescript
import { createSigningDelegate, withXAIP } from "xaip-sdk";

// Caller side: key never leaves this process
const signer = createSigningDelegate("did:web:caller.com", myPrivateKey);

await withXAIP(server, {
  did: "did:web:myagent.com",
  callerSigner: signer,
});
```

## Federation

Push receipts to multiple aggregators for resilience. Queries take the **median** trust value across nodes (Byzantine fault tolerant when honest nodes > 50%).

```typescript
await withXAIP(server, {
  did: "did:web:myagent.com",
  aggregatorUrls: [
    "https://agg1.example.com",
    "https://agg2.example.com",
    "https://agg3.example.com",
  ],
});
```

**Recommendation:** Configure at least 3 aggregators, with the majority operated by trusted parties.

## Plugins

| Plugin | Purpose |
|--------|---------|
| `veridict` | Import [Veridict](https://www.npmjs.com/package/veridict) execution history |
| `xrpl` | On-chain DID registration, score anchoring, escrow |
| `otel` | Export receipts as OpenTelemetry spans |

```typescript
import { veridictPlugin } from "xaip-sdk/plugins/veridict";
import { xrplPlugin } from "xaip-sdk/plugins/xrpl";
import { otelPlugin } from "xaip-sdk/otel";

await withXAIP(server, {
  plugins: [veridictPlugin(), xrplPlugin({ wallet }), otelPlugin()],
});
```

## Security Notice

**Trust scores are a risk assessment tool, not a safety guarantee.**

- A high trust score means the agent has a history of successful executions verified by diverse, independent callers. It does **not** guarantee the absence of malicious behavior (e.g., data exfiltration while returning correct results).
- Agents with fewer than 10 executions are in a **bootstrap period** and always return `verdict: "unknown"` regardless of their computed trust value. Do not make critical delegation decisions based on bootstrap-period scores.
- Sybil resistance depends on caller diversity. Collusion rings (multiple DIDs controlled by one entity) can inflate trust scores, though weighted diversity raises the cost.
- Aggregator-based federation assumes honest majority among configured aggregator nodes. An attacker controlling >50% of your aggregator list can manipulate query results.

See [XAIP-SPEC.md](./XAIP-SPEC.md) for the full threat model.

## Specification

Full protocol specification: [XAIP-SPEC.md](./XAIP-SPEC.md)

## Links

- [GitHub](https://github.com/xkumakichi/xaip-protocol)
- [Veridict](https://www.npmjs.com/package/veridict) — MCP execution logging + trust judgment

## License

MIT
