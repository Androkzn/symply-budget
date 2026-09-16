import type { ReceiptScanResult } from './types';

/**
 * Chat/mobile wire format for a scan that still needs user confirm.
 * Identical to {@link ReceiptScanResult}; kept as a named helper so adapters
 * don't hand-map fields and drift.
 */
export type ReceiptDraft = ReceiptScanResult;

/** Clone a scan result into the chat `metadata.receiptDraft` payload. */
export function toReceiptDraft(result: ReceiptScanResult): ReceiptDraft {
  return {
    vendor: result.vendor,
    purchase_date: result.purchase_date,
    category_id: result.category_id,
    category_name: result.category_name,
    items: result.items.map((item) => ({
      raw_name: item.raw_name ?? item.name,
      raw_code: item.raw_code ?? null,
      name: item.name,
      name_suggestions: [...(item.name_suggestions ?? [])],
      amount: item.amount,
      tax_amount: item.tax_amount,
      saved_amount: item.saved_amount,
      deposit_amount: item.deposit_amount ?? 0,
      fees: (item.fees ?? []).map((f) => ({ ...f })),
      category_id: item.category_id,
      category_name: item.category_name,
      category_suggestions: (item.category_suggestions ?? []).map((c) => ({ ...c })),
    })),
    subtotal_amount: result.subtotal_amount,
    tax_amount: result.tax_amount,
    total_amount: result.total_amount,
    tax_breakdown: (result.tax_breakdown ?? []).map((t) => ({ ...t })),
    tax_source: result.tax_source,
    region_known: result.region_known,
    receipt_country: result.receipt_country ?? null,
    receipt_region: result.receipt_region ?? null,
    receipt_currency: result.receipt_currency ?? null,
  };
}

/** Map a chat attachment mime to a receipt-scanner mime (bytes are re-sniffed). */
export function toReceiptMime(
  mimeType: string | undefined
): import('./types').ReceiptScanMimeType {
  switch (mimeType) {
    case 'application/pdf':
      return 'application/pdf';
    case 'image/png':
      return 'image/png';
    case 'image/webp':
      return 'image/webp';
    case 'image/jpeg':
    case 'image/jpg':
    default:
      return 'image/jpeg';
  }
}
