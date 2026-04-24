# Run xaip-caller

`xaip-caller` lets independent callers contribute signed XAIP receipts without running MCP.

It runs a small set of HTTP endpoint checks, signs behavior-derived receipts, and posts those receipts to the XAIP aggregator.

## Install And Run

```bash
npx xaip-caller
```

On Windows PowerShell, `npx.ps1` may be blocked by the local execution policy. Use the `.cmd` shim instead:

```powershell
npx.cmd xaip-caller
```

## What It Does

- Generates or reuses a caller key.
- Derives a caller DID from that key.
- Calls a small set of HTTP endpoints.
- Signs receipts for those calls.
- Posts receipts to the XAIP aggregator.

## What Success Looks Like

A run prints the aggregator URL, caller DID, key file path, per-endpoint results, and a summary.

Example:

```text
Aggregator: https://xaip-aggregator.kuma-github.workers.dev
Caller DID: did:key:...
Keys file:  C:\Users\<user>\.xaip\caller-keys.json

Summary: 4 receipts posted, 1 failed
```

Partial failure can happen. It does not necessarily mean the whole run failed. For example, an endpoint check may succeed, while the receipt submission for that check fails.

Example successful receipt posts:

```text
httpbin.org                                      uuid           ok     receipt posted
httpbin.org                                      headers        ok     receipt posted
xaip-trust-api.kuma-github.workers.dev           health         ok     receipt posted
xaip-trust-api.kuma-github.workers.dev           list_servers   ok     receipt posted
```

Example partial failure:

```text
api.github.com                                   zen            ok     post failed: 500
```

## Key Storage

On Windows, caller keys are stored under the user's XAIP directory. Example:

```text
C:\Users\<user>\.xaip\caller-keys.json
```

Do not commit this file.

## Troubleshooting

If PowerShell blocks `npx` with an `npx.ps1` execution policy error, run:

```powershell
npx.cmd xaip-caller
```

If a line reports `post failed: 500`, endpoint execution may have succeeded but receipt submission failed. Retry later, or open an issue with the relevant log output.

## Provider-Neutral Note

These receipts come from HTTP endpoint checks, not MCP execution. This demonstrates that XAIP receipts are not MCP-only; MCP is one receipt source, not the protocol boundary.

## Safety

- Do not paste private keys into issues, chats, or logs.
- Do not commit `caller-keys.json`.
- Avoid sending secrets in endpoint payloads.
