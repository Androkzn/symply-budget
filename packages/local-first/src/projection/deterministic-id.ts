/**
 * Deterministic row ids for tables that carry a business uniqueness constraint
 * (House plan §1.5 hazard S3b).
 *
 * The ledger has no unique index. If two devices create the "same" logical row
 * offline — the same setting key, the same checklist-item completion, the same
 * membership — and each mints a random id, LWW has nothing to merge on and
 * BOTH rows survive: the member sees a duplicate. Deriving the id from the
 * natural key makes both devices mint the identical row key, so the two writes
 * merge field-by-field like any other concurrent edit.
 *
 * Budget proved the pattern with `goal_${year}_${month}`; hashing generalizes
 * it to natural keys that contain user text (a setting key, a period label)
 * without producing unbounded or delimiter-ambiguous ids.
 *
 * NOT for rows with no business uniqueness — a task, a note, a photo. Those
 * must keep a random id, or two genuinely different creates would collapse into
 * one.
 */
import { sha256 } from '@noble/hashes/sha256';

import { bytesToHex, utf8Encode } from '../crypto/bytes';

/** Unit separator — cannot appear in an id, so parts can never run together. */
const PART_SEPARATOR = '\u001f';
/** Record separator between the table prefix and the natural key. */
const PREFIX_SEPARATOR = '\u001e';
/** Stands in for a null/undefined part, distinct from the empty string. */
const NULL_PART = '\u0000';

/** Hex chars kept from the digest — 128 bits, collision-free at any real scale. */
const ID_HEX_LENGTH = 32;

/**
 * `${prefix}_${sha256(prefix ‖ parts)}`, stable across devices, processes and
 * app versions. `prefix` is inside the hash, so the same natural key in two
 * different tables never produces the same digest.
 */
export function deterministicRowId(
  prefix: string,
  parts: ReadonlyArray<string | number | null | undefined>,
): string {
  if (!prefix) throw new Error('deterministicRowId: prefix is required');
  if (parts.length === 0) throw new Error('deterministicRowId: at least one key part is required');
  const canonical = parts
    .map((part) => (part === null || part === undefined ? NULL_PART : String(part)))
    .join(PART_SEPARATOR);
  const digest = bytesToHex(sha256(utf8Encode(`${prefix}${PREFIX_SEPARATOR}${canonical}`)));
  return `${prefix}_${digest.slice(0, ID_HEX_LENGTH)}`;
}

/** True when `id` was minted by `deterministicRowId` for this prefix. */
export function isDeterministicRowId(prefix: string, id: string): boolean {
  return (
    id.length === prefix.length + 1 + ID_HEX_LENGTH &&
    id.startsWith(`${prefix}_`) &&
    /^[0-9a-f]+$/.test(id.slice(prefix.length + 1))
  );
}
