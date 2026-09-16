/**
 * Attach fee / rebate lines to the parent product and collapse same-code rows.
 *
 * Fees are never their own expenses. Tax-base rules (CRA B-089 / CDTFA):
 *   - deposit (CA/US refundable container): OUT of CA GST/HST base
 *   - environmental (non-refundable levy): IN CA GST/HST base
 *   - crv (US): IN sales-tax base
 * Persist only deposit_amount = sum(deposit + crv).
 */

export type FeeKind = 'deposit' | 'environmental' | 'bag' | 'crv' | 'other';

export interface ReceiptFee {
  kind: FeeKind;
  label: string;
  amount: number;
}

export interface FeeLineInput {
  raw_name: string;
  raw_code: string | null;
  name: string;
  amount: number;
  saved_amount: number;
  /** Measured amount the line states (fuel volume, weight); null for a count. */
  quantity?: number | null;
  /** Unit for `quantity`, exactly as printed. */
  unit?: string | null;
  tax_codes: string[];
  fees?: ReceiptFee[];
  name_suggestions?: string[];
  category_id?: string | null;
  category_name?: string | null;
  category_suggestions?: Array<{ id: string; name: string }>;
}

export interface AttachedProduct {
  raw_name: string;
  raw_code: string | null;
  name: string;
  quantity?: number | null;
  unit?: string | null;
  amount: number;
  saved_amount: number;
  tax_codes: string[];
  fees: ReceiptFee[];
  deposit_amount: number;
  /** Pre-tax amount used for GST/HST / sales-tax weights (deposits excluded). */
  tax_base: number;
  name_suggestions: string[];
  category_id: string | null;
  category_name: string | null;
  category_suggestions: Array<{ id: string; name: string }>;
}

const FEE_KINDS = new Set<FeeKind>(['deposit', 'environmental', 'bag', 'crv', 'other']);

export function normalizeCode(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}

export function classifyFeeKind(name: string): FeeKind | null {
  const n = name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!n) return null;
  if (/\bcrv\b/.test(n)) return 'crv';
  if (/\b(container\s+)?deposit\b/.test(n) || /\bbottle\s+deposit\b/.test(n)) return 'deposit';
  if (/\bbag\b/.test(n) && /\b(fee|levy|charge)\b/.test(n)) return 'bag';
  if (/\b(recycling|enviro|environmental|eco)\b/.test(n)) return 'environmental';
  return null;
}

export function extractReferencedCode(name: string, rawCode: string | null): string | null {
  const tpd = name.match(/tpd[/\s-]*(\d+)/i);
  if (tpd?.[1]) return tpd[1];
  return normalizeCode(rawCode);
}

export function looksLikeDiscountLine(name: string): boolean {
  const n = name.toLowerCase();
  return /\btpd\b/.test(n) || /\barcp\b/.test(n) || /\byou saved\b/.test(n) || /^savings$/.test(n.trim());
}

export function looksLikeSummaryRow(name: string): boolean {
  const n = name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return /^(subtotal|total|grand total|tax|hst|gst|pst|amount tendered|change|payment|visa|mastercard|debit|cash|loyalty|points)\b/.test(
    n
  );
}

function depositCents(fees: ReceiptFee[]): number {
  return fees
    .filter((f) => f.kind === 'deposit' || f.kind === 'crv')
    .reduce((s, f) => s + Math.max(0, f.amount), 0);
}

function taxBaseCents(amount: number, fees: ReceiptFee[]): number {
  const deposits = fees
    .filter((f) => f.kind === 'deposit')
    .reduce((s, f) => s + Math.max(0, f.amount), 0);
  return Math.max(0, amount - deposits);
}

function mergeTaxCodes(a: string[], b: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const code of [...a, ...b]) {
    const c = code.trim().toUpperCase();
    if (!c || seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}

function sameFee(a: ReceiptFee, b: ReceiptFee): boolean {
  return a.kind === b.kind && a.amount === b.amount && a.label.trim().toLowerCase() === b.label.trim().toLowerCase();
}

function addFee(fees: ReceiptFee[], fee: ReceiptFee): void {
  if (fee.amount <= 0) return;
  if (fees.some((f) => sameFee(f, fee))) return;
  fees.push(fee);
}

function productKey(line: FeeLineInput): string {
  const code = normalizeCode(line.raw_code);
  if (code) return `code:${code}`;
  return `name:${line.raw_name.trim().toLowerCase() || line.name.trim().toLowerCase()}`;
}

function toProduct(line: FeeLineInput): AttachedProduct {
  const fees = [...(line.fees ?? [])].filter((f) => FEE_KINDS.has(f.kind) && f.amount > 0);
  return {
    raw_name: line.raw_name,
    raw_code: normalizeCode(line.raw_code),
    name: line.name,
    quantity: line.quantity ?? null,
    unit: line.unit ?? null,
    amount: line.amount,
    saved_amount: line.saved_amount,
    tax_codes: line.tax_codes,
    fees,
    deposit_amount: depositCents(fees),
    tax_base: taxBaseCents(line.amount, fees),
    name_suggestions: [...(line.name_suggestions ?? [])],
    category_id: line.category_id ?? null,
    category_name: line.category_name ?? null,
    category_suggestions: [...(line.category_suggestions ?? [])],
  };
}

function findParent(
  products: AttachedProduct[],
  referenced: string | null
): AttachedProduct | undefined {
  if (referenced) {
    const hit = products.find((p) => p.raw_code === referenced);
    if (hit) return hit;
  }
  return products.length > 0 ? products[products.length - 1] : undefined;
}

/**
 * Drop summary rows, attach fee/rebate lines to the parent product, then
 * collapse products that share a `raw_code` (or identical raw_name when
 * code is missing). Does not semantically merge "Tomatoes" / "Alcohol".
 */
export function attachFeesAndMerge(lines: FeeLineInput[]): AttachedProduct[] {
  const products: AttachedProduct[] = [];

  for (const line of lines) {
    const label = line.raw_name || line.name;
    if (looksLikeSummaryRow(label)) continue;

    const feeKind = classifyFeeKind(label);
    const isDiscount = looksLikeDiscountLine(label);
    const referenced = extractReferencedCode(label, line.raw_code);

    if (feeKind && !isDiscount) {
      const parent = findParent(products, referenced);
      if (!parent) {
        products.push(toProduct(line));
        continue;
      }
      addFee(parent.fees, { kind: feeKind, label: line.name || label, amount: line.amount });
      parent.amount += line.amount;
      parent.saved_amount += line.saved_amount;
      parent.tax_codes = mergeTaxCodes(parent.tax_codes, line.tax_codes);
      parent.deposit_amount = depositCents(parent.fees);
      parent.tax_base = taxBaseCents(parent.amount, parent.fees);
      continue;
    }

    if (isDiscount) {
      const parent = findParent(products, referenced);
      if (!parent) continue;
      const saved = line.saved_amount > 0 ? line.saved_amount : line.amount;
      parent.saved_amount += saved;
      continue;
    }

    products.push(toProduct(line));
  }

  const byKey = new Map<string, AttachedProduct>();
  const order: string[] = [];
  for (const product of products) {
    const key = productKey(product);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...product, fees: [...product.fees] });
      order.push(key);
      continue;
    }
    existing.amount += product.amount;
    existing.saved_amount += product.saved_amount;
    existing.tax_codes = mergeTaxCodes(existing.tax_codes, product.tax_codes);
    for (const fee of product.fees) addFee(existing.fees, fee);
    existing.deposit_amount = depositCents(existing.fees);
    existing.tax_base = taxBaseCents(existing.amount, existing.fees);
  }

  return order.map((key) => byKey.get(key)!);
}
