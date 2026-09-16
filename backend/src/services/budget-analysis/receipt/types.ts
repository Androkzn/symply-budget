/**
 * Shared receipt-scan contract used by HTTP Scan Receipt, chat tools, and mobile.
 * Amounts are integer cents.
 */

export type ReceiptScanMimeType =
  | 'application/pdf'
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp';

export type ReceiptFeeKind = 'deposit' | 'environmental' | 'bag' | 'crv' | 'other';

export interface ReceiptScanFee {
  kind: ReceiptFeeKind;
  label: string;
  amount: number;
}

export interface ReceiptCategorySuggestion {
  id: string;
  name: string;
}

/** A reviewed-before-saving line item returned to the client. */
export interface ReceiptScanItem {
  /** Printed SKU / cryptic line, as read. */
  raw_name: string;
  /** UPC / PLU / retailer item #, digits only, or null. */
  raw_code: string | null;
  /** Short product name (Title Case). Default = suggestions[0] or alias. */
  name: string;
  /** ≤7 guesses; MUST include Title Case of `raw_name`. */
  name_suggestions: string[];
  /**
   * TAX-INCLUSIVE price paid for this item, in cents: the pre-tax line price
   * plus this item's attributed share of the receipt's sales tax. This is what
   * gets stored as the expense amount so budget totals include tax. Fees that
   * attached to this line are included.
   */
  amount: number;
  /**
   * The portion of `amount` that is sales tax, in cents (0 = exempt / no tax
   * on the receipt). Informational — lets the UI show the pre-tax price
   * (amount - tax_amount) and reconcile GST/PST with the receipt.
   */
  tax_amount: number;
  /** Discount/sale savings for this item, in cents (0 = full price). */
  saved_amount: number;
  /** Sum of attached `deposit` + `crv` fees, in cents. */
  deposit_amount: number;
  /** Review-time only — not persisted. */
  fees: ReceiptScanFee[];
  /**
   * Best-fit category for THIS item, resolved server-side against the
   * household's categories (falls back to the receipt-level Groceries
   * category, or null when the household has none).
   */
  category_id: string | null;
  category_name: string | null;
  /** Mapped alt categories (excludes the selected id). */
  category_suggestions: ReceiptCategorySuggestion[];
}

/** One tax line for display, e.g. { label: "GST", amount: 475 }. */
export interface ReceiptTaxLine {
  label: string;
  amount: number;
}

export interface ReceiptScanResult {
  /** Store name, or `"Other"` when unreadable. */
  vendor: string;
  /** Purchase date as YYYY-MM-DD, or null if the receipt had none. */
  purchase_date: string | null;
  /**
   * Receipt-level default category ("Groceries") resolved server-side. Used as
   * the fallback for items the model could not categorize.
   */
  category_id: string | null;
  category_name: string | null;
  items: ReceiptScanItem[];
  /** Sum of pre-tax item prices, in cents (= Σ amount − Σ tax_amount). */
  subtotal_amount: number;
  /** Total sales tax attributed across items, in cents. */
  tax_amount: number;
  /** Grand total with tax, in cents (= Σ amount). Reconciles to the receipt total. */
  total_amount: number;
  /** Tax grouped by label for display, e.g. [{label:"GST",amount:475}]. */
  tax_breakdown: ReceiptTaxLine[];
  /**
   * How the tax was derived:
   *  - 'printed-coded'  : printed amounts + per-item flags (most accurate)
   *  - 'printed-spread' : printed total spread across all items (no flags)
   *  - 'profile-rates'  : computed from the household's province/state rates
   *  - 'none'           : no tax detected / could not attribute
   */
  tax_source: 'printed-coded' | 'printed-spread' | 'profile-rates' | 'none';
  /** True when the household's region resolved to a known tax table (fallback). */
  region_known: boolean;
  /** Printed address on the receipt, when the model could read it. */
  receipt_country?: string | null;
  receipt_region?: string | null;
  /**
   * ISO 4217 code the amounts above are printed in, when the receipt said so
   * decisively (a bare "$" does not). Null means "no opinion" — the client
   * reads the amounts as the member's own currency, which is the no-op.
   *
   * The server does NOT convert: it has no view of the member's display
   * currency and no rate, and converting twice is worse than not converting.
   * It reports what it read and the scan screen does the arithmetic.
   */
  receipt_currency?: string | null;
}

/** Device-local alias hint the client may send with a scan. */
export interface ReceiptAliasHint {
  key: string;
  name: string;
  categoryId?: string | null;
}

/** Legacy aliases — mobile API and older imports still use these names. */
export type GroceryReceiptMimeType = ReceiptScanMimeType;
export type GroceryReceiptItem = ReceiptScanItem;
export type GroceryReceiptScanResult = ReceiptScanResult;
