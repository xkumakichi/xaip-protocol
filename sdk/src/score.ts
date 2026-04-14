/**
 * XAIP Score — Bayesian trust computation (v0.3.1)
 *
 * Three multiplied axes, each 0–1:
 *   trust = bayesian_score × caller_diversity × co_sign_factor
 *
 * No magic constants. No identity floor. No sample_factor.
 * The math handles everything:
 *   - Bayesian prior encodes identity strength (converges with evidence)
 *   - Caller diversity is the Sybil defense (need real independent callers)
 *   - Co-sign factor rewards verified receipts
 */

import { ParsedDID, QueryResult, CapabilityScore, TrustScore, IDENTITY_PRIORS } from "./types";
import { StoredReceipt } from "./store";

const RECENT_DAYS = 7;
const RECENT_WEIGHT = 0.7;
const ALLTIME_WEIGHT = 0.3;
const MIN_RECENT_FOR_BLEND = 3;
const MIN_EXECUTIONS = 5;
const RECENT_MS = RECENT_DAYS * 24 * 60 * 60 * 1000;

/** Round to 3 decimal places. */
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

// ─── Bayesian Beta ───────────────────────────────────

function prior(did: ParsedDID): [number, number] {
  return IDENTITY_PRIORS[did.method] ?? [1, 1];
}

/** Posterior mean of Beta(α₀ + s, β₀ + f). */
function bayesianScore(successes: number, failures: number, p: [number, number]): number {
  const a = p[0] + successes;
  const b = p[1] + failures;
  return a / (a + b);
}

// ─── Caller Diversity ────────────────────────────────

const DIVERSITY_MIN_SAMPLE = 10;

/** Prior mean for a caller's DID method: α/(α+β). */
function callerWeight(callerDid: string): number {
  const m = callerDid.match(/^did:(\w+):/);
  const method = m ? m[1] : "key";
  const p = IDENTITY_PRIORS[method] ?? [1, 1];
  return p[0] / (p[0] + p[1]);
}

/**
 * Weighted caller diversity (Sybil + collusion ring defense).
 *
 * Each unique caller contributes their DID method's prior mean:
 *   did:key  → 0.5   (free to create)
 *   did:web  → 0.667 (domain ownership)
 *   did:ethr → 0.75  (gas cost)
 *   did:xrpl → 0.833 (XRP reserve)
 *
 * diversity = min(1, Σ(callerWeight) / √total)
 *
 * This means 100 did:key Sybil callers are worth less than
 * 12 did:xrpl callers — you need callers with skin in the game.
 *
 * Bootstrap: below DIVERSITY_MIN_SAMPLE, returns 1.0 to avoid
 * penalizing new agents. Bayesian prior already handles uncertainty.
 */
function callerDiversity(receipts: StoredReceipt[]): number {
  if (receipts.length === 0) return 0;
  if (receipts.length < DIVERSITY_MIN_SAMPLE) return 1;

  const callers = new Map<string, number>();
  for (const r of receipts) {
    if (r.callerDid && !callers.has(r.callerDid)) {
      callers.set(r.callerDid, callerWeight(r.callerDid));
    }
  }

  if (callers.size === 0) return 0.1; // no callers known → minimal credit

  const weightedSum = Array.from(callers.values()).reduce((a, b) => a + b, 0);
  return Math.min(1, weightedSum / Math.sqrt(receipts.length));
}

// ─── Co-sign Factor ──────────────────────────────────

function coSignFactor(receipts: StoredReceipt[]): number {
  if (receipts.length === 0) return 0.5;
  const coSigned = receipts.filter((r) => r.callerDid && r.callerSignature).length;
  return 0.5 + 0.5 * (coSigned / receipts.length);
}

// ─── Blended Success Rate (for per-capability display) ─

function blendedRate(receipts: StoredReceipt[]): number {
  if (receipts.length === 0) return 0;
  const now = Date.now();
  const cutoff = now - RECENT_MS;
  const recent = receipts.filter((r) => new Date(r.timestamp).getTime() >= cutoff);
  const alltimeRate = receipts.filter((r) => r.success).length / receipts.length;

  if (recent.length >= MIN_RECENT_FOR_BLEND) {
    const recentRate = recent.filter((r) => r.success).length / recent.length;
    return recentRate * RECENT_WEIGHT + alltimeRate * ALLTIME_WEIGHT;
  }
  return alltimeRate;
}

// ─── Risk Flags ──────────────────────────────────────

function detectRiskFlags(receipts: StoredReceipt[], diversity: number, cosign: number): string[] {
  const flags: string[] = [];
  const n = receipts.length;
  if (n < 30) flags.push("low_sample_size");

  const failures = receipts.filter((r) => !r.success);
  if (n > 0 && failures.length / n > 0.1) flags.push("high_error_rate");

  const timeouts = failures.filter((r) => r.failureType === "timeout");
  if (n > 0 && timeouts.length / n > 0.05) flags.push("high_timeout_rate");

  // Declining performance
  const now = Date.now();
  const cutoff = now - RECENT_MS;
  const recent = receipts.filter((r) => new Date(r.timestamp).getTime() >= cutoff);
  if (recent.length >= MIN_RECENT_FOR_BLEND) {
    const recentRate = recent.filter((r) => r.success).length / recent.length;
    const alltimeRate = receipts.filter((r) => r.success).length / n;
    if (alltimeRate - recentRate > 0.1) flags.push("declining_performance");
  }

  if (diversity < 0.3) flags.push("low_caller_diversity");
  if (cosign < 0.75) flags.push("low_cosign_rate");
  if (cosign === 0.5 && n > 0) flags.push("no_cosignatures");

  return flags;
}

// ─── Main ────────────────────────────────────────────

export function computeQueryResult(
  receipts: StoredReceipt[],
  did: ParsedDID,
  capability?: string
): QueryResult {
  const total = receipts.length;
  const p = prior(did);

  if (total < MIN_EXECUTIONS) {
    return {
      verdict: "unknown",
      trust: 0,
      riskFlags: ["insufficient_data"],
      score: { overall: 0, byCapability: {} },
      meta: {
        sampleSize: total,
        bayesianScore: 0,
        callerDiversity: 0,
        coSignedRate: 0,
        prior: p,
        lastUpdated: total > 0 ? receipts[0].timestamp : new Date().toISOString(),
        sources: total > 0 ? 1 : 0,
      },
    };
  }

  // Per-capability breakdown
  const byTool = new Map<string, StoredReceipt[]>();
  for (const r of receipts) {
    const list = byTool.get(r.toolName) || [];
    list.push(r);
    byTool.set(r.toolName, list);
  }

  const byCapability: Record<string, CapabilityScore> = {};
  let weightedSum = 0;
  let totalWeight = 0;

  for (const [tool, toolReceipts] of byTool) {
    const rate = blendedRate(toolReceipts);
    const now = Date.now();
    const cutoff = now - RECENT_MS;
    const recent = toolReceipts.filter((r) => new Date(r.timestamp).getTime() >= cutoff);
    const recentRate = recent.length > 0
      ? recent.filter((r) => r.success).length / recent.length
      : rate;

    byCapability[tool] = {
      score: round3(rate),
      executions: toolReceipts.length,
      recentSuccessRate: round3(recentRate),
    };
    weightedSum += rate * toolReceipts.length;
    totalWeight += toolReceipts.length;
  }

  const overall = capability && byCapability[capability]
    ? byCapability[capability].score
    : totalWeight > 0 ? weightedSum / totalWeight : 0;

  // Three axes
  const successes = receipts.filter((r) => r.success).length;
  const failures = total - successes;
  const bs = bayesianScore(successes, failures, p);
  const div = callerDiversity(receipts);
  const csf = coSignFactor(receipts);

  const trust = round3(bs * div * csf);

  const riskFlags = detectRiskFlags(receipts, div, csf);

  // Bootstrap guard: diversity grace period (total < 10) means we can't
  // yet assess caller independence. Trust value is computed but verdict
  // is forced to "unknown" to prevent cheap bootstrap gaming.
  let verdict: QueryResult["verdict"];
  if (total < DIVERSITY_MIN_SAMPLE) {
    verdict = "unknown";
    riskFlags.push("bootstrap_period");
  } else if (trust >= 0.7) {
    verdict = "yes";
  } else if (trust >= 0.4) {
    verdict = "caution";
  } else {
    verdict = "no";
  }

  const coSignedCount = receipts.filter((r) => r.callerDid && r.callerSignature).length;

  return {
    verdict,
    trust,
    riskFlags,
    score: { overall: round3(overall), byCapability },
    meta: {
      sampleSize: total,
      bayesianScore: round3(bs),
      callerDiversity: round3(div),
      coSignedRate: round3(coSignedCount / total),
      prior: p,
      lastUpdated: receipts[0]?.timestamp ?? new Date().toISOString(),
      sources: 1,
    },
  };
}
