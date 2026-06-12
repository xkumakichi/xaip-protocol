# precheck() API Guide

> This guide describes `precheck()` as shipped in `xaip-sdk@0.5.0` on npm.

## Why This Exists

AI agents increasingly call external tools, skills, services, and other agents. Before an agent delegates work, it often needs more than a name or a local configuration entry. It needs available execution evidence: what is known about prior executions, which candidates have receipts, which ones are unscored, and which ones carry risk flags.

`precheck()` exposes that evidence through `xaip-sdk`. It is a developer-facing helper for asking XAIP what evidence is available before delegation. The result is meant to inform the caller's own policy, UI, or routing logic.

## Boundary

`precheck()` is an evidence lookup step, not an execution control system.

- It is not a sandbox.
- It is not an approval engine.
- It is not a payment rail.
- It does not make tools safe.
- It does not guarantee trust.
- It does not execute the selected candidate.

## What precheck() Wraps

`precheck()` is a thin SDK wrapper over `POST /v1/select`.

The server returns candidate evidence from the public Trust API. The SDK then normalizes the response into a stable shape for application code:

- candidate evidence is returned as `ranked`
- unscored candidates are exposed as `unscored`
- `selected` is recomputed by the SDK from eligibility
- `reason` is one of two controlled strings
- optional `decision` is derived only when requested

The API is not MCP-specific. Candidate IDs are opaque slugs, and the design applies to tool, skill, or agent candidates. Current live examples use slugs such as `context7`, `memory`, and `unknown-server` because those are present in today's public dataset.

## Basic Usage

```typescript
import { precheck } from "xaip-sdk";

const result = await precheck({
  task: "Fetch React hooks documentation",
  candidates: ["context7", "memory", "unknown-server"],
  policy: {
    minReceipts: 10,
    excludeRiskFlags: ["high_error_rate"],
    timeoutMs: 5000,
    mode: "strict",
  },
  includeDecision: true,
});

console.log(result.selected);
console.log(result.reason);
console.log(result.decision);
console.table(result.ranked);
```

Use `selected` as an input to your own delegation logic. If it is `null`, no candidate was eligible under the evidence and policy available to `precheck()`.

## Result Shape

```typescript
type PrecheckResult = {
  selected: string | null;
  ranked: RankedCandidate[];
  unscored: string[];
  reason: string;
  policyApplied: Required<PrecheckPolicy>;
  source: string;
  timestamp: string;
  decision?: "allow" | "warn" | "unknown";
};
```

Each ranked candidate includes:

```typescript
type RankedCandidate = {
  candidate: string;
  score: number | null;
  receiptCount: number;
  confidence: number | null;
  riskFlags: string[];
  verdict: "trusted" | "caution" | "low_trust" | "unscored";
  eligible: boolean;
};
```

Important details:

- `selected` is recomputed by the SDK from `ranked[].eligible`.
- `unscored` candidates are always `eligible: false`.
- `reason` is controlled text, not the server's variable explanation string: `"Selected using available execution evidence."` or `"No eligible candidates based on available execution evidence."`
- `source` and `timestamp` describe the Trust API response used for the lookup.

## Policy Options

```typescript
type PrecheckPolicy = {
  minReceipts?: number;
  excludeRiskFlags?: string[];
  requireCoSignatureRatio?: number;
  timeoutMs?: number;
  mode?: "strict" | "relative";
};
```

| Option | Default | Meaning |
|---|---:|---|
| `minReceipts` | `0` | Minimum receipt count for a scored candidate to remain eligible. |
| `excludeRiskFlags` | `[]` | Any matching risk flag makes that candidate ineligible. |
| `timeoutMs` | `5000` | Request timeout for the Trust API call. |
| `mode` | `"strict"` | Forwarded to `/v1/select`; the SDK still treats unscored candidates as ineligible. |
| `requireCoSignatureRatio` | `0` | Reserved for future use. Values greater than `0` currently throw `XaipInputError`. |

`requireCoSignatureRatio` is not enforceable by the SDK today because `/v1/select` does not expose per-candidate co-signature ratios. Passing a value greater than `0` would imply enforcement that the SDK cannot perform, so `precheck()` rejects it.

## Optional Decision Field

By default, `precheck()` returns evidence and eligibility, but no top-level decision. If you pass `includeDecision: true`, the SDK adds a derived field:

```typescript
const result = await precheck({
  task: "Fetch docs",
  candidates: ["context7", "unknown-server"],
  includeDecision: true,
});

console.log(result.decision); // "allow", "warn", or "unknown"
```

Possible values:

| Value | Meaning |
|---|---|
| `allow` | At least one candidate is eligible. |
| `warn` | Scored candidates exist, but none are eligible under the applied policy. |
| `unknown` | All candidates are unscored. |

There is no `block` value. Blocking, escalation, confirmation, or fallback behavior belongs in the caller's policy layer.

## Errors

`precheck()` throws typed errors so callers can handle input problems, network failures, service failures, and timeouts separately.

| Error | When it occurs |
|---|---|
| `XaipInputError` | Empty `task`, empty or invalid `candidates`, or unsupported policy input such as `requireCoSignatureRatio > 0`. |
| `XaipNetworkError` | The request could not reach the Trust API. |
| `XaipServiceError` | The Trust API returned an HTTP error or a non-JSON success body. |
| `XaipTimeoutError` | The request exceeded `policy.timeoutMs`. |

```typescript
import {
  precheck,
  XaipInputError,
  XaipNetworkError,
  XaipServiceError,
  XaipTimeoutError,
} from "xaip-sdk";

try {
  const result = await precheck({
    task: "Fetch docs",
    candidates: ["context7", "memory"],
  });
  console.log(result.selected);
} catch (err) {
  if (err instanceof XaipInputError) {
    console.error("Invalid precheck input:", err.message);
  } else if (err instanceof XaipTimeoutError) {
    console.error("Precheck timed out:", err.message);
  } else if (err instanceof XaipNetworkError) {
    console.error("Network failure:", err.message);
  } else if (err instanceof XaipServiceError) {
    console.error("Trust API error:", err.status, err.message);
  } else {
    throw err;
  }
}
```

## Live Demo Script

From the SDK workspace:

```bash
cd sdk
npx tsx scripts/precheck-demo.ts
```

The demo calls the live Trust API and prints scored, mixed, all-unscored, and policy-filtered scenarios.

See also: [Before Payment Evidence Demo](./before-payment-demo.html), a seeded static demo using fictional paid-skill candidates.

See also: [precheck() as a tool recipe](./precheck-as-tool.md), docs/example-only patterns for plain TypeScript and LangChain.
