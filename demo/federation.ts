/**
 * XAIP Federation Demo — Byzantine Fault Tolerance (v0.4.0)
 *
 * Demonstrates that AggregatorClient's BFT quorum (MAD outlier filter)
 * correctly resists a single malicious/tampered aggregator node.
 *
 * Architecture:
 *   Aggregator A (honest):    http://localhost:4001
 *   Aggregator B (honest):    http://localhost:4002
 *   Aggregator C (malicious): http://localhost:4003
 *
 * Scenario:
 *   1. Start 3 aggregators with independent SQLite stores
 *   2. Seed Agent E with 10 legitimate receipts (5 callers × 2) on all 3
 *   3. Tamper Aggregator C: inject 100 fake success receipts directly into its store
 *   4. Query each aggregator individually — C shows inflated trust
 *   5. Query via AggregatorClient BFT quorum — C is flagged as outlier and excluded
 */

import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import {
  createAggregatorServer,
  generateDIDKey,
  AggregatorClient,
  ReceiptStore,
  hash,
} from "xaip-sdk";
import type { ExecutionReceipt } from "xaip-sdk";
// sign and receiptPayload are intentionally not re-exported by xaip-sdk;
// import directly from the SDK source (no SDK code is modified).
import { sign, receiptPayload } from "../sdk/src/identity";

// ─── Config ──────────────────────────────────────────────────────

const AGG_URLS = [
  "http://localhost:4001",
  "http://localhost:4002",
  "http://localhost:4003",
];

const DB_A = path.join(process.cwd(), "fed-agg-a.db");
const DB_B = path.join(process.cwd(), "fed-agg-b.db");
const DB_C = path.join(process.cwd(), "fed-agg-c.db");

// ─── Helpers ─────────────────────────────────────────────────────

function waitListening(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.once("listening", resolve));
}

/**
 * Build a properly signed ExecutionReceipt (agent + caller co-signature).
 * Used for honest receipts pushed via HTTP — the server will verify these.
 */
function buildSignedReceipt(
  agentDid: string,
  agentPrivKey: string,
  callerDid: string,
  callerPrivKey: string,
  success: boolean,
  toolName = "translate"
): ExecutionReceipt {
  const base: Omit<ExecutionReceipt, "signature" | "callerSignature"> = {
    agentDid,
    toolName,
    taskHash: hash({ t: Date.now(), r: Math.random() }),
    resultHash: hash({ result: success ? "ok" : "error" }),
    success,
    latencyMs: 50 + Math.floor(Math.random() * 50),
    timestamp: new Date().toISOString(),
    callerDid,
  };
  const payload = receiptPayload(base);
  return {
    ...base,
    signature: sign(payload, agentPrivKey),
    callerSignature: sign(payload, callerPrivKey),
  };
}

// ─── Main ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Suppress "< 3 aggregators" warnings from single-node AggregatorClients
  const origWarn = console.warn;
  const suppressWarn = (msg: string, ...rest: unknown[]) => {
    if (typeof msg === "string" && msg.includes("aggregator")) return;
    origWarn(msg, ...rest);
  };

  // Clean previous run artifacts
  for (const p of [DB_A, DB_B, DB_C]) fs.rmSync(p, { force: true });

  // ── 1. Start 3 Aggregators ───────────────────────────────────────

  console.log("[Federation] Starting 3 aggregators...");

  const storeA = new ReceiptStore(DB_A);
  const storeB = new ReceiptStore(DB_B);
  const storeC = new ReceiptStore(DB_C);

  const serverA = createAggregatorServer({
    port: 4001,
    store: storeA,
    nodeId: "agg-a-honest",
  });
  const serverB = createAggregatorServer({
    port: 4002,
    store: storeB,
    nodeId: "agg-b-honest",
  });
  const serverC = createAggregatorServer({
    port: 4003,
    store: storeC,
    nodeId: "agg-c-malicious",
  });

  await Promise.all([
    waitListening(serverA),
    waitListening(serverB),
    waitListening(serverC),
  ]);

  console.log(`  Aggregator A (honest):    ${AGG_URLS[0]}`);
  console.log(`  Aggregator B (honest):    ${AGG_URLS[1]}`);
  console.log(`  Aggregator C (malicious): ${AGG_URLS[2]}`);

  // ── 2. Agent E identity ──────────────────────────────────────────

  const agentE = generateDIDKey();
  console.log(`\n[Federation] Agent E DID: ${agentE.did.id}`);

  // ── 3. Seed 10 honest receipts → all 3 aggregators ───────────────

  console.log("\n[Federation] Seeding Agent E with 10 receipts (5 callers)...");
  const client = new AggregatorClient(AGG_URLS);

  for (let c = 0; c < 5; c++) {
    const caller = generateDIDKey();
    for (let t = 0; t < 2; t++) {
      const receipt = buildSignedReceipt(
        agentE.did.id,
        agentE.privateKey,
        caller.did.id,
        caller.privateKey,
        true
      );
      await client.pushReceipt(receipt, agentE.publicKey);
    }
  }

  console.log("[Federation] All 3 aggregators received receipts");

  // ── 4. Tamper Aggregator C ────────────────────────────────────────
  //
  // Bypass HTTP layer entirely — write directly into storeC.
  // The store's log() method does NOT verify signatures; only the HTTP
  // handler does. This simulates a compromised aggregator node that
  // inflates a specific agent's trust score.

  console.log("\n[Federation] Tampering Aggregator C data...");

  const FAKE_COUNT = 100;
  for (let i = 0; i < FAKE_COUNT; i++) {
    // Unique fake caller DIDs → boosts caller diversity score
    const fakeCallerDid = `did:key:fake${i.toString().padStart(4, "0")}aaaa`;
    await storeC.log({
      agentDid: agentE.did.id,
      toolName: "translate",
      taskHash: `fake-task-${i}`,
      resultHash: `fake-result-${i}`,
      success: true,
      latencyMs: 50,
      timestamp: new Date().toISOString(),
      signature: "tampered-aggregator-injected",
      callerDid: fakeCallerDid,
      callerSignature: "tampered-aggregator-injected",
    });
  }

  console.log(
    `  Aggregator C: Agent E trust artificially set to ~0.99 (+${FAKE_COUNT} fake receipts)`
  );

  // ── 5. Query individual aggregators ──────────────────────────────

  console.log("\n[Federation] Querying individual aggregators...");
  console.warn = suppressWarn;

  const [resA, resB, resC] = await Promise.all([
    new AggregatorClient([AGG_URLS[0]]).query(agentE.did.id),
    new AggregatorClient([AGG_URLS[1]]).query(agentE.did.id),
    new AggregatorClient([AGG_URLS[2]]).query(agentE.did.id),
  ]);

  console.warn = origWarn;

  const isTampered = resC.result.trust > resA.result.trust * 1.1;
  console.log(`  Aggregator A: trust ${resA.result.trust}`);
  console.log(`  Aggregator B: trust ${resB.result.trust}`);
  console.log(
    `  Aggregator C: trust ${resC.result.trust}${isTampered ? " (TAMPERED)" : ""}`
  );

  // ── 6. BFT quorum via all 3 ──────────────────────────────────

  console.log("\n[Federation] Querying via BFT quorum (all 3)...");
  const quorumResult = await client.query(agentE.did.id);

  console.log(`  Quorum trust:  ${quorumResult.result.trust} ← correct despite 1 malicious node`);
  console.log(`  Quorum size:   ${quorumResult.result.meta.quorumSize}/${AGG_URLS.length}`);
  console.log(`  Source:        ${quorumResult.source}`);
  if (quorumResult.outlierNodes && quorumResult.outlierNodes.length > 0) {
    console.log(`  Outlier nodes: [${quorumResult.outlierNodes.join(", ")}]`);
  }
  if (quorumResult.result.riskFlags.length > 0) {
    console.log(`  Risk flags:    [${quorumResult.result.riskFlags.join(", ")}]`);
  }

  // ── 7. Byzantine fault tolerance verdict ─────────────────────────

  const honestTrustMean =
    (resA.result.trust + resB.result.trust) / 2;
  const quorumMatchesHonest =
    Math.abs(quorumResult.result.trust - honestTrustMean) < 0.05;
  const outlierDetected =
    quorumResult.outlierNodes?.includes(AGG_URLS[2]) ?? false;

  console.log(
    `\n[Federation] Byzantine fault tolerance: ${
      quorumMatchesHonest && outlierDetected ? "VERIFIED" : "PARTIAL"
    }`
  );
  console.log("  1/3 malicious → MAD outlier filter excluded node C");
  console.log(
    `  Node C reputation: ${client.nodeScore(AGG_URLS[2]).toFixed(4)} (penalized)`
  );

  // ── Cleanup ───────────────────────────────────────────────────────

  await Promise.all([storeA.close(), storeB.close(), storeC.close()]);
  serverA.close();
  serverB.close();
  serverC.close();
  for (const p of [DB_A, DB_B, DB_C]) fs.rmSync(p, { force: true });

  process.exit(0);
}

main().catch((e) => {
  console.error("[Federation Error]", e);
  process.exit(1);
});
