/**
 * What may leave the device in a BYOK prompt (plan §9, DoD H7 Stage B).
 *
 * **The DoD says this in so many words:** *"Stage B **egress allowlist** (ledger
 * fields that may leave the device — do not ship Budget's regex denylist as an
 * 'allowlist')"*. That instruction is the whole design, so it is worth stating
 * why.
 *
 * Budget's `redactImportText` is a denylist: three regexes for SIN-like,
 * card-like and long-numeric strings, applied to whatever text the caller
 * assembled. It **fails open** — anything the patterns do not recognise goes to
 * the provider. That is a defensible trade for Budget, where the text being sent
 * is a receipt the member just photographed and chose to import.
 *
 * House is not that. Here the context is assembled *from the encrypted ledger* —
 * the member never sees the payload, and the ledger holds their address,
 * their household members, free-text notes and maintenance history. A denylist
 * over that surface is a promise that every future column will happen to match
 * a regex, which is not a promise anyone can keep. One new column carrying a
 * phone number, a gate code or a contractor's name and it ships silently.
 *
 * So this is a **positive, field-level allowlist** that fails closed:
 *
 *  - a table not listed contributes nothing;
 *  - a field not listed is dropped, even from a listed table;
 *  - a field added to the ledger tomorrow is excluded until someone adds it here
 *    on purpose.
 *
 * Redaction still runs, but as a second layer over the already-narrow payload —
 * belt and braces, not the control itself.
 */
import type { HouseLedgerTableName } from '../schema';

/**
 * Fields that may be sent to a BYOK provider, per table.
 *
 * Each inclusion should be defensible as "the assistant genuinely cannot do its
 * job without this". Each **exclusion** below is deliberate and commented,
 * because the interesting part of an allowlist is what is missing from it.
 */
export const HOUSE_AI_EGRESS_ALLOWLIST: Partial<
  Record<HouseLedgerTableName, readonly string[]>
> = {
  /**
   * Tasks — the assistant's core subject.
   *
   * Excluded on purpose: `description` and any note body (free text, the single
   * most likely place for a gate code, a neighbour's phone number or a medical
   * detail); `assigned_to` (a member identifier); `photos` / `cover_photo_url`
   * (attachment identity); `household_id` (correlates a member across prompts).
   */
  tasks: [
    'id',
    'title',
    'system_category',
    'frequency',
    'custom_interval_days',
    'next_due_date',
    'scheduled_work_date',
    'last_completed_at',
    'is_active',
    'priority',
    'status',
  ],

  /**
   * Spaces give the assistant the shape of the home.
   *
   * Excluded: `custom_image_url`, and any free-text note attached to a space.
   */
  householdSpaces: ['id', 'name', 'space_type', 'floor', 'size_sqft'],

  /**
   * Appliances — needed for "when is this due for service".
   *
   * Excluded: `serial_number` (uniquely identifies a physical device and is a
   * theft/warranty-fraud vector), `purchase_price` (financial), `manual` /
   * document descriptors, `notes`.
   */
  appliances: [
    'id',
    'name',
    'category',
    'brand',
    'model',
    'purchase_date',
    'warranty_expires_at',
    'space_id',
  ],

  /** Service history — dates and what was done, never who or what it cost. */
  applianceServiceHistory: ['id', 'appliance_id', 'service_date', 'service_type'],

  /** Completion history is how the assistant judges whether a home is on track. */
  maintenanceCompletions: ['id', 'task_id', 'completed_at'],

  /** Garbage schedule — day-of-week patterns only, never the address. */
  garbageSchedules: ['id', 'collection_day', 'recycling_week', 'organics_day', 'municipality'],

  /** Seasonal checklists — structure, not content. */
  seasonalChecklists: ['id', 'season', 'year', 'climate_zone'],
  seasonalChecklistItems: ['id', 'checklist_id', 'title', 'completed'],

  /**
   * Home features — what the home HAS, which is what makes maintenance advice
   * specific. Excluded: anything free-text.
   */
  homeFeatures: ['id', 'feature_type', 'value'],
};

/**
 * Tables that must NEVER contribute, whatever fields they gain later.
 *
 * Listed explicitly rather than left to the "absent means excluded" rule, so
 * that adding them is a deliberate act with a review, not an oversight. The
 * omission rule already covers them; this is the belt to that's braces.
 */
export const HOUSE_AI_EGRESS_FORBIDDEN_TABLES: readonly HouseLedgerTableName[] = [
  // The property's identity: address lines, postal code, purchase price.
  'households',
  // Real people: user ids, roles, names.
  'householdMembers',
  // Unbounded free text, by definition.
  'householdNotes',
  'maintenanceTaskNotes',
  // Member preferences, some of which carry identifiers.
  'settings',
  // Drafts are half-formed text the member has not committed to.
  'taskDrafts',
  // Neighbours (0165) — all three tables, and the strongest exclusion in this
  // list. Every other forbidden table describes the MEMBER; these describe third
  // parties who never installed this app, never saw a consent screen and cannot
  // withdraw. A neighbour's name, phone number and the coordinates of their
  // front door are exactly the payload that must never reach a provider, and
  // "the member connected their own key" is not that person's consent.
  //
  // Being absent from the allowlist would already fail closed (`projectAllowedRows`
  // returns `[]` for an unlisted table). They are named here anyway, because a
  // future contributor adding "just the labels, for context" has to delete a
  // line with this comment on it rather than simply add one.
  'neighbours',
  'neighbourPeople',
  'neighbourhoods',
];

export type HouseAiContextRow = Record<string, unknown>;

/**
 * Project a ledger table down to the fields allowed to leave the device.
 *
 * Returns `[]` for any table that is forbidden or simply not listed — the
 * fail-closed default. `null` and `undefined` values are dropped rather than
 * sent, since an explicit null tells a provider nothing and still costs tokens.
 */
export function projectAllowedRows(
  table: HouseLedgerTableName,
  rows: ReadonlyArray<Record<string, unknown>>,
): HouseAiContextRow[] {
  if (HOUSE_AI_EGRESS_FORBIDDEN_TABLES.includes(table)) return [];
  const allowed = HOUSE_AI_EGRESS_ALLOWLIST[table];
  if (!allowed || allowed.length === 0) return [];

  return rows.map((row) => {
    const out: HouseAiContextRow = {};
    for (const field of allowed) {
      const value = row[field];
      if (value === null || value === undefined) continue;
      out[field] = value;
    }
    return out;
  });
}

/** Is this table allowed to contribute anything at all? */
export function isTableAllowedForEgress(table: HouseLedgerTableName): boolean {
  if (HOUSE_AI_EGRESS_FORBIDDEN_TABLES.includes(table)) return false;
  const allowed = HOUSE_AI_EGRESS_ALLOWLIST[table];
  return !!allowed && allowed.length > 0;
}

/**
 * Second-layer scrub over the already-narrowed payload.
 *
 * Deliberately NOT the primary control — see the header. It exists to catch a
 * value that slipped through an allowed field (a member typing their phone
 * number into a task title, which they do), not to make an unbounded payload
 * safe.
 */
const REDACTION_PATTERNS: ReadonlyArray<RegExp> = [
  /\b\d{3}[-\s]?\d{3}[-\s]?\d{3}\b/g, // SIN-like
  /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, // card-like
  /\b\d{9,12}\b/g, // long account numbers
  /\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b/g, // email
  /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, // NANP phone
];

export function redactForEgress(text: string): string {
  let out = text;
  for (const pattern of REDACTION_PATTERNS) {
    out = out.replace(pattern, '[redacted]');
  }
  return out;
}

/** Apply the scrub to every string in a projected context, at any depth. */
export function redactContext<T>(value: T): T {
  if (typeof value === 'string') return redactForEgress(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactContext(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactContext(v);
    return out as unknown as T;
  }
  return value;
}
