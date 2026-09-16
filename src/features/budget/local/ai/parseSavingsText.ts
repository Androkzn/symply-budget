import type { SavingsImportDraft, SavingsImportScope } from '@api/savings';

function parseMoney(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.\-]/g, '');
  if (!cleaned) return null;
  const value = parseFloat(cleaned);
  if (Number.isNaN(value) || value < 0) return null;
  return Math.round(value * 100);
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseCsvRow(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

/** Deterministic savings import from pasted CSV or "label amount" lines. */
export function parseSavingsText(text: string, scope: SavingsImportScope = 'all'): SavingsImportDraft {
  const draft: SavingsImportDraft = {
    income: [],
    spending: [],
    recurringPayments: [],
  };
  const rows = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (rows.length === 0) return draft;

  const header = parseCsvRow(rows[0]!).map((h) => h.toLowerCase());
  const looksLikeCsv =
    header.some((h) => /amount|income|spending|label|payee|category/.test(h)) && rows.length > 1;

  if (looksLikeCsv) {
    const amountIdx = header.findIndex((h) => /amount|value|total/.test(h));
    const labelIdx = header.findIndex((h) => /label|name|description|payee|source/.test(h));
    const categoryIdx = header.findIndex((h) => /category|group/.test(h));
    const dateIdx = header.findIndex((h) => /date|period/.test(h));
    const typeIdx = header.findIndex((h) => /type|bucket|kind/.test(h));

    for (const row of rows.slice(1)) {
      const cells = parseCsvRow(row);
      const label = (labelIdx >= 0 ? cells[labelIdx] : cells[0])?.trim();
      const amountRaw = amountIdx >= 0 ? cells[amountIdx] : cells[cells.length - 1];
      const amountCents = amountRaw ? parseMoney(amountRaw) : null;
      if (!label || amountCents == null || amountCents <= 0) continue;

      const bucket = (typeIdx >= 0 ? cells[typeIdx] : '').toLowerCase();
      const categoryName = categoryIdx >= 0 ? cells[categoryIdx]?.trim() || null : null;
      const dateRaw = dateIdx >= 0 ? cells[dateIdx] : null;
      const spendingDate =
        dateRaw && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : todayIso();

      const isRecurring =
        /recurring|monthly|bill|payment|mortgage|rent|utility|subscription/.test(
          `${bucket} ${label} ${categoryName ?? ''}`.toLowerCase(),
        );

      if (
        (scope === 'income' || scope === 'all') &&
        (bucket.includes('income') || /payroll|salary|deposit|pay/.test(label.toLowerCase()))
      ) {
        draft.income.push({
          member_name: null,
          source_type: 'other',
          label,
          amount_cents: amountCents,
          income_date: spendingDate,
          is_recurring: false,
          day_of_month: null,
        });
        continue;
      }

      if ((scope === 'recurring' || scope === 'all') && isRecurring) {
        draft.recurringPayments.push({
          label,
          amount_cents: amountCents,
          category_name: categoryName,
          day_of_month: null,
          group_label: categoryName,
          is_essential: false,
        });
        continue;
      }

      if (scope === 'spending' || scope === 'all' || scope === 'income' || scope === 'recurring') {
        if (scope === 'income' || scope === 'recurring') continue;
        draft.spending.push({
          category_name: categoryName,
          label,
          amount_cents: amountCents,
          spending_date: spendingDate,
        });
      }
    }
    return draft;
  }

  for (const row of rows) {
    const match = row.match(/^(.+?)\s+[\$]?\s*(\d+(?:\.\d{2})?)\s*$/);
    if (!match) continue;
    const label = match[1]!.trim();
    const amountCents = parseMoney(match[2]!);
    if (!label || amountCents == null || amountCents <= 0) continue;

    const lower = label.toLowerCase();
    if ((scope === 'income' || scope === 'all') && /payroll|salary|deposit|income/.test(lower)) {
      draft.income.push({
        member_name: null,
        source_type: 'other',
        label,
        amount_cents: amountCents,
        income_date: todayIso(),
        is_recurring: false,
        day_of_month: null,
      });
    } else if (
      (scope === 'recurring' || scope === 'all') &&
      /rent|mortgage|utility|insurance|phone|internet|subscription|monthly/.test(lower)
    ) {
      draft.recurringPayments.push({
        label,
        amount_cents: amountCents,
        category_name: null,
        day_of_month: null,
        group_label: null,
        is_essential: false,
      });
    } else if (scope === 'spending' || scope === 'all') {
      draft.spending.push({
        category_name: null,
        label,
        amount_cents: amountCents,
        spending_date: todayIso(),
      });
    }
  }

  return draft;
}
