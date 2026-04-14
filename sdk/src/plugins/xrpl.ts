/**
 * XAIP XRPL Plugin — DID registration, score anchoring, escrow settlement.
 *
 * Requires `xrpl` package: npm install xrpl
 *
 * Usage:
 *   import { xrplPlugin } from "xaip-sdk/plugins/xrpl";
 *   await withXAIP(server, {
 *     did: "did:xrpl:rAddress...",
 *     plugins: [xrplPlugin({ network: "testnet", wallet })]
 *   });
 */

import { XAIPPlugin, XAIP_PROTOCOL_ID } from "../types";
import { computeQueryResult } from "../score";
import * as crypto from "crypto";

export interface XRPLPluginConfig {
  network?: "mainnet" | "testnet" | "devnet";
  /** XRPL wallet (from xrpl.Wallet). Must have `seed` or `privateKey`. */
  wallet?: any;
  /** Anchor score hashes to XRPL memo on each query. Default: false */
  anchorScores?: boolean;
}

const NETWORKS: Record<string, string> = {
  mainnet: "wss://xrplcluster.com",
  testnet: "wss://s.altnet.rippletest.net:51233",
  devnet: "wss://s.devnet.rippletest.net:51233",
};

function stringToHex(str: string): string {
  return Buffer.from(str, "utf-8").toString("hex").toUpperCase();
}

function hexToString(hex: string): string {
  return Buffer.from(hex, "hex").toString("utf-8");
}

export function xrplPlugin(config: XRPLPluginConfig): XAIPPlugin {
  return {
    name: "xrpl",
    async init(ctx) {
      // Dynamic import — xrpl is optional
      let xrpl: any;
      try {
        xrpl = require("xrpl");
      } catch {
        throw new Error(
          "xrpl package not installed. Run: npm install xrpl"
        );
      }

      const networkUrl =
        NETWORKS[config.network ?? "testnet"];
      const client = new xrpl.Client(networkUrl);
      await client.connect();

      try {
        // ─── Register DID ────────────────────────────

        if (config.wallet) {
          const wallet = config.wallet;
          const address = wallet.classicAddress || wallet.address;

          // Check if DID already exists
          let existing = false;
          try {
            const entry = await client.request({
              command: "ledger_entry",
              did: address,
            } as any);
            existing = !!entry?.result?.node;
          } catch {
            // entryNotFound — no DID yet
          }

          if (!existing) {
            const tx = {
              TransactionType: "DIDSet",
              Account: address,
              Data: stringToHex(XAIP_PROTOCOL_ID),
              URI: stringToHex(`xaip:${ctx.did.id}`),
            };
            const prepared = await client.autofill(tx);
            const signed = wallet.sign(prepared);
            const result = await client.submitAndWait(signed.tx_blob);

            const txResult =
              (result.result as any)?.meta?.TransactionResult;
            if (txResult === "tesSUCCESS") {
              console.error(
                `[xaip:xrpl] DID registered: ${address}`
              );
            } else {
              console.error(
                `[xaip:xrpl] DID registration failed: ${txResult}`
              );
            }
          } else {
            console.error(
              `[xaip:xrpl] DID already exists: ${address}`
            );
          }

          // ─── Score Anchoring ─────────────────────────

          if (config.anchorScores) {
            const receipts = await ctx.store.getReceipts(ctx.did.id);
            const queryResult = computeQueryResult(receipts, ctx.did);

            const scoreHash = crypto
              .createHash("sha256")
              .update(JSON.stringify(queryResult.score))
              .digest("hex");

            const anchorTx = {
              TransactionType: "Payment",
              Account: address,
              Destination: address,
              Amount: "1", // 1 drop (minimum)
              Memos: [
                {
                  Memo: {
                    MemoType: stringToHex("XAIP/ScoreAnchor"),
                    MemoData: stringToHex(
                      JSON.stringify({
                        did: ctx.did.id,
                        scoreHash,
                        overall: queryResult.score.overall,
                        trust: queryResult.trust,
                        timestamp: new Date().toISOString(),
                      })
                    ),
                  },
                },
              ],
            };
            const preparedAnchor = await client.autofill(anchorTx);
            const signedAnchor = wallet.sign(preparedAnchor);
            const anchorResult = await client.submitAndWait(
              signedAnchor.tx_blob
            );

            const anchorTxResult =
              (anchorResult.result as any)?.meta?.TransactionResult;
            if (anchorTxResult === "tesSUCCESS") {
              console.error(
                `[xaip:xrpl] Score anchored (hash: ${scoreHash.slice(0, 16)}...)`
              );
            }
          }
        }
      } finally {
        await client.disconnect();
      }
    },
  };
}

// ─── Standalone utilities ──────────────────────────────

/** Resolve an XAIP DID from XRPL. Returns null if not found. */
export async function resolveXRPLDID(
  address: string,
  network: string = "testnet"
): Promise<{ did: string; uri: string; data: string } | null> {
  let xrpl: any;
  try {
    xrpl = require("xrpl");
  } catch {
    throw new Error("xrpl package not installed. Run: npm install xrpl");
  }

  const client = new xrpl.Client(NETWORKS[network]);
  await client.connect();

  try {
    const result = await client.request({
      command: "ledger_entry",
      did: address,
    } as any);

    const node = (result.result as any)?.node;
    if (!node) return null;

    return {
      did: `did:xrpl:${address}`,
      uri: node.URI ? hexToString(node.URI) : "",
      data: node.Data ? hexToString(node.Data) : "",
    };
  } catch {
    return null;
  } finally {
    await client.disconnect();
  }
}
