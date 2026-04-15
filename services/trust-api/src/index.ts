/**
 * XAIP Trust Score API — Cloudflare Worker
 *
 * Public REST API that maps MCP server identifiers (slug, qualified name)
 * to trust scores. Acts as a bridge between XAIP Aggregators and platforms
 * like Smithery/Glama that identify servers by name rather than DID.
 *
 * Endpoints:
 *   GET  /v1/trust/:slug        — Trust score for a server
 *   GET  /v1/trust              — Batch query (?slugs=a,b,c)
 *   POST /v1/select             — Decision engine: pick best candidate for a task
 *   GET  /health                — Liveness probe
 *
 * Data sources (in priority order):
 *   1. Live XAIP Aggregator BFT quorum (when AGGREGATOR_NODES is set)
 *   2. Veridict runtime monitoring data (LIVE_SCORES)
 *   3. "unscored" response (honest default)
 *
 * Environment variables (optional):
 *   AGGREGATOR_NODES — comma-separated aggregator URLs for BFT federation
 *   AGENT_DIDS       — JSON map of slug→DID, e.g. {"context7":"did:web:context7"}
 */

interface Env {
  XAIP_VERSION: string;
  /** Comma-separated aggregator node URLs. When set, enables live BFT queries. */
  AGGREGATOR_NODES?: string;
  /** JSON object mapping slug→agentDid for aggregator lookups. */
  AGENT_DIDS?: string;
  /** Service binding to xaip-aggregator Worker (same-account direct call). */
  AGGREGATOR_SERVICE?: Fetcher;
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface TrustResponse {
  slug: string;
  trust: number | null;
  /** trusted ≥0.7 | caution 0.4-0.7 | low_trust <0.4 with data | unscored no data */
  verdict: "trusted" | "caution" | "low_trust" | "unscored";
  receipts: number;
  /** Statistical confidence: min(1, receipts/100). null when unscored. */
  confidence: number | null;
  source: string;
  riskFlags: string[];
  timestamp: string;
  computedFrom?: string;
}

// ─── Live Data ──────────────────────────────────────────────────────────────
//
// Computed from 1,234 real tool-call executions via Veridict monitoring.
// Algorithm: Veridict canITrust() — blended success rate (70% recent + 30% all-time).
// Last computed: 2026-04-15.

interface SeedEntry {
  trust: number;
  receipts: number;
  verdict: "trusted" | "caution" | "low_trust";
  riskFlags: string[];
}

const LIVE_SCORES: Record<string, SeedEntry> = {
  "context7": {
    trust: 1,
    receipts: 248,
    verdict: "trusted",
    riskFlags: [],
  },
  "sequential-thinking": {
    trust: 1,
    receipts: 815,
    verdict: "trusted",
    riskFlags: [],
  },
  "filesystem": {
    trust: 0.903,
    receipts: 62,
    verdict: "caution",
    riskFlags: [],
  },
  "memory": {
    trust: 1,
    receipts: 40,
    verdict: "trusted",
    riskFlags: [],
  },
  "playwright": {
    trust: 0.486,
    receipts: 37,
    verdict: "low_trust",
    riskFlags: ["elevated_error_rate"],
  },
  "puppeteer": {
    trust: 0.844,
    receipts: 32,
    verdict: "caution",
    riskFlags: ["elevated_error_rate"],
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function normalizeSlug(input: string): string {
  // Handle qualified names: @owner/name → name, owner/name → name
  const stripped = input.replace(/^@/, "");
  const parts = stripped.split("/");
  return parts[parts.length - 1].toLowerCase().trim();
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "public, max-age=300",
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(),
    },
  });
}

// ─── Aggregator BFT Federation ──────────────────────────────────────────────
//
// When AGGREGATOR_NODES is set, queries live aggregator nodes and applies
// MAD outlier detection to produce a BFT consensus trust score.
// Falls back to LIVE_SCORES on any error.

interface AggregatorQueryResult {
  verdict: "yes" | "caution" | "no" | "unknown";
  trust: number;
  riskFlags: string[];
  meta: { sampleSize: number };
}

interface AggregatorNodeResponse {
  result: AggregatorQueryResult;
  source: string;
}

function aggMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1]! + sorted[mid]!) / 2)
    : sorted[mid]!;
}

function toTrustResponse(
  slug: string,
  res: AggregatorNodeResponse,
  quorumSize: number
): TrustResponse {
  const r = res.result;
  const verdictMap: Record<string, TrustResponse["verdict"]> = {
    yes: "trusted",
    caution: "caution",
    no: r.meta.sampleSize > 0 ? "low_trust" : "unscored",
    unknown: "unscored",
  };
  const verdict = verdictMap[r.verdict] ?? "unscored";
  const confidence = r.meta.sampleSize > 0 ? Math.min(1, r.meta.sampleSize / 100) : null;
  return {
    slug,
    trust: r.trust > 0 ? r.trust : null,
    verdict,
    receipts: r.meta.sampleSize,
    confidence,
    source: `${res.source} (quorum:${quorumSize})`,
    riskFlags: r.riskFlags,
    timestamp: new Date().toISOString(),
    computedFrom: `${r.meta.sampleSize} receipts via XAIP Aggregator BFT (${quorumSize} nodes)`,
  };
}

async function queryAggregator(
  env: Env,
  slug: string
): Promise<TrustResponse | null> {
  if (!env.AGGREGATOR_NODES) return null;

  // Map slug → agent DID
  let agentDid = `did:web:${slug}`;
  if (env.AGENT_DIDS) {
    try {
      const map = JSON.parse(env.AGENT_DIDS) as Record<string, string>;
      if (map[slug]) agentDid = map[slug]!;
    } catch {
      // ignore parse error
    }
  }

  const nodeUrls = env.AGGREGATOR_NODES.split(",").map((u) => u.trim()).filter(Boolean);
  const encoded = encodeURIComponent(agentDid);

  // Query all nodes in parallel (500ms timeout each)
  // Use Service Binding for same-account Workers, external fetch for others
  const results = await Promise.all(
    nodeUrls.map(async (url) => {
      try {
        const queryPath = `/query?agentDid=${encoded}`;
        let r: Response;
        if (env.AGGREGATOR_SERVICE && url.includes("xaip-aggregator")) {
          r = await env.AGGREGATOR_SERVICE.fetch(`https://dummy${queryPath}`);
        } else {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 2000);
          r = await fetch(`${url}${queryPath}`, { signal: controller.signal });
          clearTimeout(timer);
        }
        if (!r.ok) return null;
        return (await r.json()) as AggregatorNodeResponse;
      } catch {
        return null;
      }
    })
  );

  const successful = results.filter((r): r is AggregatorNodeResponse => r !== null);
  if (successful.length === 0) return null;
  if (successful.length === 1) {
    return toTrustResponse(slug, successful[0]!, 1);
  }

  // MAD outlier detection
  const trusts = successful.map((r) => r.result.trust);
  const med = aggMedian(trusts);
  let quorumNodes = successful;

  if (successful.length >= 3) {
    const deviations = trusts.map((t) => Math.abs(t - med));
    const mad = aggMedian(deviations);
    const threshold = Math.max(3 * mad, 0.1);
    quorumNodes = successful.filter((_, i) => Math.abs(trusts[i]! - med) <= threshold);
    if (quorumNodes.length === 0) quorumNodes = successful;
  } else if (successful.length === 2) {
    if (Math.abs(trusts[0]! - trusts[1]!) > 0.1) {
      // Pick node with lower trust (safer)
      quorumNodes = trusts[0]! <= trusts[1]! ? [successful[0]!] : [successful[1]!];
    }
  }

  const quorumTrusts = quorumNodes.map((r) => r.result.trust);
  const quorumMed = aggMedian(quorumTrusts);

  // Representative = node closest to quorum median
  const representative = quorumNodes.reduce((best, n) => {
    return Math.abs(n.result.trust - quorumMed) <
      Math.abs(best.result.trust - quorumMed)
      ? n
      : best;
  }, quorumNodes[0]!);

  return toTrustResponse(slug, representative, quorumNodes.length);
}

// ─── Score Lookup ───────────────────────────────────────────────────────────

function lookupScoreStatic(slug: string): TrustResponse {
  const entry = LIVE_SCORES[slug];
  const now = new Date().toISOString();

  if (entry) {
    return {
      slug,
      trust: entry.trust,
      verdict: entry.verdict,
      receipts: entry.receipts,
      confidence: Math.min(1, entry.receipts / 100),
      source: "xaip-veridict-live",
      riskFlags: entry.riskFlags,
      timestamp: now,
      computedFrom: `${entry.receipts} real tool-call executions via Veridict`,
    };
  }

  return {
    slug,
    trust: null,
    verdict: "unscored",
    receipts: 0,
    confidence: null,
    source: "xaip-trust-api",
    riskFlags: [],
    timestamp: now,
  };
}

async function lookupScore(slug: string, env: Env): Promise<TrustResponse> {
  const normalized = normalizeSlug(slug);
  // Try live aggregator first; fall back to static LIVE_SCORES
  const live = await queryAggregator(env, normalized);
  if (live) return live;
  return lookupScoreStatic(normalized);
}

// ─── Selection Algorithm ─────────────────────────────────────────────────────

interface SelectRequest {
  task: string;
  candidates: string[];
  /** "relative" (default): select best available even below threshold.
   *  "strict": reject all below caution, may return selected:null. */
  mode?: "relative" | "strict";
}

interface SelectResponse {
  selected: string | null;
  reason: string;
  rejected: Array<{ slug: string; reason: string }>;
  candidates: TrustResponse[];
  withoutXAIP: string;
  /** Present when relative mode selects a below-threshold candidate. */
  warning?: string;
  timestamp: string;
}

async function buildSelectResponse(
  task: string,
  rawCandidates: string[],
  env: Env,
  mode: "relative" | "strict" = "relative"
): Promise<SelectResponse> {
  const now = new Date().toISOString();
  const candidates = await Promise.all(rawCandidates.map((s) => lookupScore(s, env)));

  // Strict-eligible: trusted or caution
  const strictEligible = candidates.filter(
    (c) => c.verdict === "trusted" || c.verdict === "caution"
  );

  // Relative-eligible: any candidate with trust data (not unscored)
  const relativeEligible = candidates.filter(
    (c) => c.verdict !== "unscored" && c.trust !== null
  );

  const eligible = mode === "strict" ? strictEligible : (strictEligible.length > 0 ? strictEligible : relativeEligible);

  const rejected: SelectResponse["rejected"] = candidates
    .filter((c) => !eligible.includes(c))
    .map((c) => ({
      slug: c.slug,
      reason:
        c.verdict === "unscored"
          ? "unscored — no execution data"
          : `low trust (${c.trust}) — below threshold`,
    }));

  // Highest trust first; break ties by receipt count
  eligible.sort((a, b) => {
    const diff = (b.trust ?? 0) - (a.trust ?? 0);
    return diff !== 0 ? diff : b.receipts - a.receipts;
  });

  const winner = eligible[0] ?? null;
  const unscoredCount = candidates.filter((c) => c.verdict === "unscored").length;
  const total = candidates.length;

  let withoutXAIP: string;
  if (unscoredCount > 0) {
    const pct = Math.round((unscoredCount / total) * 100);
    withoutXAIP = `Random selection would pick an unscored server ${pct}% of the time — no execution data, no safety guarantee`;
  } else if (rejected.length > 0) {
    withoutXAIP = `Random selection would include ${rejected.length} low-trust server(s) — XAIP ranked them out automatically`;
  } else {
    withoutXAIP = `All candidates are trusted — XAIP confirms safe to delegate to any of them`;
  }

  let reason: string;
  if (!winner) {
    reason = `No candidates with trust data — all ${total} server(s) are unscored`;
  } else if (eligible.length === 1) {
    reason = `Only eligible candidate (trust ${winner.trust}, ${winner.receipts} verified executions)`;
  } else if (eligible[1] && eligible[1].trust === winner.trust) {
    reason = `Tied on trust (${winner.trust}) — selected by receipt count (${winner.receipts} vs ${eligible[1].receipts})`;
  } else {
    reason = `Highest trust (${winner.trust}) from ${winner.receipts} verified executions`;
  }

  // Warning: relative mode had to fall back below caution threshold
  const warning =
    mode !== "strict" && winner && strictEligible.length === 0 && relativeEligible.length > 0
      ? `All candidates below trust threshold — selecting best available (trust ${winner.trust})`
      : undefined;

  return { selected: winner?.slug ?? null, reason, rejected, candidates, withoutXAIP, ...(warning ? { warning } : {}), timestamp: now };
}

// ─── Router ─────────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // GET /health
    if (path === "/health") {
      return jsonResponse({
        status: "ok",
        version: env.XAIP_VERSION,
        protocol: "xaip",
        timestamp: new Date().toISOString(),
      });
    }

    // GET /v1/trust/:slug
    const singleMatch = path.match(/^\/v1\/trust\/([^/]+)$/);
    if (singleMatch && request.method === "GET") {
      const slug = decodeURIComponent(singleMatch[1]!);
      return jsonResponse(await lookupScore(slug, env));
    }

    // GET /v1/trust?slugs=a,b,c (batch)
    if (path === "/v1/trust" && request.method === "GET") {
      const slugsParam = url.searchParams.get("slugs");
      if (!slugsParam) {
        return jsonResponse(
          { error: "Missing required param: slugs (comma-separated)" },
          400
        );
      }
      const slugs = slugsParam.split(",").map((s) => s.trim()).filter(Boolean);
      if (slugs.length > 50) {
        return jsonResponse({ error: "Max 50 slugs per request" }, 400);
      }
      const results = await Promise.all(slugs.map((s) => lookupScore(s, env)));
      return jsonResponse({ results, count: results.length });
    }

    // POST /v1/select
    if (path === "/v1/select" && request.method === "POST") {
      let body: SelectRequest;
      try {
        body = await request.json() as SelectRequest;
      } catch {
        return jsonResponse({ error: "Invalid JSON body" }, 400);
      }
      if (!body.task || !Array.isArray(body.candidates) || body.candidates.length === 0) {
        return jsonResponse(
          { error: "Required: task (string), candidates (non-empty array)" },
          400
        );
      }
      if (body.candidates.length > 20) {
        return jsonResponse({ error: "Max 20 candidates per request" }, 400);
      }
      const mode = body.mode === "strict" ? "strict" : "relative";
      return jsonResponse(await buildSelectResponse(body.task, body.candidates, env, mode));
    }

    // 404
    return jsonResponse(
      {
        error: "Not found",
        docs: "GET /v1/trust/:slug  GET /v1/trust?slugs=a,b,c  POST /v1/select",
      },
      404
    );
  },
} satisfies ExportedHandler<Env>;
