/**
 * XAIP SDK v0.3.1 — Chain-agnostic trust protocol for AI agents.
 *
 * Usage:
 *   import { withXAIP } from "xaip-sdk";
 *   await withXAIP(server, { did: "did:web:myagent.com" });
 */

// Middleware (primary API)
export { withXAIP } from "./middleware";

// Identity
export { parseDID, generateDIDKey, createSigningDelegate, verify, hash } from "./identity";

// Score
export { computeQueryResult } from "./score";

// Store
export { ReceiptStore } from "./store";
export type { StoredReceipt } from "./store";

// Aggregator (federation)
export { AggregatorClient, createAggregatorServer } from "./aggregator";
export type { AggregatorServerOptions } from "./aggregator";

// OpenTelemetry
export { XAIPOtelExporter, otelPlugin } from "./otel";
export type { OtelExporterConfig } from "./otel";

// Types
export type {
  DIDMethod,
  ParsedDID,
  SigningDelegate,
  FailureType,
  ExecutionReceipt,
  CapabilityScore,
  TrustScore,
  QueryResult,
  PrivacyLevel,
  XAIPConfig,
  XAIPPlugin,
  XAIPContext,
  AggregatorPushPayload,
  AggregatorQueryRequest,
  AggregatorQueryResponse,
  RateLimitConfig,
} from "./types";

export {
  IDENTITY_PRIORS,
  DEFAULT_RATE_LIMITS,
  XAIP_VERSION,
  XAIP_PROTOCOL_ID,
} from "./types";

// Plugins
export { veridictPlugin } from "./plugins/veridict";
export type { VeridictPluginConfig } from "./plugins/veridict";
export { xrplPlugin, resolveXRPLDID } from "./plugins/xrpl";
export type { XRPLPluginConfig } from "./plugins/xrpl";
