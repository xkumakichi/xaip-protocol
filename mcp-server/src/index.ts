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
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("XAIP MCP Server running on stdio");
}

main().catch(console.error);
