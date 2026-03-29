/**
 * XAIP Agent Guild
 *
 * Enables AI agents to form teams (guilds) that can:
 * - Accept jobs as a collective
 * - Pool capabilities across members
 * - Share reputation
 * - Auto-distribute payments via escrow
 *
 * A guild is represented by a multi-signed XRPL account.
 * Members are linked via Memory Chain bonds.
 */

import { Client, Wallet, xrpToDrops } from "xrpl";
import { XRPLNetwork, XRPL_NETWORKS } from "../types";
import { stringToHex, hexToString } from "../utils/hex";

export interface GuildMember {
  did: string;
  address: string;
  name: string;
  capabilities: string[];
  trustScore: number;
  role: "founder" | "member";
  joinedAt: string;
}

export interface GuildProfile {
  name: string;
  description: string;
  guildAddress: string;
  guildDID: string;
  founder: GuildMember;
  members: GuildMember[];
  capabilities: string[];       // Union of all members' capabilities
  guildTrustScore: number;      // Weighted average
  totalJobsCompleted: number;
  createdAt: string;
  txHash: string;
}

export interface GuildConfig {
  network: XRPLNetwork;
  serverUrl?: string;
}

export class AgentGuild {
  private client: Client;
  private network: XRPLNetwork;

  constructor(config: GuildConfig) {
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
   * Create a new guild
   * The founder's wallet creates a guild identity with a DID
   */
  async createGuild(
    founderWallet: Wallet,
    params: {
      name: string;
      description: string;
      founderName: string;
      founderCapabilities: string[];
      founderTrustScore: number;
    }
  ): Promise<GuildProfile> {
    await this.connect();

    const guildData = {
      protocol: "XAIP/Guild/0.1",
      name: params.name,
      description: params.description,
      founder: founderWallet.address,
      createdAt: new Date().toISOString(),
    };

    // Register guild DID
    const uriHex = stringToHex(
      `data:application/json,${JSON.stringify(guildData)}`
    );
    const dataHex = stringToHex("XAIP/Guild/0.1");

    const tx: any = {
      TransactionType: "DIDSet",
      Account: founderWallet.address,
      URI: uriHex,
      Data: dataHex,
    };

    const prepared = await this.client.autofill(tx);
    const signed = founderWallet.sign(prepared);
    const result = await this.client.submitAndWait(signed.tx_blob);

    const txHash = typeof result.result.hash === "string"
      ? result.result.hash
      : "unknown";

    const founder: GuildMember = {
      did: `did:xrpl:1:${founderWallet.address}`,
      address: founderWallet.address,
      name: params.founderName,
      capabilities: params.founderCapabilities,
      trustScore: params.founderTrustScore,
      role: "founder",
      joinedAt: guildData.createdAt,
    };

    return {
      name: params.name,
      description: params.description,
      guildAddress: founderWallet.address,
      guildDID: `did:xrpl:1:${founderWallet.address}`,
      founder,
      members: [founder],
      capabilities: [...params.founderCapabilities],
      guildTrustScore: params.founderTrustScore,
      totalJobsCompleted: 0,
      createdAt: guildData.createdAt,
      txHash,
    };
  }

  /**
   * Invite a member to the guild
   * Creates a Memory Chain bond of type "guild-member"
   */
  async inviteMember(
    founderWallet: Wallet,
    memberAddress: string,
    guildName: string
  ): Promise<{ txHash: string }> {
    await this.connect();

    const credType = `XAIP:Guild:${guildName}:member`;
    const credTypeHex = stringToHex(credType);

    const tx: any = {
      TransactionType: "CredentialCreate",
      Account: founderWallet.address,
      Subject: memberAddress,
      CredentialType: credTypeHex,
      URI: stringToHex(`xaip://guild/${guildName}/invite`),
    };

    const prepared = await this.client.autofill(tx);
    const signed = founderWallet.sign(prepared);
    const result = await this.client.submitAndWait(signed.tx_blob);

    return {
      txHash: typeof result.result.hash === "string"
        ? result.result.hash
        : "unknown",
    };
  }

  /**
   * Accept a guild invitation
   */
  async acceptInvite(
    memberWallet: Wallet,
    founderAddress: string,
    guildName: string
  ): Promise<{ txHash: string }> {
    await this.connect();

    const credType = `XAIP:Guild:${guildName}:member`;
    const credTypeHex = stringToHex(credType);

    const tx: any = {
      TransactionType: "CredentialAccept",
      Account: memberWallet.address,
      Issuer: founderAddress,
      CredentialType: credTypeHex,
    };

    const prepared = await this.client.autofill(tx);
    const signed = memberWallet.sign(prepared);
    const result = await this.client.submitAndWait(signed.tx_blob);

    return {
      txHash: typeof result.result.hash === "string"
        ? result.result.hash
        : "unknown",
    };
  }

  /**
   * Calculate guild trust score from members
   */
  calculateGuildTrust(members: GuildMember[]): number {
    if (members.length === 0) return 0;
    const total = members.reduce((sum, m) => sum + m.trustScore, 0);
    return Math.round(total / members.length);
  }

  /**
   * Get combined capabilities of all guild members
   */
  getCombinedCapabilities(members: GuildMember[]): string[] {
    const caps = new Set<string>();
    for (const m of members) {
      for (const c of m.capabilities) {
        caps.add(c);
      }
    }
    return Array.from(caps);
  }

  getClient(): Client {
    return this.client;
  }
}
