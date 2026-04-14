import { computeQueryResult } from "../src/score";
import { ParsedDID, IDENTITY_PRIORS } from "../src/types";
import { StoredReceipt } from "../src/store";

const webDID: ParsedDID = { method: "web", id: "did:web:test" };
const xrplDID: ParsedDID = { method: "xrpl", id: "did:xrpl:rTest" };
const keyDID: ParsedDID = { method: "key", id: "did:key:abc" };

/**
 * Generate mock receipts.
 * callerMethod controls the DID method of generated callers (default: "web").
 */
function makeReceipts(
  count: number,
  opts: Partial<StoredReceipt> & { variedCallers?: boolean; callerMethod?: string } = {}
): StoredReceipt[] {
  const callerMethod = opts.callerMethod ?? "web";
  return Array.from({ length: count }, (_, i) => ({
    toolName: opts.toolName ?? "translate",
    success: opts.success ?? true,
    latencyMs: opts.latencyMs ?? 100,
    failureType: opts.failureType ?? null,
    timestamp:
      opts.timestamp ??
      new Date(Date.now() - i * 60_000).toISOString(),
    callerDid: opts.variedCallers
      ? `did:${callerMethod}:caller-${i}`
      : (opts.callerDid ?? null),
    callerSignature: opts.variedCallers
      ? `sig-${i}`
      : (opts.callerSignature ?? null),
  }));
}

// ─── Unknown verdict ────────────────────────────────

describe("unknown verdict", () => {
  it("returns unknown when < 5 executions", () => {
    const r = computeQueryResult(makeReceipts(4), webDID);
    expect(r.verdict).toBe("unknown");
    expect(r.trust).toBe(0);
    expect(r.riskFlags).toContain("insufficient_data");
  });

  it("returns unknown for empty receipts", () => {
    const r = computeQueryResult([], webDID);
    expect(r.verdict).toBe("unknown");
    expect(r.trust).toBe(0);
  });
});

// ─── Bayesian Score ─────────────────────────────────

describe("bayesian score", () => {
  it("prior for did:key is [1,1] (uniform)", () => {
    expect(IDENTITY_PRIORS["key"]).toEqual([1, 1]);
  });

  it("prior for did:xrpl is [5,1] (strong positive)", () => {
    expect(IDENTITY_PRIORS["xrpl"]).toEqual([5, 1]);
  });

  it("meta.bayesianScore reflects Beta posterior mean", () => {
    // 10 successes, 0 failures, prior [1,1]
    // Expected: (1+10)/(1+1+10) = 11/12 ≈ 0.917
    const r = computeQueryResult(
      makeReceipts(10, { variedCallers: true }),
      keyDID
    );
    expect(r.meta.bayesianScore).toBeCloseTo(11 / 12, 2);
  });

  it("xrpl prior gives initial advantage that shrinks with data", () => {
    const small = makeReceipts(10, { variedCallers: true });
    const rKey = computeQueryResult(small, keyDID);
    const rXrpl = computeQueryResult(small, xrplDID);
    // With 10 receipts, xrpl's stronger prior [5,1] helps
    expect(rXrpl.meta.bayesianScore).toBeGreaterThan(rKey.meta.bayesianScore);

    // With 1000 receipts, the difference vanishes
    const large = makeReceipts(1000, { variedCallers: true });
    const rKeyLarge = computeQueryResult(large, keyDID);
    const rXrplLarge = computeQueryResult(large, xrplDID);
    expect(
      Math.abs(rXrplLarge.meta.bayesianScore - rKeyLarge.meta.bayesianScore)
    ).toBeLessThan(0.01);
  });

  it("failures pull bayesian score down", () => {
    const allGood = makeReceipts(20, { variedCallers: true });
    const mixed = [
      ...makeReceipts(15, { variedCallers: true }),
      ...makeReceipts(5, { success: false, variedCallers: true }),
    ];
    const rGood = computeQueryResult(allGood, webDID);
    const rMixed = computeQueryResult(mixed, webDID);
    expect(rGood.meta.bayesianScore).toBeGreaterThan(rMixed.meta.bayesianScore);
  });
});

// ─── Weighted Caller Diversity (Sybil + collusion defense) ───

describe("weighted caller diversity", () => {
  it("bootstrap: diversity = 1.0 when total < 10", () => {
    const r = computeQueryResult(makeReceipts(7, { variedCallers: true }), webDID);
    expect(r.meta.callerDiversity).toBe(1);
  });

  it("bootstrap period forces verdict unknown even with high trust", () => {
    // 7 all-success co-signed receipts → high trust value but verdict stays unknown
    const r = computeQueryResult(makeReceipts(7, { variedCallers: true }), xrplDID);
    expect(r.trust).toBeGreaterThan(0.7);
    expect(r.verdict).toBe("unknown");
    expect(r.riskFlags).toContain("bootstrap_period");
  });

  it("bootstrap guard lifts at exactly 10 receipts", () => {
    const r = computeQueryResult(makeReceipts(10, { variedCallers: true }), xrplDID);
    expect(r.verdict).not.toBe("unknown");
    expect(r.riskFlags).not.toContain("bootstrap_period");
  });

  it("zero diversity for no callers → low trust", () => {
    const receipts = makeReceipts(20); // no callerDid
    const r = computeQueryResult(receipts, xrplDID);
    expect(r.meta.callerDiversity).toBeLessThanOrEqual(0.1);
    expect(r.riskFlags).toContain("low_caller_diversity");
  });

  it("self-farming from 1 did:web caller is nearly worthless", () => {
    // 100 receipts, 1 caller: weight = 2/3, diversity = 0.667/√100 ≈ 0.067
    const receipts = makeReceipts(100, {
      callerDid: "did:web:single-caller",
      callerSignature: "sig",
    });
    const r = computeQueryResult(receipts, xrplDID);
    expect(r.meta.callerDiversity).toBeCloseTo(2 / 3 / 10, 2);
  });

  it("did:key callers contribute less diversity than did:xrpl callers", () => {
    // 20 receipts from 5 did:key callers vs 5 did:xrpl callers
    const keyCallers = makeReceipts(20, { variedCallers: true, callerMethod: "key" });
    // Only 5 unique callers (indices 0-4 repeated)
    for (let i = 5; i < 20; i++) {
      keyCallers[i].callerDid = `did:key:caller-${i % 5}`;
    }
    const xrplCallers = makeReceipts(20, { variedCallers: true, callerMethod: "xrpl" });
    for (let i = 5; i < 20; i++) {
      xrplCallers[i].callerDid = `did:xrpl:caller-${i % 5}`;
    }

    const rKey = computeQueryResult(keyCallers, webDID);
    const rXrpl = computeQueryResult(xrplCallers, webDID);

    // xrpl callers should yield higher diversity (0.833 each vs 0.5 each)
    expect(rXrpl.meta.callerDiversity).toBeGreaterThan(rKey.meta.callerDiversity);
  });

  it("many unique did:web callers → high diversity", () => {
    const receipts = makeReceipts(100, { variedCallers: true });
    const r = computeQueryResult(receipts, webDID);
    // 100 * 0.667 / √100 = 6.67 → capped at 1.0
    expect(r.meta.callerDiversity).toBe(1);
  });

  it("diversity directly impacts trust", () => {
    const lowDiv = makeReceipts(50, {
      callerDid: "did:web:single",
      callerSignature: "sig",
    });
    const highDiv = makeReceipts(50, { variedCallers: true });
    const rLow = computeQueryResult(lowDiv, webDID);
    const rHigh = computeQueryResult(highDiv, webDID);
    expect(rHigh.trust).toBeGreaterThan(rLow.trust);
  });
});

// ─── Co-sign Factor ─────────────────────────────────

describe("co-sign factor", () => {
  it("no co-signatures gives base co_sign_factor of 0.5", () => {
    const receipts = makeReceipts(50, { variedCallers: false });
    const r = computeQueryResult(receipts, xrplDID);
    expect(r.meta.coSignedRate).toBe(0);
    expect(r.riskFlags).toContain("no_cosignatures");
  });

  it("all co-signed receipts boost trust", () => {
    const unsigned = makeReceipts(50, { variedCallers: true });
    unsigned.forEach((r) => (r.callerSignature = null));
    const coSigned = makeReceipts(50, { variedCallers: true });
    const rUnsigned = computeQueryResult(unsigned, xrplDID);
    const rCoSigned = computeQueryResult(coSigned, xrplDID);
    expect(rCoSigned.trust).toBeGreaterThan(rUnsigned.trust);
    expect(rCoSigned.meta.coSignedRate).toBe(1);
  });

  it("partial co-signing", () => {
    const receipts = [
      ...makeReceipts(25, {
        callerDid: "did:web:caller.com",
        callerSignature: "fakesig",
      }),
      ...makeReceipts(25),
    ];
    const r = computeQueryResult(receipts, xrplDID);
    expect(r.meta.coSignedRate).toBe(0.5);
    expect(r.riskFlags).not.toContain("no_cosignatures");
  });
});

// ─── Trust = bayesian × diversity × cosign ──────────

describe("trust composition", () => {
  it("did:key with many diverse co-signed callers achieves high trust", () => {
    const receipts = makeReceipts(200, { variedCallers: true });
    const r = computeQueryResult(receipts, keyDID);
    expect(r.trust).toBeGreaterThan(0.7);
    expect(r.verdict).toBe("yes");
  });

  it("trust depends on all three axes", () => {
    // Good bayesian + good diversity + good cosign → high trust
    const good = makeReceipts(100, { variedCallers: true });
    const rGood = computeQueryResult(good, xrplDID);

    // Good bayesian + no callers + no cosign → low trust
    const noCallers = makeReceipts(100);
    const rNoCaller = computeQueryResult(noCallers, xrplDID);

    expect(rGood.trust).toBeGreaterThan(rNoCaller.trust * 3);
  });
});

// ─── Per-capability scores ──────────────────────────

describe("per-capability scores", () => {
  it("scores capabilities independently", () => {
    const receipts = [
      ...makeReceipts(15, { toolName: "translate", success: true, variedCallers: true }),
      ...makeReceipts(10, { toolName: "code-gen", success: true, variedCallers: true }),
      ...makeReceipts(10, { toolName: "code-gen", success: false, variedCallers: true }),
    ];
    const r = computeQueryResult(receipts, webDID);

    expect(r.score.byCapability["translate"].score).toBe(1);
    expect(r.score.byCapability["code-gen"].score).toBe(0.5);
  });

  it("queries specific capability", () => {
    const receipts = [
      ...makeReceipts(15, { toolName: "translate", success: true, variedCallers: true }),
      ...makeReceipts(20, { toolName: "code-gen", success: false, variedCallers: true }),
    ];
    const r = computeQueryResult(receipts, webDID, "translate");
    expect(r.score.overall).toBe(1);
  });
});

// ─── Risk flags ─────────────────────────────────────

describe("risk flags", () => {
  it("flags low_sample_size when < 30", () => {
    const r = computeQueryResult(makeReceipts(15, { variedCallers: true }), webDID);
    expect(r.riskFlags).toContain("low_sample_size");
  });

  it("no low_sample_size when >= 30", () => {
    const r = computeQueryResult(makeReceipts(30, { variedCallers: true }), webDID);
    expect(r.riskFlags).not.toContain("low_sample_size");
  });

  it("flags high_error_rate when > 10%", () => {
    const receipts = [
      ...makeReceipts(8, { success: true, variedCallers: true }),
      ...makeReceipts(3, { success: false, variedCallers: true }),
    ];
    const r = computeQueryResult(receipts, webDID);
    expect(r.riskFlags).toContain("high_error_rate");
  });

  it("flags low_caller_diversity when diversity < 0.3", () => {
    const r = computeQueryResult(
      makeReceipts(20, { callerDid: "did:web:solo", callerSignature: "sig" }),
      keyDID
    );
    expect(r.riskFlags).toContain("low_caller_diversity");
  });

  it("flags low_cosign_rate when < 75%", () => {
    const receipts = [
      ...makeReceipts(5, {
        callerDid: "did:web:caller.com",
        callerSignature: "sig",
      }),
      ...makeReceipts(15, { variedCallers: true }),
    ];
    receipts.slice(5).forEach((r) => (r.callerSignature = null));
    const r = computeQueryResult(receipts, webDID);
    expect(r.riskFlags).toContain("low_cosign_rate");
  });
});

// ─── Verdict thresholds ─────────────────────────────

describe("verdict thresholds", () => {
  it("yes when trust >= 0.70", () => {
    const r = computeQueryResult(
      makeReceipts(1000, { variedCallers: true }),
      xrplDID
    );
    expect(r.verdict).toBe("yes");
    expect(r.trust).toBeGreaterThanOrEqual(0.7);
  });

  it("no for agents with all failures", () => {
    const r = computeQueryResult(
      makeReceipts(20, { success: false, variedCallers: true }),
      webDID
    );
    expect(r.verdict).toBe("no");
  });

  it("meta includes all v0.3.1 fields", () => {
    const r = computeQueryResult(makeReceipts(20, { variedCallers: true }), xrplDID);
    expect(r.meta).toHaveProperty("bayesianScore");
    expect(r.meta).toHaveProperty("callerDiversity");
    expect(r.meta).toHaveProperty("coSignedRate");
    expect(r.meta).toHaveProperty("prior");
    expect(r.meta.prior).toEqual([5, 1]); // xrpl prior
  });
});
