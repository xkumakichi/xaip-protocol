/**
 * XAIP Receipt Store — SQLite storage for signed execution receipts (v0.3.1)
 *
 * v0.3 changes:
 *   - Co-signature columns (caller_did, caller_signature)
 *   - Sybil rate limiting (DID registration rate, receipt rate)
 *   - DID age tracking
 *
 * Uses sql.js (pure JS, no native dependencies).
 */

import initSqlJs, { Database } from "sql.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { ExecutionReceipt, RateLimitConfig, DEFAULT_RATE_LIMITS } from "./types";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_did TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  task_hash TEXT NOT NULL,
  result_hash TEXT,
  success INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL,
  failure_type TEXT,
  timestamp TEXT NOT NULL,
  signature TEXT NOT NULL,
  caller_did TEXT,
  caller_signature TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_tool ON receipts(agent_did, tool_name);
CREATE INDEX IF NOT EXISTS idx_timestamp ON receipts(timestamp);

CREATE TABLE IF NOT EXISTS keys (
  did TEXT PRIMARY KEY,
  public_key TEXT NOT NULL,
  private_key TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS did_registry (
  did TEXT PRIMARY KEY,
  first_seen TEXT NOT NULL,
  receipt_count INTEGER DEFAULT 0,
  last_receipt TEXT
);
`;

const MIGRATION_V03 = `
ALTER TABLE receipts ADD COLUMN caller_did TEXT;
ALTER TABLE receipts ADD COLUMN caller_signature TEXT;
`;

export interface StoredReceipt {
  toolName: string;
  success: boolean;
  latencyMs: number;
  failureType: string | null;
  timestamp: string;
  callerDid: string | null;
  callerSignature: string | null;
}

export class ReceiptStore {
  private db: Database | null = null;
  private dbPath: string;
  private initPromise: Promise<void>;
  private rateLimits: RateLimitConfig;

  constructor(dbPath?: string, rateLimits?: Partial<RateLimitConfig>) {
    this.dbPath =
      dbPath || path.join(os.homedir(), ".xaip", "receipts.db");
    this.rateLimits = { ...DEFAULT_RATE_LIMITS, ...rateLimits };
    this.initPromise = this.init();
  }

  private async init(): Promise<void> {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const SQL = await initSqlJs();
    this.db = fs.existsSync(this.dbPath)
      ? new SQL.Database(fs.readFileSync(this.dbPath))
      : new SQL.Database();

    // Run schema (CREATE IF NOT EXISTS is safe for re-runs)
    this.db.run(SCHEMA);

    // Migrate v0.2 → v0.3: add columns if missing
    try {
      const cols = this.db.exec(
        "SELECT name FROM pragma_table_info('receipts')"
      );
      const colNames = cols.length
        ? cols[0].values.map((r) => r[0] as string)
        : [];
      if (!colNames.includes("caller_did")) {
        for (const stmt of MIGRATION_V03.split(";").filter((s) => s.trim())) {
          try {
            this.db.run(stmt);
          } catch {
            // Column/table may already exist
          }
        }
      }
    } catch {
      // pragma not supported — fresh DB, SCHEMA already applied
    }

    this.save();
  }

  private save(): void {
    if (!this.db) return;
    fs.writeFileSync(this.dbPath, Buffer.from(this.db.export()));
  }

  private async ready(): Promise<Database> {
    await this.initPromise;
    if (!this.db) throw new Error("DB not initialized");
    return this.db;
  }

  // ─── Receipts ──────────────────────────────────────

  async log(receipt: ExecutionReceipt): Promise<void> {
    const db = await this.ready();

    // Sybil rate limit: max receipts per DID per hour
    if (!this.checkReceiptRateLimit(db, receipt.agentDid)) {
      throw new Error(
        `Rate limit exceeded: max ${this.rateLimits.maxReceiptsPerDidPerHour} receipts/hour for ${receipt.agentDid}`
      );
    }

    db.run(
      `INSERT INTO receipts
        (agent_did, tool_name, task_hash, result_hash, success, latency_ms,
         failure_type, timestamp, signature, caller_did, caller_signature)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        receipt.agentDid,
        receipt.toolName,
        receipt.taskHash,
        receipt.resultHash ?? "",
        receipt.success ? 1 : 0,
        receipt.latencyMs,
        receipt.failureType ?? null,
        receipt.timestamp,
        receipt.signature,
        receipt.callerDid ?? null,
        receipt.callerSignature ?? null,
      ]
    );

    // Update DID registry
    this.updateDidRegistry(db, receipt.agentDid, receipt.timestamp);

    this.save();
  }

  async getReceipts(
    agentDid: string,
    toolName?: string
  ): Promise<StoredReceipt[]> {
    const db = await this.ready();
    const where = toolName
      ? "WHERE agent_did = ? AND tool_name = ?"
      : "WHERE agent_did = ?";
    const params = toolName ? [agentDid, toolName] : [agentDid];

    const rows = db.exec(
      `SELECT tool_name, success, latency_ms, failure_type, timestamp,
              caller_did, caller_signature
       FROM receipts ${where}
       ORDER BY timestamp DESC`,
      params
    );
    if (!rows.length) return [];
    return rows[0].values.map((r) => ({
      toolName: r[0] as string,
      success: r[1] === 1,
      latencyMs: Number(r[2]),
      failureType: (r[3] as string) || null,
      timestamp: r[4] as string,
      callerDid: (r[5] as string) || null,
      callerSignature: (r[6] as string) || null,
    }));
  }

  async getToolNames(agentDid: string): Promise<string[]> {
    const db = await this.ready();
    const rows = db.exec(
      "SELECT DISTINCT tool_name FROM receipts WHERE agent_did = ?",
      [agentDid]
    );
    if (!rows.length) return [];
    return rows[0].values.map((r) => r[0] as string);
  }

  // ─── Keys ──────────────────────────────────────────

  async getKeys(
    did: string
  ): Promise<{ publicKey: string; privateKey: string } | null> {
    const db = await this.ready();
    const rows = db.exec(
      "SELECT public_key, private_key FROM keys WHERE did = ?",
      [did]
    );
    if (!rows.length || !rows[0].values.length) return null;
    const [pub, priv] = rows[0].values[0];
    return { publicKey: pub as string, privateKey: priv as string };
  }

  async saveKeys(
    did: string,
    publicKey: string,
    privateKey: string
  ): Promise<void> {
    const db = await this.ready();
    db.run(
      "INSERT OR REPLACE INTO keys (did, public_key, private_key) VALUES (?, ?, ?)",
      [did, publicKey, privateKey]
    );
    this.save();
  }

  // ─── DID Registry & Rate Limiting ──────────────────

  private updateDidRegistry(
    db: Database,
    did: string,
    timestamp: string
  ): void {
    db.run(
      `INSERT INTO did_registry (did, first_seen, receipt_count, last_receipt)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(did) DO UPDATE SET
         receipt_count = receipt_count + 1,
         last_receipt = ?`,
      [did, timestamp, timestamp, timestamp]
    );
  }

  private checkReceiptRateLimit(db: Database, did: string): boolean {
    const oneHourAgo = new Date(
      Date.now() - 60 * 60 * 1000
    ).toISOString();
    const rows = db.exec(
      `SELECT COUNT(*) FROM receipts
       WHERE agent_did = ? AND timestamp > ?`,
      [did, oneHourAgo]
    );
    if (!rows.length) return true;
    const count = Number(rows[0].values[0][0]);
    return count < this.rateLimits.maxReceiptsPerDidPerHour;
  }

  async getDidAge(did: string): Promise<number> {
    const db = await this.ready();
    const rows = db.exec(
      "SELECT first_seen FROM did_registry WHERE did = ?",
      [did]
    );
    if (!rows.length || !rows[0].values.length) return 0;
    const firstSeen = new Date(rows[0].values[0][0] as string).getTime();
    return (Date.now() - firstSeen) / (1000 * 60 * 60); // hours
  }

  async close(): Promise<void> {
    if (this.db) {
      this.save();
      this.db.close();
      this.db = null;
    }
  }
}
