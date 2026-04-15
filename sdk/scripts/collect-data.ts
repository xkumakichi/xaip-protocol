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

// ── Memory Server Data ───────────────────────────────────────────────

const MEMORY_ENTITIES = [
  { name: "AI Agent", entityType: "concept", observations: ["Autonomous software entity", "Can execute tasks independently", "Has goals and capabilities"] },
  { name: "Trust Score", entityType: "metric", observations: ["Numerical measure of reliability", "Computed from execution history", "Range 0.0 to 1.0"] },
  { name: "MCP Protocol", entityType: "protocol", observations: ["Model Context Protocol by Anthropic", "Enables tool use for LLMs", "Standardized server-client interface"] },
  { name: "XAIP Protocol", entityType: "project", observations: ["Cross-Agent Identity Protocol", "Provides trust infrastructure", "Built on Veridict monitoring"] },
  { name: "Veridict", entityType: "library", observations: ["Trust scoring library", "Records execution logs", "Bayesian success rate computation"] },
  { name: "Cloudflare Worker", entityType: "platform", observations: ["Edge compute platform", "Serverless execution", "Global distribution"] },
  { name: "BFT Quorum", entityType: "algorithm", observations: ["Byzantine Fault Tolerance", "Multi-node consensus", "MAD outlier detection"] },
  { name: "Aggregator Node", entityType: "service", observations: ["Collects trust receipts", "Verifies cryptographic signatures", "Stores execution history"] },
  { name: "Receipt", entityType: "data", observations: ["Signed execution record", "Contains success/failure info", "Includes latency data"] },
  { name: "DID", entityType: "identifier", observations: ["Decentralized Identifier", "Cryptographic identity", "Used for agent identification"] },
];

const MEMORY_RELATIONS = [
  { from: "XAIP Protocol", to: "Veridict", relationType: "uses" },
  { from: "XAIP Protocol", to: "Aggregator Node", relationType: "consists_of" },
  { from: "AI Agent", to: "MCP Protocol", relationType: "communicates_via" },
  { from: "Aggregator Node", to: "Receipt", relationType: "stores" },
  { from: "BFT Quorum", to: "Aggregator Node", relationType: "coordinates" },
  { from: "Trust Score", to: "Receipt", relationType: "computed_from" },
  { from: "AI Agent", to: "DID", relationType: "identified_by" },
  { from: "Cloudflare Worker", to: "XAIP Protocol", relationType: "hosts" },
];

// ── Puppeteer / Playwright URLs ──────────────────────────────────────

const BROWSER_URLS = [
  "https://example.com",
  "https://httpbin.org/html",
  "https://httpbin.org/json",
  "https://jsonplaceholder.typicode.com",
];

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
  // ── Memory Server ─────────────────────────────────────────────────
  {
    slug: "memory",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    customRunner: async (client, recorder) => {
      // create_entities — create all test entities
      for (const entity of MEMORY_ENTITIES) {
        await recorder.record("create_entities", { entities: [entity] }, async () => {
          return await client.callTool(
            { name: "create_entities", arguments: { entities: [{ name: entity.name, entityType: entity.entityType, observations: entity.observations }] } },
            undefined,
            { timeout: 10000 },
          );
        });
      }

      // create_relations — add relations between entities
      for (const rel of MEMORY_RELATIONS) {
        await recorder.record("create_relations", { relations: [rel] }, async () => {
          return await client.callTool(
            { name: "create_relations", arguments: { relations: [rel] } },
            undefined,
            { timeout: 10000 },
          );
        });
      }

      // add_observations — add more observations to existing entities
      const observationBatches = [
        { entityName: "AI Agent", contents: ["Executes tool calls via MCP", "Monitored by XAIP protocol"] },
        { entityName: "Trust Score", contents: ["Used for agent selection", "Updated after each execution"] },
        { entityName: "MCP Protocol", contents: ["Uses stdio transport", "JSON-RPC based messages"] },
        { entityName: "XAIP Protocol", contents: ["v0.4.0 currently deployed", "Phase 1 collecting real data"] },
        { entityName: "Veridict", contents: ["npm package available", "Integrates with SQLite"] },
        { entityName: "Cloudflare Worker", contents: ["Used for Trust API", "Used for Aggregator"] },
      ];
      for (const batch of observationBatches) {
        await recorder.record("add_observations", batch, async () => {
          return await client.callTool(
            { name: "add_observations", arguments: { observations: [batch] } },
            undefined,
            { timeout: 10000 },
          );
        });
      }

      // search_nodes — search for entities by various queries
      const searchQueries = [
        "AI", "trust", "protocol", "XAIP", "agent",
        "MCP", "Cloudflare", "receipt", "DID", "score",
      ];
      for (const query of searchQueries) {
        await recorder.record("search_nodes", { query }, async () => {
          return await client.callTool(
            { name: "search_nodes", arguments: { query } },
            undefined,
            { timeout: 10000 },
          );
        });
      }

      // read_graph — read full graph multiple times
      for (let i = 0; i < 3; i++) {
        await recorder.record("read_graph", {}, async () => {
          return await client.callTool(
            { name: "read_graph", arguments: {} },
            undefined,
            { timeout: 10000 },
          );
        });
      }

      // delete_entities — cleanup a few test entities
      const toDelete = ["Cloudflare Worker", "BFT Quorum", "DID"];
      for (const entityName of toDelete) {
        await recorder.record("delete_entities", { entityNames: [entityName] }, async () => {
          return await client.callTool(
            { name: "delete_entities", arguments: { entityNames: [entityName] } },
            undefined,
            { timeout: 10000 },
          );
        });
      }
    },
  },
  // ── Puppeteer Server ──────────────────────────────────────────────
  {
    slug: "puppeteer",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-puppeteer"],
    customRunner: async (client, recorder) => {
      for (const url of BROWSER_URLS) {
        // Navigate
        await recorder.record("puppeteer_navigate", { url }, async () => {
          return await client.callTool(
            { name: "puppeteer_navigate", arguments: { url } },
            undefined,
            { timeout: 30000 },
          );
        });

        // Screenshot
        await recorder.record("puppeteer_screenshot", { name: `shot_${url.replace(/[^a-z0-9]/gi, "_")}` }, async () => {
          return await client.callTool(
            { name: "puppeteer_screenshot", arguments: { name: `shot_${url.replace(/[^a-z0-9]/gi, "_")}` } },
            undefined,
            { timeout: 30000 },
          );
        });

        // Evaluate — document.title
        await recorder.record("puppeteer_evaluate", { script: "document.title" }, async () => {
          return await client.callTool(
            { name: "puppeteer_evaluate", arguments: { script: "document.title" } },
            undefined,
            { timeout: 15000 },
          );
        });

        // Evaluate — count links
        await recorder.record("puppeteer_evaluate", { script: "document.querySelectorAll('a').length" }, async () => {
          return await client.callTool(
            { name: "puppeteer_evaluate", arguments: { script: "document.querySelectorAll('a').length" } },
            undefined,
            { timeout: 15000 },
          );
        });

        // Click first link (may fail — good for real failure data)
        await recorder.record("puppeteer_click", { selector: "a" }, async () => {
          return await client.callTool(
            { name: "puppeteer_click", arguments: { selector: "a" } },
            undefined,
            { timeout: 15000 },
          );
        });

        // Navigate back after click
        await recorder.record("puppeteer_navigate", { url }, async () => {
          return await client.callTool(
            { name: "puppeteer_navigate", arguments: { url } },
            undefined,
            { timeout: 30000 },
          );
        });

        // Click button (will fail on pages without buttons — expected)
        await recorder.record("puppeteer_click", { selector: "button" }, async () => {
          return await client.callTool(
            { name: "puppeteer_click", arguments: { selector: "button" } },
            undefined,
            { timeout: 10000 },
          );
        });

        // Evaluate — body text length
        await recorder.record("puppeteer_evaluate", { script: "document.body.innerText.length" }, async () => {
          return await client.callTool(
            { name: "puppeteer_evaluate", arguments: { script: "document.body.innerText.length" } },
            undefined,
            { timeout: 15000 },
          );
        });
      }
    },
  },
  // ── Playwright Server ─────────────────────────────────────────────
  {
    slug: "playwright",
    command: "npx",
    args: ["-y", "@playwright/mcp@latest", "--headless"],
    customRunner: async (client, recorder) => {
      // Discover available tools at runtime
      let toolNames: string[] = [];
      try {
        const tools = await client.listTools();
        toolNames = tools.tools.map(t => t.name);
        log(`  Playwright tools: ${toolNames.join(", ")}`);
      } catch (err: any) {
        log(`  Failed to list Playwright tools: ${err.message}`);
        return;
      }

      const navigateTool = toolNames.find(n => /navigate|goto/i.test(n)) ?? "browser_navigate";
      const screenshotTool = toolNames.find(n => /screenshot/i.test(n)) ?? "browser_screenshot";
      const snapshotTool = toolNames.find(n => /snapshot|accessibility/i.test(n)) ?? "browser_snapshot";
      const clickTool = toolNames.find(n => /^browser_click$|^click$/i.test(n)) ?? "browser_click";
      const evaluateTool = toolNames.find(n => /evaluate|javascript/i.test(n)) ?? "browser_evaluate";

      const hasNavigate = toolNames.includes(navigateTool);
      const hasScreenshot = toolNames.includes(screenshotTool);
      const hasSnapshot = toolNames.includes(snapshotTool);
      const hasClick = toolNames.includes(clickTool);
      const hasEvaluate = toolNames.includes(evaluateTool);

      for (const url of BROWSER_URLS) {
        // Navigate
        if (hasNavigate) {
          await recorder.record(navigateTool, { url }, async () => {
            return await client.callTool(
              { name: navigateTool, arguments: { url } },
              undefined,
              { timeout: 30000 },
            );
          });
        }

        // Screenshot
        if (hasScreenshot) {
          await recorder.record(screenshotTool, {}, async () => {
            return await client.callTool(
              { name: screenshotTool, arguments: {} },
              undefined,
              { timeout: 30000 },
            );
          });
        }

        // Accessibility snapshot
        if (hasSnapshot) {
          await recorder.record(snapshotTool, {}, async () => {
            return await client.callTool(
              { name: snapshotTool, arguments: {} },
              undefined,
              { timeout: 15000 },
            );
          });
        }

        // Click first link (may fail)
        if (hasClick) {
          await recorder.record(clickTool, { element: "first link", ref: "a" }, async () => {
            return await client.callTool(
              { name: clickTool, arguments: { element: "first link", ref: "a" } },
              undefined,
              { timeout: 15000 },
            );
          });
          // Navigate back
          if (hasNavigate) {
            await recorder.record(navigateTool, { url }, async () => {
              return await client.callTool(
                { name: navigateTool, arguments: { url } },
                undefined,
                { timeout: 30000 },
              );
            });
          }
        }

        // Evaluate JS
        if (hasEvaluate) {
          for (const expression of ["document.title", "document.querySelectorAll('a').length", "document.body.innerText.length"]) {
            await recorder.record(evaluateTool, { expression }, async () => {
              return await client.callTool(
                { name: evaluateTool, arguments: { expression } },
                undefined,
                { timeout: 15000 },
              );
            });
          }
        }
      }

      // Try any additional discovered tools with no args
      const coreTools = new Set([navigateTool, screenshotTool, snapshotTool, clickTool, evaluateTool]);
      for (const toolName of toolNames.filter(n => !coreTools.has(n)).slice(0, 5)) {
        await recorder.record(toolName, {}, async () => {
          return await client.callTool(
            { name: toolName, arguments: {} },
            undefined,
            { timeout: 10000 },
          );
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

  try {
    await Promise.race([
      client.close(),
      new Promise<void>(resolve => setTimeout(resolve, 3000)),
    ]);
  } catch { /* ignore */ }
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
