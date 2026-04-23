# Blind vs XAIP Decision Demo

## Purpose

The Blind vs XAIP decision demo compares blind tool selection strategies against XAIP-guided selection using a static trust snapshot.

It is a deterministic replay over fixed candidate sets. It is designed to show how selection changes when an agent has access to historical XAIP trust data.

## Core Claim

> In this fixed candidate set and static trust snapshot, XAIP avoids low-trust or unscored picks more often than blind strategies.

## What It Does

- Loads static JSON fixtures from `demo/fixtures/`.
- Compares `random`, `fixed-order`, and `xaip` strategies.
- Uses seeded random selection for reproducible `random` results.
- Uses fixed candidate sets documented in the scenario fixture.
- Prints per-scenario and summary tables.

## What It Does Not Do

- No live API calls.
- No active tool execution.
- No MCP execution.
- No receipt posting.
- No latency measurement.
- No real-world success-rate claim.
- No production routing guarantee.

## How To Run

```bash
cd demo
npm run blind-vs-xaip
```

## Metrics

- `risky_pick`: selected candidate is `low_trust` or `unscored`.
- `eligible`: selected candidate is `trusted` or `caution`.
- `risky_pick_rate`: `risky_picks / total_scenarios`.
- `eligible_pick_rate`: eligible picks divided by total scenarios.
- `low_trust_picks`: count of selected candidates with verdict `low_trust`.
- `unscored_picks`: count of selected candidates missing from the trust snapshot.

## Strategy Definitions

- `random`: seeded random pick from the same candidate set.
- `fixed-order`: selects the first candidate, modeling an agent that accepts upstream planner order without runtime trust data.
- `xaip`: prefers scored candidates over unscored candidates, chooses the highest trust score, and tie-breaks by receipts, then slug.

## Current Snapshot Output

The current fixture uses the static snapshot in `demo/fixtures/trust-snapshot-2026-04-24.json`.

| Strategy    | Risky pick rate | Eligible pick rate |
|-------------|----------------:|-------------------:|
| Random      |           71.4% |              28.6% |
| Fixed-order |           85.7% |              14.3% |
| XAIP        |           14.3% |              85.7% |

## Limitations

- The current fixture is MCP-heavy because MCP was the first integration target.
- The candidate sets are fixed and documented for reproducibility.
- Trust scores are historical behavior-derived evidence, not guarantees.
- XAIP cannot improve selection when all candidates are unscored.
- Active execution results should be reported separately in future work.

## Future Work

- Live mode.
- Active execution mode.
- Larger candidate sets.
- Cross-framework fixtures.
- Dashboard visualization.
