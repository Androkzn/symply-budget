/**
 * Local `appliances` — the ledger counterpart of `src/api/appliances.ts`
 * (plan §6, Wave A). **All 9 remote methods are present and none of them
 * throws**, which has been true only since 2026-08-15.
 *
 * **The two that used to throw were `getDocuments` / `addDocument`, and the
 * header that explained why was stale.** It said the encrypted blob channel was
 * "H6 — not built". H6 shipped and is live on eight D1s; `uploadHouseBlob`,
 * `resolveHouseBlobUri`, `deleteHouseBlob` and `getHouseBlobUsage` have been
 * deployed and tested for weeks. What was actually missing was a REGISTRY entry:
 * `appliance_documents` belonged to no wave, no tier and no deferral list, so
 * there was no ledger table to write a document row into. `registryCompleteness.
 * test.ts` found that; `schema.ts` records the correction. The two methods are
 * now ordinary ledger reads and writes, exactly as B1's
 * `localContractorsApi.getContractorDocuments` / `createDocument` have been
 * since the labor hub crossed.
 *
 * **What is stored is METADATA; the bytes go through H6 separately.** That split
 * is the whole reason the table is worth ledgering, and it is B1's argument
 * repeated: the row travels in an op like any other row, while
 * `HouseAttachmentField` seals and uploads the file and hands back a
 * `HouseBlobDescriptor` the caller persists. `addDocument` therefore takes a
 * caller-supplied `r2_key` — the remote signature, unchanged — and accepts an
 * optional descriptor beside it. Without the descriptor a peer receives a
 * receipt naming an R2 object its Worker never wrote, which is Budget's
 * `localWishMedia.ts` bug one table over.
 *
 * **There is no `deleteDocument`, and that is parity rather than a gap.** The
 * remote module has none: `backend/src/routes/appliances.ts` exposes exactly two
 * document routes (`GET` and `POST` on `/:id/documents`) and
 * `appliance-service.ts` has no delete method. Adding one locally would fail
 * `apiParity.test.ts`'s `extraLocally` direction, and rightly — a screen calling
 * it would work on a local-first build and 404 everywhere else. A document
 * leaves the ledger the only way D1 lets it: with its appliance.
 *
 * **Money is stored the way the DTO carries it, not the way D1 does.** The
 * `appliances` and `appliance_service_history` columns are integer cents, but
 * `mapApplianceToResponse` divides by 100 before the client ever sees a row, and
 * the ledger rule is that a row IS the DTO (`types.ts`). So dollars are stored —
 * and every accumulation converts to cents first, which is the same fix
 * `appliance-service.ts:387` documents after it was got wrong once.
 */
// Side-effect BEFORE @symply/local-first — @noble captures globalThis.crypto at
// module load, and this module is a Proxy entry point, so it can be the first
// House module a screen pulls into the graph.
import './cryptoPolyfill';

import type { ApplianceDocument, ApplianceWarranty } from '@api/appliances';

import type { HouseBlobDescriptor } from './blobs';
import { blobKeyFor as houseBlobDocumentKey } from './blobs';
import { HouseLocalUnknownPropertyError } from './errors';
import { newLocalId } from './ids';
import { activeHouseholdId, nowIso, rowsOf, writeLocal } from './localWrite';
import type { HouseLedgerTableName } from './schema';
import type {
  LocalAppliance,
  LocalApplianceDocument,
  LocalApplianceServiceHistory,
} from './types';

/** Mirror of the module-private `CreateApplianceRequest` in `@api/appliances`. */
export type CreateLocalApplianceInput = {
  space_id?: string;
  name: string;
  category: string;
  type: string;
  location?: string;
  brand?: string;
  model?: string;
  serial_number?: string;
  purchase_date?: string;
  install_date?: string;
  expected_lifespan?: number;
  warranty?: ApplianceWarranty;
  purchase_cost?: number;
};

export type UpdateLocalApplianceInput = Partial<CreateLocalApplianceInput>;

export type AddLocalServiceHistoryInput = {
  service_date: string;
  description: string;
  cost?: number;
  provider_id?: string;
};

/**
 * Mirror of the module-private `AddDocumentRequest` in `@api/appliances`.
 *
 * `blob` is the H6 descriptor and is what makes the BYTES reach a peer. It lives
 * on the SHARED request type rather than only here — the same shape
 * `TaskPhotoSaveItem.blob` takes — so one call site compiles and behaves on both
 * paths instead of every screen branching on the flag. Optional because the
 * legacy R2 path is still a real path: a household that is not local-first has
 * an `r2_key` and no descriptor at all.
 */
export type AddLocalDocumentInput = {
  type: ApplianceDocument['type'];
  r2_key: string;
  blob?: HouseBlobDescriptor;
};

/**
 * Keys minted for bytes that live in the H6 blob channel rather than on R2.
 *
 * `r2_key` is `notNull` in D1 and required by the DTO, and a blob-backed
 * document has no R2 object to name. Rather than loosen the type (and let a
 * genuinely keyless document through by accident) the key gets its own
 * namespace: unique, stable across a re-save, and instantly recognisable as
 * "the bytes are NOT at `/files/<key>`".
 *
 * One namespace for the whole app, so a reader who has met it once recognises it
 * anywhere. It used to be RESTATED here rather than imported, because the only
 * definition lived in `@utils/taskPhotoSave` — which pulls the image picker and
 * the legacy uploader into the graph of every api call — and a test regex-scraped
 * both files to check the two literals still agreed. The definition now sits in
 * the blobs barrel beside the descriptor, so this is an ordinary re-export and
 * there is nothing left for the two copies to drift on.
 */
export { BLOB_KEY_PREFIX as HOUSE_BLOB_KEY_PREFIX } from './blobs';

/**
 * The synthetic `r2_key` for a document whose bytes went through H6.
 *
 * Re-exported for this module's importers; the document writers below use the
 * binding imported at the top of the file, because `export { x as y } from '…'`
 * publishes a name without introducing one in local scope.
 */
export { blobKeyFor as houseBlobDocumentKey } from './blobs';


/**
 * Ledger tables D1 cascades when an appliance row is deleted.
 *
 * Both halves of §11.1.1 apply here and they answer differently, which is why
 * this list exists at all rather than the delete simply filtering two arrays:
 *
 *  - **The FK half.** `appliance_service_history.appliance_id` and
 *    `appliance_documents.appliance_id` both `references(() => appliances.id,
 *    { onDelete: 'cascade' })` (`schema-maintenance.ts:129` and `:111`). A third
 *    table does too — `ai_maintenance_predictions.appliance_id`
 *    (`schema-ai-housekeeper.ts:98`) — and it is the AI Housekeeper's own
 *    forecast table, outside House's domain schema files and outside the
 *    registry, so it drops out of the guard's live filter by construction rather
 *    than by being remembered here.
 *  - **The local-tombstone half, which is the one that bites.**
 *    `appliance-service.ts:263` SOFT-deletes: it sets `deleted_at` and the row
 *    survives, so D1's cascade never actually fires on the server. The plan's
 *    pre-audit would therefore record "no cascade" — and it would be wrong about
 *    the device, because `Appliance` has no `deleted_at` on the DTO, so
 *    `delete` below removes the row outright and a ledger delete is an ABSORBING
 *    tombstone. A child left behind is an orphan forever: it syncs to every
 *    peer, no reader ever resolves its parent, and no foreign key exists to
 *    complain. **A soft server delete does not discharge the local obligation;
 *    it hides it.** C2 and C3 hit the identical shape and their facades say so.
 *
 * Named as a constant and asserted against the Drizzle sources by
 * `localAppliancesApi.test.ts`, exactly as `CONTRACTOR_CASCADE_TABLES` is —
 * because the failure mode here is precisely the one B2 shipped: the delete was
 * written when one child was live, a second child was registered later, and
 * nothing failed for a whole sub-wave.
 *
 * Neither child is itself a cascade parent, so there is no transitive pass to
 * write: nothing in `backend/src/db/**` references `appliance_service_history.id`
 * or `appliance_documents.id` at all.
 */
export const APPLIANCE_CASCADE_TABLES = [
  'applianceServiceHistory',
  // Registered 2026-08-15 — see `schema.ts`. Before that it could not be
  // cascaded at any price: an unregistered table has no ledger array to filter.
  'applianceDocuments',
] as const satisfies readonly HouseLedgerTableName[];

/**
 * Reads and writes address the ACTIVE property — `engine.ts` holds one ledger
 * per property and `mutateLocalHouseLedger` writes to whichever is active (H5,
 * plan §7). Answering another property's id out of the active ledger would list
 * the cottage's furnace under the house, so the mismatch is raised, not absorbed.
 */
function requireActiveProperty(householdId: string): string {
  const active = activeHouseholdId();
  if (householdId !== active) throw new HouseLocalUnknownPropertyError(householdId);
  return active;
}

function appliancesOf(householdId: string): LocalAppliance[] {
  requireActiveProperty(householdId);
  return rowsOf<LocalAppliance>('appliances');
}

/**
 * Every service-history path starts with `getAppliance` on the Worker, so a
 * request against a deleted appliance 404s rather than returning an empty list.
 * Same here: an empty history and a missing appliance must not look alike.
 */
function requireAppliance(householdId: string, applianceId: string): LocalAppliance {
  const appliance = appliancesOf(householdId).find((row) => row.id === applianceId);
  if (!appliance) throw new Error('Appliance not found');
  return appliance;
}

/** Cents in, dollars out — float addition of dollars drifts, cents do not. */
function addDollars(current: number | undefined, delta: number | undefined): number {
  const cents = Math.round((current ?? 0) * 100) + Math.round((delta ?? 0) * 100);
  return cents / 100;
}

/** Server order: newest first (`listAppliances` orders by `created_at` desc). */
function byNewestFirst(a: LocalAppliance, b: LocalAppliance): number {
  return b.created_at.localeCompare(a.created_at);
}

/** Server order: `upload_date` desc (`listDocuments`) — the DTO calls it `uploaded_at`. */
function byUploadedAtDesc(a: LocalApplianceDocument, b: LocalApplianceDocument): number {
  return (b.uploaded_at ?? '').localeCompare(a.uploaded_at ?? '');
}

export const localAppliancesApi = {
  list: async (householdId: string, filters?: { category?: string; space_id?: string }) => {
    const appliances = appliancesOf(householdId)
      .filter((row) => (filters?.category ? row.category === filters.category : true))
      .filter((row) => (filters?.space_id ? row.space_id === filters.space_id : true))
      .sort(byNewestFirst);
    return { appliances };
  },

  get: async (householdId: string, applianceId: string) => ({
    appliance: requireAppliance(householdId, applianceId),
  }),

  create: async (householdId: string, data: CreateLocalApplianceInput) => {
    requireActiveProperty(householdId);
    const timestamp = nowIso();
    const appliance: LocalAppliance = {
      id: newLocalId('app'),
      household_id: householdId,
      space_id: data.space_id,
      name: data.name,
      category: data.category,
      type: data.type,
      location: data.location,
      brand: data.brand,
      model: data.model,
      serial_number: data.serial_number,
      purchase_date: data.purchase_date,
      install_date: data.install_date,
      expected_lifespan: data.expected_lifespan,
      warranty: data.warranty,
      purchase_cost: data.purchase_cost,
      // Starts at zero and is only ever moved by `addServiceHistory`, exactly as
      // the Worker does — it is a running total, not a user-editable field.
      total_maintenance_cost: 0,
      created_at: timestamp,
      updated_at: timestamp,
    };
    await writeLocal(
      (draft) => {
        draft.appliances.push(appliance);
      },
      {
        opType: 'APPLIANCE_CREATE',
        entityType: 'appliance',
        entityId: appliance.id,
        payload: appliance,
      },
    );
    return { appliance };
  },

  update: async (householdId: string, applianceId: string, data: UpdateLocalApplianceInput) => {
    requireActiveProperty(householdId);
    let updated: LocalAppliance | undefined;
    await writeLocal(
      (draft) => {
        const appliance = draft.appliances.find(
          (row) => row.id === applianceId && row.household_id === householdId,
        );
        if (!appliance) throw new Error('Appliance not found');
        // `updateAppliance` treats an absent key as "leave it alone" and an
        // empty string as "clear it"; the DTO's cleared state is `undefined`
        // rather than D1's NULL.
        if (data.space_id !== undefined) appliance.space_id = data.space_id || undefined;
        if (data.name !== undefined) appliance.name = data.name;
        if (data.category !== undefined) appliance.category = data.category;
        if (data.type !== undefined) appliance.type = data.type;
        if (data.location !== undefined) appliance.location = data.location || undefined;
        if (data.brand !== undefined) appliance.brand = data.brand || undefined;
        if (data.model !== undefined) appliance.model = data.model || undefined;
        if (data.serial_number !== undefined) {
          appliance.serial_number = data.serial_number || undefined;
        }
        if (data.purchase_date !== undefined) {
          appliance.purchase_date = data.purchase_date || undefined;
        }
        if (data.install_date !== undefined) {
          appliance.install_date = data.install_date || undefined;
        }
        if (data.expected_lifespan !== undefined) {
          appliance.expected_lifespan = data.expected_lifespan || undefined;
        }
        if (data.warranty !== undefined) appliance.warranty = data.warranty;
        if (data.purchase_cost !== undefined) {
          appliance.purchase_cost = data.purchase_cost || undefined;
        }
        appliance.updated_at = nowIso();
        updated = appliance;
      },
      {
        opType: 'APPLIANCE_UPDATE',
        entityType: 'appliance',
        entityId: applianceId,
        payload: data,
      },
    );
    return { appliance: updated! };
  },

  /**
   * Every child of the appliance goes with it, in ONE op.
   *
   * The Worker leaves both child tables behind — the appliance is only
   * soft-deleted, so its foreign keys never fire and nothing dangles server-side.
   * A ledger delete is a tombstone rather than a soft delete, so orphaned
   * children would sit in the ledger forever, syncing to every peer and never
   * being read again. `APPLIANCE_CASCADE_TABLES` above names the set and argues
   * both halves; the guard test derives it from the Drizzle sources.
   *
   * **Same op, not two.** A peer that received the appliance delete without the
   * document delete would hold a warranty scan filed against an appliance it no
   * longer has — the orphan this whole mechanism exists to prevent, and the one
   * a split op reintroduces on the network rather than in the code.
   *
   * The BLOB behind each document is not touched here, deliberately. Deleting it
   * is an async filesystem-and-network operation and a ledger op must stay
   * synchronous and pure; the household's attachment quota is reclaimed by the
   * screen (or by cache eviction), never from inside a mutation. B1's
   * `deleteDocument` records the same division of labour.
   */
  delete: async (householdId: string, applianceId: string) => {
    requireActiveProperty(householdId);
    await writeLocal(
      (draft) => {
        const exists = draft.appliances.some(
          (row) => row.id === applianceId && row.household_id === householdId,
        );
        if (!exists) throw new Error('Appliance not found');
        draft.appliances = draft.appliances.filter((row) => row.id !== applianceId);
        for (const table of APPLIANCE_CASCADE_TABLES) {
          // Every row in these tables carries `appliance_id`; the cast is the
          // narrowest way to say so without widening the ledger's row types.
          const rows = draft[table] as unknown as { appliance_id: string }[];
          (draft[table] as unknown) = rows.filter((row) => row.appliance_id !== applianceId);
        }
      },
      {
        opType: 'APPLIANCE_DELETE',
        entityType: 'appliance',
        entityId: applianceId,
        payload: { id: applianceId },
      },
    );
  },

  /**
   * The appliance's paperwork. Resolves the appliance first, for the reason
   * `requireAppliance` gives: `listDocuments` on the Worker starts with
   * `getAppliance` and 404s, so an empty list and a missing appliance must not
   * look alike here either.
   *
   * Server order is `upload_date` desc. The ledger row's name for that instant
   * is `uploaded_at` — the DTO's own field, and the only date it has (see
   * `types.ts` on why the row does not also carry D1's column name) — so the
   * sort is the same order expressed in the shape the screens read.
   */
  getDocuments: async (householdId: string, applianceId: string) => {
    requireAppliance(householdId, applianceId);
    const documents = rowsOf<LocalApplianceDocument>('applianceDocuments')
      .filter((row) => row.appliance_id === applianceId)
      .sort(byUploadedAtDesc);
    return { documents };
  },

  /**
   * The metadata row. The BYTES are H6's job and have already been sealed and
   * uploaded by the time this is called — `HouseAttachmentField` hands back a
   * `HouseBlobDescriptor` and the host persists it here, which is the division
   * of labour B1's `createDocument` established.
   *
   * `r2_key` keeps the remote signature. When a descriptor is supplied the key
   * is REPLACED by the synthetic `lf-blob/<blobId>` form rather than kept
   * alongside it: two addresses for one file is the state in which a reader has
   * to guess which is real, and the descriptor is the only one a peer can act
   * on. When no descriptor is supplied the caller's key is stored untouched, so
   * a row that came from the legacy R2 path is preserved exactly.
   */
  addDocument: async (householdId: string, applianceId: string, data: AddLocalDocumentInput) => {
    requireAppliance(householdId, applianceId);
    const document: LocalApplianceDocument = {
      id: newLocalId('adc'),
      household_id: householdId,
      appliance_id: applianceId,
      type: data.type,
      r2_key: data.blob ? houseBlobDocumentKey(data.blob) : data.r2_key,
      // Never populated on either path — nothing signs an R2 URL for an
      // appliance document, and a sealed blob has no URL to sign. `types.ts`.
      url: undefined,
      uploaded_at: nowIso(),
      blob: data.blob,
    };
    await writeLocal(
      (draft) => {
        draft.applianceDocuments.push(document);
      },
      {
        opType: 'APPLIANCE_DOCUMENT_CREATE',
        entityType: 'appliance_document',
        entityId: document.id,
        payload: document,
      },
    );
    return { document };
  },

  getServiceHistory: async (householdId: string, applianceId: string) => {
    requireAppliance(householdId, applianceId);
    const history = rowsOf<LocalApplianceServiceHistory>('applianceServiceHistory')
      .filter((row) => row.appliance_id === applianceId)
      // Newest service first, as `getServiceHistory` orders it — the detail
      // screen reads the head of this list as "last serviced".
      .sort((a, b) => b.service_date.localeCompare(a.service_date));
    return { history };
  },

  /**
   * The entry and the appliance's running total move in ONE op. Two ops would
   * let a peer receive a service record whose cost is not in the total, and
   * nothing would ever reconcile it — the total is not recomputable from the
   * ledger once a history row is edited on another device.
   */
  addServiceHistory: async (
    householdId: string,
    applianceId: string,
    data: AddLocalServiceHistoryInput,
  ) => {
    requireAppliance(householdId, applianceId);
    const entry: LocalApplianceServiceHistory = {
      id: newLocalId('ash'),
      household_id: householdId,
      appliance_id: applianceId,
      service_date: data.service_date,
      description: data.description,
      cost: data.cost,
      provider_id: data.provider_id,
      // `provider_name` is only resolvable from `service_providers`, which is
      // Tier C reference data (plan §1.2) — the screen renders the id until the
      // cached catalogue can name it.
      provider_name: undefined,
      created_at: nowIso(),
    };
    await writeLocal(
      (draft) => {
        draft.applianceServiceHistory.push(entry);
        const appliance = draft.appliances.find((row) => row.id === applianceId);
        if (appliance) {
          appliance.total_maintenance_cost = addDollars(
            appliance.total_maintenance_cost,
            data.cost,
          );
          appliance.updated_at = nowIso();
        }
      },
      {
        opType: 'APPLIANCE_SERVICE_HISTORY_CREATE',
        entityType: 'appliance_service_history',
        entityId: entry.id,
        payload: entry,
      },
    );
    return { entry };
  },
};
