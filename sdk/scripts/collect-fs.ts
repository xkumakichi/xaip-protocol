/**
 * Filesystem-only data collection (to supplement existing data)
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import initSqlJs from "sql.js";

const HOME = homedir();
function sha256(d: unknown) { return createHash("sha256").update(JSON.stringify(d)).digest("hex").slice(0, 16); }
function log(m: string) { console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`); }

const FS_FILES = [
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

const FS_BAD = [
  "nonexistent-file-abc123.txt", "fake-project/index.ts", "xaip-protocol/missing.json",
].map(p => join(HOME, p));

const FS_DIRS = [
  "", "xaip-protocol", "xaip-protocol/sdk", "xaip-protocol/sdk/src",
  "xaip-protocol/sdk/tests", "xaip-protocol/services",
  "xaip-protocol/demo", "xaip-protocol/schemas",
  "veridict", "veridict/src", ".claude",
].map(p => join(HOME, p));

const FS_SEARCH: [string, string][] = [
  ["xaip-protocol", "trust"], ["xaip-protocol", "aggregator"],
  ["xaip-protocol", "veridict"], ["xaip-protocol", "receipt"],
  ["xaip-protocol", "SEED_SCORES"], ["xaip-protocol", "bayesian"],
  ["xaip-protocol/sdk/src", "export"], ["xaip-protocol/sdk/src", "import"],
  ["veridict", "canITrust"], ["veridict", "middleware"],
  ["veridict", "success"], ["veridict", "failure"],
];

async function main() {
  const SQL = await initSqlJs();
  const dbPath = join(HOME, ".veridict", "executions.db");
  const buf = readFileSync(dbPath);
  const db = new SQL.Database(new Uint8Array(buf));
  try { db.run("ALTER TABLE executions ADD COLUMN failure_type TEXT DEFAULT NULL"); } catch {}
  const flush = () => writeFileSync(dbPath, Buffer.from(db.export()));

  // Accumulate (no clean)
  const existing = db.exec("SELECT COUNT(*) FROM executions WHERE server_name = 'filesystem'");
  log(`Existing filesystem rows: ${existing[0]?.values[0]?.[0] ?? 0}`);

  const transport = new StdioClientTransport({
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", HOME],
    env: process.env as Record<string, string>,
    stderr: "pipe",
  });
  const client = new Client({ name: "xaip-collector", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
  log("Connected to filesystem server");

  const tools = await client.listTools();
  log(`Found ${tools.tools.length} tools`);

  let total = 0, success = 0, fail = 0;

  async function call(tool: string, args: Record<string, unknown>) {
    const inputHash = sha256(args);
    const start = Date.now();
    try {
      const result = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: 30000 });
      const latencyMs = Date.now() - start;
      const isErr = (result as any).isError === true;
      db.run(
        "INSERT INTO executions (server_name, tool_name, input_hash, output_hash, success, latency_ms, error_message, failure_type, timestamp) VALUES (?,?,?,?,?,?,?,?,datetime('now'))",
        ["filesystem", tool, inputHash, sha256(result), isErr ? 0 : 1, latencyMs,
         isErr ? JSON.stringify((result as any).content?.[0]?.text ?? "").slice(0, 500) : null,
         isErr ? "error" : null],
      );
      total++; if (isErr) { fail++; process.stdout.write("×"); } else { success++; process.stdout.write("."); }
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      const msg = (err.message ?? "").toLowerCase();
      const ft = latencyMs >= 30000 || /timeout/.test(msg) ? "timeout" : /valid|schema|parse/.test(msg) ? "validation" : "error";
      db.run(
        "INSERT INTO executions (server_name, tool_name, input_hash, output_hash, success, latency_ms, error_message, failure_type, timestamp) VALUES (?,?,?,?,0,?,?,?,datetime('now'))",
        ["filesystem", tool, inputHash, "", latencyMs, err.message?.slice(0, 500) ?? "", ft],
      );
      total++; fail++; process.stdout.write("×");
    }
  }

  // read_file — existing
  log("read_file (existing files)");
  for (const path of FS_FILES) { await call("read_file", { path }); }
  console.log();

  // read_file — nonexistent
  log("read_file (nonexistent)");
  for (const path of FS_BAD) { await call("read_file", { path }); }
  console.log();

  // list_directory
  log("list_directory");
  for (const path of FS_DIRS) { await call("list_directory", { path }); }
  await call("list_directory", { path: join(HOME, "nonexistent-dir") });
  console.log();

  // search_files
  log("search_files");
  for (const [dir, pattern] of FS_SEARCH) {
    await call("search_files", { path: join(HOME, dir), pattern });
  }
  console.log();

  // get_file_info
  log("get_file_info");
  for (const path of FS_FILES.slice(0, 12)) { await call("get_file_info", { path }); }
  console.log();

  // directory_tree
  log("directory_tree");
  for (const dir of ["xaip-protocol/sdk/src", "veridict/src", "xaip-protocol/services", "xaip-protocol/schemas"]) {
    await call("directory_tree", { path: join(HOME, dir) });
  }
  console.log();

  // list_allowed_directories
  log("list_allowed_directories");
  await call("list_allowed_directories", {});
  console.log();

  flush();
  log(`Done: ${total} calls, ${success} success, ${fail} fail (${((success/total)*100).toFixed(1)}%)`);

  try { await client.close(); } catch {}
  db.close();
}
main().catch(e => { console.error(e); process.exit(1); });
