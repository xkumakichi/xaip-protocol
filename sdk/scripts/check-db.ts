import initSqlJs from "sql.js";
import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

async function main() {
  const SQL = await initSqlJs();
  const buf = readFileSync(join(homedir(), ".veridict", "executions.db"));
  const db = new SQL.Database(new Uint8Array(buf));

  const stats = db.exec(`
    SELECT server_name, COUNT(*) as total, SUM(success) as successes, ROUND(AVG(latency_ms)) as avg_latency
    FROM executions GROUP BY server_name ORDER BY server_name
  `);

  console.log("Server              | Total | Success | Avg Latency");
  console.log("--------------------|-------|---------|------------");
  for (const row of stats[0]?.values ?? []) {
    const [name, total, succ, lat] = row;
    const rate = ((Number(succ) / Number(total)) * 100).toFixed(1);
    console.log(`${String(name).padEnd(20)}| ${String(total).padStart(5)} | ${rate.padStart(6)}% | ${String(lat).padStart(7)}ms`);
  }

  const totalRow = db.exec("SELECT COUNT(*) FROM executions");
  console.log(`\nTotal rows: ${totalRow[0]?.values[0]?.[0]}`);

  db.close();
}
main();
