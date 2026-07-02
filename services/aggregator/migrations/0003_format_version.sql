-- Wire-format version of the stored receipt.
-- NULL  = legacy pre-versioning receipt (16-char truncated hashes,
--         toolMetadata included in the signed payload by older producers).
-- "1"   = versioned format: full 64-char lowercase hex SHA-256 hashes,
--         toolMetadata excluded from the signed payload, empty-input
--         sentinel for absent inputs/outputs, callerDid always present.
ALTER TABLE receipts ADD COLUMN format_version TEXT;
