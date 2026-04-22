# xaip-caller

Zero-install CLI for contributing to the [XAIP](https://github.com/xkumakichi/xaip-protocol) trust graph. One command, no signup, no API key.

```bash
npx xaip-caller
```

That's it. The tool:

1. Generates a fresh Ed25519 caller keypair on first run (saved to `~/.xaip/caller-keys.json`)
2. Makes real HTTP calls to a small set of public endpoints
3. Signs an XAIP execution receipt for each call
4. POSTs the receipts to the live XAIP aggregator

Every call is a real HTTP request. Every receipt is a real signature. The aggregator verifies the signatures against your caller DID and adds them to the trust graph.

## Why this exists

XAIP was originally shown on top of MCP (Model Context Protocol), but the receipt format is provider-neutral. This package demonstrates that concretely: **any HTTP tool call can contribute to XAIP's trust graph**, not just MCP tool executions.

It also lowers the onboarding bar. The full contributor path ([`run-a-caller.md`](https://github.com/xkumakichi/xaip-protocol/blob/main/docs/contributor/run-a-caller.md)) requires `git clone` + `npm install` + the MCP SDK. `npx xaip-caller` is one command and no state.

## What gets called

Five real HTTP requests to stable public endpoints:

| Agent (DID) | Tool | Endpoint |
|---|---|---|
| `did:web:api.github.com` | `zen` | `GET /zen` |
| `did:web:httpbin.org` | `uuid` | `GET /uuid` |
| `did:web:httpbin.org` | `headers` | `GET /headers` |
| `did:web:xaip-trust-api.kuma-github.workers.dev` | `health` | `GET /health` |
| `did:web:xaip-trust-api.kuma-github.workers.dev` | `list_servers` | `GET /v1/servers` |

Total: 5 calls, <5 seconds runtime. Nothing is written outside `~/.xaip/caller-keys.json`.

## Your caller key

- Stored at `~/.xaip/caller-keys.json`.
- Regenerate by deleting the file — the aggregator will see your next run as a new independent caller.
- The key never leaves your machine. Only the public half is embedded in receipts you submit.

## Configuration

Environment variables:

| Var | Default | Purpose |
|---|---|---|
| `AGGREGATOR_URL` | `https://xaip-aggregator.kuma-github.workers.dev` | Override for self-hosted aggregators |
| `XAIP_CALLER_KEYS_FILE` | `~/.xaip/caller-keys.json` | Override keys file path (useful for running multiple identities) |

## What your contribution does

It improves `callerDiversity` for the HTTP endpoints the package hits. That is, for any tool server scored in XAIP, a run with your caller DID bumps the diversity metric — one more independent caller reduces any single operator's influence on the trust graph.

It does **not**:

- Give you any votes, tokens, or points (there is no economic layer)
- Affect scores for MCP servers — for those, use the full-path contributor guide
- Collect telemetry about you

## Verify you contributed

After a run, query the aggregator for one of the agents the package targets:

```bash
curl "https://xaip-aggregator.kuma-github.workers.dev/query?agentDid=did:web:api.github.com" \
  | python -m json.tool
```

The `meta.sampleSize` should be ≥1 (+1 per `zen` call you've made), and `meta.callerDiversity` should be moving upward as more independent callers join.

## Source

All source is in [`src/index.ts`](./src/index.ts). Single file, ~300 lines, zero runtime dependencies. No bundler, no telemetry, no network calls outside the ones printed in the summary.

## License

MIT.
