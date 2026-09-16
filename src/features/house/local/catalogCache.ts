/**
 * Tier C catalogues, cached on device so a local-first household reads them
 * offline (plan §1.2, H13).
 *
 * ## Why this is not the ledger, and must not become it
 *
 * Tier C is global reference data — maintenance templates, municipality
 * configs, service/utility providers, technical terms, checklist and message
 * templates. Every household sees the SAME rows; none of the tables carries a
 * `household_id` at all.
 *
 * That makes them structurally unable to live in the ledger, and the reason is
 * worth stating because "make everything local-first" reads like it should
 * include them:
 *
 *  1. **They have no household to belong to.** The engine is
 *     `Map<householdId, EngineState>` and every op is sealed under that
 *     household's HDK. A row with no `household_id` has no ledger to go in.
 *  2. **The server could never update them again.** The Worker holds ciphertext
 *     it cannot read, so once a catalogue is inside a household's ledger there
 *     is no write path back into it. Shipping a new maintenance template would
 *     reach nobody. That trades "works offline" for "frozen at install", which
 *     is a worse product, not a more local-first one.
 *  3. **They would multiply.** N households would each sync and back up a
 *     private copy of the same catalogue, forever.
 *
 * So the local-first property these tables actually need is **readable without
 * a network**, not **owned by the device** — and that is what a cache gives.
 * Budget treats its own catalogues the same way.
 *
 * ## What this guarantees
 *
 * - A read NEVER throws for want of a network. It returns cached rows, and an
 *   empty list only if the catalogue has never been fetched on this install.
 * - A successful fetch replaces the cached copy wholesale. These are
 *   catalogues, not user data: there is no merge to do and no conflict to
 *   resolve, so last-fetch-wins is correct rather than lossy.
 * - A failed fetch is NOT an error the caller has to handle. It leaves the
 *   previous copy in place and returns it, because a stale template list is
 *   overwhelmingly better than a screen that cannot render.
 * - Entries carry a fetch timestamp so a caller can decide to refresh, but
 *   staleness never blocks a read.
 *
 * Stored in MMKV rather than the SQLite ledger deliberately: the ledger file is
 * what backup, export and sync all walk, and catalogue rows have no business in
 * any of the three.
 */
import { storage } from '@services/storage';

/** Cache envelope. `fetchedAt` is advisory — staleness never blocks a read. */
type CatalogEntry<T> = {
  fetchedAt: string;
  rows: T[];
};

/**
 * Namespaced so a catalogue cannot collide with a zustand persist key. The
 * version suffix lets a shape change invalidate every cached catalogue at once
 * without a migration: a bumped prefix simply misses, and the next fetch
 * repopulates.
 */
const KEY_PREFIX = 'house.catalog.v1.';

const keyFor = (catalog: string): string => `${KEY_PREFIX}${catalog}`;

/** Read a cached catalogue. Never throws; an unreadable entry reads as empty. */
export function readCatalog<T>(catalog: string): CatalogEntry<T> | null {
  try {
    const raw = storage.getItem(keyFor(catalog));
    if (typeof raw !== 'string' || raw.length === 0) return null;
    const parsed = JSON.parse(raw) as CatalogEntry<T>;
    // A hand-edited or truncated entry must not take down a screen.
    if (!parsed || !Array.isArray(parsed.rows)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Replace a cached catalogue wholesale. Never throws. */
export function writeCatalog<T>(catalog: string, rows: T[], fetchedAt: string): void {
  try {
    storage.setItem(keyFor(catalog), JSON.stringify({ fetchedAt, rows } satisfies CatalogEntry<T>));
  } catch {
    // A full disk must not fail the fetch that triggered the write — the caller
    // already has the rows in hand and the next launch simply re-fetches.
  }
}

/**
 * The one entry point callers should use: return cached rows immediately when
 * present, and refresh from `fetch` in the background.
 *
 * `fetch` failing is not an error here. The contract is "give me the best rows
 * you have", and for a catalogue the previous copy always qualifies.
 *
 * @param catalog  cache namespace, e.g. `'maintenance_templates'`
 * @param fetch    network read; may reject freely
 * @param nowIso   injected so tests are not clock-dependent
 */
export async function loadCatalog<T>(
  catalog: string,
  fetch: () => Promise<T[]>,
  nowIso: () => string = () => new Date().toISOString(),
): Promise<T[]> {
  const cached = readCatalog<T>(catalog);

  // Nothing cached: the fetch is the only way to answer, so its failure is the
  // caller's to see — but as an empty catalogue, not a thrown error, because a
  // first launch offline must still render.
  if (!cached) {
    try {
      const rows = await fetch();
      writeCatalog(catalog, rows, nowIso());
      return rows;
    } catch {
      return [];
    }
  }

  // Cached copy exists: refresh opportunistically, but answer from cache. The
  // refresh is deliberately not awaited — a catalogue read sits on the render
  // path of screens that must stay responsive offline.
  void (async () => {
    try {
      const rows = await fetch();
      writeCatalog(catalog, rows, nowIso());
    } catch {
      // Keep the previous copy. See the header.
    }
  })();

  return cached.rows;
}

/**
 * Drop every cached catalogue. Called from local data reset / sign-out so a
 * device does not carry one account's catalogues into another's session.
 *
 * Catalogues are not secret, but they are keyed by brand and locale upstream,
 * and leaving them behind makes a reset less than a reset.
 */
export function clearAllCatalogs(): void {
  for (const catalog of KNOWN_CATALOGS) {
    try {
      storage.removeItem(keyFor(catalog));
    } catch {
      // Best effort — a key that will not clear is re-populated on next fetch.
    }
  }
}

/**
 * The Tier C catalogues this cache knows about, by physical table name.
 *
 * Kept as a named list rather than derived from `HOUSE_TIER_C_TABLES` so that
 * adding a table to Tier C does not silently imply a cache for it — the cache
 * needs a fetcher, and a name here without one would be a lie the type system
 * cannot catch.
 */
export const KNOWN_CATALOGS = [
  'maintenance_templates',
  'maintenance_task_templates',
  'municipality_configs',
  'service_providers',
  'utility_providers',
  'technical_terms',
  'checklist_templates',
  'message_templates',
] as const;

export type KnownCatalog = (typeof KNOWN_CATALOGS)[number];
