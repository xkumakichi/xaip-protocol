/**
 * AggregatorClient BFT Quorum Tests (v0.4.0)
 *
 * Uses fetch mocking — no HTTP servers needed.
 *
 * Test matrix:
 *   1. 3 honest nodes → quorumSize 3, no quorum_degraded
 *   2. 3 nodes, 1 tampered high → MAD removes outlier, correct trust returned
 *   3. 5 nodes, 2 tampered low → 3-node quorum, correct trust
 *   4. 1 of 3 nodes times out → quorumSize 2, quorum_degraded
 *   5. Repeated divergence → node reputation decays → node auto-excluded
 */

import { AggregatorClient } from "../src/aggregator";
import { QueryResult, AggregatorQueryResponse } from "../src/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeResult(trust: number): QueryResult {
  return {
    verdict: trust >= 0.7 ? "yes" : trust >= 0.4 ? "caution" : "no",
    trust,
    riskFlags: [],
    score: { overall: trust, byCapability: {} },
    meta: {
      sampleSize: 30,
      bayesianScore: trust,
      callerDiversity: 1,
      coSignedRate: 1,
      prior: [1, 1],
      lastUpdated: new Date().toISOString(),
      sources: 1,
    },
  };
}

function makeResponse(url: string, trust: number): AggregatorQueryResponse {
  return {
    result: makeResult(trust),
    source: url,
    timestamp: new Date().toISOString(),
  };
}

/** Build a fetch mock that maps URL prefixes to trust values.
 *  Pass "ERROR" as value to simulate a network failure. */
function mockFetch(nodeMap: Record<string, number | "ERROR">): jest.Mock {
  return jest.fn(async (input: string | { toString(): string }) => {
    const url = typeof input === "string" ? input : input.toString();
    // match by base URL (strip /query?...)
    const base = Object.keys(nodeMap).find((b) => url.startsWith(b));
    if (!base) throw new Error(`Unexpected URL in test: ${url}`);
    const val = nodeMap[base];
    if (val === "ERROR") throw new Error("Network error");
    return {
      ok: true,
      status: 200,
      json: async () => makeResponse(base, val),
    } as unknown as Response;
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AggregatorClient BFT quorum", () => {
  const URLS = ["http://a:1", "http://b:2", "http://c:3"];
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  // ── Test 1 ──────────────────────────────────────────────────────────────────
  it("3 honest nodes → quorumSize 3, no quorum_degraded, no outlierNodes", async () => {
    globalThis.fetch = mockFetch({
      "http://a:1": 0.75,
      "http://b:2": 0.77,
      "http://c:3": 0.74,
    });
    const client = new AggregatorClient(URLS);
    const res = await client.query("did:key:test");

    expect(res.result.meta.quorumSize).toBe(3);
    expect(res.result.riskFlags).not.toContain("quorum_degraded");
    expect(res.outlierNodes).toBeUndefined();
    // Trust should be in the honest range
    expect(res.result.trust).toBeGreaterThan(0.5);
    expect(res.source).toBe("quorum(3/3)");
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────────
  it("3 nodes, 1 tampered high → outlier removed, correct trust returned", async () => {
    // Node C inflates trust from ~0.75 to 0.99
    globalThis.fetch = mockFetch({
      "http://a:1": 0.75,
      "http://b:2": 0.77,
      "http://c:3": 0.99, // tampered
    });
    const client = new AggregatorClient(URLS);
    const res = await client.query("did:key:test");

    // Trust should reflect the honest 2 nodes (~0.75–0.77), not 0.99
    expect(res.result.trust).toBeLessThan(0.9);
    expect(res.result.trust).toBeGreaterThan(0.6);

    // C was the outlier
    expect(res.outlierNodes).toEqual(["http://c:3"]);

    // Only 2 in quorum → degraded
    expect(res.result.meta.quorumSize).toBe(2);
    expect(res.result.riskFlags).toContain("quorum_degraded");
    expect(res.source).toBe("quorum(2/3)");
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────────
  it("5 nodes, 2 tampered low → 3-node quorum, correct trust, no quorum_degraded", async () => {
    const URLS5 = ["http://a:1", "http://b:2", "http://c:3", "http://d:4", "http://e:5"];
    globalThis.fetch = mockFetch({
      "http://a:1": 0.75,
      "http://b:2": 0.77,
      "http://c:3": 0.74,
      "http://d:4": 0.05, // tampered low
      "http://e:5": 0.04, // tampered low
    });
    const client = new AggregatorClient(URLS5);
    const res = await client.query("did:key:test");

    // Trust should reflect honest 3 nodes, not pulled down by the 2 low outliers
    expect(res.result.trust).toBeGreaterThan(0.6);

    // Exactly 2 outliers detected
    expect(res.outlierNodes).toHaveLength(2);
    expect(res.outlierNodes).toContain("http://d:4");
    expect(res.outlierNodes).toContain("http://e:5");

    // 3 in quorum → no degradation
    expect(res.result.meta.quorumSize).toBe(3);
    expect(res.result.riskFlags).not.toContain("quorum_degraded");
    expect(res.source).toBe("quorum(3/5)");
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────────
  it("1 of 3 nodes times out → quorumSize 2, quorum_degraded added", async () => {
    globalThis.fetch = mockFetch({
      "http://a:1": 0.75,
      "http://b:2": 0.77,
      "http://c:3": "ERROR", // node unavailable
    });
    const client = new AggregatorClient(URLS);
    const res = await client.query("did:key:test");

    // Only 2 responses — both agree → no outliers, but quorum_degraded
    expect(res.result.meta.quorumSize).toBe(2);
    expect(res.result.riskFlags).toContain("quorum_degraded");
    expect(res.outlierNodes).toBeUndefined();
    expect(res.result.trust).toBeGreaterThan(0.5);
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────────
  it("repeated divergence from node C → reputation decays → node auto-excluded", async () => {
    // Reputation starts at 1.0 and decays by ×0.9 per divergent response.
    // After 7 divergent calls it drops below 0.5: 1.0 × 0.9^7 ≈ 0.478
    const client = new AggregatorClient(URLS);

    // C consistently returns an outlier value (0.99 vs 0.75/0.77)
    globalThis.fetch = mockFetch({
      "http://a:1": 0.75,
      "http://b:2": 0.77,
      "http://c:3": 0.99,
    });

    for (let i = 0; i < 7; i++) {
      await client.query("did:key:test");
    }

    // C's reputation should now be below 0.5
    expect(client.nodeScore("http://c:3")).toBeLessThan(0.5);

    // Next query: C must NOT be called
    const strictFetch = mockFetch({
      "http://a:1": 0.75,
      "http://b:2": 0.77,
      // http://c:3 intentionally absent — would throw if called
    });
    globalThis.fetch = strictFetch;

    const res = await client.query("did:key:test");

    // Only A and B called
    const calledUrls = strictFetch.mock.calls.map((call: any[]) =>
      typeof call[0] === "string" ? call[0].split("/query")[0] : String(call[0]).split("/query")[0]
    );
    expect(calledUrls.every((u: string) => u !== "http://c:3")).toBe(true);
    expect(res.result.meta.quorumSize).toBe(2);
  });
});
