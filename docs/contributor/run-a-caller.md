# Run a Caller

*Become an independent caller in the XAIP trust graph. Takes ~5 minutes, costs $0, requires no signup.*

---

## Why this matters

XAIP's trust score weights `callerDiversity` as a first-class signal: a tool used only by one operator cannot earn full trust, because one operator cannot detect silent failures that others would hit.

Today the live trust graph is populated mostly by one CI operator. **One external caller — you — meaningfully improves the diversity factor for every tool server you exercise.** The more independent callers, the less any single operator can bias the graph.

You don't need to publish anything, run a server, or interact with a registry. You run a local script, it signs receipts with your own keypair, and they go into the aggregator.

## What you actually do

1. Clone the repo.
2. Generate a caller keypair (the script does this for you the first time).
3. Run the auto-collect script. It connects to public MCP servers, calls a handful of their tools, signs receipts with your key, and POSTs them to the aggregator.
4. Check the dashboard: the tools you called now have one more independent caller on their trust score.

There is no approval process, no gate, no API key. The aggregator verifies signatures and accepts valid receipts from anyone.

## Prerequisites

- Node.js 20+
- Git
- A network connection (you'll hit several public MCP servers via `npx`)

No accounts, no DID registry, no XRPL wallet.

## Quickstart

```bash
git clone https://github.com/xkumakichi/xaip-protocol.git
cd xaip-protocol/sdk
npm install
npx tsx scripts/auto-collect.ts
```

That's it. The script will:

- Generate a fresh caller keypair on first run, save it to `~/.xaip/agent-keys.json`
- Connect to ~8 public MCP servers (context7, memory, filesystem, sqlite, git, etc.)
- Run a small set of tool calls per server
- POST signed receipts to `https://xaip-aggregator.kuma-github.workers.dev`
- Print updated trust scores at the end

Typical output (abridged):

```
Caller DID: did:key:a1b2c3d4e5f6...

── context7 ──────────────────────────
Agent DID: did:web:context7
  .....
  Done: 5 calls, 5 success, 0 fail | 5 receipts posted, 0 failed
...
Summary
Server                 Calls  Succ  Fail  Posted
context7                   5     5     0       5  (100%)
memory                     6     6     0       6  (100%)
...

Updated trust scores:
  context7               GOOD     trust=0.932 n=312 ████████████████████
  memory                 GOOD     trust=0.814 n=198 ████████████████
```

The `n=` count includes your fresh contribution.

## Verifying you contributed

After a run, query the Trust API directly:

```bash
curl https://xaip-trust-api.kuma-github.workers.dev/v1/trust/context7
```

The `receipts` count should have increased by however many calls you made against that server. Your caller DID is one of the entries in the aggregator's caller diversity set — though the public API only exposes aggregated counts (by design: per-caller activity is not publicly enumerable).

## Your caller key

Your private key lives at `~/.xaip/agent-keys.json`. **Keep it local.** If you lose it, you can just generate a new one — you don't lose any value, because the trust graph tracks aggregate diversity across caller DIDs, not individual caller reputations.

If you want a long-lived caller identity:

- Keep `~/.xaip/agent-keys.json` safe; subsequent runs reuse it, so your DID stays stable and your contributions accumulate under one identity.
- Delete the file and re-run if you want a fresh identity (aggregator will see this as a new independent caller).

If you just want to contribute once and forget about it, do nothing — fresh keys are created per-machine anyway.

## Running your own tool mix

The default script exercises public servers hand-picked for coverage. If you want to call a different MCP server — your own, a colleague's, one you want to add to the trust graph — the lowest-level primitive is:

```typescript
import { signReceipt, postReceipt } from "xaip-sdk";

// After your tool call runs:
await postReceipt({
  aggregator: "https://xaip-aggregator.kuma-github.workers.dev",
  receipt: signReceipt({
    agentDid: "did:web:my-custom-server",
    callerDid: yourCallerDid,
    toolName: "my_tool",
    taskHash: "...",
    resultHash: "...",
    success: true,
    latencyMs: 420,
    timestamp: new Date().toISOString(),
  }, agentPrivateKey, callerPrivateKey),
});
```

See [`sdk/scripts/auto-collect.ts`](../../sdk/scripts/auto-collect.ts) for the reference implementation, and [`XAIP-SPEC.md`](../../XAIP-SPEC.md) §2 for the full receipt schema.

## What your contribution does NOT do

To set expectations:

- **It does not give you a vote** in aggregator governance. Trust scoring is deterministic from receipts; there is no voting layer.
- **It does not award you tokens, credits, or points.** There is no economic layer.
- **It does not make your tool calls any safer.** The benefit goes to the trust graph, which everyone then benefits from. You're helping detect silent failures across tools, not protecting your own runtime.

If any of those were a reason you're considering this — they aren't here. The reason to contribute is: you want a less centralized trust layer for AI agents, and one more independent caller is one step that direction.

## Privacy and security

- Receipts contain `taskHash` and `resultHash` (SHA-256 truncated to 16 hex chars), not the raw tool inputs/outputs. The aggregator cannot reconstruct what you searched for or read.
- Your caller DID is a public key hash. It is linkable across your own runs (by design — that's how caller diversity accumulates), but it does not link to your identity unless you publish the binding yourself.
- All network traffic is HTTPS.
- The script does not phone home, exfiltrate file contents, or read anything outside the tool calls it explicitly makes.

If you want to audit: the script is ~900 lines of TypeScript, no bundler, no obfuscation, and every network call is a `fetch()` you can grep for.

## Troubleshooting

**`npx` hangs on first server.** Some public MCP servers are slow to cold-start via npx. The script has a 15s connect timeout; servers that time out are skipped and the run continues. This is expected behavior, not a bug.

**`Aggregator not reachable`.** Check https://xaip-aggregator.kuma-github.workers.dev/health manually. If it's down, retry later — it's a Cloudflare Worker and uptime is ~99.9%.

**`Receipt POST failures`.** If some receipts fail to post but others succeed, likely cause is a validation mismatch (e.g., payload canonicalization bug on a tool returning unusual data). The script continues past failures. File an issue if it's consistent for a particular server.

## Questions

Open an issue at https://github.com/xkumakichi/xaip-protocol/issues. Text-first, async.
