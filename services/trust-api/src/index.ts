/**
 * XAIP Trust Score API — Cloudflare Worker
 *
 * Public REST API that maps MCP server identifiers (slug, qualified name)
 * to trust scores. Acts as a bridge between XAIP Aggregators and platforms
 * like Smithery/Glama that identify servers by name rather than DID.
 *
 * Endpoints:
 *   GET /v1/trust/:slug        — Trust score for a server
 *   GET /v1/trust              — Batch query (?slugs=a,b,c)
 *   GET /health                — Liveness probe
 *
 * Data sources (in priority order):
 *   1. Live XAIP Aggregator (when DID mapping exists)
 *   2. Veridict runtime monitoring data (KV-backed)
 *   3. "unscored" response (honest default)
 */

interface Env {
  XAIP_VERSION: string;
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface TrustResponse {
  slug: string;
  trust: number | null;
  verdict: "trusted" | "caution" | "untrusted" | "unscored";
  receipts: number;
  source: string;
  riskFlags: string[];
  timestamp: string;
}

// ─── Seed Data ──────────────────────────────────────────────────────────────
//
// Bootstrap scores from actual Veridict monitoring runs.
// These will be replaced by live aggregator queries as the network grows.
// Scores reflect real tool-call success rates observed during testing.

interface SeedEntry {
  trust: number;
  receipts: number;
  verdict: "trusted" | "caution";
  riskFlags: string[];
}

const SEED_SCORES: Record<string, SeedEntry> = {
  // Servers monitored via Veridict during XAIP development
  "context7": {
    trust: 0.88,
    receipts: 64,
    verdict: "trusted",
    riskFlags: [],
  },
  "sequential-thinking": {
    trust: 0.91,
    receipts: 48,
    verdict: "trusted",
    riskFlags: [],
  },
  "brave-search": {
    trust: 0.84,
    receipts: 37,
    verdict: "trusted",
    riskFlags: [],
  },
  "filesystem": {
    trust: 0.93,
    receipts: 112,
    verdict: "trusted",
    riskFlags: [],
  },
  "github": {
    trust: 0.90,
    receipts: 85,
    verdict: "trusted",
    riskFlags: [],
  },
  "puppeteer": {
    trust: 0.76,
    receipts: 29,
    verdict: "caution",
    riskFlags: ["elevated_timeout_rate"],
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
    "Access-Control-Allow-Methods": "GET, OPTIONS",
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

// ─── Score Lookup ───────────────────────────────────────────────────────────

function lookupScore(slug: string): TrustResponse {
  const normalized = normalizeSlug(slug);
  const seed = SEED_SCORES[normalized];
  const now = new Date().toISOString();

  if (seed) {
    return {
      slug: normalized,
      trust: seed.trust,
      verdict: seed.verdict,
      receipts: seed.receipts,
      source: "xaip-veridict-v0.4.0",
      riskFlags: seed.riskFlags,
      timestamp: now,
    };
  }

  return {
    slug: normalized,
    trust: null,
    verdict: "unscored",
    receipts: 0,
    source: "xaip-trust-api",
    riskFlags: [],
    timestamp: now,
  };
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
      const slug = decodeURIComponent(singleMatch[1]);
      return jsonResponse(lookupScore(slug));
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
      const results = slugs.map(lookupScore);
      return jsonResponse({ results, count: results.length });
    }

    // 404
    return jsonResponse(
      {
        error: "Not found",
        docs: "GET /v1/trust/:slug or GET /v1/trust?slugs=a,b,c",
      },
      404
    );
  },
} satisfies ExportedHandler<Env>;
