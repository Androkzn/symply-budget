-- Budget V2 local-first opaque checkpoints (encrypted chunks + signed manifest).
-- Server stores ciphertext only — no financial plaintext.

CREATE TABLE IF NOT EXISTS lf_checkpoint_manifests (
  household_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL,
  version_vector TEXT NOT NULL,
  root_hash TEXT NOT NULL,
  signer_device_id TEXT NOT NULL,
  signature_b64 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (household_id, generation)
);

CREATE TABLE IF NOT EXISTS lf_checkpoint_chunks (
  household_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (household_id, generation, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_lf_checkpoint_manifests_expires
  ON lf_checkpoint_manifests(expires_at);
CREATE INDEX IF NOT EXISTS idx_lf_checkpoint_chunks_expires
  ON lf_checkpoint_chunks(expires_at);

CREATE INDEX IF NOT EXISTS idx_lf_mailbox_acked ON lf_mailbox_blobs(acked_at);
