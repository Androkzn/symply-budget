import type { GroceryReceiptItem, GroceryReceiptScanResult } from '@api/budget';
import { normalizeCurrencyCode } from '@config/currencies';

import {
  attachFeesAndMerge,
  normalizeCode,
  type FeeKind,
  type FeeLineInput,
} from './feeAttribution';
import type { ParsedReceiptLine, ParsedReceiptText } from './parseReceiptText';
import { attributeItemTaxes, getTaxProfile } from './taxAttribution';

export interface RawReceiptDraft {
  vendor: string | null;
  purchase_date: string | null;
  items: Array<{
    raw_name?: string;
    raw_code?: string | null;
    name: string;
    name_suggestions?: string[];
    amount: number;
    saved_amount: number;
    quantity?: number | null;
    unit?: string | null;
    tax_amount?: number;
    tax_codes?: string[];
    category?: string | null;
    category_suggestions?: string[];
    fees?: Array<{ kind: string; label: string; amount: number }>;
  }>;
  tax_summary?: Array<{
    code: string | null;
    label: string;
    rate_percent: number | null;
    amount: number;
  }>;
  receipt_country?: string | null;
  receipt_region?: string | null;
  receipt_currency?: string | null;
}

/**
 * The currency the receipt NAMED — nothing inferred.
 *
 * Deliberately does not fall back to the store's country. That inference is
 * only safe next to the member's own region, which lives on the device and not
 * in this module; `resolveScanCurrency` in the scan screen owns it. Reporting
 * an inferred currency as though it were printed would take the decision away
 * from the one place that can make it correctly.
 */
function resolveReceiptCurrency(raw: { receipt_currency?: string | null }): string | null {
  return normalizeCurrencyCode(raw.receipt_currency);
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');
}

function ensureNameSuggestions(rawName: string, suggestions: string[]): string[] {
  const title = titleCase(rawName);
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (s: string) => {
    const t = s.trim();
    if (!t) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };
  for (const s of suggestions) add(s);
  if (!seen.has(title.toLowerCase())) {
    if (out.length >= 7) out[6] = title;
    else out.push(title);
  }
  return out.slice(0, 7);
}

function mapCategory(
  rawName: string | null | undefined,
  categories: Array<{ id: string; name: string }>,
): { id: string | null; name: string | null } {
  if (!rawName?.trim()) return { id: null, name: null };
  const hit = categories.find((c) => c.name.toLowerCase() === rawName.trim().toLowerCase());
  return hit ? { id: hit.id, name: hit.name } : { id: null, name: null };
}

export function buildReceiptDraftFromParsed(
  parsed: ParsedReceiptText,
  categories: Array<{ id: string; name: string }>,
): GroceryReceiptScanResult {
  const grocery =
    categories.find((c) => c.name.toLowerCase() === 'groceries') ??
    categories.find((c) => /groc/.test(c.name.toLowerCase())) ??
    null;

  const lines: FeeLineInput[] = parsed.lines.map((line: ParsedReceiptLine) => ({
    raw_name: line.name,
    raw_code: null,
    name: titleCase(line.name),
    amount: line.amountCents,
    saved_amount: line.savedCents,
    tax_codes: [],
    name_suggestions: ensureNameSuggestions(line.name, [titleCase(line.name)]),
    category_id: grocery?.id ?? null,
    category_name: grocery?.name ?? null,
    category_suggestions: [],
  }));

  const attached = attachFeesAndMerge(lines);
  const items: GroceryReceiptItem[] = attached.map((line) => ({
    raw_name: line.raw_name,
    raw_code: line.raw_code,
    name: line.name,
    name_suggestions: line.name_suggestions,
    amount: line.amount,
    saved_amount: line.saved_amount,
    tax_amount: 0,
    deposit_amount: line.deposit_amount,
    fees: line.fees,
    category_id: line.category_id,
    category_name: line.category_name,
    category_suggestions: line.category_suggestions,
  }));

  const totalAmount = items.reduce((s, i) => s + i.amount, 0);

  return {
    vendor: parsed.vendor?.trim() || 'Other',
    purchase_date: parsed.purchaseDate,
    category_id: grocery?.id ?? null,
    category_name: grocery?.name ?? null,
    items,
    subtotal_amount: totalAmount,
    tax_amount: 0,
    total_amount: totalAmount,
    tax_source: 'none',
    region_known: false,
    receipt_currency: parsed.currency,
  };
}

export function buildReceiptDraftFromRaw(
  raw: RawReceiptDraft,
  categories: Array<{ id: string; name: string }>,
): GroceryReceiptScanResult {
  const grocery =
    categories.find((c) => c.name.toLowerCase() === 'groceries') ??
    categories.find((c) => /groc/.test(c.name.toLowerCase())) ??
    null;

  const lines: FeeLineInput[] = (raw.items ?? [])
    .map((item): FeeLineInput | null => {
      const printed = (item.raw_name || item.name || '').trim();
      if (!printed) return null;
      const amount = typeof item.amount === 'number' ? item.amount : Number(item.amount);
      if (!Number.isFinite(amount) || amount < 0) return null;
      const matched = mapCategory(item.category, categories);
      const cat = matched.id ? matched : { id: grocery?.id ?? null, name: grocery?.name ?? null };
      const alts = (item.category_suggestions ?? [])
        .map((name) => mapCategory(name, categories))
        .filter((c): c is { id: string; name: string } => !!c.id && !!c.name && c.id !== cat.id)
        .slice(0, 3);
      return {
        raw_name: printed,
        raw_code: normalizeCode(item.raw_code ?? null),
        name: titleCase(item.name || printed),
        quantity: typeof item.quantity === 'number' && item.quantity > 0 ? item.quantity : null,
        unit: typeof item.unit === 'string' && item.unit.trim() ? item.unit.trim() : null,
        amount: Math.round(amount),
        saved_amount: Math.max(0, Math.round(item.saved_amount ?? 0)),
        tax_codes: Array.isArray(item.tax_codes) ? item.tax_codes : [],
        fees: (item.fees ?? []).map((f) => ({
          kind: f.kind as FeeKind,
          label: f.label,
          amount: f.amount,
        })),
        name_suggestions: ensureNameSuggestions(printed, item.name_suggestions ?? []),
        category_id: cat.id,
        category_name: cat.name,
        category_suggestions: alts,
      };
    })
    .filter((l): l is FeeLineInput => l !== null);

  const attached = attachFeesAndMerge(lines);
  const profile = getTaxProfile(raw.receipt_country, raw.receipt_region);
  const attribution = attributeItemTaxes(
    attached.map((line) => ({
      amount: line.amount,
      tax_base: line.tax_base,
      tax_codes: line.tax_codes,
    })),
    raw.tax_summary ?? [],
    profile,
  );
  const items: GroceryReceiptItem[] = attached
    .map((line, i) => {
      const tax = attribution.lineTaxes[i] ?? 0;
      return {
        raw_name: line.raw_name,
        raw_code: line.raw_code,
        name: line.name,
        name_suggestions: line.name_suggestions,
        quantity: line.quantity ?? null,
        unit: line.unit ?? null,
        amount: line.amount + tax,
        saved_amount: line.saved_amount,
        tax_amount: tax,
        deposit_amount: line.deposit_amount,
        fees: line.fees,
        category_id: line.category_id,
        category_name: line.category_name,
        category_suggestions: line.category_suggestions,
      };
    })
    .filter((item) => item.name && item.amount > 0);

  const totalAmount = items.reduce((s, i) => s + i.amount, 0);
  const totalTax = items.reduce((s, i) => s + (i.tax_amount ?? 0), 0);

  return {
    vendor: raw.vendor?.trim() || 'Other',
    purchase_date: raw.purchase_date,
    category_id: grocery?.id ?? null,
    category_name: grocery?.name ?? null,
    items,
    subtotal_amount: totalAmount - totalTax,
    tax_amount: totalTax,
    total_amount: totalAmount,
    tax_breakdown: attribution.breakdown,
    tax_source: attribution.source,
    region_known: !!profile,
    receipt_country: raw.receipt_country ?? null,
    receipt_region: raw.receipt_region ?? null,
    receipt_currency: resolveReceiptCurrency(raw),
  };
}

export function resolveReceiptCategoryIds(
  draft: GroceryReceiptScanResult,
  categories: Array<{ id: string; name: string }>,
): GroceryReceiptScanResult {
  const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c]));
  const items = draft.items.map((item) => {
    if (item.category_id) return item;
    const name = item.category_name?.trim().toLowerCase();
    const cat = name ? byName.get(name) : undefined;
    return cat ? { ...item, category_id: cat.id, category_name: cat.name } : item;
  });
  return { ...draft, items };
}
