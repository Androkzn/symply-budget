 
/**
 * Stage 1 measurement harness: how many real ops fit in ONE mailbox deposit.
 *
 * Runs the real OpLog (real AEAD + real Ed25519 signatures) and the real AEAD
 * seal, then binary-searches the largest prefix of the log whose base64 length
 * fits MAILBOX_MAX_CIPHERTEXT_B64 (512,000 — backend/src/routes/local-first-v2.ts).
 *
 * Both wire encodings are built here rather than taken from `serializeOperation`,
 * so the same file measures BEFORE (hex, batch v1) and AFTER (base64, batch v2)
 * regardless of which one the package currently ships.
 *
 *   STAGE1_BENCH=1 npx vitest run __tests__/stage1-wire-size.bench.test.ts
 */
import { performance } from 'node:perf_hooks';

import { describe, it } from 'vitest';

import { aeadEncrypt } from '../src/crypto/aead';
import { bytesToBase64 } from '../src/crypto/base64';
import { bytesToHex, utf8Encode } from '../src/crypto/bytes';
import { generateDeviceIdentity, generateHouseholdKeys } from '../src/crypto/keys';
import { OpLog, createOpId } from '../src/oplog/oplog';
import { MemoryLocalFirstStore } from '../src/store/memory-store';
import type { StoredOperation } from '../src/store/types';
import { openOpBatch } from '../src/sync/batch';
import { MailboxSyncEngine } from '../src/sync/mailbox-engine';
import { MemoryControlPlaneClient } from '../src/sync/stubs';

const ENABLED = process.env.STAGE1_BENCH === '1';
const CAP = 512_000;
const OPS = 2_000;

/** ~155 B of plaintext — a single-field edit. */
function smallPayload(i: number): Uint8Array {
  return utf8Encode(
    JSON.stringify({
      table: 'expenses',
      id: `exp_${String(i).padStart(8, '0')}`,
      fields: { amount_minor: 1234 + i, note: 'coffee', updated_at: '2026-08-12T10:00:00.000Z' },
    }).padEnd(155, ' '),
  );
}

/** ~465 B of plaintext — a whole-row create with categories/tags. */
function realisticPayload(i: number): Uint8Array {
  return utf8Encode(
    JSON.stringify({
      table: 'expenses',
      id: `exp_${String(i).padStart(8, '0')}`,
      fields: {
        amount_minor: 1234 + i,
        merchant: 'Neighbourhood Grocery & Deli',
        note: 'weekly shop, split between household members',
        category_id: `cat_${String(i % 20).padStart(4, '0')}`,
        tags: ['groceries', 'recurring', 'shared'],
        occurred_at: '2026-08-12T10:00:00.000Z',
        updated_at: '2026-08-12T10:00:00.000Z',
      },
    }).padEnd(465, ' '),
  );
}

async function buildOps(payload: (i: number) => Uint8Array): Promise<{
  ops: StoredOperation[];
  hdk: Uint8Array;
  householdId: string;
  signingPublicKey: Uint8Array;
}> {
  const household = generateHouseholdKeys('hh-bench');
  const identity = generateDeviceIdentity('dev-bench');
  const store = new MemoryLocalFirstStore();
  await store.open(new Uint8Array(32).fill(5));
  const log = new OpLog({ store, identity, householdKeys: household });
  for (let i = 0; i < OPS; i += 1) {
    await log.append({
      opId: createOpId(),
      authorMemberId: 'm-bench',
      parents: [],
      opType: 'EXPENSE_UPSERT',
      entityType: 'expense',
      entityId: `exp_${i}`,
      plaintextPayload: payload(i),
    });
  }
  return {
    ops: await store.listOperationsByHlc(household.householdId),
    hdk: household.hdk,
    householdId: household.householdId,
    signingPublicKey: identity.signingPublicKey,
  };
}

type Encoding = 'hex' | 'b64';

function batchJson(
  ops: StoredOperation[],
  householdId: string,
  signingPublicKey: Uint8Array,
  encoding: Encoding,
): string {
  const enc = encoding === 'hex' ? bytesToHex : bytesToBase64;
  const header =
    encoding === 'hex'
      ? { v: 1, householdId, senderDeviceId: 'dev-bench', senderSigningPublicKeyHex: enc(signingPublicKey) }
      : {
          v: 2,
          householdId,
          senderDeviceId: 'dev-bench',
          senderSigningPublicKeyB64: enc(signingPublicKey),
          senderVersionVector: { 'dev-bench': ops.length },
        };
  return JSON.stringify({
    ...header,
    ops: ops.map((op) => ({
      opId: op.opId,
      householdId: op.householdId,
      deviceId: op.deviceId,
      authorMemberId: op.authorMemberId,
      hlc: op.hlc,
      seq: op.seq,
      parentsJson: op.parentsJson,
      opType: op.opType,
      entityType: op.entityType,
      entityId: op.entityId,
      keyEpoch: op.keyEpoch,
      appliedAt: op.appliedAt,
      ...(encoding === 'hex'
        ? { payloadHex: enc(op.payload), signatureHex: enc(op.signature) }
        : { payloadB64: enc(op.payload), signatureB64: enc(op.signature) }),
    })),
  });
}

function sealedB64Length(
  ops: StoredOperation[],
  hdk: Uint8Array,
  householdId: string,
  signingPublicKey: Uint8Array,
  encoding: Encoding,
): number {
  const json = batchJson(ops, householdId, signingPublicKey, encoding);
  const sealed = aeadEncrypt(hdk, utf8Encode(json), utf8Encode(`mailbox-batch-v1:${householdId}:1`));
  return Math.ceil(sealed.length / 3) * 4;
}

describe.skipIf(!ENABLED)('Stage 1 wire size', () => {
  it('measures max ops per deposit, hex vs base64', async () => {
    for (const [label, payload] of [
      ['small (155 B plaintext)', smallPayload],
      ['realistic (465 B plaintext)', realisticPayload],
    ] as const) {
      const { ops, hdk, householdId, signingPublicKey } = await buildOps(payload);
      for (const encoding of ['hex', 'b64'] as const) {
        // Binary search the largest prefix that fits the cap.
        let lo = 0;
        let hi = ops.length;
        while (lo < hi) {
          const mid = Math.ceil((lo + hi) / 2);
          if (sealedB64Length(ops.slice(0, mid), hdk, householdId, signingPublicKey, encoding) <= CAP) {
            lo = mid;
          } else {
            hi = mid - 1;
          }
        }
        const full = sealedB64Length(ops, hdk, householdId, signingPublicKey, encoding);
        const t0 = performance.now();
        sealedB64Length(ops, hdk, householdId, signingPublicKey, encoding);
        const sealMs = performance.now() - t0;
        console.log(
          `[stage1] ${label} ${encoding}: maxOpsPerDeposit=${lo} charsPerOp=${(full / ops.length).toFixed(0)} seal${OPS}ops=${sealMs.toFixed(0)}ms`,
        );
      }
    }
  }, 600_000);

  /** The number that actually ships: what the real engine does with the real cap. */
  it('measures the shipped engine end to end', async () => {
    for (const [label, payload, count] of [
      ['small', smallPayload, 2_000],
      ['small', smallPayload, 5_000],
      ['realistic', realisticPayload, 2_000],
    ] as const) {
      const householdKeys = generateHouseholdKeys('hh-bench-e2e');
      const identity = generateDeviceIdentity('dev-bench-e2e');
      const store = new MemoryLocalFirstStore();
      await store.open(new Uint8Array(32).fill(5));
      const opLog = new OpLog({ store, identity, householdKeys });
      for (let i = 0; i < count; i += 1) {
        await opLog.append({
          opId: createOpId(),
          authorMemberId: 'm-bench',
          parents: [],
          opType: 'EXPENSE_UPSERT',
          entityType: 'expense',
          entityId: `exp_${i}`,
          plaintextPayload: payload(i),
        });
      }

      const control = new MemoryControlPlaneClient();
      const engine = new MailboxSyncEngine({
        store,
        opLog,
        householdKeys,
        deviceId: identity.deviceId,
        signingPublicKey: identity.signingPublicKey,
        control,
        peerDeviceIds: ['peer-1'],
        resolveSenderPublicKey: () => null,
      });

      const t0 = performance.now();
      const deposited = await engine.pushOutbound();
      const pushMs = performance.now() - t0;
      const blobs = control.depositsFor('peer-1');
      const sizes = blobs.map((b) => Math.ceil(b.ciphertext.length / 3) * 4);
      const opCounts = blobs.map(
        (b) => openOpBatch(b.ciphertext, householdKeys.hdk, householdKeys.householdId, 1).ops.length,
      );
      console.log(
        `[stage1] SHIPPED ${label} ${count} ops: chunks=${deposited} opsPerChunk=[${Math.min(
          ...opCounts,
        )}..${Math.max(...opCounts)}] maxB64=${Math.max(...sizes)} cap=${CAP} wakes=${control.wakeCount()} push=${pushMs.toFixed(0)}ms`,
      );
    }
  }, 900_000);
});
