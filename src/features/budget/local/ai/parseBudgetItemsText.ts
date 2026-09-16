import type { SuggestedSpending } from '@api/budget';

const MONEY =
  /(?:\$|CAD\s*)?\s*([\d]{1,3}(?:,[\d]{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s*(k|bucks|dollars)?/i;
const REC_MO = /(?:\/\s*mo|per\s*month|every\s*month|monthly)/i;
const REC_YR = /(?:\/\s*yr|per\s*year|every\s*year|yearly|annually)/i;
const REC_Q = /(?:\/\s*q(?:tr)?|per\s*quarter|quarterly)/i;

function dollarsToCents(amount: number, unit?: string): number {
  const n = unit?.toLowerCase() === 'k' ? amount * 1000 : amount;
  return Math.round(n * 100);
}

function matchCategory(
  title: string,
  categories: Array<{ id: string; name: string }>,
): { id: string | null; name: string | null } {
  const lower = title.toLowerCase();
  for (const c of categories) {
    if (lower.includes(c.name.toLowerCase())) {
      return { id: c.id, name: c.name };
    }
  }
  return { id: null, name: null };
}

/**
 * Deterministic Stage-A parse for "add spending in words" / budget table lines.
 * Returns zero or more drafts; empty means escalate to BYOK when available.
 */
export function parseBudgetItemsText(
  text: string,
  categories: Array<{ id: string; name: string }> = [],
  opts?: { year?: number; month?: number },
): SuggestedSpending[] {
  const lines = text
    .split(/\r?\n|;/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 2 && !/^(total|subtotal|net|difference)\b/i.test(l));

  const out: SuggestedSpending[] = [];
  for (const line of lines) {
    const money = line.match(MONEY);
    if (!money && !/[a-zA-Z]{2,}/.test(line)) continue;

    let amountCents: number | null = null;
    if (money) {
      const raw = parseFloat(money[1].replace(/,/g, ''));
      if (Number.isFinite(raw)) amountCents = dollarsToCents(raw, money[2]);
    }

    const title = line
      .replace(MONEY, ' ')
      .replace(REC_MO, ' ')
      .replace(REC_YR, ' ')
      .replace(REC_Q, ' ')
      .replace(/[~≈]|about|approx\.?/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[-–|:]+|[-–|:]+$/g, '')
      .trim();

    if (!title || title.length < 2) continue;
    if (/^(total|subtotal|savings|income|balance)\b/i.test(title)) continue;

    const isRecurring = REC_MO.test(line) || REC_YR.test(line) || REC_Q.test(line);
    const recurrence: SuggestedSpending['recurrence_frequency'] = REC_YR.test(line)
      ? 'yearly'
      : REC_Q.test(line)
        ? 'quarterly'
        : isRecurring
          ? 'monthly'
          : null;

    let targetDate: string | null = null;
    let scheduled = false;
    if (opts?.year && opts?.month) {
      scheduled = true;
      targetDate = `${opts.year}-${String(opts.month).padStart(2, '0')}-01`;
    }

    const cat = matchCategory(title, categories);
    out.push({
      title: title.slice(0, 80),
      description: null,
      estimated_cost_min: amountCents,
      estimated_cost_max: amountCents,
      priority: 'medium',
      category_id: cat.id,
      category_name: cat.name,
      scheduled,
      target_date: targetDate,
      is_recurring: isRecurring,
      recurrence_frequency: recurrence,
    });
  }

  return out;
}
