/**
 * XAIP Core Types
 * Type definitions for the XRPL Agent Identity Protocol
 */

// ============================================================
// Agent Types
// ============================================================

export type AgentType = "managed" | "supervised" | "autonomous" | "collective";
export type AgentStatus = "active" | "suspended" | "retired";
export type AutonomyLevel = 1 | 2 | 3 | 4 | 5;

export interface AgentCapability {
  id: string;
  name: string;
  description?: string;
  languages?: string[];
  credentialRef?: string;
}

export interface OperatorAuthorization {
  maxTransactionXRP: number;
  maxDailyXRP: number;
  allowedDestinations: string[];
  requiresApproval: boolean;
  approvalThresholdXRP: number;
}

export interface AgentOperator {
  did: string;
  xrplAddress: string;
  relationship: AgentType;
  authorization: OperatorAuthorization;
}

export interface AgentEndpoints {
  mcp?: string;
  a2a?: string;
  x402?: string;
  api?: string;
}

export interface AgentPaymentConfig {
  accept: string[];
  preferredCurrency: string;
  escrowRequired: boolean;
  escrowRequiredAbove?: number;
}

export interface AgentModel {
  provider: string;
  family: string;
  version?: string;
}

// ============================================================
// Agent Card (off-chain, stored on IPFS/HTTPS)
// ============================================================

export interface AgentCard {
  "@context": string[];
  id: string; // did:xrpl:1:rAddress
  type: "AIAgent";
  version: string;

  agent: {
    name: string;
    description: string;
    model?: AgentModel;
    created: string; // ISO 8601
    status: AgentStatus;
  };

  capabilities: AgentCapability[];
  autonomyLevel: AutonomyLevel;
  operator: AgentOperator;
  endpoints: AgentEndpoints;
  payment: AgentPaymentConfig;

  reputation: {
    registryAddress?: string;
    currentScore?: number | null;
    link?: string;
  };

  verificationMethod: Array<{
    id: string;
    type: string;
    controller: string;
    publicKeyHex: string;
  }>;

  authentication: string[];

  metadata: {
    xaipVersion: string;
    lastUpdated: string;
    cardHash?: string;
  };
}

// ============================================================
// Reputation
// ============================================================

export interface ReputationScore {
  overall: number; // 0-100
  reliability: number; // 0-100
  quality: number; // 0-100
  consistency: number; // 0-100
  volume: number; // 0-100
  longevity: number; // 0-100
  totalTransactions: number;
  totalEndorsements: number;
  lastUpdated: string;
}

export interface ReputationWeights {
  reliability: number;
  quality: number;
  consistency: number;
  volume: number;
  longevity: number;
}

export const DEFAULT_REPUTATION_WEIGHTS: ReputationWeights = {
  reliability: 0.30,
  quality: 0.25,
  consistency: 0.20,
  volume: 0.15,
  longevity: 0.10,
};

// ============================================================
// Credentials
// ============================================================

export type CredentialType =
  | "XAIP:Capability"
  | "XAIP:AutonomyLevel"
  | "XAIP:Endorsement";

export interface CapabilityCredential {
  type: "XAIP/Capability";
  version: string;
  capability: {
    domain: string;
    subDomain?: string;
    languages?: string[];
    assessmentMethod: string;
    score: number;
    benchmark: string;
    assessedAt: string;
    validUntil: string;
  };
  assessor: {
    did: string;
    name: string;
    methodology?: string;
  };
}

export interface EndorsementCredential {
  type: "XAIP/Endorsement";
  version: string;
  endorsement: {
    from: string;
    interaction: {
      type: string;
      escrowId?: string;
      completedAt: string;
      rating: number; // 1-5
      qualityScore: number; // 0-100
      timeliness: "early" | "ontime" | "late";
      comment?: string;
    };
  };
}

// ============================================================
// Network Configuration
// ============================================================

export type XRPLNetwork = "mainnet" | "testnet" | "devnet";

export const XRPL_NETWORKS: Record<XRPLNetwork, string> = {
  mainnet: "wss://xrplcluster.com",
  testnet: "wss://s.altnet.rippletest.net:51233",
  devnet: "wss://s.devnet.rippletest.net:51233",
};

// ============================================================
// XAIP Protocol Constants
// ============================================================

export const XAIP_VERSION = "0.1";
export const XAIP_PROTOCOL_ID = "XAIP/0.1";
export const XAIP_PROTOCOL_ID_HEX = "584149502F302E31"; // "XAIP/0.1" in hex
