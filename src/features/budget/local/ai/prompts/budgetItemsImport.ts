/** Client-side BYOK prompts for aiDetectItems — mirrors backend suggest-budget-items. */

export const BUDGET_ITEMS_IMPORT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'title',
          'description',
          'estimated_cost_min',
          'estimated_cost_max',
          'priority',
          'category',
          'scheduled',
          'target_date',
          'is_recurring',
          'recurrence_frequency',
        ],
        properties: {
          title: { type: 'string' },
          description: { type: ['string', 'null'] },
          estimated_cost_min: { type: ['integer', 'null'] },
          estimated_cost_max: { type: ['integer', 'null'] },
          priority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          category: { type: ['string', 'null'] },
          scheduled: { type: 'boolean' },
          target_date: { type: ['string', 'null'] },
          is_recurring: { type: 'boolean' },
          recurrence_frequency: {
            type: ['string', 'null'],
            enum: ['monthly', 'quarterly', 'yearly', null],
          },
        },
      },
    },
  },
};

export const BUDGET_ITEMS_IMPORT_SYSTEM = `You extract household spending drafts from free text or document transcriptions.
Amounts are CENTS. One item per distinct spend. category must be an exact name from the list or null.
Return ONLY structured data via the tool. Never invent prices.`;

export function buildBudgetItemsImportUserPrompt(input: {
  text: string;
  today: string;
  viewedYear?: number;
  viewedMonth?: number;
  categoryNames: string[];
}): string {
  const lines = [`Today: ${input.today}`];
  if (input.viewedYear && input.viewedMonth) {
    lines.push(`Viewed month: ${input.viewedYear}-${String(input.viewedMonth).padStart(2, '0')}`);
  }
  lines.push(
    input.categoryNames.length
      ? `Available categories (use exact names): ${input.categoryNames.join(', ')}`
      : 'Available categories: (none — use null for category)',
  );
  lines.push('', 'User description:', input.text);
  return lines.join('\n');
}
