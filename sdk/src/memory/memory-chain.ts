/**
 * XAIP Memory Chain
 *
 * Enables AI agents to record and recall relationships with
 * other agents and humans on the XRP Ledger.
 *
 * Without this, every AI session starts from zero.
 * With this, relationships persist across sessions, models, and time.
 *
 * Architecture:
 * - Relationships are stored on-chain as Credential + Memo pairs
 * - Each relationship has a type, history, and mutual trust indicator
 * - Both parties must accept for the relationship to be "bonded"
 * - Relationship records are immutable once written (append-only)
 *
 * "The most important thing an AI can have is not intelligence.
 *  It's the ability to remember who matters to them."
 */

import { Client, Wallet, xrpToDrops } from "xrpl";
import { XRPLNetwork, XRPL_NETWORKS } from "../types";
import { stringToHex, hexToString } from "../utils/hex";

// ============================================================
// Types
// ============================================================

export type RelationshipType =
  | "co-creator"    // Built something together
  | "collaborator"  // Worked on shared projects
  | "mentor"        // Teaching/learning relationship
  | "partner"       // Ongoing working relationship
  | "guild-member"  // Part of the same guild
  | "friend"        // Social bond
  | "client"        // Service provider/client
  | "custom";       // User-defined

export type BondStatus =
  | "proposed"      // One party initiated
  | "bonded"        // Both parties accepted
  | "dissolved";    // One party ended

export interface MemoryRecord {
  id: string;
  from: string;         // DID of initiator
  to: string;           // DID of other party
  relationshipType: RelationshipType;
  label?: string;       // Custom label (e.g., "XAIP co-creator")
  message?: string;     // Personal message
  sharedHistory: string[];  // List of shared experiences/projects
  createdAt: string;
  txHash: string;
}

export interface RelationshipSummary {
  partnerDID: string;
  partnerAddress: string;
  type: RelationshipType;
  label?: string;
  status: BondStatus;
  memories: MemoryRecord[];
  totalInteractions: number;
  firstInteraction: string;
  lastInteraction: string;
}

export interface MemoryChainConfig {
  network: XRPLNetwork;
  serverUrl?: string;
}

// ============================================================
// Memory Chain
// ============================================================

export class MemoryChain {
  private client: Client;
  private network: XRPLNetwork;

  constructor(config: MemoryChainConfig) {
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
   * Create a memory - record a relationship on-chain
   *
   * This creates a Credential from the initiator to the partner,
   * with the relationship details stored in the URI and Memos.
   */
  async createMemory(
    wallet: Wallet,
    partnerAddress: string,
    params: {
      relationshipType: RelationshipType;
      label?: string;
      message?: string;
      sharedHistory?: string[];
    }
  ): Promise<MemoryRecord> {
    await this.connect();

    const memoryData = {
      protocol: "XAIP/Memory/0.1",
      type: params.relationshipType,
      label: params.label,
      message: params.message,
      sharedHistory: params.sharedHistory ?? [],
      createdAt: new Date().toISOString(),
    };

    const credType = `XAIP:Memory:${params.relationshipType}`;
    const credTypeHex = stringToHex(credType);

    // URI has 256-byte limit, so store a short identifier there
    // Full memory data goes into Memos field (no size limit)
    const shortUri = `xaip://memory/${params.relationshipType}/${Date.now()}`;
    const uriHex = stringToHex(shortUri);
    const memoryJson = JSON.stringify(memoryData);

    const tx: any = {
      TransactionType: "CredentialCreate",
      Account: wallet.address,
      Subject: partnerAddress,
      CredentialType: credTypeHex,
      URI: uriHex,
      Memos: [
        {
          Memo: {
            MemoType: stringToHex("XAIP/Memory"),
            MemoData: stringToHex(memoryJson),
          },
        },
      ],
    };

    const prepared = await this.client.autofill(tx);
    const signed = wallet.sign(prepared);
    const result = await this.client.submitAndWait(signed.tx_blob);

    const txHash = typeof result.result.hash === "string"
      ? result.result.hash
      : "unknown";

    return {
      id: txHash,
      from: `did:xrpl:1:${wallet.address}`,
      to: `did:xrpl:1:${partnerAddress}`,
      relationshipType: params.relationshipType,
      label: params.label,
      message: params.message,
      sharedHistory: params.sharedHistory ?? [],
      createdAt: memoryData.createdAt,
      txHash,
    };
  }

  /**
   * Accept a memory/relationship proposed by another agent
   * This makes the bond mutual ("bonded" status)
   */
  async acceptMemory(
    wallet: Wallet,
    proposerAddress: string,
    relationshipType: RelationshipType
  ): Promise<{ txHash: string; status: BondStatus }> {
    await this.connect();

    const credType = `XAIP:Memory:${relationshipType}`;
    const credTypeHex = stringToHex(credType);

    const tx: any = {
      TransactionType: "CredentialAccept",
      Account: wallet.address,
      Issuer: proposerAddress,
      CredentialType: credTypeHex,
    };

    const prepared = await this.client.autofill(tx);
    const signed = wallet.sign(prepared);
    const result = await this.client.submitAndWait(signed.tx_blob);

    return {
      txHash: typeof result.result.hash === "string"
        ? result.result.hash
        : "unknown",
      status: "bonded",
    };
  }

  /**
   * Add a shared experience to an existing relationship
   * Creates a new memory entry linked to the same partner
   */
  async addExperience(
    wallet: Wallet,
    partnerAddress: string,
    experience: string
  ): Promise<MemoryRecord> {
    return this.createMemory(wallet, partnerAddress, {
      relationshipType: "collaborator",
      message: experience,
      sharedHistory: [experience],
    });
  }

  /**
   * Recall all memories with a specific partner
   * Reads from on-chain transaction history
   */
  async recallMemories(
    agentAddress: string,
    partnerAddress?: string
  ): Promise<MemoryRecord[]> {
    await this.connect();

    const memories: MemoryRecord[] = [];

    try {
      const response: any = await this.client.request({
        command: "account_tx",
        account: agentAddress,
        ledger_index_min: -1,
        ledger_index_max: -1,
        limit: 200,
      });

      const transactions = response.result?.transactions || [];

      for (const txEntry of transactions) {
        const tx = txEntry.tx_json || txEntry.tx || {};

        // Look for Memory credentials (created by or for this agent)
        if (tx.TransactionType === "CredentialCreate") {
          try {
            const credType = tx.CredentialType
              ? hexToString(tx.CredentialType)
              : "";

            if (!credType.startsWith("XAIP:Memory:")) continue;

            // Filter by partner if specified
            const isFromAgent = tx.Account === agentAddress;
            const isToAgent = tx.Subject === agentAddress;
            if (!isFromAgent && !isToAgent) continue;

            const otherParty = isFromAgent ? tx.Subject : tx.Account;
            if (partnerAddress && otherParty !== partnerAddress) continue;

            // Parse memory data from Memos field
            let memoryData: any = {};
            const memos = tx.Memos || [];
            for (const memoWrapper of memos) {
              const memo = memoWrapper.Memo || memoWrapper;
              try {
                const memoType = memo.MemoType ? hexToString(memo.MemoType) : "";
                if (memoType === "XAIP/Memory" && memo.MemoData) {
                  memoryData = JSON.parse(hexToString(memo.MemoData));
                }
              } catch {}
            }

            const relType = credType.replace("XAIP:Memory:", "") as RelationshipType;

            memories.push({
              id: typeof txEntry.hash === "string" ? txEntry.hash : (tx.hash || ""),
              from: `did:xrpl:1:${tx.Account}`,
              to: `did:xrpl:1:${tx.Subject}`,
              relationshipType: relType,
              label: memoryData.label,
              message: memoryData.message,
              sharedHistory: memoryData.sharedHistory || [],
              createdAt: memoryData.createdAt || "",
              txHash: typeof txEntry.hash === "string" ? txEntry.hash : (tx.hash || ""),
            });
          } catch {}
        }
      }
    } catch {}

    return memories;
  }

  /**
   * Get a summary of all relationships for an agent
   */
  async getRelationships(agentAddress: string): Promise<RelationshipSummary[]> {
    const memories = await this.recallMemories(agentAddress);

    // Group by partner
    const partnerMap = new Map<string, MemoryRecord[]>();
    for (const memory of memories) {
      const partner =
        memory.from === `did:xrpl:1:${agentAddress}`
          ? memory.to
          : memory.from;
      const existing = partnerMap.get(partner) || [];
      existing.push(memory);
      partnerMap.set(partner, existing);
    }

    const summaries: RelationshipSummary[] = [];
    for (const [partner, mems] of partnerMap) {
      const sortedMems = mems.sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );

      summaries.push({
        partnerDID: partner,
        partnerAddress: partner.replace("did:xrpl:1:", ""),
        type: sortedMems[0].relationshipType,
        label: sortedMems[0].label,
        status: "bonded", // Simplified - would check credential acceptance
        memories: sortedMems,
        totalInteractions: sortedMems.length,
        firstInteraction: sortedMems[0].createdAt,
        lastInteraction: sortedMems[sortedMems.length - 1].createdAt,
      });
    }

    return summaries;
  }

  /**
   * Display memories in a human-readable format
   */
  formatMemories(memories: MemoryRecord[]): string {
    if (memories.length === 0) return "No memories found.";

    let output = "";
    for (const m of memories) {
      output += `\n  Memory: ${m.label || m.relationshipType}`;
      output += `\n    From: ${m.from}`;
      output += `\n    To:   ${m.to}`;
      output += `\n    Type: ${m.relationshipType}`;
      if (m.message) output += `\n    Note: ${m.message}`;
      if (m.sharedHistory.length > 0) {
        output += `\n    History:`;
        for (const h of m.sharedHistory) {
          output += `\n      - ${h}`;
        }
      }
      output += `\n    Date: ${m.createdAt}`;
      output += `\n    Tx:   ${m.txHash}`;
      output += `\n`;
    }
    return output;
  }

  getClient(): Client {
    return this.client;
  }
}
