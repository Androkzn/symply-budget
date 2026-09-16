/**
 * Local `contractors` + `representatives` — the ledger counterpart of
 * `src/api/contractors.ts` and `src/api/representatives.ts` (plan §11, sub-wave
 * B1). This is the first sub-wave of the labor hub and the template the rest of
 * Wave B copies, so the decisions are spelled out rather than implied.
 *
 * **Why both remote modules land in one file.** `contractor_representatives` has
 * no `household_id` column at all — it is reached only through its contractor —
 * so every guard a representative needs ("does this contractor belong to the
 * active property?") is the guard the contractor methods already run. Splitting
 * them would duplicate `requireContractor` and give the duplicate a second
 * chance to drift. The two api objects stay separate exports because the two
 * remote modules do, and `apiParity.test.ts` diffs them separately.
 *
 * **Four of the 23 contractor methods are present as throws.** Two are the
 * direct-to-R2 transfer (`getUploadUrl`, `uploadDocument`) and one is the
 * grounded web search behind "look this company up for me" (`aiLookup`). The
 * coverage rule (plan §6) is explicit that a gap must be a thrown error with
 * member-facing copy and never a missing key: a missing key routes to the
 * Worker, which for a local-first household answers with a 200 and an empty
 * list, and the member concludes their paperwork is gone.
 *
 * Note what is NOT a gap. The document ROW is ledgered — `contractorDocuments`
 * is a B1 table — so listing, creating and deleting document records all work
 * offline. Only moving the bytes needs the encrypted blob channel. Splitting the
 * metadata from the transfer is the whole reason the table was worth ledgering.
 *
 * **Stats are recomputed, never stored.** `ContractorWithStats` and
 * `ContractorDetail` add `totalVisits`, `totalSpent`, `lastVisitDate`,
 * `recentVisits`, `documentCount` and `specialtyInfo`, all of which
 * `contractor-service.ts` composes per request by reading the visit and document
 * tables. Storing them would give one fact two homes in the ledger and let
 * per-field LWW converge them to different answers (`types.ts`, derived-collection
 * rule), so `withStats()` rebuilds them on read — the same shape
 * `localSpacesApi.withStats` uses for `task_count`.
 *
 * **Money.** `contractor_visits.cost` is an `integer` column in D1 but nothing on
 * this path divides by 100 — `mapVisitToResponse` does not exist, the row IS the
 * DTO — so dollars are stored and dollars come back. The one accumulation
 * (`totalSpent`) still converts to cents first, because float addition of
 * dollars drifts and `appliance-service.ts:387` records paying for that once.
 * That is safe against the Worker's own float sum: both read the same rows, and
 * the cents round-trip only removes error the server still carries.
 *
 * **No bulk path.** Every write here is one row (plus its cascade), so
 * `writeLocalBulk` is deliberately unused. When B2 adds "request quotes from
 * five contractors" it will need it — the rule is one op per chunk, never one op
 * per row, because `mutateLocalHouseLedger` diffs the WHOLE ledger per call.
 */
// Side-effect BEFORE @symply/local-first — @noble captures globalThis.crypto at
// module load, and this module is a Proxy entry point, so it can be the first
// House module a screen pulls into the graph.
import './cryptoPolyfill';

// `LocalContractor` IS `Contractor` and `LocalContractorRepresentative` is that
// DTO plus `household_id`, so the read methods return ledger rows directly and
// only the COMPOSED shapes (`ContractorDetail`, `ContractorWithStats`, the
// visit/contractor join) need naming here.
import {
  SPECIALTY_INFO,
  type ContractorDetail,
  type ContractorSpecialty,
  type ContractorVisitWithContractor,
  type ContractorWithStats,
  type DocumentType,
  type VisitStatus,
} from '@api/contractors';

import { getLocalHouseMemberId } from './engine';
import { HouseLocalUnknownPropertyError, HouseLocalUnsupportedError } from './errors';
import { newLocalId } from './ids';
import { activeHouseholdId, nowIso, rowsOf, writeLocal } from './localWrite';
import type { HouseLedgerTableName } from './schema';
import type {
  LocalContractor,
  LocalContractorDocument,
  LocalContractorRepresentative,
  LocalContractorVisit,
  LocalTask,
} from './types';

// ---------------------------------------------------------------------------
// Input shapes — mirrors of the module-private request types in the two remote
// api modules. They are not exported there, so they are restated rather than
// imported; `apiParity.test.ts` catches a method that disappears, and `tsc`
// catches a field whose type changed on the DTO.
// ---------------------------------------------------------------------------

export type CreateLocalContractorInput = {
  name: string;
  company_name?: string;
  specialty: ContractorSpecialty;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  notes?: string;
  rating?: number;
  is_favorite?: boolean;
};

export type UpdateLocalContractorInput = Partial<CreateLocalContractorInput>;

export type LocalContractorFilters = {
  specialty?: ContractorSpecialty;
  is_favorite?: boolean;
  search?: string;
};

export type CreateLocalVisitInput = {
  visit_date: string;
  description?: string;
  cost?: number;
  status: VisitStatus;
  notes?: string;
  rating?: number;
  linked_task_id?: string;
  linked_budget_item_id?: string;
};

export type UpdateLocalVisitInput = Partial<CreateLocalVisitInput> & {
  receipt_received?: boolean;
};

export type LocalVisitFilters = {
  contractor_id?: string;
  status?: VisitStatus;
  start_date?: string;
  end_date?: string;
};

export type RequestLocalReceiptInput = {
  method: 'email' | 'sms';
  contractor_email?: string;
  contractor_phone?: string;
  property_address: string;
  custom_message?: string;
};

export type CreateLocalDocumentInput = {
  contractor_id: string;
  visit_id?: string;
  type: DocumentType;
  title: string;
  file_key: string;
  file_name: string;
  file_size?: number;
  mime_type?: string;
  amount?: number;
  document_date?: string;
  notes?: string;
};

export type LocalDocumentFilters = {
  contractor_id?: string;
  visit_id?: string;
  type?: DocumentType;
};

export type StartLocalVisitModeInput = {
  contractor_rep_name?: string;
  start_time?: string;
};

export type CompleteLocalVisitInput = {
  rating?: number;
  notes?: string;
  completed_at?: string;
  voice_recording_key?: string;
  voice_recording_transcription?: string;
  voice_recording_duration_seconds?: number;
};

export type CreateLocalRepresentativeInput = {
  name: string;
  role?: string;
  phone?: string;
  email?: string;
  is_primary?: boolean;
  notes?: string;
  photo_url?: string;
};

export type UpdateLocalRepresentativeInput = Partial<CreateLocalRepresentativeInput>;

/**
 * `startVisitMode` writes a status the DTO's own union does not contain.
 * `VISIT_STATUSES` is `scheduled | completed | cancelled`, but
 * `routes/contractors.ts:818` sets `'in_progress'` when the member opens visit
 * mode on site, and D1's `status` is free text so it lands.
 *
 * The cast records the divergence at the single place it happens rather than
 * widening `VisitStatus` — widening it would make every `switch` over the union
 * silently non-exhaustive, and nothing in the app renders `in_progress` today
 * (a sweep of the visit and contractor screens found no reader). Fix by adding
 * the member to the union on BOTH sides at once, not by relaxing this.
 */
const VISIT_MODE_STATUS = 'in_progress' as VisitStatus;

/**
 * Ledger tables D1 cascades when a contractor row is deleted.
 *
 * Kept as a named list rather than inline filters because the set GROWS with
 * every H11 sub-wave, and a missed entry is invisible: an orphan is only
 * noticed by a reader that looks up its parent, and there is no foreign key in
 * a ledger to complain. B2 is the worked example — it activated four tables
 * that all cascade from `contractors`, and until this list existed the delete
 * silently left every one of them behind, forever, on every peer.
 *
 * Asserted against the Drizzle schema by `localContractorsApi.test.ts`, so
 * adding a cascading table to D1 without adding it here fails a unit test
 * rather than quietly leaking rows.
 */
export const CONTRACTOR_CASCADE_TABLES = [
  // B1 — schema-contractors.ts / schema-labor-hub.ts
  'contractorVisits',
  'contractorDocuments',
  'contractorRepresentatives',
  // B2 — activated 2026-08-14
  'appointments',
  'quotes',
  'contractorQuotes',
  'quoteRequests',
  // B3 — `projects.contractor_id` references `contractors.id` with
  // `onDelete: 'cascade'` (schema-labor-hub.ts:191).
  'projects',
  // B4 — three more, and the sub-wave that made this list stop growing:
  // `contractor_messages` (schema-labor-hub.ts:467),
  // `contractor_job_ratings` (:530) and `contractor_issue_resolutions` (:570)
  // all reference `contractors.id` with `onDelete: 'cascade'`.
  //
  // The last two are the ones a reviewer would have missed by reading the
  // facades: `contractorIssueResolutions` has NO client api module and no
  // backend router either, so nothing in `src/` reads or writes it — and that
  // is exactly why it had to be ledgered. An unregistered table cannot be
  // cascaded, so rows a server-side backfill left behind would have outlived
  // every contractor they belong to, on every device, forever.
  //
  // Thirteen physical tables cascade from `contractors` in D1. As of the H13
  // D-wave only ONE is missing from this list — `contractor_shares`, a
  // server-minted public link that is never ledgered. `contractor_recommendations`
  // used to be the other, on Tier-D grounds; it is ledgered now and therefore
  // cascades, which matters more here than anywhere else in the D-wave: a
  // recommendation carries the contractor's name and phone number inline in its
  // `external_*` columns, so an orphan is not just a dangling row but retained
  // contact data for a contractor the member deliberately removed.
  //
  // The guard test derives the same set from the Drizzle sources and filters to
  // the LIVE registry, so the remaining exclusion drops out by construction
  // rather than by being remembered here.
  'contractorMessages',
  'contractorJobRatings',
  'contractorIssueResolutions',
  'contractorRecommendations',
] as const satisfies readonly HouseLedgerTableName[];

/**
 * The TRANSITIVE half of the contractor cascade — opened in B3, widened in B4.
 *
 * D1 does not stop at one hop. It cascades `projects` from `contractors`, and
 * then cascades `project_milestones`, `project_payments` and
 * `project_progress_photos` from `projects`, so deleting a contractor removes
 * all four server-side. `CONTRACTOR_CASCADE_TABLES` above cannot express that:
 * it filters on `contractor_id`, and the three grandchildren are project-scoped
 * and have no such column.
 *
 * B3 identified this and pinned it as a known gap, correctly judging it
 * unreachable-rather-than-wrong: every `localProjectsApi` read resolves children
 * through their project, so no screen can render an orphan and no aggregate can
 * count it. The cost was ledger bytes replicated to every peer forever — which
 * is the same cost the direct cascade bug carried, and worth removing for the
 * same reason.
 *
 * **B4 added the second chain, and it is a stronger case than B3's.**
 * `contractorVisits` has been live since B1 and is itself a cascade parent:
 * `contractor_job_ratings.visit_id` and `visit_notes.visit_id` both reference it
 * with `onDelete: 'cascade'`. So deleting a contractor removes its visits, and
 * the server removes those visits' ratings and notes with them.
 *
 * `contractorJobRatings` would have gone anyway — it ALSO carries
 * `contractor_id` and so pass 1 already drops it — and it is listed here
 * regardless, because this list is a statement about the SCHEMA rather than a
 * minimal work list, and a reader checking it against `schema-labor-hub.ts`
 * should find both children of `contractorVisits` present. `visitNotes` is the
 * one that is genuinely reachable only this way: it has no `contractor_id`
 * column at all, so without this entry a contractor delete would strand every
 * note taken on every one of its visits.
 *
 * Kept separate from the direct list on purpose: the guard test derives
 * `CONTRACTOR_CASCADE_TABLES` from *direct* foreign keys, and folding the
 * grandchildren into it would make that assertion lie about the schema.
 */
const CONTRACTOR_TRANSITIVE_CASCADES = [
  {
    /** A directly-cascaded table that is itself a cascade parent. */
    parent: 'projects',
    /** The column its children point back with. */
    fk: 'project_id',
    children: ['projectMilestones', 'projectPayments', 'projectProgressPhotos'],
  },
  {
    // B4. `contractorVisits` is in the direct list above (it carries
    // `contractor_id`), which is what makes its ids available to pass 2.
    parent: 'contractorVisits',
    fk: 'visit_id',
    children: ['contractorJobRatings', 'visitNotes'],
  },
] as const satisfies readonly {
  parent: HouseLedgerTableName;
  fk: string;
  children: readonly HouseLedgerTableName[];
}[];

/**
 * Rows that point AT a visit with `onDelete: 'set null'` rather than a cascade —
 * the other half of `deleteVisit`, and the half that is easy to miss because
 * nothing disappears when it is wrong.
 *
 * Five live tables reference `contractor_visits.id` this way. The row survives
 * its visit; only the pointer is cleared. Getting it wrong does not strand a row
 * — it strands a REFERENCE, which is worse in one specific way: a reader that
 * follows it (`getAllDocuments` filtering by `visit_id`, a checklist screen
 * resolving its visit) finds a tombstone and renders a document filed against a
 * call-out that never happened.
 *
 * Two of these five are B2-era gaps this B4 audit turned up rather than B4's own
 * work: `appointments.linked_visit_id` and `contractorQuotes.visit_id` have been
 * `set null` in D1 and unhandled on device since those tables went live. The
 * cost was the same dangling pointer, on a table nobody had thought to check.
 *
 * Expressed as data for the same reason as the cascade list: the set grows with
 * the registry, and a missed entry is silent.
 */
const VISIT_SET_NULL_TABLES = [
  // B1 — the receipt outlives the appointment it was filed against.
  'contractorDocuments',
  // B2 — found during the B4 audit; see above.
  'appointments',
  'contractorQuotes',
  // B4 — a checklist can be reattached to another visit, and a resolution
  // records that an issue was fixed, which stays true if the visit is deleted.
  'visitChecklists',
  'contractorIssueResolutions',
] as const satisfies readonly HouseLedgerTableName[];

/**
 * The column each of those tables points back with.
 *
 * `appointments` is the odd one out — its column is `linked_visit_id`, not
 * `visit_id` — which is precisely why this is a lookup rather than a hard-coded
 * field name applied to every table in the list.
 */
const VISIT_SET_NULL_COLUMNS: Record<(typeof VISIT_SET_NULL_TABLES)[number], string> = {
  contractorDocuments: 'visit_id',
  appointments: 'linked_visit_id',
  contractorQuotes: 'visit_id',
  visitChecklists: 'visit_id',
  contractorIssueResolutions: 'visit_id',
};

/**
 * Reads and writes address the ACTIVE property — `engine.ts` holds one ledger
 * per property and `mutateLocalHouseLedger` writes to whichever is active (H5,
 * plan §7). Answering another property's id out of the active ledger would list
 * the cottage's roofer under the house, so the mismatch is raised, not absorbed.
 */
function requireActiveProperty(householdId: string): string {
  const active = activeHouseholdId();
  if (householdId !== active) throw new HouseLocalUnknownPropertyError(householdId);
  return active;
}

function contractorsOf(householdId: string): LocalContractor[] {
  requireActiveProperty(householdId);
  return rowsOf<LocalContractor>('contractors');
}

function visitsOf(householdId: string): LocalContractorVisit[] {
  requireActiveProperty(householdId);
  return rowsOf<LocalContractorVisit>('contractorVisits');
}

function documentsOf(householdId: string): LocalContractorDocument[] {
  requireActiveProperty(householdId);
  return rowsOf<LocalContractorDocument>('contractorDocuments');
}

function representativesOf(householdId: string): LocalContractorRepresentative[] {
  requireActiveProperty(householdId);
  return rowsOf<LocalContractorRepresentative>('contractorRepresentatives');
}

/**
 * Every write path and the detail read start by resolving the contractor, so a
 * request against a deleted one raises rather than returning an empty list —
 * `contractor-service.ts` throws `NotFoundError('Contractor not found')` at the
 * same points. An empty history and a missing contractor must not look alike.
 */
function requireContractor(householdId: string, contractorId: string): LocalContractor {
  const contractor = contractorsOf(householdId).find((row) => row.id === contractorId);
  if (!contractor) throw new Error('Contractor not found');
  return contractor;
}

function requireVisit(householdId: string, visitId: string): LocalContractorVisit {
  const visit = visitsOf(householdId).find((row) => row.id === visitId);
  if (!visit) throw new Error('Visit not found');
  return visit;
}

/** Server order: `visit_date` desc (`getVisits`, `getContractor`). */
function byVisitDateDesc(a: LocalContractorVisit, b: LocalContractorVisit): number {
  return b.visit_date.localeCompare(a.visit_date);
}

/** Server order: `created_at` desc (`getDocuments`). */
function byCreatedAtDesc(a: LocalContractorDocument, b: LocalContractorDocument): number {
  return b.created_at.localeCompare(a.created_at);
}

/** Server order: `name` asc (`getContractors`). */
function byName(a: LocalContractor, b: LocalContractor): number {
  return a.name.localeCompare(b.name);
}

/**
 * One pass over `contractor_visits`, not one scan per contractor.
 *
 * `contractor-service.ts:getContractors` runs a SELECT per contractor inside a
 * `Promise.all` (N+1). A query planner absorbs that; a Hermes loop over ten
 * years of call-outs does not, and the labor hub dashboard renders this list on
 * first paint.
 */
function visitsByContractor(householdId: string): Map<string, LocalContractorVisit[]> {
  const grouped = new Map<string, LocalContractorVisit[]>();
  for (const visit of visitsOf(householdId)) {
    const list = grouped.get(visit.contractor_id);
    if (list) list.push(visit);
    else grouped.set(visit.contractor_id, [visit]);
  }
  for (const list of grouped.values()) list.sort(byVisitDateDesc);
  return grouped;
}

/** The client's map, not the Worker's — it carries 27 specialties to the Worker's 12. */
function specialtyInfoFor(specialty: string): ContractorWithStats['specialtyInfo'] {
  return SPECIALTY_INFO[specialty as ContractorSpecialty] ?? SPECIALTY_INFO.other;
}

/** Dollars in, dollars out — the intermediate sum is cents so it cannot drift. */
function sumCosts(visits: readonly LocalContractorVisit[]): number {
  const cents = visits.reduce((total, visit) => total + Math.round((visit.cost ?? 0) * 100), 0);
  return cents / 100;
}

/**
 * `totalVisits` / `totalSpent` / `lastVisitDate` / `specialtyInfo` are not
 * columns — the server composes them per request. Recomputed here for the same
 * reason `localSpacesApi` recomputes `task_count`: one fact, one home.
 *
 * The two counts deliberately disagree about which visits they see, and they
 * disagree on the Worker too: `totalVisits` and `lastVisitDate` look at
 * COMPLETED visits only, while `totalSpent` sums every visit including scheduled
 * ones. A member who has booked next month's furnace service sees the cost in
 * the total before the technician arrives.
 */
function withStats(
  contractor: LocalContractor,
  visits: readonly LocalContractorVisit[],
): ContractorWithStats {
  const completed = visits.filter((visit) => visit.status === 'completed');
  return {
    ...contractor,
    totalVisits: completed.length,
    totalSpent: sumCosts(visits),
    // `visits` arrives newest-first, so the head of `completed` is the last
    // call-out that actually happened.
    lastVisitDate: completed[0]?.visit_date ?? null,
    specialtyInfo: specialtyInfoFor(contractor.specialty),
  };
}

/**
 * `getVisits` returns the visit joined to its contractor, and asserts the join
 * non-null (`contractor: contractor!`). On device the join cannot dangle —
 * deleting a contractor cascades its visits in the same op — so a visit with no
 * contractor means the ledger is already inconsistent, and emitting it with an
 * `undefined` contractor would crash the row renderer instead of the sync. It is
 * dropped, which is the same thing the member sees either way.
 */
function withContractor(
  visits: readonly LocalContractorVisit[],
  byId: Map<string, LocalContractor>,
): ContractorVisitWithContractor[] {
  const out: ContractorVisitWithContractor[] = [];
  for (const visit of visits) {
    const contractor = byId.get(visit.contractor_id);
    if (contractor) out.push({ ...visit, contractor });
  }
  return out;
}

function contractorsById(householdId: string): Map<string, LocalContractor> {
  return new Map(contractorsOf(householdId).map((row) => [row.id, row]));
}

/**
 * Ported verbatim from `contractor-service.ts:generateReceiptRequestMessage`.
 *
 * The member never actually reads this on device: `ReceiptRequestModal` composes
 * its own text and hands it to the mail or SMS app, then calls `requestReceipt`
 * only to record that it asked. The string is reproduced so the response shape
 * is the same one the Worker returns, and so a household that later reads this
 * visit through the server sees no discontinuity.
 */
function receiptRequestMessage(
  contractorName: string,
  visitDate: string,
  propertyAddress: string,
  workDescription: string,
): string {
  return `Hello ${contractorName},

I hope this message finds you well. I am writing to kindly request a receipt for the work completed at my property.

Visit Details:
- Date: ${visitDate}
- Property Address: ${propertyAddress}
- Work Performed: ${workDescription}

Having a receipt would be greatly appreciated for my records. If you could please send it at your earliest convenience, that would be wonderful.

Thank you for your excellent service!

Best regards`;
}

export const localContractorsApi = {
  // ---- contractors --------------------------------------------------------

  /**
   * `GET /contractors` — `ContractorService.getContractors`.
   *
   * The server sorts in SQL and filters in JS afterwards, so the order is by
   * name regardless of the filter; mirrored by filtering first and sorting after,
   * which is the same list.
   */
  getAll: async (householdId: string, filters?: LocalContractorFilters) => {
    const grouped = visitsByContractor(householdId);
    const search = filters?.search?.toLowerCase();
    const contractors = contractorsOf(householdId)
      .filter((row) => (filters?.specialty ? row.specialty === filters.specialty : true))
      .filter((row) =>
        filters?.is_favorite !== undefined ? row.is_favorite === filters.is_favorite : true,
      )
      .filter((row) =>
        search
          ? row.name.toLowerCase().includes(search) ||
            (row.company_name?.toLowerCase().includes(search) ?? false)
          : true,
      )
      .sort(byName)
      .map((row) => withStats(row, grouped.get(row.id) ?? []));
    return { contractors };
  },

  /** `GET /contractors/:id` — the detail view, which adds the last five visits. */
  getOne: async (householdId: string, contractorId: string) => {
    const found = requireContractor(householdId, contractorId);
    const visits = visitsOf(householdId)
      .filter((row) => row.contractor_id === contractorId)
      .sort(byVisitDateDesc);
    const documentCount = documentsOf(householdId).filter(
      (row) => row.contractor_id === contractorId,
    ).length;

    const contractor: ContractorDetail = {
      ...withStats(found, visits),
      recentVisits: visits.slice(0, 5),
      documentCount,
    };
    return { contractor };
  },

  create: async (householdId: string, data: CreateLocalContractorInput) => {
    requireActiveProperty(householdId);
    const timestamp = nowIso();
    // Random id, not deterministic: two members adding the same plumber offline
    // is not the S3b case. D1 puts no uniqueness on `(household_id, name)`, and
    // two "Dave" entries are two people until someone says otherwise.
    const contractor: LocalContractor = {
      id: newLocalId('ctr'),
      household_id: householdId,
      name: data.name,
      // The DTO models "not set" as NULL, matching the column; the Worker's
      // `input.companyName || null` does the same coalesce.
      company_name: data.company_name || null,
      specialty: data.specialty,
      phone: data.phone || null,
      email: data.email || null,
      website: data.website || null,
      address: data.address || null,
      notes: data.notes || null,
      rating: data.rating ?? null,
      is_favorite: data.is_favorite ?? false,
      created_at: timestamp,
      updated_at: timestamp,
    };
    await writeLocal(
      (draft) => {
        draft.contractors.push(contractor);
      },
      {
        opType: 'CONTRACTOR_CREATE',
        entityType: 'contractor',
        entityId: contractor.id,
        payload: contractor,
      },
    );
    return { contractor };
  },

  update: async (
    householdId: string,
    contractorId: string,
    data: UpdateLocalContractorInput,
  ) => {
    requireActiveProperty(householdId);
    let updated: LocalContractor | undefined;
    await writeLocal(
      (draft) => {
        const contractor = draft.contractors.find(
          (row) => row.id === contractorId && row.household_id === householdId,
        );
        if (!contractor) throw new Error('Contractor not found');
        // `updateContractor` treats an absent key as "leave it alone"; an empty
        // string clears the column, and the DTO's cleared state is NULL.
        if (data.name !== undefined) contractor.name = data.name;
        if (data.company_name !== undefined) contractor.company_name = data.company_name || null;
        if (data.specialty !== undefined) contractor.specialty = data.specialty;
        if (data.phone !== undefined) contractor.phone = data.phone || null;
        if (data.email !== undefined) contractor.email = data.email || null;
        if (data.website !== undefined) contractor.website = data.website || null;
        if (data.address !== undefined) contractor.address = data.address || null;
        if (data.notes !== undefined) contractor.notes = data.notes || null;
        if (data.rating !== undefined) contractor.rating = data.rating ?? null;
        if (data.is_favorite !== undefined) contractor.is_favorite = data.is_favorite;
        contractor.updated_at = nowIso();
        updated = contractor;
      },
      {
        opType: 'CONTRACTOR_UPDATE',
        entityType: 'contractor',
        entityId: contractorId,
        payload: data,
      },
    );
    return { contractor: updated! };
  },

  /**
   * Every child of the contractor goes with it, in ONE op.
   *
   * D1 declares `onDelete: 'cascade'` on all eleven, and a ledger delete is a
   * tombstone rather than a foreign key — orphaned children would sit in the
   * ledger forever, syncing to every peer and never being read again. Splitting
   * the cascade across ops would additionally let a peer receive the contractor
   * delete and still hold its visits, which renders as a call-out from nobody.
   *
   * **The list grows with each sub-wave, and forgetting to grow it is silent.**
   * B1 shipped this covering the three tables that were live then. B2 activated
   * `appointments`, `quotes`, `contractorQuotes` and `quoteRequests`, all four
   * of which D1 also cascades from `contractors` — so for one sub-wave a
   * contractor delete left four kinds of orphan behind, and nothing failed,
   * because an orphan is only visible to a reader that goes looking for its
   * parent. `CONTRACTOR_CASCADE_TABLES` below exists so the next sub-wave adds
   * a name to a list instead of remembering a filter, and so the guard test can
   * assert the list against the D1 schema rather than against itself.
   *
   * FK sources, all `onDelete: 'cascade'` on `contractors.id`:
   *   schema-labor-hub.ts    — appointments, quotes, contractorRepresentatives,
   *                            projects, contractorMessages,
   *                            contractorJobRatings, contractorIssueResolutions
   *   schema-contractors.ts  — contractorVisits, contractorDocuments,
   *                            contractorQuotes, quoteRequests
   *
   * See `CONTRACTOR_TRANSITIVE_CASCADES` for the two second-hop chains pass 2
   * below covers: `projects` → its milestones/payments/photos, and
   * `contractorVisits` → its ratings/notes.
   */
  delete: async (householdId: string, contractorId: string) => {
    requireActiveProperty(householdId);
    await writeLocal(
      (draft) => {
        const exists = draft.contractors.some(
          (row) => row.id === contractorId && row.household_id === householdId,
        );
        if (!exists) throw new Error('Contractor not found');
        draft.contractors = draft.contractors.filter((row) => row.id !== contractorId);

        // Pass 1 — the direct cascade. The ids of the rows being dropped are
        // captured on the way past, because pass 2 needs them and they are
        // gone afterwards.
        const doomed = new Map<string, Set<string>>();
        for (const table of CONTRACTOR_CASCADE_TABLES) {
          // Every one of these rows carries `contractor_id`; the cast is the
          // narrowest way to say so without widening the ledger's row types.
          const rows = draft[table] as unknown as { id: string; contractor_id: string | null }[];
          doomed.set(
            table,
            new Set(rows.filter((row) => row.contractor_id === contractorId).map((row) => row.id)),
          );
          (draft[table] as unknown) = rows.filter(
            (row) => row.contractor_id !== contractorId,
          );
        }

        // Pass 2 — the transitive cascade, in the SAME op. A peer that received
        // pass 1 without pass 2 would hold milestones belonging to a project it
        // no longer has, which is the orphan this whole mechanism exists to
        // prevent.
        for (const { parent, fk, children } of CONTRACTOR_TRANSITIVE_CASCADES) {
          const parentIds = doomed.get(parent);
          if (!parentIds || parentIds.size === 0) continue;
          for (const child of children) {
            const rows = draft[child] as unknown as Record<string, unknown>[];
            (draft[child] as unknown) = rows.filter(
              (row) => !parentIds.has(row[fk] as string),
            );
          }
        }
      },
      {
        opType: 'CONTRACTOR_DELETE',
        entityType: 'contractor',
        entityId: contractorId,
        payload: { id: contractorId },
      },
    );
  },

  /** The remote method is a `PATCH` with one field, so this is `update` narrowed. */
  toggleFavorite: async (householdId: string, contractorId: string, isFavorite: boolean) =>
    localContractorsApi.update(householdId, contractorId, { is_favorite: isFavorite }),

  // ---- visits -------------------------------------------------------------

  getAllVisits: async (householdId: string, filters?: LocalVisitFilters) => {
    const byId = contractorsById(householdId);
    const visits = visitsOf(householdId)
      .filter((row) => (filters?.contractor_id ? row.contractor_id === filters.contractor_id : true))
      .filter((row) => (filters?.status ? row.status === filters.status : true))
      // Date bounds are inclusive string comparisons, exactly as the Worker
      // does them — `visit_date` is a `text` column and both stored forms
      // (`YYYY-MM-DD` from the picker, full ISO from visit mode) sort lexically.
      .filter((row) => (filters?.start_date ? row.visit_date >= filters.start_date : true))
      .filter((row) => (filters?.end_date ? row.visit_date <= filters.end_date : true))
      .sort(byVisitDateDesc);
    return { visits: withContractor(visits, byId) };
  },

  /**
   * The Worker does NOT check that the contractor exists here — the route just
   * filters — so an unknown id yields an empty list rather than a 404. Mirrored,
   * because `ContractorDetailScreen` loads this in parallel with `getOne`, and
   * `getOne` is the call that raises.
   */
  getContractorVisits: async (householdId: string, contractorId: string) => {
    const byId = contractorsById(householdId);
    const visits = visitsOf(householdId)
      .filter((row) => row.contractor_id === contractorId)
      .sort(byVisitDateDesc);
    return { visits: withContractor(visits, byId) };
  },

  createVisit: async (
    householdId: string,
    contractorId: string,
    data: CreateLocalVisitInput,
  ) => {
    requireContractor(householdId, contractorId);
    const timestamp = nowIso();
    const visit: LocalContractorVisit = {
      id: newLocalId('cvi'),
      contractor_id: contractorId,
      household_id: householdId,
      visit_date: data.visit_date,
      description: data.description || null,
      cost: data.cost ?? null,
      status: data.status,
      notes: data.notes || null,
      rating: data.rating ?? null,
      linked_task_id: data.linked_task_id || null,
      linked_budget_item_id: data.linked_budget_item_id || null,
      receipt_received: false,
      receipt_reminder_task_id: null,
      receipt_requested_at: null,
      visit_mode_started_at: null,
      visit_mode_ended_at: null,
      contractor_rep_name: null,
      task_id: null,
      // The voice-recording quartet is written only by visit mode, and its key
      // points into the encrypted blob channel rather than into R2.
      voice_recording_key: null,
      voice_recording_transcription: null,
      voice_recording_duration_seconds: null,
      voice_recording_analysis: null,
      created_at: timestamp,
      updated_at: timestamp,
    };
    await writeLocal(
      (draft) => {
        draft.contractorVisits.push(visit);
      },
      { opType: 'VISIT_CREATE', entityType: 'contractor_visit', entityId: visit.id, payload: visit },
    );
    return { visit };
  },

  updateVisit: async (householdId: string, visitId: string, data: UpdateLocalVisitInput) => {
    requireActiveProperty(householdId);
    let updated: LocalContractorVisit | undefined;
    await writeLocal(
      (draft) => {
        const visit = draft.contractorVisits.find(
          (row) => row.id === visitId && row.household_id === householdId,
        );
        if (!visit) throw new Error('Visit not found');
        if (data.visit_date !== undefined) visit.visit_date = data.visit_date;
        if (data.description !== undefined) visit.description = data.description || null;
        if (data.cost !== undefined) visit.cost = data.cost ?? null;
        if (data.status !== undefined) visit.status = data.status;
        if (data.notes !== undefined) visit.notes = data.notes || null;
        if (data.rating !== undefined) visit.rating = data.rating ?? null;
        if (data.linked_task_id !== undefined) visit.linked_task_id = data.linked_task_id || null;
        if (data.linked_budget_item_id !== undefined) {
          visit.linked_budget_item_id = data.linked_budget_item_id || null;
        }
        if (data.receipt_received !== undefined) visit.receipt_received = data.receipt_received;
        visit.updated_at = nowIso();
        updated = visit;
      },
      { opType: 'VISIT_UPDATE', entityType: 'contractor_visit', entityId: visitId, payload: data },
    );
    return { visit: updated! };
  },

  /**
   * A visit and everything D1 removes with it — in ONE op, and **both kinds of
   * consequence**, because `contractor_visits` is referenced seven times across
   * the schema with two different `onDelete` behaviours.
   *
   * **Cascade (the row goes):** `contractor_job_ratings` and `visit_notes`. Both
   * are B4 tables, and until B4 neither existed on the ledger, so this method
   * was correct when it was written and became incomplete the moment the two
   * tables went live — which is the B2 cascade trap arriving one level down. A
   * rating left behind would keep counting toward the contractor's average for a
   * call-out that no longer exists; a note left behind is a voice memo attached
   * to nothing.
   *
   * **Set null (the row survives, the pointer is cleared):** the five tables in
   * `VISIT_SET_NULL_TABLES`. A receipt is the member's record of a payment and
   * outlives the appointment it was filed against; a checklist can be reattached
   * to another visit; a resolution records that an issue was fixed, which stays
   * true. Two of those five — `appointments.linked_visit_id` and
   * `contractorQuotes.visit_id` — were unhandled since B2 and are fixed here.
   *
   * **One op for all of it.** A peer that received the delete without the rest
   * would hold a rating for a visit it does not have and a document pointing at
   * a tombstone, which is the orphan the whole mechanism exists to prevent.
   *
   * The Worker issues an unconditional DELETE and answers 204 whether or not the
   * row existed, so this does not raise either. Diverging would make a
   * double-tap behave differently depending on which backend answered.
   */
  deleteVisit: async (householdId: string, visitId: string) => {
    requireActiveProperty(householdId);
    await writeLocal(
      (draft) => {
        draft.contractorVisits = draft.contractorVisits.filter(
          (row) => !(row.id === visitId && row.household_id === householdId),
        );

        // The cascades, driven off the same declaration the contractor delete
        // uses, so the two paths cannot disagree about what a visit owns.
        for (const { parent, fk, children } of CONTRACTOR_TRANSITIVE_CASCADES) {
          if (parent !== 'contractorVisits') continue;
          for (const child of children) {
            const rows = draft[child] as unknown as Record<string, unknown>[];
            (draft[child] as unknown) = rows.filter((row) => row[fk] !== visitId);
          }
        }

        // The set-nulls. `undefined` is left alone deliberately: a row written
        // by an older build may not carry the column at all, and writing an
        // explicit null into it would put a field in the delta that the row
        // never had.
        for (const table of VISIT_SET_NULL_TABLES) {
          const column = VISIT_SET_NULL_COLUMNS[table];
          for (const row of draft[table] as unknown as Record<string, unknown>[]) {
            if (row[column] === visitId) row[column] = null;
          }
        }
      },
      {
        opType: 'VISIT_DELETE',
        entityType: 'contractor_visit',
        entityId: visitId,
        payload: { id: visitId },
      },
    );
  },

  // ---- receipts -----------------------------------------------------------

  markReceiptReceived: async (householdId: string, visitId: string, received: boolean) =>
    localContractorsApi.updateVisit(householdId, visitId, { receipt_received: received }),

  /**
   * Local, not a throw — and that is worth stating, because "asking a contractor
   * for something" sounds like a server surface.
   *
   * It is not one. `ReceiptRequestModal` opens the device's own mail or SMS app
   * with a message it composed itself; the Worker never sends anything (see the
   * comment at `contractor-service.ts:692`). All `requestReceipt` does is stamp
   * `receipt_requested_at` so the visit card can show "asked on the 3rd", which
   * is a plain ledger write.
   */
  requestReceipt: async (
    householdId: string,
    visitId: string,
    data: RequestLocalReceiptInput,
  ) => {
    const visit = requireVisit(householdId, visitId);
    const contractor = requireContractor(householdId, visit.contractor_id);
    const timestamp = nowIso();

    await writeLocal(
      (draft) => {
        const row = draft.contractorVisits.find((candidate) => candidate.id === visitId);
        if (!row) throw new Error('Visit not found');
        row.receipt_requested_at = timestamp;
        row.updated_at = timestamp;
      },
      {
        opType: 'VISIT_RECEIPT_REQUESTED',
        entityType: 'contractor_visit',
        entityId: visitId,
        // The method is in the intent, the contact details are not: an op is
        // sealed but replicated, and the member's phone number does not need to
        // travel twice.
        payload: { id: visitId, method: data.method },
      },
    );

    const message =
      data.custom_message ||
      receiptRequestMessage(
        contractor.name,
        new Date(visit.visit_date).toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }),
        data.property_address,
        visit.description || 'service visit',
      );

    return {
      success: true,
      message: `Receipt request ${data.method === 'email' ? 'email' : 'message'} prepared. Message: ${message}`,
      receipt_requested_at: timestamp,
    };
  },

  /**
   * Also local: the Worker's version is a raw INSERT into `tasks`, which is a
   * Wave-A ledger table. Nothing about chasing a receipt needs a server, so
   * throwing here would have to tell the member a lie.
   *
   * The task and the visit's back-pointer move in ONE op. Two ops would let a
   * peer hold a reminder task whose visit does not know about it, and the
   * "already exists" guard below would then mint a second one.
   */
  createReceiptReminderTask: async (householdId: string, visitId: string) => {
    const visit = requireVisit(householdId, visitId);
    const contractor = requireContractor(householdId, visit.contractor_id);

    if (visit.receipt_reminder_task_id) {
      return {
        success: false,
        task_id: visit.receipt_reminder_task_id,
        message: 'A reminder task already exists for this visit',
      };
    }

    const timestamp = nowIso();
    const displayName = contractor.company_name || contractor.name;
    const visitDate = new Date(visit.visit_date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

    const task: LocalTask = {
      id: newLocalId('task'),
      household_id: householdId,
      title: `Request receipt from ${displayName}`,
      description: `Follow up on receipt for the visit on ${visitDate}. Work performed: ${visit.description || 'service visit'}`,
      system_category: 'other',
      frequency: 'daily',
      custom_interval_days: null,
      next_due_date: timestamp.split('T')[0]!,
      last_completed_at: null,
      assigned_to: null,
      space_id: null,
      is_active: true,
      // The Worker writes `source: 'system_generated'`, which is NOT a member of
      // the DTO's own union (`manual | ai_generated | template`) — its raw SQL
      // bypasses the type. A ledger row IS the DTO, so it cannot store a value
      // the union forbids, and `'manual'` is the truest of the three: a member
      // tapped "remind me". Widen the union on both sides if that ever matters.
      source: 'manual',
      priority_severity: 'nice_to_have',
      time_effort: null,
      risk_level: null,
      complexity: null,
      ai_rationale: null,
      enrichment_status: null,
      clarification_question: null,
      purchase_suggestion: null,
      blocked: false,
      blocker_reason: null,
      blocked_at: null,
      blocked_by: null,
      reminder_enabled: true,
      reminder_days_before: 0,
      reminder_time: '09:00',
      reminder_repeat: true,
      needs_contractor: false,
      is_personal: false,
      created_by: getLocalHouseMemberId(),
      created_at: timestamp,
      updated_at: timestamp,
      photos: [],
      cover_photo_id: null,
      cover_photo_url: null,
    };

    await writeLocal(
      (draft) => {
        draft.tasks.push(task);
        const row = draft.contractorVisits.find((candidate) => candidate.id === visitId);
        if (row) {
          row.receipt_reminder_task_id = task.id;
          row.updated_at = timestamp;
        }
      },
      {
        opType: 'VISIT_RECEIPT_REMINDER_TASK_CREATE',
        entityType: 'contractor_visit',
        entityId: visitId,
        payload: { id: visitId, task_id: task.id },
      },
    );

    return {
      success: true,
      task_id: task.id,
      message: `Daily reminder task created to request receipt from ${displayName}`,
    };
  },

  // ---- documents ----------------------------------------------------------

  getAllDocuments: async (householdId: string, filters?: LocalDocumentFilters) => {
    const documents = documentsOf(householdId)
      .filter((row) => (filters?.contractor_id ? row.contractor_id === filters.contractor_id : true))
      .filter((row) => (filters?.visit_id ? row.visit_id === filters.visit_id : true))
      .filter((row) => (filters?.type ? row.type === filters.type : true))
      .sort(byCreatedAtDesc);
    return { documents };
  },

  getContractorDocuments: async (householdId: string, contractorId: string) => {
    const documents = documentsOf(householdId)
      .filter((row) => row.contractor_id === contractorId)
      .sort(byCreatedAtDesc);
    return { documents };
  },

  /**
   * H6 — the encrypted blob channel (plan §8) owns file transfer for a
   * local-first household. These two are the DIRECT-to-R2 path: a presigned URL
   * into the Worker's bucket and a multipart POST through it. Present and
   * throwing rather than absent, so the Proxy cannot route them to a bucket that
   * holds nothing for this household and report success.
   */
  getUploadUrl: async (_householdId: string, _data: { file_name: string; content_type: string }) => {
    throw new HouseLocalUnsupportedError('contractorsApi.getUploadUrl');
  },

  uploadDocument: async (
    _householdId: string,
    _file: { uri: string; name: string; type: string },
  ) => {
    throw new HouseLocalUnsupportedError('contractorsApi.uploadDocument');
  },

  /**
   * The metadata row, which IS ledgered. It takes a `file_key` the caller has
   * already obtained — from H6 once the labor screens adopt it — so this method
   * is meaningful even while the two transfer methods above throw.
   */
  createDocument: async (householdId: string, data: CreateLocalDocumentInput) => {
    requireContractor(householdId, data.contractor_id);
    const document: LocalContractorDocument = {
      id: newLocalId('cdc'),
      contractor_id: data.contractor_id,
      visit_id: data.visit_id || null,
      household_id: householdId,
      type: data.type,
      title: data.title,
      file_key: data.file_key,
      file_name: data.file_name,
      file_size: data.file_size ?? null,
      mime_type: data.mime_type || null,
      amount: data.amount ?? null,
      document_date: data.document_date || null,
      notes: data.notes || null,
      // No `updated_at` column exists on this table — a document record is
      // written once and replaced, never edited.
      created_at: nowIso(),
    };
    await writeLocal(
      (draft) => {
        draft.contractorDocuments.push(document);
      },
      {
        opType: 'CONTRACTOR_DOCUMENT_CREATE',
        entityType: 'contractor_document',
        entityId: document.id,
        payload: document,
      },
    );
    return { document };
  },

  /**
   * Drops the record. The blob itself is deleted by whoever owns the key — on
   * the Worker that is `deleteDocumentFile`, on device it is H6 — and neither
   * can be done inside a ledger op, which must stay synchronous and pure.
   */
  deleteDocument: async (householdId: string, documentId: string) => {
    requireActiveProperty(householdId);
    await writeLocal(
      (draft) => {
        const exists = draft.contractorDocuments.some(
          (row) => row.id === documentId && row.household_id === householdId,
        );
        if (!exists) throw new Error('Document not found');
        draft.contractorDocuments = draft.contractorDocuments.filter(
          (row) => row.id !== documentId,
        );
      },
      {
        opType: 'CONTRACTOR_DOCUMENT_DELETE',
        entityType: 'contractor_document',
        entityId: documentId,
        payload: { id: documentId },
      },
    );
  },

  // ---- AI -----------------------------------------------------------------

  /**
   * P4 (plan §9). `ai-lookup` runs grounded web searches on the Worker and
   * writes the answer back into the form. There is no on-device equivalent and
   * no cached one, so it throws with copy that says what still works: typing the
   * company's details in by hand.
   */
  aiLookup: async (_householdId: string, _companyName: string) => {
    throw new HouseLocalUnsupportedError('contractorsApi.aiLookup');
  },

  // ---- visit mode ---------------------------------------------------------

  /**
   * The on-site surface, and the reason B1 matters offline at all: a basement
   * with no signal is the normal case for these two calls, not the edge case.
   */
  startVisitMode: async (
    householdId: string,
    visitId: string,
    data?: StartLocalVisitModeInput,
  ) => {
    requireActiveProperty(householdId);
    let updated: LocalContractorVisit | undefined;
    const timestamp = nowIso();
    await writeLocal(
      (draft) => {
        const visit = draft.contractorVisits.find(
          (row) => row.id === visitId && row.household_id === householdId,
        );
        if (!visit) throw new Error('Visit not found');
        visit.status = VISIT_MODE_STATUS;
        visit.visit_mode_started_at = data?.start_time || timestamp;
        // The route passes `contractor_rep_name` straight through, so an absent
        // key leaves the previous name rather than clearing it — the member may
        // be resuming a visit they started this morning.
        if (data?.contractor_rep_name !== undefined) {
          visit.contractor_rep_name = data.contractor_rep_name;
        }
        visit.updated_at = timestamp;
        updated = visit;
      },
      {
        opType: 'VISIT_MODE_START',
        entityType: 'contractor_visit',
        entityId: visitId,
        payload: { id: visitId, started_at: data?.start_time || timestamp },
      },
    );
    return { visit: updated! };
  },

  completeVisit: async (
    householdId: string,
    visitId: string,
    data?: CompleteLocalVisitInput,
  ) => {
    requireActiveProperty(householdId);
    let updated: LocalContractorVisit | undefined;
    const timestamp = nowIso();
    await writeLocal(
      (draft) => {
        const visit = draft.contractorVisits.find(
          (row) => row.id === visitId && row.household_id === householdId,
        );
        if (!visit) throw new Error('Visit not found');
        visit.status = 'completed';
        visit.visit_mode_ended_at = data?.completed_at || timestamp;
        if (data?.rating !== undefined) visit.rating = data.rating;
        if (data?.notes !== undefined) visit.notes = data.notes;
        if (data?.voice_recording_key !== undefined) {
          visit.voice_recording_key = data.voice_recording_key;
        }
        if (data?.voice_recording_transcription !== undefined) {
          visit.voice_recording_transcription = data.voice_recording_transcription;
        }
        if (data?.voice_recording_duration_seconds !== undefined) {
          visit.voice_recording_duration_seconds = data.voice_recording_duration_seconds;
        }
        visit.updated_at = timestamp;
        updated = visit;
      },
      {
        opType: 'VISIT_MODE_COMPLETE',
        entityType: 'contractor_visit',
        entityId: visitId,
        payload: { id: visitId, ended_at: data?.completed_at || timestamp },
      },
    );
    return { visit: updated! };
  },
};

// ---------------------------------------------------------------------------
// Representatives — `src/api/representatives.ts`, contractor-scoped throughout.
// ---------------------------------------------------------------------------

/**
 * Rows for one contractor, in the server's order: primary first, then by name.
 *
 * `RepresentativeService.getRepresentatives` sorts in JS rather than SQL, so
 * this is the same comparison and not an approximation of one.
 */
function representativesFor(
  householdId: string,
  contractorId: string,
): LocalContractorRepresentative[] {
  return representativesOf(householdId)
    .filter((row) => row.contractor_id === contractorId)
    .sort((a, b) => {
      if (a.is_primary && !b.is_primary) return -1;
      if (!a.is_primary && b.is_primary) return 1;
      return a.name.localeCompare(b.name);
    });
}

function requireRepresentative(
  householdId: string,
  contractorId: string,
  representativeId: string,
): LocalContractorRepresentative {
  const found = representativesFor(householdId, contractorId).find(
    (row) => row.id === representativeId,
  );
  if (!found) throw new Error('Representative not found');
  return found;
}

/**
 * "Primary" is at most one per contractor, and the ledger has no way to enforce
 * that — there is no unique index to lean on and no transaction spanning rows.
 * So every path that sets it clears the others in the SAME op, which is the only
 * moment at which the invariant is enforceable at all.
 *
 * Two members promoting different people offline still converge to two primaries
 * for one merge cycle; per-field LWW then resolves each `is_primary` flag
 * independently and the reader's sort simply puts one of them first. That is a
 * cosmetic disagreement, which is why this is not an S3b deterministic-id case:
 * the rows are genuinely different people.
 */
function clearOtherPrimaries(
  rows: LocalContractorRepresentative[],
  contractorId: string,
  keepId: string,
  timestamp: string,
): void {
  for (const row of rows) {
    if (row.contractor_id !== contractorId || row.id === keepId || !row.is_primary) continue;
    row.is_primary = false;
    row.updated_at = timestamp;
  }
}

export const localRepresentativesApi = {
  getAll: async (householdId: string, contractorId: string) => {
    requireContractor(householdId, contractorId);
    return { representatives: representativesFor(householdId, contractorId) };
  },

  getOne: async (householdId: string, contractorId: string, representativeId: string) => {
    requireContractor(householdId, contractorId);
    return { representative: requireRepresentative(householdId, contractorId, representativeId) };
  },

  /**
   * The first representative a contractor gets is primary whether or not the
   * member asked — `createRepresentative` decides that with
   * `input.isPrimary ?? existingReps.length === 0`, so a one-person shop always
   * has a contact to call.
   */
  create: async (
    householdId: string,
    contractorId: string,
    data: CreateLocalRepresentativeInput,
  ) => {
    requireContractor(householdId, contractorId);
    const existing = representativesFor(householdId, contractorId);
    const isPrimary = data.is_primary ?? existing.length === 0;
    const timestamp = nowIso();

    const representative: LocalContractorRepresentative = {
      id: newLocalId('crp'),
      // Not a D1 column — added by `types.ts` because a row in a flat op log
      // must carry its own property (H5). D1 reaches it through the contractor.
      household_id: householdId,
      contractor_id: contractorId,
      name: data.name,
      role: data.role || null,
      phone: data.phone || null,
      email: data.email || null,
      is_primary: isPrimary,
      notes: data.notes || null,
      photo_url: data.photo_url || null,
      created_at: timestamp,
      updated_at: timestamp,
    };

    await writeLocal(
      (draft) => {
        if (isPrimary) {
          clearOtherPrimaries(
            draft.contractorRepresentatives,
            contractorId,
            representative.id,
            timestamp,
          );
        }
        draft.contractorRepresentatives.push(representative);
      },
      {
        opType: 'CONTRACTOR_REPRESENTATIVE_CREATE',
        entityType: 'contractor_representative',
        entityId: representative.id,
        payload: representative,
      },
    );
    return { representative };
  },

  update: async (
    householdId: string,
    contractorId: string,
    representativeId: string,
    data: UpdateLocalRepresentativeInput,
  ) => {
    requireContractor(householdId, contractorId);
    let updated: LocalContractorRepresentative | undefined;
    const timestamp = nowIso();
    await writeLocal(
      (draft) => {
        const representative = draft.contractorRepresentatives.find(
          (row) => row.id === representativeId && row.contractor_id === contractorId,
        );
        if (!representative) throw new Error('Representative not found');
        if (data.is_primary && !representative.is_primary) {
          clearOtherPrimaries(
            draft.contractorRepresentatives,
            contractorId,
            representativeId,
            timestamp,
          );
        }
        if (data.name !== undefined) representative.name = data.name;
        if (data.role !== undefined) representative.role = data.role || null;
        if (data.phone !== undefined) representative.phone = data.phone || null;
        if (data.email !== undefined) representative.email = data.email || null;
        if (data.is_primary !== undefined) representative.is_primary = data.is_primary;
        if (data.notes !== undefined) representative.notes = data.notes || null;
        if (data.photo_url !== undefined) representative.photo_url = data.photo_url || null;
        representative.updated_at = timestamp;
        updated = representative;
      },
      {
        opType: 'CONTRACTOR_REPRESENTATIVE_UPDATE',
        entityType: 'contractor_representative',
        entityId: representativeId,
        payload: data,
      },
    );
    return { representative: updated! };
  },

  /**
   * Deleting the primary promotes someone, in the same op, exactly as
   * `deleteRepresentative` does — a contractor with three people and no primary
   * renders no "call" button at all.
   *
   * The Worker promotes `remainingReps[0]` off an unordered `.all()`; this
   * promotes the first in the reader's own order (primary-then-name, which after
   * the delete means alphabetically first). Deterministic beats incidental, and
   * every peer applying this op sees the same choice.
   */
  delete: async (householdId: string, contractorId: string, representativeId: string) => {
    requireContractor(householdId, contractorId);
    const existing = requireRepresentative(householdId, contractorId, representativeId);
    const timestamp = nowIso();

    await writeLocal(
      (draft) => {
        draft.contractorRepresentatives = draft.contractorRepresentatives.filter(
          (row) => row.id !== representativeId,
        );
        if (!existing.is_primary) return;
        const remaining = draft.contractorRepresentatives
          .filter((row) => row.contractor_id === contractorId)
          .sort((a, b) => a.name.localeCompare(b.name));
        const heir = remaining[0];
        if (heir) {
          heir.is_primary = true;
          heir.updated_at = timestamp;
        }
      },
      {
        opType: 'CONTRACTOR_REPRESENTATIVE_DELETE',
        entityType: 'contractor_representative',
        entityId: representativeId,
        payload: { id: representativeId },
      },
    );
  },

  /** `setPrimaryRepresentative` is `updateRepresentative({ isPrimary: true })`. */
  setPrimary: async (householdId: string, contractorId: string, representativeId: string) =>
    localRepresentativesApi.update(householdId, contractorId, representativeId, {
      is_primary: true,
    }),
};
