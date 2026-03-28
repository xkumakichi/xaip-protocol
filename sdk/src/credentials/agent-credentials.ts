/**
 * XAIP Agent Credentials Manager
 * Handles issuing, accepting, and verifying credentials on XRPL (XLS-70)
 *
 * Credential types:
 * - Capability: Proves an agent can do something (e.g., "translation")
 * - AutonomyLevel: Certifies an agent's autonomy level (L1-L5)
 * - Endorsement: Peer review after successful interaction
 */

import { Client, Wallet } from "xrpl";
import {
  XRPLNetwork,
  XRPL_NETWORKS,
  CapabilityCredential,
  EndorsementCredential,
} from "../types";
import { stringToHex, hexToString } from "../utils/hex";

// Credential type prefixes (hex-encoded for XLS-70)
export const CREDENTIAL_TYPES = {
  CAPABILITY: "XAIP:Capability",
  AUTONOMY: "XAIP:AutonomyLevel",
  ENDORSEMENT: "XAIP:Endorsement",
} as const;

export interface CredentialConfig {
  network: XRPLNetwork;
  serverUrl?: string;
}

export interface IssuedCredential {
  txHash: string;
  issuer: string;
  subject: string;
  credentialType: string;
}

export interface CredentialInfo {
  issuer: string;
  subject: string;
  credentialType: string;
  uri?: string;
  accepted: boolean;
}

export class AgentCredentials {
  private client: Client;
  private network: XRPLNetwork;

  constructor(config: CredentialConfig) {
    this.network = config.network;
    const url = config.serverUrl ?? XRPL_NETWORKS[config.network];
    this.client = new Client(url);
  }

  async connect(): Promise<void> {
    if (!this.client.isConnected()) {
      await this.client.connect();
    }
  }

  async disconnect(): Promise<void> {
    if (this.client.isConnected()) {
      await this.client.disconnect();
    }
  }

  /**
   * Issue a capability credential to an agent
   * Called by a Capability Assessor to certify an agent's ability
   */
  async issueCapabilityCredential(
    issuerWallet: Wallet,
    subjectAddress: string,
    capabilityDomain: string,
    detailsUri?: string
  ): Promise<IssuedCredential> {
    await this.connect();

    const credType = `${CREDENTIAL_TYPES.CAPABILITY}:${capabilityDomain}`;
    const credTypeHex = stringToHex(credType);

    const tx: any = {
      TransactionType: "CredentialCreate",
      Account: issuerWallet.address,
      Subject: subjectAddress,
      CredentialType: credTypeHex,
    };

    if (detailsUri) {
      tx.URI = stringToHex(detailsUri);
    }

    const prepared = await this.client.autofill(tx);
    const signed = issuerWallet.sign(prepared);
    const result = await this.client.submitAndWait(signed.tx_blob);

    return {
      txHash: typeof result.result.hash === "string" ? result.result.hash : "unknown",
      issuer: issuerWallet.address,
      subject: subjectAddress,
      credentialType: credType,
    };
  }

  /**
   * Issue an endorsement credential after a successful interaction
   * Called by one agent to endorse another after completing work
   */
  async issueEndorsement(
    endorserWallet: Wallet,
    subjectAddress: string,
    interactionType: string,
    detailsUri?: string
  ): Promise<IssuedCredential> {
    await this.connect();

    const credType = `${CREDENTIAL_TYPES.ENDORSEMENT}:${interactionType}`;
    const credTypeHex = stringToHex(credType);

    const tx: any = {
      TransactionType: "CredentialCreate",
      Account: endorserWallet.address,
      Subject: subjectAddress,
      CredentialType: credTypeHex,
    };

    if (detailsUri) {
      tx.URI = stringToHex(detailsUri);
    }

    const prepared = await this.client.autofill(tx);
    const signed = endorserWallet.sign(prepared);
    const result = await this.client.submitAndWait(signed.tx_blob);

    return {
      txHash: typeof result.result.hash === "string" ? result.result.hash : "unknown",
      issuer: endorserWallet.address,
      subject: subjectAddress,
      credentialType: credType,
    };
  }

  /**
   * Accept a credential that has been issued to you
   * Agent must accept for the credential to be fully valid
   */
  async acceptCredential(
    agentWallet: Wallet,
    issuerAddress: string,
    credentialType: string
  ): Promise<{ txHash: string }> {
    await this.connect();

    const credTypeHex = stringToHex(credentialType);

    const tx: any = {
      TransactionType: "CredentialAccept",
      Account: agentWallet.address,
      Issuer: issuerAddress,
      CredentialType: credTypeHex,
    };

    const prepared = await this.client.autofill(tx);
    const signed = agentWallet.sign(prepared);
    const result = await this.client.submitAndWait(signed.tx_blob);

    return {
      txHash: typeof result.result.hash === "string" ? result.result.hash : "unknown",
    };
  }

  /**
   * Delete/revoke a credential
   * Can be called by issuer (revocation) or subject (removal)
   */
  async deleteCredential(
    wallet: Wallet,
    otherPartyAddress: string,
    credentialType: string,
    role: "issuer" | "subject"
  ): Promise<{ txHash: string }> {
    await this.connect();

    const credTypeHex = stringToHex(credentialType);

    const tx: any = {
      TransactionType: "CredentialDelete",
      Account: wallet.address,
      CredentialType: credTypeHex,
    };

    if (role === "issuer") {
      tx.Subject = otherPartyAddress;
    } else {
      tx.Issuer = otherPartyAddress;
    }

    const prepared = await this.client.autofill(tx);
    const signed = wallet.sign(prepared);
    const result = await this.client.submitAndWait(signed.tx_blob);

    return {
      txHash: typeof result.result.hash === "string" ? result.result.hash : "unknown",
    };
  }

  /**
   * Look up a specific credential on the ledger
   */
  async getCredential(
    subjectAddress: string,
    issuerAddress: string,
    credentialType: string
  ): Promise<CredentialInfo | null> {
    await this.connect();

    const credTypeHex = stringToHex(credentialType);

    try {
      const response = await this.client.request({
        command: "ledger_entry",
        credential: {
          subject: subjectAddress,
          issuer: issuerAddress,
          credential_type: credTypeHex,
        },
      } as any);

      const node = (response.result as any).node;
      if (!node) return null;

      return {
        issuer: node.Issuer ?? issuerAddress,
        subject: node.Subject ?? subjectAddress,
        credentialType: credentialType,
        uri: node.URI ? hexToString(node.URI) : undefined,
        accepted: node.Flags === 0x00010000 || !!node.AcceptTime,
      };
    } catch (error: any) {
      if (error.data?.error === "entryNotFound") {
        return null;
      }
      throw error;
    }
  }

  getClient(): Client {
    return this.client;
  }
}
