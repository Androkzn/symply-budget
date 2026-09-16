/**
 * Cheap guard — runs in the package's normal `npm test`.
 *
 * Every House phase rests on claims about the corpus that are easy to break
 * silently and expensive to notice later. A corpus that quietly became
 * single-device, or whose op payloads stopped being real deltas, would still
 * produce a full baseline — of the wrong thing. Each `it` here is one such
 * claim, asserted rather than assumed.
 */
import { describe, expect, it } from 'vitest';

import { planTableStrategy } from '../../../../src/features/house/local/projection';
import { utf8Decode } from '../../src/crypto/bytes';

import { enableDevAssertions } from './lib/dev-global';
import {
  HOUSE_DEFAULT_SEED,
  bulkDeleteDelta,
  cloneLedger,
  generateHouseLedger,
  scaleId,
} from './lib/house-ledger-factory';
import {
  authorsFor,
  generateHouseOps,
  makeReferenceOpPayload,
  versionVectorFor,
} from './lib/house-oplog-factory';
import { pseudoBytes } from './lib/oplog-factory';

enableDevAssertions();

const SPEC = { years: 1, adults: 2, seed: HOUSE_DEFAULT_SEED };
const HDK = pseudoBytes(32, 0xb0b);

describe('house corpus — the op log is a MULTI-DEVICE log', () => {
  const ledger = generateHouseLedger(SPEC);
  const ops = generateHouseOps({
    ledger,
    count: 400,
    hdk: HDK,
    householdId: String(ledger.household.id),
    seed: SPEC.seed,
  });

  it('attributes ops to one device per member, not all to one', () => {
    const devices = new Set(ops.map((op) => op.deviceId));
    expect(devices.size).toBe(SPEC.adults);
  });

  it('counts seq PER DEVICE, which is what the store does', () => {
    const bySeq = new Map<string, number[]>();
    for (const op of ops) {
      if (!bySeq.has(op.deviceId)) bySeq.set(op.deviceId, []);
      bySeq.get(op.deviceId)!.push(op.seq);
    }
    for (const seqs of bySeq.values()) {
      expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, i) => i + 1));
    }
  });

  it('is NOT sorted by hlc — one member was offline', () => {
    // The whole point: an author whose clock lagged produces ops that land
    // BELOW the receiving device's head. A monotonic log cannot express that,
    // and every catch-up / version-vector number measured on one is optimistic.
    const hlcs = ops.map((op) => op.hlc);
    const sorted = [...hlcs].sort();
    expect(hlcs).not.toEqual(sorted);
  });

  it('designates exactly one lagging author', () => {
    const lagged = authorsFor(ledger).filter((a) => a.lagMs !== 0);
    expect(lagged).toHaveLength(1);
    expect(lagged[0]!.lagMs).toBeLessThan(0);
  });

  it('produces a version vector with one entry per device', () => {
    const vv = versionVectorFor(ops);
    expect(Object.keys(vv)).toHaveLength(SPEC.adults);
    for (const seq of Object.values(vv)) expect(seq).toBeGreaterThan(0);
  });

  it('is monotonic with a single adult, which is correct', () => {
    const solo = generateHouseLedger({ years: 1, adults: 1, seed: SPEC.seed });
    const soloOps = generateHouseOps({
      ledger: solo,
      count: 50,
      hdk: HDK,
      householdId: String(solo.household.id),
      seed: SPEC.seed,
    });
    const hlcs = soloOps.map((op) => op.hlc);
    expect(hlcs).toEqual([...hlcs].sort());
  });
});

describe('house corpus — op payloads are REAL sealed deltas', () => {
  const ledger = generateHouseLedger(SPEC);

  it('carries a single-field delta over a real row, not a synthetic blob', () => {
    const reference = makeReferenceOpPayload(ledger, HDK);
    const payload = JSON.parse(utf8Decode(reference.plaintext)) as {
      intent?: Record<string, unknown>;
      delta?: { v: number; u?: Record<string, Array<{ k: string; f: Record<string, unknown> }>> };
    };
    expect(payload.delta?.v).toBe(1);
    const rows = payload.delta?.u?.maintenanceCompletions ?? [];
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]!.f)).toEqual(['notes']);
    expect(payload.intent?.household_id).toBe(ledger.household.id);
  });

  it('seals to more bytes than it plaintexts — AEAD really ran', () => {
    const reference = makeReferenceOpPayload(ledger, HDK);
    expect(reference.ciphertext.length).toBeGreaterThan(reference.plaintext.length);
    expect(reference.deltaBytes).toBeGreaterThan(0);
    expect(reference.deltaBytes).toBeLessThan(reference.plaintext.length);
  });

  it('does not mutate the ledger it measured against', () => {
    const before = JSON.stringify(ledger.maintenanceCompletions);
    makeReferenceOpPayload(ledger, HDK);
    expect(JSON.stringify(ledger.maintenanceCompletions)).toBe(before);
  });
});

describe('house corpus — clone isolates rows AND watermarks', () => {
  it('does not let a mutator on the copy reach the original', () => {
    const ledger = generateHouseLedger(SPEC);
    const copy = cloneLedger(ledger);
    copy.tasks[0]!.title = 'mutated';
    expect(ledger.tasks[0]!.title).not.toBe('mutated');
  });

  it('copies the watermark map rather than emptying it', () => {
    // `wins()` short-circuits on a missing stamp, so a peer merging against `{}`
    // is not running the merge the product runs — every conflict measurement on
    // such a clone would silently take the wrong branch.
    const ledger = generateHouseLedger(SPEC);
    const copy = cloneLedger(ledger);
    const lww = copy.lww as Record<string, Record<string, unknown>>;
    expect(Object.keys(lww.tasks ?? {})).toHaveLength(ledger.tasks.length);
  });
});

describe('house corpus — the apply phase measures the paths it claims', () => {
  const ledger = generateHouseLedger(SPEC);

  it('routes a 200-key delete to the indexed cursor and a 1-key delete to the scan', () => {
    const bulk = bulkDeleteDelta(ledger, 'maintenanceCompletions', 200, 0);
    expect(bulk.d.maintenanceCompletions).toHaveLength(200);
    expect(planTableStrategy(bulk as never, 'maintenanceCompletions')).toBe('index');

    const one = bulkDeleteDelta(ledger, 'maintenanceCompletions', 1, 0);
    expect(planTableStrategy(one as never, 'maintenanceCompletions')).toBe('scan');
  });

  it('picks DISTINCT keys, so a 200-delete really deletes 200 rows', () => {
    const bulk = bulkDeleteDelta(ledger, 'maintenanceCompletions', 200, 37);
    expect(new Set(bulk.d.maintenanceCompletions).size).toBe(200);
  });
});

describe('house corpus — the N5 claim the baseline headlines', () => {
  const ledger = generateHouseLedger(SPEC);

  it('makes a `tasks` row cost far more to re-seal than a completion row', () => {
    // This is the whole §1.6 argument in one assertion: a row's write cost is
    // driven by its COLUMN COUNT, because each column carries a stamp.
    const taskEnvelope = JSON.stringify({
      row: ledger.tasks[0],
      lww: (ledger.lww as Record<string, Record<string, unknown>>).tasks![
        String(ledger.tasks[0]!.id)
      ],
    });
    const completionEnvelope = JSON.stringify({
      row: ledger.maintenanceCompletions[0],
      lww: (ledger.lww as Record<string, Record<string, unknown>>).maintenanceCompletions![
        String(ledger.maintenanceCompletions[0]!.id)
      ],
    });
    expect(taskEnvelope.length).toBeGreaterThan(completionEnvelope.length * 2);
  });

  it('keeps the stamp map linear in fields, so the arithmetic in the doc holds', () => {
    const lww = ledger.lww as Record<string, Record<string, { f: Record<string, string> }>>;
    const taskId = String(ledger.tasks[0]!.id);
    expect(Object.keys(lww.tasks![taskId]!.f)).toHaveLength(
      Object.keys(ledger.tasks[0]!).length,
    );
  });
});

describe('house corpus — ops-per-row ratio is the declared assumption', () => {
  it('is Budget’s 1.5, inherited and labelled, not independently observed', () => {
    for (const years of [1, 3, 5, 10]) {
      const id = scaleId({ years });
      expect(id.ops).toBe(id.rows + Math.round(id.rows * 0.5));
    }
  });
});
