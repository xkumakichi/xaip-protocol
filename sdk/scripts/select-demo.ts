/**
 * XAIP Decision Engine — /v1/select dogfooding demo
 *
 * Run: cd sdk && npx tsx scripts/select-demo.ts
 *
 * Scenarios:
 *   (a) All trusted   — picks highest trust by receipt count
 *   (b) Mixed         — excludes unscored, picks from trusted only
 *   (c) All unscored  — selected: null with explanation
 */

const API = "https://xaip-trust-api.kuma-github.workers.dev";

interface SelectResult {
  selected: string | null;
  reason: string;
  rejected: Array<{ slug: string; reason: string }>;
  candidates: Array<{ slug: string; trust: number | null; verdict: string; receipts: number }>;
  withoutXAIP: string;
}

async function select(task: string, candidates: string[]): Promise<SelectResult> {
  const res = await fetch(`${API}/v1/select`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task, candidates }),
  });
  return res.json() as Promise<SelectResult>;
}

function printResult(label: string, r: SelectResult): void {
  console.log(`\n${"─".repeat(52)}`);
  console.log(`[${label}]`);
  console.log(`  selected:   ${r.selected ?? "null (no trusted candidates)"}`);
  console.log(`  reason:     ${r.reason}`);
  if (r.rejected.length > 0) {
    console.log(`  rejected:   ${r.rejected.map((x) => `${x.slug} (${x.reason})`).join(", ")}`);
  }
  console.log(`  candidates:`);
  for (const c of r.candidates) {
    const trust = c.trust != null ? c.trust.toString() : "null";
    console.log(`    ${c.verdict.padEnd(9)} ${trust.padEnd(6)} ${c.receipts.toString().padStart(4)} receipts  ${c.slug}`);
  }
  console.log(`  withoutXAIP: ${r.withoutXAIP}`);
}

async function main(): Promise<void> {
  console.log("XAIP Decision Engine — /v1/select demo");
  console.log(`API: ${API}`);

  // (a) All trusted — tied on trust, decided by receipts
  const a = await select(
    "fetch documentation for React hooks",
    ["context7", "sequential-thinking", "filesystem"]
  );
  printResult("a: all trusted", a);

  // (b) Mixed — unscored server included
  const b = await select(
    "search for recent AI safety papers",
    ["brave-search", "context7", "unknown-mcp-server"]
  );
  printResult("b: mixed (trusted + unscored)", b);

  // (c) All unscored — no candidates with data
  const c = await select(
    "run custom data pipeline",
    ["my-custom-server", "internal-tool-v2", "legacy-pipeline"]
  );
  printResult("c: all unscored", c);

  console.log(`\n${"─".repeat(52)}`);
  console.log("Done.");
}

main().catch(console.error);
