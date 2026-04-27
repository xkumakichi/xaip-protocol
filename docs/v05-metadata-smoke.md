# v0.5 Metadata Smoke Example

This smoke example shows that an XAIP receipt can carry optional v0.5
`receipt.toolMetadata.xaip` fields inside the signed payload.

It is intentionally small and dry-run by default. It does not change scoring,
does not call `/v1/select`, and does not claim class-aware scoring is live.

## What It Demonstrates

- A receipt can include:
  - `toolMetadata.xaip.class`
  - `toolMetadata.xaip.verifiabilityHint`
  - `toolMetadata.xaip.settlementLayer`
- The receipt payload can be signed with Ed25519.
- The agent signature and caller co-signature can be verified.
- The metadata is display-only in the current public flow.

## Run Dry-Run

```bash
cd demo
npm run v05-metadata-smoke
```

Dry-run mode prints the receipt metadata and verifies the signatures. It does
not post to the live aggregator.

## Optional Posting

Posting is off by default. To submit the receipt to an aggregator:

```bash
cd demo
npm run v05-metadata-smoke -- --post
```

or:

```bash
cd demo
XAIP_POST=1 npm run v05-metadata-smoke
```

You can override the aggregator URL:

```bash
XAIP_AGGREGATOR_URL=https://example.com npm run v05-metadata-smoke -- --post
```

When posting is enabled, the script prints that submitted metadata is
display-only and does not affect current scoring or `/v1/select` behavior.

## Current Boundary

This is not class-aware scoring. The metadata is signed receipt data that can be
displayed by compatible services. It does not change trust scores, risk flags,
selection ranking, or `/v1/select` behavior.

