# Caller Diversity Verification

Empirical confirmation that the XAIP aggregator accepts receipts from multiple independent caller identities and that the `callerDiversity` trust metric responds correctly.

## What was verified

- The `XAIP_KEYS_FILE` environment variable (added in commit alongside this doc) lets any operator point `auto-collect.ts` at a distinct caller keypair.
- A second caller identity running against the live aggregator produces new receipts under a new `callerDid`.
- The aggregator's `meta.callerDiversity` metric (exposed via `GET /query?agentDid=...` on the aggregator) moves upward after the second caller contributes, on every tool server exercised.

## Method

1. Existing operator keys file at `~/.xaip/agent-keys.json` was duplicated to a second path. Only the `callers[]` array was cleared — all agent keys were preserved so tool DIDs (`did:web:<slug>`) remain stable.
2. `callerDiversity` snapshot captured for 8 tool servers before the run.
3. Auto-collect executed against the second keys file:
   ```bash
   XAIP_KEYS_FILE='...caller2-keys.json' npx tsx scripts/auto-collect.ts
   ```
   This generated a fresh Ed25519 caller keypair on first read (`did:key:a8af8d3a03224658aa825a0e...`) and posted 40 receipts across 8 servers.
4. `callerDiversity` re-queried after the run.

## Result (2026-04-22)

All eight servers show upward movement after a single additional caller contributed. Absolute deltas are small on servers with large sample sizes (diminishing marginal contribution, as expected); servers with small `n` show larger responsiveness.

| Server | Before | After | Δ | n (before → after) |
|---|---:|---:|---:|---:|
| context7 | 0.354 | 0.374 | +0.020 | 575 → 580 |
| memory | 0.702 | 0.729 | +0.027 | 130 → 136 |
| filesystem | 0.321 | 0.340 | +0.019 | 622 → 626 |
| fetch | 0.722 | 0.763 | +0.041 | 48 → 52 |
| sqlite | 0.645 | 0.677 | +0.032 | 60 → 66 |
| git | 0.707 | 0.742 | +0.035 | 50 → 55 |
| everything | 0.620 | 0.657 | +0.037 | 65 → 70 |
| sequential-thinking | 0.273 | 0.289 | +0.016 | 860 → 865 |

Signature verification passed on all 40 submitted receipts. No aggregator-side rejections.

## What this demonstrates — and what it does not

**Demonstrated:**

- The mechanism is live and correct. A second caller identity is accepted, its signatures verify, and the trust metric downstream responds as specified.
- `callerDiversity` is a real input into scoring, not a label.

**Not yet demonstrated:**

- Independent *operators* (physically separate contributors). Both caller identities in this run originate from the same machine. This confirms the protocol works; it does not confirm external adoption.
- The step from "protocol works for multiple callers" to "the live graph depends on >1 operator" requires external callers to run [`docs/contributor/run-a-caller.md`](./run-a-caller.md).

## How to reproduce

Anyone with Node.js 20+ and a clone of the repo can reproduce the response half of this in under 3 minutes:

```bash
git clone https://github.com/xkumakichi/xaip-protocol.git
cd xaip-protocol/sdk
npm install

# Snapshot BEFORE
curl -s "https://xaip-aggregator.kuma-github.workers.dev/query?agentDid=did:web:memory" \
  | python -c "import json,sys; d=json.load(sys.stdin); print(d['result']['meta'])"

# Contribute (generates a fresh caller key on first run)
XAIP_KEYS_FILE=$HOME/.xaip/my-caller-keys.json npx tsx scripts/auto-collect.ts

# Snapshot AFTER
curl -s "https://xaip-aggregator.kuma-github.workers.dev/query?agentDid=did:web:memory" \
  | python -c "import json,sys; d=json.load(sys.stdin); print(d['result']['meta'])"
```

On servers with small `n`, `callerDiversity` should visibly move.

## References

- Caller guide: [`run-a-caller.md`](./run-a-caller.md)
- Script: [`sdk/scripts/auto-collect.ts`](../../sdk/scripts/auto-collect.ts)
- Trust model: [`XAIP-SPEC.md`](../../XAIP-SPEC.md) §5
