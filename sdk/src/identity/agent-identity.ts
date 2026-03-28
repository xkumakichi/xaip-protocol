/**
 * XAIP Agent Identity Manager
 * Handles creating and managing AI agent identities on XRPL
 */

import {
  Client,
  Wallet,
  DIDSet,
  DIDDelete,
  convertStringToHex,
} from "xrpl";
import {
  AgentCard,
  XRPLNetwork,
  XRPL_NETWORKS,
  XAIP_PROTOCOL_ID_HEX,
} from "../types";
import { stringToHex } from "../utils/hex";

export interface AgentIdentityConfig {
  network: XRPLNetwork;
  serverUrl?: string; // Override default network URL
}

export interface CreateAgentResult {
  did: string;
  xrplAddress: string;
  wallet: Wallet;
  txHash: string;
  agentCard: AgentCard;
}

export interface FundTestnetResult {
  wallet: Wallet;
  address: string;
  balance: string;
}

export class AgentIdentity {
  private client: Client;
  private network: XRPLNetwork;

  constructor(config: AgentIdentityConfig) {
    this.network = config.network;
    const url = config.serverUrl ?? XRPL_NETWORKS[config.network];
    this.client = new Client(url);
  }

  /**
   * Connect to the XRPL network
   */
  async connect(): Promise<void> {
    if (!this.client.isConnected()) {
      await this.client.connect();
    }
  }

  /**
   * Disconnect from the XRPL network
   */
  async disconnect(): Promise<void> {
    if (this.client.isConnected()) {
      await this.client.disconnect();
    }
  }

  /**
   * Create a funded wallet on testnet/devnet (for development)
   * This uses the XRPL faucet to get test XRP
   */
  async createTestWallet(): Promise<FundTestnetResult> {
    if (this.network === "mainnet") {
      throw new Error("Cannot use faucet on mainnet. Fund your wallet manually.");
    }

    await this.connect();
    const fundResult = await this.client.fundWallet();
    const wallet = fundResult.wallet;

    return {
      wallet,
      address: wallet.address,
      balance: `${fundResult.balance} XRP`,
    };
  }

  /**
   * Register an AI agent's DID on the XRP Ledger
   *
   * @param wallet - The agent's XRPL wallet
   * @param agentCardUri - URI pointing to the Agent Card (IPFS or HTTPS)
   * @returns Transaction result
   */
  async registerAgentDID(
    wallet: Wallet,
    agentCardUri: string
  ): Promise<{ txHash: string; did: string }> {
    await this.connect();

    const uriHex = stringToHex(agentCardUri);

    const didSetTx: DIDSet = {
      TransactionType: "DIDSet",
      Account: wallet.address,
      URI: uriHex,
      Data: XAIP_PROTOCOL_ID_HEX,
    };

    const prepared = await this.client.autofill(didSetTx);
    const signed = wallet.sign(prepared);
    const result = await this.client.submitAndWait(signed.tx_blob);

    const txHash =
      typeof result.result.hash === "string"
        ? result.result.hash
        : "unknown";

    return {
      txHash,
      did: `did:xrpl:1:${wallet.address}`,
    };
  }

  /**
   * Update an agent's DID (e.g., new Agent Card URI)
   */
  async updateAgentDID(
    wallet: Wallet,
    newUri?: string,
    newData?: string
  ): Promise<{ txHash: string }> {
    await this.connect();

    const didSetTx: DIDSet = {
      TransactionType: "DIDSet",
      Account: wallet.address,
    };

    if (newUri) {
      didSetTx.URI = stringToHex(newUri);
    }
    if (newData) {
      didSetTx.Data = stringToHex(newData);
    }

    const prepared = await this.client.autofill(didSetTx);
    const signed = wallet.sign(prepared);
    const result = await this.client.submitAndWait(signed.tx_blob);

    return {
      txHash:
        typeof result.result.hash === "string"
          ? result.result.hash
          : "unknown",
    };
  }

  /**
   * Delete an agent's DID from the ledger
   */
  async deleteAgentDID(wallet: Wallet): Promise<{ txHash: string }> {
    await this.connect();

    const didDeleteTx: DIDDelete = {
      TransactionType: "DIDDelete",
      Account: wallet.address,
    };

    const prepared = await this.client.autofill(didDeleteTx);
    const signed = wallet.sign(prepared);
    const result = await this.client.submitAndWait(signed.tx_blob);

    return {
      txHash:
        typeof result.result.hash === "string"
          ? result.result.hash
          : "unknown",
    };
  }

  /**
   * Resolve an agent's DID - fetch the DID object from the ledger
   */
  async resolveAgentDID(
    address: string
  ): Promise<{ uri: string; data: string; did: string } | null> {
    await this.connect();

    try {
      const response = await this.client.request({
        command: "ledger_entry",
        did: address,
      } as any);

      const node = (response.result as any).node;
      if (!node) return null;

      return {
        did: `did:xrpl:1:${address}`,
        uri: node.URI
          ? Buffer.from(node.URI, "hex").toString("utf-8")
          : "",
        data: node.Data
          ? Buffer.from(node.Data, "hex").toString("utf-8")
          : "",
      };
    } catch (error: any) {
      if (error.data?.error === "entryNotFound") {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get account info for an agent
   */
  async getAccountInfo(address: string): Promise<any> {
    await this.connect();

    const response = await this.client.request({
      command: "account_info",
      account: address,
      ledger_index: "validated",
    });

    return response.result.account_data;
  }

  /**
   * Get the underlying XRPL client (for advanced operations)
   */
  getClient(): Client {
    return this.client;
  }
}
