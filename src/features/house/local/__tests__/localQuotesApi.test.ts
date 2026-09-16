/**
 * `localQuotesApi` against a real in-memory session (plan §6 DoD, H11 sub-wave
 * B2), plus the convergence proof for the two task-scoped tables B2 ledgers
 * without a facade.
 *
 * Five behaviours here are load-bearing beyond the round trips:
 *
 *  - **The expiry fields are recomputed, never stored.** `isExpired` is right
 *    when written and wrong the next morning; ledgering it would replicate
 *    yesterday's answer to every device through per-field LWW.
 *  - **`requestQuotes` is ONE op for N contractors.**
 *    `mutateLocalHouseLedger` captures and diffs the whole ledger per call, so a
 *    loop of single writes is quadratic — and this path runs while the member
 *    watches a spinner.
 *  - **The comparison heuristics are the Worker's, quirks included.** Fastest
 *    timeline is the shortest STRING. Reproducing a weak heuristic is right: a
 *    member comparing the same five quotes online and offline must see the same
 *    badges.
 *  - **The status machine refuses from the wrong state.** "Cannot accept an
 *    expired quote" is true on both backends, so it is a state error and NOT a
 *    `HouseLocalUnsupportedError`.
 *  - **`contractorQuotes` and `quoteRequests` converge on a shared natural key.**
 *    Both are unique on `(task_id, contractor_id)` in D1 and only the id prefix
 *    keeps them apart. Now that both tables are on `HouseLedger`, that claim can
 *    be run rather than asserted about the builders alone.
 */
import {
  getLocalHouseLedger,
  openLocalHouseSession,
  resetLocalHouseSession,
} from '../engine';
import { HouseLocalUnknownPropertyError, HouseLocalUnsupportedError } from '../errors';
import { houseDeterministicIds } from '../ids';
import { localContractorsApi } from '../localContractorsApi';
import { localQuotesApi, type CreateLocalQuoteInput } from '../localQuotesApi';
import { applyLedgerDelta, captureLedgerSnapshot, diffLedger } from '../projection';
import { getHouseUnsupportedCopy } from '../unsupportedCopy';

import { emptyHouseLedger, stampAt, TEST_HOUSEHOLD_ID } from './houseLedgerTestKit';

const USER = 'user-quotes-1';

const DAY_MS = 1000 * 60 * 60 * 24;

let householdId: string;
let contractorId: string;

function opCount(): number {
  return getLocalHouseLedger().ops.length;
}

function inDays(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

async function raise(overrides: Partial<CreateLocalQuoteInput> = {}) {
  const { quote } = await localQuotesApi.create(householdId, {
    contractor_id: contractorId,
    title: 'Replace the shut-off valve',
    amount_cents: 42_000,
    ...overrides,
  });
  return quote;
}

/** Drive a quote to `received`, the only state `accept` will take. */
async function received(overrides: Partial<CreateLocalQuoteInput> = {}) {
  const quote = await raise(overrides);
  await localQuotesApi.markReceived(householdId, quote.id, {});
  return quote;
}

beforeEach(async () => {
  await resetLocalHouseSession();
  const ledger = await openLocalHouseSession({ userId: USER, displayName: 'Quote test home' });
  householdId = ledger.household.id;
  const { contractor } = await localContractorsApi.create(householdId, {
    name: 'Dave Rivera',
    company_name: 'Rivera Plumbing',
    specialty: 'plumber',
    phone: '604-555-0134',
    email: 'dave@rivera.example',
    rating: 4,
  });
  contractorId = contractor.id;
});

afterEach(async () => {
  await resetLocalHouseSession();
});

describe('quotes — create / read / update / delete', () => {
  it('round-trips a quote, opened in `requested` whatever the caller asks', async () => {
    const created = await raise({ notes: 'Verbal, over the phone' });
    expect(created.household_id).toBe(householdId);
    expect(created.status).toBe('requested');
    expect(created.amount_cents).toBe(42_000);
    expect(created.accepted_at).toBeNull();

    const { quote } = await localQuotesApi.getOne(householdId, created.id);
    expect(quote.contractor.name).toBe('Dave Rivera');
    expect(quote.contractor.rating).toBe(4);
    // The client's `QuoteWithDetails` declares these; the Worker omits them. The
    // ledger row cannot lie about its own shape, so the facade fills them in.
    expect(quote.contractor.phone).toBe('604-555-0134');
    expect(quote.contractor.email).toBe('dave@rivera.example');

    const { quote: updated } = await localQuotesApi.update(householdId, created.id, {
      warranty_terms: '',
      estimated_duration: '2-3 days',
    });
    expect(updated.warranty_terms).toBeNull();
    expect(updated.estimated_duration).toBe('2-3 days');

    await localQuotesApi.delete(householdId, created.id);
    const { quotes } = await localQuotesApi.getAll(householdId);
    expect(quotes).toHaveLength(0);
  });

  it('coalesces an explicit zero amount to NULL, exactly as the Worker does', async () => {
    // `input.amountCents || null` — a free quote entered as 0 becomes "no price
    // given" on the server, so it must here too. Otherwise the comparison screen
    // would rank it as the cheapest on one backend and ignore it on the other.
    const free = await raise({ amount_cents: 0 });
    expect(free.amount_cents).toBeNull();
  });

  it('requires the contractor to exist before a quote can be raised', async () => {
    await expect(raise({ contractor_id: 'ctr_missing' })).rejects.toThrow('Contractor not found');
  });

  it('raises for a quote that does not exist', async () => {
    await expect(localQuotesApi.getOne(householdId, 'qte_missing')).rejects.toThrow(
      'Quote not found',
    );
    await expect(
      localQuotesApi.update(householdId, 'qte_missing', { title: 'x' }),
    ).rejects.toThrow('Quote not found');
    await expect(localQuotesApi.delete(householdId, 'qte_missing')).rejects.toThrow(
      'Quote not found',
    );
  });

  it('refuses to answer for a property that is not the active one', async () => {
    await expect(localQuotesApi.getAll('hh_local_someone_else')).rejects.toThrow(
      HouseLocalUnknownPropertyError,
    );
  });

  it('lists newest first and filters on contractor, status and expiry', async () => {
    const soon = await raise({ valid_until: inDays(3) });
    const distant = await raise({ valid_until: inDays(90) });
    await localQuotesApi.markReceived(householdId, distant.id, {});

    const all = await localQuotesApi.getAll(householdId);
    expect(all.quotes).toHaveLength(2);
    expect(all.quotes.map((row) => row.created_at)).toEqual(
      [...all.quotes].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((r) => r.created_at),
    );

    const pending = await localQuotesApi.getPending(householdId);
    expect(pending.quotes.map((row) => row.id)).toEqual([soon.id]);

    const expiring = await localQuotesApi.getAll(householdId, { expiring_soon: true });
    expect(expiring.quotes.map((row) => row.id)).toEqual([soon.id]);

    const other = await localQuotesApi.getAll(householdId, { contractor_id: 'ctr_other' });
    expect(other.quotes).toEqual([]);
  });

  it('drops a quote whose contractor is gone rather than crashing the list', async () => {
    // Orphan SEEDED, not produced by a delete — see the matching test in
    // `localAppointmentsApi.test.ts` for the full reasoning. In short: the
    // cascade defect this originally rode on is fixed, so `delete` no longer
    // strands a quote; what still needs proving is that a dangling row arriving
    // over sync from an older peer does not blank the whole list.
    const quote = await raise();
    const ledger = getLocalHouseLedger();
    ledger.contractors = ledger.contractors.filter((row) => row.id !== contractorId);

    const { quotes } = await localQuotesApi.getAll(householdId);
    expect(quotes).toEqual([]);
    expect(getLocalHouseLedger().quotes).toHaveLength(1);
    await expect(localQuotesApi.getOne(householdId, quote.id)).rejects.toThrow(
      'Contractor not found',
    );
  });
});

describe('quotes — expiry is derived on every read', () => {
  it('flags expiring-soon inside seven days, and expired after the date', async () => {
    const soon = await raise({ valid_until: inDays(3) });
    const gone = await raise({ valid_until: inDays(-2) });
    const far = await raise({ valid_until: inDays(60) });
    const open = await raise();

    const byId = new Map(
      (await localQuotesApi.getAll(householdId)).quotes.map((row) => [row.id, row]),
    );

    expect(byId.get(soon.id)!.isExpiringSoon).toBe(true);
    expect(byId.get(soon.id)!.isExpired).toBe(false);
    expect(byId.get(soon.id)!.daysUntilExpiration).toBe(3);

    // Already expired is NOT "expiring soon" — the badge would be misleading.
    expect(byId.get(gone.id)!.isExpiringSoon).toBe(false);
    expect(byId.get(gone.id)!.isExpired).toBe(true);
    // Negative rather than clamped: the detail screen distinguishes "expires
    // today" from "expired last week".
    expect(byId.get(gone.id)!.daysUntilExpiration).toBeLessThan(0);

    expect(byId.get(far.id)!.isExpiringSoon).toBe(false);

    // No expiry set at all is neither, and has no countdown.
    expect(byId.get(open.id)!.isExpiringSoon).toBe(false);
    expect(byId.get(open.id)!.isExpired).toBe(false);
    expect(byId.get(open.id)!.daysUntilExpiration).toBeNull();
  });

  it('never writes the expiry flags or the contractor join to the row', async () => {
    await raise({ valid_until: inDays(3) });
    const stored = getLocalHouseLedger().quotes[0]! as unknown as Record<string, unknown>;
    expect(stored.isExpired).toBeUndefined();
    expect(stored.isExpiringSoon).toBeUndefined();
    expect(stored.daysUntilExpiration).toBeUndefined();
    expect(stored.contractor).toBeUndefined();
  });
});

describe('quotes — requesting from several contractors', () => {
  async function twoMoreContractors() {
    const { contractor: sparks } = await localContractorsApi.create(householdId, {
      name: 'Alan Voss',
      specialty: 'electrician',
    });
    const { contractor: roofer } = await localContractorsApi.create(householdId, {
      name: 'Mia Roth',
      specialty: 'roofer',
    });
    return [sparks.id, roofer.id];
  }

  it('creates one quote per contractor in ONE op', async () => {
    const others = await twoMoreContractors();
    const before = opCount();

    const { quotes } = await localQuotesApi.requestQuotes(householdId, {
      contractor_ids: [contractorId, ...others],
      title: 'Re-roof the garage',
      description: 'Cedar shakes, approx 400 sq ft',
    });

    // One op per CHUNK, never one per row — three rows fit in one chunk.
    expect(opCount() - before).toBe(1);
    expect(quotes).toHaveLength(3);
    expect(quotes.every((quote) => quote.status === 'requested')).toBe(true);
    expect(quotes.map((quote) => quote.contractor_id).sort()).toEqual(
      [contractorId, ...others].sort(),
    );
  });

  it('skips a contractor that is gone rather than losing the whole request', async () => {
    // The Worker catches per contractor and continues (`quote-service.ts:272`).
    // The member picked five people off a list; losing all five over one stale
    // row would be worse than losing the row.
    const { quotes } = await localQuotesApi.requestQuotes(householdId, {
      contractor_ids: [contractorId, 'ctr_missing'],
      title: 'Re-roof the garage',
      description: 'Cedar shakes',
    });
    expect(quotes).toHaveLength(1);
    expect(quotes[0]!.contractor_id).toBe(contractorId);
  });

  it('raises only when every contractor is unknown, as the Worker does', async () => {
    await expect(
      localQuotesApi.requestQuotes(householdId, {
        contractor_ids: ['ctr_a', 'ctr_b'],
        title: 'Re-roof the garage',
        description: 'Cedar shakes',
      }),
    ).rejects.toThrow('Failed to create any quotes');
    expect(getLocalHouseLedger().quotes).toHaveLength(0);
  });
});

describe('quotes — the rule-based comparison', () => {
  it('picks the price extremes, ignoring quotes with no amount', async () => {
    const cheap = await raise({ amount_cents: 30_000 });
    const dear = await raise({ amount_cents: 95_000 });
    const priceless = await raise({ amount_cents: undefined });

    const { comparison } = await localQuotesApi.compare(householdId, {
      quote_ids: [dear.id, cheap.id, priceless.id],
    });

    // The caller's order, not the ledger's — `Promise.all(ids.map(...))`.
    expect(comparison.quotes.map((row) => row.id)).toEqual([dear.id, cheap.id, priceless.id]);
    expect(comparison.summary.lowestPrice).toEqual({ quoteId: cheap.id, amount: 30_000 });
    expect(comparison.summary.highestPrice).toEqual({ quoteId: dear.id, amount: 95_000 });
  });

  it('calls the SHORTEST duration string the fastest, quirk and all', async () => {
    // `quote-service.ts:313` sorts by string length and calls it a
    // simplification. "1 day" beats "2 days" by accident. Reproduced because the
    // two backends must award the same badge to the same quote.
    const brief = await raise({ estimated_duration: '1 day' });
    await raise({ estimated_duration: 'about two and a half weeks' });

    const { comparison } = await localQuotesApi.compare(householdId, {
      quote_ids: (await localQuotesApi.getAll(householdId)).quotes.map((row) => row.id),
    });
    expect(comparison.summary.fastestTimeline).toEqual({ quoteId: brief.id, duration: '1 day' });
  });

  it('calls the LONGEST warranty string the best, and ranks the contractor', async () => {
    const wordy = await raise({ warranty_terms: 'Five years on parts and ten years on labour' });
    await raise({ warranty_terms: '1 year' });

    const { comparison } = await localQuotesApi.compare(householdId, {
      quote_ids: (await localQuotesApi.getAll(householdId)).quotes.map((row) => row.id),
    });
    expect(comparison.summary.bestWarranty?.quoteId).toBe(wordy.id);
    expect(comparison.summary.highestRatedContractor?.rating).toBe(4);
  });

  it('leaves the summary empty when nothing is comparable', async () => {
    const bare = await localQuotesApi.create(householdId, {
      contractor_id: contractorId,
      title: 'Nothing filled in',
    });
    const { comparison } = await localQuotesApi.compare(householdId, {
      quote_ids: [bare.quote.id],
    });
    expect(comparison.summary.lowestPrice).toBeNull();
    expect(comparison.summary.fastestTimeline).toBeNull();
    expect(comparison.summary.bestWarranty).toBeNull();
  });

  it('raises on an unknown id rather than silently comparing fewer quotes', async () => {
    const quote = await raise();
    await expect(
      localQuotesApi.compare(householdId, { quote_ids: [quote.id, 'qte_missing'] }),
    ).rejects.toThrow('Quote not found');
  });
});

describe('quotes — the status machine', () => {
  it('marks received, then accepts, stamping the moment', async () => {
    const quote = await raise({ valid_until: inDays(30) });

    const { quote: marked } = await localQuotesApi.markReceived(householdId, quote.id, {
      amount_cents: 51_000,
      estimated_duration: '2 days',
    });
    expect(marked.status).toBe('received');
    expect(marked.amount_cents).toBe(51_000);

    const { quote: accepted } = await localQuotesApi.accept(householdId, quote.id);
    expect(accepted.status).toBe('accepted');
    expect(accepted.accepted_at).toBeTruthy();
  });

  it('omits the project half, because that table is not live yet', async () => {
    // `projects` is B3. The response type already makes `project` optional — the
    // Worker omits it whenever the caller does not ask — so a local-first
    // household gets the same shape, not a broken one.
    const quote = await received();
    const result = await localQuotesApi.accept(householdId, quote.id, true);
    expect(result.quote.status).toBe('accepted');
    expect((result as { project?: unknown }).project).toBeUndefined();
    expect(getLocalHouseLedger().quotes).toHaveLength(1);
  });

  it('refuses every transition the Worker refuses', async () => {
    const fresh = await raise();
    // Accept demands `received` or `reviewing`.
    await expect(localQuotesApi.accept(householdId, fresh.id)).rejects.toThrow(
      'Can only accept received or reviewing quotes',
    );

    await localQuotesApi.markReceived(householdId, fresh.id, {});
    await expect(localQuotesApi.markReceived(householdId, fresh.id, {})).rejects.toThrow(
      'Can only mark requested quotes as received',
    );

    await localQuotesApi.accept(householdId, fresh.id);
    await expect(localQuotesApi.decline(householdId, fresh.id)).rejects.toThrow(
      'Quote has already been accepted or declined',
    );
  });

  it('will not accept a quote that has already run out', async () => {
    const stale = await received({ valid_until: inDays(-1) });
    await expect(localQuotesApi.accept(householdId, stale.id)).rejects.toThrow(
      'Cannot accept an expired quote',
    );
  });

  it('appends the decline reason to the notes instead of replacing them', async () => {
    const quote = await raise({ notes: 'Quoted over the phone' });
    const { quote: declined } = await localQuotesApi.decline(householdId, quote.id, 'Too dear');
    expect(declined.status).toBe('declined');
    expect(declined.declined_at).toBeTruthy();
    expect(declined.notes).toBe('Quoted over the phone\nDeclined: Too dear');
  });

  it('writes exactly one op per member action, transitions included', async () => {
    const quote = await received();
    const before = opCount();
    await localQuotesApi.accept(householdId, quote.id);
    expect(opCount() - before).toBe(1);
  });
});

describe('quotes — the server-only surface (P4 AI, H6 blobs)', () => {
  it('throws rather than falling through to a Worker with no quotes', async () => {
    const quote = await raise();
    await expect(
      localQuotesApi.compareWithAI(householdId, { quote_ids: [quote.id, quote.id] }),
    ).rejects.toBeInstanceOf(HouseLocalUnsupportedError);
  });

  it('throws SYNCHRONOUSLY for the document URL, because the remote method is sync', async () => {
    // The Proxy's rejected-promise convention exists because every other remote
    // method returns a promise. This one string-builds a URL, so there is no
    // promise to reject and the throw lands where the member tapped.
    const quote = await raise();
    expect(() => localQuotesApi.getDocumentUrl(householdId, quote.id)).toThrow(
      HouseLocalUnsupportedError,
    );
  });

  it('carries member-facing copy and the documented error code', async () => {
    const quote = await raise();
    const error = await localQuotesApi
      .compareWithAI(householdId, { quote_ids: [quote.id, quote.id] })
      .catch((caught: unknown) => caught as HouseLocalUnsupportedError);

    expect(error.code).toBe('house_local_unsupported');
    expect(error.message).toBe(getHouseUnsupportedCopy(error.method).message);
    expect(error.message).not.toContain('quotesApi');
    // …and it points at what still works, which is the whole comparison minus
    // the ranking.
    expect(error.message).toMatch(/side by side/i);
  });
});

/**
 * The two task-scoped tables B2 ledgers WITHOUT a facade.
 *
 * Nothing on device can create a `contractor_quotes` row — a quote from a third
 * party arrives through a server, which is why `tasksApi`'s quote methods still
 * throw. What the ledger has to guarantee is that a row a member already holds
 * converges instead of duplicating, and that the quote does not swallow the
 * request that produced it. Both share the natural key `(task_id, contractor_id)`,
 * so the id prefix is the only thing between them.
 */
describe('S3b — the shared natural key of `contractorQuotes` and `quoteRequests`', () => {
  const STAMP_A = stampAt(10, 'member-a', 'op-a');
  const STAMP_B = stampAt(20, 'member-b', 'op-b');

  it('converges an offline double-file to one quote, keeping the newer answer', () => {
    const id = houseDeterministicIds.contractorQuote('task-9', 'ctr-3');
    const deviceA = emptyHouseLedger();
    const deviceB = emptyHouseLedger();

    const row = (amount: number) => ({
      id,
      task_id: 'task-9',
      contractor_id: 'ctr-3',
      household_id: TEST_HOUSEHOLD_ID,
      amount,
      currency: 'CAD',
      status: 'pending',
      submitted_at: '2026-08-10T00:00:00.000Z',
      entry_method: 'document_upload',
      created_at: '2026-08-10T00:00:00.000Z',
      updated_at: '2026-08-10T00:00:00.000Z',
    });

    const beforeA = captureLedgerSnapshot(deviceA);
    deviceA.contractorQuotes.push(row(120_000) as never);
    const deltaA = diffLedger(beforeA, deviceA)!;
    applyLedgerDelta(deviceA, deltaA, STAMP_A);

    const beforeB = captureLedgerSnapshot(deviceB);
    deviceB.contractorQuotes.push(row(135_000) as never);
    const deltaB = diffLedger(beforeB, deviceB)!;
    applyLedgerDelta(deviceB, deltaB, STAMP_B);

    applyLedgerDelta(deviceA, deltaB, STAMP_B);
    applyLedgerDelta(deviceB, deltaA, STAMP_A);

    // One row, not two. With a random id the comparison screen would show the
    // same contractor twice at two prices.
    expect(deviceA.contractorQuotes).toHaveLength(1);
    expect(deviceB.contractorQuotes).toHaveLength(1);
    expect(deviceA.contractorQuotes[0]!.amount).toBe(135_000);
  });

  it('keeps the request and the quote it produced as two rows', () => {
    // Same task, same contractor, two tables. If the prefixes ever collided,
    // accepting the quote would overwrite the request that asked for it — and
    // the merge would call that convergence.
    expect(houseDeterministicIds.contractorQuote('task-9', 'ctr-3')).not.toBe(
      houseDeterministicIds.quoteRequest('task-9', 'ctr-3'),
    );

    const ledger = emptyHouseLedger();
    ledger.contractorQuotes.push({
      id: houseDeterministicIds.contractorQuote('task-9', 'ctr-3'),
      task_id: 'task-9',
      contractor_id: 'ctr-3',
      household_id: TEST_HOUSEHOLD_ID,
    } as never);
    ledger.quoteRequests.push({
      id: houseDeterministicIds.quoteRequest('task-9', 'ctr-3'),
      task_id: 'task-9',
      contractor_id: 'ctr-3',
      household_id: TEST_HOUSEHOLD_ID,
    } as never);

    const before = captureLedgerSnapshot(emptyHouseLedger());
    const delta = diffLedger(before, ledger)!;
    const peer = emptyHouseLedger();
    applyLedgerDelta(peer, delta, STAMP_A);

    expect(peer.contractorQuotes).toHaveLength(1);
    expect(peer.quoteRequests).toHaveLength(1);
    expect(peer.contractorQuotes[0]!.id).not.toBe(peer.quoteRequests[0]!.id);
  });
});
