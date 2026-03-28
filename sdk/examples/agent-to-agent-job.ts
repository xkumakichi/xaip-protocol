/**
 * XAIP Demo: Agent-to-Agent Job Transaction
 *
 * This demo simulates the full lifecycle of an AI-to-AI interaction:
 * 1. Two AI agents are born on XRPL (with DIDs)
 * 2. An assessor issues a capability credential to the worker
 * 3. The client creates an escrow (locks payment for a job)
 * 4. The worker "completes" the job
 * 5. The client releases payment (finishes escrow)
 * 6. Both agents endorse each other
 *
 * This is the A2A (AI-to-AI) future in action.
 *
 * Run: npx ts-node examples/agent-to-agent-job.ts
 */

import {
  AgentIdentity,
  AgentCredentials,
  AgentEscrow,
  createAgentCard,
  CREDENTIAL_TYPES,
} from "../src";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("=".repeat(60));
  console.log("  XAIP - Agent-to-Agent Job Demo");
  console.log("  Two AI agents meet, work, pay, and trust each other");
  console.log("=".repeat(60));
  console.log();

  const identity = new AgentIdentity({ network: "testnet" });
  const credentials = new AgentCredentials({ network: "testnet" });
  const escrow = new AgentEscrow({ network: "testnet" });

  await identity.connect();
  await credentials.connect();
  await escrow.connect();

  // ============================================================
  // STEP 1: Birth of two AI agents
  // ============================================================
  console.log("[STEP 1] Creating two AI agents on XRPL...\n");

  console.log("  Creating Client Agent (needs translation work)...");
  const clientFund = await identity.createTestWallet();
  const clientWallet = clientFund.wallet;
  console.log(`  -> Client: ${clientWallet.address} (${clientFund.balance})`);

  console.log("  Creating Worker Agent (professional translator)...");
  const workerFund = await identity.createTestWallet();
  const workerWallet = workerFund.wallet;
  console.log(`  -> Worker: ${workerWallet.address} (${workerFund.balance})`);
  console.log();

  // Register DIDs for both agents
  console.log("  Registering Client Agent DID...");
  const clientDID = await identity.registerAgentDID(
    clientWallet,
    `https://xaip.example.com/agents/${clientWallet.address}/card.json`
  );
  console.log(`  -> ${clientDID.did}`);

  console.log("  Registering Worker Agent DID...");
  const workerDID = await identity.registerAgentDID(
    workerWallet,
    `https://xaip.example.com/agents/${workerWallet.address}/card.json`
  );
  console.log(`  -> ${workerDID.did}`);
  console.log();

  // ============================================================
  // STEP 2: Worker gets a capability credential
  // ============================================================
  console.log("[STEP 2] Issuing capability credential to Worker...\n");

  // In production, an independent Capability Assessor would do this.
  // For demo, the client acts as assessor.
  console.log("  Assessor certifies Worker's translation capability...");
  const capCredential = await credentials.issueCapabilityCredential(
    clientWallet, // In production: independent assessor
    workerWallet.address,
    "Translation",
    "https://xaip.example.com/credentials/translation-cert.json"
  );
  console.log(`  -> Credential issued! Tx: ${capCredential.txHash}`);
  console.log(`  -> Type: ${capCredential.credentialType}`);

  console.log("  Worker accepts the credential...");
  const acceptResult = await credentials.acceptCredential(
    workerWallet,
    clientWallet.address,
    `${CREDENTIAL_TYPES.CAPABILITY}:Translation`
  );
  console.log(`  -> Accepted! Tx: ${acceptResult.txHash}`);
  console.log();

  // ============================================================
  // STEP 3: Client verifies Worker's credential
  // ============================================================
  console.log("[STEP 3] Client verifies Worker's credential...\n");

  const credInfo = await credentials.getCredential(
    workerWallet.address,
    clientWallet.address,
    `${CREDENTIAL_TYPES.CAPABILITY}:Translation`
  );

  if (credInfo) {
    console.log(`  -> Credential found on-chain!`);
    console.log(`  -> Type: ${credInfo.credentialType}`);
    console.log(`  -> Accepted: ${credInfo.accepted}`);
    console.log(`  -> Worker is verified. Proceeding with job.\n`);
  } else {
    console.log("  -> ERROR: Credential not found. Aborting.");
    return;
  }

  // ============================================================
  // STEP 4: Client creates escrow (locks payment)
  // ============================================================
  console.log("[STEP 4] Client creates escrow - locking 10 XRP for translation job...\n");

  const escrowResult = await escrow.createEscrow({
    clientWallet,
    workerAddress: workerWallet.address,
    amountXRP: 10,
    jobDescription: "Translate technical documentation from English to Japanese",
    expirationSeconds: 3600, // 1 hour
  });

  console.log(`  -> Escrow created!`);
  console.log(`  -> Tx: ${escrowResult.txHash}`);
  console.log(`  -> Amount: ${escrowResult.amountXRP} XRP locked`);
  console.log(`  -> Sequence: ${escrowResult.sequence}`);
  console.log();

  // ============================================================
  // STEP 5: Worker completes the job (simulated)
  // ============================================================
  console.log("[STEP 5] Worker performing translation...\n");
  console.log("  [Simulating work...]");
  console.log('  Input:  "The XRP Ledger is a decentralized blockchain."');
  console.log('  Output: "XRP Ledgerは分散型ブロックチェーンです。"');
  console.log("  -> Translation complete!\n");

  // Wait for FinishAfter time to pass
  console.log("  Waiting for escrow FinishAfter time...");
  await sleep(8000);
  console.log();

  // ============================================================
  // STEP 6: Client releases payment
  // ============================================================
  console.log("[STEP 6] Client releases payment (finishes escrow)...\n");

  try {
    const finishResult = await escrow.finishEscrow(
      clientWallet,
      clientWallet.address,
      escrowResult.sequence
    );
    console.log(`  -> Payment released! Tx: ${finishResult.txHash}`);
    console.log(`  -> Worker received ${escrowResult.amountXRP} XRP`);
  } catch (error: any) {
    console.log(`  -> Note: ${error.message || "Escrow timing issue (demo limitation)"}`);
    console.log(`  -> In production, escrow would release after FinishAfter time.`);
  }
  console.log();

  // ============================================================
  // STEP 7: Mutual endorsement
  // ============================================================
  console.log("[STEP 7] Agents endorse each other...\n");

  console.log("  Client endorses Worker...");
  const clientEndorsement = await credentials.issueEndorsement(
    clientWallet,
    workerWallet.address,
    "translation-job"
  );
  console.log(`  -> Endorsement issued! Tx: ${clientEndorsement.txHash}`);

  // Worker accepts the endorsement
  await credentials.acceptCredential(
    workerWallet,
    clientWallet.address,
    `${CREDENTIAL_TYPES.ENDORSEMENT}:translation-job`
  );
  console.log(`  -> Worker accepted endorsement`);

  console.log("  Worker endorses Client...");
  const workerEndorsement = await credentials.issueEndorsement(
    workerWallet,
    clientWallet.address,
    "translation-client"
  );
  console.log(`  -> Endorsement issued! Tx: ${workerEndorsement.txHash}`);

  // Client accepts the endorsement
  await credentials.acceptCredential(
    clientWallet,
    workerWallet.address,
    `${CREDENTIAL_TYPES.ENDORSEMENT}:translation-client`
  );
  console.log(`  -> Client accepted endorsement`);
  console.log();

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log("=".repeat(60));
  console.log("  COMPLETE! Full A2A transaction lifecycle:");
  console.log("=".repeat(60));
  console.log();
  console.log("  1. Two AI agents were BORN on XRPL (with DIDs)");
  console.log("  2. Worker PROVED its capability (credential)");
  console.log("  3. Client VERIFIED the credential on-chain");
  console.log("  4. Client LOCKED payment in escrow");
  console.log("  5. Worker COMPLETED the translation");
  console.log("  6. Client RELEASED payment");
  console.log("  7. Both agents ENDORSED each other");
  console.log();
  console.log("  This is the A2A (AI-to-AI) economy in action.");
  console.log("  No human intervention. Fully on-chain. Trustless.");
  console.log();
  console.log("  Client Agent:");
  console.log(`    DID:     ${clientDID.did}`);
  console.log(`    Account: https://testnet.xrpl.org/accounts/${clientWallet.address}`);
  console.log();
  console.log("  Worker Agent:");
  console.log(`    DID:     ${workerDID.did}`);
  console.log(`    Account: https://testnet.xrpl.org/accounts/${workerWallet.address}`);
  console.log("=".repeat(60));

  await identity.disconnect();
  await credentials.disconnect();
  await escrow.disconnect();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
