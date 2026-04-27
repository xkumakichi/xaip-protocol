/**
 * XAIP Protocol — Type Definitions (v0.3.1)
 *
 * Root redesign: Bayesian trust model, SigningDelegate, caller diversity.
 * No magic constants. Mathematically grounded.
 */

// ─── DID ─────────────────────────────────────────────

export type DIDMethod = "key" | "web" | "xrpl" | "ethr";

export interface ParsedDID {
  method: DIDMethod;
  id: string;
}

/**
 * Bayesian priors as Beta(α, β) per DID method.
 *
 * Stronger prior = more initial trust, but evidence always wins.
 * With 100+ receipts, all methods converge to the same score.
 */
export const IDENTITY_PRIORS: Record<string, [number, number]> = {
  key:  [1, 1],   // uniform — no prior knowledge
  web:  [2, 1],   // slight positive (domain ownership)
  ethr: [3, 1],   // moderate positive (gas cost)
  xrpl: [5, 1],   // strong positive (XRP reserve)
};

// ─── Signing ─────────────────────────────────────────

/**
 * Delegate that signs payloads without exposing private keys.
 * The key NEVER leaves the signer's process.
 */
export interface SigningDelegate {
  did: string;
  sign(payload: string): Promise<string>;
}

// ─── Execution Receipt ───────────────────────────────

export type FailureType = "timeout" | "error" | "validation";

export type XAIPToolClass =
  | "advisory"
  | "data-retrieval"
  | "computation"
  | "mutation"
  | "settlement";

export type XAIPVerifiabilityHint = "anchored" | "attestable" | "none";

export interface XAIPToolMetadata {
  class?: XAIPToolClass;
  secondaryClasses?: XAIPToolClass[];
  settlementLayer?: string;
  verifiabilityHint?: XAIPVerifiabilityHint;
  anchorTxHash?: string;
  anchorLedgerIndex?: number;
}

export interface ToolMetadata {
  xaip?: XAIPToolMetadata;
  [key: string]: unknown;
}

export interface ExecutionReceipt {
  agentDid: string;
  toolName: string;
  taskHash: string;
  resultHash: string;
  success: boolean;
  latencyMs: number;
  failureType?: FailureType;
  timestamp: string;
  toolMetadata?: ToolMetadata;
  signature: string;
  callerDid?: string;
  callerSignature?: string;
}

// ─── Trust Score ─────────────────────────────────────

export interface CapabilityScore {
  score: number;
  executions: number;
  recentSuccessRate: number;
}

export interface TrustScore {
  overall: number;
  byCapability: Record<string, CapabilityScore>;
}

// ─── Query Result ────────────────────────────────────

export interface QueryResult {
  verdict: "yes" | "caution" | "no" | "unknown";
  trust: number;
  riskFlags: string[];
  score: TrustScore;
  meta: {
    sampleSize: number;
    bayesianScore: number;
    callerDiversity: number;
    coSignedRate: number;
    prior: [number, number];
    lastUpdated: string;
    sources: number;
    /** Number of aggregator nodes that reached consensus (BFT quorum). */
    quorumSize?: number;
  };
}

// ─── Configuration ───────────────────────────────────

export type PrivacyLevel = "full" | "summary" | "minimal";

export interface XAIPConfig {
  did?: string;
  name?: string;
  capabilities?: string[];
  privacy?: PrivacyLevel;
  verbose?: boolean;
  dbPath?: string;
  plugins?: XAIPPlugin[];
  /** Caller signing delegate. Key never leaves caller's process. */
  callerSigner?: SigningDelegate;
  /** Aggregator URLs for federation. Pushes to all, queries quorum. */
  aggregatorUrls?: string[];
  /** Enable OpenTelemetry export. */
  otel?: boolean;
}

// ─── Plugin ──────────────────────────────────────────

export interface XAIPPlugin {
  name: string;
  init(ctx: XAIPContext): void | Promise<void>;
}

export interface XAIPContext {
  did: ParsedDID;
  publicKey: string;
  store: import("./store").ReceiptStore;
}

// ─── Federation / Aggregator ─────────────────────────

export interface AggregatorPushPayload {
  receipt: ExecutionReceipt;
  publicKey: string;
}

export interface AggregatorQueryRequest {
  agentDid: string;
  capability?: string;
}

export interface AggregatorQueryResponse {
  result: QueryResult;
  source: string;
  timestamp: string;
  /** Ed25519 signature over canonicalized result (proves aggregator identity). */
  signature?: string;
  /** Aggregator's public key (SPKI hex) for response verification. */
  publicKey?: string;
  /** URLs of nodes excluded as MAD outliers. Present when outliers were detected. */
  outlierNodes?: string[];
}

// ─── Rate Limiting (DoS prevention, not Sybil) ──────

export interface RateLimitConfig {
  maxReceiptsPerDidPerHour: number;
}

export const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  maxReceiptsPerDidPerHour: 1000,
};

// ─── Constants ───────────────────────────────────────

export const XAIP_VERSION = "0.4.0";
export const XAIP_PROTOCOL_ID = `XAIP/${XAIP_VERSION}`;
