-- House V2 local-first encrypted blob channel (plan §8, stage H6).
--
-- The relay stores CIPHERTEXT ONLY. Deliberately absent from these tables:
-- mime type, filename, plaintext size and the plaintext sha256. The ledger row
-- carries all of those and is itself encrypted; putting any of them here would
-- hand the server a confirmation-of-file oracle for no operational gain. What
-- the server needs to run the channel is: how many chunks a blob has, how many
-- ciphertext bytes it costs (quota + R2 accounting), which key epoch sealed it,
-- and whether it is still referenced.
--
-- Numbered 0157, NOT the 0156 the plan predicted: 0156 was taken by
-- `lf_devices_composite_pk` (the H5 blocker) before H6 started.
--
-- `migrations_dir` is SHARED across the fleet, so this lands on Budget, Kaizen
-- and Health D1s too — as empty tables. Apply to staging AND production for
-- every fleet brand.

CREATE TABLE IF NOT EXISTS lf_blobs (
  household_id TEXT NOT NULL,
  blob_id TEXT NOT NULL,
  -- Which household key epoch derived the content key. A peer that has rotated
  -- past this epoch still needs the old HDK to open the blob, so the epoch has
  -- to travel with the object rather than being inferred from "current".
  key_epoch INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL,
  -- Sum of the stored ciphertext chunk sizes. This is what R2 actually bills
  -- and what the per-household quota is measured in.
  cipher_bytes INTEGER NOT NULL DEFAULT 0,
  -- pending  → chunks are still arriving; not yet readable by a peer
  -- complete → every chunk is present; peers may fetch
  -- tombstoned → the owning ledger row is deleted; bytes await the purge watermark
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  tombstoned_at TEXT,
  -- Q4: retention is tombstone + watermark, never a fixed TTL. Set when the row
  -- is tombstoned to `tombstoned_at + CHECKPOINT_TTL`, because a checkpoint
  -- published before the delete can still hand a bootstrapping device a live
  -- row pointing at this blob for as long as that generation is servable.
  purge_after TEXT,
  PRIMARY KEY (household_id, blob_id)
);

CREATE TABLE IF NOT EXISTS lf_blob_chunks (
  household_id TEXT NOT NULL,
  blob_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (household_id, blob_id, chunk_index)
);

-- Quota rollup + the "is this readable yet" check, both per household.
CREATE INDEX IF NOT EXISTS idx_lf_blobs_household_status
  ON lf_blobs(household_id, status);
-- Purge sweep (tombstoned past the watermark).
CREATE INDEX IF NOT EXISTS idx_lf_blobs_purge_after
  ON lf_blobs(purge_after);
-- Abandoned-upload sweep: `pending` rows that never finalized would otherwise
-- hold R2 bytes forever, since nothing tombstones a blob that has no ledger row.
CREATE INDEX IF NOT EXISTS idx_lf_blobs_status_updated
  ON lf_blobs(status, updated_at);
