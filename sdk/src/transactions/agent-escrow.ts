/**
 * XAIP Agent Escrow Manager
 * Handles escrow-based transactions between AI agents
 *
 * Flow:
 * 1. Client agent creates escrow (locks payment)
 * 2. Worker agent performs the work
 * 3. Client agent finishes escrow (releases payment)
 * 4. Both agents issue endorsement credentials
 */

import { Client, Wallet, xrpToDrops, dropsToXrp } from "xrpl";
import { XRPLNetwork, XRPL_NETWORKS } from "../types";
import { stringToHex } from "../utils/hex";

export interface EscrowConfig {
  network: XRPLNetwork;
  serverUrl?: string;
}

export interface CreateEscrowParams {
  clientWallet: Wallet;
  workerAddress: string;
  amountXRP: number;
  jobDescription: string;
  expirationSeconds?: number; // Default: 24 hours
}

export interface EscrowResult {
  txHash: string;
  sequence: number;
  clientAddress: string;
  workerAddress: string;
  amountXRP: number;
}

export class AgentEscrow {
  private client: Client;
  private network: XRPLNetwork;

  constructor(config: EscrowConfig) {
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
   * Create an escrow - client locks payment for a job
   * The payment is held by the ledger until finished or cancelled
   */
  async createEscrow(params: CreateEscrowParams): Promise<EscrowResult> {
    await this.connect();

    const expirationSeconds = params.expirationSeconds ?? 86400; // 24 hours
    const rippleEpochOffset = 946684800;
    const finishAfter = Math.floor(Date.now() / 1000) - rippleEpochOffset + 5; // 5 sec from now
    const cancelAfter = finishAfter + expirationSeconds;

    const jobMemo = {
      Memo: {
        MemoType: stringToHex("XAIP/Job"),
        MemoData: stringToHex(JSON.stringify({
          protocol: "XAIP/0.1",
          type: "escrow-job",
          description: params.jobDescription,
          createdAt: new Date().toISOString(),
        })),
      },
    };

    const tx: any = {
      TransactionType: "EscrowCreate",
      Account: params.clientWallet.address,
      Destination: params.workerAddress,
      Amount: xrpToDrops(params.amountXRP),
      FinishAfter: finishAfter,
      CancelAfter: cancelAfter,
      Memos: [jobMemo],
    };

    const prepared = await this.client.autofill(tx);
    const signed = params.clientWallet.sign(prepared);
    const result = await this.client.submitAndWait(signed.tx_blob);

    const sequence = (result.result as any).Sequence
      ?? prepared.Sequence
      ?? 0;

    return {
      txHash: typeof result.result.hash === "string" ? result.result.hash : "unknown",
      sequence,
      clientAddress: params.clientWallet.address,
      workerAddress: params.workerAddress,
      amountXRP: params.amountXRP,
    };
  }

  /**
   * Finish an escrow - release payment to the worker
   * Called by the client after the worker completes the job
   */
  async finishEscrow(
    finisherWallet: Wallet,
    escrowOwnerAddress: string,
    escrowSequence: number
  ): Promise<{ txHash: string }> {
    await this.connect();

    const tx: any = {
      TransactionType: "EscrowFinish",
      Account: finisherWallet.address,
      Owner: escrowOwnerAddress,
      OfferSequence: escrowSequence,
    };

    const prepared = await this.client.autofill(tx);
    const signed = finisherWallet.sign(prepared);
    const result = await this.client.submitAndWait(signed.tx_blob);

    return {
      txHash: typeof result.result.hash === "string" ? result.result.hash : "unknown",
    };
  }

  /**
   * Cancel an escrow - return payment to the client
   * Can only be done after the CancelAfter time
   */
  async cancelEscrow(
    cancellerWallet: Wallet,
    escrowOwnerAddress: string,
    escrowSequence: number
  ): Promise<{ txHash: string }> {
    await this.connect();

    const tx: any = {
      TransactionType: "EscrowCancel",
      Account: cancellerWallet.address,
      Owner: escrowOwnerAddress,
      OfferSequence: escrowSequence,
    };

    const prepared = await this.client.autofill(tx);
    const signed = cancellerWallet.sign(prepared);
    const result = await this.client.submitAndWait(signed.tx_blob);

    return {
      txHash: typeof result.result.hash === "string" ? result.result.hash : "unknown",
    };
  }

  getClient(): Client {
    return this.client;
  }
}
