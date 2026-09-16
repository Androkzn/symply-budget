import { eq, and, desc, asc, sql, inArray } from 'drizzle-orm';
import { drizzle, DrizzleD1Database } from 'drizzle-orm/d1';

import { householdMembers, users } from '../db/schema';
import {
  wishes,
  wishEntries,
  type Wish,
  type WishEntry,
} from '../db/schema-wishes';
import type { Env } from '../types';
import { resolveAvatarUrl } from '../utils/avatar-url';
import { NotFoundError, ForbiddenError, ValidationError } from '../utils/errors';
import { nowIso } from '../utils/id';

export type WishStatus = 'active' | 'achieved' | 'archived';
export type WishEntryKind = 'note' | 'image' | 'link';

interface Author {
  author_id: string | null;
  author_name: string | null;
  author_avatar_url: string | null;
}

/** Quoted preview of the entry a reply points at (WhatsApp-style). */
interface ReplyTo {
  entry_id: string;
  author_name: string | null;
  snippet: string;
}

/** Short text preview of an entry, for reply quotes. */
function entrySnippet(e: WishEntry): string {
  if (e.kind === 'image') return e.body?.trim() || 'Photo';
  if (e.kind === 'link') return e.link_title?.trim() || e.url?.trim() || 'Link';
  const body = e.body?.trim() || '';
  return body.length > 80 ? `${body.slice(0, 80)}…` : body;
}

/** A wish plus lightweight rollups for the list/feed card. */
export interface WishWithMeta extends Wish {
  entry_count: number;
  image_count: number;
}

/** A feed entry stamped with who posted it + who it replies to (collaborative chat/feed). */
export type WishEntryWithAuthor = WishEntry & Author & { reply_to: ReplyTo | null };

/** A wish plus its full ordered entry feed (each entry attributed to a member). */
export interface WishWithEntries extends Wish {
  created_by_name: string | null;
  entries: WishEntryWithAuthor[];
}

export class WishesService {
  private db: DrizzleD1Database;
  private env: Env;

  constructor(env: Env, d1: D1Database) {
    this.env = env;
    this.db = drizzle(d1);
  }

  private async checkHouseholdAccess(householdId: string, userId: string): Promise<void> {
    const member = await this.db
      .select()
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.household_id, householdId),
          eq(householdMembers.user_id, userId)
        )
      )
      .get();

    if (!member) {
      throw new ForbiddenError('You do not have access to this household');
    }
  }

  /** All wishes for a household (default: active + achieved, newest first). */
  async listWishes(
    householdId: string,
    userId: string,
    filters?: { status?: WishStatus }
  ): Promise<WishWithMeta[]> {
    await this.checkHouseholdAccess(householdId, userId);

    const conditions = [eq(wishes.household_id, householdId)];
    if (filters?.status) {
      conditions.push(eq(wishes.status, filters.status));
    }

    const rows = await this.db
      .select()
      .from(wishes)
      .where(and(...conditions))
      .orderBy(asc(wishes.sort_order), desc(wishes.created_at))
      .all();

    if (rows.length === 0) return [];

    // One grouped pass for entry / image counts across the household's wishes.
    const counts = await this.db
      .select({
        wish_id: wishEntries.wish_id,
        total: sql<number>`count(*)`,
        images: sql<number>`sum(case when ${wishEntries.kind} = 'image' then 1 else 0 end)`,
      })
      .from(wishEntries)
      .where(eq(wishEntries.household_id, householdId))
      .groupBy(wishEntries.wish_id)
      .all();

    const countByWish = new Map(counts.map((c) => [c.wish_id, c]));

    return rows.map((w) => {
      const c = countByWish.get(w.id);
      return {
        ...w,
        entry_count: Number(c?.total ?? 0),
        image_count: Number(c?.images ?? 0),
      };
    });
  }

  /** A single wish with its ordered entry feed (oldest -> newest, chat style). */
  async getWish(householdId: string, wishId: string, userId: string): Promise<WishWithEntries> {
    await this.checkHouseholdAccess(householdId, userId);

    const wish = await this.db
      .select()
      .from(wishes)
      .where(and(eq(wishes.id, wishId), eq(wishes.household_id, householdId)))
      .get();

    if (!wish) throw new NotFoundError('Wish');

    const entries = await this.db
      .select()
      .from(wishEntries)
      .where(eq(wishEntries.wish_id, wishId))
      .orderBy(asc(wishEntries.created_at))
      .all();

    // Attribute the wish + every entry to a household member (collaborative feed).
    const ids = new Set<string>();
    if (wish.created_by) ids.add(wish.created_by);
    for (const e of entries) if (e.created_by) ids.add(e.created_by);
    const authors = await this.authorsById([...ids]);
    const byId = new Map(entries.map((e) => [e.id, e]));

    return {
      ...wish,
      created_by_name: wish.created_by ? authors.get(wish.created_by)?.name ?? null : null,
      entries: entries.map((e) => {
        const a = e.created_by ? authors.get(e.created_by) : undefined;
        let replyTo: ReplyTo | null = null;
        if (e.parent_entry_id) {
          const parent = byId.get(e.parent_entry_id);
          replyTo = {
            entry_id: e.parent_entry_id,
            author_name: parent?.created_by ? authors.get(parent.created_by)?.name ?? null : null,
            snippet: parent ? entrySnippet(parent) : 'a message',
          };
        }
        return {
          ...e,
          author_id: e.created_by,
          author_name: a?.name ?? null,
          author_avatar_url: a?.avatarUrl ?? null,
          reply_to: replyTo,
        };
      }),
    };
  }

  /** Resolve a set of user ids to display name (fallback email) + avatar. */
  private async authorsById(
    ids: string[]
  ): Promise<Map<string, { name: string; avatarUrl: string | null }>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({
        id: users.id,
        display_name: users.display_name,
        email: users.email,
        avatar_url: users.avatar_url,
      })
      .from(users)
      .where(inArray(users.id, ids))
      .all();
    return new Map(
      rows.map((r) => [
        r.id,
        {
          name: r.display_name || r.email || 'Someone',
          // A bucket key, not a URL — resolved per request (`utils/avatar-url.ts`).
          avatarUrl: resolveAvatarUrl(r.avatar_url, this.env.API_URL),
        },
      ])
    );
  }

  async createWish(
    householdId: string,
    userId: string,
    input: {
      title: string;
      notes?: string;
      estimatedCostCents?: number;
      targetDate?: string;
    }
  ): Promise<Wish> {
    await this.checkHouseholdAccess(householdId, userId);

    const now = nowIso();
    const wish: Wish = {
      id: crypto.randomUUID(),
      household_id: householdId,
      title: input.title,
      notes: input.notes ?? null,
      cover_image_key: null,
      estimated_cost_cents: input.estimatedCostCents ?? null,
      target_date: input.targetDate ?? null,
      status: 'active',
      sort_order: 0,
      created_by: userId,
      created_at: now,
      updated_at: now,
    };

    await this.db.insert(wishes).values(wish);
    return wish;
  }

  async updateWish(
    householdId: string,
    wishId: string,
    userId: string,
    updates: Partial<{
      title: string;
      notes: string | null;
      estimatedCostCents: number | null;
      targetDate: string | null;
      status: WishStatus;
      coverImageKey: string | null;
    }>
  ): Promise<Wish> {
    await this.checkHouseholdAccess(householdId, userId);

    const existing = await this.db
      .select()
      .from(wishes)
      .where(and(eq(wishes.id, wishId), eq(wishes.household_id, householdId)))
      .get();

    if (!existing) throw new NotFoundError('Wish');

    const patch: Record<string, unknown> = { updated_at: nowIso() };
    if (updates.title !== undefined) patch.title = updates.title;
    if (updates.notes !== undefined) patch.notes = updates.notes;
    if (updates.estimatedCostCents !== undefined) patch.estimated_cost_cents = updates.estimatedCostCents;
    if (updates.targetDate !== undefined) patch.target_date = updates.targetDate;
    if (updates.status !== undefined) patch.status = updates.status;
    if (updates.coverImageKey !== undefined) patch.cover_image_key = updates.coverImageKey;

    await this.db.update(wishes).set(patch).where(eq(wishes.id, wishId));
    return { ...existing, ...patch } as Wish;
  }

  async deleteWish(householdId: string, wishId: string, userId: string): Promise<void> {
    await this.checkHouseholdAccess(householdId, userId);

    // Confirm the wish is in this household before deleting anything.
    const existing = await this.db
      .select({ id: wishes.id })
      .from(wishes)
      .where(and(eq(wishes.id, wishId), eq(wishes.household_id, householdId)))
      .get();
    if (!existing) throw new NotFoundError('Wish');

    // Collect image keys for R2 cleanup, then delete entry rows EXPLICITLY —
    // SQLite/D1 don't enforce `ON DELETE CASCADE` unless foreign keys are on, so
    // we can't rely on the FK to purge the feed. Delete children then parent.
    const imageEntries = await this.db
      .select({ image_key: wishEntries.image_key })
      .from(wishEntries)
      .where(and(eq(wishEntries.wish_id, wishId), eq(wishEntries.kind, 'image')))
      .all();

    await this.db.delete(wishEntries).where(eq(wishEntries.wish_id, wishId));
    await this.db
      .delete(wishes)
      .where(and(eq(wishes.id, wishId), eq(wishes.household_id, householdId)));

    for (const e of imageEntries) {
      if (e.image_key) {
        try {
          await this.env.REPORTS_BUCKET.delete(e.image_key);
        } catch {
          // R2 cleanup is best-effort; the DB row is already gone.
        }
      }
    }
  }

  /** Append an entry to a wish's feed. Auto-adopts the first image as cover. */
  async addEntry(
    householdId: string,
    wishId: string,
    userId: string,
    input: {
      kind: WishEntryKind;
      body?: string;
      imageKey?: string;
      url?: string;
      linkTitle?: string;
      priceCents?: number;
      parentEntryId?: string;
    }
  ): Promise<WishEntry> {
    await this.checkHouseholdAccess(householdId, userId);

    const wish = await this.db
      .select()
      .from(wishes)
      .where(and(eq(wishes.id, wishId), eq(wishes.household_id, householdId)))
      .get();
    if (!wish) throw new NotFoundError('Wish');

    // Only allow replying to an entry that belongs to this same wish.
    let parentEntryId: string | null = null;
    if (input.parentEntryId) {
      const parent = await this.db
        .select({ id: wishEntries.id })
        .from(wishEntries)
        .where(and(eq(wishEntries.id, input.parentEntryId), eq(wishEntries.wish_id, wishId)))
        .get();
      parentEntryId = parent?.id ?? null;
    }

    if (input.kind === 'note' && !input.body?.trim()) {
      throw new ValidationError({ body: ['A note needs some text'] });
    }
    if (input.kind === 'image' && !input.imageKey) {
      throw new ValidationError({ image_key: ['An image entry needs an uploaded image'] });
    }
    if (input.kind === 'link' && !input.url?.trim()) {
      throw new ValidationError({ url: ['A link entry needs a URL'] });
    }

    const now = nowIso();
    const entry: WishEntry = {
      id: crypto.randomUUID(),
      wish_id: wishId,
      household_id: householdId,
      kind: input.kind,
      body: input.body?.trim() || null,
      image_key: input.imageKey ?? null,
      url: input.url?.trim() || null,
      link_title: input.linkTitle?.trim() || null,
      price_cents: input.priceCents ?? null,
      parent_entry_id: parentEntryId,
      created_by: userId,
      created_at: now,
    };

    await this.db.insert(wishEntries).values(entry);

    // First image becomes the cover so the list card gets a thumbnail for free.
    if (input.kind === 'image' && input.imageKey && !wish.cover_image_key) {
      await this.db
        .update(wishes)
        .set({ cover_image_key: input.imageKey, updated_at: now })
        .where(eq(wishes.id, wishId));
    } else {
      await this.db.update(wishes).set({ updated_at: now }).where(eq(wishes.id, wishId));
    }

    return entry;
  }

  /** Edit an existing entry's text fields (note body, link url/title, price/caption). */
  async updateEntry(
    householdId: string,
    wishId: string,
    entryId: string,
    userId: string,
    updates: Partial<{
      body: string | null;
      url: string;
      linkTitle: string | null;
      priceCents: number | null;
    }>
  ): Promise<WishEntry> {
    await this.checkHouseholdAccess(householdId, userId);

    const entry = await this.db
      .select()
      .from(wishEntries)
      .where(
        and(
          eq(wishEntries.id, entryId),
          eq(wishEntries.wish_id, wishId),
          eq(wishEntries.household_id, householdId)
        )
      )
      .get();
    if (!entry) throw new NotFoundError('Wish entry');

    const patch: Record<string, unknown> = {};
    if (updates.body !== undefined) patch.body = updates.body?.trim() || null;
    if (updates.url !== undefined) {
      if (!updates.url.trim()) throw new ValidationError({ url: ['A link entry needs a URL'] });
      patch.url = updates.url.trim();
    }
    if (updates.linkTitle !== undefined) patch.link_title = updates.linkTitle?.trim() || null;
    if (updates.priceCents !== undefined) patch.price_cents = updates.priceCents;

    // A note must keep some text.
    if (entry.kind === 'note' && patch.body === null) {
      throw new ValidationError({ body: ['A note needs some text'] });
    }

    if (Object.keys(patch).length > 0) {
      await this.db.update(wishEntries).set(patch).where(eq(wishEntries.id, entryId));
    }
    return { ...entry, ...patch } as WishEntry;
  }

  async deleteEntry(
    householdId: string,
    wishId: string,
    entryId: string,
    userId: string
  ): Promise<void> {
    await this.checkHouseholdAccess(householdId, userId);

    const entry = await this.db
      .select()
      .from(wishEntries)
      .where(
        and(
          eq(wishEntries.id, entryId),
          eq(wishEntries.wish_id, wishId),
          eq(wishEntries.household_id, householdId)
        )
      )
      .get();
    if (!entry) throw new NotFoundError('Wish entry');

    await this.db.delete(wishEntries).where(eq(wishEntries.id, entryId));

    // If we removed the cover image, promote the next remaining image (if any).
    if (entry.kind === 'image' && entry.image_key) {
      const wish = await this.db.select().from(wishes).where(eq(wishes.id, wishId)).get();
      if (wish?.cover_image_key === entry.image_key) {
        const nextImage = await this.db
          .select({ image_key: wishEntries.image_key })
          .from(wishEntries)
          .where(and(eq(wishEntries.wish_id, wishId), eq(wishEntries.kind, 'image')))
          .orderBy(desc(wishEntries.created_at))
          .get();
        await this.db
          .update(wishes)
          .set({ cover_image_key: nextImage?.image_key ?? null, updated_at: nowIso() })
          .where(eq(wishes.id, wishId));
      }
      try {
        await this.env.REPORTS_BUCKET.delete(entry.image_key);
      } catch {
        // best-effort
      }
    }
  }

  /** Store a picked image in R2 under the wish and return its key. */
  async uploadImage(
    householdId: string,
    wishId: string,
    userId: string,
    data: ArrayBuffer,
    contentType: string
  ): Promise<{ image_key: string }> {
    await this.checkHouseholdAccess(householdId, userId);

    const wish = await this.db
      .select({ id: wishes.id })
      .from(wishes)
      .where(and(eq(wishes.id, wishId), eq(wishes.household_id, householdId)))
      .get();
    if (!wish) throw new NotFoundError('Wish');

    if (data.byteLength === 0) {
      throw new ValidationError({ image: ['The uploaded image is empty'] });
    }
    if (data.byteLength > 10 * 1024 * 1024) {
      throw new ValidationError({ image: ['Image is too large (max 10MB)'] });
    }

    const ext = contentType.includes('png')
      ? 'png'
      : contentType.includes('webp')
        ? 'webp'
        : contentType.includes('gif')
          ? 'gif'
          : 'jpg';
    const imageKey = `wishes/${householdId}/${wishId}/${crypto.randomUUID()}.${ext}`;

    await this.env.REPORTS_BUCKET.put(imageKey, data, {
      httpMetadata: { contentType },
    });

    return { image_key: imageKey };
  }
}
