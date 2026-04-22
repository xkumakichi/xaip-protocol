# XAIP v0.5 Settlement-Class Demo

Concrete illustration of the **settlement** tool class from the [XAIP v0.5 Release Candidate](../../XAIP-SPEC-v0.5-DRAFT.md): a tool execution that produces an independently verifiable on-chain anchor, bound into the signed receipt.

## What this demo does

1. Generates a throwaway `did:key` Ed25519 keypair for the agent and for the caller.
2. Connects to **XRPL testnet** (`wss://s.altnet.rippletest.net:51233`) and requests a funded wallet from the public faucet — no real funds are involved, no account of yours is touched.
3. Submits a 1-drop self-transfer as the "tool call" and waits for `tesSUCCESS`.
4. Builds an XAIP v0.5 execution receipt with:

   ```jsonc
   {
     "agentDid": "did:key:...",
     "callerDid": "did:key:...",
     "toolName": "settlement-demo/self-transfer",
     "taskHash": "...",
     "resultHash": "...",
     "success": true,
     "latencyMs": 1234,
     "timestamp": "2026-04-22T...",
     "toolMetadata": {
       "xaip": {
         "class": "settlement",
         "settlementLayer": "xrpl-testnet",
         "verifiabilityHint": "anchored",
         "anchorTxHash": "<64-hex tx hash>",
         "anchorLedgerIndex": 12345678
       }
     }
   }
   ```

5. Canonicalizes the receipt with JCS (RFC 8785) and signs it with both keys (v0.5 includes `toolMetadata` in the signed payload — a tool cannot silently re-label its class between call and aggregation).
6. Writes the signed receipt to `out/receipt-<timestamp>.json`.
7. Prints the XRPL testnet explorer URL so anyone can independently verify the anchor transaction exists.

## Run it

```bash
cd demo/settlement-demo
npm install
npx tsx demo.ts
```

No wallet, no funded XRP, no signup needed. The XRPL testnet faucet funds the throwaway wallets automatically. Total runtime: ~5–15 seconds.

A pre-generated example from a real run is committed as [`sample-receipt.json`](./sample-receipt.json). Its anchor is viewable at [testnet.xrpl.org/transactions/63F24BBF...553BC](https://testnet.xrpl.org/transactions/63F24BBF303A8E8510F2C5B91EFEB8F34CCFB4A2BC10750ABD392BE606D553BC).

## Verify independently

The demo prints a URL like:

```
https://testnet.xrpl.org/transactions/ABC123...
```

Open it in any browser. You will see the exact transaction the demo anchored, signed by the throwaway wallet's seed — proof that the `anchorTxHash` in the receipt is not fabricated.

For an aggregator performing probabilistic verification (v0.5 §10.4), the check is the same query against an XRPL node:

```bash
# Using any XRPL JSON-RPC endpoint
curl https://s.altnet.rippletest.net:51234 \
  -H 'Content-Type: application/json' \
  -d '{"method":"tx","params":[{"transaction":"<anchorTxHash>"}]}'
```

If `result.validated == true` and the ledger index matches `anchorLedgerIndex`, the anchor is real.

## What this demo does NOT do

- **It does not post to the live aggregator.** The production aggregator currently implements v0.4 schema, in which `toolMetadata` is not part of the signed payload. Aggregator v0.5 support (class-aware trust weighting, anchor re-verification sampling) is a separate work item tracked in the XAIP-SPEC roadmap.
- **It does not require real XRP.** Testnet only.
- **It does not require an XRPL account.** Throwaway keys per run.

The demo is the concrete shape of the receipt as specified in XAIP v0.5 §10; wiring it into the aggregator comes after the v0.5 schema is merged server-side.

## Why settlement class matters

Most "tool call" receipts only claim what happened — the output hash is whatever the tool says it is. For settlement-class tools (on-chain transfers, escrow releases, asset issuance), the output is public and re-derivable by anyone with network access.

By declaring `class: "settlement"` + `verifiabilityHint: "anchored"` + `anchorTxHash`, the receipt invites third-party verification. This changes the trust model:

- **Advisory / computation tools:** trust derives from aggregate execution statistics.
- **Settlement tools:** trust derives from cryptographic proof that the declared side-effect occurred on the declared ledger.

A tool that claims `class: "settlement"` and emits receipts whose anchor hashes don't verify gets a `settlement_anchor_mismatch` risk flag — a failure mode that only exists because the class was declared, and that no self-reporting tool would surface on its own.

## License

MIT (same as parent repo).
