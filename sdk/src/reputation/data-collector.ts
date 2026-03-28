/**
 * XAIP Reputation Data Collector
 *
 * Collects on-chain evidence to compute an agent's trust score.
 * All data comes from the XRPL ledger - nothing can be faked.
 *
 * Data sources:
 * - Transaction history (escrows, payments)
 * - Credential records (capabilities, endorsements)
 * - Account metadata (creation date, activity)
 */

import { Client } from "xrpl";
import { XRPLNetwork, XRPL_NETWORKS } from "../types";
import { hexToString } from "../utils/hex";

export interface AgentOnChainData {
  address: string;
  did: string | null;
  isXAIPAgent: boolean;

  // Account basics
  accountCreated: Date | null;
  balanceXRP: number;

  // Transaction stats
  totalTransactions: number;
  escrowsCreated: number;
  escrowsFinished: number; // successful completions
  escrowsCancelled: number; // failures
  paymentsReceived: number;
  paymentsSent: number;

  // Credential stats
  credentialsReceived: number;
  endorsementsReceived: number;
  capabilityCredentials: string[];

  // Activity patterns
  firstActivityDate: Date | null;
  lastActivityDate: Date | null;
  activeDays: number;
}

export class ReputationDataCollector {
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
   * Collect all on-chain data for an agent
   */
  async collectAgentData(address: string): Promise<AgentOnChainData> {
    await this.connect();

    // Fetch account info, DID, and transactions in parallel where possible
    const [accountInfo, didInfo, transactions] = await Promise.all([
      this.getAccountInfo(address),
      this.getDIDInfo(address),
      this.getTransactionHistory(address),
    ]);

    // Analyze transactions
    const txAnalysis = this.analyzeTransactions(transactions, address);

    // Count credentials from transaction history
    const credAnalysis = this.analyzeCredentials(transactions, address);

    // Calculate activity patterns
    const activityAnalysis = this.analyzeActivity(transactions);

    return {
      address,
      did: didInfo.did,
      isXAIPAgent: didInfo.isXAIP,

      accountCreated: accountInfo.created,
      balanceXRP: accountInfo.balanceXRP,

      totalTransactions: transactions.length,
      escrowsCreated: txAnalysis.escrowsCreated,
      escrowsFinished: txAnalysis.escrowsFinished,
      escrowsCancelled: txAnalysis.escrowsCancelled,
      paymentsReceived: txAnalysis.paymentsReceived,
      paymentsSent: txAnalysis.paymentsSent,

      credentialsReceived: credAnalysis.credentialsReceived,
      endorsementsReceived: credAnalysis.endorsementsReceived,
      capabilityCredentials: credAnalysis.capabilities,

      firstActivityDate: activityAnalysis.firstDate,
      lastActivityDate: activityAnalysis.lastDate,
      activeDays: activityAnalysis.activeDays,
    };
  }

  private async getAccountInfo(
    address: string
  ): Promise<{ balanceXRP: number; created: Date | null }> {
    try {
      const response = await this.client.request({
        command: "account_info",
        account: address,
        ledger_index: "validated",
      });

      const data = response.result.account_data;
      return {
        balanceXRP: Number(data.Balance) / 1_000_000,
        created: null, // XRPL doesn't store exact creation date in account_info
      };
    } catch {
      return { balanceXRP: 0, created: null };
    }
  }

  private async getDIDInfo(
    address: string
  ): Promise<{ did: string | null; isXAIP: boolean }> {
    try {
      const response = await this.client.request({
        command: "ledger_entry",
        did: address,
      } as any);

      const node = (response.result as any).node;
      if (!node) return { did: null, isXAIP: false };

      const data = node.Data ? hexToString(node.Data) : "";
      return {
        did: `did:xrpl:1:${address}`,
        isXAIP: data.startsWith("XAIP/"),
      };
    } catch {
      return { did: null, isXAIP: false };
    }
  }

  private async getTransactionHistory(address: string): Promise<any[]> {
    const allTransactions: any[] = [];
    let marker: any = undefined;
    const maxPages = 5; // Limit to prevent excessive API calls
    let page = 0;

    while (page < maxPages) {
      const response: any = await this.client.request({
        command: "account_tx",
        account: address,
        ledger_index_min: -1,
        ledger_index_max: -1,
        limit: 200,
        marker,
      });

      const txs = response.result.transactions || [];
      allTransactions.push(...txs);

      marker = response.result.marker;
      if (!marker) break;
      page++;
    }

    return allTransactions;
  }

  private analyzeTransactions(
    transactions: any[],
    address: string
  ): {
    escrowsCreated: number;
    escrowsFinished: number;
    escrowsCancelled: number;
    paymentsReceived: number;
    paymentsSent: number;
  } {
    let escrowsCreated = 0;
    let escrowsFinished = 0;
    let escrowsCancelled = 0;
    let paymentsReceived = 0;
    let paymentsSent = 0;

    for (const txEntry of transactions) {
      const tx = txEntry.tx_json || txEntry.tx || {};
      const type = tx.TransactionType;

      switch (type) {
        case "EscrowCreate":
          if (tx.Account === address) escrowsCreated++;
          break;
        case "EscrowFinish":
          escrowsFinished++;
          break;
        case "EscrowCancel":
          escrowsCancelled++;
          break;
        case "Payment":
          if (tx.Account === address) paymentsSent++;
          if (tx.Destination === address) paymentsReceived++;
          break;
      }
    }

    return {
      escrowsCreated,
      escrowsFinished,
      escrowsCancelled,
      paymentsReceived,
      paymentsSent,
    };
  }

  private analyzeCredentials(
    transactions: any[],
    address: string
  ): {
    credentialsReceived: number;
    endorsementsReceived: number;
    capabilities: string[];
  } {
    let credentialsReceived = 0;
    let endorsementsReceived = 0;
    const capabilities: string[] = [];

    for (const txEntry of transactions) {
      const tx = txEntry.tx_json || txEntry.tx || {};
      const type = tx.TransactionType;

      if (type === "CredentialCreate" && tx.Subject === address) {
        credentialsReceived++;

        try {
          const credType = tx.CredentialType
            ? hexToString(tx.CredentialType)
            : "";

          if (credType.includes("Endorsement")) {
            endorsementsReceived++;
          } else if (credType.includes("Capability")) {
            const cap = credType.replace("XAIP:Capability:", "");
            if (cap && !capabilities.includes(cap)) {
              capabilities.push(cap);
            }
          }
        } catch {
          // Skip malformed credential types
        }
      }
    }

    return { credentialsReceived, endorsementsReceived, capabilities };
  }

  private analyzeActivity(
    transactions: any[]
  ): {
    firstDate: Date | null;
    lastDate: Date | null;
    activeDays: number;
  } {
    if (transactions.length === 0) {
      return { firstDate: null, lastDate: null, activeDays: 0 };
    }

    const rippleEpochOffset = 946684800;
    const uniqueDays = new Set<string>();
    let earliest = Infinity;
    let latest = 0;

    for (const txEntry of transactions) {
      const tx = txEntry.tx_json || txEntry.tx || {};
      const closeTime = txEntry.close_time_iso || txEntry.date;

      let timestamp: number;
      if (typeof closeTime === "string") {
        timestamp = new Date(closeTime).getTime() / 1000;
      } else if (typeof tx.date === "number") {
        timestamp = tx.date + rippleEpochOffset;
      } else {
        continue;
      }

      if (timestamp < earliest) earliest = timestamp;
      if (timestamp > latest) latest = timestamp;

      const day = new Date(timestamp * 1000).toISOString().split("T")[0];
      uniqueDays.add(day);
    }

    return {
      firstDate: earliest !== Infinity ? new Date(earliest * 1000) : null,
      lastDate: latest !== 0 ? new Date(latest * 1000) : null,
      activeDays: uniqueDays.size,
    };
  }

  getClient(): Client {
    return this.client;
  }
}
