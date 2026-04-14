/**
 * XAIP Veridict Plugin — Import Veridict execution history as signed receipts.
 *
 * v0.3: Uses JCS canonical payload for signing.
 *
 * Reads Veridict's SQLite DB directly (no veridict dependency needed).
 * Converts execution logs into XAIP ExecutionReceipts with Ed25519 signatures.
 *
 * Usage:
 *   import { veridictPlugin } from "xaip-sdk/plugins/veridict";
 *   await withXAIP(server, {
 *     plugins: [veridictPlugin()]
 *   });
 */

import initSqlJs from "sql.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { XAIPPlugin, FailureType } from "../types";
import { receiptPayload, sign } from "../identity";

export interface VeridictPluginConfig {
  /** Path to Veridict DB. Default: ~/.veridict/executions.db */
  dbPath?: string;
  /** Only import from a specific server name. */
  serverFilter?: string;
}

export function veridictPlugin(config?: VeridictPluginConfig): XAIPPlugin {
  return {
    name: "veridict",
    async init(ctx) {
      const dbPath =
        config?.dbPath ||
        path.join(os.homedir(), ".veridict", "executions.db");

      if (!fs.existsSync(dbPath)) {
        console.error(`[xaip:veridict] DB not found: ${dbPath} — skipping`);
        return;
      }

      const keys = await ctx.store.getKeys(ctx.did.id);
      if (!keys) throw new Error("No signing keys found for this DID");

      const SQL = await initSqlJs();
      const db = new SQL.Database(fs.readFileSync(dbPath));

      try {
        const where = config?.serverFilter
          ? "WHERE server_name = ?"
          : "";
        const params = config?.serverFilter
          ? [config.serverFilter]
          : [];

        const rows = db.exec(
          `SELECT tool_name, input_hash, output_hash, success,
                  latency_ms, failure_type, timestamp
           FROM executions ${where}
           ORDER BY timestamp ASC`,
          params
        );

        if (!rows.length || !rows[0].values.length) {
          console.error("[xaip:veridict] No executions found");
          return;
        }

        let imported = 0;
        for (const row of rows[0].values) {
          const failureType = (row[5] as string) || undefined;

          const receiptData = {
            agentDid: ctx.did.id,
            toolName: row[0] as string,
            taskHash: (row[1] as string) || "",
            resultHash: (row[2] as string) || "",
            success: row[3] === 1,
            latencyMs: Number(row[4]),
            failureType: failureType as FailureType | undefined,
            timestamp: row[6] as string,
          };

          const sig = sign(receiptPayload(receiptData), keys.privateKey);
          await ctx.store.log({ ...receiptData, signature: sig });
          imported++;
        }

        console.error(`[xaip:veridict] Imported ${imported} executions`);
      } finally {
        db.close();
      }
    },
  };
}
