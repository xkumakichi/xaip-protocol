-- XAIP Aggregator — D1 schema v1
-- Run: wrangler d1 migrations apply xaip-receipts

CREATE TABLE IF NOT EXISTS receipts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_did   TEXT    NOT NULL,
  tool_name   TEXT    NOT NULL,
  task_hash   TEXT    NOT NULL,
  result_hash TEXT,
  success     INTEGER NOT NULL,
  latency_ms  INTEGER NOT NULL,
  failure_type TEXT,
  timestamp   TEXT    NOT NULL,
  signature   TEXT    NOT NULL,
  caller_did  TEXT,
  caller_signature TEXT,
  public_key  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_tool ON receipts(agent_did, tool_name);
CREATE INDEX IF NOT EXISTS idx_timestamp  ON receipts(timestamp);
CREATE INDEX IF NOT EXISTS idx_caller     ON receipts(caller_did);

-- DID registry: rate limiting + age tracking
CREATE TABLE IF NOT EXISTS did_registry (
  did          TEXT PRIMARY KEY,
  first_seen   TEXT NOT NULL,
  receipt_count INTEGER DEFAULT 0,
  last_receipt  TEXT
);

-- Node signing key (generated once on first request)
CREATE TABLE IF NOT EXISTS node_keys (
  id          INTEGER PRIMARY KEY CHECK(id = 1),
  public_key  TEXT NOT NULL,
  private_key TEXT NOT NULL
);
