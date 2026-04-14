import initSqlJs from "sql.js";
import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

async function main() {
  const SQL = await initSqlJs();
  const buf = readFileSync(join(homedir(), ".veridict", "executions.db"));
  const db = new SQL.Database(new Uint8Array(buf));

  console.log("=== context7 resolve-library-id errors ===");
  const res = db.exec("SELECT tool_name, error_message, latency_ms FROM executions WHERE server_name = 'context7' AND tool_name = 'resolve-library-id' LIMIT 3");
  for (const row of res[0]?.values ?? []) {
    console.log(row[0], "|", String(row[1]).slice(0, 400));
  }

  console.log("\n=== context7 query-docs errors ===");
  const q = db.exec("SELECT tool_name, error_message FROM executions WHERE server_name = 'context7' AND tool_name = 'query-docs' LIMIT 2");
  for (const row of q[0]?.values ?? []) {
    console.log(row[0], "|", String(row[1]).slice(0, 400));
  }

  db.close();
}
main();
