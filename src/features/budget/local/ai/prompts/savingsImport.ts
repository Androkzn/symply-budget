/** Client-side savings import BYOK prompts — mirrors backend suggest-savings-import shape. */

export const SAVINGS_IMPORT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['income', 'spending', 'recurringPayments'],
  properties: {
    income: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'member_name',
          'source_type',
          'label',
          'amount_cents',
          'income_date',
          'is_recurring',
          'day_of_month',
        ],
        properties: {
          member_name: { type: ['string', 'null'] },
          source_type: { type: 'string' },
          label: { type: 'string' },
          amount_cents: { type: 'integer' },
          income_date: { type: 'string' },
          is_recurring: { type: 'boolean' },
          day_of_month: { type: ['integer', 'null'] },
        },
      },
    },
    spending: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category_name', 'label', 'amount_cents', 'spending_date'],
        properties: {
          category_name: { type: ['string', 'null'] },
          label: { type: 'string' },
          amount_cents: { type: 'integer' },
          spending_date: { type: 'string' },
        },
      },
    },
    recurringPayments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'label',
          'amount_cents',
          'category_name',
          'day_of_month',
          'group_label',
          'is_essential',
        ],
        properties: {
          label: { type: 'string' },
          amount_cents: { type: 'integer' },
          category_name: { type: ['string', 'null'] },
          day_of_month: { type: ['integer', 'null'] },
          group_label: { type: ['string', 'null'] },
          is_essential: { type: 'boolean' },
        },
      },
    },
  },
};

export const SAVINGS_IMPORT_SYSTEM = `You classify pasted financial text into income, one-off spending, or recurring monthly payments.
Amounts must be integer cents echoed from the source. Never auto-commit — draft only.`;

export function buildSavingsImportUserPrompt(scope: string, sourceText: string): string {
  return `Import scope: ${scope}\n\nSource text:\n${sourceText.trim()}`;
}
