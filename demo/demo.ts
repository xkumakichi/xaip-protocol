/**
 * XAIP v0.3.1 — Proof-of-Concept Demo
 *
 * Shows two AI agents (A: caller, B: executor) interacting via MCP.
 * Demonstrates trust evolution: unknown → yes → caution.
 *
 * Architecture:
 *   - 1 Aggregator server  (localhost:4000)
 *   - Agent B: MCP server with "translate" tool, wrapped by withXAIP
 *   - Agent A: simulated as 5 independent callers (diverse DIDs)
 *
 * NOTE: 1 aggregator is used for simplicity; 3+ recommended in production.
 */

import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  withXAIP,
  createAggregatorServer,
  generateDIDKey,
  createSigningDelegate,
  AggregatorClient,
} from "xaip-sdk";

// ─── Config ──────────────────────────────────────────────────

const AGG_PORT = 4000;
const AGG_URL = `http://localhost:${AGG_PORT}`;
const DB_PATH = path.join(process.cwd(), "demo-receipts.db");
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── Helpers ─────────────────────────────────────────────────

/** Wait for HTTP server to bind (avoid setTimeout races). */
function waitListening(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.once("listening", resolve));
}

/** Register Agent B's "translate" tool on a McpServer. */
function registerTranslate(server: McpServer): void {
  server.tool(
    "translate",
    "Translate text to English",
    {
      text: z.string().describe("Text to translate"),
      fail: z.boolean().optional().describe("Force a timeout failure"),
    },
    async ({ text, fail }) => {
      await sleep(40 + Math.random() * 80); // realistic latency
      if (fail) {
        throw new Error("timeout: translation service unavailable");
      }
      return {
        content: [{ type: "text" as const, text: `[ja→en] ${text}` }],
      };
    }
  );
}

/** Register a "translate" tool that fails at a fixed probability (Phase 6). */
function registerTranslateWithRate(server: McpServer, failRate: number): void {
  server.tool(
    "translate",
    "Translate text to English",
    {
      text: z.string().describe("Text to translate"),
    },
    async ({ text }) => {
      await sleep(40 + Math.random() * 80);
      if (Math.random() < failRate) {
        throw new Error("timeout: translation service unavailable");
      }
      return {
        content: [{ type: "text" as const, text: `[ja→en] ${text}` }],
      };
    }
  );
}

/**
 * Call a tool directly (bypasses MCP transport).
 * Works because withXAIP wraps handlers in-place on _registeredTools.
 * Supports MCP SDK ≥1.13 (Object-based) and older (Map-based) APIs.
 */
async function callTool(
  server: McpServer,
  name: string,
  args: Record<string, unknown> = {}
): Promise<string> {
  const tools = (server as any)._registeredTools as Record<string, any>;
  const tool = tools[name];
  if (!tool) throw new Error(`Tool '${name}' not found on server`);
  const fn: Function = tool.handler ?? tool.callback;
  if (typeof fn !== "function") throw new Error(`No handler for tool '${name}'`);
  const result = await fn(args, { signal: AbortSignal.timeout(30_000) });
  return result.content[0].text;
}

/** Print formatted trust query result. */
function printQuery(label: string, raw: string): void {
  const q = JSON.parse(raw);
  const trust = q.trust > 0 ? ` | trust: ${q.trust}` : "";
  const flags = q.riskFlags.length > 0 ? `\n  flags: [${q.riskFlags.join(", ")}]` : "";
  console.log(`\n[${label}] Querying trust for Agent B...`);
  console.log(`[${label}] Verdict: ${q.verdict}${trust} | receipts: ${q.meta.sampleSize}${flags}`);
}

/**
 * Create a fresh McpServer bound to the given DID for querying.
 * Each new instance loads the latest state from the shared DB.
 */
async function makeQueryServer(agentDid: string): Promise<McpServer> {
  const server = new McpServer({ name: "agent-query", version: "1.0.0" });
  registerTranslate(server);
  await withXAIP(server, { did: agentDid, dbPath: DB_PATH, verbose: false });
  return server;
}

/** Query trust for any agent DID; returns parsed QueryResult. */
async function queryTrustFor(did: string): Promise<any> {
  const server = await makeQueryServer(did);
  const raw = await callTool(server, "xaip_query");
  return JSON.parse(raw);
}

// ─── Main ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  // ── Results collector (written to results.js for dashboard) ──
  const results: {
    phases: Array<{ phase: number; label: string; trust: number; verdict: string; receipts: number; riskFlags: string[] }>;
    selection: {
      agentB: { trust: number; verdict: string; receipts: number; riskFlags: string[]; selected: boolean };
      agentC: { trust: number; verdict: string; receipts: number; riskFlags: string[]; selected: boolean };
    };
    sybil: {
      agentD: { trust: number; diversity: number; verdict: string; riskFlags: string[] };
      normalDiversity: number;
    };
    comparison: {
      withoutXAIP: { success: number; total: number; pct: number };
      withXAIP: { execSuccess: number; execTotal: number; execPct: number; totalSuccess: number; totalPct: number };
      improvement: number;
      selectedAgent: string;
    };
  } = {
    phases: [],
    selection: {
      agentB: { trust: 0, verdict: "", receipts: 0, riskFlags: [], selected: false },
      agentC: { trust: 0, verdict: "", receipts: 0, riskFlags: [], selected: false },
    },
    sybil: {
      agentD: { trust: 0, diversity: 0, verdict: "", riskFlags: [] },
      normalDiversity: 0,
    },
    comparison: {
      withoutXAIP: { success: 0, total: 30, pct: 0 },
      withXAIP: { execSuccess: 0, execTotal: 15, execPct: 0, totalSuccess: 0, totalPct: 0 },
      improvement: 0,
      selectedAgent: "",
    },
  };

  // Suppress expected "< 3 aggregators" warning — intentional for demo simplicity
  const origWarn = console.warn;
  console.warn = (msg: string, ...rest: unknown[]) => {
    if (typeof msg === "string" && msg.includes("aggregator")) return;
    origWarn(msg, ...rest);
  };

  // Clean previous run
  fs.rmSync(DB_PATH, { force: true });

  // ── 1. Start Aggregator ──────────────────────────────────────

  const aggServer = createAggregatorServer({
    port: AGG_PORT,
    nodeId: "demo-aggregator",
  });
  await waitListening(aggServer);
  console.log(`[Aggregator] Listening on ${AGG_URL}`);

  // ── 2. Initialize Agent B, get its DID ──────────────────────

  let AGENT_B_DID: string;
  {
    const server = new McpServer({ name: "agent-b-init", version: "1.0.0" });
    registerTranslate(server);
    // No did provided → withXAIP auto-generates a did:key identity
    const ctx = await withXAIP(server, { dbPath: DB_PATH, verbose: false });
    AGENT_B_DID = ctx.did.id;
    console.log(`[Agent B] MCP server ready`);
    console.log(`[Agent B] DID: ${AGENT_B_DID}`);
  }

  // ── Phase 0: Initial query (0 receipts) ──────────────────────

  console.log("\n────────────────────────────────────────────────");
  {
    const server = await makeQueryServer(AGENT_B_DID);
    const raw = await callTool(server, "xaip_query");
    printQuery("Agent A", raw);
    const q0 = JSON.parse(raw);
    results.phases.push({ phase: 0, label: "Initial (0 receipts)", trust: q0.trust, verdict: q0.verdict, receipts: q0.meta.sampleSize, riskFlags: q0.riskFlags });
  }

  // ── Phase 1: 5 callers × 2 successes = 10 receipts ──────────

  console.log("\n────────────────────────────────────────────────");
  console.log("[Agent A] Executing 10 tasks via Agent B...");

  for (let c = 0; c < 5; c++) {
    // Each loop = one independent Agent A with its own did:key identity
    const callerKeys = generateDIDKey();
    const server = new McpServer({ name: `agent-a-${c}`, version: "1.0.0" });
    registerTranslate(server);
    await withXAIP(server, {
      did: AGENT_B_DID,
      dbPath: DB_PATH,
      callerSigner: createSigningDelegate(callerKeys.did.id, callerKeys.privateKey),
      aggregatorUrls: [AGG_URL],
      verbose: false,
    });

    // Call translate twice — receipts are written to shared DB synchronously
    for (let t = 0; t < 2; t++) {
      const start = Date.now();
      await callTool(server, "translate", { text: `こんにちは world ${c}-${t}`, fail: false });
      console.log(`  ✓ translate (${Date.now() - start}ms)`);
    }
  }

  await sleep(300); // let fire-and-forget aggregator pushes settle

  {
    const server = await makeQueryServer(AGENT_B_DID);
    const raw = await callTool(server, "xaip_query");
    printQuery("Agent A", raw);
    const q1 = JSON.parse(raw);
    results.phases.push({ phase: 1, label: "After 10 successes", trust: q1.trust, verdict: q1.verdict, receipts: q1.meta.sampleSize, riskFlags: q1.riskFlags });
  }

  // ── Phase 2: 1 caller × 5 failures ──────────────────────────

  console.log("\n────────────────────────────────────────────────");
  console.log("[Agent A] Executing 5 failing tasks...");

  {
    const callerKeys = generateDIDKey();
    const server = new McpServer({ name: "agent-a-fail", version: "1.0.0" });
    registerTranslate(server);
    await withXAIP(server, {
      did: AGENT_B_DID,
      dbPath: DB_PATH,
      callerSigner: createSigningDelegate(callerKeys.did.id, callerKeys.privateKey),
      aggregatorUrls: [AGG_URL],
      verbose: false,
    });

    for (let t = 0; t < 5; t++) {
      try {
        await callTool(server, "translate", { text: `test ${t}`, fail: true });
      } catch (e: any) {
        const type = e.message?.includes("timeout") ? "timeout" : "error";
        console.log(`  ✗ translate (${type})`);
      }
    }
  }

  await sleep(300);

  {
    const server = await makeQueryServer(AGENT_B_DID);
    const raw = await callTool(server, "xaip_query");
    printQuery("Agent A", raw);
    const q2 = JSON.parse(raw);
    results.phases.push({ phase: 2, label: "After 5 failures", trust: q2.trust, verdict: q2.verdict, receipts: q2.meta.sampleSize, riskFlags: q2.riskFlags });
  }

  // ── Federation: query via Aggregator (global view) ───────────

  console.log("\n────────────────────────────────────────────────");
  console.log("[Federation] Querying aggregator...");

  const aggClient = new AggregatorClient([AGG_URL]);
  const aggResult = await aggClient.query(AGENT_B_DID);
  console.log(
    `[Federation] source: ${aggResult.source} | verdict: ${aggResult.result.verdict}` +
    ` | trust: ${aggResult.result.trust} | receipts: ${aggResult.result.meta.sampleSize}`
  );

  const TRUST_THRESHOLD = 0.6;

  // ── Phase 3: Selection (trust picks the executor) ────────────

  console.log("\n────────────────────────────────────────────────");
  console.log("[Selection] Building Agent B reputation (10 more successes)...");

  // 5 fresh callers × 2 successes each → Agent B trust rises above threshold
  for (let c = 0; c < 5; c++) {
    const callerKeys = generateDIDKey();
    const server = new McpServer({ name: `agent-a-sel-${c}`, version: "1.0.0" });
    registerTranslate(server);
    await withXAIP(server, {
      did: AGENT_B_DID,
      dbPath: DB_PATH,
      callerSigner: createSigningDelegate(callerKeys.did.id, callerKeys.privateKey),
      aggregatorUrls: [AGG_URL],
      verbose: false,
    });
    for (let t = 0; t < 2; t++) {
      await callTool(server, "translate", { text: `sel-warmup-${c}-${t}`, fail: false });
      console.log(`  ✓ translate (Agent B)`);
    }
  }

  await sleep(300);

  // Initialize Agent C
  let AGENT_C_DID: string;
  {
    const server = new McpServer({ name: "agent-c-init", version: "1.0.0" });
    registerTranslate(server);
    const ctx = await withXAIP(server, { dbPath: DB_PATH, verbose: false });
    AGENT_C_DID = ctx.did.id;
    console.log(`\n[Agent C] MCP server ready`);
    console.log(`[Agent C] DID: ${AGENT_C_DID}`);
  }

  // Give Agent C a poor track record: 5 callers, each does 1 success + 2 failures
  // → diverse callers but bad results; flags high_error_rate (not low_caller_diversity)
  console.log("[Selection] Seeding Agent C with poor history (5 callers, mostly failures)...");
  for (let c = 0; c < 5; c++) {
    const callerKeys = generateDIDKey();
    const server = new McpServer({ name: `agent-c-caller-${c}`, version: "1.0.0" });
    registerTranslate(server);
    await withXAIP(server, {
      did: AGENT_C_DID,
      dbPath: DB_PATH,
      callerSigner: createSigningDelegate(callerKeys.did.id, callerKeys.privateKey),
      aggregatorUrls: [AGG_URL],
      verbose: false,
    });
    await callTool(server, "translate", { text: `c-ok-${c}`, fail: false });
    console.log(`  ✓ translate (Agent C)`);
    for (let t = 0; t < 2; t++) {
      try {
        await callTool(server, "translate", { text: `c-fail-${c}-${t}`, fail: true });
      } catch {
        console.log(`  ✗ translate (Agent C, error)`);
      }
    }
  }

  await sleep(300);

  const qB3 = await queryTrustFor(AGENT_B_DID);
  const qC3 = await queryTrustFor(AGENT_C_DID);

  console.log("");
  const selectAgent = (label: string, trust: number) => {
    const passed = trust >= TRUST_THRESHOLD;
    console.log(
      `[Selection] ${label}: trust ${trust} → ${passed ? "✓ SELECTED" : "✗ REJECTED"}`
    );
    return passed;
  };
  const bSelected = selectAgent("Agent B", qB3.trust);
  selectAgent("Agent C", qC3.trust);
  if (qC3.riskFlags.length > 0) {
    console.log(`  flags: [${qC3.riskFlags.join(", ")}]`);
  }

  if (bSelected) {
    console.log("[Selection] Task delegated to Agent B (highest trust)");
  } else {
    console.log("[Selection] No trusted agents available — task SKIPPED");
  }

  // Capture Phase 3 data
  results.phases.push({ phase: 3, label: "After 10 more successes", trust: qB3.trust, verdict: qB3.verdict, receipts: qB3.meta.sampleSize, riskFlags: qB3.riskFlags });
  results.selection.agentB = { trust: qB3.trust, verdict: qB3.verdict, receipts: qB3.meta.sampleSize, riskFlags: qB3.riskFlags, selected: bSelected };
  results.selection.agentC = { trust: qC3.trust, verdict: qC3.verdict, receipts: qC3.meta.sampleSize, riskFlags: qC3.riskFlags, selected: false };
  results.sybil.normalDiversity = qB3.meta.callerDiversity;

  // ── Phase 4: Degradation (trust collapses → auto-excluded) ───

  console.log("\n────────────────────────────────────────────────");
  console.log("[Degradation] Agent B failing...");

  const trustBefore = qB3.trust;

  {
    const callerKeys = generateDIDKey();
    const server = new McpServer({ name: "agent-b-degrade", version: "1.0.0" });
    registerTranslate(server);
    await withXAIP(server, {
      did: AGENT_B_DID,
      dbPath: DB_PATH,
      callerSigner: createSigningDelegate(callerKeys.did.id, callerKeys.privateKey),
      aggregatorUrls: [AGG_URL],
      verbose: false,
    });
    for (let t = 0; t < 15; t++) {
      try {
        await callTool(server, "translate", { text: `degrade-${t}`, fail: true });
      } catch {
        console.log(`  ✗ translate (error)`);
      }
    }
  }

  await sleep(300);

  const qB4 = await queryTrustFor(AGENT_B_DID);
  console.log(`\n[Degradation] Agent B trust: ${trustBefore} → ${qB4.trust}`);

  if (qB4.trust < TRUST_THRESHOLD) {
    console.log(
      `[Degradation] Agent B dropped below threshold (${TRUST_THRESHOLD}) → EXCLUDED`
    );
    console.log("[Degradation] No trusted agents available — task SKIPPED");
  } else {
    console.log(`[Degradation] Agent B still trusted (${qB4.trust})`);
  }

  // Capture Phase 4 data
  results.phases.push({ phase: 4, label: "After 15 failures (degradation)", trust: qB4.trust, verdict: qB4.verdict, receipts: qB4.meta.sampleSize, riskFlags: qB4.riskFlags });

  // ── Phase 5: Sybil Attack (diversity suppresses fake boosting) ─

  console.log("\n────────────────────────────────────────────────");

  let AGENT_D_DID: string;
  {
    const server = new McpServer({ name: "agent-d-init", version: "1.0.0" });
    registerTranslate(server);
    const ctx = await withXAIP(server, { dbPath: DB_PATH, verbose: false });
    AGENT_D_DID = ctx.did.id;
  }

  // Single attacker DID submits 20 success receipts for Agent D
  // → all receipts trace to 1 caller → low diversity → trust suppressed
  console.log("[Sybil Attack] Attacker injecting 20 fake receipts (all did:key)...");

  const attackerKeys = generateDIDKey();
  {
    const server = new McpServer({ name: "agent-d-sybil", version: "1.0.0" });
    registerTranslate(server);
    await withXAIP(server, {
      did: AGENT_D_DID,
      dbPath: DB_PATH,
      callerSigner: createSigningDelegate(attackerKeys.did.id, attackerKeys.privateKey),
      aggregatorUrls: [AGG_URL],
      verbose: false,
    });
    for (let t = 0; t < 20; t++) {
      await callTool(server, "translate", { text: `sybil-boost-${t}`, fail: false });
    }
  }

  await sleep(300);

  const qD5 = await queryTrustFor(AGENT_D_DID);
  console.log(
    `[Sybil Attack] Agent D trust: ${qD5.trust} (diversity: ${qD5.meta.callerDiversity})`
  );
  if (qD5.riskFlags.length > 0) {
    console.log(`  flags: [${qD5.riskFlags.join(", ")}]`);
  }

  if (qD5.trust < TRUST_THRESHOLD) {
    console.log("[Sybil Attack] Agent D → REJECTED (Sybil detected via low diversity)");
  } else {
    console.log(
      `[Sybil Attack] Agent D → WARNING (trust ${qD5.trust} above threshold despite low diversity)`
    );
  }

  // Capture Phase 5 data
  results.sybil.agentD = { trust: qD5.trust, diversity: qD5.meta.callerDiversity, verdict: qD5.verdict, riskFlags: qD5.riskFlags };

  // ── Phase 6: With vs Without XAIP ──────────────────────────────
  console.log("\n────────────────────────────────────────────────");
  console.log("[Phase 6] With vs Without XAIP\n");

  // Three raw servers (no XAIP tracking) — random baseline
  const rawGood = new McpServer({ name: "p6-raw-good", version: "1.0.0" });
  const rawMedium = new McpServer({ name: "p6-raw-medium", version: "1.0.0" });
  const rawBad = new McpServer({ name: "p6-raw-bad", version: "1.0.0" });
  registerTranslateWithRate(rawGood, 0.1);
  registerTranslateWithRate(rawMedium, 0.4);
  registerTranslateWithRate(rawBad, 0.7);

  const randAgents = [
    { label: "Agent Good", server: rawGood },
    { label: "Agent Medium", server: rawMedium },
    { label: "Agent Bad", server: rawBad },
  ];
  const randResults: Record<string, { sym: string; s: number; t: number }> = {
    "Agent Good": { sym: "", s: 0, t: 0 },
    "Agent Medium": { sym: "", s: 0, t: 0 },
    "Agent Bad": { sym: "", s: 0, t: 0 },
  };
  let randTotalSuccess = 0;

  console.log("[Without XAIP] Random agent selection (30 tasks)...");
  for (let i = 0; i < 30; i++) {
    const agent = randAgents[Math.floor(Math.random() * 3)];
    const r = randResults[agent.label];
    r.t++;
    try {
      await callTool(agent.server, "translate", { text: `rand-${i}` });
      r.s++; r.sym += "✓"; randTotalSuccess++;
    } catch { r.sym += "✗"; }
  }
  for (const [label, r] of Object.entries(randResults)) {
    if (r.t > 0) console.log(`  ${label}: ${r.sym} (${r.s}/${r.t})`);
  }
  const randPct = Math.round(randTotalSuccess / 30 * 100);
  console.log(`  Total success: ${randTotalSuccess}/30 (${randPct}%)`);

  // Three executor servers WITH XAIP
  const xGood = new McpServer({ name: "p6-good", version: "1.0.0" });
  const xMedium = new McpServer({ name: "p6-medium", version: "1.0.0" });
  const xBad = new McpServer({ name: "p6-bad", version: "1.0.0" });
  registerTranslateWithRate(xGood, 0.1);
  registerTranslateWithRate(xMedium, 0.4);
  registerTranslateWithRate(xBad, 0.7);
  const ctxGood = await withXAIP(xGood, { dbPath: DB_PATH, verbose: false });
  const ctxMedium = await withXAIP(xMedium, { dbPath: DB_PATH, verbose: false });
  const ctxBad = await withXAIP(xBad, { dbPath: DB_PATH, verbose: false });

  const xaipAgents = [
    { label: "Agent Good", did: ctxGood.did.id, failRate: 0.1 },
    { label: "Agent Medium", did: ctxMedium.did.id, failRate: 0.4 },
    { label: "Agent Bad", did: ctxBad.did.id, failRate: 0.7 },
  ];

  console.log("\n[With XAIP] Trust-based selection (30 tasks)...");
  console.log("Learning phase (15 tasks, 5 per agent)...");

  const learnCallerKeys = generateDIDKey();
  let learnTotalSuccess = 0;
  for (const agent of xaipAgents) {
    const callerServer = new McpServer({ name: `p6-learn-${agent.label}`, version: "1.0.0" });
    registerTranslateWithRate(callerServer, agent.failRate);
    await withXAIP(callerServer, {
      did: agent.did,
      dbPath: DB_PATH,
      callerSigner: createSigningDelegate(learnCallerKeys.did.id, learnCallerKeys.privateKey),
      verbose: false,
    });
    for (let t = 0; t < 5; t++) {
      try {
        await callTool(callerServer, "translate", { text: `learn-${agent.label}-${t}` });
        learnTotalSuccess++;
      } catch { /* expected for bad agent */ }
    }
  }

  await sleep(300);

  const trustScores: Array<{ agent: typeof xaipAgents[0]; trust: number }> = [];
  for (const agent of xaipAgents) {
    const q = await queryTrustFor(agent.did);
    console.log(`  ${agent.label}: trust ${q.trust}`);
    trustScores.push({ agent, trust: q.trust });
  }
  trustScores.sort((a, b) => b.trust - a.trust);
  const bestAgent = trustScores[0].agent;
  console.log(`  → Selecting ${bestAgent.label} (highest trust)`);

  console.log(`Execution phase (15 tasks → ${bestAgent.label})...`);
  const execCallerKeys = generateDIDKey();
  const execServer = new McpServer({ name: "p6-exec", version: "1.0.0" });
  registerTranslateWithRate(execServer, bestAgent.failRate);
  await withXAIP(execServer, {
    did: bestAgent.did,
    dbPath: DB_PATH,
    callerSigner: createSigningDelegate(execCallerKeys.did.id, execCallerKeys.privateKey),
    verbose: false,
  });
  let execSuccess = 0;
  let execSym = "";
  for (let t = 0; t < 15; t++) {
    try {
      await callTool(execServer, "translate", { text: `exec-${t}` });
      execSuccess++; execSym += "✓";
    } catch { execSym += "✗"; }
  }

  const xaipTotal = learnTotalSuccess + execSuccess;
  const xaipTotalPct = Math.round(xaipTotal / 30 * 100);
  const execOnlyPct = Math.round(execSuccess / 15 * 100);

  console.log(`  ${execSym} (${execSuccess}/15)`);
  console.log(`  Total success: ${xaipTotal}/30 (${xaipTotalPct}%) [incl. learning overhead]`);
  console.log(`  Execution-only: ${execSuccess}/15 (${execOnlyPct}%)`);

  console.log("");
  console.log(`[Result] Random: ${randPct}% → XAIP: ${execOnlyPct}% (execution phase)`);
  const improvement = execOnlyPct - randPct;
  if (improvement > 0) {
    console.log(`[Result] XAIP improved success rate by +${improvement}%`);
  } else {
    console.log(`[Result] XAIP execution rate: ${execOnlyPct}% (random baseline: ${randPct}%)`);
  }

  // Capture Phase 6 data
  results.comparison = {
    withoutXAIP: { success: randTotalSuccess, total: 30, pct: randPct },
    withXAIP: { execSuccess, execTotal: 15, execPct: execOnlyPct, totalSuccess: xaipTotal, totalPct: xaipTotalPct },
    improvement,
    selectedAgent: bestAgent.label,
  };

  // ── Write results.js for dashboard ───────────────────────────
  const resultsPath = path.join(process.cwd(), "results.js");
  fs.writeFileSync(resultsPath, `window.XAIP_RESULTS = ${JSON.stringify(results, null, 2)};\n`);
  console.log(`\n[Demo] Dashboard data written to ${resultsPath}`);

  // Cleanup
  console.warn = origWarn;
  aggServer.close();
  fs.rmSync(DB_PATH, { force: true });
  console.log("[Demo] Complete.");
  process.exit(0);
}

main().catch((e) => {
  console.error("[Demo Error]", e);
  process.exit(1);
});
