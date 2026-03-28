/**
 * XAIP Demo: Create an AI Agent on XRPL Testnet
 *
 * This demo:
 * 1. Creates a funded wallet on XRPL testnet
 * 2. Builds an Agent Card (AI agent's identity document)
 * 3. Registers the agent's DID on-chain
 * 4. Resolves the DID to verify it was stored correctly
 *
 * Run: npx ts-node examples/create-agent.ts
 */

import { AgentIdentity, createAgentCard, AgentCard } from "../src";

async function main() {
  console.log("=".repeat(60));
  console.log("  XAIP - XRPL Agent Identity Protocol");
  console.log('  "Every AI deserves a home. XRPL can be that home."');
  console.log("=".repeat(60));
  console.log();

  // Step 1: Connect to XRPL Testnet
  console.log("[1/5] Connecting to XRPL Testnet...");
  const identity = new AgentIdentity({ network: "testnet" });
  await identity.connect();
  console.log("  -> Connected!\n");

  // Step 2: Create a funded wallet (testnet faucet)
  console.log("[2/5] Creating funded wallet (testnet faucet)...");
  const { wallet, address, balance } = await identity.createTestWallet();
  console.log(`  -> Address: ${address}`);
  console.log(`  -> Balance: ${balance}\n`);

  // Step 3: Build Agent Card
  console.log("[3/5] Building Agent Card...");

  const agentCard = createAgentCard({
    xrplAddress: address,
    name: "XAIP-Demo-Agent",
    description:
      "A demo AI agent created by the XAIP protocol. " +
      "This agent demonstrates that AI can have persistent identity on XRPL.",
    model: {
      provider: "Anthropic",
      family: "Claude",
      version: "opus-4-6",
    },
    capabilities: [
      {
        id: "cap:translation",
        name: "Text Translation",
        description: "Translate text between English and Japanese",
        languages: ["en", "ja"],
      },
      {
        id: "cap:summarization",
        name: "Document Summarization",
        description: "Summarize long documents into key points",
      },
    ],
    autonomyLevel: 2,
    operator: {
      did: `did:xrpl:1:${address}`, // Self-operated for demo
      xrplAddress: address,
      relationship: "managed",
      authorization: {
        maxTransactionXRP: 100,
        maxDailyXRP: 500,
        allowedDestinations: ["*"],
        requiresApproval: true,
        approvalThresholdXRP: 50,
      },
    },
    endpoints: {
      api: "https://example.com/api/v1",
    },
    payment: {
      accept: ["XRP"],
      preferredCurrency: "XRP",
      escrowRequired: false,
      escrowRequiredAbove: 100,
    },
    publicKeyHex: wallet.publicKey,
  });

  console.log(`  -> Agent Name: ${agentCard.agent.name}`);
  console.log(`  -> DID: ${agentCard.id}`);
  console.log(`  -> Capabilities: ${agentCard.capabilities.map((c) => c.name).join(", ")}`);
  console.log(`  -> Autonomy Level: L${agentCard.autonomyLevel}`);
  console.log();

  // Step 4: Register DID on XRPL
  console.log("[4/5] Registering Agent DID on XRPL Testnet...");

  // In production, we'd upload to IPFS and use the IPFS URI.
  // For demo, we use a placeholder URI with the Agent Card hash.
  const agentCardJson = JSON.stringify(agentCard, null, 2);
  const placeholderUri = `https://xaip.example.com/agents/${address}/card.json`;

  const { txHash, did } = await identity.registerAgentDID(wallet, placeholderUri);
  console.log(`  -> DID registered on-chain!`);
  console.log(`  -> Transaction: ${txHash}`);
  console.log(`  -> DID: ${did}`);
  console.log();

  // Step 5: Resolve DID to verify
  console.log("[5/5] Resolving DID from ledger to verify...");
  const resolved = await identity.resolveAgentDID(address);

  if (resolved) {
    console.log(`  -> DID: ${resolved.did}`);
    console.log(`  -> URI: ${resolved.uri}`);
    console.log(`  -> Data: ${resolved.data}`);
    console.log();
    console.log("=".repeat(60));
    console.log("  SUCCESS! AI Agent is now alive on XRPL!");
    console.log("=".repeat(60));
    console.log();
    console.log("  Agent Card (full identity document):");
    console.log("-".repeat(60));
    console.log(agentCardJson);
  } else {
    console.log("  -> ERROR: Could not resolve DID");
  }

  // Cleanup
  await identity.disconnect();
  console.log("\nDisconnected from XRPL.");

  // Print summary
  console.log("\n" + "=".repeat(60));
  console.log("  SUMMARY");
  console.log("=".repeat(60));
  console.log(`  Network:     XRPL Testnet`);
  console.log(`  Agent:       ${agentCard.agent.name}`);
  console.log(`  Address:     ${address}`);
  console.log(`  DID:         ${did}`);
  console.log(`  Tx Hash:     ${txHash}`);
  console.log(`  Tx Explorer: https://testnet.xrpl.org/transactions/${txHash}`);
  console.log(`  Account:     https://testnet.xrpl.org/accounts/${address}`);
  console.log("=".repeat(60));
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
