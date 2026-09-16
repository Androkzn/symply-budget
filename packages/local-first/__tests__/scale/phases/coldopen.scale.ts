/**
 * Requirement 3 — COLD OPEN, step by step.
 *
 * Replays `openLocalBudgetSessionInner`'s snapshot path exactly:
 *   hexToBytes(stored)            persistence.ts:37
 *   aeadDecrypt                   persistence.ts:37
 *   utf8Decode                    persistence.ts:38
 *   JSON.parse (memberId probe)   engine.ts:563  <- parses the WHOLE snapshot
 *   JSON.parse (full)             engine.ts:581  <- parses it AGAIN
 *   reviveOps                     engine.ts:428-436, hex-decodes every op
 *   normalizeLedger               engine.ts:215-241
 *   persist()                     engine.ts:638  <- re-serialize + re-encrypt
 *
 * Finding C19 claims 10.3 s at 5-year scale with no per-step breakdown, so
 * nobody knows which step to attack. Splitting the double parse out is what
 * proves the claim rather than repeating it, and the trailing re-persist at the
 * END of cold open has never been measured at all.
 *
 * DELIBERATELY EXCLUDED: the durable-journal branch (`resolveLedgerOps`,
 * engine.ts:444-458). The only off-device driver is
 * `__tests__/helpers/fake-sqlite-driver.ts`, whose `hasOperation` is
 * `Array.some` (line 127) and whose `insertOperation` adds a second linear scan
 * for the device-seq check — rehydrating 17,750 ops measures the fake's O(n^2),
 * not the product. `coldopen.total` is therefore the snapshot path only, and
 * the baseline document names this as a gap rather than a footnote.
 */
import { performance } from 'node:perf_hooks';

import { describe, it } from 'vitest';

import { aeadDecrypt } from '../../../src/crypto/aead';
import { hexToBytes, utf8Decode } from '../../../src/crypto/bytes';
import { generateLedger, type ScaleLedger } from '../lib/ledger-factory';
import { forceGc, stats } from '../lib/measure';
import {
  normalizeLedger,
  openSnapshot,
  reviveOps,
  sealSnapshot,
  serializeLedgerForPersist,
  type SerializedOp,
} from '../lib/mirror';
import { cryptoBundleFor, generateOps, pseudoBytes } from '../lib/oplog-factory';
import { startPhase } from '../lib/phase';

type ParsedSnapshot = Omit<ScaleLedger, 'ops'> & { ops: SerializedOp[] };

describe('scale: cold open', () => {
  it('measures', () => {
    const ctx = startPhase('coldopen');
    const { recorder, scale, iters } = ctx;

    const dbKey = pseudoBytes(32, 0xa11ce);
    const hdk = pseudoBytes(32, 0xb0b);

    const source = generateLedger(ctx.spec);
    source.ops = generateOps({
      ledger: source,
      count: scale.ops,
      hdk,
      householdId: String(source.household.id),
      deviceId: source.deviceId,
      memberId: source.memberId,
      seed: ctx.spec.seed,
    });
    source.crypto = cryptoBundleFor(ctx.spec.seed);

    // What sits in AsyncStorage before the app launches.
    const storedHex = sealSnapshot(dbKey, serializeLedgerForPersist(source)).storedHex;
    recorder.size('coldopen.snapshot.chars', storedHex.length, 'chars', 'hex at rest');

    const hexToBytesSamples: number[] = [];
    const decryptSamples: number[] = [];
    const utf8Samples: number[] = [];
    const probeParseSamples: number[] = [];
    const fullParseSamples: number[] = [];
    const reviveSamples: number[] = [];
    const normalizeSamples: number[] = [];
    const repersistSamples: number[] = [];
    const totalSamples: number[] = [];

    for (let k = 0; k < iters.heavy; k += 1) {
      forceGc();
      const t0 = performance.now();
      const sealed = hexToBytes(storedHex);
      const t1 = performance.now();
      const plain = aeadDecrypt(dbKey, sealed, new TextEncoder().encode('budget-ledger-v1'));
      const t2 = performance.now();
      const snapshotJson = utf8Decode(plain);
      const t3 = performance.now();

      // engine.ts:563 — the whole snapshot is parsed just to read `memberId`.
      const probe = JSON.parse(snapshotJson) as { memberId?: string };
      const t4 = performance.now();

      // engine.ts:581 — and parsed again, in full.
      const parsed = JSON.parse(snapshotJson) as ParsedSnapshot;
      const t5 = performance.now();

      const ops = reviveOps(parsed.ops ?? []);
      const t6 = performance.now();

      const ledger = normalizeLedger({ ...parsed, ops } as unknown as ScaleLedger);
      const t7 = performance.now();

      // engine.ts:638 — cold open ENDS by writing the whole thing back out.
      sealSnapshot(dbKey, serializeLedgerForPersist(ledger));
      const t8 = performance.now();

      if (probe.memberId !== source.memberId) throw new Error('cold open probe mismatch');
      if (ops.length !== scale.ops) throw new Error(`revived ${ops.length} ops, expected ${scale.ops}`);

      hexToBytesSamples.push(t1 - t0);
      decryptSamples.push(t2 - t1);
      utf8Samples.push(t3 - t2);
      probeParseSamples.push(t4 - t3);
      fullParseSamples.push(t5 - t4);
      reviveSamples.push(t6 - t5);
      normalizeSamples.push(t7 - t6);
      repersistSamples.push(t8 - t7);
      totalSamples.push(t8 - t0);
    }

    recorder.time('coldopen.hexToBytes', stats(hexToBytesSamples));
    recorder.time('coldopen.aeadDecrypt', stats(decryptSamples));
    recorder.time('coldopen.utf8Decode', stats(utf8Samples));
    recorder.time('coldopen.jsonParse.probe', stats(probeParseSamples), 'engine.ts:563 — reads memberId only');
    recorder.time('coldopen.jsonParse.full', stats(fullParseSamples), 'engine.ts:581');
    recorder.time('coldopen.reviveOps', stats(reviveSamples), `${scale.ops} ops hex-decoded`);
    recorder.time('coldopen.normalizeLedger', stats(normalizeSamples));
    recorder.time('coldopen.repersist', stats(repersistSamples), 'engine.ts:638 — at the END of cold open');
    recorder.time('coldopen.total', stats(totalSamples), 'snapshot path only; SQLite journal excluded');
    recorder.ratio(
      'coldopen.wastedShare',
      (stats(probeParseSamples).min + stats(repersistSamples).min) / stats(totalSamples).min,
      'lower',
      'probe parse + trailing re-persist as a share of cold open',
    );

    // Cheap proof that the steps above decoded a whole snapshot and not a
    // truncated one — the byte-exact round trip is proven in harness.test.ts.
    const reopened = openSnapshot(dbKey, storedHex);
    if (!reopened.startsWith('{"version":1,') || !reopened.endsWith('}')) {
      throw new Error('cold open round trip did not reproduce the snapshot JSON');
    }

    recorder.end();
  });
});
