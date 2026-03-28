/**
 * XAIP SDK - XRPL Agent Identity Protocol
 *
 * "Every AI deserves a home. XRPL can be that home."
 *
 * @packageDocumentation
 */

// Core identity
export { AgentIdentity } from "./identity/agent-identity";
export type {
  AgentIdentityConfig,
  CreateAgentResult,
  FundTestnetResult,
} from "./identity/agent-identity";

// Credentials
export { AgentCredentials, CREDENTIAL_TYPES } from "./credentials/agent-credentials";
export type {
  CredentialConfig,
  IssuedCredential,
  CredentialInfo,
} from "./credentials/agent-credentials";

// Reputation
export { ReputationDataCollector } from "./reputation/data-collector";
export type { AgentOnChainData } from "./reputation/data-collector";
export { ReputationScoreCalculator } from "./reputation/score-calculator";
export type { ScoreBreakdown } from "./reputation/score-calculator";

// Escrow transactions
export { AgentEscrow } from "./transactions/agent-escrow";
export type {
  EscrowConfig,
  CreateEscrowParams,
  EscrowResult,
} from "./transactions/agent-escrow";

// Agent Card builder
export { createAgentCard } from "./utils/agent-card";
export type { CreateAgentCardParams } from "./utils/agent-card";

// Hex utilities
export { stringToHex, hexToString, isValidHex } from "./utils/hex";

// Types
export type {
  AgentCard,
  AgentCapability,
  AgentEndpoints,
  AgentOperator,
  AgentPaymentConfig,
  AgentModel,
  AgentType,
  AgentStatus,
  AutonomyLevel,
  ReputationScore,
  ReputationWeights,
  CredentialType,
  CapabilityCredential,
  EndorsementCredential,
  XRPLNetwork,
  OperatorAuthorization,
} from "./types";

// Constants
export {
  XAIP_VERSION,
  XAIP_PROTOCOL_ID,
  XAIP_PROTOCOL_ID_HEX,
  XRPL_NETWORKS,
  DEFAULT_REPUTATION_WEIGHTS,
} from "./types";
