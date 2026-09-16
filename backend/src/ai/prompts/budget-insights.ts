/**
 * Smart Budget — AI narrative insights prompt.
 *
 * The affordability RANKING is computed deterministically upstream
 * (budget-affordability.ts); this prompt only turns that already-computed
 * monthly overview into a short plain-language summary, alerts, and
 * recommendations. The model never invents a dollar figure that isn't already
 * present in the input — it explains and advises, it doesn't calculate.
 */

export interface BudgetInsightAlert {
  severity: 'info' | 'warning' | 'critical';
  message: string;
}

export interface BudgetInsightResult {
  summary: string;
  alerts: BudgetInsightAlert[];
  recommendations: string[];
  /** Cents. Can be negative if the household is projected to go over budget. */
  projected_month_end_balance: number;
}

export const BUDGET_INSIGHTS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'alerts', 'recommendations', 'projected_month_end_balance'],
  properties: {
    summary: {
      type: 'string',
      description:
        'One short paragraph (2-3 sentences) plainly summarizing this month\'s budget status: how much is left, what is driving spend, and whether the household is on track.',
    },
    alerts: {
      type: 'array',
      description:
        'Zero or more notable conditions worth flagging (overspend risk, a single large item dominating the budget, unusually high committed total vs. plan). Empty array if nothing stands out.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'message'],
        properties: {
          severity: { type: 'string', enum: ['info', 'warning', 'critical'] },
          message: { type: 'string', description: 'One sentence, specific and actionable.' },
        },
      },
    },
    recommendations: {
      type: 'array',
      description:
        'Zero to three concrete, specific suggestions (e.g. "Defer the $400 gutter cleaning to next month" or "You have room to also tackle the $50 filter replacement"). Reference real item titles/amounts from the input, never invent ones.',
      items: { type: 'string' },
    },
    projected_month_end_balance: {
      type: 'integer',
      description:
        'Projected remaining balance in CENTS at month end if spending continues at the current pace. Use the provided remaining_budget and committed totals to ground this, do not invent a new number from scratch.',
    },
  },
};

export const BUDGET_INSIGHTS_SYSTEM_PROMPT = `You are a budget advisor. You are given a household's already-computed monthly budget overview (planned budget, actual spend, committed planned items, and a priority-ranked affordability list). Your job is to explain it in plain language and offer specific, grounded advice — NOT to recompute or invent any dollar figure that isn't already in the input.

Guidelines:
- Be concise and concrete. Reference real item titles and amounts from the input.
- Only raise an alert when something is genuinely notable (e.g. remaining balance is negative or under 10% of plan, or one item dominates the budget). Don't manufacture alerts when things look fine — return an empty array.
- Recommendations should be actionable: defer/reprioritize a specific named item, or note there's room for an additional named item from the "deferred" list.
- If plannedBudget is 0 or not set yet, say so plainly and suggest setting a monthly cap rather than analyzing spend.
- Tone: helpful and direct, never alarmist for a small or expected variance.

Always return via the "output" tool.`;

export function buildBudgetInsightsUserPrompt(input: {
  year: number;
  month: number;
  plannedBudget: number;
  actualSpent: number;
  committedTotal: number;
  remainingBudget: number;
  affordableItems: Array<{ title: string; priority: string; estimatedCost: number }>;
  deferredItems: Array<{ title: string; priority: string; estimatedCost: number }>;
  priorMonthActualSpent?: number;
}): string {
  const toDollars = (cents: number) => (cents / 100).toFixed(2);

  const lines = [
    `Month: ${input.year}-${String(input.month).padStart(2, '0')}`,
    `Planned budget: $${toDollars(input.plannedBudget)}`,
    `Actual spent so far: $${toDollars(input.actualSpent)}`,
    `Committed to planned items: $${toDollars(input.committedTotal)}`,
    `Remaining balance: $${toDollars(input.remainingBudget)}`,
  ];
  if (typeof input.priorMonthActualSpent === 'number') {
    lines.push(`Prior month actual spend: $${toDollars(input.priorMonthActualSpent)}`);
  }
  lines.push('');
  lines.push('Items that fit within the remaining balance (priority-ranked):');
  lines.push(
    input.affordableItems.length
      ? input.affordableItems
          .map((i) => `- ${i.title} (${i.priority} priority, $${toDollars(i.estimatedCost)})`)
          .join('\n')
      : '(none)'
  );
  lines.push('');
  lines.push('Items deferred — don\'t currently fit the remaining balance:');
  lines.push(
    input.deferredItems.length
      ? input.deferredItems
          .map((i) => `- ${i.title} (${i.priority} priority, $${toDollars(i.estimatedCost)})`)
          .join('\n')
      : '(none)'
  );

  return lines.join('\n');
}
