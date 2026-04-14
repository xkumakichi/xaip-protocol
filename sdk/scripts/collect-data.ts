/**
 * XAIP Phase 1 — Data Collection Harness
 *
 * Connects to real MCP servers as a client, runs diverse tool calls,
 * and records execution logs into Veridict's SQLite schema.
 *
 * Usage: npx tsx scripts/collect-data.ts [--clean-server=slug]
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import initSqlJs from "sql.js";

// ── Types ───────────────────────────────────────────────────────────

interface ServerConfig {
  slug: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  /** Custom test runner (for 2-phase flows like context7) */
  customRunner?: (client: Client, recorder: Recorder) => Promise<void>;
  /** Per-tool test input generators. Key = tool name pattern (substring match). */
  inputs?: Record<string, Record<string, unknown>[]>;
}

interface Recorder {
  record(tool: string, input: unknown, fn: () => Promise<any>): Promise<void>;
  stats: { total: number; success: number; fail: number };
}

// ── Utilities ────────────────────────────────────────────────────────

const HOME = homedir();

function sha256(data: unknown): string {
  return createHash("sha256").update(JSON.stringify(data)).digest("hex").slice(0, 16);
}

function classifyFailure(error: Error | string, latencyMs: number): "timeout" | "validation" | "error" {
  const msg = (typeof error === "string" ? error : error.message).toLowerCase();
  if (latencyMs >= 30000 || /timeout|etimedout|timed out|aborted/.test(msg)) return "timeout";
  if (/valid|schema|parse|type error|expected/.test(msg)) return "validation";
  return "error";
}

function log(msg: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

// ── Server Configs ──────────────────────────────────────────────────

const RESOLVE_QUERIES = [
  "react", "vue", "express", "next.js", "fastify", "svelte", "angular",
  "hono", "xrpl.js", "ethers", "typescript", "zod", "drizzle orm", "prisma",
  "tailwindcss", "langchain", "openai node", "anthropic sdk", "vitest",
  "jest", "playwright", "deno std", "bun", "sql.js", "cloudflare workers",
  "nestjs", "nuxt", "remix", "astro", "solid.js", "lit", "htmx",
  "trpc", "graphql", "axios", "swr", "tanstack query", "zustand",
  "jotai", "pinia", "effect ts", "fp-ts",
];

const DOC_QUERIES = [
  "How to create a component with hooks",
  "Middleware error handling patterns",
  "Server-side rendering setup",
  "Database migration guide",
  "Authentication middleware",
  "WebSocket real-time events",
  "Testing with mocks",
  "Dependency injection pattern",
  "CLI tool configuration",
  "REST API route definition",
  "Type-safe query builder",
  "Environment variable configuration",
  "Logging and observability",
  "Cache invalidation strategy",
  "File upload handling",
  "Rate limiting implementation",
  "Pagination with cursor",
  "Error boundary pattern",
  "State management setup",
  "Build and deploy configuration",
];

const THINKING_TOPICS = [
  ["What are the key considerations for building a trust scoring system for AI agents?", 3],
  ["How should we handle cascading failures in multi-agent systems?", 3],
  ["What's the optimal database schema for a multi-tenant SaaS?", 3],
  ["How to implement rate limiting in a distributed system?", 2],
  ["What are the tradeoffs between microservices and monolith?", 3],
  ["How to ensure data consistency in event-driven architecture?", 2],
  ["What testing strategy works best for complex APIs?", 3],
  ["How to design a secure authentication system?", 3],
  ["What's the best approach to API versioning?", 2],
  ["How to implement real-time features at scale?", 3],
  ["What are the implications of AI agents making autonomous financial decisions?", 3],
  ["How should we design a plugin architecture?", 2],
  ["What's the best way to handle configuration management?", 2],
  ["How to implement zero-downtime deployments?", 3],
  ["What's the optimal caching strategy for a read-heavy API?", 2],
  ["How to build a resilient message queue consumer?", 3],
  ["What are the security considerations for MCP servers?", 3],
  ["How should we implement observability in a microservice?", 3],
  ["What's the best approach to database connection pooling?", 2],
  ["How to design an effective CI/CD pipeline?", 3],
] as [string, number][];

const FS_EXISTING_FILES = [
  ".gitconfig", ".npmrc",
  "xaip-protocol/README.md", "xaip-protocol/package.json",
  "xaip-protocol/XAIP-SPEC.md", "xaip-protocol/CLAUDE.md",
  "xaip-protocol/sdk/package.json", "xaip-protocol/sdk/tsconfig.json",
  "xaip-protocol/sdk/src/index.ts", "xaip-protocol/sdk/src/types.ts",
  "xaip-protocol/sdk/src/score.ts", "xaip-protocol/sdk/src/identity.ts",
  "xaip-protocol/sdk/src/aggregator.ts", "xaip-protocol/sdk/src/middleware.ts",
  "xaip-protocol/services/trust-api/src/index.ts",
  "xaip-protocol/services/trust-api/wrangler.toml",
  "veridict/README.md", "veridict/package.json",
  "veridict/src/index.ts", "veridict/src/types.ts",
  "veridict/src/trust.ts", "veridict/src/store.ts",
].map(p => join(HOME, p));

const FS_NONEXISTENT = [
  "nonexistent-file-abc123.txt",
  "fake-project/index.ts",
  "xaip-protocol/missing.json",
].map(p => join(HOME, p));

const FS_DIRS = [
  "", "xaip-protocol", "xaip-protocol/sdk", "xaip-protocol/sdk/src",
  "xaip-protocol/sdk/tests", "xaip-protocol/services",
  "xaip-protocol/demo", "xaip-protocol/schemas",
  "veridict", "veridict/src", ".claude",
].map(p => join(HOME, p));

const FS_SEARCH = [
  ["xaip-protocol", "trust"], ["xaip-protocol", "aggregator"],
  ["xaip-protocol", "veridict"], ["xaip-protocol", "receipt"],
  ["xaip-protocol", "SEED_SCORES"], ["xaip-protocol", "bayesian"],
  ["xaip-protocol/sdk/src", "export"], ["xaip-protocol/sdk/src", "import"],
  ["veridict", "canITrust"], ["veridict", "middleware"],
  ["veridict", "success"], ["veridict", "failure"],
] as [string, string][];

const SERVERS: ServerConfig[] = [
  {
    slug: "context7",
    command: "npx",
    args: ["-y", "@upstash/context7-mcp"],
    customRunner: async (client, recorder) => {
      // Phase 1: resolve library IDs (requires both query + libraryName)
      const resolvedIds: string[] = [];
      for (const libraryName of RESOLVE_QUERIES) {
        const query = `How to use ${libraryName}`;
        await recorder.record("resolve-library-id", { query, libraryName }, async () => {
          const result = await client.callTool(
            { name: "resolve-library-id", arguments: { query, libraryName } },
            undefined,
            { timeout: 15000 },
          );
          // Extract libraryId from the text result (format: /org/project)
          const text = (result as any).content?.[0]?.text ?? "";
          const match = text.match(/(\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/);
          if (match && !(result as any).isError) {
            resolvedIds.push(match[1]);
          }
          return result;
        });
      }
      log(`  Resolved ${resolvedIds.length} library IDs`);

      // Phase 2: query docs using resolved IDs (requires libraryId + query)
      const idsToQuery = resolvedIds.length > 0 ? resolvedIds : ["/vercel/next.js"];
      for (let i = 0; i < DOC_QUERIES.length; i++) {
        const libraryId = idsToQuery[i % idsToQuery.length];
        const query = DOC_QUERIES[i];
        await recorder.record("query-docs", { libraryId, query }, async () => {
          return await client.callTool(
            { name: "query-docs", arguments: { libraryId, query } },
            undefined,
            { timeout: 30000 },
          );
        });
      }
    },
  },
  {
    slug: "sequential-thinking",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
    customRunner: async (client, recorder) => {
      for (const [topic, totalThoughts] of THINKING_TOPICS) {
        for (let i = 1; i <= totalThoughts; i++) {
          const thought = i === 1
            ? topic
            : `Continuing analysis of: ${topic} — step ${i} of ${totalThoughts}`;
          await recorder.record("sequentialthinking", { thought, thoughtNumber: i, totalThoughts, nextThoughtNeeded: i < totalThoughts }, async () => {
            return await client.callTool(
              { name: "sequentialthinking", arguments: { thought, thoughtNumber: i, totalThoughts, nextThoughtNeeded: i < totalThoughts } },
              undefined,
              { timeout: 15000 },
            );
          });
        }
      }
    },
  },
  {
    slug: "filesystem",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", HOME],
    customRunner: async (client, recorder) => {
      // read_file — existing files
      for (const path of FS_EXISTING_FILES) {
        await recorder.record("read_file", { path }, async () => {
          return await client.callTool({ name: "read_file", arguments: { path } }, undefined, { timeout: 10000 });
        });
      }
      // read_file — nonexistent (expected errors)
      for (const path of FS_NONEXISTENT) {
        await recorder.record("read_file", { path }, async () => {
          return await client.callTool({ name: "read_file", arguments: { path } }, undefined, { timeout: 10000 });
        });
      }
      // list_directory
      for (const path of FS_DIRS) {
        await recorder.record("list_directory", { path }, async () => {
          return await client.callTool({ name: "list_directory", arguments: { path } }, undefined, { timeout: 10000 });
        });
      }
      // list_directory nonexistent
      await recorder.record("list_directory", { path: join(HOME, "nonexistent-dir-xyz") }, async () => {
        return await client.callTool({ name: "list_directory", arguments: { path: join(HOME, "nonexistent-dir-xyz") } }, undefined, { timeout: 10000 });
      });
      // search_files
      for (const [dir, pattern] of FS_SEARCH) {
        const path = join(HOME, dir);
        await recorder.record("search_files", { path, pattern }, async () => {
          return await client.callTool({ name: "search_files", arguments: { path, pattern } }, undefined, { timeout: 30000 });
        });
      }
      // get_file_info
      for (const path of FS_EXISTING_FILES.slice(0, 10)) {
        await recorder.record("get_file_info", { path }, async () => {
          return await client.callTool({ name: "get_file_info", arguments: { path } }, undefined, { timeout: 10000 });
        });
      }
      // directory_tree
      for (const dir of ["xaip-protocol/sdk/src", "veridict/src", "xaip-protocol/services"]) {
        const path = join(HOME, dir);
        await recorder.record("directory_tree", { path }, async () => {
          return await client.callTool({ name: "directory_tree", arguments: { path } }, undefined, { timeout: 15000 });
        });
      }
    },
  },
];

// ── SQLite ───────────────────────────────────────────────────────────

async function openDb() {
  const SQL = await initSqlJs();
  const dbDir = join(HOME, ".veridict");
  const dbPath = join(dbDir, "executions.db");

  if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });

  let db: InstanceType<typeof SQL.Database>;
  if (existsSync(dbPath)) {
    const buf = readFileSync(dbPath);
    db = new SQL.Database(new Uint8Array(buf));
  } else {
    db = new SQL.Database();
  }

  db.run(`CREATE TABLE IF NOT EXISTS executions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_name TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    input_hash TEXT NOT NULL,
    output_hash TEXT,
    success INTEGER NOT NULL,
    latency_ms INTEGER NOT NULL,
    error_message TEXT,
    failure_type TEXT DEFAULT NULL,
    timestamp TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_server_tool ON executions(server_name, tool_name)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_timestamp ON executions(timestamp)`);
  try { db.run(`ALTER TABLE executions ADD COLUMN failure_type TEXT DEFAULT NULL`); } catch { /* exists */ }

  const flush = () => writeFileSync(dbPath, Buffer.from(db.export()));
  return { db, flush, dbPath };
}

// ── Recorder ─────────────────────────────────────────────────────────

function createRecorder(db: any, serverSlug: string): Recorder {
  const stats = { total: 0, success: 0, fail: 0 };

  return {
    stats,
    async record(tool: string, input: unknown, fn: () => Promise<any>) {
      const inputHash = sha256(input);
      const start = Date.now();
      try {
        const result = await fn();
        const latencyMs = Date.now() - start;
        const isError = result?.isError === true;
        const outputHash = sha256(result);

        db.run(
          `INSERT INTO executions (server_name, tool_name, input_hash, output_hash, success, latency_ms, error_message, failure_type, timestamp) VALUES (?,?,?,?,?,?,?,?,datetime('now'))`,
          [serverSlug, tool, inputHash, outputHash, isError ? 0 : 1, latencyMs,
           isError ? JSON.stringify(result?.content?.[0]?.text ?? "error").slice(0, 500) : null,
           isError ? "error" : null],
        );
        if (isError) { stats.fail++; process.stdout.write("×"); }
        else { stats.success++; process.stdout.write("."); }
      } catch (err: any) {
        const latencyMs = Date.now() - start;
        const failType = classifyFailure(err, latencyMs);
        db.run(
          `INSERT INTO executions (server_name, tool_name, input_hash, output_hash, success, latency_ms, error_message, failure_type, timestamp) VALUES (?,?,?,?,0,?,?,?,datetime('now'))`,
          [serverSlug, tool, inputHash, "", latencyMs,
           (err.message ?? String(err)).slice(0, 500), failType],
        );
        stats.fail++;
        process.stdout.write(failType === "timeout" ? "T" : "×");
      }
      stats.total++;
    },
  };
}

// ── Server Runner ────────────────────────────────────────────────────

async function testServer(config: ServerConfig, db: any, flush: () => void): Promise<number> {
  log(`── ${config.slug} ──────────────────────`);
  log(`Spawning: ${config.command} ${config.args.join(" ")}`);

  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: { ...process.env, ...config.env } as Record<string, string>,
    stderr: "pipe",
  });

  const client = new Client(
    { name: "xaip-collector", version: "1.0.0" },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);
    log(`Connected to ${config.slug}`);
  } catch (err: any) {
    log(`FAILED to connect to ${config.slug}: ${err.message}`);
    return 0;
  }

  // Discover tools
  try {
    const result = await client.listTools();
    log(`Found ${result.tools.length} tools: ${result.tools.map(t => t.name).join(", ")}`);
  } catch (err: any) {
    log(`FAILED to list tools: ${err.message}`);
    await client.close();
    return 0;
  }

  const recorder = createRecorder(db, config.slug);

  if (config.customRunner) {
    await config.customRunner(client, recorder);
  }

  console.log();
  flush();
  const { total, success, fail } = recorder.stats;
  log(`  ${config.slug}: ${total} calls, ${success} success, ${fail} fail (${((success/Math.max(total,1))*100).toFixed(1)}%)`);

  try { await client.close(); } catch { /* ignore */ }
  return total;
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║  XAIP Phase 1 — Data Collection Harness ║");
  console.log("╚══════════════════════════════════════════╝\n");

  const { db, flush, dbPath } = await openDb();
  log(`Database: ${dbPath}`);

  // Handle --clean-server flag
  const cleanArg = process.argv.find(a => a.startsWith("--clean-server="));
  if (cleanArg) {
    const slug = cleanArg.split("=")[1];
    db.run("DELETE FROM executions WHERE server_name = ?", [slug]);
    flush();
    log(`Cleaned data for server: ${slug}`);
  }

  const existing = db.exec("SELECT COUNT(*) FROM executions");
  log(`Existing rows: ${existing[0]?.values[0]?.[0] ?? 0}\n`);

  let grandTotal = 0;
  for (const server of SERVERS) {
    try {
      grandTotal += await testServer(server, db, flush);
    } catch (err: any) {
      log(`Server ${server.slug} failed entirely: ${err.message}`);
    }
    console.log();
  }

  flush();

  // Summary
  const finalCount = db.exec("SELECT COUNT(*) FROM executions");
  console.log("╔══════════════════════════════════════════╗");
  console.log("║  Collection Complete                     ║");
  console.log("╚══════════════════════════════════════════╝");
  log(`New calls this run: ${grandTotal}`);
  log(`Total rows in DB: ${finalCount[0]?.values[0]?.[0] ?? 0}`);

  const stats = db.exec(`
    SELECT server_name, COUNT(*) as total, SUM(success) as successes, ROUND(AVG(latency_ms)) as avg_latency
    FROM executions GROUP BY server_name ORDER BY server_name
  `);
  if (stats[0]) {
    console.log("\nServer              | Total | Success | Avg Latency");
    console.log("────────────────────|───────|─────────|────────────");
    for (const row of stats[0].values) {
      const [name, total, succ, lat] = row;
      const rate = ((Number(succ) / Number(total)) * 100).toFixed(1);
      console.log(`${String(name).padEnd(20)}| ${String(total).padStart(5)} | ${rate.padStart(6)}% | ${String(lat).padStart(7)}ms`);
    }
  }

  db.close();
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
