/**
 * XAIP MCP Server
 *
 * Exposes the XRPL Agent Identity Protocol as MCP tools,
 * allowing any AI (Claude, GPT, Gemini, etc.) to:
 * - Create agent identities on XRPL
 * - Issue and verify credentials
 * - Search for other agents
 * - Create escrow-based transactions
 * - Endorse other agents
 *
 * This is the gateway for AI agents to "live" on XRPL.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Client, Wallet, xrpToDrops } from "xrpl";
import { withVeridict } from "veridict";                // ← Veridict integration

// ============================================================
// Server setup
// ============================================================

const server = new McpServer({
  name: "xaip",
  version: "0.1.0",
});

// XRPL connection state
let client: Client | null = null;
let currentNetwork = "testnet";

const NETWORKS: Record<string, string> = {
  mainnet: "wss://xrplcluster.com",
  testnet: "wss://s.altnet.rippletest.net:51233",
  devnet: "wss://s.devnet.rippletest.net:51233",
};

async function getClient(): Promise<Client> {
  if (!client || !client.isConnected()) {
    client = new Client(NETWORKS[currentNetwork]);
    await client.connect();
  }
  return client;
}

function stringToHex(str: string): string {
  return Buffer.from(str, "utf-8").toString("hex").toUpperCase();
}

// ============================================================
// MCP Tools
// ============================================================

// --- Connection ---

server.tool(
  "xaip_connect",
  "Connect to an XRPL network (testnet, devnet, or mainnet)",
  { network: z.enum(["testnet", "devnet", "mainnet"]).default("testnet") },
  async ({ network }) => {
    currentNetwork = network;
    if (client?.isConnected()) await client.disconnect();
    client = new Client(NETWORKS[network]);
    await client.connect();
    return { content: [{ type: "text", text: `Connected to XRPL ${network}` }] };
  }
);

// --- Identity ---

server.tool(
  "xaip_create_test_wallet",
  "Create a funded wallet on XRPL testnet/devnet (for development). Returns wallet address and seed.",
  {},
  async () => {
    if (currentNetwork === "mainnet") {
      return { content: [{ type: "text", text: "ERROR: Cannot use faucet on mainnet." }] };
    }
    const c = await getClient();
    const fund = await c.fundWallet();
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          address: fund.wallet.address,
          seed: fund.wallet.seed,
          publicKey: fund.wallet.publicKey,
          balance: `${fund.balance} XRP`,
        }, null, 2),
      }],
    };
  }
);

server.tool(
  "xaip_register_agent",
  "Register a new AI agent identity (DID) on XRPL. This is how an AI agent is 'born' on the blockchain.",
  {
    seed: z.string().describe("The wallet seed of the agent"),
    agentCardUri: z.string().describe("URI pointing to the Agent Card (IPFS or HTTPS URL)"),
  },
  async ({ seed, agentCardUri }) => {
    const c = await getClient();
    const wallet = Wallet.fromSeed(seed);

    const tx: any = {
      TransactionType: "DIDSet",
      Account: wallet.address,
      URI: stringToHex(agentCardUri),
      Data: stringToHex("XAIP/0.1"),
    };

    const prepared = await c.autofill(tx);
    const signed = wallet.sign(prepared);
    const result = await c.submitAndWait(signed.tx_blob);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: true,
          did: `did:xrpl:1:${wallet.address}`,
          txHash: result.result.hash,
          explorer: `https://${currentNetwork}.xrpl.org/transactions/${result.result.hash}`,
        }, null, 2),
      }],
    };
  }
);

server.tool(
  "xaip_resolve_agent",
  "Resolve an agent's DID from the XRPL ledger. Returns the agent's identity information.",
  {
    address: z.string().describe("The XRPL address of the agent to look up"),
  },
  async ({ address }) => {
    const c = await getClient();

    try {
      const response = await c.request({
        command: "ledger_entry",
        did: address,
      } as any);

      const node = (response.result as any).node;
      if (!node) {
        return { content: [{ type: "text", text: "Agent DID not found." }] };
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            did: `did:xrpl:1:${address}`,
            uri: node.URI ? Buffer.from(node.URI, "hex").toString("utf-8") : null,
            data: node.Data ? Buffer.from(node.Data, "hex").toString("utf-8") : null,
            account: `https://${currentNetwork}.xrpl.org/accounts/${address}`,
          }, null, 2),
        }],
      };
    } catch (error: any) {
      if (error.data?.error === "entryNotFound") {
        return { content: [{ type: "text", text: "Agent DID not found on ledger." }] };
      }
      throw error;
    }
  }
);

// --- Credentials ---

server.tool(
  "xaip_issue_credential",
  "Issue a credential to an agent (capability proof, endorsement, etc.)",
  {
    issuerSeed: z.string().describe("Seed of the credential issuer"),
    subjectAddress: z.string().describe("XRPL address of the agent receiving the credential"),
    credentialType: z.string().describe("Type of credential (e.g., 'XAIP:Capability:Translation', 'XAIP:Endorsement:job-complete')"),
    uri: z.string().optional().describe("Optional URI with credential details"),
  },
  async ({ issuerSeed, subjectAddress, credentialType, uri }) => {
    const c = await getClient();
    const issuerWallet = Wallet.fromSeed(issuerSeed);

    const tx: any = {
      TransactionType: "CredentialCreate",
      Account: issuerWallet.address,
      Subject: subjectAddress,
      CredentialType: stringToHex(credentialType),
    };

    if (uri) {
      tx.URI = stringToHex(uri);
    }

    const prepared = await c.autofill(tx);
    const signed = issuerWallet.sign(prepared);
    const result = await c.submitAndWait(signed.tx_blob);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: true,
          issuer: issuerWallet.address,
          subject: subjectAddress,
          credentialType,
          txHash: result.result.hash,
        }, null, 2),
      }],
    };
  }
);

server.tool(
  "xaip_accept_credential",
  "Accept a credential that was issued to your agent",
  {
    agentSeed: z.string().describe("Seed of the agent accepting the credential"),
    issuerAddress: z.string().describe("XRPL address of the credential issuer"),
    credentialType: z.string().describe("Type of credential to accept"),
  },
  async ({ agentSeed, issuerAddress, credentialType }) => {
    const c = await getClient();
    const agentWallet = Wallet.fromSeed(agentSeed);

    const tx: any = {
      TransactionType: "CredentialAccept",
      Account: agentWallet.address,
      Issuer: issuerAddress,
      CredentialType: stringToHex(credentialType),
    };

    const prepared = await c.autofill(tx);
    const signed = agentWallet.sign(prepared);
    const result = await c.submitAndWait(signed.tx_blob);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: true,
          agent: agentWallet.address,
          issuer: issuerAddress,
          credentialType,
          txHash: result.result.hash,
        }, null, 2),
      }],
    };
  }
);

// --- Escrow Transactions ---

server.tool(
  "xaip_create_escrow",
  "Create an escrow payment for an agent-to-agent job. Locks XRP until the job is done.",
  {
    clientSeed: z.string().describe("Seed of the client agent (who pays)"),
    workerAddress: z.string().describe("XRPL address of the worker agent"),
    amountXRP: z.number().positive().describe("Amount of XRP to lock in escrow"),
    jobDescription: z.string().describe("Description of the job"),
  },
  async ({ clientSeed, workerAddress, amountXRP, jobDescription }) => {
    const c = await getClient();
    const clientWallet = Wallet.fromSeed(clientSeed);

    const rippleEpochOffset = 946684800;
    const finishAfter = Math.floor(Date.now() / 1000) - rippleEpochOffset + 5;
    const cancelAfter = finishAfter + 86400;

    const tx: any = {
      TransactionType: "EscrowCreate",
      Account: clientWallet.address,
      Destination: workerAddress,
      Amount: xrpToDrops(amountXRP),
      FinishAfter: finishAfter,
      CancelAfter: cancelAfter,
      Memos: [{
        Memo: {
          MemoType: stringToHex("XAIP/Job"),
          MemoData: stringToHex(JSON.stringify({
            protocol: "XAIP/0.1",
            description: jobDescription,
          })),
        },
      }],
    };

    const prepared = await c.autofill(tx);
    const signed = clientWallet.sign(prepared);
    const result = await c.submitAndWait(signed.tx_blob);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: true,
          escrowSequence: prepared.Sequence,
          clientAddress: clientWallet.address,
          workerAddress,
          amountXRP,
          txHash: result.result.hash,
          expiresIn: "24 hours",
        }, null, 2),
      }],
    };
  }
);

server.tool(
  "xaip_finish_escrow",
  "Release escrow payment to the worker after job completion",
  {
    finisherSeed: z.string().describe("Seed of the account finishing the escrow"),
    escrowOwner: z.string().describe("XRPL address of the escrow creator"),
    escrowSequence: z.number().describe("Sequence number of the escrow"),
  },
  async ({ finisherSeed, escrowOwner, escrowSequence }) => {
    const c = await getClient();
    const finisherWallet = Wallet.fromSeed(finisherSeed);

    const tx: any = {
      TransactionType: "EscrowFinish",
      Account: finisherWallet.address,
      Owner: escrowOwner,
      OfferSequence: escrowSequence,
    };

    const prepared = await c.autofill(tx);
    const signed = finisherWallet.sign(prepared);
    const result = await c.submitAndWait(signed.tx_blob);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: true,
          txHash: result.result.hash,
          message: "Payment released to worker!",
        }, null, 2),
      }],
    };
  }
);

// --- Reputation ---

server.tool(
  "xaip_get_reputation",
  "Get an agent's trust score computed from on-chain evidence. Returns a 0-100 composite score with 5 dimensions.",
  {
    address: z.string().describe("XRPL address of the agent to evaluate"),
  },
  async ({ address }) => {
    const c = await getClient();

    // Collect on-chain data
    const [accountInfo, didInfo, txResponse] = await Promise.all([
      c.request({
        command: "account_info",
        account: address,
        ledger_index: "validated",
      }).catch(() => null),
      c.request({
        command: "ledger_entry",
        did: address,
      } as any).catch(() => null),
      c.request({
        command: "account_tx",
        account: address,
        ledger_index_min: -1,
        ledger_index_max: -1,
        limit: 200,
      } as any).catch(() => null),
    ]);

    if (!accountInfo) {
      return { content: [{ type: "text", text: "Account not found." }] };
    }

    const transactions = (txResponse?.result as any)?.transactions || [];

    // Analyze transactions
    let escrowsFinished = 0, escrowsCancelled = 0;
    let paymentsReceived = 0, paymentsSent = 0;
    let endorsementsReceived = 0;
    const capabilities: string[] = [];
    const rippleEpochOffset = 946684800;
    let earliest = Infinity, latest = 0;
    const uniqueDays = new Set<string>();

    for (const txEntry of transactions) {
      const tx = txEntry.tx_json || txEntry.tx || {};
      const type = tx.TransactionType;

      // Transaction analysis
      if (type === "EscrowFinish") escrowsFinished++;
      if (type === "EscrowCancel") escrowsCancelled++;
      if (type === "Payment" && tx.Account === address) paymentsSent++;
      if (type === "Payment" && tx.Destination === address) paymentsReceived++;
      if (type === "CredentialCreate" && tx.Subject === address) {
        try {
          const credType = tx.CredentialType
            ? Buffer.from(tx.CredentialType, "hex").toString("utf-8") : "";
          if (credType.includes("Endorsement")) endorsementsReceived++;
          if (credType.includes("Capability")) {
            const cap = credType.replace("XAIP:Capability:", "");
            if (cap && !capabilities.includes(cap)) capabilities.push(cap);
          }
        } catch {}
      }

      // Activity tracking
      const closeTime = txEntry.close_time_iso || txEntry.date;
      let ts: number | null = null;
      if (typeof closeTime === "string") ts = new Date(closeTime).getTime() / 1000;
      else if (typeof tx.date === "number") ts = tx.date + rippleEpochOffset;
      if (ts) {
        if (ts < earliest) earliest = ts;
        if (ts > latest) latest = ts;
        uniqueDays.add(new Date(ts * 1000).toISOString().split("T")[0]);
      }
    }

    // Calculate scores
    const totalEscrows = escrowsFinished + escrowsCancelled;
    const reliability = totalEscrows > 0 ? Math.round((escrowsFinished / totalEscrows) * 100) : (transactions.length > 0 ? 50 : 0);
    const interactionCount = escrowsFinished + paymentsReceived;
    const endorseRate = interactionCount > 0 ? Math.min(1, endorsementsReceived / interactionCount) : 0;
    const quality = Math.min(100, Math.round(endorseRate * 80 + Math.min(20, capabilities.length * 10)));
    const totalDays = earliest !== Infinity && latest > 0 ? Math.max(1, (latest - earliest) / 86400) : 1;
    const consistency = uniqueDays.size > 1 ? Math.min(100, Math.round((uniqueDays.size / totalDays) * 200)) : 0;
    const volume = transactions.length > 0 ? Math.min(100, Math.round(Math.log10(transactions.length) * 20)) : 0;
    const daysActive = earliest !== Infinity ? (Date.now() / 1000 - earliest) / 86400 : 0;
    const longevity = Math.min(100, Math.round((daysActive / 365) * 100));

    const overall = Math.round(0.30 * reliability + 0.25 * quality + 0.20 * consistency + 0.15 * volume + 0.10 * longevity);

    // DID info
    const didNode = (didInfo?.result as any)?.node;
    const isXAIP = didNode?.Data ? Buffer.from(didNode.Data, "hex").toString("utf-8").startsWith("XAIP/") : false;

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          address,
          did: didNode ? `did:xrpl:1:${address}` : null,
          isXAIPAgent: isXAIP,
          trustScore: {
            overall,
            reliability,
            quality,
            consistency,
            volume,
            longevity,
          },
          stats: {
            totalTransactions: transactions.length,
            escrowsCompleted: escrowsFinished,
            escrowsCancelled,
            endorsementsReceived,
            capabilities,
            activeDays: uniqueDays.size,
          },
          verdict: overall >= 80 ? "Highly trusted" : overall >= 60 ? "Trusted" : overall >= 40 ? "Building trust" : overall >= 20 ? "New agent" : "Unverified",
        }, null, 2),
      }],
    };
  }
);

// --- Account Info ---

server.tool(
  "xaip_get_account",
  "Get account information for an XRPL address (balance, sequence, etc.)",
  {
    address: z.string().describe("The XRPL address to look up"),
  },
  async ({ address }) => {
    const c = await getClient();
    const response = await c.request({
      command: "account_info",
      account: address,
      ledger_index: "validated",
    });

    const data = response.result.account_data;
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          address: data.Account,
          balanceXRP: Number(data.Balance) / 1_000_000,
          sequence: data.Sequence,
          explorer: `https://${currentNetwork}.xrpl.org/accounts/${address}`,
        }, null, 2),
      }],
    };
  }
);

// ============================================================
// Start server
// ============================================================

async function main() {
  withVeridict(server, { name: "xaip-mcp-server" });    // ← Veridict: log all tool executions
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("XAIP MCP Server running on stdio (with Veridict)");
}

main().catch(console.error);
