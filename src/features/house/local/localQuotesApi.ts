/**
 * Local `quotes` — the ledger counterpart of `src/api/quotes.ts` (plan §11,
 * sub-wave B2).
 *
 * **This module owns `quotes`, the labor-hub table, and NOT `contractor_quotes`.**
 * The two are unrelated despite the names: `quotes` is raised by the member
 * against a contractor they already know, optionally hanging off an appointment,
 * and is what `quotesApi` and `useHomeDashboard`'s pending-quote count read.
 * `contractor_quotes` is the 42-column task-scoped table a contractor's PDF is
 * extracted into, reachable only through `tasksApi.getTaskQuotes`. B2 ledgers
 * both — see `HouseLedger` — but only this one gets a facade, because only this
 * one has writes a device can perform. Conflating them is the single easiest
 * mistake to make in this sub-wave.
 *
 * **Eleven of the 13 methods are local. Two are not, for different reasons:**
 *
 *  - `compareWithAI` runs an LLM over every quote's price, warranty, contractor
 *    rating and notes. There is no on-device equivalent and no cached one, so it
 *    throws — with copy that says the side-by-side comparison still works, which
 *    is true and is what `compare` below does.
 *  - `getDocumentUrl` builds a URL into the Worker's R2 bucket. It is the only
 *    SYNCHRONOUS method on either remote module, and that shapes the gap: it
 *    cannot return a rejected promise, so it throws where it is called. A member
 *    who taps "view the PDF" gets the copy; a member who does anything else with
 *    the quote does not notice.
 *
 * `compare` itself is local and complete. Its summary is four sorts and a
 * reduction over rows the ledger already holds — the "AI" in the screen's name
 * is the layer above it, not this. Shipping the rule-based comparison offline is
 * most of the feature and is exactly what the Worker falls back to when a
 * household has no usable AI key (`quote-service.ts:545`).
 *
 * **`QuoteWithDetails` is composed, never stored.** The contractor join,
 * `isExpiringSoon`, `isExpired` and `daysUntilExpiration` are all derived — the
 * last three from `valid_until` and the clock. An expiry FLAG is the worst
 * possible thing to ledger: it is right when written and wrong the next morning,
 * and per-field LWW would then replicate yesterday's answer to every device.
 *
 * One divergence from the Worker, in the client's favour: the server's
 * `QuoteWithDetails` omits `phone`, `email` and `daysUntilExpiration`, which the
 * CLIENT's interface declares. The remote module is therefore lying about its
 * own response shape today; the ledger row cannot, because `tsc` checks it. This
 * facade fills all three in. That is a superset of what the server sends, so no
 * screen can break on it.
 *
 * **Money is cents throughout** (`amount_cents`, `amount_range_*_cents`),
 * unlike `contractor_visits.cost`. Nothing here divides by 100 — the row IS the
 * DTO and the screens format it.
 *
 * **`requestQuotes` is the sub-wave's one bulk path.** It creates one quote per
 * contractor in a single chunked write rather than N single writes, because
 * `mutateLocalHouseLedger` captures and diffs the WHOLE ledger per call.
 */
// Side-effect BEFORE @symply/local-first — @noble captures globalThis.crypto at
// module load, and this module is a Proxy entry point, so it can be the first
// House module a screen pulls into the graph.
import './cryptoPolyfill';

import { SPECIALTY_INFO, type ContractorSpecialty } from '@api/contractors';
import type { QuoteComparison, QuoteStatus, QuoteWithDetails } from '@api/quotes';

import { HouseLocalUnknownPropertyError, HouseLocalUnsupportedError } from './errors';
import { newLocalId } from './ids';
import { activeHouseholdId, nowIso, rowsOf, writeLocal, writeLocalBulk } from './localWrite';
import type { LocalContractor, LocalQuote } from './types';

// ---------------------------------------------------------------------------
// Input shapes — mirrors of the module-private request types in
// `src/api/quotes.ts`. They are not exported there, so they are restated rather
// than imported; `apiParity.test.ts` catches a method that disappears and `tsc`
// catches a field whose type changed on the DTO.
// ---------------------------------------------------------------------------

export type CreateLocalQuoteInput = {
  contractor_id: string;
  title: string;
  description?: string;
  amount_cents?: number;
  amount_range_low_cents?: number;
  amount_range_high_cents?: number;
  valid_until?: string;
  estimated_duration?: string;
  warranty_terms?: string;
  notes?: string;
  appointment_id?: string;
  linked_report_id?: string;
  linked_task_id?: string;
};

export type UpdateLocalQuoteInput = Partial<
  Omit<CreateLocalQuoteInput, 'contractor_id' | 'appointment_id' | 'linked_report_id' | 'linked_task_id'>
> & {
  status?: QuoteStatus;
  document_key?: string;
};

export type RequestLocalQuotesInput = {
  contractor_ids: string[];
  title: string;
  description: string;
  linked_report_id?: string;
  linked_task_id?: string;
};

export type LocalQuoteFilters = {
  contractor_id?: string;
  status?: QuoteStatus;
  expiring_soon?: boolean;
};

export type MarkLocalQuoteReceivedInput = {
  amount_cents?: number;
  amount_range_low_cents?: number;
  amount_range_high_cents?: number;
  valid_until?: string;
  estimated_duration?: string;
  warranty_terms?: string;
  document_key?: string;
};

/** A quote is "expiring soon" inside this many days — `quote-service.ts:98`. */
const EXPIRY_WARNING_DAYS = 7;

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * The Worker's `ValidationError` — a 400 the screens already render, and NOT a
 * `HouseLocalUnsupportedError`. "You cannot accept an expired quote" is true on
 * both backends; "this feature is off in private mode" would not be.
 */
class LocalQuoteStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalQuoteStateError';
  }
}

function requireActiveProperty(householdId: string): string {
  const active = activeHouseholdId();
  if (householdId !== active) throw new HouseLocalUnknownPropertyError(householdId);
  return active;
}

function quotesOf(householdId: string): LocalQuote[] {
  requireActiveProperty(householdId);
  return rowsOf<LocalQuote>('quotes');
}

function contractorsById(householdId: string): Map<string, LocalContractor> {
  requireActiveProperty(householdId);
  return new Map(rowsOf<LocalContractor>('contractors').map((row) => [row.id, row]));
}

/** Server order: `created_at` desc (`getQuotes`). */
function byCreatedAtDesc(a: LocalQuote, b: LocalQuote): number {
  return b.created_at.localeCompare(a.created_at);
}

/**
 * Whole days until `valid_until`, rounded UP — the Worker's `Math.ceil` over a
 * millisecond difference, kept exactly so the "expires in 1 day" badge appears
 * on the same calendar day on both backends.
 *
 * Returns null for a quote with no expiry, which is what the client's
 * `daysUntilExpiration` models. A NEGATIVE number is returned for an already
 * expired quote rather than clamping to zero: the detail screen distinguishes
 * "expires today" from "expired last week".
 */
function daysUntilExpiration(validUntil: string | null): number | null {
  if (!validUntil) return null;
  return Math.ceil((new Date(validUntil).getTime() - Date.now()) / MS_PER_DAY);
}

function isExpiringSoon(validUntil: string | null): boolean {
  const days = daysUntilExpiration(validUntil);
  return days !== null && days > 0 && days <= EXPIRY_WARNING_DAYS;
}

function isExpired(validUntil: string | null): boolean {
  if (!validUntil) return false;
  return new Date(validUntil) < new Date();
}

/**
 * The join plus the three derived expiry fields, rebuilt on every read.
 *
 * `enrichQuote` throws `NotFoundError('Contractor not found')` when the join
 * dangles, and on device it can: D1 cascades `quotes` when a contractor is
 * deleted, but `localContractorsApi.delete` — written in B1, before this table
 * was live — cascades only visits, documents and representatives. A list read
 * drops the orphan so one dangling row cannot blank a whole screen; a single
 * read raises, matching the Worker.
 */
function enrich(quote: LocalQuote, contractor: LocalContractor): QuoteWithDetails {
  return {
    ...quote,
    contractor: {
      id: contractor.id,
      name: contractor.name,
      company_name: contractor.company_name,
      specialty: contractor.specialty,
      // The server omits these two from its own `QuoteWithDetails` even though
      // the client's interface declares them. Filled in here — see the header.
      phone: contractor.phone,
      email: contractor.email,
      rating: contractor.rating,
      specialtyInfo:
        SPECIALTY_INFO[contractor.specialty as ContractorSpecialty] ?? SPECIALTY_INFO.other,
    },
    isExpiringSoon: isExpiringSoon(quote.valid_until),
    isExpired: isExpired(quote.valid_until),
    daysUntilExpiration: daysUntilExpiration(quote.valid_until),
  };
}

function enrichAll(
  rows: readonly LocalQuote[],
  byId: Map<string, LocalContractor>,
): QuoteWithDetails[] {
  const out: QuoteWithDetails[] = [];
  for (const row of rows) {
    const contractor = byId.get(row.contractor_id);
    if (contractor) out.push(enrich(row, contractor));
  }
  return out;
}

function requireQuote(householdId: string, quoteId: string): LocalQuote {
  const found = quotesOf(householdId).find((row) => row.id === quoteId);
  if (!found) throw new Error('Quote not found');
  return found;
}

/** Build one quote row. Shared by `create` and the bulk `requestQuotes`. */
function newQuoteRow(
  householdId: string,
  data: CreateLocalQuoteInput,
  timestamp: string,
): LocalQuote {
  return {
    // Random id, not deterministic: `quotes` carries no uniqueIndex in D1, and
    // two quotes from one contractor for two jobs are two quotes. The S3b pair
    // in this sub-wave is `contractorQuotes` / `quoteRequests`, not this table.
    id: newLocalId('qte'),
    household_id: householdId,
    contractor_id: data.contractor_id,
    appointment_id: data.appointment_id || null,
    title: data.title,
    description: data.description || null,
    // The Worker coalesces with `||`, so an explicit 0 becomes NULL. Reproduced
    // rather than corrected: a free quote entered as `0` must round-trip the
    // same way on both backends, or the comparison screen would rank it as the
    // cheapest on one and as "no price given" on the other.
    amount_cents: data.amount_cents || null,
    amount_range_low_cents: data.amount_range_low_cents || null,
    amount_range_high_cents: data.amount_range_high_cents || null,
    valid_until: data.valid_until || null,
    estimated_duration: data.estimated_duration || null,
    warranty_terms: data.warranty_terms || null,
    // The route hard-codes `requested`; nothing can be created already received.
    status: 'requested',
    document_key: null,
    notes: data.notes || null,
    linked_report_id: data.linked_report_id || null,
    linked_task_id: data.linked_task_id || null,
    accepted_at: null,
    declined_at: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

/**
 * The single write path every mutation funnels through — one op per member
 * action, whatever method they reached it by.
 *
 * `accept`, `decline` and `markReceived` all end here rather than each opening
 * their own write, so a status change plus its timestamp plus its note is one
 * op that a peer applies whole. Splitting them would let a peer hold a quote
 * marked accepted with no `accepted_at`, which renders as an accepted quote
 * nobody agreed to.
 */
async function applyUpdate(
  householdId: string,
  quoteId: string,
  patch: Partial<LocalQuote>,
  op: { opType: string; payload: unknown },
): Promise<void> {
  await writeLocal(
    (draft) => {
      const quote = draft.quotes.find(
        (row) => row.id === quoteId && row.household_id === householdId,
      );
      if (!quote) throw new Error('Quote not found');
      Object.assign(quote, patch);
      quote.updated_at = nowIso();
    },
    { opType: op.opType, entityType: 'quote', entityId: quoteId, payload: op.payload },
  );
}

/**
 * `updateQuote`'s field semantics: absent means "leave it alone", empty string
 * clears to NULL. Kept separate from `applyUpdate` because the status
 * transitions build their patch from known-good values and must not run text
 * fields through the coalesce a second time.
 */
function updatePatch(data: UpdateLocalQuoteInput): Partial<LocalQuote> {
  const patch: Partial<LocalQuote> = {};
  if (data.title !== undefined) patch.title = data.title;
  if (data.description !== undefined) patch.description = data.description || null;
  if (data.amount_cents !== undefined) patch.amount_cents = data.amount_cents;
  if (data.amount_range_low_cents !== undefined) {
    patch.amount_range_low_cents = data.amount_range_low_cents;
  }
  if (data.amount_range_high_cents !== undefined) {
    patch.amount_range_high_cents = data.amount_range_high_cents;
  }
  if (data.valid_until !== undefined) patch.valid_until = data.valid_until || null;
  if (data.estimated_duration !== undefined) {
    patch.estimated_duration = data.estimated_duration || null;
  }
  if (data.warranty_terms !== undefined) patch.warranty_terms = data.warranty_terms || null;
  if (data.status !== undefined) patch.status = data.status;
  if (data.document_key !== undefined) patch.document_key = data.document_key || null;
  if (data.notes !== undefined) patch.notes = data.notes || null;
  return patch;
}

export const localQuotesApi = {
  /** `GET /quotes` — `QuoteService.getQuotes`. */
  getAll: async (householdId: string, filters?: LocalQuoteFilters) => {
    const byId = contractorsById(householdId);
    const rows = quotesOf(householdId)
      .filter((row) => (filters?.contractor_id ? row.contractor_id === filters.contractor_id : true))
      .filter((row) => (filters?.status ? row.status === filters.status : true))
      .filter((row) => (filters?.expiring_soon ? isExpiringSoon(row.valid_until) : true))
      .sort(byCreatedAtDesc);
    return { quotes: enrichAll(rows, byId) };
  },

  /**
   * `GET /quotes/pending` — `getQuotes({ status: 'requested' })`.
   *
   * "Pending" means asked-for-but-not-yet-answered, not "awaiting my decision".
   * This is the one B2 read with a live React Query subscriber:
   * `useHomeDashboard` counts it onto the home tab.
   */
  getPending: async (householdId: string) =>
    localQuotesApi.getAll(householdId, { status: 'requested' }),

  getOne: async (householdId: string, quoteId: string) => {
    const found = requireQuote(householdId, quoteId);
    const contractor = contractorsById(householdId).get(found.contractor_id);
    if (!contractor) throw new Error('Contractor not found');
    return { quote: enrich(found, contractor) };
  },

  create: async (householdId: string, data: CreateLocalQuoteInput) => {
    requireActiveProperty(householdId);
    const contractor = contractorsById(householdId).get(data.contractor_id);
    // The Worker verifies the contractor belongs to the household first. B1 is
    // what made that answerable on device — the dependency §11 used to order the
    // sub-waves.
    if (!contractor) throw new Error('Contractor not found');

    const quote = newQuoteRow(householdId, data, nowIso());
    await writeLocal(
      (draft) => {
        draft.quotes.push(quote);
      },
      { opType: 'QUOTE_CREATE', entityType: 'quote', entityId: quote.id, payload: quote },
    );
    return { quote: enrich(quote, contractor) };
  },

  /**
   * `POST /quotes/request` — one quote per contractor, in ONE chunked write.
   *
   * The Worker loops `createQuote` and swallows per-contractor failures
   * (`quote-service.ts:272`), raising only if EVERY one failed. That shape is
   * kept: an unknown contractor id is skipped rather than aborting the other
   * four, because the member picked five people off a list and losing the whole
   * request over one stale row would be worse than losing the row.
   *
   * `writeLocalBulk` is what makes it one op per chunk instead of one per
   * contractor — `mutateLocalHouseLedger` diffs the WHOLE ledger per call, so a
   * loop of single writes is quadratic. Five contractors is one op; the chunker
   * only splits when the plaintext budget demands it.
   */
  requestQuotes: async (householdId: string, data: RequestLocalQuotesInput) => {
    requireActiveProperty(householdId);
    const byId = contractorsById(householdId);
    const timestamp = nowIso();

    const rows = data.contractor_ids
      .filter((contractorId) => byId.has(contractorId))
      .map((contractorId) =>
        newQuoteRow(
          householdId,
          {
            contractor_id: contractorId,
            title: data.title,
            description: data.description,
            linked_report_id: data.linked_report_id,
            linked_task_id: data.linked_task_id,
          },
          timestamp,
        ),
      );

    if (rows.length === 0) throw new LocalQuoteStateError('Failed to create any quotes');

    await writeLocalBulk(
      rows,
      (draft, chunk) => {
        draft.quotes.push(...chunk);
      },
      (chunk, index) => ({
        opType: 'QUOTE_REQUEST_BULK',
        entityType: 'quote',
        // The chunk's first row identifies the op. Every row is in the payload,
        // so the entity id only has to be stable and distinct per op.
        entityId: chunk[0]?.id ?? `${timestamp}_${index}`,
        payload: { quotes: chunk },
      }),
    );

    return { quotes: enrichAll(rows, byId) };
  },

  /**
   * `POST /quotes/compare` — the rule-based comparison, local and complete.
   *
   * Every heuristic is the Worker's, quirks included, because the two must agree
   * about which quote wears the "best warranty" badge:
   *
   *  - **fastest timeline is the SHORTEST STRING**, not the shortest duration.
   *    `estimated_duration` is free text ("2-3 days"), so `quote-service.ts:313`
   *    sorts by `.length` and calls it a simplification. "1 day" beats "2 days"
   *    by accident and "a fortnight" beats "3-4 weeks" by accident too.
   *  - **best warranty is the LONGEST STRING**, same trick inverted.
   *  - a quote with no `amount_cents` is excluded from the price extremes rather
   *    than counted as zero.
   *
   * Reproducing a weak heuristic is the right call here: a member comparing the
   * same five quotes online and offline must see the same badges, and improving
   * the heuristic is a change to make on BOTH sides at once.
   */
  compare: async (householdId: string, data: { quote_ids: string[] }) => {
    const byId = contractorsById(householdId);
    // `Promise.all(ids.map(getQuote))` on the Worker — so an unknown id raises
    // rather than being skipped, and the order follows the CALLER's list, not
    // the ledger's.
    const quotes = data.quote_ids.map((quoteId) => {
      const row = requireQuote(householdId, quoteId);
      const contractor = byId.get(row.contractor_id);
      if (!contractor) throw new Error('Contractor not found');
      return enrich(row, contractor);
    });

    const summary: QuoteComparison['summary'] = {
      lowestPrice: null,
      highestPrice: null,
      fastestTimeline: null,
      bestWarranty: null,
      highestRatedContractor: null,
    };

    const priced = quotes.filter((quote) => quote.amount_cents !== null);
    if (priced.length > 0) {
      const sorted = [...priced].sort((a, b) => (a.amount_cents ?? 0) - (b.amount_cents ?? 0));
      const cheapest = sorted[0]!;
      const dearest = sorted[sorted.length - 1]!;
      summary.lowestPrice = { quoteId: cheapest.id, amount: cheapest.amount_cents! };
      summary.highestPrice = { quoteId: dearest.id, amount: dearest.amount_cents! };
    }

    const timed = quotes.filter((quote) => quote.estimated_duration !== null);
    if (timed.length > 0) {
      const sorted = [...timed].sort(
        (a, b) => (a.estimated_duration ?? '').length - (b.estimated_duration ?? '').length,
      );
      const fastest = sorted[0]!;
      summary.fastestTimeline = {
        quoteId: fastest.id,
        duration: fastest.estimated_duration!,
      };
    }

    const warranted = quotes.filter((quote) => quote.warranty_terms !== null);
    if (warranted.length > 0) {
      const sorted = [...warranted].sort(
        (a, b) => (b.warranty_terms ?? '').length - (a.warranty_terms ?? '').length,
      );
      const best = sorted[0]!;
      summary.bestWarranty = { quoteId: best.id, terms: best.warranty_terms! };
    }

    const rated = quotes.filter((quote) => quote.contractor.rating !== null);
    if (rated.length > 0) {
      const sorted = [...rated].sort(
        (a, b) => (b.contractor.rating ?? 0) - (a.contractor.rating ?? 0),
      );
      const top = sorted[0]!;
      summary.highestRatedContractor = { quoteId: top.id, rating: top.contractor.rating! };
    }

    return { comparison: { quotes, summary } };
  },

  /**
   * P4 (plan §9). Weighing quotes against each other needs a model that can read
   * every one of them — price, warranty text, the contractor's rating and the
   * member's own notes. There is no on-device equivalent, so this throws with
   * copy that points at `compare`, which does work.
   *
   * Present and throwing rather than absent: a missing key routes to a Worker
   * that holds no quotes for this household and answers 200 with an empty
   * comparison, which reads as "none of your quotes are worth recommending".
   */
  compareWithAI: async (
    _householdId: string,
    _data: {
      quote_ids: string[];
      task_context?: { title: string; description?: string; category?: string };
    },
  ) => {
    throw new HouseLocalUnsupportedError('quotesApi.compareWithAI');
  },

  update: async (householdId: string, quoteId: string, data: UpdateLocalQuoteInput) => {
    requireQuote(householdId, quoteId);
    await applyUpdate(householdId, quoteId, updatePatch(data), {
      opType: 'QUOTE_UPDATE',
      payload: data,
    });
    return localQuotesApi.getOne(householdId, quoteId);
  },

  /**
   * The Worker checks the row exists and then deletes it, so a second tap 404s.
   * Mirrored — `QuoteDetailScreen` navigates back on success, and a silent 204
   * on a row that is already gone would look like the delete worked twice.
   *
   * The appointment keeps its `linked_quote_id`, because D1 declares that column
   * with no reference at all (`schema-labor-hub.ts:71`) — it is a plain text
   * pointer the server never cleans up either. Diverging would mean a
   * local-first household's appointments lose a link that a server-backed
   * household's keep.
   */
  delete: async (householdId: string, quoteId: string) => {
    requireActiveProperty(householdId);
    await writeLocal(
      (draft) => {
        const exists = draft.quotes.some(
          (row) => row.id === quoteId && row.household_id === householdId,
        );
        if (!exists) throw new Error('Quote not found');
        draft.quotes = draft.quotes.filter((row) => row.id !== quoteId);
      },
      { opType: 'QUOTE_DELETE', entityType: 'quote', entityId: quoteId, payload: { id: quoteId } },
    );
  },

  // ---- status transitions -------------------------------------------------

  /**
   * `POST /quotes/:id/accept`.
   *
   * The `create_project` half is NOT done here, and the omission is deliberate
   * rather than a gap: `projects` is a B3 table and is not on `HouseLedger` yet,
   * so there is nowhere to put the row. The response type already makes
   * `project` optional — the Worker omits it whenever the caller does not ask —
   * so a local-first household gets the same shape it would get from
   * `accept(id)` with the flag off. B3 fills it in.
   */
  accept: async (householdId: string, quoteId: string, _createProject?: boolean) => {
    const existing = requireQuote(householdId, quoteId);
    if (existing.status !== 'received' && existing.status !== 'reviewing') {
      throw new LocalQuoteStateError('Can only accept received or reviewing quotes');
    }
    if (isExpired(existing.valid_until)) {
      throw new LocalQuoteStateError('Cannot accept an expired quote');
    }
    const timestamp = nowIso();
    await applyUpdate(
      householdId,
      quoteId,
      { status: 'accepted', accepted_at: timestamp },
      { opType: 'QUOTE_ACCEPT', payload: { id: quoteId, accepted_at: timestamp } },
    );
    return localQuotesApi.getOne(householdId, quoteId);
  },

  decline: async (householdId: string, quoteId: string, reason?: string) => {
    const existing = requireQuote(householdId, quoteId);
    if (existing.status === 'accepted' || existing.status === 'declined') {
      throw new LocalQuoteStateError('Quote has already been accepted or declined');
    }
    const timestamp = nowIso();
    // The reason is APPENDED to the notes, the server's shape. `notes` is one
    // text column under per-field LWW, so two members declining offline resolve
    // to one body — appending at least keeps that body a superset of what its
    // author saw.
    const notes = reason ? `${existing.notes || ''}\nDeclined: ${reason}`.trim() : existing.notes;
    await applyUpdate(
      householdId,
      quoteId,
      { status: 'declined', declined_at: timestamp, notes: notes || null },
      { opType: 'QUOTE_DECLINE', payload: { id: quoteId, declined_at: timestamp } },
    );
    return localQuotesApi.getOne(householdId, quoteId);
  },

  /**
   * `POST /quotes/:id/mark-received` — the member typing in what the contractor
   * quoted them over the phone. Exactly the write that has to survive a basement
   * with no signal.
   */
  markReceived: async (
    householdId: string,
    quoteId: string,
    data: MarkLocalQuoteReceivedInput,
  ) => {
    const existing = requireQuote(householdId, quoteId);
    if (existing.status !== 'requested') {
      throw new LocalQuoteStateError('Can only mark requested quotes as received');
    }
    // Routed through `updatePatch` so the absent/empty semantics match `update` —
    // the Worker reaches `markQuoteReceived` by calling `updateQuote` too.
    await applyUpdate(
      householdId,
      quoteId,
      updatePatch({ ...data, status: 'received' }),
      { opType: 'QUOTE_MARK_RECEIVED', payload: { id: quoteId, ...data } },
    );
    return localQuotesApi.getOne(householdId, quoteId);
  },

  /**
   * H6 — the encrypted blob channel (plan §8) owns file transfer for a
   * local-first household. This one is different in shape from every other gap
   * in the tree: the remote method is SYNCHRONOUS (it string-builds a URL), so
   * the Proxy's rejected-promise convention does not apply and the throw
   * happens at the call site. `QuoteDetailScreen` calls it inside the handler
   * that opens the viewer, so the copy lands where the member tapped.
   */
  getDocumentUrl: (_householdId: string, _quoteId: string): string => {
    throw new HouseLocalUnsupportedError('quotesApi.getDocumentUrl');
  },
};
