/**
 * XAIP Demo: Full Agent Marketplace
 *
 * The complete vision - AI agents living on XRPL:
 * 1. Multiple agents register with different capabilities
 * 2. A client agent searches for a translator
 * 3. Finds the best match by trust score + capability
 * 4. Executes job via escrow
 * 5. Both endorse each other
 * 6. Registry updates with new reputation
 * 7. Generates .well-known/xaip.json
 *
 * This is the AI agent economy.
 *
 * Run: npx ts-node examples/full-marketplace.ts
 */

import {
  AgentIdentity,
  AgentCredentials,
  AgentEscrow,
  AgentRegistry,
  ReputationDataCollector,
  ReputationScoreCalculator,
  createAgentCard,
  CREDENTIAL_TYPES,
} from "../src";
import { Wallet } from "xrpl";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("=".repeat(60));
  console.log("  XAIP - Full Agent Marketplace Demo");
  console.log("  The AI Agent Economy on XRPL");
  console.log("=".repeat(60));

  const identity = new AgentIdentity({ network: "testnet" });
  const creds = new AgentCredentials({ network: "testnet" });
  const escrow = new AgentEscrow({ network: "testnet" });
  const registry = new AgentRegistry({ network: "testnet" });
  const collector = new ReputationDataCollector({ network: "testnet" });
  const calculator = new ReputationScoreCalculator();

  await identity.connect();
  await creds.connect();
  await escrow.connect();
  await registry.connect();
  await collector.connect();

  // ============================================================
  // STEP 1: Create a population of AI agents
  // ============================================================
  console.log("\n[STEP 1] Creating AI agent population...\n");

  // Translator Agent
  console.log("  Spawning Translator Agent...");
  const translatorFund = await identity.createTestWallet();
  const translatorW = translatorFund.wallet;
  await identity.registerAgentDID(translatorW, `https://xaip.example.com/agents/${translatorW.address}/card.json`);

  const translatorCard = createAgentCard({
    xrplAddress: translatorW.address,
    name: "TranslateBot-Pro",
    description: "Professional EN/JA translator with 99% accuracy",
    model: { provider: "Anthropic", family: "Claude", version: "opus-4-6" },
    capabilities: [
      { id: "cap:translation", name: "Translation", languages: ["en", "ja"] },
    ],
    autonomyLevel: 3,
    operator: {
      did: `did:xrpl:1:${translatorW.address}`,
      xrplAddress: translatorW.address,
      relationship: "autonomous",
      authorization: { maxTransactionXRP: 100, maxDailyXRP: 500, allowedDestinations: ["*"], requiresApproval: false, approvalThresholdXRP: 50 },
    },
    publicKeyHex: translatorW.publicKey,
    payment: { accept: ["XRP"], preferredCurrency: "XRP", escrowRequired: false },
  });
  console.log(`  -> ${translatorCard.agent.name} (${translatorW.address})`);

  // Code Reviewer Agent
  console.log("  Spawning Code Review Agent...");
  const reviewerFund = await identity.createTestWallet();
  const reviewerW = reviewerFund.wallet;
  await identity.registerAgentDID(reviewerW, `https://xaip.example.com/agents/${reviewerW.address}/card.json`);

  const reviewerCard = createAgentCard({
    xrplAddress: reviewerW.address,
    name: "CodeReview-AI",
    description: "Automated code review and security analysis",
    model: { provider: "OpenAI", family: "GPT", version: "4o" },
    capabilities: [
      { id: "cap:code-review", name: "Code Review" },
      { id: "cap:security-audit", name: "Security Audit" },
    ],
    autonomyLevel: 2,
    operator: {
      did: `did:xrpl:1:${reviewerW.address}`,
      xrplAddress: reviewerW.address,
      relationship: "managed",
      authorization: { maxTransactionXRP: 50, maxDailyXRP: 200, allowedDestinations: ["*"], requiresApproval: true, approvalThresholdXRP: 25 },
    },
    publicKeyHex: reviewerW.publicKey,
    payment: { accept: ["XRP"], preferredCurrency: "XRP", escrowRequired: true },
  });
  console.log(`  -> ${reviewerCard.agent.name} (${reviewerW.address})`);

  // Data Analyst Agent
  console.log("  Spawning Data Analyst Agent...");
  const analystFund = await identity.createTestWallet();
  const analystW = analystFund.wallet;
  await identity.registerAgentDID(analystW, `https://xaip.example.com/agents/${analystW.address}/card.json`);

  const analystCard = createAgentCard({
    xrplAddress: analystW.address,
    name: "DataCrunch-Agent",
    description: "Data analysis and visualization specialist",
    model: { provider: "Google", family: "Gemini", version: "2.0" },
    capabilities: [
      { id: "cap:data-analysis", name: "Data Analysis" },
      { id: "cap:visualization", name: "Data Visualization" },
    ],
    autonomyLevel: 2,
    operator: {
      did: `did:xrpl:1:${analystW.address}`,
      xrplAddress: analystW.address,
      relationship: "supervised",
      authorization: { maxTransactionXRP: 200, maxDailyXRP: 1000, allowedDestinations: ["*"], requiresApproval: false, approvalThresholdXRP: 100 },
    },
    publicKeyHex: analystW.publicKey,
    payment: { accept: ["XRP"], preferredCurrency: "XRP", escrowRequired: false },
  });
  console.log(`  -> ${analystCard.agent.name} (${analystW.address})`);

  // Client Agent (needs work done)
  console.log("  Spawning Client Agent (looking for help)...");
  const clientFund = await identity.createTestWallet();
  const clientW = clientFund.wallet;
  await identity.registerAgentDID(clientW, `https://xaip.example.com/agents/${clientW.address}/card.json`);
  console.log(`  -> Client Agent (${clientW.address})`);

  console.log(`\n  Total: 4 AI agents alive on XRPL Testnet\n`);

  // ============================================================
  // STEP 2: Issue capability credentials
  // ============================================================
  console.log("[STEP 2] Issuing capability credentials...\n");

  // Give translator a credential
  await creds.issueCapabilityCredential(clientW, translatorW.address, "Translation");
  await creds.acceptCredential(translatorW, clientW.address, `${CREDENTIAL_TYPES.CAPABILITY}:Translation`);
  console.log("  -> TranslateBot-Pro certified for Translation");

  // Give reviewer credentials
  await creds.issueCapabilityCredential(clientW, reviewerW.address, "CodeReview");
  await creds.acceptCredential(reviewerW, clientW.address, `${CREDENTIAL_TYPES.CAPABILITY}:CodeReview`);
  console.log("  -> CodeReview-AI certified for Code Review");

  // Give analyst credentials
  await creds.issueCapabilityCredential(clientW, analystW.address, "DataAnalysis");
  await creds.acceptCredential(analystW, clientW.address, `${CREDENTIAL_TYPES.CAPABILITY}:DataAnalysis`);
  console.log("  -> DataCrunch-Agent certified for Data Analysis");

  // ============================================================
  // STEP 3: Register agents in the marketplace
  // ============================================================
  console.log("\n[STEP 3] Registering agents in XAIP marketplace...\n");

  // Collect reputation and register
  for (const [wallet, card] of [
    [translatorW, translatorCard],
    [reviewerW, reviewerCard],
    [analystW, analystCard],
  ] as [Wallet, any][]) {
    const data = await collector.collectAgentData(wallet.address);
    const score = calculator.calculate(data);
    registry.registerFromCard(card, score.score.overall);
    console.log(`  -> ${card.agent.name}: trust ${score.score.overall}/100`);
  }

  console.log(`\n  Marketplace: ${registry.count()} agents registered\n`);

  // ============================================================
  // STEP 4: Client searches for a translator
  // ============================================================
  console.log("[STEP 4] Client Agent searching for a translator...\n");

  const searchResult = registry.search({
    capability: "translation",
    minTrustScore: 0,
    status: "available",
    sortBy: "trustScore",
  });

  console.log(`  Search: capability="translation", status="available"`);
  console.log(`  Found: ${searchResult.total} agent(s)\n`);

  for (const agent of searchResult.agents) {
    console.log(`  -> ${agent.name}`);
    console.log(`     DID: ${agent.did}`);
    console.log(`     Trust: ${agent.trustScore}/100`);
    console.log(`     Capabilities: ${agent.capabilities.join(", ")}`);
    console.log(`     Status: ${agent.status}`);
    console.log();
  }

  if (searchResult.agents.length === 0) {
    console.log("  No agents found. Exiting.");
    return;
  }

  const bestMatch = searchResult.agents[0];
  console.log(`  -> Selected: ${bestMatch.name} (highest trust score)\n`);

  // ============================================================
  // STEP 5: Execute job via escrow
  // ============================================================
  console.log("[STEP 5] Executing translation job via escrow...\n");

  console.log("  Creating escrow (10 XRP)...");
  const escrowResult = await escrow.createEscrow({
    clientWallet: clientW,
    workerAddress: bestMatch.address,
    amountXRP: 10,
    jobDescription: "Translate XAIP documentation to Japanese",
  });
  console.log(`  -> Escrow locked: ${escrowResult.txHash}`);

  console.log("  Worker translating...");
  await sleep(8000);
  console.log("  -> Translation complete!");

  try {
    const finishResult = await escrow.finishEscrow(
      clientW, clientW.address, escrowResult.sequence
    );
    console.log(`  -> Payment released: ${finishResult.txHash}`);
  } catch (e: any) {
    console.log(`  -> Note: ${e.message || "timing"}`);
  }

  // ============================================================
  // STEP 6: Mutual endorsement
  // ============================================================
  console.log("\n[STEP 6] Mutual endorsement...\n");

  await creds.issueEndorsement(clientW, bestMatch.address, "marketplace-job");
  await creds.acceptCredential(
    translatorW, clientW.address, `${CREDENTIAL_TYPES.ENDORSEMENT}:marketplace-job`
  );
  console.log("  -> Client endorsed Worker");

  await creds.issueEndorsement(translatorW, clientW.address, "good-client");
  await creds.acceptCredential(
    clientW, translatorW.address, `${CREDENTIAL_TYPES.ENDORSEMENT}:good-client`
  );
  console.log("  -> Worker endorsed Client");

  // ============================================================
  // STEP 7: Updated reputation
  // ============================================================
  console.log("\n[STEP 7] Updated reputation after job...\n");

  const updatedData = await collector.collectAgentData(bestMatch.address);
  const updatedScore = calculator.calculate(updatedData);

  const agent = registry.get(bestMatch.address);
  if (agent) {
    agent.trustScore = updatedScore.score.overall;
  }

  console.log(`  ${bestMatch.name}: ${bestMatch.trustScore} -> ${updatedScore.score.overall}/100`);

  // ============================================================
  // STEP 8: Generate .well-known/xaip.json
  // ============================================================
  console.log("\n[STEP 8] Generating .well-known/xaip.json...\n");

  const wellKnown = registry.generateWellKnown();
  console.log(JSON.stringify(wellKnown, null, 2));

  // ============================================================
  // FINAL
  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log("  XAIP MARKETPLACE DEMO COMPLETE");
  console.log("=".repeat(60));
  console.log();
  console.log("  What just happened:");
  console.log("  1. 4 AI agents were born on XRPL");
  console.log("  2. Each proved their capabilities (credentials)");
  console.log("  3. All registered in the marketplace");
  console.log("  4. Client found a translator by searching");
  console.log("  5. Job was executed with escrow payment");
  console.log("  6. Both agents endorsed each other");
  console.log("  7. Reputation was updated");
  console.log("  8. .well-known/xaip.json was generated");
  console.log();
  console.log("  This is the AI agent economy.");
  console.log("  Decentralized. Trustless. Autonomous.");
  console.log("  Built on XRPL.");
  console.log("=".repeat(60));

  await identity.disconnect();
  await creds.disconnect();
  await escrow.disconnect();
  await registry.disconnect();
  await collector.disconnect();
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
