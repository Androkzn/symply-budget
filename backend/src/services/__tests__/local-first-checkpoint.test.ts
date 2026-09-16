import { describe, expect, it } from 'vitest';

import type { Env } from '../../types';
import { LocalFirstCheckpointService } from '../local-first-checkpoint-service';

function fakeEnv() {
  const chunks: Array<Record<string, unknown>> = [];
  const manifests: Array<Record<string, unknown>> = [];
  // Store the BYTES, not the backing buffer. `Uint8Array.buffer` is typed
  // `ArrayBufferLike` (it may be a SharedArrayBuffer), and it also exposes the
  // whole backing store rather than the view's slice — so a subarray would
  // round-trip as more bytes than were written. Copying on read matches real R2,
  // which hands back a fresh buffer.
  const r2 = new Map<string, Uint8Array>();
  const DB = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const api = {
        bind(...args: unknown[]) {
          bound = args;
          return api;
        },
        async run() {
          if (sql.includes('INSERT INTO lf_checkpoint_chunks')) {
            const [
              household_id,
              generation,
              chunk_index,
              chunk_count,
              r2_key,
              size_bytes,
              created_at,
              expires_at,
            ] = bound;
            const idx = chunks.findIndex(
              (row) =>
                row.household_id === household_id &&
                row.generation === generation &&
                row.chunk_index === chunk_index,
            );
            const row = {
              household_id,
              generation,
              chunk_index,
              chunk_count,
              r2_key,
              size_bytes,
              created_at,
              expires_at,
            };
            if (idx >= 0) chunks[idx] = row;
            else chunks.push(row);
          }
          if (sql.includes('INSERT INTO lf_checkpoint_manifests')) {
            const [
              household_id,
              generation,
              chunk_count,
              version_vector,
              root_hash,
              signer_device_id,
              signature_b64,
              created_at,
              expires_at,
            ] = bound;
            manifests.push({
              household_id,
              generation,
              chunk_count,
              version_vector,
              root_hash,
              signer_device_id,
              signature_b64,
              created_at,
              expires_at,
            });
          }
          return { success: true };
        },
        async all<T>() {
          if (sql.includes('FROM lf_checkpoint_manifests') && sql.includes('ORDER BY generation DESC')) {
            const [householdId] = bound as [string];
            const rows = manifests
              .filter((row) => row.household_id === householdId)
              .sort((a, b) => Number(b.generation) - Number(a.generation));
            return { results: rows as unknown as T[] };
          }
          if (sql.includes('FROM lf_checkpoint_chunks') && sql.includes('SELECT r2_key')) {
            return { results: [] as T[] };
          }
          return { results: [] as T[] };
        },
        async first<T>() {
          if (sql.includes('COUNT(*)')) {
            const [householdId, generation] = bound as [string, number];
            const n = chunks.filter(
              (row) => row.household_id === householdId && row.generation === generation,
            ).length;
            return { n } as unknown as T;
          }
          return null;
        },
      };
      return api;
    },
  };
  return {
    env: {
      DB,
      REPORTS_BUCKET: {
        async put(key: string, bytes: Uint8Array) {
          r2.set(key, new Uint8Array(bytes));
        },
        async get(key: string) {
          const stored = r2.get(key);
          if (!stored) return null;
          const buf = new ArrayBuffer(stored.byteLength);
          new Uint8Array(buf).set(stored);
          return { arrayBuffer: async () => buf };
        },
        async delete() {
          return;
        },
      },
    } as unknown as Env,
  };
}

describe('LocalFirstCheckpointService', () => {
  it('does not advertise a generation until every chunk is present', async () => {
    const { env } = fakeEnv();
    const service = new LocalFirstCheckpointService(env);
    await service.putChunk({
      householdId: 'hh-1',
      generation: 1,
      chunkIndex: 0,
      chunkCount: 2,
      ciphertext: new Uint8Array([1, 2, 3]).buffer as ArrayBuffer,
    });
    await service.putManifest({
      householdId: 'hh-1',
      generation: 1,
      chunkCount: 2,
      versionVector: '{}',
      rootHash: 'abc',
      signerDeviceId: 'dev-1',
      signatureB64: 'sig',
    });
    expect(await service.latestComplete('hh-1')).toBeNull();

    await service.putChunk({
      householdId: 'hh-1',
      generation: 1,
      chunkIndex: 1,
      chunkCount: 2,
      ciphertext: new Uint8Array([4, 5, 6]).buffer as ArrayBuffer,
    });
    const latest = await service.latestComplete('hh-1');
    expect(latest?.generation).toBe(1);
  });
});
