import type { ImagePickerAsset } from 'expo-image-picker';

import type {
  AddWishEntryInput,
  CreateWishInput,
  UpdateWishEntryInput,
  UpdateWishInput,
  Wish,
  WishEntry,
  WishStatus,
  WishWithEntries,
  WishWithMeta,
} from '@api/wishes';

import {
  getLocalLedgerFor,
  mutateLocalLedger,
  runOnHousehold,
  type LocalBudgetLedger,
} from '../engine';
import { isoNow, newLocalId } from '../ids';

import { localWishImageUriForKey, saveWishImageLocal } from './localWishMedia';

/*
 * Wish WRITES run through the engine's `runOnHousehold(id, work)`, which
 * activates the named household first (BR-016 B5).
 *
 * `mutateLocalLedger` is bound to the ACTIVE session by design — the engine
 * deliberately gave it no `forHouseholdId` — so a call naming another household
 * has exactly two honest outcomes: move the session, or refuse. Writing anyway
 * would push household B's wish into household A's ledger, sealed correctly
 * under A's HDK and therefore invisible to every integrity check the engine has:
 * the row decrypts, the op verifies, and A's members later read a stranger's
 * shopping list.
 *
 * It replaced `assertHousehold`, which threw on every such call. That was the
 * right answer while a device could hold only one household and became a wall
 * the moment it could hold two: anything naming a non-active household died with
 * "Wish household mismatch for local ledger" rather than doing the obvious
 * thing. Activating is what the member meant — they addressed that household.
 * The refusal half survives inside `runOnHousehold`, which raises
 * `BudgetLocalUnknownHouseholdError` for an id this device holds no ledger for.
 *
 * It also replaced this file's private copy of the helper, which activated on
 * the engine's session chain but ran the write off it. `uploadImage` shows why
 * that gap mattered most here: it awaits `saveWishImageLocal`, a filesystem round
 * trip, between the activation and `mutateLocalLedger`, so a sibling facade's
 * activation had an unusually wide window in which to redirect the attachment
 * into another household. `runOnHousehold` holds the chain across both halves.
 *
 * READS deliberately do NOT come through it — they take
 * `getLocalLedgerFor(householdId)`, which hydrates that household on demand and
 * answers from its own rows without moving the session. A wish list refreshing
 * in the background must not yank the member out of the household they are
 * looking at.
 */

/**
 * The row lookups take the ledger they are to read rather than reaching for the
 * active one. Under a single household those were the same object; under BR-016
 * they are not, and a helper that quietly read the active ledger would answer a
 * background household's read with the wrong household's rows — the exact bleed
 * the `household_id` filter below only *looks* like it prevents.
 */
function requireWish(source: LocalBudgetLedger, householdId: string, wishId: string): Wish {
  const wish = source.wishes.find((w) => w.id === wishId && w.household_id === householdId);
  if (!wish) throw new Error('Wish not found');
  return wish;
}

function entrySnippet(entry: WishEntry): string {
  if (entry.kind === 'image') return entry.body?.trim() || 'Photo';
  if (entry.kind === 'link') return entry.link_title?.trim() || entry.url?.trim() || 'Link';
  const body = entry.body?.trim() || '';
  return body.length > 80 ? `${body.slice(0, 80)}…` : body;
}

function enrichEntry(entry: WishEntry, allEntries: WishEntry[]): WishEntry {
  let replyTo: WishEntry['reply_to'] = null;
  if (entry.parent_entry_id) {
    const parent = allEntries.find((e) => e.id === entry.parent_entry_id);
    replyTo = {
      entry_id: entry.parent_entry_id,
      author_name: null,
      snippet: parent ? entrySnippet(parent) : 'a message',
    };
  }
  return {
    ...entry,
    author_id: entry.created_by,
    author_name: null,
    author_avatar_url: null,
    reply_to: replyTo,
  };
}

/**
 * Entries are matched on `wish_id` alone, which is only safe because `source` is
 * already the ledger of one household — a wish id is unique inside a household
 * and the caller resolved the household before we got here.
 */
function countsForWish(
  source: LocalBudgetLedger,
  wishId: string,
): { entry_count: number; image_count: number } {
  const entries = source.wishEntries.filter((e) => e.wish_id === wishId);
  return {
    entry_count: entries.length,
    image_count: entries.filter((e) => e.kind === 'image').length,
  };
}

/**
 * Takes `memberId` rather than calling `getLocalMemberId()`, which answers for
 * whichever household is active. Every caller builds this *inside*
 * `runOnHousehold`, so the two agreed — but only by luck of ordering, and an
 * entry stamped with the wrong household's member id is a provenance lie no
 * later read can detect.
 */
function baseEntryFields(
  householdId: string,
  memberId: string,
  wishId: string,
  data: AddWishEntryInput,
  parentEntryId: string | null,
): WishEntry {
  const now = isoNow();
  return {
    id: newLocalId('wish_entry'),
    wish_id: wishId,
    household_id: householdId,
    kind: data.kind,
    body: data.body?.trim() || null,
    image_key: data.image_key ?? null,
    url: data.url?.trim() || null,
    link_title: data.link_title?.trim() || null,
    price_cents: data.price_cents ?? null,
    parent_entry_id: parentEntryId,
    created_by: memberId,
    created_at: now,
    author_id: null,
    author_name: null,
    author_avatar_url: null,
    reply_to: null,
  };
}

export const localWishesApi = {
  list: async (householdId: string, status?: WishStatus): Promise<WishWithMeta[]> => {
    const source = await getLocalLedgerFor(householdId);
    let rows = source.wishes.filter((w) => w.household_id === householdId);
    if (status) {
      rows = rows.filter((w) => w.status === status);
    }
    return rows
      .slice()
      .sort(
        (a, b) =>
          a.sort_order - b.sort_order || b.created_at.localeCompare(a.created_at),
      )
      .map((wish) => ({
        ...wish,
        ...countsForWish(source, wish.id),
      }));
  },

  get: async (householdId: string, wishId: string): Promise<WishWithEntries> => {
    const source = await getLocalLedgerFor(householdId);
    const wish = requireWish(source, householdId, wishId);
    const rawEntries = source.wishEntries
      .filter((e) => e.wish_id === wishId)
      .slice()
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    return {
      ...wish,
      created_by_name: null,
      entries: rawEntries.map((entry) => enrichEntry(entry, rawEntries)),
    };
  },

  create: async (householdId: string, data: CreateWishInput): Promise<Wish> =>
    runOnHousehold(householdId, async () => {
      // Built AFTER the activation, so `memberId` comes from the household this
      // wish is being written into rather than from the one it left behind.
      const source = await getLocalLedgerFor(householdId);
      const now = isoNow();
      const wish: Wish = {
        id: newLocalId('wish'),
        household_id: householdId,
        title: data.title,
        notes: data.notes ?? null,
        cover_image_key: null,
        estimated_cost_cents: data.estimated_cost_cents ?? null,
        target_date: data.target_date ?? null,
        status: 'active',
        sort_order: 0,
        created_by: source.memberId,
        created_at: now,
        updated_at: now,
      };
      await mutateLocalLedger(
        (ledger) => {
          ledger.wishes.push(wish);
        },
        { opType: 'WISH_CREATE', entityType: 'wish', entityId: wish.id, payload: wish },
      );
      return wish;
    }),

  update: async (
    householdId: string,
    wishId: string,
    data: UpdateWishInput,
  ): Promise<Wish> =>
    runOnHousehold(householdId, async () => {
      requireWish(await getLocalLedgerFor(householdId), householdId, wishId);
      let updated: Wish | undefined;
      await mutateLocalLedger(
        (ledger) => {
          const wish = ledger.wishes.find(
            (w) => w.id === wishId && w.household_id === householdId,
          );
          if (!wish) throw new Error('Wish not found');
          if (data.title !== undefined) wish.title = data.title;
          if (data.notes !== undefined) wish.notes = data.notes;
          if (data.estimated_cost_cents !== undefined) {
            wish.estimated_cost_cents = data.estimated_cost_cents;
          }
          if (data.target_date !== undefined) wish.target_date = data.target_date;
          if (data.status !== undefined) wish.status = data.status;
          if (data.cover_image_key !== undefined) wish.cover_image_key = data.cover_image_key;
          wish.updated_at = isoNow();
          updated = { ...wish };
        },
        { opType: 'WISH_UPDATE', entityType: 'wish', entityId: wishId, payload: data },
      );
      return updated!;
    }),

  remove: async (householdId: string, wishId: string): Promise<void> =>
    runOnHousehold(householdId, async () => {
      const source = await getLocalLedgerFor(householdId);
      requireWish(source, householdId, wishId);
      const imageKeys = source.wishEntries
        .filter((e) => e.wish_id === wishId && e.kind === 'image' && e.image_key)
        .map((e) => e.image_key as string);
      await mutateLocalLedger(
        (ledger) => {
          ledger.wishEntries = ledger.wishEntries.filter((e) => e.wish_id !== wishId);
          ledger.wishes = ledger.wishes.filter(
            (w) => !(w.id === wishId && w.household_id === householdId),
          );
          ledger.wishAttachments = ledger.wishAttachments.filter(
            (a) => !imageKeys.includes(a.key),
          );
        },
        { opType: 'WISH_DELETE', entityType: 'wish', entityId: wishId, payload: {} },
      );
    }),

  addEntry: async (
    householdId: string,
    wishId: string,
    data: AddWishEntryInput,
  ): Promise<WishEntry> =>
    runOnHousehold(householdId, async () => {
      const source = await getLocalLedgerFor(householdId);
      requireWish(source, householdId, wishId);

      if (data.kind === 'note' && !data.body?.trim()) {
        throw new Error('A note needs some text');
      }
      if (data.kind === 'image' && !data.image_key) {
        throw new Error('An image entry needs an uploaded image');
      }
      if (data.kind === 'link' && !data.url?.trim()) {
        throw new Error('A link entry needs a URL');
      }

      let parentEntryId: string | null = null;
      if (data.parent_entry_id) {
        // Resolved against THIS household's entries: a reply that silently
        // re-parented onto a same-id row in another household would thread a
        // member's message under a stranger's.
        const parent = source.wishEntries.find(
          (e) => e.id === data.parent_entry_id && e.wish_id === wishId,
        );
        parentEntryId = parent?.id ?? null;
      }

      const entry = baseEntryFields(householdId, source.memberId, wishId, data, parentEntryId);

      const next = await mutateLocalLedger(
        (ledger) => {
          ledger.wishEntries.push(entry);
          const target = ledger.wishes.find((w) => w.id === wishId);
          if (!target) return;
          if (data.kind === 'image' && data.image_key && !target.cover_image_key) {
            target.cover_image_key = data.image_key;
          }
          target.updated_at = entry.created_at;
        },
        {
          opType: 'WISH_ENTRY_ADD',
          entityType: 'wish_entry',
          entityId: entry.id,
          payload: data,
        },
      );

      // The mutated ledger comes back from the write rather than being fetched
      // again — one fewer accessor that could resolve a different household
      // than the one this entry was just sealed into.
      const allEntries = next.wishEntries.filter((e) => e.wish_id === wishId);
      return enrichEntry(entry, allEntries);
    }),

  updateEntry: async (
    householdId: string,
    wishId: string,
    entryId: string,
    data: UpdateWishEntryInput,
  ): Promise<WishEntry> =>
    runOnHousehold(householdId, async () => {
      requireWish(await getLocalLedgerFor(householdId), householdId, wishId);
      let updated: WishEntry | undefined;
      const next = await mutateLocalLedger(
        (ledger) => {
          const entry = ledger.wishEntries.find(
            (e) =>
              e.id === entryId && e.wish_id === wishId && e.household_id === householdId,
          );
          if (!entry) throw new Error('Wish entry not found');

          if (data.body !== undefined) {
            const nextBody = data.body?.trim() || null;
            if (entry.kind === 'note' && nextBody === null) {
              throw new Error('A note needs some text');
            }
            entry.body = nextBody;
          }
          if (data.url !== undefined) {
            if (!data.url.trim()) throw new Error('A link entry needs a URL');
            entry.url = data.url.trim();
          }
          if (data.link_title !== undefined) entry.link_title = data.link_title?.trim() || null;
          if (data.price_cents !== undefined) entry.price_cents = data.price_cents;

          updated = { ...entry };
        },
        {
          opType: 'WISH_ENTRY_UPDATE',
          entityType: 'wish_entry',
          entityId: entryId,
          payload: data,
        },
      );
      const allEntries = next.wishEntries.filter((e) => e.wish_id === wishId);
      return enrichEntry(updated!, allEntries);
    }),

  deleteEntry: async (householdId: string, wishId: string, entryId: string): Promise<void> =>
    runOnHousehold(householdId, async () => {
      const source = await getLocalLedgerFor(householdId);
      requireWish(source, householdId, wishId);
      const entry = source.wishEntries.find(
        (e) => e.id === entryId && e.wish_id === wishId && e.household_id === householdId,
      );
      if (!entry) throw new Error('Wish entry not found');

      await mutateLocalLedger(
        (ledger) => {
          ledger.wishEntries = ledger.wishEntries.filter((e) => e.id !== entryId);
          if (entry.kind === 'image' && entry.image_key) {
            const wish = ledger.wishes.find((w) => w.id === wishId);
            if (wish?.cover_image_key === entry.image_key) {
              const nextImage = ledger.wishEntries
                .filter((e) => e.wish_id === wishId && e.kind === 'image' && e.image_key)
                .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
              wish.cover_image_key = nextImage?.image_key ?? null;
              wish.updated_at = isoNow();
            }
            ledger.wishAttachments = ledger.wishAttachments.filter(
              (a) => a.key !== entry.image_key,
            );
          }
        },
        {
          opType: 'WISH_ENTRY_DELETE',
          entityType: 'wish_entry',
          entityId: entryId,
          payload: {},
        },
      );
    }),

  uploadImage: async (
    householdId: string,
    wishId: string,
    asset: ImagePickerAsset,
  ): Promise<string> =>
    runOnHousehold(householdId, async () => {
      requireWish(await getLocalLedgerFor(householdId), householdId, wishId);
      const imageKey = await saveWishImageLocal(asset.uri);
      const mime = asset.mimeType || 'image/jpeg';
      await mutateLocalLedger(
        (ledger) => {
          if (!ledger.wishAttachments.some((a) => a.key === imageKey)) {
            ledger.wishAttachments.push({
              id: newLocalId('wat'),
              key: imageKey,
              localUri: localWishImageUriForKey(imageKey),
              mime,
            });
          }
        },
        {
          opType: 'WISH_IMAGE_UPLOAD',
          entityType: 'wish_attachment',
          entityId: imageKey,
          payload: { imageKey, mime, wishId },
        },
      );
      return imageKey;
    }),
};
