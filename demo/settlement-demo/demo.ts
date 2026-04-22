/**
 * XAIP v0.5 Settlement-Class Demo
 *
 * Demonstrates the settlement-class receipt pattern:
 *
 *   1. A fresh throwaway wallet is created on XRPL testnet (auto-funded from faucet).
 *   2. A self-transfer of 1 drop is executed as the "tool call".
 *   3. An XAIP execution receipt is built with toolMetadata.xaip = {
 *        class: "settlement",
 *        settlementLayer: "xrpl-testnet",
 *        verifiabilityHint: "anchored",
 *        anchorTxHash: "<tx hash on XRPL>"
 *      }
 *   4. The receipt is canonicalized (JCS, v0.5 — toolMetadata is INSIDE the signed payload)
 *      and signed by both the agent (tool) and caller keys.
 *   5. The signed receipt is written to out/receipt-<timestamp>.json.
 *   6. The XRPL explorer URL is printed so anyone can independently verify
 *      that the anchor transaction exists.
 *
 * Everything is testnet: no real funds are involved.
 *
 * Note: This demo does NOT post the receipt to the live aggregator. The
 * production aggregator implements v0.4 schema, which does not yet include
 * toolMetadata in its signed payload. Aggregator v0.5 support is a separate
 * work item; this demo is the concrete illustration of the receipt shape.
 *
 * Run:
 *   cd demo/settlement-demo
 *   npm install
 *   npx tsx demo.ts
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { Client, Wallet, xrpToDrops } from "xrpl";

const XRPL_TESTNET = "wss://s.altnet.rippletest.net:51233";
const OUT_DIR = path.join(__dirname, "out");

// ─── Types ───────────────────────────────────────────────────────────────────

interface KeyPair {
  did: string;
  publicKey: string;
  privateKey: string;
}

interface XaipClassMetadata {
  class: "settlement";
  settlementLayer: string;
  verifiabilityHint: "anchored" | "attestable" | "none";
  anchorTxHash: string;
  anchorLedgerIndex: number;
}

interface ReceiptV05 {
  agentDid: string;
  callerDid: string;
  toolName: string;
  taskHash: string;
  resultHash: string;
  success: boolean;
  latencyMs: number;
  timestamp: string;
  toolMetadata: {
    xaip: XaipClassMetadata;
  };
}

interface SignedReceipt extends ReceiptV05 {
  signature: string;
  callerSignature: string;
  agentPublicKey: string;
  callerPublicKey: string;
}

// ─── Crypto: did:key Ed25519 ─────────────────────────────────────────────────

function generateDidKey(): KeyPair {
  const pair = crypto.generateKeyPairSync("ed25519");
  const pubDer = pair.publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const privDer = pair.privateKey.export({ type: "pkcs8", format: "der" }) as Buffer;
  const raw = pubDer.subarray(pubDer.length - 32);
  return {
    did: `did:key:${raw.toString("hex")}`,
    publicKey: pubDer.toString("hex"),
    privateKey: privDer.toString("hex"),
  };
}

function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!isFinite(value)) throw new Error("JCS: non-finite number");
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const pairs = keys.map(
    (k) =>
      JSON.stringify(k) +
      ":" +
      canonicalize((value as Record<string, unknown>)[k])
  );
  return "{" + pairs.join(",") + "}";
}

function sign(payload: string, privateKeyHex: string): string {
  const key = crypto.createPrivateKey({
    key: Buffer.from(privateKeyHex, "hex"),
    format: "der",
    type: "pkcs8",
  });
  return crypto.sign(null, Buffer.from(payload), key).toString("hex");
}

function sha256short(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

// ─── XRPL Settlement Operation ────────────────────────────────────────────────

async function executeSettlement(): Promise<{
  sourceWallet: Wallet;
  destinationAddress: string;
  txHash: string;
  ledgerIndex: number;
  latencyMs: number;
  rawResult: unknown;
}> {
  console.log("Connecting to XRPL testnet...");
  const client = new Client(XRPL_TESTNET);
  await client.connect();

  try {
    console.log("Requesting two testnet wallets from faucet (no real funds)...");
    const [source, destination] = await Promise.all([
      client.fundWallet(),
      client.fundWallet(),
    ]);
    console.log(`  Source:      ${source.wallet.address} (${source.balance} XRP testnet)`);
    console.log(`  Destination: ${destination.wallet.address} (${destination.balance} XRP testnet)`);
    console.log("");

    const start = Date.now();
    console.log("Submitting 1-drop Payment as settlement tool call...");
    const prepared = await client.autofill({
      TransactionType: "Payment",
      Account: source.wallet.address,
      Destination: destination.wallet.address,
      Amount: xrpToDrops("0.000001"), // 1 drop
    });
    const signed = source.wallet.sign(prepared);
    const result = await client.submitAndWait(signed.tx_blob);
    const latencyMs = Date.now() - start;

    const meta = result.result.meta;
    const txResult =
      typeof meta === "object" && meta !== null && "TransactionResult" in meta
        ? (meta as { TransactionResult: string }).TransactionResult
        : "unknown";

    if (txResult !== "tesSUCCESS") {
      throw new Error(`Settlement tx failed: ${txResult}`);
    }

    const txHash = result.result.hash;
    const ledgerIndex = result.result.ledger_index as number;

    console.log(`  tesSUCCESS — anchored in ${latencyMs}ms`);
    console.log(`  tx hash:       ${txHash}`);
    console.log(`  ledger index:  ${ledgerIndex}`);
    console.log("");

    return {
      sourceWallet: source.wallet,
      destinationAddress: destination.wallet.address,
      txHash,
      ledgerIndex,
      latencyMs,
      rawResult: result.result,
    };
  } finally {
    await client.disconnect();
  }
}

// ─── Receipt Construction ─────────────────────────────────────────────────────

function buildReceipt(params: {
  agent: KeyPair;
  caller: KeyPair;
  txHash: string;
  ledgerIndex: number;
  latencyMs: number;
  sourceAddress: string;
  destinationAddress: string;
  rawResult: unknown;
}): SignedReceipt {
  const taskInput = {
    operation: "xrp-transfer",
    source: params.sourceAddress,
    destination: params.destinationAddress,
    amountDrops: "1",
  };

  const receipt: ReceiptV05 = {
    agentDid: params.agent.did,
    callerDid: params.caller.did,
    toolName: "settlement-demo/xrp-transfer",
    taskHash: sha256short(JSON.stringify(taskInput)),
    resultHash: sha256short(JSON.stringify(params.rawResult)),
    success: true,
    latencyMs: params.latencyMs,
    timestamp: new Date().toISOString(),
    toolMetadata: {
      xaip: {
        class: "settlement",
        settlementLayer: "xrpl-testnet",
        verifiabilityHint: "anchored",
        anchorTxHash: params.txHash,
        anchorLedgerIndex: params.ledgerIndex,
      },
    },
  };

  // v0.5: toolMetadata is part of the signed payload. A tool cannot silently
  // alter its declared class between call and aggregation because the hash
  // would no longer verify.
  const payload = canonicalize(receipt);
  const agentSignature = sign(payload, params.agent.privateKey);
  const callerSignature = sign(payload, params.caller.privateKey);

  return {
    ...receipt,
    signature: agentSignature,
    callerSignature,
    agentPublicKey: params.agent.publicKey,
    callerPublicKey: params.caller.publicKey,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  XAIP v0.5 Settlement-Class Demo (XRPL Testnet)");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("");

  // Fresh keys per run — these are throwaway
  const agent = generateDidKey();
  const caller = generateDidKey();
  console.log(`Agent DID:  ${agent.did.slice(0, 40)}...`);
  console.log(`Caller DID: ${caller.did.slice(0, 40)}...`);
  console.log("");

  const settlement = await executeSettlement();

  const signed = buildReceipt({
    agent,
    caller,
    txHash: settlement.txHash,
    ledgerIndex: settlement.ledgerIndex,
    latencyMs: settlement.latencyMs,
    sourceAddress: settlement.sourceWallet.address,
    destinationAddress: settlement.destinationAddress,
    rawResult: settlement.rawResult,
  });

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(
    OUT_DIR,
    `receipt-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  );
  fs.writeFileSync(outFile, JSON.stringify(signed, null, 2));

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Signed receipt written:");
  console.log(`    ${path.relative(process.cwd(), outFile)}`);
  console.log("");
  console.log("  Independently verify the anchor on XRPL testnet:");
  console.log(`    https://testnet.xrpl.org/transactions/${settlement.txHash}`);
  console.log("");
  console.log("  Receipt fields (summary):");
  console.log(`    toolName:            ${signed.toolName}`);
  console.log(`    class:               ${signed.toolMetadata.xaip.class}`);
  console.log(`    settlementLayer:     ${signed.toolMetadata.xaip.settlementLayer}`);
  console.log(`    verifiabilityHint:   ${signed.toolMetadata.xaip.verifiabilityHint}`);
  console.log(`    anchorTxHash:        ${signed.toolMetadata.xaip.anchorTxHash}`);
  console.log(`    anchorLedgerIndex:   ${signed.toolMetadata.xaip.anchorLedgerIndex}`);
  console.log("═══════════════════════════════════════════════════════════");
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
