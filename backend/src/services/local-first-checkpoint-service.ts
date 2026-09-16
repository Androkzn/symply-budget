import type { Env } from '../types';

export const CHECKPOINT_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const CHECKPOINT_RETAIN_GENERATIONS = 3;
export const CHECKPOINT_MAX_CIPHERTEXT_B64 = 512_000;

const R2_PREFIX = 'lf-checkpoint';

export type CheckpointManifestRow = {
  household_id: string;
  generation: number;
  chunk_count: number;
  version_vector: string;
  root_hash: string;
  signer_device_id: string;
  signature_b64: string;
  created_at: string;
  expires_at: string;
};

export type CheckpointChunkRow = {
  household_id: string;
  generation: number;
  chunk_index: number;
  chunk_count: number;
  r2_key: string;
  size_bytes: number;
  created_at: string;
  expires_at: string;
};

function chunkKey(householdId: string, generation: number, index: number): string {
  return `${R2_PREFIX}/${householdId}/${generation}/${index}`;
}

export class LocalFirstCheckpointService {
  constructor(private readonly env: Env) {}

  async putChunk(input: {
    householdId: string;
    generation: number;
    chunkIndex: number;
    chunkCount: number;
    ciphertext: ArrayBuffer;
    expiresAt?: string;
  }): Promise<CheckpointChunkRow> {
    const now = new Date();
    const expires = input.expiresAt ?? new Date(now.getTime() + CHECKPOINT_TTL_MS).toISOString();
    const key = chunkKey(input.householdId, input.generation, input.chunkIndex);
    const bytes = new Uint8Array(input.ciphertext);
    await this.env.REPORTS_BUCKET.put(key, bytes, {
      httpMetadata: { contentType: 'application/octet-stream' },
      customMetadata: {
        householdId: input.householdId,
        generation: String(input.generation),
        chunkIndex: String(input.chunkIndex),
      },
    });
    const row: CheckpointChunkRow = {
      household_id: input.householdId,
      generation: input.generation,
      chunk_index: input.chunkIndex,
      chunk_count: input.chunkCount,
      r2_key: key,
      size_bytes: bytes.byteLength,
      created_at: now.toISOString(),
      expires_at: expires,
    };
    await this.env.DB.prepare(
      `INSERT INTO lf_checkpoint_chunks
        (household_id, generation, chunk_index, chunk_count, r2_key, size_bytes, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(household_id, generation, chunk_index) DO UPDATE SET
         chunk_count = excluded.chunk_count,
         r2_key = excluded.r2_key,
         size_bytes = excluded.size_bytes,
         expires_at = excluded.expires_at`,
    )
      .bind(
        row.household_id,
        row.generation,
        row.chunk_index,
        row.chunk_count,
        row.r2_key,
        row.size_bytes,
        row.created_at,
        row.expires_at,
      )
      .run();
    return row;
  }

  async putManifest(input: {
    householdId: string;
    generation: number;
    chunkCount: number;
    versionVector: string;
    rootHash: string;
    signerDeviceId: string;
    signatureB64: string;
  }): Promise<CheckpointManifestRow> {
    const now = new Date();
    const expires = new Date(now.getTime() + CHECKPOINT_TTL_MS).toISOString();
    const row: CheckpointManifestRow = {
      household_id: input.householdId,
      generation: input.generation,
      chunk_count: input.chunkCount,
      version_vector: input.versionVector,
      root_hash: input.rootHash,
      signer_device_id: input.signerDeviceId,
      signature_b64: input.signatureB64,
      created_at: now.toISOString(),
      expires_at: expires,
    };
    await this.env.DB.prepare(
      `INSERT INTO lf_checkpoint_manifests
        (household_id, generation, chunk_count, version_vector, root_hash,
         signer_device_id, signature_b64, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(household_id, generation) DO UPDATE SET
         chunk_count = excluded.chunk_count,
         version_vector = excluded.version_vector,
         root_hash = excluded.root_hash,
         signer_device_id = excluded.signer_device_id,
         signature_b64 = excluded.signature_b64,
         expires_at = excluded.expires_at`,
    )
      .bind(
        row.household_id,
        row.generation,
        row.chunk_count,
        row.version_vector,
        row.root_hash,
        row.signer_device_id,
        row.signature_b64,
        row.created_at,
        row.expires_at,
      )
      .run();
    await this.pruneOldGenerations(input.householdId);
    return row;
  }

  /** Atomically reserve a generation for one signed snapshot before storing chunks. */
  async reserveManifest(input: {
    householdId: string; generation: number; chunkCount: number;
    versionVector: string; rootHash: string; signerDeviceId: string; signatureB64: string;
  }): Promise<boolean> {
    const now = new Date();
    await this.env.DB.prepare(`INSERT OR IGNORE INTO lf_checkpoint_manifests
      (household_id, generation, chunk_count, version_vector, root_hash,
       signer_device_id, signature_b64, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(input.householdId, input.generation,
      input.chunkCount, input.versionVector, input.rootHash, input.signerDeviceId,
      input.signatureB64, now.toISOString(), new Date(now.getTime() + CHECKPOINT_TTL_MS).toISOString()).run();
    const row = await this.env.DB.prepare(`SELECT * FROM lf_checkpoint_manifests
      WHERE household_id = ? AND generation = ?`).bind(input.householdId, input.generation)
      .first<CheckpointManifestRow>();
    return row?.root_hash === input.rootHash && row.signer_device_id === input.signerDeviceId &&
      row.signature_b64 === input.signatureB64 && row.chunk_count === input.chunkCount;
  }

  async latestComplete(
    householdId: string,
    generation?: number,
  ): Promise<{ manifest: CheckpointManifestRow; generation: number } | null> {
    const now = new Date().toISOString();
    const { results } = await this.env.DB.prepare(
      `SELECT * FROM lf_checkpoint_manifests
       WHERE household_id = ? AND expires_at > ?
       AND chunk_count = (SELECT COUNT(*) FROM lf_checkpoint_chunks c
         WHERE c.household_id = lf_checkpoint_manifests.household_id
           AND c.generation = lf_checkpoint_manifests.generation
           AND c.chunk_count = lf_checkpoint_manifests.chunk_count
           AND c.expires_at > ?)
       ${generation == null ? "" : "AND generation = ?"}
       ORDER BY generation DESC
       LIMIT 8`,
    )
      .bind(...(generation == null ? [householdId, now, now] : [householdId, now, now, generation]))
      .all<CheckpointManifestRow>();

    for (const manifest of results ?? []) {
      const countRow = await this.env.DB.prepare(
        `SELECT COUNT(*) AS n FROM lf_checkpoint_chunks
         WHERE household_id = ? AND generation = ?`,
      )
        .bind(householdId, manifest.generation)
        .first<{ n: number }>();
      if (Number(countRow?.n ?? 0) >= manifest.chunk_count) {
        return { manifest, generation: manifest.generation };
      }
    }
    return null;
  }

  async getChunk(
    householdId: string,
    generation: number,
    index: number,
  ): Promise<{ bytes: ArrayBuffer; row: CheckpointChunkRow } | null> {
    const row = await this.env.DB.prepare(
      `SELECT * FROM lf_checkpoint_chunks
       WHERE household_id = ? AND generation = ? AND chunk_index = ?`,
    )
      .bind(householdId, generation, index)
      .first<CheckpointChunkRow>();
    if (!row) return null;
    const object = await this.env.REPORTS_BUCKET.get(row.r2_key);
    if (!object) return null;
    return { bytes: await object.arrayBuffer(), row };
  }

  async sweepExpired(limit = 500): Promise<number> {
    const now = new Date().toISOString();
    const { results: manifests } = await this.env.DB.prepare(
      `SELECT household_id, generation FROM lf_checkpoint_manifests
       WHERE expires_at <= ? LIMIT ?`,
    )
      .bind(now, limit)
      .all<{ household_id: string; generation: number }>();
    const { results: chunks } = await this.env.DB.prepare(
      `SELECT household_id, generation, chunk_index, r2_key FROM lf_checkpoint_chunks
       WHERE expires_at <= ? LIMIT ?`,
    )
      .bind(now, limit)
      .all<{ household_id: string; generation: number; chunk_index: number; r2_key: string }>();

    let removed = 0;
    for (const row of chunks ?? []) {
      await this.env.REPORTS_BUCKET.delete(row.r2_key);
      await this.env.DB.prepare(
        `DELETE FROM lf_checkpoint_chunks
         WHERE household_id = ? AND generation = ? AND chunk_index = ?`,
      )
        .bind(row.household_id, row.generation, row.chunk_index)
        .run();
      removed += 1;
    }
    for (const row of manifests ?? []) {
      await this.env.DB.prepare(
        `DELETE FROM lf_checkpoint_manifests WHERE household_id = ? AND generation = ?`,
      )
        .bind(row.household_id, row.generation)
        .run();
      removed += 1;
    }
    return removed;
  }

  private async pruneOldGenerations(householdId: string): Promise<void> {
    const { results } = await this.env.DB.prepare(
      `SELECT generation FROM lf_checkpoint_manifests
       WHERE household_id = ?
       AND chunk_count = (SELECT COUNT(*) FROM lf_checkpoint_chunks c
         WHERE c.household_id = lf_checkpoint_manifests.household_id
           AND c.generation = lf_checkpoint_manifests.generation
           AND c.chunk_count = lf_checkpoint_manifests.chunk_count
           AND c.expires_at > ?)
       ORDER BY generation DESC`,
    )
      .bind(householdId, new Date().toISOString())
      .all<{ generation: number }>();
    const keep = new Set(
      (results ?? []).slice(0, CHECKPOINT_RETAIN_GENERATIONS).map((row) => row.generation),
    );
    for (const row of results ?? []) {
      if (keep.has(row.generation)) continue;
      const { results: chunks } = await this.env.DB.prepare(
        `SELECT r2_key FROM lf_checkpoint_chunks WHERE household_id = ? AND generation = ?`,
      )
        .bind(householdId, row.generation)
        .all<{ r2_key: string }>();
      for (const chunk of chunks ?? []) {
        await this.env.REPORTS_BUCKET.delete(chunk.r2_key);
      }
      await this.env.DB.prepare(
        `DELETE FROM lf_checkpoint_chunks WHERE household_id = ? AND generation = ?`,
      )
        .bind(householdId, row.generation)
        .run();
      await this.env.DB.prepare(
        `DELETE FROM lf_checkpoint_manifests WHERE household_id = ? AND generation = ?`,
      )
        .bind(householdId, row.generation)
        .run();
    }
  }
}
