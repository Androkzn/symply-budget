/**
 * Local `visit_checklists` — the ledger counterpart of
 * `src/api/visit-checklists.ts` (plan §11, sub-wave B4).
 *
 * **The largest facade in the programme: 26 methods over three tables.** It is
 * also the one whose subject matter is most obviously offline — the whole point
 * of a visit checklist is that a member is holding their phone in a crawlspace
 * with a contractor talking at them. Every question, tick, comment, photo and
 * reorder on that screen is a ledger write here.
 *
 * **This module owns the LABOR-HUB `checklist_items`, not the recurring one.**
 * Two different Drizzle tables share that physical name — `schema-checklists.ts`
 * (the household's weekly chore lists, Wave A, owned by `localChecklistsApi`)
 * and `schema-labor-hub.ts` (this one) — which is hazard S1 and the reason the
 * registry calls this table `visitChecklistItems`. Both DTOs are even called
 * `ChecklistItem`, so `types.ts` imports one under an alias. Nothing but the
 * ledger name keeps them apart; a facade that reached for `recurringChecklistItems`
 * here would compile, run, and merge two unrelated features.
 *
 * ## The delete path is the hard part, and it is a two-hop chain
 *
 * D1 cascades `checklist_items` from `visit_checklists`, and
 * `checklist_item_photos` from `checklist_items`. A ledger delete is a tombstone
 * rather than a foreign key, so both hops have to be performed by hand — and in
 * ONE op, because a peer that applied the first hop without the second would
 * hold photos belonging to an item belonging to a checklist that no longer
 * exists. `delete` walks checklist → items → photos; `deleteItem` walks the
 * second hop alone. This is the only cascade chain in the programme that lives
 * entirely inside a single facade, which is exactly why it is easy to get wrong:
 * there is no other module to notice.
 *
 * `visit-checklist-service.ts:247` HARD-deletes both tables (no `deleted_at`
 * anywhere in this family), so the cascade genuinely fires server-side — unlike
 * `tasks` and `appliances`, which soft-delete and whose children are therefore
 * correctly left alone by their facades. See plan §11.1.1.
 *
 * ## Four remote-only methods, three throws, nineteen local
 *
 * **Remote by design (Tier C):** `getTemplates`, `getTemplatesByCategory`,
 * `getTemplate` and `getTechnicalTerm`. `checklist_templates` and
 * `technical_terms` are both named in `HOUSE_TIER_C_TABLES` — global reference
 * data, identical for every household, fetched and cached and never ledgered.
 * They carry no household data, so reading them from the Worker leaks nothing,
 * and this is the same call `garbageCollectionApi.getMunicipalities` makes.
 *
 * **Thrown (P4):** `startAIConversation`, `sendAIMessage` and
 * `generateAISuggestions` each need a server that can read the household's task
 * details and run a model over them. Under E2EE the Worker holds ciphertext.
 *
 * **Thrown (Tier C write path):** `createFromTemplate`, and it is the one
 * genuinely awkward decision in this sub-wave. It READS a Tier C template and
 * WRITES household rows, so neither answer is clean: routing it to the server
 * would write a checklist into a D1 household that has no data, and running it
 * locally would need the template catalogue, which is not on the device and
 * cannot be fetched from inside a write that has to survive a basement. It
 * throws with copy that names the real limit, and `create` + `addItem` still
 * build the same checklist by hand. Revisit if the catalogue is ever seeded
 * locally the way `defaults.ts` seeds Wave A.
 *
 * ## What is NOT a gap, and was expected to be
 *
 * `addVoiceNote`, `addPhoto`, `getPhotos` and `deletePhoto` are all LOCAL. The
 * brief for this sub-wave expected them to throw as H6 blob surfaces, and the
 * table names (`checklist_item_photos`, `voice_note_key`) invite that reading —
 * but B1 settled the principle on `contractorDocuments` and B3 confirmed it on
 * `project_progress_photos`: **the row is metadata, and only the bytes need the
 * channel.** Every one of these methods takes a key the caller already holds and
 * writes a row; `visitChecklistsApi` has no upload method and no URL builder at
 * all, so nothing here reaches R2. Making them throw would have ledgered
 * `checklistItemPhotos` — one of the seven tables this sub-wave activates — and
 * then given it no way to be read or written, which is the opposite of
 * activating it.
 *
 * ## Composed shapes are rebuilt on read
 *
 * `ChecklistWithItems` embeds `items`; `getChecklistsForTask` embeds the visit,
 * the contractor and two counts; `getMultiContractorComparison` embeds all of
 * that plus the quote and the "key responses". None of it is stored. That is
 * rule 1 in `types.ts` — a derived collection with two homes in the ledger
 * converges to two different answers under per-field LWW.
 *
 * **No bulk path.** Every write is one row plus its cascade. The one method that
 * looks like a bulk write, `reorderItems`, mutates rows already in the ledger
 * rather than inserting any, so it is one op regardless of list length.
 */
// Side-effect BEFORE @symply/local-first — @noble captures globalThis.crypto at
// module load, and this module is a Proxy entry point, so it can be the first
// House module a screen pulls into the graph.
import './cryptoPolyfill';

import type { ChecklistItem, ChecklistPriority, ChecklistWithItems } from '@api/visit-checklists';

import { HouseLocalUnknownPropertyError, HouseLocalUnsupportedError } from './errors';
import { newLocalId } from './ids';
import { activeHouseholdId, nowIso, rowsOf, writeLocal } from './localWrite';
import type {
  LocalChecklistItemPhoto,
  LocalContractor,
  LocalContractorQuote,
  LocalContractorVisit,
  LocalTask,
  LocalVisitChecklist,
  LocalVisitChecklistItem,
} from './types';

// ---------------------------------------------------------------------------
// Input shapes — mirrors of the module-private request types in
// `src/api/visit-checklists.ts`. They are not exported there, so they are
// restated rather than imported; `apiParity.test.ts` catches a method that
// disappears and `tsc` catches a field whose type changed on the DTO.
// ---------------------------------------------------------------------------

export type CreateLocalChecklistInput = {
  title: string;
  appointment_id?: string;
  visit_id?: string;
  template_id?: string;
};

export type UpdateLocalChecklistInput = {
  title?: string;
  appointment_id?: string;
  visit_id?: string;
};

export type CreateLocalChecklistFromTemplateInput = {
  appointment_id?: string;
  visit_id?: string;
};

export type AddLocalChecklistItemInput = {
  text: string;
  has_info_icon?: boolean;
  technical_term?: string;
  category?: string;
  priority?: ChecklistPriority;
};

export type UpdateLocalChecklistItemInput = {
  text?: string;
  has_info_icon?: boolean;
  technical_term?: string;
  category?: string;
  priority?: ChecklistPriority;
  comment?: string;
  sort_order?: number;
};

export type ReorderLocalChecklistItemsInput = { item_order: string[] };

export type AddLocalChecklistPhotoInput = {
  photo_key: string;
  thumbnail_key?: string;
  caption?: string;
  taken_at?: string;
  file_size?: number;
  mime_type?: string;
  width?: number;
  height?: number;
};

export type GenerateLocalAISuggestionsInput = {
  task_id?: string;
  task_category?: string;
  task_title?: string;
  task_description?: string;
  contractor_specialty?: string;
  visit_purpose?: string;
  image_descriptions?: string[];
};

export type StartLocalAIConversationInput = {
  technical_term: string;
  checklist_item_id?: string;
  context?: Record<string, unknown>;
};

function requireActiveProperty(householdId: string): string {
  const active = activeHouseholdId();
  if (householdId !== active) throw new HouseLocalUnknownPropertyError(householdId);
  return active;
}

function checklistsOf(householdId: string): LocalVisitChecklist[] {
  requireActiveProperty(householdId);
  return rowsOf<LocalVisitChecklist>('visitChecklists');
}

function itemsOf(householdId: string): LocalVisitChecklistItem[] {
  requireActiveProperty(householdId);
  return rowsOf<LocalVisitChecklistItem>('visitChecklistItems');
}

function photosOf(householdId: string): LocalChecklistItemPhoto[] {
  requireActiveProperty(householdId);
  return rowsOf<LocalChecklistItemPhoto>('checklistItemPhotos');
}

/** Server order: `created_at` asc (`getChecklists`). */
function byCreatedAtAsc(a: { created_at: string }, b: { created_at: string }): number {
  return a.created_at.localeCompare(b.created_at);
}

/** Server order: `created_at` desc (`getChecklistsForTask`). */
function byCreatedAtDesc(a: { created_at: string }, b: { created_at: string }): number {
  return b.created_at.localeCompare(a.created_at);
}

/**
 * Items come back ordered by `sort_order` — the member's own ordering of the
 * questions, and the only ordering the checklist screen renders.
 *
 * `sort_order` is `.default(0)` WITHOUT `.notNull()` in D1, so the DTO's
 * `number` can still arrive as null over sync from a row the server wrote.
 * `?? 0` keeps the comparator total rather than letting one null scatter the
 * list — the same guard `localProjectsApi.bySortOrder` needs.
 */
function bySortOrder(a: LocalVisitChecklistItem, b: LocalVisitChecklistItem): number {
  return (a.sort_order ?? 0) - (b.sort_order ?? 0);
}

/** The `items` join, rebuilt on every read. */
function withItems(
  checklist: LocalVisitChecklist,
  items: readonly LocalVisitChecklistItem[],
): ChecklistWithItems {
  return {
    ...checklist,
    items: items.filter((row) => row.checklist_id === checklist.id).sort(bySortOrder),
  };
}

function requireChecklist(householdId: string, checklistId: string): LocalVisitChecklist {
  const found = checklistsOf(householdId).find((row) => row.id === checklistId);
  if (!found) throw new Error('Checklist not found');
  return found;
}

/**
 * Item lookup, scoped to its checklist — `visit-checklist-service.ts` filters on
 * `(id, checklist_id)` for `updateItem`, `deleteItem`, `checkItem` and
 * `addVoiceNoteToItem`, so an item id from another checklist is a 404 and not a
 * silent cross-checklist edit.
 */
function requireItem(
  householdId: string,
  checklistId: string,
  itemId: string,
): LocalVisitChecklistItem {
  const found = itemsOf(householdId).find(
    (row) => row.id === itemId && row.checklist_id === checklistId,
  );
  if (!found) throw new Error('Item not found');
  return found;
}

/**
 * One place builds a checklist's answer, so `create`, `update`, `reorderItems`
 * and every read return the identical shape. Re-reading after a write rather
 * than composing from the in-flight row is deliberate: it is the only way the
 * embedded `items` reflect a cascade the write may have performed.
 */
function detail(householdId: string, checklistId: string): { checklist: ChecklistWithItems } {
  const checklist = requireChecklist(householdId, checklistId);
  return { checklist: withItems(checklist, itemsOf(householdId)) };
}

/**
 * `updated_at` on the parent, stamped by every item write.
 *
 * The Worker does this after `addItem`, `updateItem`, `deleteItem`, `checkItem`,
 * `addVoiceNoteToItem` and `reorderItems` — six separate `update visitChecklists
 * set updated_at` calls. Reproduced because the checklist list is what a member
 * sees first and "last touched" is how they find the one they were working on;
 * a local tick that did not move the timestamp would sort the active checklist
 * to the bottom.
 */
function touchChecklist(
  checklists: LocalVisitChecklist[],
  checklistId: string,
  timestamp: string,
): void {
  const parent = checklists.find((row) => row.id === checklistId);
  if (parent) parent.updated_at = timestamp;
}

export const localVisitChecklistsApi = {
  // ---- checklists ---------------------------------------------------------

  /** `GET /visit-checklists` — `VisitChecklistService.getChecklists`. */
  getAll: async (householdId: string) => {
    const items = itemsOf(householdId);
    const checklists = checklistsOf(householdId)
      .sort(byCreatedAtAsc)
      .map((row) => withItems(row, items));
    return { checklists };
  },

  getOne: async (householdId: string, checklistId: string) => detail(householdId, checklistId),

  create: async (householdId: string, data: CreateLocalChecklistInput) => {
    requireActiveProperty(householdId);
    const timestamp = nowIso();
    const checklist: LocalVisitChecklist = {
      // Random id: `visit_checklists` carries no `uniqueIndex` in D1, and two
      // members preparing two checklists for the same visit offline have made
      // two checklists. A deterministic id would merge questions they meant to
      // ask separately.
      id: newLocalId('vcl'),
      household_id: householdId,
      appointment_id: data.appointment_id || null,
      visit_id: data.visit_id || null,
      title: data.title,
      template_id: data.template_id || null,
      // Not settable through the remote create either — `contractor_specialty`
      // and `task_id` are written by the AI path, and `ai_generation_context`
      // only by the generation run that cannot happen on device.
      contractor_specialty: null,
      task_id: null,
      // D1 defaults this to `'manual'`; the route does not pass it, so the
      // column default is what a server row gets. A ledger row is inserted by
      // the device, so the device has to write the default itself.
      source: 'manual',
      ai_generation_context: null,
      created_at: timestamp,
      updated_at: timestamp,
    };
    await writeLocal(
      (draft) => {
        draft.visitChecklists.push(checklist);
      },
      {
        opType: 'VISIT_CHECKLIST_CREATE',
        entityType: 'visit_checklist',
        entityId: checklist.id,
        payload: checklist,
      },
    );
    return detail(householdId, checklist.id);
  },

  /**
   * Tier C meets Tier A, and the device can only do half of it.
   *
   * `checklist_templates` is global reference data (`HOUSE_TIER_C_TABLES`) that
   * is never ledgered — `getTemplates` below reads it straight from the Worker,
   * which is safe because a template is the same for every household and
   * contains nothing of theirs. But this method turns one into a checklist AND
   * a row per template item, inside the household's own data.
   *
   * Routing it remotely would write those rows into a D1 household that this
   * member no longer uses; running it locally would need the catalogue, which is
   * not on the device. Throwing is the honest third answer, and the copy says
   * what still works: `create` plus `addItem` build the same checklist by hand.
   *
   * Present-and-throwing rather than absent, per the coverage rule — a missing
   * key routes to the Worker, which would answer 201 with a checklist the member
   * would never see again.
   */
  createFromTemplate: async (
    _householdId: string,
    _templateId: string,
    _data: CreateLocalChecklistFromTemplateInput,
  ) => {
    throw new HouseLocalUnsupportedError('visitChecklistsApi.createFromTemplate');
  },

  /**
   * `PATCH /visit-checklists/:id`.
   *
   * Field semantics are `updateChecklist`'s, and they are the LOOSE kind: the
   * Worker writes `updateData.appointment_id = input.appointmentId` with no
   * `|| null`, so clearing a link means sending an empty string and getting one
   * back. Reproduced rather than tidied, so a checklist edited offline and one
   * edited online are byte-identical — the same call `localProjectsApi` makes
   * about `project-service.ts`.
   */
  update: async (householdId: string, checklistId: string, data: UpdateLocalChecklistInput) => {
    requireChecklist(householdId, checklistId);
    await writeLocal(
      (draft) => {
        const checklist = draft.visitChecklists.find(
          (row) => row.id === checklistId && row.household_id === householdId,
        );
        if (!checklist) throw new Error('Checklist not found');
        if (data.title !== undefined) checklist.title = data.title;
        if (data.appointment_id !== undefined) checklist.appointment_id = data.appointment_id;
        if (data.visit_id !== undefined) checklist.visit_id = data.visit_id;
        checklist.updated_at = nowIso();
      },
      {
        opType: 'VISIT_CHECKLIST_UPDATE',
        entityType: 'visit_checklist',
        entityId: checklistId,
        payload: data,
      },
    );
    return detail(householdId, checklistId);
  },

  /**
   * `DELETE /visit-checklists/:id` — the checklist, its items AND their photos,
   * in ONE op.
   *
   * Two hops, and the second is the one a reader has to go looking for.
   * `visit-checklist-service.ts:247` deletes the items explicitly and lets D1
   * cascade the photos from them; on device there is no foreign key to do that,
   * so a photo whose item was dropped would sit in the ledger forever, syncing
   * to every peer and never being read. The photos are found through the ITEMS,
   * not through the checklist — `checklist_item_photos` has no `checklist_id`
   * column — which is why the item ids are captured before the filter drops
   * them.
   *
   * ONE op rather than three is the other half. `mutateLocalHouseLedger` diffs
   * the whole ledger per call, so three writes would be three ops a peer applies
   * one at a time, and between the first and the last that peer holds photos
   * belonging to a checklist that no longer exists.
   */
  delete: async (householdId: string, checklistId: string) => {
    requireActiveProperty(householdId);
    await writeLocal(
      (draft) => {
        const exists = draft.visitChecklists.some(
          (row) => row.id === checklistId && row.household_id === householdId,
        );
        if (!exists) throw new Error('Checklist not found');
        draft.visitChecklists = draft.visitChecklists.filter((row) => row.id !== checklistId);

        // Hop 1, capturing the ids hop 2 needs before they are gone.
        const doomedItems = new Set(
          draft.visitChecklistItems
            .filter((row) => row.checklist_id === checklistId)
            .map((row) => row.id),
        );
        draft.visitChecklistItems = draft.visitChecklistItems.filter(
          (row) => row.checklist_id !== checklistId,
        );

        // Hop 2.
        draft.checklistItemPhotos = draft.checklistItemPhotos.filter(
          (row) => !doomedItems.has(row.checklist_item_id),
        );
      },
      {
        opType: 'VISIT_CHECKLIST_DELETE',
        entityType: 'visit_checklist',
        entityId: checklistId,
        payload: { id: checklistId },
      },
    );
  },

  // ---- items --------------------------------------------------------------

  /**
   * `POST /visit-checklists/:id/items`.
   *
   * `sort_order` is `max(existing) + 1`, computed the Worker's way — a reduce
   * seeded at 0 over the checklist's own items, so the first question is 1 and
   * not 0.
   *
   * Two members adding a question offline both compute the same next order and
   * converge on two rows sharing it. That is the RIGHT outcome and the reason
   * this table has no deterministic id: they are two different questions, and
   * `bySortOrder` is a stable sort, so both render in insertion order rather
   * than one overwriting the other.
   */
  addItem: async (householdId: string, checklistId: string, data: AddLocalChecklistItemInput) => {
    requireChecklist(householdId, checklistId);
    const siblings = itemsOf(householdId).filter((row) => row.checklist_id === checklistId);
    const maxOrder = siblings.reduce((max, row) => Math.max(max, row.sort_order ?? 0), 0);
    const timestamp = nowIso();

    const item: LocalVisitChecklistItem = {
      id: newLocalId('vci'),
      // D1 scopes an item by its checklist alone; H5 puts several properties on
      // one device, so the ledger row carries the property too (`& Owned`).
      household_id: householdId,
      checklist_id: checklistId,
      text: data.text,
      checked: false,
      checked_at: null,
      comment: null,
      // Named in the DTO because the ROW is ledgered; the bytes behind it live
      // in the H6 blob channel. `addVoiceNote` fills this in later.
      voice_note_key: null,
      voice_note_transcription: null,
      has_info_icon: data.has_info_icon ?? false,
      technical_term: data.technical_term || null,
      category: data.category || null,
      priority: data.priority || 'must_ask',
      sort_order: maxOrder + 1,
      // The AI-suggestion block is stored, not dropped: an item suggested by the
      // server before the household went local-first still has to render its
      // confidence badge, and the column is a plain scalar the ledger carries.
      // What the device cannot do is RUN the suggestion — that is the throw
      // site, not the row.
      source: 'manual',
      ai_confidence: null,
      suggested_at: null,
      accepted_at: null,
      dismissed_at: null,
      created_at: timestamp,
    };

    await writeLocal(
      (draft) => {
        draft.visitChecklistItems.push(item);
        touchChecklist(draft.visitChecklists, checklistId, timestamp);
      },
      {
        opType: 'VISIT_CHECKLIST_ITEM_CREATE',
        entityType: 'visit_checklist_item',
        entityId: item.id,
        payload: item,
      },
    );
    return { item: item as ChecklistItem };
  },

  /**
   * `PATCH /visit-checklists/:id/items/:itemId`.
   *
   * `updateItem`'s field semantics again, loose: `technical_term`, `category`
   * and `comment` are written through with no `|| null`, so an empty string is
   * stored as an empty string. Note this differs from `addItem` above, which
   * DOES coalesce — that asymmetry is the Worker's, and reproducing it is what
   * keeps the two backends byte-identical.
   */
  updateItem: async (
    householdId: string,
    checklistId: string,
    itemId: string,
    data: UpdateLocalChecklistItemInput,
  ) => {
    requireChecklist(householdId, checklistId);
    requireItem(householdId, checklistId, itemId);
    await writeLocal(
      (draft) => {
        const item = draft.visitChecklistItems.find((row) => row.id === itemId);
        if (!item) throw new Error('Item not found');
        if (data.text !== undefined) item.text = data.text;
        if (data.has_info_icon !== undefined) item.has_info_icon = data.has_info_icon;
        if (data.technical_term !== undefined) item.technical_term = data.technical_term;
        if (data.category !== undefined) item.category = data.category;
        if (data.priority !== undefined) item.priority = data.priority;
        if (data.comment !== undefined) item.comment = data.comment;
        if (data.sort_order !== undefined) item.sort_order = data.sort_order;
        // No `updated_at` — `checklist_items` has no such column, and adding one
        // on the ledger row would put a field in the op log that D1 cannot hold.
        // The PARENT's timestamp moves instead, which is what the Worker does.
        touchChecklist(draft.visitChecklists, checklistId, nowIso());
      },
      {
        opType: 'VISIT_CHECKLIST_ITEM_UPDATE',
        entityType: 'visit_checklist_item',
        entityId: itemId,
        payload: data,
      },
    );
    return { item: requireItem(householdId, checklistId, itemId) as ChecklistItem };
  },

  /**
   * The second hop of the cascade chain, on its own: an item's photos go with
   * it, in the SAME op.
   *
   * D1 declares `checklist_item_photos.checklist_item_id` with
   * `onDelete: 'cascade'` and the Worker relies on it — `deleteItem` issues one
   * DELETE and lets the database do the rest. There is no database here.
   */
  deleteItem: async (householdId: string, checklistId: string, itemId: string) => {
    requireChecklist(householdId, checklistId);
    requireItem(householdId, checklistId, itemId);
    await writeLocal(
      (draft) => {
        draft.visitChecklistItems = draft.visitChecklistItems.filter((row) => row.id !== itemId);
        draft.checklistItemPhotos = draft.checklistItemPhotos.filter(
          (row) => row.checklist_item_id !== itemId,
        );
        touchChecklist(draft.visitChecklists, checklistId, nowIso());
      },
      {
        opType: 'VISIT_CHECKLIST_ITEM_DELETE',
        entityType: 'visit_checklist_item',
        entityId: itemId,
        payload: { id: itemId },
      },
    );
  },

  /**
   * `PUT /items/:itemId/check` — the single most offline write in House.
   *
   * `checked_at` is stamped on tick and CLEARED on untick, exactly as
   * `checkItem` does. Both members ticking the same question converge under
   * per-field LWW to one answer, which is correct: the question was asked.
   */
  checkItem: async (
    householdId: string,
    checklistId: string,
    itemId: string,
    checked: boolean,
  ) => {
    requireChecklist(householdId, checklistId);
    requireItem(householdId, checklistId, itemId);
    const timestamp = nowIso();
    await writeLocal(
      (draft) => {
        const item = draft.visitChecklistItems.find((row) => row.id === itemId);
        if (!item) throw new Error('Item not found');
        item.checked = checked;
        item.checked_at = checked ? timestamp : null;
        touchChecklist(draft.visitChecklists, checklistId, timestamp);
      },
      {
        opType: 'VISIT_CHECKLIST_ITEM_CHECK',
        entityType: 'visit_checklist_item',
        entityId: itemId,
        payload: { id: itemId, checked },
      },
    );
    return { item: requireItem(householdId, checklistId, itemId) as ChecklistItem };
  },

  /**
   * `POST /items/:itemId/voice-note` — the KEY, not the audio.
   *
   * Local rather than thrown, and worth stating because "voice note" sounds like
   * a transfer. It is not one: the method takes a key the caller already holds
   * and writes it to a column, exactly as `contractorsApi.createDocument` and
   * `projectsApi.addProgressPhoto` do. The recording itself moves through the H6
   * blob channel; this records that it exists, which is what makes the
   * transcription, the question it answers and the ordering all work offline.
   */
  addVoiceNote: async (
    householdId: string,
    checklistId: string,
    itemId: string,
    voiceNoteKey: string,
  ) => {
    requireChecklist(householdId, checklistId);
    requireItem(householdId, checklistId, itemId);
    await writeLocal(
      (draft) => {
        const item = draft.visitChecklistItems.find((row) => row.id === itemId);
        if (!item) throw new Error('Item not found');
        item.voice_note_key = voiceNoteKey;
        touchChecklist(draft.visitChecklists, checklistId, nowIso());
      },
      {
        opType: 'VISIT_CHECKLIST_ITEM_VOICE_NOTE',
        entityType: 'visit_checklist_item',
        entityId: itemId,
        payload: { id: itemId, voice_note_key: voiceNoteKey },
      },
    );
    return { item: requireItem(householdId, checklistId, itemId) as ChecklistItem };
  },

  /**
   * `PUT /visit-checklists/:id/reorder`.
   *
   * `sort_order` becomes the index in `item_order`, starting at 0 — note that
   * `addItem` starts at 1, so the first reorder renumbers the whole list. That
   * is the Worker's behaviour and is reproduced rather than harmonised.
   *
   * Ids that do not belong to this checklist are ignored, because the Worker's
   * `where` is `and(id, checklist_id)` and simply matches nothing. All of it in
   * ONE op: a peer receiving half a reorder would render the list in an order no
   * member chose.
   */
  reorderItems: async (
    householdId: string,
    checklistId: string,
    data: ReorderLocalChecklistItemsInput,
  ) => {
    requireChecklist(householdId, checklistId);
    await writeLocal(
      (draft) => {
        data.item_order.forEach((id, index) => {
          const item = draft.visitChecklistItems.find(
            (row) => row.id === id && row.checklist_id === checklistId,
          );
          if (item) item.sort_order = index;
        });
        touchChecklist(draft.visitChecklists, checklistId, nowIso());
      },
      {
        opType: 'VISIT_CHECKLIST_REORDER',
        entityType: 'visit_checklist',
        entityId: checklistId,
        payload: { id: checklistId, item_order: data.item_order },
      },
    );
    return detail(householdId, checklistId);
  },

  // ---- AI suggestions -----------------------------------------------------

  /**
   * P4 — generating the questions needs a server that can read the task, the
   * category and any photo descriptions, and then run a model over them. Under
   * E2EE the Worker holds ciphertext, so there is nothing for it to read.
   *
   * Note what is NOT disabled: an item that ALREADY carries `source:
   * 'ai_suggested'` — because the server suggested it before the household went
   * local-first, or because a peer on another build did — renders, sorts,
   * accepts and dismisses like any other. Only the generation run is off.
   */
  generateAISuggestions: async (
    _householdId: string,
    _checklistId: string,
    _data: GenerateLocalAISuggestionsInput,
  ) => {
    throw new HouseLocalUnsupportedError('visitChecklistsApi.generateAISuggestions');
  },

  /**
   * `POST /items/:itemId/accept` — a plain ledger write, despite the name.
   *
   * Accepting a suggestion stamps `accepted_at` and flips `source` to
   * `'manual'`, which is the Worker's own behaviour: once a member has said yes,
   * the question is theirs. No model runs.
   *
   * The Worker does NOT scope this by checklist (`_checklistId` is unused in
   * `acceptAISuggestion`) and this does not either, so the two backends 404 on
   * the same inputs. Scoping it here would be tidier and would make an id that
   * works online fail offline.
   */
  acceptAISuggestion: async (householdId: string, _checklistId: string, itemId: string) => {
    requireActiveProperty(householdId);
    const timestamp = nowIso();
    await writeLocal(
      (draft) => {
        const item = draft.visitChecklistItems.find(
          (row) => row.id === itemId && row.household_id === householdId,
        );
        if (!item) throw new Error('Item not found');
        item.accepted_at = timestamp;
        item.source = 'manual';
        touchChecklist(draft.visitChecklists, item.checklist_id, timestamp);
      },
      {
        opType: 'VISIT_CHECKLIST_ITEM_ACCEPT',
        entityType: 'visit_checklist_item',
        entityId: itemId,
        payload: { id: itemId },
      },
    );
    const item = itemsOf(householdId).find((row) => row.id === itemId);
    if (!item) throw new Error('Item not found');
    return { item: item as ChecklistItem };
  },

  /**
   * `POST /items/:itemId/dismiss` — stamps `dismissed_at` and nothing else.
   *
   * The row SURVIVES a dismissal; it is filtered out of the counts by
   * `getChecklistsForTask` and `getMultiContractorComparison` instead. Deleting
   * it would be the tempting simplification and would lose the member's "no,
   * not that one" the next time suggestions run.
   */
  dismissAISuggestion: async (householdId: string, _checklistId: string, itemId: string) => {
    requireActiveProperty(householdId);
    const timestamp = nowIso();
    await writeLocal(
      (draft) => {
        const item = draft.visitChecklistItems.find(
          (row) => row.id === itemId && row.household_id === householdId,
        );
        if (!item) throw new Error('Item not found');
        item.dismissed_at = timestamp;
        touchChecklist(draft.visitChecklists, item.checklist_id, timestamp);
      },
      {
        opType: 'VISIT_CHECKLIST_ITEM_DISMISS',
        entityType: 'visit_checklist_item',
        entityId: itemId,
        payload: { id: itemId },
      },
    );
  },

  // ---- AI info conversations ----------------------------------------------

  /**
   * P4 — "what is an AFCI breaker?" answered by a model, grounded in the
   * household's own context. `ai_info_conversations` is not ledgered at all
   * (it is neither Tier A nor registered), because the conversation IS the model
   * output and there is nothing to converge.
   */
  startAIConversation: async (_householdId: string, _data: StartLocalAIConversationInput) => {
    throw new HouseLocalUnsupportedError('visitChecklistsApi.startAIConversation');
  },

  /** P4 — the same conversation, one turn later. */
  sendAIMessage: async (
    _householdId: string,
    _conversationId: string,
    _data: { content: string },
  ) => {
    throw new HouseLocalUnsupportedError('visitChecklistsApi.sendAIMessage');
  },

  // ---- photos -------------------------------------------------------------

  /**
   * `POST /items/:itemId/photos` — the metadata ROW, not the pixels.
   *
   * The B1/B3 split, applied a third time: `photo_key` and `thumbnail_key` name
   * objects in the encrypted blob channel (H6), and this method records that
   * they exist along with the caption, the dimensions and when the picture was
   * taken. `visitChecklistsApi` has no upload method at all, so there is nothing
   * here that reaches R2.
   *
   * `taken_at` follows the Worker: a supplied value wins, `nowIso()` otherwise —
   * and it is the SAME instant as `created_at`, from one clock read, so a photo
   * filed with no date does not sort a millisecond away from where it was
   * written.
   *
   * Like the Worker, this ignores `checklistId` and does not verify the item
   * exists (`addPhotoToItem` checks household access only). Diverging would make
   * a stale item id behave differently depending on which backend answered.
   */
  addPhoto: async (
    householdId: string,
    _checklistId: string,
    itemId: string,
    data: AddLocalChecklistPhotoInput,
  ) => {
    requireActiveProperty(householdId);
    const timestamp = nowIso();
    const photo: LocalChecklistItemPhoto = {
      id: newLocalId('cip'),
      checklist_item_id: itemId,
      household_id: householdId,
      photo_key: data.photo_key,
      thumbnail_key: data.thumbnail_key || null,
      caption: data.caption || null,
      taken_at: data.taken_at || timestamp,
      file_size: data.file_size ?? null,
      mime_type: data.mime_type || null,
      width: data.width ?? null,
      height: data.height ?? null,
      created_at: timestamp,
    };
    await writeLocal(
      (draft) => {
        draft.checklistItemPhotos.push(photo);
      },
      {
        opType: 'CHECKLIST_ITEM_PHOTO_CREATE',
        entityType: 'checklist_item_photo',
        entityId: photo.id,
        payload: photo,
      },
    );
    return { photo };
  },

  /**
   * `GET /items/:itemId/photos`.
   *
   * Deliberately UNSORTED. `getPhotosForItem` issues no `orderBy`, so D1 answers
   * in rowid order — insertion order — and the ledger array is in insertion
   * order too. Adding a sort here would be an improvement that makes the two
   * backends disagree about which photo is first.
   */
  getPhotos: async (householdId: string, _checklistId: string, itemId: string) => {
    const photos = photosOf(householdId).filter((row) => row.checklist_item_id === itemId);
    return { photos };
  },

  /** Keyed on the photo id and the household, exactly as the Worker's DELETE is. */
  deletePhoto: async (
    householdId: string,
    _checklistId: string,
    _itemId: string,
    photoId: string,
  ) => {
    requireActiveProperty(householdId);
    await writeLocal(
      (draft) => {
        draft.checklistItemPhotos = draft.checklistItemPhotos.filter(
          (row) => !(row.id === photoId && row.household_id === householdId),
        );
      },
      {
        opType: 'CHECKLIST_ITEM_PHOTO_DELETE',
        entityType: 'checklist_item_photo',
        entityId: photoId,
        payload: { id: photoId },
      },
    );
  },

  // ---- templates and technical terms (Tier C, remote) ---------------------
  //
  // `getTemplates`, `getTemplatesByCategory`, `getTemplate` and
  // `getTechnicalTerm` are absent from this object ON PURPOSE, and they are the
  // only absences in it. Both `checklist_templates` and `technical_terms` are
  // Tier C — global reference data, identical for every household, carrying
  // nothing of theirs — so the Proxy routes them to the Worker and
  // `apiParity.test.ts` declares each one with its reason. See the header.

  // ---- multi-contractor comparison ----------------------------------------

  /**
   * `GET /visit-checklists/for-task/:taskId` — every checklist raised against
   * one job, with its visit, its contractor and its progress.
   *
   * Entirely local because every table it touches is: checklists and items
   * (B4), visits and contractors (B1). That is the sub-wave gating §11 describes
   * paying off — B1 gated B2 gated B3 gated this, and the payoff is that the
   * comparison screen a member opens to decide who to hire works with no signal.
   *
   * Dismissed suggestions are excluded from BOTH counts (`isNull(dismissed_at)`
   * in the Worker's `where`), so a question the member rejected cannot make a
   * contractor look incomplete.
   */
  getChecklistsForTask: async (householdId: string, taskId: string) => {
    const items = itemsOf(householdId);
    const visits = rowsOf<LocalContractorVisit>('contractorVisits');
    const contractorsById = new Map(
      rowsOf<LocalContractor>('contractors').map((row) => [row.id, row]),
    );

    const checklists = checklistsOf(householdId)
      .filter((row) => row.task_id === taskId)
      .sort(byCreatedAtDesc)
      .map((checklist) => {
        const visit = checklist.visit_id
          ? visits.find((row) => row.id === checklist.visit_id)
          : undefined;
        const contractor = visit ? contractorsById.get(visit.contractor_id) : undefined;
        const mine = items.filter(
          (row) => row.checklist_id === checklist.id && row.dismissed_at === null,
        );
        return {
          checklist,
          visit,
          contractor,
          itemsCompleted: mine.filter((row) => row.checked).length,
          itemsTotal: mine.length,
        };
      });

    return { checklists };
  },

  /**
   * `GET /visit-checklists/comparison/:taskId` — the whole decision on one
   * screen: who came, what they said, what they quoted.
   *
   * Iterates the VISITS for the task rather than the checklists, which is
   * `getMultiContractorComparison`'s own shape and is not interchangeable: a
   * contractor who came and left no checklist still appears in the comparison
   * with an empty progress block, and driving it off checklists would drop them.
   *
   * The quote is looked up in `contractorQuotes` — the task-scoped table B2
   * ledgered — on `(task_id, contractor_id)`, the pair D1 makes unique and the
   * pair its deterministic id is built from. `keyResponses` keeps `must_ask`
   * items that were answered or ticked, and falls back to the same
   * `'Checked'` / `'No response'` strings the Worker emits, because they are
   * rendered verbatim.
   */
  getMultiContractorComparison: async (householdId: string, taskId: string) => {
    const items = itemsOf(householdId);
    const checklists = checklistsOf(householdId);
    const quotes = rowsOf<LocalContractorQuote>('contractorQuotes');
    const contractorsById = new Map(
      rowsOf<LocalContractor>('contractors').map((row) => [row.id, row]),
    );
    const task = rowsOf<LocalTask>('tasks').find((row) => row.id === taskId) ?? null;

    const contractors = [];
    for (const visit of rowsOf<LocalContractorVisit>('contractorVisits')) {
      if (visit.task_id !== taskId) continue;
      const contractor = contractorsById.get(visit.contractor_id);
      // The Worker `continue`s on a dangling contractor rather than throwing —
      // the comparison is a list, and one broken row must not blank the screen.
      if (!contractor) continue;

      const checklist = checklists.find((row) => row.visit_id === visit.id);
      const quote = quotes.find(
        (row) => row.task_id === taskId && row.contractor_id === contractor.id,
      );
      const mine = checklist
        ? items.filter((row) => row.checklist_id === checklist.id && row.dismissed_at === null)
        : [];

      contractors.push({
        contractor,
        visit,
        checklist,
        quote,
        checklistProgress: {
          completed: mine.filter((row) => row.checked).length,
          total: mine.length,
        },
        keyResponses: mine
          .filter((row) => row.priority === 'must_ask' && (row.comment || row.checked))
          .map((row) => ({
            question: row.text,
            answer: row.comment || (row.checked ? 'Checked' : 'No response'),
            priority: row.priority || 'nice_to_have',
          })),
      });
    }

    return { task, contractors };
  },
};
