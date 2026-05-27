/**
 * xaip.precheck() — live end-to-end demo script.
 *
 * Run from the sdk/ directory:
 *   npx tsx scripts/precheck-demo.ts
 *
 * What this exercises:
 *   - The default endpoint (kuma-github.workers.dev) is reachable.
 *   - precheck() input validation, transformation, and SDK-side selection
 *     work against a real /v1/select response.
 *   - The reason field is one of the two controlled strings.
 *   - includeDecision: true returns one of allow / warn / unknown.
 *
 * No npm publish, no network mutation, no payment. Pure read-side.
 */

import { precheck, type PrecheckResult } from "../src/precheck";

function formatResult(label: string, result: PrecheckResult): void {
  console.log(`\n── ${label} ──`);
  console.log(`  selected:    ${JSON.stringify(result.selected)}`);
  console.log(`  reason:      "${result.reason}"`);
  if (result.decision !== undefined) {
    console.log(`  decision:    ${result.decision}`);
  }
  console.log(`  unscored:    ${JSON.stringify(result.unscored)}`);
  console.log(`  source:      ${result.source}`);
  console.log(`  timestamp:   ${result.timestamp}`);
  console.log(`  ranked:`);
  for (const c of result.ranked) {
    const tag = c.eligible ? "✓" : "·";
    const score = c.score === null ? "  null" : c.score.toFixed(3);
    const confidence = c.confidence === null ? " n/a" : c.confidence.toFixed(2);
    const flags = c.riskFlags.length > 0 ? ` [${c.riskFlags.join(",")}]` : "";
    console.log(
      `    ${tag} ${c.candidate.padEnd(22)} score=${score}  receipts=${String(c.receiptCount).padStart(4)}  conf=${confidence}  verdict=${c.verdict}${flags}`
    );
  }
}

async function runScenario(
  label: string,
  task: string,
  candidates: string[],
  options: {
    includeDecision?: boolean;
    minReceipts?: number;
    excludeRiskFlags?: string[];
  } = {}
): Promise<void> {
  try {
    const result = await precheck({
      task,
      candidates,
      includeDecision: options.includeDecision,
      policy: {
        minReceipts: options.minReceipts,
        excludeRiskFlags: options.excludeRiskFlags,
        timeoutMs: 10_000,
      },
    });
    formatResult(label, result);
  } catch (err) {
    const e = err as Error;
    console.log(`\n── ${label} ──`);
    console.log(`  ERROR (${e.name}): ${e.message}`);
  }
}

async function main(): Promise<void> {
  console.log("xaip.precheck() — live end-to-end demo");
  console.log("endpoint: https://xaip-trust-api.kuma-github.workers.dev");

  // (a) Three real scored servers, default policy.
  await runScenario(
    "(a) three scored servers, default policy",
    "fetch documentation for React hooks",
    ["context7", "sequential-thinking", "memory"]
  );

  // (b) Mix of real and unknown — exercises the unscored branch.
  await runScenario(
    "(b) scored + unknown (unscored branch)",
    "fetch documentation",
    ["context7", "memory", "definitely-not-a-real-server-xyz"]
  );

  // (c) All unknown — cold-start: selected should be null, reason = NO_ELIGIBLE.
  await runScenario(
    "(c) all unknown (cold start, no eligible)",
    "do something",
    ["unknown-a", "unknown-b", "unknown-c"]
  );

  // (d) includeDecision: true with a normal case.
  await runScenario(
    "(d) includeDecision=true, normal case",
    "x",
    ["context7", "memory"],
    { includeDecision: true }
  );

  // (e) includeDecision: true with all-unscored cold start.
  await runScenario(
    "(e) includeDecision=true, all-unscored",
    "x",
    ["unknown-a", "unknown-b"],
    { includeDecision: true }
  );

  // (f) Policy: minReceipts above what most scored servers have, to force ineligibility.
  await runScenario(
    "(f) minReceipts=10000 (almost certainly excludes everyone)",
    "x",
    ["context7", "memory"],
    { minReceipts: 10_000, includeDecision: true }
  );

  console.log("");
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
