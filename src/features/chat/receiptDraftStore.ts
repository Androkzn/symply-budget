/**
 * Holds a receipt scan draft between Budget chat (AI reply) and the Spending
 * confirm screen. Payload is too large for expo-router params, so the chat
 * path stashes it here and BudgetReceiptScanScreen takes it on mount.
 */
import { router } from 'expo-router';

import type { GroceryReceiptScanResult } from '@api/budget';

import type { ChatMessage } from './types';

let pending: GroceryReceiptScanResult | null = null;

export function setPendingReceiptDraft(draft: GroceryReceiptScanResult): void {
  pending = draft;
}

/** Consume the pending draft (one-shot). */
export function takePendingReceiptDraft(): GroceryReceiptScanResult | null {
  const draft = pending;
  pending = null;
  return draft;
}

/** Lenient parse of `metadata.receiptDraft` from an AI chat message. */
export function chatMessageReceiptDraft(
  message: ChatMessage
): GroceryReceiptScanResult | null {
  if (message.sender_type !== 'ai') return null;
  const raw = message.metadata?.receiptDraft;
  if (!raw || typeof raw !== 'object') return null;
  const draft = raw as Partial<GroceryReceiptScanResult>;
  if (!Array.isArray(draft.items) || draft.items.length === 0) return null;
  const items = draft.items
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const name = typeof item.name === 'string' ? item.name.trim() : '';
      const amount = typeof item.amount === 'number' ? item.amount : Number(item.amount);
      const saved =
        typeof item.saved_amount === 'number'
          ? item.saved_amount
          : Number(item.saved_amount ?? 0);
      const tax =
        typeof item.tax_amount === 'number' ? item.tax_amount : Number(item.tax_amount ?? 0);
      if (!name || !Number.isFinite(amount) || amount < 0) return null;
      const deposit =
        typeof item.deposit_amount === 'number'
          ? item.deposit_amount
          : Number(item.deposit_amount ?? 0);
      return {
        raw_name: typeof item.raw_name === 'string' ? item.raw_name : name,
        raw_code: typeof item.raw_code === 'string' ? item.raw_code : null,
        name,
        name_suggestions: Array.isArray(item.name_suggestions)
          ? item.name_suggestions.filter((s): s is string => typeof s === 'string')
          : [],
        amount: Math.round(amount),
        saved_amount: Number.isFinite(saved) && saved > 0 ? Math.round(saved) : 0,
        tax_amount: Number.isFinite(tax) && tax > 0 ? Math.round(tax) : 0,
        deposit_amount: Number.isFinite(deposit) && deposit > 0 ? Math.round(deposit) : 0,
        fees: Array.isArray(item.fees) ? item.fees : [],
        category_id: typeof item.category_id === 'string' ? item.category_id : null,
        category_name: typeof item.category_name === 'string' ? item.category_name : null,
        category_suggestions: Array.isArray(item.category_suggestions)
          ? item.category_suggestions
          : [],
      };
    })
    .filter((i): i is NonNullable<typeof i> => i !== null);
  if (items.length === 0) return null;
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : undefined;
  return {
    vendor: typeof draft.vendor === 'string' ? draft.vendor : null,
    purchase_date: typeof draft.purchase_date === 'string' ? draft.purchase_date : null,
    category_id: typeof draft.category_id === 'string' ? draft.category_id : null,
    category_name: typeof draft.category_name === 'string' ? draft.category_name : null,
    items,
    subtotal_amount: num(draft.subtotal_amount),
    tax_amount: num(draft.tax_amount),
    total_amount: num(draft.total_amount),
    tax_breakdown: Array.isArray(draft.tax_breakdown) ? draft.tax_breakdown : undefined,
    tax_source: draft.tax_source,
    region_known: typeof draft.region_known === 'boolean' ? draft.region_known : undefined,
    // A receipt scanned through chat is just as likely to be a foreign one, and
    // the confirm screen it opens is the same screen — drop the currency here
    // and the trip receipt silently imports at par.
    receipt_currency:
      typeof draft.receipt_currency === 'string' ? draft.receipt_currency : null,
  };
}

/** Stash draft and open the Spending receipt confirm screen. */
export function openBudgetReceiptConfirm(draft: GroceryReceiptScanResult): void {
  setPendingReceiptDraft(draft);
  router.push({
    pathname: '/spending',
    params: {
      screen: 'BudgetReceiptScan',
      navNonce: String(Date.now()),
    },
  });
}
