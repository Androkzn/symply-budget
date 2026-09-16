/**
 * Client-side BYOK prompt for the monthly Insights card — mirrors the backend's
 * `ai/prompts/budget-insights.ts`.
 *
 * The INPUTS differ, because a local ledger has no server-side affordability
 * ranking to hand over: where the backend gives the model an
 * affordable/deferred split, this gives it the month's category breakdown, the
 * sub-budget caps, and the still-open planned items. Both describe the same
 * month — only the pre-computation upstream differs.
 *
 * As on the backend, the model EXPLAINS numbers it is given; it never invents a
 * dollar figure that is not already in the input.
 */

export interface LocalBudgetInsightAlert {
  severity: 'info' | 'warning' | 'critical';
  message: string;
}

export interface LocalBudgetInsightResult {
  summary: string;
  alerts: LocalBudgetInsightAlert[];
  recommendations: string[];
  /** Cents. Negative when the month is projected to end over budget. */
  projected_month_end_balance: number;
}

export const BUDGET_INSIGHTS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'alerts', 'recommendations', 'projected_month_end_balance'],
  properties: {
    summary: {
      type: 'string',
      minLength: 1,
      description:
        "One short paragraph (2-3 sentences) plainly summarizing this month's budget status: how much is left, what is driving spend, and whether the household is on track.",
    },
    alerts: {
      type: 'array',
      description:
        'Zero or more notable conditions worth flagging (overspend risk, one category dominating the month, a sub-budget already over its cap). Empty array if nothing stands out.',
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
        'Zero to three concrete suggestions that name a real category, planned item, or amount from the input. Never invent ones.',
      items: { type: 'string' },
    },
    projected_month_end_balance: {
      type: 'integer',
      description:
        'Projected remaining balance in CENTS at month end if spending continues at the current pace. Ground it in the provided remaining balance and committed totals; do not invent a new number from scratch.',
    },
  },
};

export const BUDGET_INSIGHTS_SYSTEM = `You are a budget advisor. You are given a household's already-computed monthly budget overview (planned budget, actual spend, spend per category, sub-budget caps, and still-open planned items). Explain it in plain language and offer specific, grounded advice — do NOT recompute or invent any dollar figure that is not already in the input.

Guidelines:
- Be concise and concrete. Reference real category names, item titles, and amounts from the input.
- Only raise an alert when something is genuinely notable (remaining balance negative or under 10% of plan, one category dominating the month, a sub-budget over its cap). Return an empty array when things look fine.
- Recommendations should be actionable: name the category to pull back on, or the planned item to defer or go ahead with.
- If the planned budget is 0 or not set yet, say so plainly and suggest setting a monthly cap rather than analyzing spend.
- Tone: helpful and direct, never alarmist about a small or expected variance.

Include a non-empty summary string even when you also provide alerts and recommendations.
Return ONLY structured data via the tool.`;

export interface LocalBudgetInsightsPromptInput {
  year: number;
  month: number;
  plannedBudget: number;
  actualSpent: number;
  committedTotal: number;
  remainingBudget: number;
  savedTotal: number;
  priorMonthActualSpent: number | null;
  categories: Array<{ name: string; spentCents: number }>;
  subBudgets: Array<{ name: string; capCents: number; spentCents: number; over: boolean }>;
  plannedItems: Array<{ title: string; priority: string; estimatedCost: number }>;
}

export function buildLocalBudgetInsightsUserPrompt(input: LocalBudgetInsightsPromptInput): string {
  const toDollars = (cents: number) => (cents / 100).toFixed(2);

  const lines = [
    `Month: ${input.year}-${String(input.month).padStart(2, '0')}`,
    `Planned budget: $${toDollars(input.plannedBudget)}`,
    `Actual spent so far: $${toDollars(input.actualSpent)}`,
    `Committed to planned items: $${toDollars(input.committedTotal)}`,
    `Remaining balance: $${toDollars(input.remainingBudget)}`,
    `Saved this month: $${toDollars(input.savedTotal)}`,
  ];
  if (input.priorMonthActualSpent !== null) {
    lines.push(`Prior month actual spend: $${toDollars(input.priorMonthActualSpent)}`);
  }

  lines.push('', 'Spend by category this month (highest first):');
  lines.push(
    input.categories.length
      ? input.categories.map((c) => `- ${c.name}: $${toDollars(c.spentCents)}`).join('\n')
      : '(no spending recorded yet)',
  );

  if (input.subBudgets.length) {
    lines.push('', 'Category caps set for this month:');
    lines.push(
      input.subBudgets
        .map(
          (s) =>
            `- ${s.name}: $${toDollars(s.spentCents)} of $${toDollars(s.capCents)}${
              s.over ? ' (OVER CAP)' : ''
            }`,
        )
        .join('\n'),
    );
  }

  lines.push('', 'Planned items still open this month:');
  lines.push(
    input.plannedItems.length
      ? input.plannedItems
          .map((i) => `- ${i.title} (${i.priority} priority, $${toDollars(i.estimatedCost)})`)
          .join('\n')
      : '(none)',
  );

  return lines.join('\n');
}
