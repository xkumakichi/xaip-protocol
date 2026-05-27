/**
 * XAIP precheck() — developer-facing entry point.
 *
 * Thin SDK wrapper over POST /v1/select. Returns structured execution evidence
 * before delegation. Soft approval informed by evidence, not a hard gate.
 *
 * Not a sandbox, not an approval engine, not a payment rail.
 */

// ─── Constants ───────────────────────────────────────

/** Default Trust API endpoint. */
export const DEFAULT_TRUST_API_ENDPOINT =
  "https://xaip-trust-api.kuma-github.workers.dev";

/** Default policy applied when caller does not supply a policy. */
const DEFAULT_POLICY: Required<PrecheckPolicy> = {
  minReceipts: 0,
  excludeRiskFlags: [],
  requireCoSignatureRatio: 0,
  timeoutMs: 5000,
  mode: "strict",
};

/**
 * Controlled reason strings. The SDK overrides the server's variable
 * `reason` field with one of these two values, so that consumer code
 * does not depend on string parsing.
 */
export const REASON_SELECTED =
  "Selected using available execution evidence.";

export const REASON_NO_ELIGIBLE =
  "No eligible candidates based on available execution evidence.";

// ─── Types ───────────────────────────────────────────

export interface PrecheckInput {
  /** Tool / skill / agent candidates to evaluate. Opaque slugs in -00. */
  candidates: string[];
  /** Free-text context describing what the delegation is for. Required. */
  task: string;
  /** Optional deployment policy. Defaults applied when omitted. */
  policy?: PrecheckPolicy;
  /** Override Trust API endpoint. Defaults to public Cloudflare Worker. */
  endpoint?: string;
  /** Standard abort signal for cancellation. */
  signal?: AbortSignal;
  /** Include derived decision field in output. Default false. */
  includeDecision?: boolean;
}

export interface PrecheckPolicy {
  /** Minimum receipts for a candidate to count as scored. Default 0. */
  minReceipts?: number;
  /** Risk flags that force a candidate to ineligible. Default []. */
  excludeRiskFlags?: string[];
  /** Minimum co-signature ratio (0..1). Default 0 (no requirement).
   *  Reserved for future use. Setting a value > 0 throws XaipInputError
   *  because the aggregator response does not yet expose per-candidate
   *  co-signature ratio in -00, and silently accepting a value the SDK
   *  cannot enforce would be misleading. */
  requireCoSignatureRatio?: number;
  /** Request timeout in milliseconds. Default 5000. */
  timeoutMs?: number;
  /** Selection mode forwarded to /v1/select. Default "strict".
   *  Note: the SDK's own eligibility check always excludes unscored
   *  candidates from selection regardless of `mode`. `mode` is forwarded so
   *  the server can apply its own internal logic to the response shape. */
  mode?: "strict" | "relative";
}

export interface RankedCandidate {
  candidate: string;
  score: number | null;
  receiptCount: number;
  /** Statistical confidence: min(1, receipts/100). null when unscored. */
  confidence: number | null;
  riskFlags: string[];
  verdict: "trusted" | "caution" | "low_trust" | "unscored";
  /** Computed by SDK from policy + verdict. Authoritative for selection. */
  eligible: boolean;
}

export interface PrecheckResult {
  selected: string | null;
  ranked: RankedCandidate[];
  unscored: string[];
  /** One of REASON_SELECTED or REASON_NO_ELIGIBLE. */
  reason: string;
  policyApplied: Required<PrecheckPolicy>;
  source: string;
  timestamp: string;
  /** Present only when `includeDecision: true`. Never "block". */
  decision?: "allow" | "warn" | "unknown";
}

// ─── Errors ──────────────────────────────────────────

export class XaipInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XaipInputError";
  }
}

export class XaipNetworkError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "XaipNetworkError";
  }
}

export class XaipServiceError extends Error {
  constructor(
    message: string,
    public status?: number,
    public body?: unknown
  ) {
    super(message);
    this.name = "XaipServiceError";
  }
}

export class XaipTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XaipTimeoutError";
  }
}

// ─── Server-side response shape (private, not exported) ──

interface SelectServerCandidate {
  slug: string;
  trust: number | null;
  verdict: "trusted" | "caution" | "low_trust" | "unscored";
  receipts: number;
  confidence: number | null;
  source: string;
  riskFlags: string[];
  timestamp: string;
}

interface SelectServerResponse {
  selected: string | null;
  reason: string;
  rejected: Array<{ slug: string; reason: string }>;
  candidates: SelectServerCandidate[];
  withoutXAIP: string;
  warning?: string;
  timestamp: string;
}

// ─── Implementation ──────────────────────────────────

/**
 * Returns structured execution evidence for a set of candidate tools/skills/agents,
 * before the caller decides to invoke any of them.
 *
 * @throws XaipInputError  when task is empty or candidates is empty
 * @throws XaipNetworkError on transport failure
 * @throws XaipServiceError on HTTP 4xx/5xx
 * @throws XaipTimeoutError when policy.timeoutMs is exceeded
 */
export async function precheck(input: PrecheckInput): Promise<PrecheckResult> {
  // 1. Input validation.
  if (typeof input.task !== "string" || input.task.trim() === "") {
    throw new XaipInputError("task must be a non-empty string");
  }
  if (!Array.isArray(input.candidates) || input.candidates.length === 0) {
    throw new XaipInputError("candidates must be a non-empty string[]");
  }
  const badIndex = input.candidates.findIndex(
    (c) => typeof c !== "string" || c.trim() === ""
  );
  if (badIndex !== -1) {
    throw new XaipInputError(
      `candidates[${badIndex}] must be a non-empty string`
    );
  }
  if (
    input.policy?.requireCoSignatureRatio !== undefined &&
    input.policy.requireCoSignatureRatio > 0
  ) {
    throw new XaipInputError(
      "requireCoSignatureRatio is not yet enforceable: the /v1/select endpoint does not expose per-candidate co-signature ratios in -00. Pass 0 or omit until a future revision exposes this field."
    );
  }

  // 2. Merge policy with defaults — per-field, because spreading an object
  //    that holds explicit `undefined` values would clobber defaults
  //    (`{...{a: 1}, ...{a: undefined}}` yields `{a: undefined}`).
  const p = input.policy ?? {};
  const policyApplied: Required<PrecheckPolicy> = {
    minReceipts: p.minReceipts ?? DEFAULT_POLICY.minReceipts,
    excludeRiskFlags: p.excludeRiskFlags ?? DEFAULT_POLICY.excludeRiskFlags,
    requireCoSignatureRatio:
      p.requireCoSignatureRatio ?? DEFAULT_POLICY.requireCoSignatureRatio,
    timeoutMs: p.timeoutMs ?? DEFAULT_POLICY.timeoutMs,
    mode: p.mode ?? DEFAULT_POLICY.mode,
  };

  // 3. Build request URL and body.
  const endpoint = input.endpoint ?? DEFAULT_TRUST_API_ENDPOINT;
  const url = `${endpoint.replace(/\/+$/, "")}/v1/select`;
  const body = JSON.stringify({
    task: input.task,
    candidates: input.candidates,
    mode: policyApplied.mode,
  });

  // 4. Set up timeout + caller-supplied AbortSignal.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort("timeout");
  }, policyApplied.timeoutMs);
  const callerSignal = input.signal;
  const onCallerAbort = (): void => controller.abort("caller-abort");
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort("caller-abort-initial");
    else callerSignal.addEventListener("abort", onCallerAbort, { once: true });
  }

  let response: { ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> };
  try {
    response = (await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: controller.signal,
    })) as unknown as typeof response;
  } catch (err: unknown) {
    // Distinguish timeout vs network failure.
    if (
      err instanceof Error &&
      (err.name === "AbortError" ||
        (err as { name?: string }).name === "AbortError")
    ) {
      throw new XaipTimeoutError(
        `precheck timed out after ${policyApplied.timeoutMs}ms`
      );
    }
    throw new XaipNetworkError(
      `precheck network failure: ${err instanceof Error ? err.message : String(err)}`,
      err
    );
  } finally {
    clearTimeout(timeoutId);
    if (callerSignal) {
      callerSignal.removeEventListener("abort", onCallerAbort);
    }
  }

  // 5. HTTP status check.
  if (!response.ok) {
    let parsedBody: unknown = undefined;
    try {
      parsedBody = await response.json();
    } catch {
      try {
        parsedBody = await response.text();
      } catch {
        parsedBody = undefined;
      }
    }
    throw new XaipServiceError(
      `precheck service returned HTTP ${response.status}`,
      response.status,
      parsedBody
    );
  }

  // 6. Parse and transform response.
  let parsed: SelectServerResponse;
  try {
    parsed = (await response.json()) as SelectServerResponse;
  } catch (err) {
    throw new XaipServiceError(
      `precheck service returned non-JSON body`,
      response.status,
      err
    );
  }

  // 7. Build RankedCandidate[] with SDK-computed eligibility.
  //    The server's `rejected` list is honoured as an ineligible signal,
  //    and SDK policy is layered on top. A candidate is eligible only if
  //    BOTH the server did not reject it AND the SDK policy passes it.
  const rejectedSlugs = new Set(
    (parsed.rejected ?? []).map((r) => r.slug)
  );
  const ranked: RankedCandidate[] = (parsed.candidates ?? []).map((c) => {
    const eligible =
      !rejectedSlugs.has(c.slug) && computeEligibility(c, policyApplied);
    return {
      candidate: c.slug,
      score: c.trust,
      receiptCount: c.receipts,
      confidence: c.confidence,
      riskFlags: c.riskFlags ?? [],
      verdict: c.verdict,
      eligible,
    };
  });

  // Sort: eligible first, then by score desc, then by receipt count desc.
  ranked.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    const sa = a.score ?? -Infinity;
    const sb = b.score ?? -Infinity;
    if (sb !== sa) return sb - sa;
    return b.receiptCount - a.receiptCount;
  });

  // 8. Derive selected via SDK policy (ignore server's selected).
  const firstEligible = ranked.find((c) => c.eligible);
  const selected = firstEligible ? firstEligible.candidate : null;

  // 9. Derive unscored[] for caller convenience.
  const unscored = ranked
    .filter((c) => c.verdict === "unscored")
    .map((c) => c.candidate);

  // 10. Controlled reason.
  const reason = selected !== null ? REASON_SELECTED : REASON_NO_ELIGIBLE;

  // 11. Derive source from first server candidate (or fallback).
  const source =
    parsed.candidates?.[0]?.source ?? "xaip-aggregator (source-unknown)";

  // 12. Optional decision derivation.
  let decision: "allow" | "warn" | "unknown" | undefined;
  if (input.includeDecision === true) {
    decision = deriveDecision(ranked);
  }

  const result: PrecheckResult = {
    selected,
    ranked,
    unscored,
    reason,
    policyApplied,
    source,
    timestamp: parsed.timestamp ?? new Date().toISOString(),
  };
  if (decision !== undefined) result.decision = decision;
  return result;
}

// ─── Internal helpers ────────────────────────────────

function computeEligibility(
  c: SelectServerCandidate,
  policy: Required<PrecheckPolicy>
): boolean {
  // Unscored is always ineligible — no evidence to act on.
  if (c.verdict === "unscored") return false;

  // Below minReceipts → ineligible.
  if (c.receipts < policy.minReceipts) return false;

  // Carries an excluded risk flag → ineligible.
  if (
    policy.excludeRiskFlags.length > 0 &&
    (c.riskFlags ?? []).some((f) => policy.excludeRiskFlags.includes(f))
  ) {
    return false;
  }

  // requireCoSignatureRatio enforcement is handled at input validation
  // (precheck() throws XaipInputError when > 0). No further check needed here.

  return true;
}

function deriveDecision(
  ranked: RankedCandidate[]
): "allow" | "warn" | "unknown" {
  const anyEligible = ranked.some((c) => c.eligible);
  if (anyEligible) return "allow";
  const allUnscored = ranked.every((c) => c.verdict === "unscored");
  if (allUnscored) return "unknown";
  return "warn";
}
