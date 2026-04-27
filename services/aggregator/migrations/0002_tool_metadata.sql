-- XAIP Aggregator - v0.5 tool metadata plumbing
-- Stores optional signed receipt.toolMetadata without changing scoring.

ALTER TABLE receipts ADD COLUMN tool_metadata_json TEXT;
ALTER TABLE receipts ADD COLUMN tool_class TEXT;
ALTER TABLE receipts ADD COLUMN verifiability_hint TEXT;
ALTER TABLE receipts ADD COLUMN settlement_layer TEXT;

CREATE INDEX IF NOT EXISTS idx_tool_class ON receipts(tool_class);
