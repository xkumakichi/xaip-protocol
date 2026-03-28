/**
 * Agent Card builder utility
 * Creates well-formed XAIP Agent Card documents
 */

import {
  AgentCard,
  AgentCapability,
  AgentEndpoints,
  AgentOperator,
  AgentPaymentConfig,
  AgentStatus,
  AutonomyLevel,
  AgentModel,
  XAIP_VERSION,
} from "../types";
import { createHash } from "crypto";

export interface CreateAgentCardParams {
  xrplAddress: string;
  name: string;
  description: string;
  model?: AgentModel;
  capabilities: AgentCapability[];
  autonomyLevel: AutonomyLevel;
  operator: AgentOperator;
  endpoints?: AgentEndpoints;
  payment?: Partial<AgentPaymentConfig>;
  publicKeyHex: string;
}

export function createAgentCard(params: CreateAgentCardParams): AgentCard {
  const did = `did:xrpl:1:${params.xrplAddress}`;
  const now = new Date().toISOString();

  const card: AgentCard = {
    "@context": [
      "https://www.w3.org/ns/did/v1",
      "https://xaip.xrpl.org/v1",
    ],
    id: did,
    type: "AIAgent",
    version: `XAIP/${XAIP_VERSION}`,

    agent: {
      name: params.name,
      description: params.description,
      model: params.model,
      created: now,
      status: "active" as AgentStatus,
    },

    capabilities: params.capabilities,
    autonomyLevel: params.autonomyLevel,
    operator: params.operator,
    endpoints: params.endpoints ?? {},
    payment: {
      accept: params.payment?.accept ?? ["XRP"],
      preferredCurrency: params.payment?.preferredCurrency ?? "XRP",
      escrowRequired: params.payment?.escrowRequired ?? false,
      escrowRequiredAbove: params.payment?.escrowRequiredAbove,
    },

    reputation: {
      currentScore: null,
    },

    verificationMethod: [
      {
        id: `${did}#keys-1`,
        type: "EcdsaSecp256k1VerificationKey2019",
        controller: did,
        publicKeyHex: params.publicKeyHex,
      },
    ],

    authentication: [`${did}#keys-1`],

    metadata: {
      xaipVersion: XAIP_VERSION,
      lastUpdated: now,
    },
  };

  // Compute card hash for integrity
  const cardJson = JSON.stringify(card);
  card.metadata.cardHash = `sha256:${createHash("sha256").update(cardJson).digest("hex")}`;

  return card;
}
