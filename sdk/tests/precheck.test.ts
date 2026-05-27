/**
 * Tests for xaip.precheck() — the developer-facing entry point.
 *
 * Hard rules these tests enforce:
 *   - reason is a fixed controlled string (REASON_SELECTED or REASON_NO_ELIGIBLE).
 *   - selected is recomputed by the SDK after policy filtering; server-side
 *     `selected` is informational and overridden.
 *   - decision is opt-in (`includeDecision: true`) and never returns "block".
 *   - input validation rejects empty task and empty candidates.
 *   - transport / service errors are mapped to typed Xaip* errors.
 */

import {
  precheck,
  REASON_SELECTED,
  REASON_NO_ELIGIBLE,
  XaipInputError,
  XaipNetworkError,
  XaipServiceError,
  XaipTimeoutError,
} from "../src/precheck";

// ─── Mock helpers ────────────────────────────────────

interface MockCandidate {
  slug: string;
  trust?: number | null;
  verdict?: "trusted" | "caution" | "low_trust" | "unscored";
  receipts?: number;
  confidence?: number | null;
  riskFlags?: string[];
}

function buildServerResponse(opts: {
  selected?: string | null;
  reason?: string;
  candidates: MockCandidate[];
  rejected?: Array<{ slug: string; reason: string }>;
}) {
  return {
    selected:
      opts.selected !== undefined
        ? opts.selected
        : opts.candidates[0]?.slug ?? null,
    reason: opts.reason ?? "Server-side reason (should be overridden)",
    rejected: opts.rejected ?? [],
    candidates: opts.candidates.map((c) => ({
      slug: c.slug,
      trust: c.trust !== undefined ? c.trust : 0.95,
      verdict: c.verdict ?? "trusted",
      receipts: c.receipts !== undefined ? c.receipts : 100,
      confidence: c.confidence !== undefined ? c.confidence : 1,
      source: "test-aggregator",
      riskFlags: c.riskFlags ?? [],
      timestamp: "2026-05-27T00:00:00Z",
    })),
    withoutXAIP: "test fixture",
    timestamp: "2026-05-27T00:00:00Z",
  };
}

function mockOk(body: unknown): jest.Mock {
  return jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }));
}

function mockHttp(status: number, body: unknown = {}): jest.Mock {
  return jest.fn(async () => ({
    ok: false,
    status,
    json: async () => body,
    text: async () =>
      typeof body === "string" ? body : JSON.stringify(body),
  }));
}

function mockNetworkFailure(): jest.Mock {
  return jest.fn(async () => {
    throw new TypeError("fetch failed");
  });
}

function mockTimeout(): jest.Mock {
  // Resolves only when its AbortSignal aborts.
  return jest.fn((_url: unknown, opts: { signal?: AbortSignal }) => {
    return new Promise((_resolve, reject) => {
      if (opts.signal) {
        opts.signal.addEventListener("abort", () => {
          const err = new Error("aborted");
          (err as any).name = "AbortError";
          reject(err);
        });
      }
      // never resolves on its own
    });
  });
}

// ─── Fixtures ────────────────────────────────────────

let originalFetch: typeof globalThis.fetch;

function installMock(mock: jest.Mock): void {
  globalThis.fetch = mock as unknown as typeof globalThis.fetch;
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  jest.restoreAllMocks();
});

// ─── 1. Input validation ─────────────────────────────

describe("precheck() — input validation", () => {
  it("throws XaipInputError when task is an empty string", async () => {
    await expect(
      precheck({ task: "", candidates: ["memory"] })
    ).rejects.toBeInstanceOf(XaipInputError);
  });

  it("throws XaipInputError when task is whitespace-only", async () => {
    await expect(
      precheck({ task: "   ", candidates: ["memory"] })
    ).rejects.toBeInstanceOf(XaipInputError);
  });

  it("throws XaipInputError when candidates is empty", async () => {
    await expect(precheck({ task: "x", candidates: [] })).rejects.toBeInstanceOf(
      XaipInputError
    );
  });

  it("throws XaipInputError when a candidate is empty string", async () => {
    await expect(
      precheck({ task: "x", candidates: ["good", ""] })
    ).rejects.toBeInstanceOf(XaipInputError);
  });

  it("throws XaipInputError when a candidate is whitespace-only", async () => {
    await expect(
      precheck({ task: "x", candidates: ["good", "   "] })
    ).rejects.toBeInstanceOf(XaipInputError);
  });

  it("throws XaipInputError when a candidate is not a string", async () => {
    await expect(
      precheck({
        task: "x",
        // Cast through unknown to simulate untyped JS callers.
        candidates: ["good", 123 as unknown as string],
      })
    ).rejects.toBeInstanceOf(XaipInputError);
  });

  it("throws XaipInputError when requireCoSignatureRatio is greater than 0", async () => {
    await expect(
      precheck({
        task: "x",
        candidates: ["memory"],
        policy: { requireCoSignatureRatio: 0.5 },
      })
    ).rejects.toBeInstanceOf(XaipInputError);
  });

  it("accepts requireCoSignatureRatio: 0 (default semantics, no enforcement)", async () => {
    installMock(
      mockOk(buildServerResponse({ candidates: [{ slug: "memory" }] }))
    );
    await expect(
      precheck({
        task: "x",
        candidates: ["memory"],
        policy: { requireCoSignatureRatio: 0 },
      })
    ).resolves.toBeDefined();
  });
});

// ─── 2. Happy path / transformation ──────────────────

describe("precheck() — happy path", () => {
  it("calls POST /v1/select with task and candidates in body", async () => {
    const mockFn = mockOk(
      buildServerResponse({ candidates: [{ slug: "memory" }] })
    );
    installMock(mockFn);

    await precheck({ task: "summarize tickets", candidates: ["memory"] });

    expect(mockFn).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFn.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain("/v1/select");
    expect(opts.method).toBe("POST");
    const headers = opts.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(opts.body as string);
    expect(body.task).toBe("summarize tickets");
    expect(body.candidates).toEqual(["memory"]);
  });

  it("transforms server candidates into RankedCandidate[] with renamed fields", async () => {
    installMock(
      mockOk(
        buildServerResponse({
          candidates: [
            {
              slug: "memory",
              trust: 0.95,
              verdict: "trusted",
              receipts: 200,
              confidence: 1,
              riskFlags: [],
            },
            {
              slug: "playwright",
              trust: 0.65,
              verdict: "caution",
              receipts: 30,
              confidence: 0.3,
              riskFlags: ["high_error_rate"],
            },
          ],
        })
      )
    );

    const result = await precheck({
      task: "x",
      candidates: ["memory", "playwright"],
    });

    expect(result.ranked).toHaveLength(2);
    const byId = Object.fromEntries(
      result.ranked.map((c) => [c.candidate, c])
    );
    expect(byId.memory).toMatchObject({
      candidate: "memory",
      score: 0.95,
      receiptCount: 200,
      confidence: 1,
      verdict: "trusted",
      riskFlags: [],
    });
    expect(byId.playwright.confidence).toBe(0.3);
    expect(byId.playwright.score).toBe(0.65);
  });

  it("derives unscored[] from candidates with verdict 'unscored'", async () => {
    installMock(
      mockOk(
        buildServerResponse({
          candidates: [
            { slug: "memory", verdict: "trusted" },
            {
              slug: "unknown1",
              verdict: "unscored",
              trust: null,
              receipts: 0,
              confidence: null,
            },
            {
              slug: "unknown2",
              verdict: "unscored",
              trust: null,
              receipts: 0,
              confidence: null,
            },
          ],
        })
      )
    );

    const result = await precheck({
      task: "x",
      candidates: ["memory", "unknown1", "unknown2"],
    });

    expect(result.unscored.sort()).toEqual(["unknown1", "unknown2"]);
  });

  it("returns echoed policy with defaults applied", async () => {
    installMock(
      mockOk(buildServerResponse({ candidates: [{ slug: "memory" }] }))
    );

    const result = await precheck({ task: "x", candidates: ["memory"] });

    expect(result.policyApplied).toMatchObject({
      minReceipts: 0,
      excludeRiskFlags: [],
      requireCoSignatureRatio: 0,
      timeoutMs: 5000,
      mode: "strict",
    });
  });

  it("substitutes defaults for explicit undefined policy fields (regression)", async () => {
    // A caller passing `policy: { minReceipts: undefined, excludeRiskFlags: undefined }`
    // must still get default values, not undefined — naive object spread would
    // clobber defaults with undefined and break downstream `.length` checks.
    installMock(
      mockOk(buildServerResponse({ candidates: [{ slug: "memory" }] }))
    );

    const result = await precheck({
      task: "x",
      candidates: ["memory"],
      policy: {
        minReceipts: undefined,
        excludeRiskFlags: undefined,
        timeoutMs: 10_000,
      },
    });

    expect(result.policyApplied.minReceipts).toBe(0);
    expect(result.policyApplied.excludeRiskFlags).toEqual([]);
    expect(result.policyApplied.timeoutMs).toBe(10_000);
    expect(result.ranked[0].eligible).toBe(true);
  });
});

// ─── 3. Policy filtering + SDK-side selected ─────────

describe("precheck() — policy filtering and SDK-side selected recomputation", () => {
  it("marks unscored candidates as eligible: false in strict default mode", async () => {
    installMock(
      mockOk(
        buildServerResponse({
          candidates: [
            {
              slug: "unknown",
              verdict: "unscored",
              trust: null,
              receipts: 0,
              confidence: null,
            },
          ],
        })
      )
    );

    const result = await precheck({ task: "x", candidates: ["unknown"] });

    expect(result.ranked[0].eligible).toBe(false);
  });

  it("marks candidates carrying any excludeRiskFlags as eligible: false", async () => {
    installMock(
      mockOk(
        buildServerResponse({
          candidates: [
            { slug: "good", verdict: "trusted", riskFlags: [] },
            {
              slug: "bad",
              verdict: "trusted",
              riskFlags: ["high_error_rate"],
            },
          ],
        })
      )
    );

    const result = await precheck({
      task: "x",
      candidates: ["good", "bad"],
      policy: { excludeRiskFlags: ["high_error_rate"] },
    });

    const m = Object.fromEntries(
      result.ranked.map((c) => [c.candidate, c.eligible])
    );
    expect(m.good).toBe(true);
    expect(m.bad).toBe(false);
  });

  it("marks candidates below minReceipts as eligible: false", async () => {
    installMock(
      mockOk(
        buildServerResponse({
          candidates: [
            { slug: "low", verdict: "trusted", receipts: 5 },
            { slug: "high", verdict: "trusted", receipts: 200 },
          ],
        })
      )
    );

    const result = await precheck({
      task: "x",
      candidates: ["low", "high"],
      policy: { minReceipts: 10 },
    });

    const m = Object.fromEntries(
      result.ranked.map((c) => [c.candidate, c.eligible])
    );
    expect(m.low).toBe(false);
    expect(m.high).toBe(true);
  });

  it("recomputes selected from SDK policy, ignoring server-side selected", async () => {
    // Server claims "bad" is selected; SDK policy excludes its risk flag.
    installMock(
      mockOk({
        ...buildServerResponse({
          candidates: [
            {
              slug: "bad",
              verdict: "trusted",
              riskFlags: ["high_error_rate"],
              receipts: 500,
            },
            {
              slug: "good",
              verdict: "trusted",
              riskFlags: [],
              receipts: 200,
            },
          ],
        }),
        selected: "bad", // server lie
      })
    );

    const result = await precheck({
      task: "x",
      candidates: ["bad", "good"],
      policy: { excludeRiskFlags: ["high_error_rate"] },
    });

    expect(result.selected).toBe("good");
  });

  it("marks server-rejected slugs as ineligible (server signal honoured)", async () => {
    installMock(
      mockOk(
        buildServerResponse({
          candidates: [
            { slug: "low", verdict: "low_trust", trust: 0.2, receipts: 50 },
            { slug: "ok", verdict: "trusted", trust: 0.95, receipts: 200 },
          ],
          rejected: [{ slug: "low", reason: "low trust below threshold" }],
        })
      )
    );

    const result = await precheck({ task: "x", candidates: ["low", "ok"] });

    const m = Object.fromEntries(
      result.ranked.map((c) => [c.candidate, c.eligible])
    );
    expect(m.low).toBe(false);
    expect(m.ok).toBe(true);
  });

  it("requires both server pass AND SDK policy pass for eligible: true (layered)", async () => {
    // Three candidates: one rejected only by server, one rejected only by SDK
    // policy, one accepted by both. Only the third should be eligible.
    installMock(
      mockOk(
        buildServerResponse({
          candidates: [
            { slug: "server_only", verdict: "trusted", riskFlags: [] },
            {
              slug: "sdk_only",
              verdict: "trusted",
              riskFlags: ["bad_flag"],
            },
            { slug: "both_ok", verdict: "trusted", riskFlags: [] },
          ],
          rejected: [{ slug: "server_only", reason: "server says no" }],
        })
      )
    );

    const result = await precheck({
      task: "x",
      candidates: ["server_only", "sdk_only", "both_ok"],
      policy: { excludeRiskFlags: ["bad_flag"] },
    });

    const m = Object.fromEntries(
      result.ranked.map((c) => [c.candidate, c.eligible])
    );
    expect(m.server_only).toBe(false);
    expect(m.sdk_only).toBe(false);
    expect(m.both_ok).toBe(true);
    expect(result.selected).toBe("both_ok");
  });

  it("returns selected: null when no candidate is eligible", async () => {
    installMock(
      mockOk(
        buildServerResponse({
          candidates: [
            {
              slug: "a",
              verdict: "unscored",
              trust: null,
              receipts: 0,
              confidence: null,
            },
            {
              slug: "b",
              verdict: "unscored",
              trust: null,
              receipts: 0,
              confidence: null,
            },
          ],
        })
      )
    );

    const result = await precheck({ task: "x", candidates: ["a", "b"] });

    expect(result.selected).toBeNull();
  });
});

// ─── 4. Controlled reason text ───────────────────────

describe("precheck() — controlled reason text", () => {
  it("returns REASON_SELECTED when selected !== null", async () => {
    installMock(
      mockOk(
        buildServerResponse({
          candidates: [{ slug: "memory", verdict: "trusted" }],
        })
      )
    );

    const result = await precheck({ task: "x", candidates: ["memory"] });

    expect(result.reason).toBe(REASON_SELECTED);
  });

  it("returns REASON_NO_ELIGIBLE when selected === null", async () => {
    installMock(
      mockOk(
        buildServerResponse({
          candidates: [
            {
              slug: "unknown",
              verdict: "unscored",
              trust: null,
              receipts: 0,
              confidence: null,
            },
          ],
        })
      )
    );

    const result = await precheck({ task: "x", candidates: ["unknown"] });

    expect(result.reason).toBe(REASON_NO_ELIGIBLE);
  });

  it("never echoes the server's variable reason field", async () => {
    installMock(
      mockOk({
        ...buildServerResponse({ candidates: [{ slug: "memory" }] }),
        reason: "Highest trust among scored candidates based on current verified receipts",
      })
    );

    const result = await precheck({ task: "x", candidates: ["memory"] });

    expect(result.reason).not.toContain("Highest trust");
    expect(result.reason).toBe(REASON_SELECTED);
  });
});

// ─── 5. Decision field (opt-in) ──────────────────────

describe("precheck() — decision field (opt-in)", () => {
  it("omits decision by default (includeDecision unspecified)", async () => {
    installMock(
      mockOk(buildServerResponse({ candidates: [{ slug: "memory" }] }))
    );

    const result = await precheck({ task: "x", candidates: ["memory"] });

    expect(result.decision).toBeUndefined();
  });

  it("omits decision when includeDecision: false", async () => {
    installMock(
      mockOk(buildServerResponse({ candidates: [{ slug: "memory" }] }))
    );

    const result = await precheck({
      task: "x",
      candidates: ["memory"],
      includeDecision: false,
    });

    expect(result.decision).toBeUndefined();
  });

  it("returns 'allow' when includeDecision and at least one candidate is eligible", async () => {
    installMock(
      mockOk(
        buildServerResponse({
          candidates: [{ slug: "memory", verdict: "trusted" }],
        })
      )
    );

    const result = await precheck({
      task: "x",
      candidates: ["memory"],
      includeDecision: true,
    });

    expect(result.decision).toBe("allow");
  });

  it("returns 'warn' when scored candidates exist but all are ineligible", async () => {
    installMock(
      mockOk(
        buildServerResponse({
          candidates: [
            {
              slug: "bad",
              verdict: "trusted",
              riskFlags: ["high_error_rate"],
            },
          ],
        })
      )
    );

    const result = await precheck({
      task: "x",
      candidates: ["bad"],
      policy: { excludeRiskFlags: ["high_error_rate"] },
      includeDecision: true,
    });

    expect(result.decision).toBe("warn");
  });

  it("returns 'unknown' when every candidate is unscored", async () => {
    installMock(
      mockOk(
        buildServerResponse({
          candidates: [
            {
              slug: "a",
              verdict: "unscored",
              trust: null,
              receipts: 0,
              confidence: null,
            },
            {
              slug: "b",
              verdict: "unscored",
              trust: null,
              receipts: 0,
              confidence: null,
            },
          ],
        })
      )
    );

    const result = await precheck({
      task: "x",
      candidates: ["a", "b"],
      includeDecision: true,
    });

    expect(result.decision).toBe("unknown");
  });

  it("never returns 'block' as a decision value across representative inputs", async () => {
    const fixtures = [
      buildServerResponse({
        candidates: [{ slug: "x", verdict: "trusted" }],
      }),
      buildServerResponse({
        candidates: [
          {
            slug: "x",
            verdict: "unscored",
            trust: null,
            receipts: 0,
            confidence: null,
          },
        ],
      }),
      buildServerResponse({
        candidates: [
          { slug: "x", verdict: "trusted", riskFlags: ["high_error_rate"] },
        ],
      }),
    ];
    for (const body of fixtures) {
      installMock(mockOk(body));
      const result = await precheck({
        task: "t",
        candidates: ["x"],
        policy: { excludeRiskFlags: ["high_error_rate"] },
        includeDecision: true,
      });
      expect(result.decision).not.toBe("block");
    }
  });
});

// ─── 6. Error handling ───────────────────────────────

describe("precheck() — error handling", () => {
  it("throws XaipServiceError on HTTP 500", async () => {
    installMock(mockHttp(500, { error: "internal" }));

    await expect(
      precheck({ task: "x", candidates: ["memory"] })
    ).rejects.toBeInstanceOf(XaipServiceError);
  });

  it("throws XaipServiceError on HTTP 400", async () => {
    installMock(mockHttp(400, { error: "bad request" }));

    await expect(
      precheck({ task: "x", candidates: ["memory"] })
    ).rejects.toBeInstanceOf(XaipServiceError);
  });

  it("throws XaipNetworkError on fetch rejection", async () => {
    installMock(mockNetworkFailure());

    await expect(
      precheck({ task: "x", candidates: ["memory"] })
    ).rejects.toBeInstanceOf(XaipNetworkError);
  });

  it("throws XaipTimeoutError when policy.timeoutMs is exceeded", async () => {
    installMock(mockTimeout());

    await expect(
      precheck({
        task: "x",
        candidates: ["memory"],
        policy: { timeoutMs: 50 },
      })
    ).rejects.toBeInstanceOf(XaipTimeoutError);
  });
});
