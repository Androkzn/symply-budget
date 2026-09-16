/**
 * Topic spend analysis (e.g. "vegetables", "coffee") — classifies expense titles
 * over a month window. Chat tools and future UI call this; no AI required.
 */
import type { Env } from '../../../types';
import { BudgetService, type BudgetCategoryWithUsage } from '../../budget-service';
import { centsToDollars, fmtCents, monthKeys, resolveYearMonth } from '../money';

export interface SpendTopicProduct {
  name: string;
  totalCents: number;
  byMonth: number[];
}

export interface SpendTopicAnalysisResult {
  topic: string;
  tokens: string[];
  months: string[];
  monthlyCents: number[];
  matchedCount: number;
  ranked: SpendTopicProduct[];
  totalCents: number;
  /** Ready-to-attach chat UI blocks (chart/table/stats/insight). */
  ui: SpendTopicUiBlock[];
  /** Human-readable summary for tool_result / assistant relay. */
  summary: string;
}

export type SpendTopicUiBlock =
  | {
      kind: 'chart';
      chart: {
        type: 'bar' | 'line';
        title: string;
        valueFormat: 'currency';
        data: Array<{ label: string; value: number }>;
      };
    }
  | {
      kind: 'table';
      table: { title: string; columns: string[]; rows: string[][] };
    }
  | {
      kind: 'stats';
      stats: Array<{ label: string; value: string; caption?: string }>;
    }
  | {
      kind: 'insight';
      insight: {
        title: string;
        body: string;
        bullets?: string[];
        tone: 'neutral';
      };
    };

const TOPIC_LEXICONS: Record<string, string[]> = {
  vegetables: [
    'tomato', 'tomatoes', 'cucumber', 'cucumbers', 'lettuce', 'spinach', 'kale',
    'broccoli', 'cauliflower', 'carrot', 'carrots', 'pepper', 'peppers', 'onion',
    'onions', 'garlic', 'potato', 'potatoes', 'celery', 'zucchini', 'squash',
    'cabbage', 'corn', 'bean', 'beans', 'pea', 'peas', 'asparagus', 'mushroom',
    'mushrooms', 'avocado', 'avocados', 'eggplant', 'radish', 'beet', 'beets',
    'veggie', 'vegetable', 'vegetables', 'salad', 'greens', 'arugula', 'bok choy',
    'watermelon', 'melon', 'melons',
  ],
  fruit: [
    'apple', 'apples', 'banana', 'bananas', 'orange', 'oranges', 'grape', 'grapes',
    'berry', 'berries', 'strawberry', 'blueberry', 'raspberry', 'mango', 'pineapple',
    'peach', 'pear', 'lemon', 'lime', 'fruit', 'kiwi', 'cherry', 'cherries', 'melon',
    'watermelon', 'cantaloupe',
  ],
  coffee: ['coffee', 'espresso', 'latte', 'cappuccino', 'starbucks', 'tim hortons'],
  gas: ['gas', 'fuel', 'petrol', 'shell', 'esso', 'petro', 'chevron'],
};

export function lexiconForTopic(topic: string): string[] {
  const key = topic.trim().toLowerCase();
  if (TOPIC_LEXICONS[key]) return TOPIC_LEXICONS[key];
  return key.split(/[\s,/]+/).filter((t) => t.length >= 3);
}

export function titleMatchesTopic(title: string, tokens: string[]): string | null {
  const t = title.toLowerCase();
  for (const token of tokens) {
    if (t.includes(token)) {
      return token.charAt(0).toUpperCase() + token.slice(1);
    }
  }
  return null;
}

function resolveCategoryId(
  categories: BudgetCategoryWithUsage[],
  name: string | undefined
): string | undefined {
  if (!name) return undefined;
  const q = name.trim().toLowerCase();
  return categories.find((c) => c.name.toLowerCase() === q)?.id;
}

export class SpendTopicAnalysis {
  private budget: BudgetService;

  constructor(env: Env, d1: D1Database) {
    this.budget = new BudgetService(env, d1);
  }

  async analyze(
    householdId: string,
    userId: string,
    input: {
      topic: string;
      month?: string;
      months?: number;
      category?: string;
      nowIso: string;
    }
  ): Promise<SpendTopicAnalysisResult | { empty: true; message: string }> {
    const topic = input.topic.trim();
    if (!topic) {
      return { empty: true, message: 'analyze_spend_topic needs a topic (e.g. "vegetables").' };
    }

    const tokens = lexiconForTopic(topic);
    const monthsBack = Math.min(Math.max(Number(input.months) || 12, 1), 24);
    const { year, month } = resolveYearMonth(input.month, input.nowIso);
    const months = monthKeys(year, month, monthsBack);
    const startDate = `${months[0]}-01`;
    const endExclusiveDate = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);

    const categories = await this.budget.getCategories(householdId, userId);
    const categoryId = resolveCategoryId(categories, input.category);

    const expenses = await this.budget.getExpenses(householdId, userId, {
      startDate,
      endDate: endExclusiveDate,
      categoryId,
      limit: 500,
    });

    type Acc = { name: string; total: number; byMonth: number[] };
    const products = new Map<string, Acc>();
    const monthly = new Array(monthsBack).fill(0) as number[];
    const monthIndex = new Map(months.map((m, i) => [m, i]));
    let matchedCount = 0;

    for (const e of expenses) {
      const product = titleMatchesTopic(e.title, tokens);
      if (!product) continue;
      matchedCount += 1;
      const ym = e.expense_date.slice(0, 7);
      const idx = monthIndex.get(ym);
      if (idx === undefined) continue;
      monthly[idx] += e.amount;
      const key = product.toLowerCase();
      let acc = products.get(key);
      if (!acc) {
        acc = { name: product, total: 0, byMonth: new Array(monthsBack).fill(0) };
        products.set(key, acc);
      }
      acc.total += e.amount;
      acc.byMonth[idx] += e.amount;
    }

    if (matchedCount === 0) {
      return {
        empty: true,
        message:
          `No expenses matched topic "${topic}" between ${months[0]} and ${months[months.length - 1]}. ` +
          `Tried tokens: ${tokens.slice(0, 12).join(', ')}. ` +
          `Tip: log grocery line items with product names, or narrow with category "Groceries".`,
      };
    }

    const rankedRaw = [...products.values()].sort((a, b) => b.total - a.total).slice(0, 12);
    const ranked: SpendTopicProduct[] = rankedRaw.map((p) => ({
      name: p.name,
      totalCents: p.total,
      byMonth: p.byMonth,
    }));
    const totalCents = ranked.reduce((s, p) => s + p.totalCents, 0);
    const shortMonths = months.map((m) => m.slice(5));

    const ui: SpendTopicUiBlock[] = [
      {
        kind: 'stats',
        stats: [
          { label: 'Topic total', value: fmtCents(totalCents), caption: `${monthsBack} months` },
          {
            label: 'Latest month',
            value: fmtCents(monthly[monthly.length - 1] ?? 0),
            caption: months[months.length - 1],
          },
          {
            label: 'Products',
            value: `${ranked.length}`,
            caption: `${matchedCount} matching expenses`,
          },
        ],
      },
      {
        kind: 'chart',
        chart: {
          type: monthsBack > 6 ? 'line' : 'bar',
          title: `${topic} spending by month`,
          valueFormat: 'currency',
          data: months.map((m, i) => ({
            label: shortMonths[i] ?? m,
            value: centsToDollars(monthly[i] ?? 0),
          })),
        },
      },
      {
        kind: 'table',
        table: {
          title: `${topic} — by product`,
          columns: ['Product', 'Total', 'Share'],
          rows: ranked.map((p) => [
            p.name,
            fmtCents(p.totalCents),
            `${totalCents > 0 ? Math.round((p.totalCents / totalCents) * 100) : 0}%`,
          ]),
        },
      },
      {
        kind: 'insight',
        insight: {
          title: `${topic} analysis`,
          body:
            ranked.length > 0
              ? `Top item is ${ranked[0].name} at ${fmtCents(ranked[0].totalCents)} ` +
                `(${totalCents > 0 ? Math.round((ranked[0].totalCents / totalCents) * 100) : 0}% of ${topic} spend).`
              : `Matched ${matchedCount} expenses totaling ${fmtCents(totalCents)}.`,
          bullets: ranked.slice(0, 4).map((p) => `${p.name}: ${fmtCents(p.totalCents)}`),
          tone: 'neutral',
        },
      },
    ];

    const summary =
      `Analyzed "${topic}" over ${months[0]}…${months[months.length - 1]}: ` +
      `${matchedCount} expenses, ${fmtCents(totalCents)} total.\n` +
      ranked.map((p) => `  • ${p.name}: ${fmtCents(p.totalCents)}`).join('\n') +
      `\nMonthly: ${months.map((m, i) => `${m}=${fmtCents(monthly[i] ?? 0)}`).join(', ')}`;

    return {
      topic,
      tokens,
      months,
      monthlyCents: monthly,
      matchedCount,
      ranked,
      totalCents,
      ui,
      summary,
    };
  }
}
