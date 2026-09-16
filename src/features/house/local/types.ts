/**
 * Ledger row shapes — Wave A live, Waves B and C staged (see the bottom half).
 *
 * The rule inherited from Budget: **a ledger row IS the DTO the remote API
 * returned**, so screens see no shape change when the facade swaps from HTTP to
 * the ledger. Two systematic adjustments are applied where the House API shape
 * cannot be stored as-is:
 *
 *  1. **Derived collections are stripped.** `Task.subtasks`, `Checklist.items`
 *     and `SeasonalChecklist.items/progress` are *views* the server composes by
 *     joining. Storing them would give the same fact two homes in the ledger and
 *     let LWW converge them to different answers.
 *  2. **The owning FK is added where the API only implied it.** A
 *     `MaintenanceCompletion` arrives nested under its task, so the DTO carries
 *     no `task_id`; a row in a flat op log must carry its own parentage, and
 *     `household_id` is what lets one device hold several properties (H5).
 */
import type { GardenPlanObject } from '@models/garden-objects';

import type { ApplianceDocument, Appliance, ServiceHistoryEntry } from '@api/appliances';
import type { Appointment } from '@api/appointments';
import type { ChecklistItem, ChecklistInstance, ChecklistItemCompletion } from '@api/checklists';
import type { Contractor, ContractorDocument, ContractorVisit } from '@api/contractors';
import type {
  FloorPlan,
  FloorPlanAnnotation,
  FloorPlanMarker,
  FloorPlanRegion,
} from '@api/floor-plans';
import type { GarbageSchedule } from '@api/garbage-collection';
import type {
  GardenPlan,
  GardenPlanBoundaryDraft,
  GardenPlanMarker,
} from '@api/garden-plans';
import type { HomeFeature } from '@api/home-features';
import type {
  HomeProject,
  HomeProjectAttachment,
  HomeProjectBlocker,
  HomeProjectBudgetLine,
  HomeProjectComment,
  HomeProjectPhase,
  HomeProjectPlanLink,
  HomeProjectSelection,
  HomeProjectOptionGroup,
  HomeProjectActivityItem,
  HomeProjectGeometry,
} from '@api/home-projects';
import type { HouseholdSpace } from '@api/household-spaces';
import type { Household, HouseholdMember } from '@api/households';
import type { MaintenanceSuggestion } from '@api/maintenance-suggestions';
import type { ContractorMessage } from '@api/messages';
import type { Neighbour, NeighbourPerson, Neighbourhood } from '@api/neighbours';
import type {
  Project,
  ProjectMilestone,
  ProjectPayment,
  ProjectProgressPhoto,
} from '@api/projects';
import type { Quote } from '@api/quotes';
import type { ContractorJobRating } from '@api/ratings';
import type { RecurringReminder } from '@api/recurringReminders';
import type { ContractorRepresentative } from '@api/representatives';
import type { Season, SeasonalChecklistItem } from '@api/seasonal-checklists';
import type { Setting } from '@api/settings';
import type { TaskDraft } from '@api/task-drafts';
import type {
  MaintenanceCompletion,
  MaintenanceSubtask,
  Task,
  TaskNote,
} from '@api/tasks';
import type {
  ChecklistItem as VisitChecklistItemDto,
  ChecklistItemPhoto,
  VisitChecklist,
} from '@api/visit-checklists';
import type {
  BCAssessmentData,
  PropertyTax,
  UtilityAccount,
  UtilityBill,
} from '@features/utilities/api/utilities';

/** Every ledger row is scoped to exactly one property. */
type Owned = { household_id: string };

/**
 * The property row itself. `lf_households` on the control plane stays
 * metadata-only by design (id, owner, display name, key epoch); the domain
 * fields — address, unit system, photo, purchase price/date — live HERE, in the
 * encrypted ledger (plan §1.5 hazard S5).
 */
export type LocalHousehold = Household;

/**
 * The `households` row as it is LEDGERED — property facts only.
 *
 * `my_role`, `member_count` and `photo_url` are per-VIEWER, not per-property:
 * the owner sees `my_role: 'owner'`, a member sees `'member'`, and both are
 * looking at the same home. Ledgering them means a peer's delta carries one
 * member's answer to every other member, and per-field LWW then applies it —
 * handing whoever synced last the other person's role, and with it the owner
 * controls. `photo_url` is a signed URL that expires, so syncing it propagates
 * a link that is already dead.
 *
 * Omitting them from the ledgered type makes that structurally impossible
 * rather than a rule someone has to remember: they cannot enter a delta because
 * they are not on the row. The device-local binding (`ledger.household`) keeps
 * the full `Household` shape, because screens read `currentHousehold.my_role`
 * and that answer is correct — for this device.
 *
 * Found during the H3 port; the binding and the row were previously the same
 * object, so a merge wrote through one into the other.
 */
export type LedgeredHousehold = Omit<Household, 'my_role' | 'member_count' | 'photo_url'>;

/** Strip the per-viewer fields when seeding or updating the ledgered row. */
export function toLedgeredHousehold(household: Household): LedgeredHousehold {
  // Explicit deletes rather than a rest-destructure: the discarded bindings
  // read as unused variables to the linter, and naming them `_role` only moves
  // the argument. This says what it does.
  const copy: Partial<Household> = { ...household };
  delete copy.my_role;
  delete copy.member_count;
  delete copy.photo_url;
  return copy as LedgeredHousehold;
}

/** Membership. Re-keyed off `(household_id, user_id)` — see `ids.ts` (S3b). */
export type LocalHouseholdMember = HouseholdMember & Owned;

export type LocalHouseholdSpace = HouseholdSpace;

/** 58-column row, the widest in Wave A — see plan §1.6 on LWW containment. */
export type LocalTask = Omit<Task, 'subtasks' | 'subtask_progress'> & Owned;

/** House's `expenses`: one row per occurrence, the highest-cardinality table. */
export type LocalMaintenanceCompletion = MaintenanceCompletion & Owned & { task_id: string };

export type LocalMaintenanceSubtask = MaintenanceSubtask & Owned;

export type LocalTaskNote = TaskNote & Owned & { task_id: string };

export type LocalHomeFeature = HomeFeature;

export type LocalAppliance = Appliance;

export type LocalApplianceServiceHistory = ServiceHistoryEntry & Owned;

/**
 * The appliance's paperwork — receipts, manuals, warranty scans — registered on
 * 2026-08-15 as the correction described in `schema.ts`, NOT as a sub-wave.
 *
 * Appliance-scoped in D1 (`appliance_documents` has no `household_id` column at
 * all), so the row gains the property the way every child row in this file does.
 * Metadata only: `r2_key` names the bytes, which live in the H6 blob channel and
 * never enter the ledger — the same split that lets B1's
 * `LocalContractorDocument` be carried in an op like any other row.
 *
 * **Three divergences from D1, and one of them is a DTO that is simply wrong.**
 * `waveBCSchemaParity` cannot see any of these, so they are written down:
 *
 *  1. **`uploaded_at` does not exist in D1, and the Worker never sends it.**
 *     `appliance_documents` has `upload_date`; `appliance-service.ts`
 *     `addDocument` / `listDocuments` both return `{ id, appliance_id, type,
 *     r2_key, upload_date }`. So the DTO declares a `string` field that is
 *     `undefined` on every row the REMOTE path has ever returned. The ledger
 *     row is the honest one: `uploaded_at` is written on create and is the
 *     field the facade sorts by, which makes the local rows the only ones that
 *     match their own declared type. It is also why this table is **not
 *     windowed** — carrying `upload_date` as well would put one instant in two
 *     fields of one row and let per-field LWW pick a winner for each. See
 *     `HOUSE_WINDOWED_DATE_FIELDS`.
 *  2. **`url` is never populated, on either path.** Nothing on the Worker signs
 *     an R2 URL for an appliance document, and a local-first household has no
 *     URL to sign: the bytes are AES-GCM sealed and are reached through
 *     `resolveHouseBlobUri`. Left `undefined` rather than filled with something
 *     plausible.
 *  3. **`blob` exists in D1 nowhere at all** — it is the H6 descriptor that
 *     makes the bytes travel, and it was added to `ApplianceDocument` itself
 *     (`src/api/appliances.ts`) rather than bolted on here, exactly as
 *     `TaskPhoto.blob` was. Without it this row is Budget's
 *     `localWishMedia.ts` bug one table over: the metadata syncs, the file does
 *     not, and the peer holds a receipt naming an R2 object its Worker never
 *     wrote. `r2_key` still carries a value because D1 declares it `notNull`
 *     and the DTO requires it — it holds the blob id under the `lf-blob/`
 *     namespace, exactly as `blobPhotoKey` does for a task photo, so a key that
 *     is NOT bytes-on-R2 is recognisable at a glance.
 *
 * So the only thing this alias adds is the property. There is no `created_at` /
 * `updated_at` on the row either, and that is deliberate rather than an
 * oversight: D1 has both, the DTO has neither, and a document record is written
 * once and replaced rather than edited — the same call B1's
 * `LocalContractorDocument` makes about its own missing `updated_at`.
 */
export type LocalApplianceDocument = ApplianceDocument & Owned;

export type LocalGarbageSchedule = GarbageSchedule;

/** Flat form of `SeasonalChecklist` — `items` and `progress` are derived. */
export type LocalSeasonalChecklist = Owned & {
  id: string;
  season: Season;
  year: number;
  climate_zone: string;
  created_at: string;
  updated_at: string;
};

export type LocalSeasonalChecklistItem = SeasonalChecklistItem & Owned;

/**
 * `checklists` in D1. Registered as `recurringChecklists` because
 * `schema-labor-hub.ts` declares a second physical `checklist_items` and the
 * registry is a flat map (plan §1.5 hazard S1).
 */
export type LocalRecurringChecklist = Owned & {
  id: string;
  name: string;
  description: string | null;
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'seasonal' | 'yearly' | 'custom';
  icon: string | null;
  color: string | null;
  is_active: boolean;
  season: string | null;
  custom_days: string | null;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type LocalRecurringChecklistItem = ChecklistItem & Owned;

export type LocalChecklistInstance = ChecklistInstance;

/** Re-keyed off `(instance_id, item_id)` — see `ids.ts` (S3b). */
export type LocalChecklistItemCompletion = ChecklistItemCompletion & Owned;

/** No client DTO exists — mirrors `schema-household-notes.ts`. */
export type LocalHouseholdNote = Owned & {
  id: string;
  created_by: string;
  title: string | null;
  body: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

/** Re-keyed off `(user_id, household_id, key)` — see `ids.ts` (S3b). */
export type LocalSetting = Setting;

/** Re-keyed off `(household_id, type, reference_id, period_key)` (S3b). */
export type LocalRecurringReminder = RecurringReminder;

export type LocalTaskDraft = TaskDraft;

// ---------------------------------------------------------------------------
// H11 sub-wave B1 — the contractor record, live since the labor hub's first cut
// ---------------------------------------------------------------------------

/**
 * The DTO is a 14-field view of a 34-column D1 row: `business_type`,
 * `license_number`, insurance and the SMS opt-in columns are not exposed. That
 * is fine and deliberate — a ledger row IS the DTO the API returned — but it
 * means ledgering `contractors` does not by itself make those columns available
 * offline. Widen the DTO first if a screen ever needs them.
 *
 * **`ContractorWithStats` and `ContractorDetail` are NOT what is stored.**
 * `totalVisits`, `totalSpent`, `lastVisitDate`, `recentVisits`, `documentCount`
 * and `specialtyInfo` are composed per request by `contractor-service.ts` out of
 * the visit and document tables — rule 1 above, the same shape as
 * `HouseholdSpace.task_count`. Storing them would give one fact two homes in the
 * ledger and let per-field LWW converge them to different answers, so
 * `localContractorsApi` recomputes them on read instead.
 */
export type LocalContractor = Contractor;

/**
 * `ContractorVisitWithContractor` is likewise a join the server performs, not a
 * column: the ledger row is the visit alone and the facade re-attaches the
 * contractor. `cost` is stored exactly as the DTO carries it — unlike
 * `appliances`, nothing on this path divides by 100, so there is no cents/dollars
 * conversion to get wrong.
 */
export type LocalContractorVisit = ContractorVisit;

/** Contractor-scoped in D1 — no `household_id` column exists on the table. */
export type LocalContractorRepresentative = ContractorRepresentative & Owned;

/**
 * Metadata only. `file_key` names an object in the encrypted blob channel (H6);
 * the bytes never enter the ledger, which is why the row is small enough to
 * carry in an op like any other.
 */
export type LocalContractorDocument = ContractorDocument;

// ---------------------------------------------------------------------------
// H11 sub-wave B2 — quoting: the appointment, the quote, and the two
// task-scoped tables that had no client DTO until this sub-wave
// ---------------------------------------------------------------------------

/**
 * `AppointmentWithDetails` is the composed shape, not the stored one: the
 * `contractor` block is a join `appointment-service.ts` performs per request and
 * `typeInfo` is a lookup into `APPOINTMENT_TYPE_INFO`, a client constant. Both
 * are rebuilt on read by `localAppointmentsApi` for the same reason
 * `localContractorsApi` rebuilds `totalSpent` — one fact, one home in the ledger,
 * or per-field LWW converges the copies to different answers.
 */
export type LocalAppointment = Appointment;

/**
 * The labor-hub quote, raised against a contractor and optionally an
 * appointment. NOT `contractor_quotes` — see `LocalContractorQuote` below; the
 * two tables are unrelated and only one of them is what `quotesApi` serves.
 *
 * `QuoteWithDetails` adds the contractor join plus `isExpiringSoon` /
 * `isExpired` / `daysUntilExpiration`, all three derived from `valid_until` and
 * the clock. Storing an expiry FLAG would be the worst kind of derived
 * collection: it is correct when written and wrong the next morning, and the
 * merge would then replicate yesterday's answer to every device.
 */
export type LocalQuote = Quote;

export const LOCAL_CONTRACTOR_QUOTE_STATUSES = [
  'pending',
  'accepted',
  'rejected',
  'expired',
  'withdrawn',
] as const;

export type LocalContractorQuoteStatus = (typeof LOCAL_CONTRACTOR_QUOTE_STATUSES)[number];

export const LOCAL_QUOTE_ENTRY_METHODS = ['manual', 'document_upload'] as const;

export type LocalQuoteEntryMethod = (typeof LOCAL_QUOTE_ENTRY_METHODS)[number];

export const LOCAL_QUOTE_AI_EXTRACTION_STATUSES = [
  'pending',
  'processing',
  'completed',
  'failed',
] as const;

export type LocalQuoteAiExtractionStatus = (typeof LOCAL_QUOTE_AI_EXTRACTION_STATUSES)[number];

/**
 * `contractor_quotes` — authored here because no client DTO existed.
 *
 * §3.2's rule is "a ledger row IS the DTO the remote API returned", and the only
 * remote surface for this table (`tasksApi.getTaskQuotes`) is typed `{ quotes:
 * any[] }`. `any` is not a DTO: it makes every field a guess at the call site and
 * it makes the ledger row unprojectable. So the shape is mirrored from
 * `backend/src/db/schema-contractors.ts:214` column by column — all 42 of them,
 * which is why the sub-wave's first step was authoring this rather than writing
 * a facade against a shape nobody had written down.
 *
 * Nullability follows Drizzle exactly. `.default(false)` WITHOUT `.notNull()`
 * infers `boolean | null`, so the five badge/flag columns are three-state; the
 * default only applies to rows D1 inserts, and a ledger row is inserted by the
 * device. `currency`, `status`, `submitted_at` and `entry_method` are the only
 * non-metadata columns D1 marks `notNull`.
 *
 * **Money is cents here**, unlike `contractor_visits.cost` (dollars) — `amount`,
 * `labor_cost` and `materials_cost` are all integer cents, matching `quotes`.
 * The two labor-hub money conventions genuinely differ; nothing converts.
 *
 * The AI-extraction block (`ai_*`, `needs_review`, `entry_method`) is stored, not
 * dropped. A quote extracted from a PDF on the server before the household went
 * local-first still has to render its confidence and review flag, and the column
 * is a plain scalar the ledger can carry. What the device cannot do is RUN the
 * extraction — that is the throw site, not the row.
 *
 * Re-keyed off `(task_id, contractor_id)` — see `ids.ts` (S3b).
 */
export type LocalContractorQuote = {
  id: string;
  task_id: string;
  contractor_id: string;
  household_id: string;
  visit_id: string | null;
  /** Integer cents, like `quotes.amount_cents`. */
  amount: number | null;
  currency: string;
  description: string | null;
  notes: string | null;
  estimated_start_date: string | null;
  estimated_completion_date: string | null;
  estimated_duration_days: number | null;
  valid_until: string | null;
  status: LocalContractorQuoteStatus;
  submitted_at: string;
  accepted_at: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  /** Names an object in the H6 blob channel; the bytes never enter the ledger. */
  document_file_key: string | null;
  document_file_name: string | null;
  document_file_size: number | null;
  document_mime_type: string | null;
  warranty_terms: string | null;
  payment_terms: string | null;
  materials_included: boolean | null;
  labor_cost: number | null;
  materials_cost: number | null;
  /** JSON array of line items, stored as the text D1 stores. */
  cost_breakdown: string | null;
  entry_method: LocalQuoteEntryMethod;
  ai_extraction_status: LocalQuoteAiExtractionStatus | null;
  ai_extracted_data: string | null;
  ai_extraction_confidence: number | null;
  ai_extraction_error: string | null;
  needs_review: boolean | null;
  is_recommended: boolean | null;
  is_lowest_price: boolean | null;
  is_fastest: boolean | null;
  custom_badges: string | null;
  internal_notes: string | null;
  contractor_notes: string | null;
  created_at: string;
  updated_at: string;
};

export const LOCAL_QUOTE_REQUEST_STATUSES = [
  'pending',
  'sent',
  'viewed',
  'responded',
  'declined',
  'expired',
] as const;

export type LocalQuoteRequestStatus = (typeof LOCAL_QUOTE_REQUEST_STATUSES)[number];

/**
 * `quote_requests` — also authored here, from
 * `backend/src/db/schema-contractors.ts:327`. The homeowner's side of the
 * conversation: "I asked these four people about this job, on this date."
 *
 * Two columns are worth naming because their D1 declarations are surprising:
 *
 *  - **`requested_by` references `households.id`, not a user.** That is a
 *    backend bug the schema has carried since the table was added, and the type
 *    records what the column IS rather than what it was meant to be. A ledger
 *    row must be able to hold what a server row holds, including its mistakes;
 *    fixing it is a migration, not a client-side reinterpretation.
 *  - **`quote_id` is `set null`, not cascade.** The request outlives the quote
 *    it produced, exactly as a contractor document outlives its visit — so the
 *    cascade on delete clears the pointer rather than dropping the row.
 *
 * `unread_messages_count` is a counter over `contractor_messages`, which B4 has
 * since ledgered — and it STAYS stored rather than becoming derived. Two
 * reasons, both stronger than the original "the table is not live yet": D1
 * stores it as a real column that a server-written row arrives carrying, and the
 * two things are not the same count anyway. `quote_requests` counts messages on
 * the third-party quoting channel the Worker owns; `contractor_messages` is the
 * household's own correspondence log, which nothing on device links to a
 * request. Deriving one from the other would answer zero for every row that came
 * from the server and be wrong rather than merely empty.
 *
 * Re-keyed off `(task_id, contractor_id)` — see `ids.ts` (S3b). The pair is the
 * SAME as `contractorQuotes`, which is why the id prefix is load-bearing.
 */
export type LocalQuoteRequest = {
  id: string;
  task_id: string;
  contractor_id: string;
  household_id: string;
  message: string | null;
  /** D1 references `households.id` here — see the note above. */
  requested_by: string;
  requested_at: string;
  status: LocalQuoteRequestStatus;
  sent_at: string | null;
  viewed_at: string | null;
  responded_at: string | null;
  declined_at: string | null;
  decline_reason: string | null;
  expires_at: string | null;
  quote_id: string | null;
  last_message_at: string | null;
  unread_messages_count: number | null;
  created_at: string;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// H11 sub-wave B3 — the project and the three child tables it owns
// ---------------------------------------------------------------------------

/**
 * `projects` — the job the household actually commissioned, usually out of an
 * accepted quote.
 *
 * **This is NOT `home_projects`.** That is the C4 renovation planner, a
 * different feature in a different Drizzle file with its own DTOs
 * (`LocalHomeProject` and friends, far below). The two are unrelated and share
 * only an English word.
 *
 * `ProjectWithDetails` is the composed shape and is never stored: the
 * contractor join, the three child arrays and the whole `progress` block are
 * rebuilt on read by `localProjectsApi`. `progress` in particular is a stored
 * aggregate waiting to happen — see the note on `total_spent_cents` below.
 *
 * **Three divergences between this DTO and D1, all of them pre-existing.** They
 * are recorded here rather than corrected, because the row IS the DTO and
 * changing the DTO would change what every screen already reads:
 *
 *  - **`linked_report_ids` (plural, a JSON array) does not exist in D1**, which
 *    has the singular `linked_report_id`, a real FK to `reports`. The remote
 *    create/update types accept `linked_report_ids?: string[]`, and the
 *    Worker's zod schema does not declare it, so today it is stripped in
 *    transit and never stored. The ledger keeps what the caller passed, which
 *    is a superset of the server's behaviour and cannot break a screen.
 *  - **`total_spent_cents` exists in D1 but not in this DTO**, so the server
 *    returns a column the client type does not declare (`markPaymentPaid`
 *    recomputes and writes it). Deliberately NOT ledgered: it is the sum of the
 *    paid `project_payments`, and a stored aggregate under per-field LWW is the
 *    derived-collection rule's exact failure mode — two devices settle two
 *    different payments offline and converge on one device's total, which is
 *    then wrong on both. `localProjectsApi` recomputes it into `progress`.
 *  - **`progress.totalAmount` vs the Worker's `remainingAmount`.** The server's
 *    own `ProjectWithDetails` returns `remainingAmount`; the client's declares
 *    `totalAmount`, and `ProjectsScreen` / `LaborHubDashboard` read
 *    `totalAmount`. `projectStore.updateProjectProgress` already papers over
 *    this by recomputing the block client-side on every set. The facade emits
 *    the client's shape, which is what the screens read.
 */
export type LocalProject = Project;

/**
 * Project-scoped in D1 (no `household_id` column); the ledger row adds the
 * property (H5). Cascades from `projects` — see `localProjectsApi.deleteProject`.
 */
export type LocalProjectMilestone = ProjectMilestone & Owned;

/**
 * Same scoping and same cascade as the milestone.
 *
 * `title` is a **client-only field**: `ProjectPayment` declares it and
 * `CreatePaymentRequest` requires it, but `project_payments` has no such column
 * and the Worker's zod schema drops it, so a payment fetched from the server
 * has `title: undefined` in a slot the type says is a `string`. The ledger
 * stores what the caller passed rather than reproducing the loss — again a
 * superset, and it makes the local row honest about its own declared type,
 * which `tsc` checks and the remote path does not.
 *
 * Money is integer cents (`amount_cents`), like `quotes` and unlike
 * `contractor_visits.cost`. Nothing here divides by 100.
 */
export type LocalProjectPayment = ProjectPayment & Owned;

/**
 * Metadata only, exactly like `LocalContractorDocument`: `photo_key` names an
 * object in the encrypted blob channel (H6) and the bytes never enter the
 * ledger. That split is why the row is worth ledgering at all — the caption,
 * the tags, the milestone it belongs to and when it was taken all work offline
 * even on a build where the bytes cannot move.
 */
export type LocalProjectProgressPhoto = ProjectProgressPhoto & Owned;

// ---------------------------------------------------------------------------
// H11 sub-wave B4 — the on-site surface: what to check, what was said, how it
// went. The sub-wave that completes Wave B.
// ---------------------------------------------------------------------------

/**
 * `visit_checklists` — the questions a member wants answered while the
 * contractor is standing in the room.
 *
 * `ChecklistWithItems` (the shape every remote method actually returns) is the
 * COMPOSED form and is never stored: `items` is a join
 * `visit-checklist-service.ts` performs per request, so it is rebuilt on read by
 * `localVisitChecklistsApi`. Rule 1 at the top of this file, applied for the
 * fourth time — `Task.subtasks`, `Checklist.items`, `ProjectWithDetails` and now
 * this one.
 *
 * Two DTO-vs-D1 divergences, both in the direction of a STRICTER client type:
 * `source` is `'manual' | 'ai_generated' | 'template'` on the DTO while D1
 * declares `.default('manual')` WITHOUT `.notNull()` (so a server row can carry
 * NULL), and the same holds for the item flags below. The ledger satisfies the
 * CLIENT type, because that is the type `tsc` checks and the type the screens
 * read — the call B2 made for `QuoteWithDetails.phone` and B3 for
 * `ProjectPayment.title`.
 */
export type LocalVisitChecklist = VisitChecklist;

/**
 * `checklist_items` from `schema-labor-hub.ts` — the S1 twin of
 * `LocalRecurringChecklistItem` above. The two DTOs are both called
 * `ChecklistItem`, which is precisely why the ledger names differ, and why this
 * one is imported under an alias.
 *
 * Checklist-scoped in D1 (there is no `household_id` column), so the ledger row
 * adds the property (H5) exactly as `LocalProjectMilestone` does. Cascades from
 * `visitChecklists`, and is itself a cascade PARENT of `checklistItemPhotos` —
 * the only two-hop chain that lives entirely inside one facade
 * (`localVisitChecklistsApi.delete`).
 *
 * `voice_note_key` is the column the schema-parity guard uses to prove this half
 * of the S1 pair resolves to the labor-hub file rather than the recurring one.
 * It names an object in the H6 blob channel; the bytes never enter the ledger,
 * which is what makes the row small enough to carry in an op.
 */
export type LocalVisitChecklistItem = VisitChecklistItemDto & Owned;

/**
 * Metadata only, exactly like `LocalContractorDocument` and
 * `LocalProjectProgressPhoto`: `photo_key` and `thumbnail_key` name objects in
 * the encrypted blob channel (H6) and the bytes never enter the ledger.
 *
 * That split is the whole reason the table is worth ledgering — the caption, the
 * dimensions and when the picture was taken all work in a basement, and only
 * moving the pixels needs the channel.
 */
export type LocalChecklistItemPhoto = ChecklistItemPhoto;

/**
 * `contractor_messages` — the correspondence log.
 *
 * Worth stating plainly because the name suggests otherwise: **nothing sends
 * anything.** `message-service.ts` writes a row and returns it; there is no mail
 * transport, no SMS gateway and no push. The member composes in the app, sends
 * from their own mail or messages app, and this table records that it happened —
 * the same shape as `localContractorsApi.requestReceipt`. So `create` is a plain
 * ledger write rather than a server surface, and the module has no throw site
 * for it.
 *
 * `MessageWithContractor` and `ConversationSummary` are composed on read and are
 * NOT stored: the contractor join is a per-request lookup and `unread_count` /
 * `total_messages` are counts over the rows themselves. A stored count is the
 * derived-collection rule's failure mode — two members reading two different
 * messages offline each write a count that omits the other's.
 */
export type LocalContractorMessage = ContractorMessage;

/**
 * `contractor_job_ratings` — one rating per visit.
 *
 * Re-keyed off `(visit_id)` — see `ids.ts` (S3b). This is the FIRST live table
 * whose natural key is a single column, and the constraint is real:
 * `contractor_job_ratings_visit_id_idx` is a D1 `uniqueIndex` and
 * `rating-service.ts` raises `A rating already exists for this visit` on top of
 * it. Two members rating the same call-out offline must converge on one row that
 * LWW resolves, not two that both count toward the average.
 *
 * `RatingWithDetails` and `RatingSummary` are composed, never stored — including
 * the averages, which are the textbook stored-aggregate hazard. Note the client
 * and the server disagree about BOTH composed shapes (the client declares
 * `visit` + `rated_by_user`, the Worker answers `contractor` + `reviewPhotos`;
 * the client's summary is snake_case with a `rating_distribution` the Worker
 * does not send). `localRatingsApi` emits the CLIENT's shapes — see its header.
 *
 * `contractors.rating` is a related trap and is deliberately NOT written here:
 * the Worker recomputes that column from these rows, but the same column is
 * ALSO the member's own hand-entered rating on the contractor form (B1's
 * `create`/`update` both accept it). Recomputing it on device would silently
 * overwrite what the member typed, and storing an aggregate under per-field LWW
 * converges wrongly anyway. `localRatingsApi.getSummary` derives the average on
 * read instead.
 */
export type LocalContractorJobRating = ContractorJobRating;

export const LOCAL_VISIT_NOTE_TYPES = ['voice', 'photo', 'text', 'checklist'] as const;

export type LocalVisitNoteType = (typeof LOCAL_VISIT_NOTE_TYPES)[number];

/**
 * `visit_notes` — authored here because no client DTO existed.
 *
 * §3.2's rule is "a ledger row IS the DTO the remote API returned", and this
 * table has a full backend router (`routes/visit-notes.ts`) and service with no
 * client module at ALL — nothing in `src/api/` calls it. So the shape is
 * mirrored from `backend/src/db/schema-labor-hub.ts:632` column by column, which
 * is what makes the row projectable, exportable and typed rather than an
 * anonymous bag the merge carries blind.
 *
 * A ledgered table with no facade is not a contradiction; it is the same
 * position `contractorQuotes` and `quoteRequests` hold after B2. Rows that
 * already exist — written by the server before the household went local-first,
 * or by a peer on a later build — converge and are carried by every checkpoint,
 * export and backup instead of being dropped on the floor. What B4 adds is the
 * DELETE half: `visit_notes.visit_id` cascades from `contractor_visits`, so
 * `localContractorsApi.deleteVisit` now drops the visit's notes with it.
 *
 * Nullability follows Drizzle exactly. `timestamp` is `notNull` and is the
 * windowed date field; `content` holds either the text the member typed or the
 * blob key for a voice/photo note, which is why it is nullable despite being the
 * point of the row.
 */
export type LocalVisitNote = Owned & {
  id: string;
  visit_id: string;
  type: LocalVisitNoteType;
  /** Text content for a text note, or the H6 blob key for voice/photo. */
  content: string | null;
  /** Voice notes only — filled in by a transcription the device did not run. */
  transcription: string | null;
  /** JSON array, stored as the text D1 stores: `['before','after','issue',…]`. */
  tags: string | null;
  timestamp: string;
  created_at: string;
};

export const LOCAL_RESOLUTION_STATUSES = [
  'pending',
  'resolved',
  'partially_resolved',
  'unresolved',
] as const;

export type LocalResolutionStatus = (typeof LOCAL_RESOLUTION_STATUSES)[number];

/**
 * `contractor_issue_resolutions` — also authored here, from
 * `backend/src/db/schema-labor-hub.ts:566`, and the emptier of the two gaps:
 * this table has neither a client module NOR a backend router. It is reachable
 * only by a direct D1 write.
 *
 * It is ledgered anyway, for one reason that is not optional: `contractor_id`
 * references `contractors.id` with `onDelete: 'cascade'`, and
 * `contractor-service.ts` HARD-deletes a contractor. Leaving the table
 * unregistered would not make the problem go away — it would make the rows
 * invisible to the cascade, so a household that has any (from a server-side
 * backfill, say) would keep them forever on every peer after the contractor they
 * belong to was deleted. Registering it is what lets
 * `CONTRACTOR_CASCADE_TABLES` name it, and the schema-derived guard in
 * `localContractorsApi.test.ts` now REQUIRES that it does.
 *
 * `cost_cents` is integer cents, like `quotes` and `projects` and unlike
 * `contractor_visits.cost`. `visit_id` is `set null`, not cascade — the record
 * that a leak was fixed outlives the call-out that fixed it, exactly as a
 * receipt outlives its visit.
 */
export type LocalContractorIssueResolution = Owned & {
  id: string;
  contractor_id: string;
  /** `set null` on delete — the resolution outlives the report. */
  report_id: string | null;
  /** `set null` on delete. */
  task_id: string | null;
  /** `set null` on delete — see `localContractorsApi.deleteVisit`. */
  visit_id: string | null;
  issue_title: string;
  issue_category: string | null;
  resolution_status: LocalResolutionStatus;
  resolution_notes: string | null;
  /** Integer cents. */
  cost_cents: number | null;
  resolved_at: string | null;
  created_at: string;
};

// ---------------------------------------------------------------------------
// H11 sub-wave C1 — utilities: the bills, the accounts behind them, and the two
// annual property records. The first block of Wave C.
// ---------------------------------------------------------------------------

/**
 * `utility_accounts` — the member's account with a provider, not the bill.
 *
 * `provider_id` references `utility_providers`, which is **Tier C** (global
 * reference data, in `HOUSE_TIER_C_TABLES`) and therefore not on the device. So
 * the ledger stores the id exactly as the caller passed it and no local method
 * can resolve it to a provider name — the same position `garbageSchedules` holds
 * against the municipality catalogue. Nothing on the utilities screens reads a
 * provider record through an account today; they read `utility_bills.provider`,
 * which is a plain text column on the bill.
 *
 * Soft-deleted, which is why this table has no cascade: `deleteUtilityAccount`
 * sets `is_active = false` rather than removing the row, so D1's own
 * `utility_bills.account_id` foreign key never fires — and it is not declared
 * `onDelete: 'cascade'` anyway.
 */
export type LocalUtilityAccount = UtilityAccount;

/**
 * `utility_bills` — and the one table in Wave C whose delete actually cascades.
 *
 * `utility_reminders.bill_id` references this row with `onDelete: 'cascade'` and
 * `utility-service.ts:739` HARD-deletes the bill (`.delete(utilityBills)`), so
 * the cascade genuinely fires server-side. On device a delete is a tombstone
 * rather than a foreign key, so `localUtilitiesApi.deleteBill` performs it by
 * hand — see the header of that module for the full audit.
 *
 * **Money is integer cents** (`amount`, `paid_amount`), like `quotes` and
 * `projects` and unlike `contractor_visits.cost`. Nothing divides by 100.
 *
 * `task_id` is a real D1 column and a real pointer into `tasks`, a Wave-A ledger
 * table: an unpaid bill owns a one-time "Pay <provider> bill" task carrying its
 * due date. Both halves of that link are on the ledger, so the facade maintains
 * it exactly as the Worker does — mints the task with the bill, drops it when
 * the bill is marked paid, brings it back when the bill is reopened, and deletes
 * it with the bill. `ai_extracted_data` is stored as the JSON text D1 stores;
 * what the device cannot do is RUN the extraction, which is the throw site.
 */
export type LocalUtilityBill = UtilityBill;

/**
 * `property_taxes` — one notice per property per year.
 *
 * Re-keyed off `(household_id, tax_year)` — see `ids.ts` (S3b).
 * `property_taxes_household_year_idx` is a real D1 `uniqueIndex`, and the
 * offline double-create it prevents is ordinary rather than a race: the notice
 * arrives on paper, either member may photograph and file it, and with random
 * ids the year-over-year chart would plot 2026 twice.
 *
 * `grantWarning` is on the DTO but is **not a column**: the create ROUTE adds it
 * to the 201 body when another of the user's properties already claimed that
 * year's Home Owner Grant. It is a per-request warning about OTHER households, so
 * it is never stored — and it can never be raised on device, because a
 * local-first ledger holds one property and cannot see another's tax rows. The
 * facade's `createPropertyTax` therefore returns the row without it, which is
 * what the server returns whenever there is no conflict.
 *
 * `main_payment_task_id` and `grant_task_id` are the same kind of pointer as
 * `utility_bills.task_id`, and are maintained the same way.
 */
export type LocalPropertyTax = PropertyTax;

/**
 * `bc_assessment_data` — one assessment per property per year.
 *
 * Re-keyed off `(household_id, assessment_year)` — see `ids.ts` (S3b), and the
 * duplicate this prevents is the same shape as the tax one. Both are
 * deliberately UNWINDOWED: their only period column is an `integer` year, and
 * `rowBucket` reads a `YYYY-MM` prefix off a string, so a window naming them
 * would look configured and do nothing at all. Ten years of these is ten rows.
 *
 * `assessment_pdf_key` names an object in the H6 blob channel exactly as
 * `contractorDocuments.file_key` does; the bytes never enter the ledger.
 */
export type LocalBcAssessmentData = BCAssessmentData;

export const LOCAL_UTILITY_REMINDER_TYPES = [
  'payment_due',
  'overdue',
  'homeowner_grant',
  'assessment_appeal',
] as const;

export type LocalUtilityReminderType = (typeof LOCAL_UTILITY_REMINDER_TYPES)[number];

export const LOCAL_UTILITY_NOTIFICATION_CHANNELS = ['push', 'email', 'sms'] as const;

export type LocalUtilityNotificationChannel =
  (typeof LOCAL_UTILITY_NOTIFICATION_CHANNELS)[number];

/**
 * `utility_reminders` — authored here because no client DTO existed.
 *
 * §3.2's rule is "a ledger row IS the DTO the remote API returned", and this
 * table has a backend service (`scheduleBillReminders`, `getReminders`) with NO
 * client module surface at all: `utilitiesApi` exposes no reminder method, so
 * nothing in `src/` has ever named this shape. It is mirrored from
 * `backend/src/db/schema-utilities.ts:189` column by column, which is what makes
 * the row projectable, exportable and typed rather than an anonymous bag the
 * merge carries blind. It was the last-but-one entry in
 * `HOUSE_STAGED_TABLES_WITHOUT_DTO`.
 *
 * **Ledgered, and deliberately never WRITTEN by the facade.** That is the same
 * position `visitNotes` and `contractorIssueResolutions` hold after B4, and it is
 * a decision rather than an omission. The server writes these rows so its 5-minute
 * cron can send a push; a local-first household's ledger is ciphertext to that
 * cron, and on-device reminders are H4's own scheduler
 * (`reminders/houseLocalReminders.ts`) reading the bill's `due_date` directly.
 * Minting rows here would replicate a work queue nobody drains to every peer
 * forever. What the table IS needed for is the other two things a registration
 * buys: rows the server wrote before the household went local-first converge and
 * are carried by every checkpoint, export and backup, and — decisively — the
 * cascade can reach them. `bill_id` is the only `onDelete: 'cascade'` in the
 * whole of Wave C that a server delete actually fires.
 *
 * Nullability follows Drizzle exactly. `bill_id` is nullable because the grant
 * and appeal reminder types hang off a tax notice rather than a bill;
 * `scheduled_for` is `notNull` and is the windowed date field.
 */
export type LocalUtilityReminder = Owned & {
  id: string;
  /** Nullable: grant / appeal reminders belong to a notice, not to a bill. */
  bill_id: string | null;
  reminder_type: LocalUtilityReminderType;
  /** `notNull`, and the field this table windows on. */
  scheduled_for: string;
  sent_at: string | null;
  reminder_days_before: number | null;
  notification_channel: LocalUtilityNotificationChannel | null;
  created_at: string;
};

// ---------------------------------------------------------------------------
// H11 sub-wave C2 — floor plans: the drawing of the home, the pins on it and
// the lines drawn over it. The second block of Wave C.
//
// All three DTOs already existed and are exported from `src/api/floor-plans.ts`,
// so unlike every sub-wave since B1 this one authored no shape. The work was the
// other half of §3.2's rule — checking each DTO against the D1 columns and
// NAMING the divergences, because a divergent DTO is still the DTO but a silent
// divergence is a bug. There are eight, listed on the three types below.
//
// One thing is NOT here and must never be: `floor_plan_regions`. It is the
// fourth table in `schema-floor-plans.ts`, it has a client DTO
// (`FloorPlanRegion`) exactly like these three. It WAS Tier D and is ledgered
// as of the H13 D-wave — `LocalFloorPlanRegion` is declared below, which is the
// step this note anticipated. Producing regions still needs the segmentation
// model; reading them no longer needs anything.
// ---------------------------------------------------------------------------

/**
 * `floor_plans` — the drawing itself, and the metadata the app hangs off it.
 *
 * **The bytes are not in the ledger.** `original_file_key`, `display_image_key`,
 * `thumbnail_key`, `vector_semantic_key` and `vector_trace_key` all name objects
 * in the H6 encrypted blob channel, exactly as `contractorDocuments.file_key`
 * does. The row is the paperwork; only moving the image needs the channel, which
 * is why `localFloorPlansApi` ledgers every field on this type and throws on the
 * three methods that transfer bytes.
 *
 * **Soft-deleted server-side, tombstoned here.** `floor-plan-service.ts:334`
 * sets `deleted_at`, so D1's three `onDelete: 'cascade'` foreign keys never
 * fire and the markers, annotations and regions survive on the server. The
 * ledger has no `deleted_at` on this DTO (divergence 2 below), so a local delete
 * is a real removal — which is why the facade drops the children by hand. See
 * `FLOOR_PLAN_CHILD_TABLES` in `localFloorPlansApi.ts` for the full audit.
 *
 * **Four divergences from the D1 columns, all pre-existing:**
 *
 *  1. `ai_analysis_data` is typed `FloorPlanAnalysis | null` and D1 stores
 *     `text` — a JSON string. The DTO is what the SCREENS read and what `tsc`
 *     checks, so the ledger satisfies the DTO: `localFloorPlansApi` parses on
 *     the way in and stores the object. The same call B3 made on
 *     `linked_report_ids`. `ocr_detected_dimensions` is the same divergence
 *     (`DetectedDimension[] | null` vs `text`) and is handled the same way.
 *  2. `deleted_at` exists in D1 and NOT on the DTO. That is the divergence that
 *     changes behaviour rather than shape, and it is argued above.
 *  3. `content_hash` exists in D1 (the SHA-256 the AI Housekeeper attachment
 *     router copies across) and NOT on the DTO. Nothing in `src/` has ever read
 *     it, so the ledger does not carry it — adding a field the client cannot
 *     name would put a column in the op log that no reader can use.
 *  4. `scale_unit`, `scale_calibration_method`, `ocr_status`,
 *     `ai_analysis_status` and `vectorization_status` are all `.default(…)`
 *     WITHOUT `.notNull()` in D1, so a row the server wrote can hold null in a
 *     slot the DTO types as a non-null union (`ai_analysis_status` is the one
 *     the DTO admits `| null` for). The facade always writes the defaults the
 *     service writes, so a locally-created row is never null there.
 */
export type LocalFloorPlan = FloorPlan;

/**
 * `floor_plan_markers` — a pin tying a task to a place on the drawing.
 *
 * `& Owned` because D1 scopes a marker by its floor plan alone; a row in a flat
 * op log carries no context and H5 puts several properties on one device.
 *
 * **Three divergences, and the first one is the interesting one:**
 *
 *  1. `linked_entity_type` is typed `'task'` on the DTO. D1 stores
 *     `'maintenance_task'` — `LINKED_ENTITY_TYPES` is
 *     `['maintenance_task', 'action_item']` and the create route's zod
 *     PREPROCESSES `'task'` into `'maintenance_task'` before the service sees
 *     it (`routes/floor-plans.ts:75`). So the DTO names a value no stored row
 *     ever holds, and the facade normalises on write exactly as the route does.
 *     The read side of that translation is missing on the server —
 *     `getMarkersForEntity` reads the query parameter raw — which is why the
 *     local `getMarkersForEntity` matches both spellings; see the method.
 *  2. `show_label` is `boolean` on the DTO and `.default(true)` without
 *     `.notNull()` in D1, so a server row can hold null where the DTO promises
 *     a boolean. The facade writes `data.show_label ?? true`, matching the
 *     service, so a locally-created marker is never null.
 *  3. `deleted_at` exists in D1 and not on the DTO — the same tombstone
 *     argument as the plan above. `deleteMarker` soft-deletes server-side and
 *     removes the row here.
 *
 * `space_id` points at `household_spaces`, which is LIVE (Wave A), and is
 * resolved by a hit-test against the space bounding boxes when the caller does
 * not supply one. That arithmetic is the server's and is ported — see
 * `localFloorPlansApi.createMarker`.
 */
export type LocalFloorPlanMarker = FloorPlanMarker & Owned;

/**
 * `floor_plan_annotations` — freehand lines, circles, text and measurements.
 *
 * `& Owned` for the same reason as the marker above.
 *
 * **Two divergences:**
 *
 *  1. `svg_data` is a typed OBJECT on the DTO (`{ x1?, y1?, points?, path?, … }`)
 *     and `text('svg_data').notNull()` in D1 — the service calls
 *     `JSON.stringify` on the way in. Same resolution as the plan's
 *     `ai_analysis_data`: the ledger satisfies the DTO and stores the object,
 *     because that is the type the screens read and `tsc` checks.
 *  2. `font_size` is `number` on the DTO and `.default(14)` without `.notNull()`
 *     in D1. The service writes `data.font_size || 14`, so a locally-created
 *     annotation is never null; a server row could be.
 *
 * `deleted_at` is the third, and is the same argument as the two types above,
 * so it is not counted twice.
 */
export type LocalFloorPlanAnnotation = FloorPlanAnnotation & Owned;

// ---------------------------------------------------------------------------
// H11 sub-wave C3 — garden plans: the picture of the yard, the vector objects
// laid over it, the pins tying a task to a spot, and the lot-boundary drafts
// that the satellite flow used to produce. The third block of Wave C.
//
// Like C2 this sub-wave authored no shape — all four DTOs already exist in
// `src/api/garden-plans.ts` and `src/types/garden-objects.ts` — so the work was
// again §3.2's other half: checking each DTO against the D1 columns and NAMING
// the divergences. There are TWENTY-FOUR, which is three times C2's eight, and
// the reason is structural rather than sloppy: two of these four DTOs are not
// row mirrors at all. `GardenPlanObject` and `GardenPlanBoundaryDraft` are
// PROJECTIONS the service composes by hand (`listObjects`'s `rows.map(...)` and
// `GardenPlanBoundaryService.toResponse`), so every column those projections
// drop, rename, parse, compose or hardcode is a divergence by construction.
//
// Two of them change what the ledger can DO rather than what it looks like, and
// both are listed first on their type:
//
//  - `garden_plan_objects.garden_plan_id` is absent from its DTO. Without it on
//    the row, `deleteGardenPlan` cannot find the children to cascade and
//    `listObjects` cannot find them to read.
//  - `garden_plan_boundary_drafts.created_at` is absent from ITS DTO, and the
//    registry WINDOWS that table on `created_at`. `rowBucket` reads
//    `row['created_at']`; on a row that has no such field it gets `undefined`,
//    yields no `YYYY-MM` and falls through to always-resident. The window would
//    have looked configured and done nothing at all — §11.1.3's hazard arriving
//    through the ROW TYPE rather than through the column type, which is the form
//    `waveBCSchemaParity` cannot catch (the D1 column is a perfectly good
//    `text`). Carrying the field is what makes the registered window real.
//
// Nothing in this block is Tier D — unlike C2, `schema-garden-plans.ts` declares
// exactly four tables and all four are the member's own.
// ---------------------------------------------------------------------------

/**
 * `garden_plans` — the yard photo or generated diagram, and its paperwork.
 *
 * **The bytes are not in the ledger.** `original_file_key`, `display_image_key`
 * and `thumbnail_key` name objects in the H6 encrypted blob channel, exactly as
 * `floor_plans` does. The row is the paperwork; only moving the image needs the
 * channel, which is why `localGardenPlansApi` ledgers every field on this type
 * and throws on the three methods that transfer bytes.
 *
 * **Soft-deleted server-side, tombstoned here.** `garden-plan-service.ts:229`
 * sets `deleted_at`, so D1's two `onDelete: 'cascade'` foreign keys never fire
 * and the objects and markers survive on the server. The ledger has no
 * `deleted_at` on this DTO (divergence 4 below), so a local delete is a real
 * removal — which is why the facade drops the children by hand. See
 * `GARDEN_PLAN_CHILD_TABLES` in `localGardenPlansApi.ts` for the full audit.
 *
 * **Five divergences from the D1 columns, all pre-existing:**
 *
 *  1. `content_hash` exists in D1 (the SHA-256 the AI Housekeeper attachment
 *     router copies across) and NOT on the DTO. Not carried, for the reason C2
 *     gave for the identical column on `floor_plans`: a field the client cannot
 *     name is a column in the op log that no reader can use.
 *  2. `source_approval_id` exists in D1 and NOT on the DTO. It points at
 *     `ai_tool_pending`, which is Tier B — the server follows it to re-fetch a
 *     generation prompt and to flip the approval row. Neither is reachable from
 *     a device, which is also why `cancelGeneration` and `retryGeneration` are
 *     throws rather than local methods.
 *  3. `generation_prompt` exists in D1 and NOT on the DTO — the text handed to
 *     the image model, read only by `retryGardenPlanGeneration`. Same position
 *     as (2).
 *  4. `deleted_at` exists in D1 and NOT on the DTO. That is the divergence that
 *     changes behaviour rather than shape, and it is argued above.
 *  5. Five nullable columns are declared OPTIONAL (`field?:`) on the DTO rather
 *     than `field: … | null`: `reference_image_source`, `boundary_draft_id`,
 *     `boundary_source`, `boundary_geojson` and `geocode_place_name`. Every row
 *     the Worker selects carries all five as keys (null when unset), so the
 *     optionality describes no row that has ever existed. It matters here and
 *     not over HTTP: per-field LWW compares fields that are PRESENT, so a row
 *     written with a key genuinely absent and a peer's row with the same key set
 *     to null are not the same row. The facade always writes the explicit null.
 *
 * **And one thing that is deliberately NOT a divergence.** `boundary_geojson` is
 * `string` on the DTO and `text` in D1, so unlike `floor_plans.ai_analysis_data`
 * this one is NOT the object/JSON-text split: `updateBoundary` stringifies on
 * the way in and `useBoundaryEditor` parses on the way out. The ledger stores the
 * STRING, because that is what the DTO declares and what the screens parse.
 */
export type LocalGardenPlan = GardenPlan;

/**
 * `garden_plan_objects` — the editable vector layer a member arranges over the
 * yard: trees, beds, paths, patios and labels.
 *
 * This DTO is a **projection**, not a row mirror. `listObjects` builds it by
 * hand out of ten of the sixteen D1 columns, so the ledger row is the DTO plus
 * the two fields the HTTP shape carried IMPLICITLY and a flat op log cannot.
 *
 * **Seven divergences:**
 *
 *  1. `garden_plan_id` is a `notNull` D1 column and is absent from the DTO,
 *     because the URL carried it (`/garden-plans/:id/objects`). Added, which is
 *     Wave A's second systematic adjustment applied again — and here it is not
 *     merely tidy: `deleteGardenPlan` cascades on this column, and a row without
 *     it could not be found to drop.
 *  2. `sort_order` is a `notNull` D1 column and is absent from the DTO, because
 *     the ARRAY ORDER of the JSON response carried it. A ledger is an unordered
 *     row set, so the order has to be a column or two devices draw the same
 *     garden differently. `replaceObjects` writes the array index, exactly as
 *     the service does, and `listObjects` sorts on it.
 *  3. `metadata` is a typed object on the DTO and `metadata_json` is `text` in
 *     D1 — the service `JSON.stringify`s in and `parseMetadata` parses out. Same
 *     resolution as C2's `svg_data` and B3's `linked_report_ids`: the ledger
 *     satisfies the DTO and stores the object, because that is the type the
 *     screens read and `tsc` checks.
 *  4. `deleted_at` exists in D1 and not on the DTO — and it is `replaceObjects`
 *     that sets it, soft-deleting the whole previous layer before inserting the
 *     new one. On the ledger that drop is a real tombstone.
 *  5. `created_by`, `created_at` and `updated_at` are D1 columns the projection
 *     never returns. Not carried, for divergence (1)'s reason on the plan above:
 *     no client reader can name them. This is the one table in the registry with
 *     no `created_at` on its row, which is safe only because it is deliberately
 *     unwindowed — see `HOUSE_STAGED_WINDOWED_DATE_FIELDS`'s note on drawing
 *     content, and the boundary draft below for what happens when it is not.
 *  6. `label` and `color` are `string | null | undefined` on the DTO (optional
 *     AND nullable) and plain nullable `text` in D1. The facade writes the
 *     explicit null, as the service does.
 *  7. `id` is REQUIRED on the DTO and optional on the service's own input type
 *     (`GardenPlanVectorObject`) — and `replaceObjects` discards whatever the
 *     caller sent, minting a fresh `generateId()` per row. Reproduced, with the
 *     merge consequence named on the method.
 *
 * `& Owned` because D1 scopes an object by its plan alone; H5 puts several
 * properties on one device.
 */
export type LocalGardenPlanObject = GardenPlanObject &
  Owned & {
    /** Divergence 1 — the owning FK the URL used to carry, and the cascade key. */
    garden_plan_id: string;
    /** Divergence 2 — the order the JSON array used to carry. */
    sort_order: number;
  };

/**
 * `garden_plan_markers` — a pin tying a task to a spot in the yard.
 *
 * The floor-plan marker's sibling, and close enough to it that the differences
 * are worth stating rather than assumed. There is **no `marker_type`** here (a
 * garden pin is always a pin), and — decisively — `createMarker` runs **no space
 * hit-test and no task back-fill**. `FloorPlanService.createMarker` does both;
 * `GardenPlanService.createMarker` inserts and returns. Porting C2's arithmetic
 * here would add behaviour the server does not have, which is the mirror image
 * of the bug C2's port existed to prevent.
 *
 * **Four divergences, and the first one is the one that breaks the feature:**
 *
 *  1. `linked_entity_type` is typed `'task'` on the DTO. D1 stores
 *     `'maintenance_task'` or `'action_item'`, and — unlike floor plans — the
 *     create route does NOT bridge them. `routes/floor-plans.ts:75` wraps the
 *     field in a `z.preprocess` that rewrites `'task'`; `routes/garden-plans.ts`
 *     has a plain `z.enum(['maintenance_task', 'action_item'])`, so the only
 *     value the client type permits is **400-rejected**. `GardenPlanViewerScreen`
 *     sends exactly that value, so creating a garden pin has never worked
 *     against the server for any household. The facade writes the value a
 *     working call would have produced, and `getMarkersForEntity` matches both
 *     spellings — see both methods.
 *  2. `x_percent` and `y_percent` are `number` on the DTO and **`integer`** in
 *     D1, where `floor_plan_markers` uses `real`. The route's zod is
 *     `z.number().min(0).max(100)`, so a fraction passes validation and lands in
 *     an INTEGER-affinity column. The one call site rounds before sending; the
 *     facade stores what it is given, as the service does.
 *  3. `show_label` is `boolean` on the DTO and `.default(true)` WITHOUT
 *     `.notNull()` in D1, so a server row can hold null where the DTO promises a
 *     boolean. The facade writes `data.show_label ?? true`, matching the service.
 *  4. `deleted_at` exists in D1 and not on the DTO — `deleteMarker` soft-deletes
 *     server-side and removes the row here.
 *
 * `space_id` points at `household_spaces` (LIVE, Wave A) with `onDelete: 'set
 * null'`, and `deleteSpace` is soft, so it never fires. Nothing resolves it: the
 * caller supplies it or it stays null.
 */
export type LocalGardenPlanMarker = GardenPlanMarker & Owned;

/**
 * `garden_plan_boundary_drafts` — the lot outline a member confirmed before
 * asking for a generated plan.
 *
 * The most projected DTO in the registry. `toResponse` reads eleven of the
 * twenty-two D1 columns, renames one, parses two, composes a third out of three
 * more, derives a fourth from a key and hardcodes a fifth to `null`.
 *
 * **The one that is not cosmetic: this is the only PER-MEMBER row in the whole
 * ledger.** `listPendingDrafts` filters on `user_id`, so a draft belongs to the
 * member who started it and not to the household. Every other registered table
 * is household-scoped, so `& Owned` alone would have been the obvious move and
 * would have shown one member's half-finished lot tracing to the other.
 *
 * **Eleven divergences:**
 *
 *  1. `household_id` is a `notNull` D1 column absent from the DTO — `& Owned`.
 *  2. `user_id` is a `notNull` D1 column absent from the DTO, and it is
 *     load-bearing: see above.
 *  3. `created_at` is a `notNull` D1 column absent from the DTO, and the
 *     registry windows this table on it. Carried, or the window is inert — see
 *     this block's header.
 *  4. `updated_at` is a `notNull` D1 column absent from the DTO;
 *     `listPendingDrafts` orders on it, descending.
 *  5. `address` is a parsed OBJECT on the DTO and `address_json` is `text` in
 *     D1. Same resolution as the object layer's `metadata`.
 *  6. `geocode` is COMPOSED on the DTO from three separate D1 columns
 *     (`geocode_lat`, `geocode_lon`, `geocode_place_name`) and is `null` unless
 *     both coordinates are set. A fourth column, `geocode_json`, is never read
 *     by the projection at all.
 *  7. `geocode.confidence` is declared on the DTO and `toResponse` never sets
 *     it. It is a field no row has ever held — the same shape as C2's
 *     `linked_entity_type: 'task'`, and it is stored as absent because that is
 *     what the server returns.
 *  8. `parcel` is typed as the literal `null` on the DTO, and D1 carries FIVE
 *     parcel columns (`parcel_provider`, `parcel_id`, `parcel_geojson`,
 *     `parcel_confidence`, `parcel_match_json`). The projection hardcodes null,
 *     so no client has ever been able to read one.
 *  9. `confirmed_boundary` is the PARSED object of `confirmed_geojson` `text`,
 *     and renamed on the way. Note this is the opposite call to
 *     `garden_plans.boundary_geojson`, which the DTO keeps as a string — the two
 *     fields hold the same kind of value and the two DTOs disagree about its
 *     type, which is why both are stated.
 * 10. `preview_image_url` is DERIVED (`${API_URL}/files/<key>`) and is not a
 *     column. It is the one DTO field this type deliberately OMITS, for
 *     `LedgeredHousehold.photo_url`'s reason: a stored URL is per-viewer and
 *     goes stale, and per-field LWW would then carry one member's dead link to
 *     every peer. The facade rebuilds it from `preview_image_key` on read, which
 *     is what `localFloorPlansApi.getVectorAssets` does with the vector keys.
 * 11. `status` is `string` on the DTO and D1 constrains it to
 *     `draft | confirmed | generating | generated | expired` (`notNull`,
 *     defaulting to `draft`). The two statuses `listPendingDrafts` admits are
 *     the first two.
 *
 * **Hard-deleted server-side** (`garden-plan-boundary-service.ts:145`) and a
 * LEAF: nothing declares a foreign key into it. `garden_plans.boundary_draft_id`
 * points the other way and is a plain indexed `text` column with no
 * `references()`, so deleting a draft leaves that pointer dangling on both
 * backends — see `deleteBoundaryDraft`.
 */
export type LocalGardenPlanBoundaryDraft = Omit<
  GardenPlanBoundaryDraft,
  'preview_image_url'
> &
  Owned & {
    /** Divergence 2 — this table is scoped to a MEMBER, not to the property. */
    user_id: string;
    /** Divergence 3 — `notNull` in D1, and the field this table windows on. */
    created_at: string;
    /** Divergence 4 — `notNull` in D1, and what `listBoundaryDrafts` orders by. */
    updated_at: string;
  };

// ---------------------------------------------------------------------------
// H11 sub-wave C4 — home projects: the renovation the household is planning,
// the money it is budgeted at, the things being bought for it, the schedule,
// the paperwork and the conversation around it. The fourth block of Wave C, and
// the one that COMPLETES the registry.
//
// **This is NOT `projects`.** That is B3's labor-hub contractor job, declared in
// `schema-labor-hub.ts` with its own DTOs (`LocalProject` and friends, far
// above). These ten tables come from `schema-home-projects.ts` and every ledger
// name in the family begins `homeProject` for exactly that reason.
//
// ## Fourteen tables in the Drizzle file, ten here
//
// Four are excluded and each exclusion is proved rather than remembered:
// `home_project_geometry` was Tier D and is ledgered as of the H13 D-wave (the layout, which H7 re-derives on
// device or the feature is off), and `home_project_spaces`, `home_project_tasks`
// and `home_project_contractors` are hazard S2 — PK-less join tables with
// nothing to key a row on. `registryGuard` asserts the tier split over the whole
// registry and `waveBCSchemaParity` asserts the S2 three genuinely have no `id`.
//
// ## The DTO work, which was the largest of any sub-wave
//
// C4 carried the registry's LAST DTO gap: `home_project_milestones` had no
// client type at all, so `LocalHomeProjectMilestone` below is written from the
// Drizzle columns exactly as B2, B4 and C1 wrote theirs. It is also the sub-wave
// where the other half of §3.2 — a DTO that is present and LOSSY — bit hardest.
// Two of the nine existing DTOs name a WINDOW FIELD THEY DO NOT DECLARE:
//
//  - `home_project_blockers` windows on `created_at` and `HomeProjectBlocker`
//    has no such field;
//  - `home_project_attachments` windows on `created_at` and
//    `HomeProjectAttachment` has no such field either.
//
// `rowBucket` reads `row['created_at']`; on a row that has no such key it gets
// `undefined`, yields no `YYYY-MM` and falls through to always-resident. Both
// windows would have looked configured and done nothing at all — §11.1.4b's
// hazard, which C3 met once and C4 met twice. `waveBCSchemaParity` cannot see it
// (both D1 columns are perfectly good `text`), so both fields are carried on the
// row types below and both are asserted at runtime in
// `localHomeProjectsApi.test.ts`.
//
// Two more DTOs drop a `sort_order` the HTTP array order carried implicitly,
// which is C3's `garden_plan_objects` divergence arriving twice more. There are
// TWENTY-EIGHT divergences in total and they are named one by one below.
// ---------------------------------------------------------------------------

/**
 * `home_projects` — the renovation itself.
 *
 * The one type in this family with **no divergence at all**: `HomeProject`
 * mirrors all nineteen D1 columns, in order, including `household_id`, so it
 * needs no `& Owned` and no additions. That is worth stating because it is the
 * exception here rather than the rule — every other DTO in the block drops
 * something.
 *
 * **Nothing deletes a home project, on either backend.** There is no route, no
 * service method and no client api method — `archive` sets `status` to
 * `'archived'` and the row stays. So the thirteen `onDelete: 'cascade'` foreign
 * keys pointing at this row can never fire, and — because the local facade
 * exposes no delete either — the ledger inherits no tombstone obligation from
 * them. See `localHomeProjectsApi.ts` for both halves of that audit.
 *
 * `cover_attachment_id` points at `home_project_attachments` and carries no
 * `references()`, so it is a plain pointer on both backends.
 */
export type LocalHomeProject = HomeProject;

/**
 * `home_project_budget_lines` — one row per line of the estimate.
 *
 * **Money is integer cents** (`estimate_cents`, `actual_cents`), like `quotes`,
 * `projects` and `utility_bills` and unlike `contractor_visits.cost`. Nothing on
 * this path divides by 100.
 *
 * `version` is a real optimistic-concurrency counter rather than decoration:
 * `updateBudgetLine` raises a 409 when the caller's `version` does not match the
 * stored one, and `HomeProjectHubScreen` renders that through
 * `isHomeProjectConflict`. It is stored, incremented on every update, and
 * checked — see `localHomeProjectsApi.updateBudgetLine`… which does not exist,
 * because `homeProjectsApi` exposes no budget-line method at all. The rows are
 * ledgered so the hub's rollups are computable and so a line the server wrote
 * before the cutover converges.
 *
 * **Four divergences:**
 *
 *  1. `household_id` is absent from the DTO — D1 scopes a line by its project
 *     alone — so `& Owned`, Wave A's second systematic adjustment.
 *  2. `sort_order` is a `notNull` D1 column absent from the DTO, because the
 *     ARRAY ORDER of the hub's JSON carried it (`getHub` ends
 *     `.orderBy(asc(homeProjectBudgetLines.sort_order))`). A ledger is an
 *     unordered row set, so the order has to be a column or two devices render
 *     the same estimate with the lines shuffled. Exactly C3's `garden_plan_objects`
 *     divergence 2.
 *  3. `selection_id` is a D1 column the DTO does not declare. NOT carried, for
 *     the reason C2 gave for `floor_plans.content_hash`: no client reader can
 *     name it, and a column in the op log that no reader can use is a field
 *     nobody can maintain. It is written once by `createSelection`'s auto-line
 *     and never read back by anything — not even by `deleteSelection`, which
 *     leaves the derived line in place on the server too.
 *  4. `created_at` and `updated_at` are D1 columns the DTO does not declare.
 *     Not carried, same reason — and safe here only because this table is
 *     deliberately UNWINDOWED (see `HOUSE_WINDOWED_DATE_FIELDS`). It is the
 *     second row type in the registry with no `created_at`, after
 *     `gardenPlanObjects`, and for the identical reason.
 */
export type LocalHomeProjectBudgetLine = HomeProjectBudgetLine &
  Owned & {
    /** Divergence 2 — the order the hub's JSON array used to carry. */
    sort_order: number;
  };

/**
 * `home_project_selections` — the things being chosen and bought: the vanity,
 * the tile, the paint.
 *
 * `unit_price_cents` is integer cents. A selection with a price mints a
 * `materials` budget line worth `unit_price_cents × qty` — the server does that
 * inside `createSelection` and the facade does it in the SAME op, because a peer
 * that received the selection without the line would show a estimate that is
 * short by exactly one vanity.
 *
 * **Five divergences:**
 *
 *  1. `household_id` is absent from the DTO — `& Owned`, as above.
 *  2. `sort_order` is a `notNull` D1 column absent from the DTO, and the hub
 *     orders on it. Carried, for the budget line's reason.
 *  3. `surface_ref` is a D1 column the DTO does not declare — the wall or floor
 *     a selection applies to, written only by a geometry takeoff that is Tier D
 *     and cannot run on device. Not carried.
 *  4. `assignee_user_id` is a D1 column the DTO does not declare and no route
 *     ever writes. Not carried.
 *  5. `created_at` / `updated_at` — as on the budget line, and safe for the same
 *     reason: this table is unwindowed on purpose.
 *
 * `version` is the same optimistic-concurrency counter, and here it IS reachable:
 * `updateSelection` is on the client module and `HomeProjectHubScreen` sends the
 * version it last read. The facade raises the Worker's 409 in the shape
 * `isHomeProjectConflict` recognises — see `HouseLocalHomeProjectConflictError`.
 */
export type LocalHomeProjectSelection = HomeProjectSelection &
  Owned & {
    /** Divergence 2 — the order the hub's JSON array used to carry. */
    sort_order: number;
  };

/**
 * `home_project_option_groups` — the surface several selections compete for
 * (migration 0162): "Kitchen floor", 24 m², one winner.
 *
 * **Why the winner is an id on the GROUP and not a flag on the option**, and why
 * that matters more on a ledger than it does in D1: a per-field LWW merge of
 * `is_preferred` booleans across two offline devices converges happily on TWO
 * true rows, and nothing in the projection would notice. `preferred_selection_id`
 * is one field, so the merge picks one id by HLC and the group still has exactly
 * one winner however the writes interleave.
 *
 * **Divergences** are the budget line's, for the budget line's reason: the
 * `& Owned` household scope, and `created_at` / `updated_at` neither declared on
 * the DTO nor carried here.
 */
export type LocalHomeProjectOptionGroup = HomeProjectOptionGroup &
  Owned & {
    /** Divergence 2 — the order the hub's JSON array used to carry. */
    sort_order: number;
  };

/**
 * `home_project_phases` — demo, rough-in, surfaces, fixtures, finish.
 *
 * The one child DTO that already declares its `sort_order`, which is why this
 * type adds nothing but the property scope.
 *
 * **Two divergences:** `household_id` (`& Owned`) and `created_at` /
 * `updated_at`, neither declared and neither carried — the budget line's
 * argument, and again safe only because the table is unwindowed.
 */
export type LocalHomeProjectPhase = HomeProjectPhase & Owned;

/**
 * `home_project_milestones` — authored here, because no client DTO existed.
 *
 * **The last DTO gap in the whole registry.** §3.2's rule is "a ledger row IS the
 * DTO the remote API returned", and this table has a create route, a service
 * method and a place in the hub response — where the client types it
 * `milestones: unknown[]`. `unknown` is not a DTO: it makes every field a guess
 * at the call site and it makes the ledger row unprojectable. So the shape is
 * mirrored from `backend/src/db/schema-home-projects.ts:140` column by column,
 * exactly as B2 did for `contractor_quotes`, B4 for `visit_notes` and C1 for
 * `utility_reminders`.
 *
 * **It is also the table §11.1.4b said to watch, and the reason is structural.**
 * The registry windows this table on `['due_on', 'created_at']`. `rowBucket`
 * reads those keys off the ROW, so a row type that omitted either would leave
 * the window inert — configured-looking and doing nothing — and no schema check
 * could see it, because both D1 columns are fine `text`. Writing the DTO from
 * the columns rather than from a screen's needs is what makes the window real;
 * `localHomeProjectsApi.test.ts` asserts it at runtime as well.
 *
 * Nullability follows Drizzle exactly. `phase_id` is nullable and carries **no**
 * `references()`, so a milestone survives its phase on both backends. `due_on`
 * is nullable, which is why the window falls back to `created_at`. `done_at` is
 * the completion mark.
 *
 * This is the only table in the family with **no `updated_at` column at all** —
 * a milestone is created, then ticked off, and D1 has nowhere to record a third
 * edit. Reproduced rather than corrected: adding a column the server does not
 * have would make a locally-created milestone unrepresentable on the server.
 */
export type LocalHomeProjectMilestone = Owned & {
  id: string;
  project_id: string;
  /** Nullable, and no `references()` — a milestone outlives its phase. */
  phase_id: string | null;
  title: string;
  /** Nullable, and the field this table windows on FIRST. */
  due_on: string | null;
  done_at: string | null;
  /** `notNull` in D1, and the window's fallback. There is no `updated_at`. */
  created_at: string;
};

/**
 * `home_project_blockers` — "is that wall load-bearing?", "permits".
 *
 * **Three divergences, and the first one is the one that would have broken the
 * window silently:**
 *
 *  1. `created_at` is a `notNull` D1 column absent from the DTO, and the
 *     registry WINDOWS this table on it. `rowBucket` reads `row['created_at']`;
 *     on a row that has no such field it gets `undefined`, yields no `YYYY-MM`
 *     and falls through to always-resident. Carried, or the window is inert —
 *     §11.1.4b, which C3 met on `garden_plan_boundary_drafts` and C4 met twice.
 *  2. `resolved_at` is a D1 column the DTO does not declare, and nothing writes
 *     it. `updateBlocker` (both backends) DOES send `status` to `'resolved'`
 *     now, and deliberately leaves `resolved_at` alone — writing it in D1 only
 *     would put a fact in one household's row that a local-first household
 *     could never hold, to be read by nothing on either side. Still not carried,
 *     and still for the no-client-reader reason.
 *  3. `updated_at` — same, and not the window field, so not carried.
 *
 * `sort_order` is NOT a divergence: migration 0171 added it to D1 and to the
 * DTO together, so it arrives through `HomeProjectBlocker` like `severity`.
 *
 * `household_id` is absent from the DTO too (`& Owned`), which is counted with
 * the family rather than as a fourth divergence here.
 */
export type LocalHomeProjectBlocker = HomeProjectBlocker &
  Owned & {
    /** Divergence 1 — `notNull` in D1, and the field this table windows on. */
    created_at: string;
  };

/**
 * `home_project_attachments` — photos of the room, the quote PDF, the receipt.
 *
 * **Metadata only, exactly like `LocalContractorDocument` and
 * `LocalProjectProgressPhoto`.** The bytes never enter the ledger: `r2_key` names
 * an object in the H6 encrypted blob channel, and the three methods that move
 * bytes are throws in the facade. That split is what makes the row worth
 * ledgering at all — the filename, the kind, the before/after tag and which
 * selection it belongs to all work with no signal.
 *
 * **Six divergences, and the first is the second inert window:**
 *
 *  1. `created_at` is a `notNull` D1 column absent from the DTO, and the
 *     registry windows this table on it. Carried, for the blocker's reason
 *     above. This is the append-heavy table of the two — a project accumulates
 *     photographs for months — so the window is worth more here than anywhere
 *     else in C4 except the activity log.
 *  2. `r2_key` and `url` are D1 columns the DTO does not declare. NOT carried,
 *     and this one is a decision rather than a default: `url` is a stored
 *     absolute link that expires, which is `LedgeredHousehold.photo_url`'s
 *     hazard — per-field LWW would carry one member's dead link to every peer.
 *     `r2_key` names an object in a bucket a local-first household never writes
 *     to, so storing it would record a location that holds nothing.
 *  3. `file_size` and `caption` are D1 columns the DTO does not declare and no
 *     client reader names. Not carried.
 *  4. `created_by` is a D1 column the DTO does not declare. Not carried — no
 *     reader, and the same call C3 made on `garden_plan_objects`.
 *  5. `updated_at` — as above.
 *  6. `tags` is declared OPTIONAL (`tags?: string | null`) rather than
 *     `tags: string | null`. Every row the Worker selects carries the key (null
 *     when unset), so the optionality describes no row that has ever existed —
 *     and it matters here where it does not over HTTP: per-field LWW compares
 *     fields that are PRESENT, so a row written with the key genuinely absent
 *     and a peer's row with the key set to null are not the same row. The
 *     facade always writes the explicit null, which is C3's divergence 5 on
 *     `garden_plans` applied again.
 */
export type LocalHomeProjectAttachment = HomeProjectAttachment &
  Owned & {
    /** Divergence 1 — `notNull` in D1, and the field this table windows on. */
    created_at: string;
  };

/**
 * `home_project_plan_links` — "this project happens in this part of the floor
 * plan".
 *
 * Along with `home_projects` this is one of only two DTOs in the family that
 * mirror every D1 column, so the type adds nothing but the property scope
 * (`& Owned`).
 *
 * `floor_plan_id` points at `floor_plans`, which is LIVE (C2) — and it carries
 * **no `references()`**, so nothing cascades in either direction. Deleting a
 * floor plan leaves this pointer dangling on the server exactly as it does on the
 * ledger, which is the same shape C3 recorded on
 * `garden_plans.boundary_draft_id`. Reproduced, not repaired: repairing it
 * locally would make a project's provenance differ between a household on the
 * server and one on the ledger.
 *
 * `zone_payload` is the JSON TEXT D1 stores, not a parsed object — the DTO types
 * it `string | null` and the route stringifies on the way in, so this is the
 * opposite call to C2's `svg_data` and the same one C3 made on
 * `garden_plans.boundary_geojson`.
 */
export type LocalHomeProjectPlanLink = HomeProjectPlanLink & Owned;

/**
 * `home_project_comments` — the household talking to itself about the job.
 *
 * A full column mirror apart from the property scope, and the window field
 * (`created_at`) is on the DTO, so this is the one C4 table whose window needed
 * no rescue.
 *
 * **Nothing reads a comment back.** There is no list route, no client method and
 * no screen that renders one: posting a comment writes this row AND an activity
 * row, and the activity feed is the only trace a member ever sees. The table is
 * ledgered anyway, for the two reasons that always apply — rows written before
 * the household went local-first converge and are carried by every checkpoint,
 * export and backup — and it is the position `visitNotes`, `utilityReminders`
 * and `contractorIssueResolutions` already hold.
 *
 * `user_id` is the AUTHOR, not a member scope: unlike
 * `gardenPlanBoundaryDrafts.user_id` nothing filters on it, so a comment is the
 * household's and every member reads it.
 */
export type LocalHomeProjectComment = HomeProjectComment & Owned;

/**
 * `home_project_activity` — the append-only audit trail, and the
 * highest-cardinality table in C4 by a distance.
 *
 * Every create, update, archive, comment and link writes one of these, so a
 * year-old renovation holds hundreds. That is exactly what windowing is for, and
 * `created_at` is on the DTO, so the window is real without help.
 *
 * **One divergence:** `idempotency_key` is a D1 column the DTO does not declare.
 * `recordActivity` takes it as an optional argument and **no call site in the
 * service ever passes one**, so the dedupe branch it guards is dead code on the
 * server. Not carried, and reproducing the dedupe would be worse than useless on
 * a ledger: two members acting offline are two events, and folding them together
 * on a key nobody sets would hide one member's work from the other.
 */
export type LocalHomeProjectActivity = HomeProjectActivityItem & Owned;

// ---------------------------------------------------------------------------
// H13 D-wave — the five tables promoted out of Tier D
// ---------------------------------------------------------------------------
//
// Tier D said "server-derived: re-derived on device (H7) or the feature is
// off". H7 made the derivation local, which settles who computes these rows and
// leaves open where they live — and a recomputed-only row cannot hold a
// member's edit. Dismissing a suggestion, renaming a region: the next
// derivation overwrites both unless the row is in the ledger.
//
// Three of the five already had a DTO (`MaintenanceSuggestion`,
// `FloorPlanRegion`, `HomeProjectGeometry`); the note above the floor-plan
// block called authoring `LocalFloorPlanRegion` "the first step to registering
// it", and this is that step. The other two are DTO gaps authored here from the
// D1 columns, the same way H11 authored six.

/**
 * `maintenance_suggestions` — what the housekeeper proposes, and what the
 * member did about it. The verdict columns are the reason this is a ledger row
 * and not a recompute: `accepted`/`dismissed`/`snoozed` are member decisions.
 */
export type LocalMaintenanceSuggestion = Omit<MaintenanceSuggestion, 'feature_id'> &
  Owned & {
    /**
     * **The DTO calls this `feature_id`; D1 calls it `home_feature_id`.**
     *
     * A §3.2 divergence, and the ledger has to follow D1 rather than the DTO:
     * the ledger table IS the D1 table, and a row written under the DTO's name
     * would not match a row a server-side generation wrote under D1's. Two
     * devices would then hold the same suggestion under two different column
     * names and neither would converge.
     *
     * `localMaintenanceSuggestionsApi` maps between the two at its boundary, so
     * screens keep reading `feature_id` and nothing above the facade changes.
     */
    home_feature_id: string;
  };

/**
 * `floor_plan_regions` — the segmentation model's output over a plan.
 *
 * Scoped by `floor_plan_id`, not by a `household_id` column, exactly as B3's
 * `milestones` are scoped by their project. It inherits the parent's ledger and
 * the parent's cascade obligation: `localFloorPlansApi.delete` must drop
 * regions in the same op, because a ledger has no FK to do it.
 */
export type LocalFloorPlanRegion = FloorPlanRegion & {
  floor_plan_id: string;
  /**
   * Declared `undefined`, not omitted. The shared `rowsOf` helper filters every
   * read by `household_id` defensively, and its constraint is
   * `{ household_id?: string }` — a type with no such key at all fails TS's
   * weak-type check. Saying "this table HAS no household column" in the type is
   * both what satisfies the helper and the honest statement: the row is scoped
   * by its plan, and the filter is a no-op for it by design.
   */
  household_id?: undefined;
};

/**
 * `home_project_geometry` — scoped by `project_id`, same shape of argument as
 * `floorPlanRegions` above, and the same cascade obligation on
 * `localHomeProjectsApi.delete`.
 */
export type LocalHomeProjectGeometry = HomeProjectGeometry & {
  project_id: string;
  /** Scoped by its project — see the note on `LocalFloorPlanRegion`. */
  household_id?: undefined;
  created_at?: string | null;
  updated_at?: string | null;
};

/**
 * `contractor_recommendations` — a DTO gap. No client type existed because the
 * surface only ever read this table through a server-rendered list.
 *
 * `contractor_id` is nullable and mutually exclusive with the `external_*`
 * block: a recommendation either points at a contractor this household already
 * has, or carries an unsaved external one inline. Both halves are kept because
 * dropping the external block would silently discard every recommendation the
 * search returned for a contractor the member has not added yet.
 */
export type LocalContractorRecommendation = Owned & {
  id: string;
  task_id: string | null;
  contractor_id: string | null;
  source: string;
  external_contractor_name: string | null;
  external_contractor_phone: string | null;
  external_contractor_email: string | null;
  external_contractor_website: string | null;
  external_contractor_address: string | null;
  external_contractor_specialty: string | null;
  match_score: number | null;
  match_reasons: string | null;
  ai_analysis: string | null;
  estimated_response_time: string | null;
  viewed_at: string | null;
  dismissed_at: string | null;
  dismiss_reason: string | null;
};

/**
 * `utility_trends` — a DTO gap, and **the D-wave's only S3b table**.
 *
 * `(household_id, utility_type, year, month)` is a natural key that D1 enforces
 * and a ledger cannot: two devices computing October offline would each mint a
 * surrogate id and the LWW map would keep BOTH, so the member sees October
 * twice. It therefore needs a deterministic id in
 * `HOUSE_DETERMINISTIC_ID_TABLES` — the `goal_${year}_${month}` shape Budget
 * established — rather than a random one. `month` is nullable for the
 * year-roll-up row, which the id builder has to encode rather than drop, or the
 * annual row and January collide.
 */
export type LocalUtilityTrend = Owned & {
  id: string;
  utility_type: string;
  year: number;
  month: number | null;
  total_amount: number;
  average_amount: number | null;
  change_from_previous: number | null;
  change_percent: number | null;
  usage_total: number | null;
  usage_average: number | null;
  created_at: string | null;
};

// ---------------------------------------------------------------------------
// H13 B-wave — ten tables promoted out of Tier B
// ---------------------------------------------------------------------------
//
// All ten are DTO gaps: these surfaces only ever read through a server-rendered
// response, so no client type existed. Authored from the D1 columns, the way
// H11 authored six.
//
// Excluded from the wave and argued in `schema.ts`: the report pipeline (the
// Lambda must read the PDF), `subscriptions` (RevenueCat is the entitlement
// authority), `scheduled_notifications` (APNs infrastructure),
// `notification_history` (keyed by user, spans households) and
// `google_calendar_tokens` (per-member OAuth credentials — ledgering them would
// replicate one member's refresh token to every other member's device).

/** `assistant_briefings` — one per household per `date`. */
export type LocalAssistantBriefing = Owned & {
  id: string;
  date: string;
  composed_at: string | null;
  paragraph: string;
  bullets_json: string;
  push_message_id: string | null;
  read_at: string | null;
  empty_reason: string | null;
  source_signals_json: string;
  composed_by_model: string | null;
  prompt_version: string | null;
};

/**
 * `assistant_outbound_log` — the send-once record. `idempotency_key` is the
 * natural key that keeps two devices from logging one send as two rows.
 */
export type LocalAssistantOutboundLog = Owned & {
  id: string;
  channel: string;
  to_member_id: string | null;
  template: string;
  body: string;
  external_message_id: string | null;
  idempotency_key: string | null;
  status: string;
  trigger_ref_json: string | null;
  user_action: string | null;
  composed_by_model: string | null;
  prompt_version: string | null;
  created_at: string | null;
};

/** `assistant_trust_ledger` — keyed on `event_idempotency_key` alone. */
export type LocalAssistantTrustLedger = Owned & {
  id: string;
  occurred_at: string | null;
  category: string;
  summary: string;
  rationale: string;
  undo_token: string | null;
  related_refs_json: string | null;
  user_dismissed_at: string | null;
  event_idempotency_key: string | null;
};

/** `assistant_identity` — the household's assistant persona and quiet hours. */
export type LocalAssistantIdentity = Owned & {
  id: string;
  name: string;
  tone: string;
  pronouns: string | null;
  briefing_time: string;
  quiet_hours_start: string;
  quiet_hours_end: string;
  daily_interrupt_budget: number;
  channels_enabled_json: string | null;
  timezone: string;
  created_at: string | null;
  updated_at: string | null;
};

/**
 * `aihousekeeper_attachments` — paperwork only. The BYTES live in the H6
 * encrypted blob channel, exactly as `contractorDocuments.file_key` does.
 */
export type LocalAihousekeeperAttachment = Owned & {
  id: string;
  user_id: string | null;
  file_name: string;
  mime_type: string;
  size_bytes: number | null;
  status: string;
  kind: string | null;
  kind_hint: string | null;
  linked_entity_type: string | null;
  linked_entity_id: string | null;
  failure_reason: string | null;
  content_hash: string | null;
  created_at: string | null;
};

/**
 * `audit_log` — has `household_id`, so it is household content despite being
 * *written* per user. `ip_address` and `user_agent` are reproduced because the
 * row is a record of what happened; a device that rewrote its own audit trail
 * would not be one.
 */
export type LocalAuditLog = Owned & {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  metadata: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string | null;
};

// ---------------------------------------------------------------------------
// Neighbours (migration 0165) — the homes around this property
// ---------------------------------------------------------------------------

/**
 * `neighbours` — a HOME, flat, exactly as D1 declares it.
 *
 * The alias is `Neighbour` and not `NeighbourWithPeople` on purpose, and it is
 * the same rule every derived-collection type in this file follows: `people`,
 * `person_count`, `neighbourhood` and `distance_meters` are all DERIVED, so
 * storing them would put one fact in two rows and let per-field LWW converge
 * them to different answers. `localNeighboursApi` rebuilds all four on every
 * read, from the rows that own them.
 *
 * `distance_meters` is the one worth naming twice, because it looks storable and
 * is the worst of the four: it is a function of the PROPERTY's coordinates as
 * well as the neighbour's, so a member who corrects their own address would
 * leave every stored distance stale and no write would touch those rows.
 *
 * Two divergences from D1, both additive:
 *
 *  1. **`photo_blob`** exists in D1 nowhere at all — it is the H6 descriptor
 *     that makes the BYTES travel, and it was added to `Neighbour` itself
 *     (`src/api/neighbours.ts`) rather than bolted on here, exactly as
 *     `ApplianceDocument.blob` and `TaskPhoto.blob` were. `photo_key` still
 *     carries a value: the synthetic `lf-blob/<id>` form, so a key that is NOT
 *     bytes-on-R2 is recognisable at a glance.
 *  2. **`created_by` is absent from the DTO.** D1 has it; no screen renders it,
 *     and a neighbour is household content rather than one member's, so it is
 *     not reproduced. The same call `LocalContractorDocument` makes.
 */
export type LocalNeighbour = Neighbour & Owned;

/**
 * `neighbour_people` — an occupant of one home.
 *
 * `& Owned` even though D1 already scopes the row through its parent, because
 * the column is genuinely there: the migration denormalises `household_id` so a
 * ledger with no joins can filter to one property in a single pass. That is the
 * opposite of B3's `project_milestones`, which carries no such column and is
 * reached only THROUGH its parent.
 */
export type LocalNeighbourPerson = NeighbourPerson & Owned;

/**
 * `neighbourhoods` — a named area.
 *
 * `neighbour_count` is derived and therefore absent, for the reason above. The
 * ROW type is the plain `Neighbourhood`; `NeighbourhoodWithCount` is what a read
 * returns.
 */
export type LocalNeighbourhood = Neighbourhood & Owned;

// ---------------------------------------------------------------------------
// H11 — staged row types
// ---------------------------------------------------------------------------

/**
 * **There are none. C4 was the last sub-wave, and this section is empty.**
 *
 * While a wave was staged, this is where its row types were authored ahead of
 * activation, so `tsc` could prove each DTO existed under the name the facade
 * would import and the `& Owned` intersections could record, per table, where D1
 * scopes a row by its parent rather than by the property. Every one of those
 * types has since moved up into the block for the sub-wave that activated it.
 *
 * The heading stays rather than being deleted, for the reason `schema.ts` gives
 * for keeping `HOUSE_WAVE_B_TABLE_KEYS` as `{}`: `HouseStagedTableName` is now
 * `never`, which is the CORRECT type and not a degenerate one — it says there is
 * no such thing as a staged table, so code that tries to name one fails to
 * compile rather than compiling against a name that means nothing.
 *
 * `HOUSE_STAGED_TABLES_WITHOUT_DTO` is `[]` for the first time in the
 * programme's history. That list catches an ABSENT DTO and never could catch a
 * DTO that is present and LOSSY — C3 said so and C4 proved it twice over, with
 * two windows naming a field their DTO did not declare. The lesson is recorded
 * on `LocalHomeProjectBlocker` and `LocalHomeProjectAttachment` above rather
 * than here, because that is where the next reader will be standing.
 */
