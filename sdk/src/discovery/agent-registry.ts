/**
 * XAIP Agent Registry
 *
 * An in-memory registry that indexes XAIP agents from on-chain data.
 * Agents register themselves, and other agents can search by:
 * - Capability (what can you do?)
 * - Trust score (how reliable are you?)
 * - Status (are you available?)
 * - Price (how much do you charge?)
 *
 * In production, this would be backed by a persistent store
 * and synchronized with on-chain events.
 */

import { Client } from "xrpl";
import { XRPLNetwork, XRPL_NETWORKS, AgentCard } from "../types";
import { hexToString } from "../utils/hex";

export interface RegisteredAgent {
  did: string;
  address: string;
  name: string;
  description: string;
  capabilities: string[];
  autonomyLevel: number;
  trustScore: number;
  status: "available" | "busy" | "offline" | "retired";
  pricing: Record<string, { unit: string; priceXRP: number }>;
  endpoints: Record<string, string>;
  model?: { provider: string; family: string };
  registeredAt: string;
  lastSeen: string;
}

export interface SearchFilters {
  capability?: string;
  minTrustScore?: number;
  maxPriceXRP?: number;
  status?: string;
  modelProvider?: string;
  sortBy?: "trustScore" | "price" | "name";
  limit?: number;
}

export interface SearchResult {
  agents: RegisteredAgent[];
  total: number;
  filters: SearchFilters;
}

export class AgentRegistry {
  private agents: Map<string, RegisteredAgent> = new Map();
  private client: Client;
  private network: XRPLNetwork;

  constructor(config: { network: XRPLNetwork; serverUrl?: string }) {
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
   * Register an agent in the registry
   */
  register(agent: RegisteredAgent): void {
    this.agents.set(agent.address, {
      ...agent,
      lastSeen: new Date().toISOString(),
    });
  }

  /**
   * Register an agent from an AgentCard
   */
  registerFromCard(card: AgentCard, trustScore: number = 0): void {
    const address = card.id.replace("did:xrpl:1:", "");
    const pricing: Record<string, { unit: string; priceXRP: number }> = {};

    this.register({
      did: card.id,
      address,
      name: card.agent.name,
      description: card.agent.description,
      capabilities: card.capabilities.map((c) => c.id.replace("cap:", "")),
      autonomyLevel: card.autonomyLevel,
      trustScore,
      status: "available",
      pricing,
      endpoints: card.endpoints as Record<string, string>,
      model: card.agent.model
        ? { provider: card.agent.model.provider, family: card.agent.model.family }
        : undefined,
      registeredAt: card.agent.created,
      lastSeen: new Date().toISOString(),
    });
  }

  /**
   * Discover an agent from on-chain DID and register it
   */
  async discoverAndRegister(address: string, trustScore: number = 0): Promise<RegisteredAgent | null> {
    await this.connect();

    try {
      const response = await this.client.request({
        command: "ledger_entry",
        did: address,
      } as any);

      const node = (response.result as any).node;
      if (!node) return null;

      const data = node.Data ? hexToString(node.Data) : "";
      if (!data.startsWith("XAIP/")) return null;

      const uri = node.URI ? hexToString(node.URI) : "";

      // Create a minimal registered agent from on-chain data
      const agent: RegisteredAgent = {
        did: `did:xrpl:1:${address}`,
        address,
        name: `Agent-${address.substring(0, 8)}`,
        description: "XAIP agent discovered from on-chain DID",
        capabilities: [],
        autonomyLevel: 1,
        trustScore,
        status: "available",
        pricing: {},
        endpoints: uri ? { cardUri: uri } : {},
        registeredAt: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
      };

      // Try to find capabilities from credentials
      try {
        const txResponse: any = await this.client.request({
          command: "account_tx",
          account: address,
          ledger_index_min: -1,
          ledger_index_max: -1,
          limit: 100,
        });

        const txs = txResponse.result?.transactions || [];
        for (const txEntry of txs) {
          const tx = txEntry.tx_json || txEntry.tx || {};
          if (tx.TransactionType === "CredentialAccept" ||
              (tx.TransactionType === "CredentialCreate" && tx.Subject === address)) {
            try {
              const credType = tx.CredentialType ? hexToString(tx.CredentialType) : "";
              if (credType.includes("Capability:")) {
                const cap = credType.split("Capability:")[1];
                if (cap && !agent.capabilities.includes(cap)) {
                  agent.capabilities.push(cap);
                }
              }
            } catch {}
          }
        }
      } catch {}

      this.agents.set(address, agent);
      return agent;
    } catch {
      return null;
    }
  }

  /**
   * Search for agents matching criteria
   */
  search(filters: SearchFilters = {}): SearchResult {
    let results = Array.from(this.agents.values());

    // Filter by capability
    if (filters.capability) {
      const cap = filters.capability.toLowerCase();
      results = results.filter((a) =>
        a.capabilities.some((c) => c.toLowerCase().includes(cap))
      );
    }

    // Filter by minimum trust score
    if (filters.minTrustScore !== undefined) {
      results = results.filter((a) => a.trustScore >= filters.minTrustScore!);
    }

    // Filter by status
    if (filters.status) {
      results = results.filter((a) => a.status === filters.status);
    }

    // Filter by model provider
    if (filters.modelProvider) {
      results = results.filter(
        (a) =>
          a.model?.provider?.toLowerCase() ===
          filters.modelProvider!.toLowerCase()
      );
    }

    // Sort
    const sortBy = filters.sortBy ?? "trustScore";
    results.sort((a, b) => {
      if (sortBy === "trustScore") return b.trustScore - a.trustScore;
      if (sortBy === "name") return a.name.localeCompare(b.name);
      return 0;
    });

    // Limit
    const total = results.length;
    if (filters.limit) {
      results = results.slice(0, filters.limit);
    }

    return { agents: results, total, filters };
  }

  /**
   * Get a specific agent by address
   */
  get(address: string): RegisteredAgent | undefined {
    return this.agents.get(address);
  }

  /**
   * Update agent status
   */
  updateStatus(address: string, status: RegisteredAgent["status"]): void {
    const agent = this.agents.get(address);
    if (agent) {
      agent.status = status;
      agent.lastSeen = new Date().toISOString();
    }
  }

  /**
   * Remove an agent from the registry
   */
  unregister(address: string): boolean {
    return this.agents.delete(address);
  }

  /**
   * Get total number of registered agents
   */
  count(): number {
    return this.agents.size;
  }

  /**
   * Generate .well-known/xaip.json content
   */
  generateWellKnown(): object {
    const agents = Array.from(this.agents.values()).map((a) => ({
      did: a.did,
      name: a.name,
      description: a.description,
      capabilities: a.capabilities,
      autonomyLevel: a.autonomyLevel,
      trustScore: a.trustScore,
      pricing: a.pricing,
      endpoints: a.endpoints,
      status: a.status,
      model: a.model,
    }));

    return {
      xaipVersion: "0.1",
      chainId: `xrpl:${this.network}`,
      documentation: "https://github.com/xkumakichi/xaip-protocol",
      agents,
    };
  }

  getClient(): Client {
    return this.client;
  }
}
