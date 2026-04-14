/**
 * Compute trust scores from Veridict execution data and output
 * the updated SEED_SCORES for the Trust API.
 *
 * Usage: npx tsx scripts/compute-scores.ts
 */
import initSqlJs from "sql.js";
import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const RECENT_DAYS = 7;
const RECENT_WEIGHT = 0.7;
const ALLTIME_WEIGHT = 0.3;
const MIN_RECENT_FOR_BLEND = 3;

async function main() {
  const SQL = await initSqlJs();
  const buf = readFileSync(join(homedir(), ".veridict", "executions.db"));
  const db = new SQL.Database(new Uint8Array(buf));

  // All-time stats per server
  const allTime = db.exec(`
    SELECT server_name,
           COUNT(*) as total,
           SUM(success) as successes,
           ROUND(AVG(latency_ms)) as avg_latency,
           SUM(CASE WHEN failure_type = 'timeout' THEN 1 ELSE 0 END) as timeouts,
           SUM(CASE WHEN failure_type = 'error' THEN 1 ELSE 0 END) as errors,
           SUM(CASE WHEN failure_type = 'validation' THEN 1 ELSE 0 END) as validations
    FROM executions
    GROUP BY server_name
  `);

  // Recent stats (last 7 days)
  const recent = db.exec(`
    SELECT server_name,
           COUNT(*) as total,
           SUM(success) as successes
    FROM executions
    WHERE timestamp >= datetime('now', '-${RECENT_DAYS} days')
    GROUP BY server_name
  `);

  const recentMap = new Map<string, { total: number; successes: number }>();
  for (const row of recent[0]?.values ?? []) {
    recentMap.set(String(row[0]), { total: Number(row[1]), successes: Number(row[2]) });
  }

  console.log("╔══════════════════════════════════════════════╗");
  console.log("║  XAIP Trust Score Computation                ║");
  console.log("╚══════════════════════════════════════════════╝\n");

  const scores: Record<string, any> = {};

  for (const row of allTime[0]?.values ?? []) {
    const [name, total, successes, avgLatency, timeouts, errors, validations] = row;
    const slug = String(name);
    const n = Number(total);
    const s = Number(successes);
    const allRate = n > 0 ? s / n : 0;

    const r = recentMap.get(slug);
    const recentRate = r && r.total > 0 ? r.successes / r.total : allRate;
    const recentTotal = r?.total ?? 0;

    // Blended score (Veridict algorithm)
    const effectiveRate = recentTotal >= MIN_RECENT_FOR_BLEND
      ? recentRate * RECENT_WEIGHT + allRate * ALLTIME_WEIGHT
      : allRate;

    // Verdict
    let verdict: string;
    if (effectiveRate >= 0.95) verdict = "trusted";
    else if (effectiveRate >= 0.80) verdict = "caution";
    else verdict = "untrusted";

    // Risk flags
    const riskFlags: string[] = [];
    const timeoutRate = Number(timeouts) / n;
    const errorRate = Number(errors) / n;
    if (timeoutRate > 0.05) riskFlags.push("elevated_timeout_rate");
    if (errorRate > 0.1) riskFlags.push("elevated_error_rate");

    scores[slug] = {
      trust: Math.round(effectiveRate * 1000) / 1000,
      receipts: n,
      verdict,
      riskFlags,
      avgLatencyMs: Number(avgLatency),
    };

    console.log(`${slug}:`);
    console.log(`  Score: ${effectiveRate.toFixed(3)} | Verdict: ${verdict}`);
    console.log(`  Executions: ${n} (${s} success, ${n - s} fail)`);
    console.log(`  Recent (7d): ${recentTotal} calls, ${(recentRate * 100).toFixed(1)}% success`);
    console.log(`  Avg Latency: ${avgLatency}ms`);
    if (riskFlags.length) console.log(`  Risk Flags: ${riskFlags.join(", ")}`);
    console.log();
  }

  // Output the TypeScript code for Trust API
  console.log("═══════════════════════════════════════════════");
  console.log("Generated SEED_SCORES for trust-api/src/index.ts:");
  console.log("═══════════════════════════════════════════════\n");

  const now = new Date().toISOString().slice(0, 10);
  console.log(`// Computed from ${allTime[0]?.values.reduce((sum, r) => sum + Number(r[1]), 0)} real tool-call executions (${now})`);
  console.log("const SEED_SCORES: Record<string, SeedEntry> = {");
  for (const [slug, data] of Object.entries(scores)) {
    console.log(`  "${slug}": {`);
    console.log(`    trust: ${data.trust},`);
    console.log(`    receipts: ${data.receipts},`);
    console.log(`    verdict: "${data.verdict}",`);
    console.log(`    riskFlags: ${JSON.stringify(data.riskFlags)},`);
    console.log(`  },`);
  }
  console.log("};");

  db.close();
}

main();
