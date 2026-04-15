/**
 * XAIP MCP Trust Server
 *
 * Wraps the XAIP Trust API as native MCP tool calls, letting AI agents:
 *   - Check trust scores for any MCP server (xaip_check_trust)
 *   - Select the most trustworthy server from a candidate list (xaip_select)
 *   - Report execution results back to the aggregator (xaip_report)
 *
 * Transport: stdio (standard for MCP servers)
 * Run:       npx xaip-mcp-trust
 */

import * as crypto from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ─── Constants ────────────────────────────────────────────────────────────────

const TRUST_API  = "https://xaip-trust-api.kuma-github.workers.dev";
const AGGREGATOR = "https://xaip-aggregator.kuma-github.workers.dev";

// ─── Types ────────────────────────────────────────────────────────────────────

interface KeyPair {
  did: string;
  publicKey: string;   // hex-encoded SPKI DER
  privateKey: string;  // hex-encoded PKCS8 DER
}

// ─── Crypto helpers (mirrored from demo/dogfood.ts) ──────────────────────────

function generateKeyPair(didBase: string): KeyPair {
  const pair = crypto.generateKeyPairSync("ed25519");
  const pubDer  = pair.publicKey.export({ type: "spki",  format: "der" }) as Buffer;
  const privDer = pair.privateKey.export({ type: "pkcs8", format: "der" }) as Buffer;
  const raw = pubDer.subarray(pubDer.length - 32);
  return {
    did: `${didBase}:${raw.toString("hex")}`,
    publicKey:  pubDer.toString("hex"),
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
  return (
    "{" +
    keys
      .map(k => JSON.stringify(k) + ":" + canonicalize((value as Record<string, unknown>)[k]))
      .join(",") +
    "}"
  );
}

function signPayload(payload: string, privateKeyHex: string): string {
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

// ─── Session-scoped key store (in-memory, fresh each session) ─────────────────
//
// Agent keys are keyed by server slug; each agent gets a stable DID within a
// session but is re-generated on restart (improves diversity of caller IDs).
// callerKey is a single ephemeral identity representing this MCP session.

const agentKeys = new Map<string, KeyPair>();
let callerKey: KeyPair | null = null;

function getAgentKey(slug: string): KeyPair {
  let kp = agentKeys.get(slug);
  if (!kp) {
    kp = generateKeyPair(`did:key`);
    kp.did = `did:web:${slug}`;
    agentKeys.set(slug, kp);
  }
  return kp;
}

function getCallerKey(): KeyPair {
  if (!callerKey) {
    callerKey = generateKeyPair("did:key");
  }
  return callerKey;
}

// ─── Server ───────────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "xaip-trust",
  version: "0.2.1",
});

// ── Tool 0: xaip_list_servers ─────────────────────────────────────────────────

server.tool(
  "xaip_list_servers",
  "List all MCP servers that have trust scores. Shows trust level, execution count, and verdict for each server.",
  {},
  async () => {
    let servers: Array<{
      slug: string;
      trust: number | null;
      verdict: string;
      receipts: number;
      confidence: number | null;
      riskFlags: string[];
    }>;

    try {
      const res = await fetch(`${TRUST_API}/v1/servers`);
      const data = await res.json() as { servers: typeof servers; count: number };
      servers = data.servers;
    } catch {
      // Fallback: query known slugs via batch endpoint
      const KNOWN_SLUGS = [
        "context7", "sequential-thinking", "memory",
        "filesystem", "puppeteer", "playwright",
        "everything", "fetch", "sqlite", "git",
      ];
      try {
        const res = await fetch(`${TRUST_API}/v1/trust?slugs=${KNOWN_SLUGS.join(",")}`);
        const data = await res.json() as { results: typeof servers };
        servers = data.results;
      } catch (err) {
        return {
          content: [{
            type: "text" as const,
            text: `Error contacting XAIP Trust API: ${err instanceof Error ? err.message : String(err)}`,
          }],
        };
      }
    }

    // Sort by trust descending
    servers.sort((a, b) => (b.trust ?? -1) - (a.trust ?? -1));

    const lines: string[] = [
      `XAIP Scored Servers (${servers.length} total)`,
      ``,
      `  ${"Server".padEnd(25)} ${"Trust".padEnd(8)} ${"Verdict".padEnd(12)} ${"Receipts".padEnd(10)} Risk Flags`,
      `  ${"─".repeat(25)} ${"─".repeat(8)} ${"─".repeat(12)} ${"─".repeat(10)} ${"─".repeat(20)}`,
    ];

    for (const s of servers) {
      const trust = s.trust !== null ? s.trust.toFixed(3) : "N/A";
      const flags = s.riskFlags.length > 0 ? s.riskFlags.join(", ") : "none";
      lines.push(
        `  ${s.slug.padEnd(25)} ${trust.padEnd(8)} ${s.verdict.padEnd(12)} ${String(s.receipts).padEnd(10)} ${flags}`
      );
    }

    lines.push(``, `Use xaip_check_trust for detailed info on a specific server.`);

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

// ── Tool 1: xaip_check_trust ──────────────────────────────────────────────────

server.tool(
  "xaip_check_trust",
  "Check the trust score of an MCP server. Returns trust level, execution count, and risk flags.",
  { slug: z.string().describe("MCP server slug or qualified name (e.g. 'context7' or '@owner/server')") },
  async ({ slug }) => {
    let data: unknown;
    try {
      const res = await fetch(`${TRUST_API}/v1/trust/${encodeURIComponent(slug)}`);
      data = await res.json();
    } catch (err) {
      return {
        content: [{
          type: "text" as const,
          text: `Error contacting XAIP Trust API: ${err instanceof Error ? err.message : String(err)}`,
        }],
      };
    }

    const d = data as {
      slug: string;
      trust: number | null;
      verdict: string;
      receipts: number;
      confidence: number | null;
      source: string;
      riskFlags: string[];
      timestamp: string;
      computedFrom?: string;
    };

    const lines: string[] = [
      `Trust Score: ${d.slug}`,
      `  verdict:    ${d.verdict}`,
      `  trust:      ${d.trust !== null ? d.trust.toFixed(3) : "N/A (unscored)"}`,
      `  receipts:   ${d.receipts} verified executions`,
      `  confidence: ${d.confidence !== null ? (d.confidence * 100).toFixed(0) + "%" : "N/A"}`,
      `  source:     ${d.source}`,
    ];
    if (d.riskFlags.length > 0) {
      lines.push(`  riskFlags:  ${d.riskFlags.join(", ")}`);
    }
    if (d.computedFrom) {
      lines.push(`  computed:   ${d.computedFrom}`);
    }
    lines.push(`  timestamp:  ${d.timestamp}`);

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

// ── Tool 2: xaip_select ───────────────────────────────────────────────────────

server.tool(
  "xaip_select",
  "Select the most trustworthy MCP server for a task from a list of candidates. Automatically excludes unscored servers.",
  {
    task:       z.string().describe("Description of the task to delegate"),
    candidates: z.array(z.string()).min(1).describe("List of MCP server slugs to evaluate"),
    mode:       z.enum(["relative", "strict"]).optional()
                  .describe("relative (default): pick best available; strict: reject all below caution threshold"),
  },
  async ({ task, candidates, mode }) => {
    let data: unknown;
    try {
      const res = await fetch(`${TRUST_API}/v1/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, candidates, ...(mode ? { mode } : {}) }),
      });
      data = await res.json();
    } catch (err) {
      return {
        content: [{
          type: "text" as const,
          text: `Error contacting XAIP Trust API: ${err instanceof Error ? err.message : String(err)}`,
        }],
      };
    }

    const d = data as {
      selected: string | null;
      reason: string;
      rejected: Array<{ slug: string; reason: string }>;
      candidates: Array<{ slug: string; trust: number | null; receipts: number; verdict: string }>;
      withoutXAIP: string;
      warning?: string;
      timestamp: string;
    };

    const lines: string[] = [
      `XAIP Selection for: "${task}"`,
      ``,
      `  Selected:  ${d.selected ?? "none"}`,
      `  Reason:    ${d.reason}`,
    ];

    if (d.warning) {
      lines.push(`  Warning:   ${d.warning}`);
    }

    if (d.rejected.length > 0) {
      lines.push(``, `  Rejected:`);
      for (const r of d.rejected) {
        lines.push(`    - ${r.slug}: ${r.reason}`);
      }
    }

    lines.push(``, `  Candidates:`);
    for (const c of d.candidates) {
      lines.push(
        `    - ${c.slug}: verdict=${c.verdict}, trust=${c.trust !== null ? c.trust.toFixed(3) : "N/A"}, receipts=${c.receipts}`
      );
    }

    lines.push(``, `  Without XAIP: ${d.withoutXAIP}`);
    lines.push(`  Timestamp: ${d.timestamp}`);

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

// ── Tool 3: xaip_report ───────────────────────────────────────────────────────

server.tool(
  "xaip_report",
  "Report the result of an MCP tool execution. Contributes to the trust score of the server. Each report is Ed25519-signed.",
  {
    server:    z.string().describe("MCP server slug (e.g. 'context7')"),
    tool:      z.string().describe("Name of the tool that was called"),
    success:   z.boolean().describe("Whether the tool call succeeded"),
    latencyMs: z.number().int().nonnegative().describe("Execution latency in milliseconds"),
  },
  async ({ server: serverSlug, tool, success, latencyMs }) => {
    const agentKp  = getAgentKey(serverSlug);
    const callerKp = getCallerKey();

    const timestamp  = new Date().toISOString();
    const taskHash   = sha256short(tool);
    const resultHash = sha256short(success ? "ok" : "failed");

    const base = {
      agentDid:    agentKp.did,
      callerDid:   callerKp.did,
      toolName:    tool,
      taskHash,
      resultHash,
      success,
      latencyMs,
      timestamp,
    };

    // Canonical payload for signing (must include failureType: "" per aggregator spec)
    const payloadObj = {
      agentDid:    base.agentDid,
      callerDid:   base.callerDid,
      failureType: "",
      latencyMs:   base.latencyMs,
      resultHash:  base.resultHash,
      success:     base.success,
      taskHash:    base.taskHash,
      timestamp:   base.timestamp,
      toolName:    base.toolName,
    };
    const payload         = canonicalize(payloadObj);
    const signature       = signPayload(payload, agentKp.privateKey);
    const callerSignature = signPayload(payload, callerKp.privateKey);

    let responseText: string;
    try {
      const res = await fetch(`${AGGREGATOR}/receipts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receipt: { ...base, signature, callerSignature },
          publicKey:       agentKp.publicKey,
          callerPublicKey: callerKp.publicKey,
        }),
      });
      const body = await res.json() as Record<string, unknown>;
      if (res.ok) {
        responseText = [
          `Receipt submitted successfully.`,
          `  server:       ${serverSlug}`,
          `  tool:         ${tool}`,
          `  success:      ${success}`,
          `  latencyMs:    ${latencyMs}`,
          `  agentDid:     ${agentKp.did}`,
          `  callerDid:    ${callerKp.did}`,
          `  timestamp:    ${timestamp}`,
          `  aggregator:   accepted`,
        ].join("\n");
      } else {
        responseText = [
          `Receipt submission failed.`,
          `  status:  ${res.status}`,
          `  error:   ${String(body["error"] ?? "unknown")}`,
        ].join("\n");
      }
    } catch (err) {
      responseText = `Error contacting aggregator: ${err instanceof Error ? err.message : String(err)}`;
    }

    return { content: [{ type: "text" as const, text: responseText }] };
  }
);

// ─── Start ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("XAIP MCP Trust Server running on stdio");
}

main().catch(console.error);
