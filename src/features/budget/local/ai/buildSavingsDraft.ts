import type { SavingsImportDraft } from '@api/savings';

export function normalizeSavingsImportDraft(raw: SavingsImportDraft): SavingsImportDraft {
  return {
    income: (raw.income ?? []).map((row) => ({
      member_name: row.member_name ?? null,
      source_type: row.source_type ?? 'other',
      label: String(row.label ?? '').trim(),
      amount_cents: Math.max(0, Math.round(row.amount_cents ?? 0)),
      income_date: row.income_date,
      is_recurring: !!row.is_recurring,
      day_of_month: row.day_of_month ?? null,
    })).filter((r) => r.label && r.amount_cents > 0),
    spending: (raw.spending ?? []).map((row) => ({
      category_name: row.category_name ?? null,
      label: String(row.label ?? '').trim(),
      amount_cents: Math.max(0, Math.round(row.amount_cents ?? 0)),
      spending_date: row.spending_date,
    })).filter((r) => r.label && r.amount_cents > 0),
    recurringPayments: (raw.recurringPayments ?? []).map((row) => ({
      label: String(row.label ?? '').trim(),
      amount_cents: Math.max(0, Math.round(row.amount_cents ?? 0)),
      category_name: row.category_name ?? null,
      day_of_month: row.day_of_month ?? null,
      group_label: row.group_label ?? null,
      is_essential: !!row.is_essential,
    })).filter((r) => r.label && r.amount_cents > 0),
    monthlyGridSpending: raw.monthlyGridSpending,
  };
}

export function savingsDraftHasRows(draft: SavingsImportDraft): boolean {
  return (
    draft.income.length > 0 ||
    draft.spending.length > 0 ||
    draft.recurringPayments.length > 0 ||
    (draft.monthlyGridSpending?.length ?? 0) > 0
  );
}
