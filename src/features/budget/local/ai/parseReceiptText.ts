import { detectCurrencyInText, type CurrencyCode } from '@config/currencies';

export interface ParsedReceiptLine {
  name: string;
  /** Pre-tax amount in cents when known; tax-inclusive otherwise. */
  amountCents: number;
  savedCents: number;
}

export interface ParsedReceiptText {
  vendor: string | null;
  purchaseDate: string | null;
  lines: ParsedReceiptLine[];
  /**
   * Currency the text names outright (a spelled "USD", a "£"), or null when it
   * only prints a shared symbol. Null means "no opinion", NOT "the member's
   * currency" — the caller decides that.
   */
  currency: CurrencyCode | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SKIP_LINE =
  /^(sub\s*total|total|tax|gst|pst|hst|qst|vat|change|cash|debit|credit|visa|mastercard|balance|amount\s+tendered|thank\s+you)/i;
const DATE_PATTERNS = [
  /(\d{4}-\d{2}-\d{2})/,
  /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/,
];

function parseMoney(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.\-]/g, '');
  if (!cleaned) return null;
  const value = parseFloat(cleaned);
  if (Number.isNaN(value) || value < 0) return null;
  return Math.round(value * 100);
}

function normalizeDate(raw: string): string | null {
  const iso = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0]!;
  const slash = raw.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (!slash) return null;
  const year = slash[3]!.length === 2 ? 2000 + parseInt(slash[3]!, 10) : parseInt(slash[3]!, 10);
  const month = parseInt(slash[1]!, 10);
  const day = parseInt(slash[2]!, 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Heuristic receipt text parser — best for pasted OCR/plain-text exports. */
export function parseReceiptText(text: string): ParsedReceiptText {
  const rows = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let vendor: string | null = null;
  let purchaseDate: string | null = null;
  const lines: ParsedReceiptLine[] = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    if (!vendor && i < 3 && row.length <= 60 && !/\d/.test(row)) {
      vendor = row;
      continue;
    }
    if (!purchaseDate) {
      for (const pattern of DATE_PATTERNS) {
        const hit = row.match(pattern);
        if (hit) {
          const normalized = normalizeDate(hit[0]!);
          if (normalized && ISO_DATE.test(normalized)) {
            purchaseDate = normalized;
            break;
          }
        }
      }
    }
    if (SKIP_LINE.test(row)) continue;

    const trailing = row.match(/(.+?)\s+[\$]?\s*(\d+\.\d{2})\s*$/);
    if (!trailing) continue;
    const name = trailing[1]!.replace(/\s{2,}/g, ' ').trim();
    const amountCents = parseMoney(trailing[2]!);
    if (!name || amountCents == null || amountCents <= 0) continue;

    let savedCents = 0;
    const next = rows[i + 1];
    if (next && /saved|discount|arcp|\(-\$|\-\$/.test(next.toLowerCase())) {
      const savedMatch = next.match(/(\d+\.\d{2})/);
      if (savedMatch) savedCents = parseMoney(savedMatch[1]!) ?? 0;
      i += 1;
    }

    lines.push({ name, amountCents, savedCents });
  }

  return { vendor, purchaseDate, lines, currency: detectCurrencyInText(text) };
}
