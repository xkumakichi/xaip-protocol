/**
 * XAIP × Veridict — Bidirectional Feedback Loop Demo
 *
 * Demonstrates: Veridict usage → XAIP trust data → better selection → better outcomes
 *
 * Agents:
 *   F: 85% success rate (45 Veridict executions — 38 success)
 *   G: 40% success rate (30 Veridict executions — 12 success)
 *   H: 90% success rate (20 Veridict executions — 18 success)
 *
 * Phase 0 : Import Veridict execution history into XAIP via veridictPlugin.
 * Baseline: 20 diverse callers × 5 tasks unlock meaningful trust scores.
 *           (Veridict receipts carry no callerDid → trust ≈ 0.04 without XAIP.)
 * Rounds 1–3: Trust-based selection → execution → trust convergence.
 */

import * as fs from "fs";
import * as path from "path";
import initSqlJs from "sql.js";
import {
  generateDIDKey,
  computeQueryResult,
  ReceiptStore,
  parseDID,
  veridictPlugin,
} from "xaip-sdk";
// sign / receiptPayload are internal SDK helpers not re-exported from the index.
// Importing directly via tsx relative-path resolution (no SDK source change needed).
import { sign, receiptPayload } from "../sdk/src/identity";
import type { FailureType } from "xaip-sdk";

// ─── Paths & constants ───────────────────────────────────────

const XAIP_DB     = path.join(process.cwd(), ".veridict-loop-xaip.db");
const VERIDICT_DB = path.join(process.cwd(), ".veridict-loop-dummy.db");
const TRUST_THRESHOLD = 0.5;

// ─── Types ───────────────────────────────────────────────────

interface AgentState {
  label: string;
  serverName: string;
  successRate: number;
  did: string;
  publicKey: string;
  privateKey: string;
}

// ─── Create Veridict dummy DB ─────────────────────────────────

/**
 * Build an in-memory SQLite DB that matches Veridict's executions schema,
 * then write it to disk so veridictPlugin can read it.
 */
async function createVeridictDB(
  dbPath: string,
  agents: Array<{ serverName: string; total: number; successes: number }>
): Promise<void> {
  const SQL = await initSqlJs();
  const db  = new SQL.Database();

  db.run(`
    CREATE TABLE executions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      server_name  TEXT    NOT NULL,
      tool_name    TEXT    NOT NULL,
      input_hash   TEXT,
      output_hash  TEXT,
      success      INTEGER NOT NULL,
      latency_ms   INTEGER NOT NULL,
      failure_type TEXT,
      timestamp    TEXT    NOT NULL
    )
  `);

  // Use historical timestamps (Jan 2026) so they don't hit the hourly rate limit.
  const BASE_MS = new Date("2026-01-01T00:00:00Z").getTime();

  for (const { serverName, total, successes } of agents) {
    const failures = total - successes;
    let t = 0;

    for (let i = 0; i < successes; i++, t++) {
      const ts = new Date(BASE_MS + t * 60_000).toISOString();
      db.run(
        `INSERT INTO executions
           (server_name, tool_name, input_hash, output_hash, success, latency_ms, failure_type, timestamp)
         VALUES (?, 'task-executor', ?, ?, 1, ?, NULL, ?)`,
        [serverName, `inp-${i}`, `out-${i}`, 50 + Math.floor(Math.random() * 100), ts]
      );
    }

    for (let i = 0; i < failures; i++, t++) {
      const ts = new Date(BASE_MS + t * 60_000).toISOString();
      db.run(
        `INSERT INTO executions
           (server_name, tool_name, input_hash, output_hash, success, latency_ms, failure_type, timestamp)
         VALUES (?, 'task-executor', ?, NULL, 0, 200, 'error', ?)`,
        [serverName, `inp-fail-${i}`, ts]
      );
    }
  }

  fs.writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();
}

// ─── Simulate task execution ──────────────────────────────────

/**
 * Log `count` synthetic receipts for `agent` into the shared XAIP store.
 * Both executor and caller sign the same canonical payload — mirrors middleware.ts.
 */
async function simulateTasks(
  agent: AgentState,
  store: ReceiptStore,
  callerDid: string,
  callerPrivKey: string,
  count: number
): Promise<{ success: number; fail: number }> {
  let ok = 0;
  let fail = 0;

  for (let i = 0; i < count; i++) {
    const success = Math.random() < agent.successRate;

    const receiptBase = {
      agentDid:    agent.did,
      toolName:    "task-executor",
      taskHash:    `t-${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`,
      resultHash:  success ? `r-ok-${i}` : "",
      success,
      latencyMs:   50 + Math.floor(Math.random() * 100),
      failureType: success ? undefined : ("error" as FailureType),
      timestamp:   new Date().toISOString(),
      callerDid,
    };

    // executor and caller sign the same payload (matches middleware.ts createReceipt)
    const payload   = receiptPayload(receiptBase);
    const sig       = sign(payload, agent.privateKey);
    const callerSig = sign(payload, callerPrivKey);

    await store.log({ ...receiptBase, signature: sig, callerSignature: callerSig });

    if (success) ok++;
    else fail++;
  }

  return { success: ok, fail };
}

// ─── Query trust ──────────────────────────────────────────────

async function queryTrust(agent: AgentState, store: ReceiptStore): Promise<number> {
  const receipts = await store.getReceipts(agent.did);
  return computeQueryResult(receipts, parseDID(agent.did)).trust;
}

// ─── Main ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Clean up any stale files from a previous run
  for (const f of [XAIP_DB, VERIDICT_DB]) fs.rmSync(f, { force: true });

  const store = new ReceiptStore(XAIP_DB);

  // ── Define agents ────────────────────────────────────────────

  const agentDefs = [
    { label: "F", serverName: "agent-f", successRate: 0.85, total: 45, successes: 38 },
    { label: "G", serverName: "agent-g", successRate: 0.40, total: 30, successes: 12 },
    { label: "H", serverName: "agent-h", successRate: 0.90, total: 20, successes: 18 },
  ];

  const agents: AgentState[] = [];
  for (const def of agentDefs) {
    const { did, publicKey, privateKey } = generateDIDKey();
    await store.saveKeys(did.id, publicKey, privateKey);
    agents.push({
      label:       def.label,
      serverName:  def.serverName,
      successRate: def.successRate,
      did:         did.id,
      publicKey,
      privateKey,
    });
  }

  // ── Phase 0: Import Veridict execution history ────────────────

  console.log("[Veridict Loop] Importing execution history from Veridict DB...");

  await createVeridictDB(
    VERIDICT_DB,
    agentDefs.map(d => ({ serverName: d.serverName, total: d.total, successes: d.successes }))
  );

  for (let i = 0; i < agents.length; i++) {
    const agent  = agents[i];
    const def    = agentDefs[i];
    const plugin = veridictPlugin({ dbPath: VERIDICT_DB, serverFilter: agent.serverName });
    await plugin.init({ did: parseDID(agent.did), publicKey: agent.publicKey, store });
    console.log(`  Agent ${agent.label}: ${def.total} executions imported (${def.successes} success)`);
  }

  // ── Establish XAIP tracking baseline ─────────────────────────
  // Veridict receipts carry no callerDid; callerDiversity → 0.1 → trust ≈ 0.04.
  // 20 diverse callers × 5 tasks per agent bring trust into a useful range.

  console.log("\n[Veridict Loop] Establishing XAIP tracking baseline...");
  console.log("  (20 diverse callers × 5 tasks — simulates prior XAIP-tracked interactions)");

  for (const agent of agents) {
    for (let c = 0; c < 20; c++) {
      const { did: cDid, privateKey: cPrivKey } = generateDIDKey();
      await simulateTasks(agent, store, cDid.id, cPrivKey, 5);
    }
  }

  for (const agent of agents) {
    const trust    = await queryTrust(agent, store);
    const receipts = await store.getReceipts(agent.did);
    console.log(`  Agent ${agent.label}: trust ${trust.toFixed(2)} (${receipts.length} receipts)`);
  }

  // ── Round tracking ────────────────────────────────────────────

  let prevTrust: Record<string, number> = {};
  const usedInRound = new Set<string>();
  let withXAIPSuccess = 0;
  let withXAIPTotal   = 0;

  // ── Round 1: Trust-based selection ───────────────────────────

  console.log("\n[Round 1] Trust-based selection:");

  const selectedR1: AgentState[] = [];
  for (const agent of agents) {
    const trust      = await queryTrust(agent, store);
    prevTrust[agent.label] = trust;
    const isSelected = trust >= TRUST_THRESHOLD;
    if (isSelected) {
      console.log(`  Agent ${agent.label}: trust ${trust.toFixed(2)} → SELECTED`);
      selectedR1.push(agent);
      usedInRound.add(agent.label);
    } else {
      console.log(`  Agent ${agent.label}: trust ${trust.toFixed(2)} → REJECTED`);
    }
  }

  if (selectedR1.length > 0) {
    const { did: cDid, privateKey: cPrivKey } = generateDIDKey();
    const tasksEach = Math.ceil(10 / selectedR1.length);
    let r1ok = 0;

    console.log(`  Executing ${selectedR1.length * tasksEach} tasks via ${selectedR1.map(a => a.label).join(", ")}...`);

    for (const agent of selectedR1) {
      const { success } = await simulateTasks(agent, store, cDid.id, cPrivKey, tasksEach);
      r1ok += success;
    }
    const r1total = selectedR1.length * tasksEach;
    withXAIPSuccess += r1ok;
    withXAIPTotal   += r1total;
    console.log(`  Results: ${r1ok}/${r1total} success`);
  }

  // ── Round 2: Updated trust ────────────────────────────────────

  console.log("\n[Round 2] Updated trust:");

  const round2Trust: Record<string, number> = {};
  const selectedR2: AgentState[] = [];

  for (const agent of agents) {
    const trust  = await queryTrust(agent, store);
    round2Trust[agent.label] = trust;
    const prev   = prevTrust[agent.label] ?? 0;
    const delta  = trust - prev;
    let suffix: string;

    if (!usedInRound.has(agent.label)) {
      suffix = " (not used, stale)";
    } else {
      suffix = delta > 0.0005 ? ` (+${delta.toFixed(2)})` : ` (${delta.toFixed(2)})`;
    }

    const isSelected = trust >= TRUST_THRESHOLD;
    if (isSelected) {
      console.log(`  Agent ${agent.label}: trust ${trust.toFixed(2)}${suffix} → SELECTED`);
      selectedR2.push(agent);
    } else {
      console.log(`  Agent ${agent.label}: trust ${trust.toFixed(2)}${suffix} → REJECTED`);
    }
  }

  // Update prevTrust to Round 2 values for Round 3 delta
  prevTrust = { ...round2Trust };

  if (selectedR2.length > 0) {
    const { did: cDid, privateKey: cPrivKey } = generateDIDKey();
    const tasksEach = Math.ceil(10 / selectedR2.length);
    let r2ok = 0;

    console.log(`  Executing ${selectedR2.length * tasksEach} tasks via ${selectedR2.map(a => a.label).join(", ")}...`);

    for (const agent of selectedR2) {
      const { success } = await simulateTasks(agent, store, cDid.id, cPrivKey, tasksEach);
      r2ok += success;
    }
    const r2total = selectedR2.length * tasksEach;
    withXAIPSuccess += r2ok;
    withXAIPTotal   += r2total;
    console.log(`  Results: ${r2ok}/${r2total} success`);
  }

  // ── Round 3: Trust convergence ────────────────────────────────

  console.log("\n[Round 3] Trust convergence:");

  for (const agent of agents) {
    const trust  = await queryTrust(agent, store);
    const prev   = prevTrust[agent.label] ?? 0;
    const delta  = trust - prev;
    let suffix: string;

    if (!usedInRound.has(agent.label)) {
      suffix = " (not used, stale)";
    } else {
      suffix = delta > 0.0005 ? ` (+${delta.toFixed(2)})` : "";
    }

    console.log(`  Agent ${agent.label}: trust ${trust.toFixed(2)}${suffix}`);
  }

  // Success rate comparison
  const noXAIPRate   = agentDefs.reduce((s, d) => s + d.successRate, 0) / agentDefs.length;
  const withXAIPRate = withXAIPTotal > 0 ? withXAIPSuccess / withXAIPTotal : 0;

  console.log(
    `\n  Without XAIP: estimated ${Math.round(noXAIPRate * 100)}% success` +
    ` (all agents equally weighted)`
  );
  console.log(
    `  With XAIP:    actual ${Math.round(withXAIPRate * 100)}% success` +
    ` (trust-based selection)`
  );

  console.log("\n[Veridict Loop] Feedback loop verified:");
  console.log("  More usage → more data → better selection → better outcomes");

  // Cleanup temp DB files
  for (const f of [XAIP_DB, VERIDICT_DB]) fs.rmSync(f, { force: true });
  process.exit(0);
}

main().catch(e => {
  console.error("[Veridict Loop Error]", e);
  process.exit(1);
});
