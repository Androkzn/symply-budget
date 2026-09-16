import type { ImagePickerAsset } from 'expo-image-picker';

import { api, apiClient } from './client';

/**
 * Wishes API client. Base path: /households/:householdId/wishes
 *
 * Wishes are long-term dreams / a household wishlist — deliberately distinct
 * from savings goals and budget items. Money is optional context only; a wish
 * owns a chat/feed of entries (notes, photos, links).
 */

export type WishStatus = 'active' | 'achieved' | 'archived';
export type WishEntryKind = 'note' | 'image' | 'link';

export interface Wish {
  id: string;
  household_id: string;
  title: string;
  notes: string | null;
  cover_image_key: string | null;
  estimated_cost_cents: number | null;
  target_date: string | null;
  status: WishStatus;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** List-card variant with server-computed rollups. */
export interface WishWithMeta extends Wish {
  entry_count: number;
  image_count: number;
}

export interface WishEntry {
  id: string;
  wish_id: string;
  household_id: string;
  kind: WishEntryKind;
  body: string | null;
  image_key: string | null;
  url: string | null;
  link_title: string | null;
  price_cents: number | null;
  created_by: string | null;
  created_at: string;
  // Author attribution (collaborative feed) — resolved server-side.
  author_id: string | null;
  author_name: string | null;
  author_avatar_url: string | null;
  // Threaded reply — the entry this one replies to, with a quoted preview.
  parent_entry_id: string | null;
  reply_to: { entry_id: string; author_name: string | null; snippet: string } | null;
}

export interface WishWithEntries extends Wish {
  created_by_name: string | null;
  entries: WishEntry[];
}

export interface UpdateWishEntryInput {
  body?: string | null;
  url?: string;
  link_title?: string | null;
  price_cents?: number | null;
}

export interface CreateWishInput {
  title: string;
  notes?: string;
  estimated_cost_cents?: number;
  target_date?: string;
}

export interface UpdateWishInput {
  title?: string;
  notes?: string | null;
  estimated_cost_cents?: number | null;
  target_date?: string | null;
  status?: WishStatus;
  cover_image_key?: string | null;
}

export interface AddWishEntryInput {
  kind: WishEntryKind;
  body?: string;
  image_key?: string;
  url?: string;
  link_title?: string;
  price_cents?: number;
  parent_entry_id?: string;
}

const base = (householdId: string) => `/households/${householdId}/wishes`;

const remoteWishesApi = {
  list: (householdId: string, status?: WishStatus) =>
    apiClient
      .get<{ wishes: WishWithMeta[] }>(base(householdId), {
        params: status ? { status } : undefined,
      })
      .then((res) => res.data.wishes),

  get: (householdId: string, wishId: string) =>
    apiClient
      .get<{ wish: WishWithEntries }>(`${base(householdId)}/${wishId}`)
      .then((res) => res.data.wish),

  create: (householdId: string, data: CreateWishInput) =>
    apiClient
      .post<{ wish: Wish }>(base(householdId), data)
      .then((res) => res.data.wish),

  update: (householdId: string, wishId: string, data: UpdateWishInput) =>
    apiClient
      .patch<{ wish: Wish }>(`${base(householdId)}/${wishId}`, data)
      .then((res) => res.data.wish),

  remove: (householdId: string, wishId: string) =>
    apiClient.delete(`${base(householdId)}/${wishId}`),

  addEntry: (householdId: string, wishId: string, data: AddWishEntryInput) =>
    apiClient
      .post<{ entry: WishEntry }>(`${base(householdId)}/${wishId}/entries`, data)
      .then((res) => res.data.entry),

  updateEntry: (householdId: string, wishId: string, entryId: string, data: UpdateWishEntryInput) =>
    apiClient
      .patch<{ entry: WishEntry }>(`${base(householdId)}/${wishId}/entries/${entryId}`, data)
      .then((res) => res.data.entry),

  deleteEntry: (householdId: string, wishId: string, entryId: string) =>
    apiClient.delete(`${base(householdId)}/${wishId}/entries/${entryId}`),

  /**
   * Upload a picked image to R2 and get back its key to attach as an entry.
   * Goes through the shared `api.upload` helper (multipart + long timeout) —
   * the same proven path the savings/utility file imports use.
   */
  uploadImage: (householdId: string, wishId: string, asset: ImagePickerAsset) => {
    const formData = new FormData();
    formData.append('image', {
      uri: asset.uri,
      type: asset.mimeType || 'image/jpeg',
      name: asset.fileName || `wish_${Date.now()}.jpg`,
    } as unknown as Blob);

    return api
      .upload<{ image_key: string }>(`${base(householdId)}/${wishId}/image`, formData)
      .then((res) => res.image_key);
  },
};

/**
 * Wishes API facade — routes to the local-first ledger when enabled
 * (`EXPO_PUBLIC_BUDGET_LOCAL_FIRST` / Budget __DEV__ default). Otherwise uses
 * the Cloudflare D1 remote API.
 */
export const wishesApi: typeof remoteWishesApi = new Proxy(remoteWishesApi, {
  get(target, prop, receiver) {
    try {
      const { isBudgetLocalFirst } =
        require('@features/budget/local/flag') as typeof import('@features/budget/local/flag');
      if (isBudgetLocalFirst()) {
        const { localWishesApi } =
          require('@features/budget/local/wishes/localWishesApi') as typeof import('@features/budget/local/wishes/localWishesApi');
        const localFn = (localWishesApi as Record<string | symbol, unknown>)[prop];
        if (typeof localFn === 'function') {
          return localFn.bind(localWishesApi);
        }
      }
    } catch {
      // Package/feature not ready — fall through to remote.
    }
    const value = Reflect.get(target, prop, receiver);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});
