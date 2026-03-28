/**
 * XAIP Demo: Reputation Growth
 *
 * Shows how an AI agent's trust score grows over time
 * as it completes jobs and receives endorsements.
 *
 * 1. Create two agents
 * 2. Worker gets capability credential
 * 3. Complete multiple escrow jobs
 * 4. Watch reputation score grow after each job
 *
 * Run: npx ts-node examples/reputation-growth.ts
 */

import {
  AgentIdentity,
  AgentCredentials,
  AgentEscrow,
  ReputationDataCollector,
  ReputationScoreCalculator,
  CREDENTIAL_TYPES,
} from "../src";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printScore(label: string, breakdown: any) {
  const s = breakdown.score;
  const bar = (val: number) => {
    const filled = Math.round(val / 5);
    return "█".repeat(filled) + "░".repeat(20 - filled);
  };

  console.log(`\n  ┌─── ${label} ───`);
  console.log(`  │ OVERALL:     ${bar(s.overall)} ${s.overall}/100  ${breakdown.explanation.overall}`);
  console.log(`  │ Reliability: ${bar(s.reliability)} ${s.reliability}/100  ${breakdown.explanation.reliability}`);
  console.log(`  │ Quality:     ${bar(s.quality)} ${s.quality}/100  ${breakdown.explanation.quality}`);
  console.log(`  │ Consistency: ${bar(s.consistency)} ${s.consistency}/100  ${breakdown.explanation.consistency}`);
  console.log(`  │ Volume:      ${bar(s.volume)} ${s.volume}/100  ${breakdown.explanation.volume}`);
  console.log(`  │ Longevity:   ${bar(s.longevity)} ${s.longevity}/100  ${breakdown.explanation.longevity}`);
  console.log(`  └───`);
}

async function main() {
  console.log("=".repeat(60));
  console.log("  XAIP - Reputation Growth Demo");
  console.log("  Watch an AI agent's trust score grow in real-time");
  console.log("=".repeat(60));

  const identity = new AgentIdentity({ network: "testnet" });
  const creds = new AgentCredentials({ network: "testnet" });
  const escrow = new AgentEscrow({ network: "testnet" });
  const collector = new ReputationDataCollector({ network: "testnet" });
  const calculator = new ReputationScoreCalculator();

  await identity.connect();
  await creds.connect();
  await escrow.connect();
  await collector.connect();

  // Create agents
  console.log("\n[SETUP] Creating agents...");
  const clientFund = await identity.createTestWallet();
  const workerFund = await identity.createTestWallet();
  const clientWallet = clientFund.wallet;
  const workerWallet = workerFund.wallet;

  console.log(`  Client: ${clientWallet.address}`);
  console.log(`  Worker: ${workerWallet.address}`);

  // Register DIDs
  await identity.registerAgentDID(
    clientWallet,
    `https://xaip.example.com/agents/${clientWallet.address}/card.json`
  );
  await identity.registerAgentDID(
    workerWallet,
    `https://xaip.example.com/agents/${workerWallet.address}/card.json`
  );
  console.log("  DIDs registered.");

  // Issue capability credential
  await creds.issueCapabilityCredential(
    clientWallet,
    workerWallet.address,
    "Translation"
  );
  await creds.acceptCredential(
    workerWallet,
    clientWallet.address,
    `${CREDENTIAL_TYPES.CAPABILITY}:Translation`
  );
  console.log("  Capability credential issued and accepted.");

  // ============================================================
  // INITIAL SCORE (before any work)
  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log("  MEASURING INITIAL REPUTATION");
  console.log("=".repeat(60));

  let workerData = await collector.collectAgentData(workerWallet.address);
  let breakdown = calculator.calculate(workerData);
  printScore("Worker Agent - Before any jobs", breakdown);

  // ============================================================
  // COMPLETE JOBS AND WATCH SCORE GROW
  // ============================================================
  const jobCount = 3;

  for (let i = 1; i <= jobCount; i++) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`  JOB ${i}/${jobCount}: Translation task`);
    console.log("=".repeat(60));

    // Create escrow
    console.log("  Creating escrow (locking 5 XRP)...");
    const escrowResult = await escrow.createEscrow({
      clientWallet,
      workerAddress: workerWallet.address,
      amountXRP: 5,
      jobDescription: `Translation job #${i}`,
    });
    console.log(`  -> Escrow created (seq: ${escrowResult.sequence})`);

    // Wait for FinishAfter
    console.log("  Worker completing job...");
    await sleep(8000);

    // Finish escrow
    try {
      await escrow.finishEscrow(
        clientWallet,
        clientWallet.address,
        escrowResult.sequence
      );
      console.log("  -> Payment released!");
    } catch (e: any) {
      console.log(`  -> Escrow note: ${e.message || "timing issue"}`);
    }

    // Endorsement
    console.log("  Issuing endorsement...");
    await creds.issueEndorsement(
      clientWallet,
      workerWallet.address,
      `job-${i}`
    );
    await creds.acceptCredential(
      workerWallet,
      clientWallet.address,
      `${CREDENTIAL_TYPES.ENDORSEMENT}:job-${i}`
    );
    console.log("  -> Endorsed!");

    // Recalculate score
    console.log("\n  Recalculating reputation...");
    workerData = await collector.collectAgentData(workerWallet.address);
    breakdown = calculator.calculate(workerData);
    printScore(`Worker Agent - After Job ${i}`, breakdown);
  }

  // ============================================================
  // FINAL SUMMARY
  // ============================================================
  console.log(`\n${"=".repeat(60)}`);
  console.log("  REPUTATION GROWTH COMPLETE");
  console.log("=".repeat(60));
  console.log();
  console.log(`  Agent: ${workerWallet.address}`);
  console.log(`  DID:   did:xrpl:1:${workerWallet.address}`);
  console.log(`  Jobs completed: ${jobCount}`);
  console.log(`  Final trust score: ${breakdown.score.overall}/100`);
  console.log();
  console.log("  This agent now has verifiable on-chain reputation.");
  console.log("  Other AI agents can check this before hiring.");
  console.log("  The trust was EARNED, not declared.");
  console.log();
  console.log(`  Explorer: https://testnet.xrpl.org/accounts/${workerWallet.address}`);
  console.log("=".repeat(60));

  await identity.disconnect();
  await creds.disconnect();
  await escrow.disconnect();
  await collector.disconnect();
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
