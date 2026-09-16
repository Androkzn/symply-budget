import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../types';
import { LocalFirstCheckpointService } from '../local-first-checkpoint-service';
const testEnv = env as unknown as Env;
const ddl = `CREATE TABLE IF NOT EXISTS lf_checkpoint_manifests (
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

`;
beforeEach(async () => {
  for (const sql of ddl.split(';').filter(s => s.trim())) await testEnv.DB.exec(sql.replace(/\s+/g, ' '));
  await testEnv.DB.exec('DELETE FROM lf_checkpoint_manifests');
  await testEnv.DB.exec('DELETE FROM lf_checkpoint_chunks');
});
describe('checkpoint generation isolation', () => {
  it('reserves a generation atomically and refuses another publisher', async () => {
    const service = new LocalFirstCheckpointService(testEnv);
    const input = {householdId:'h', generation:1, chunkCount:1, versionVector:'{}', rootHash:'r', signerDeviceId:'a', signatureB64:'s'};
    const results = await Promise.all([service.reserveManifest(input), service.reserveManifest({...input, signerDeviceId:'b', signatureB64:'other'})]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await service.latestComplete('h')).toBeNull();
  });
  it('keeps a download pinned when a newer generation completes', async () => {
    const service = new LocalFirstCheckpointService(testEnv);
    for (const generation of [1,2]) {
      await service.reserveManifest({householdId:'h', generation, chunkCount:1, versionVector:'{}', rootHash:'r', signerDeviceId:'a', signatureB64:'s'});
      await service.putChunk({householdId:'h', generation, chunkCount:1, chunkIndex:0, ciphertext:new Uint8Array([generation]).buffer});
    }
    expect((await service.latestComplete('h'))?.generation).toBe(2);
    expect((await service.latestComplete('h',1))?.generation).toBe(1);
    expect(await service.latestComplete('other',1)).toBeNull();
    expect(new Uint8Array((await service.getChunk('h',1,0))!.bytes)).toEqual(new Uint8Array([1]));
  });
});
