/**
 * Blind Agent vs XAIP Agent snapshot replay demo.
 *
 * This demo does not fetch live data, execute tools, post receipts, or call MCP.
 * It compares deterministic selection strategies over fixed scenarios using a
 * static XAIP trust snapshot.
 */

import * as fs from "fs";
import * as path from "path";

type Verdict = "trusted" | "caution" | "low_trust" | "unscored";
type StrategyName = "random" | "fixed-order" | "xaip";

interface TrustServer {
  slug: string;
  trust: number;
  verdict: Exclude<Verdict, "unscored">;
  receipts: number;
  riskFlags: string[];
  source?: string;
  timestamp?: string;
}

interface TrustSnapshot {
  snapshotDate: string;
  source: string;
  capturedAt: string;
  note: string;
  servers: TrustServer[];
}

interface Scenario {
  id: string;
  task: string;
  purpose: string;
  candidates: string[];
}

interface ScenarioFile {
  note: string;
  scenarios: Scenario[];
}

interface CandidateScore {
  slug: string;
  trust: number | null;
  verdict: Verdict;
  receipts: number;
  riskFlags: string[];
}

interface Pick {
  strategy: StrategyName;
  scenario: Scenario;
  selected: CandidateScore;
  reason: string;
}

interface Summary {
  total: number;
  risky: number;
  lowTrust: number;
  unscored: number;
  eligible: number;
}

const DEFAULT_SEED = 424242;
const STRATEGIES: StrategyName[] = ["random", "fixed-order", "xaip"];

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function parseSeed(argv: string[]): number {
  const arg = argv.find((a) => a.startsWith("--seed="));
  if (!arg) return DEFAULT_SEED;
  const n = Number(arg.slice("--seed=".length));
  if (!Number.isInteger(n)) {
    throw new Error(`Invalid --seed value: ${arg}`);
  }
  return n;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lookup(slug: string, bySlug: Map<string, TrustServer>): CandidateScore {
  const hit = bySlug.get(slug);
  if (!hit) {
    return { slug, trust: null, verdict: "unscored", receipts: 0, riskFlags: [] };
  }
  return {
    slug,
    trust: hit.trust,
    verdict: hit.verdict,
    receipts: hit.receipts,
    riskFlags: hit.riskFlags,
  };
}

function isRisky(c: CandidateScore): boolean {
  return c.verdict === "low_trust" || c.verdict === "unscored";
}

function isEligible(c: CandidateScore): boolean {
  return c.verdict === "trusted" || c.verdict === "caution";
}

function pickRandom(
  scenario: Scenario,
  bySlug: Map<string, TrustServer>,
  rng: () => number
): Pick {
  const index = Math.floor(rng() * scenario.candidates.length);
  const selected = lookup(scenario.candidates[index], bySlug);
  return {
    strategy: "random",
    scenario,
    selected,
    reason: `seeded random index ${index}`,
  };
}

function pickFixedOrder(scenario: Scenario, bySlug: Map<string, TrustServer>): Pick {
  const selected = lookup(scenario.candidates[0], bySlug);
  return {
    strategy: "fixed-order",
    scenario,
    selected,
    reason: "first candidate in planner order",
  };
}

function pickXAIP(scenario: Scenario, bySlug: Map<string, TrustServer>): Pick {
  const candidates = scenario.candidates.map((slug) => lookup(slug, bySlug));
  const scored = candidates.filter((c) => c.trust !== null);
  const pool = scored.length > 0 ? scored : candidates;
  const selected = [...pool].sort((a, b) => {
    const trustDiff = (b.trust ?? -1) - (a.trust ?? -1);
    if (trustDiff !== 0) return trustDiff;
    const receiptDiff = b.receipts - a.receipts;
    if (receiptDiff !== 0) return receiptDiff;
    return a.slug.localeCompare(b.slug);
  })[0];

  return {
    strategy: "xaip",
    scenario,
    selected,
    reason:
      scored.length > 0
        ? "highest trust, tie-break receipts then slug"
        : "no scored candidates in snapshot",
  };
}

function pad(value: string, width: number): string {
  return value.length > width ? value.slice(0, width - 1) + "." : value.padEnd(width);
}

function pct(n: number, d: number): string {
  return d === 0 ? "0.0%" : `${((n / d) * 100).toFixed(1)}%`;
}

function trustText(c: CandidateScore): string {
  return c.trust === null ? "N/A" : c.trust.toFixed(3);
}

function summarize(picks: Pick[]): Map<StrategyName, Summary> {
  const out = new Map<StrategyName, Summary>();
  for (const strategy of STRATEGIES) {
    out.set(strategy, { total: 0, risky: 0, lowTrust: 0, unscored: 0, eligible: 0 });
  }

  for (const pick of picks) {
    const s = out.get(pick.strategy)!;
    s.total++;
    if (isRisky(pick.selected)) s.risky++;
    if (pick.selected.verdict === "low_trust") s.lowTrust++;
    if (pick.selected.verdict === "unscored") s.unscored++;
    if (isEligible(pick.selected)) s.eligible++;
  }

  return out;
}

function printPickTable(picks: Pick[]): void {
  console.log("\nPer-scenario picks");
  console.log(
    [
      pad("scenario", 20),
      pad("strategy", 12),
      pad("selected", 22),
      pad("verdict", 10),
      pad("trust", 7),
      pad("risky", 6),
      "reason",
    ].join("  ")
  );
  console.log("-".repeat(104));

  for (const pick of picks) {
    console.log(
      [
        pad(pick.scenario.id, 20),
        pad(pick.strategy, 12),
        pad(pick.selected.slug, 22),
        pad(pick.selected.verdict, 10),
        pad(trustText(pick.selected), 7),
        pad(isRisky(pick.selected) ? "yes" : "no", 6),
        pick.reason,
      ].join("  ")
    );
  }
}

function printSummary(summary: Map<StrategyName, Summary>): void {
  console.log("\nSummary by strategy");
  console.log(
    [
      pad("strategy", 12),
      pad("total_scenarios", 15),
      pad("risky_picks", 11),
      pad("risky_pick_rate", 15),
      pad("low_trust_picks", 15),
      pad("unscored_picks", 14),
      pad("eligible_pick_rate", 18),
    ].join("  ")
  );
  console.log("-".repeat(112));

  for (const strategy of STRATEGIES) {
    const s = summary.get(strategy)!;
    console.log(
      [
        pad(strategy, 12),
        pad(String(s.total), 15),
        pad(String(s.risky), 11),
        pad(pct(s.risky, s.total), 15),
        pad(String(s.lowTrust), 15),
        pad(String(s.unscored), 14),
        pad(pct(s.eligible, s.total), 18),
      ].join("  ")
    );
  }
}

function main(): void {
  const seed = parseSeed(process.argv.slice(2));
  const rng = mulberry32(seed);
  const fixtureDir = path.join(__dirname, "fixtures");
  const snapshot = readJson<TrustSnapshot>(
    path.join(fixtureDir, "trust-snapshot-2026-04-24.json")
  );
  const scenarioFile = readJson<ScenarioFile>(
    path.join(fixtureDir, "blind-vs-xaip-scenarios.json")
  );
  const bySlug = new Map(snapshot.servers.map((s) => [s.slug, s]));

  const picks: Pick[] = [];
  for (const scenario of scenarioFile.scenarios) {
    picks.push(pickRandom(scenario, bySlug, rng));
    picks.push(pickFixedOrder(scenario, bySlug));
    picks.push(pickXAIP(scenario, bySlug));
  }

  console.log("Blind Agent vs XAIP Agent - snapshot replay");
  console.log(`Snapshot: ${snapshot.snapshotDate} (${snapshot.capturedAt})`);
  console.log(`Scored servers in snapshot: ${snapshot.servers.length}`);
  console.log(`Scenarios: ${scenarioFile.scenarios.length}`);
  console.log(`Random seed: ${seed}`);
  console.log("");
  console.log(snapshot.note);
  console.log(
    "This is a snapshot replay demo. It measures decision quality against historical trust data, not live execution success."
  );
  console.log(
    "Risky pick = selected candidate has verdict low_trust or is unscored in the snapshot."
  );
  console.log(
    "Claim: In this fixed candidate set and static trust snapshot, XAIP avoids low-trust or unscored picks more often than blind strategies."
  );

  printPickTable(picks);
  printSummary(summarize(picks));
}

main();
