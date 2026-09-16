/**
 * Full-household finance tools for the Budget chat assistant — savings, income,
 * RRSP/TFSA, goals, planned spending, transfers, members, product trends, and
 * topic spend analysis (e.g. "vegetables"). Wired into BUDGET_CHAT_ASSISTANT.
 */
import type { GenerateToolDef } from '../../ai/provider';
import { now } from '../../utils/id';
import { SpendTopicAnalysis } from '../budget-analysis';
import { BudgetService, type BudgetCategoryWithUsage } from '../budget-service';
import { HouseholdService } from '../household-service';
import { SavingsService } from '../savings-service';
import { WishesService } from '../wishes-service';

import type {
  ChatAssistantToolContext,
  ChatAssistantToolReturn,
  ChatChartSpec,
  ChatTableSpec,
  ChatUiBlock,
} from './chat-room-service-core';

type Input = Record<string, unknown>;

function fmt(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function resolveMonth(input: unknown): { year: number; month: number; label: string } {
  const fallback = now().slice(0, 7);
  const raw = typeof input === 'string' && /^\d{4}-\d{2}$/.test(input) ? input : fallback;
  const [year, month] = raw.split('-').map((s) => parseInt(s, 10));
  return { year, month, label: monthLabel(year, month) };
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
function monthLabel(year: number, month: number): string {
  return `${MONTHS[month - 1] ?? month} ${year}`;
}

function dollars(cents: number): number {
  return Math.round(cents) / 100;
}

function resolveCategoryId(
  categories: BudgetCategoryWithUsage[],
  name: string | undefined
): string | undefined {
  if (!name) return undefined;
  const q = name.trim().toLowerCase();
  return categories.find((c) => c.name.toLowerCase() === q)?.id;
}

async function savingsEnabled(ctx: ChatAssistantToolContext): Promise<boolean> {
  try {
    const flag = await ctx.env.CONFIG_KV?.get('savings_enabled');
    return flag !== 'false';
  } catch {
    return true;
  }
}

function savingsDisabledMsg(): string {
  return 'Savings / pension features are disabled for this household right now.';
}

// ============ handlers ============

export async function listHouseholdMembers(ctx: ChatAssistantToolContext): Promise<string> {
  const hh = new HouseholdService(ctx.env, ctx.env.DB);
  const members = await hh.getMembers(ctx.householdId, ctx.userId);
  if (members.length === 0) return 'No household members found.';
  const lines = members.map(
    (m) =>
      `  • ${m.display_name || m.email || 'Member'} — role ${m.role}` +
      ` (member_id=${m.id}, user_id=${m.user_id})`
  );
  return (
    `Household members (${members.length}):\n${lines.join('\n')}\n` +
    `Note: expenses are household-shared (created_by = who logged them). ` +
    `Income and RRSP/TFSA accounts can be per member_id.`
  );
}

export async function listPlannedSpending(ctx: ChatAssistantToolContext, input: Input): Promise<string> {
  const budget = new BudgetService(ctx.env, ctx.env.DB);
  const timeline = await budget.getTimeline(ctx.householdId, ctx.userId);
  const statusFilter = asString(input.status)?.toLowerCase();
  const items = timeline.timeline
    .flatMap((tf) => tf.items.map((it) => ({ ...it, timeframeLabel: tf.label })))
    .filter((it) => !statusFilter || it.status?.toLowerCase() === statusFilter)
    .slice(0, 40);
  if (items.length === 0) return 'No planned spending items match.';
  const lines = items.map(
    (it) =>
      `[${it.id}] ${it.title} — est ${fmt(it.estimatedCostMin ?? 0)}` +
      (it.estimatedCostMax && it.estimatedCostMax !== it.estimatedCostMin
        ? `–${fmt(it.estimatedCostMax)}`
        : '') +
      ` · ${it.priority}/${it.status}` +
      (it.targetDate ? ` · target ${it.targetDate}` : '') +
      ` · ${it.timeframeLabel}`
  );
  return (
    `Planned spending (${items.length}; totals min ${fmt(timeline.totalPlanned.min)}` +
    ` / max ${fmt(timeline.totalPlanned.max)}):\n${lines.join('\n')}`
  );
}

export async function getCategoryBudgets(ctx: ChatAssistantToolContext, input: Input): Promise<string> {
  const { year, month, label } = resolveMonth(input.month);
  const budget = new BudgetService(ctx.env, ctx.env.DB);
  const overview = await budget.getMonthlyOverview(ctx.householdId, ctx.userId, year, month);
  const { entries, overAllocatedBy } = overview.subBudgets;
  if (entries.length === 0) {
    return `${label}: no per-category sub-budgets set. Monthly planned budget is ${fmt(overview.plannedBudget)}.`;
  }
  // Each line shows the resolved cap (with the percent for percent caps) and the
  // spend against it so the assistant can reason about over/under.
  const lines = entries
    .map((e) => {
      const capLabel =
        e.limit_type === 'percent'
          ? `${((e.percent_bps ?? 0) / 100).toFixed(e.percent_bps && e.percent_bps % 100 ? 1 : 0)}% (${fmt(e.cap_cents)})`
          : fmt(e.cap_cents);
      const over = e.over ? ' — OVER' : '';
      return `  • ${e.name}: ${capLabel}, spent ${fmt(e.spent_cents)}${over}`;
    })
    .sort();
  const warn =
    overAllocatedBy > 0 ? `\nNote: sub-budgets exceed the total by ${fmt(overAllocatedBy)}.` : '';
  return `${label} category sub-budgets (monthly planned ${fmt(overview.plannedBudget)}):\n${lines.join('\n')}${warn}`;
}

export async function listBudgetTransfers(ctx: ChatAssistantToolContext, input: Input): Promise<string> {
  const { year, month, label } = resolveMonth(input.month);
  const budget = new BudgetService(ctx.env, ctx.env.DB);
  const transfer = await budget.getTransferContext(ctx.householdId, ctx.userId, year, month);
  const destLines = transfer.destinations
    .slice(0, 12)
    .map((d) => `  • ${d.type}: ${d.label}${d.sublabel ? ` — ${d.sublabel}` : ''}`);
  return (
    `Transfer context for ${label}: leftover ${fmt(transfer.leftoverCents)}.\n` +
    (destLines.length ? `Destinations:\n${destLines.join('\n')}` : 'No transfer destinations available.')
  );
}

export async function getSavingsOverviewTool(
  ctx: ChatAssistantToolContext,
  input: Input
): Promise<string> {
  if (!(await savingsEnabled(ctx))) return savingsDisabledMsg();
  const { year, month, label } = resolveMonth(input.month);
  const savings = new SavingsService(ctx.env, ctx.env.DB);
  const overview = await savings.getOverview(ctx.householdId, ctx.userId, year, month);
  return [
    `SAVINGS OVERVIEW — ${label}:`,
    `- Income: ${fmt(overview.income.total)} (regular ${fmt(overview.income.regularTotal)}, irregular ${fmt(overview.income.irregularTotal)})`,
    `- Monthly payments (recurring): ${fmt(overview.spending.monthlyPayments)}`,
    `- Budget spendings: ${fmt(overview.spending.spendings)}`,
    `- Net savings: ${fmt(overview.netSavings)}`,
    `- YTD net: ${fmt(overview.ytdNet)}`,
  ].join('\n');
}

export async function listIncomeTool(ctx: ChatAssistantToolContext, input: Input): Promise<string> {
  if (!(await savingsEnabled(ctx))) return savingsDisabledMsg();
  const { year, month, label } = resolveMonth(input.month);
  const savings = new SavingsService(ctx.env, ctx.env.DB);
  const rows = await savings.listIncome(ctx.householdId, ctx.userId, year, month);
  const memberFilter = asString(input.member_id);
  const filtered = memberFilter ? rows.filter((r) => r.member_id === memberFilter) : rows;
  if (filtered.length === 0) return `No income entries for ${label}.`;
  const total = filtered.reduce((s, r) => s + r.amount_cents, 0);
  const lines = filtered.slice(0, 40).map(
    (r) =>
      `[${r.id}] ${r.income_date} — ${r.label} ${fmt(r.amount_cents)}` +
      ` (${r.source_type}${r.member_id ? `, member ${r.member_id}` : ''})`
  );
  return `${filtered.length} income entr${filtered.length === 1 ? 'y' : 'ies'} for ${label}, total ${fmt(total)}:\n${lines.join('\n')}`;
}

export async function listRecurringPaymentsTool(ctx: ChatAssistantToolContext): Promise<string> {
  if (!(await savingsEnabled(ctx))) return savingsDisabledMsg();
  const savings = new SavingsService(ctx.env, ctx.env.DB);
  const view = await savings.listRecurringPayments(ctx.householdId, ctx.userId);
  const items = view.items ?? [];
  if (items.length === 0) return 'No recurring payments / subscriptions recorded.';
  const lines = items.slice(0, 40).map(
    (r) =>
      `[${r.id}] ${r.label} ${fmt(r.amount_cents)}/mo` +
      `${r.group_label ? ` · ${r.group_label}` : ''}` +
      `${r.active ? '' : ' (inactive)'}`
  );
  return (
    `Recurring payments — active monthly total ${fmt(view.totalMonthlyCents)}:\n${lines.join('\n')}`
  );
}

export async function listSavingsGoalsTool(ctx: ChatAssistantToolContext): Promise<string> {
  if (!(await savingsEnabled(ctx))) return savingsDisabledMsg();
  const savings = new SavingsService(ctx.env, ctx.env.DB);
  const goals = await savings.listGoals(ctx.householdId, ctx.userId);
  if (goals.length === 0) return 'No savings goals set.';
  const lines = goals.map(
    (g) =>
      `[${g.id}] ${g.name} (${g.type}) — ${fmt(g.current_amount_cents)} / ${fmt(g.target_amount_cents)}` +
      ` · pace ~${fmt(g.paceCents)}/mo` +
      (g.target_date ? ` · by ${g.target_date}` : '') +
      ` · ${g.status}`
  );
  return `Savings goals (${goals.length}):\n${lines.join('\n')}`;
}

export async function getRegisteredAccountsTool(ctx: ChatAssistantToolContext): Promise<string> {
  if (!(await savingsEnabled(ctx))) return savingsDisabledMsg();
  const savings = new SavingsService(ctx.env, ctx.env.DB);
  const accounts = await savings.listAccounts(ctx.householdId, ctx.userId);
  if (accounts.length === 0) return 'No registered accounts (RRSP/TFSA/FHSA/etc.) on file.';
  const lines = accounts.map(
    (a) =>
      `[${a.id}] ${a.account_type.toUpperCase()}` +
      `${a.institution ? ` @ ${a.institution}` : ''}` +
      ` — balance ${fmt(a.balance_cents)}` +
      `${a.member_id ? ` · member ${a.member_id}` : ' · household'}` +
      (a.annual_goal_cents != null ? ` · annual goal ${fmt(a.annual_goal_cents)}` : '')
  );
  return `Registered accounts (${accounts.length}):\n${lines.join('\n')}`;
}

export async function getPensionOverviewTool(
  ctx: ChatAssistantToolContext,
  input: Input
): Promise<string> {
  if (!(await savingsEnabled(ctx))) return savingsDisabledMsg();
  const year = Number(input.year) || new Date().getUTCFullYear();
  const savings = new SavingsService(ctx.env, ctx.env.DB);
  const overview = await savings.getPensionOverview(ctx.householdId, ctx.userId, year);
  const totals = overview.totals;
  const groupLines = overview.groups.slice(0, 8).map((g) => {
    const name = g.memberName || g.memberId || 'Household';
    return `  • ${name}: ${g.accounts.length} account(s), balance ${fmt(g.totalBalanceCents)}`;
  });
  return [
    `PENSION / REGISTERED OVERVIEW — ${year}:`,
    `- Total balance: ${fmt(totals.totalBalanceCents)}`,
    `- Room remaining: ${fmt(totals.totalRoomRemainingCents)}`,
    `- Contributed (self): ${fmt(totals.totalContributedSelfCents)}`,
    `- Contributed (employer): ${fmt(totals.totalContributedEmployerCents)}`,
    groupLines.length ? `By member:\n${groupLines.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function listWishesTool(ctx: ChatAssistantToolContext): Promise<string> {
  const wishes = new WishesService(ctx.env, ctx.env.DB);
  const rows = await wishes.listWishes(ctx.householdId, ctx.userId);
  if (rows.length === 0) return 'No wishes on the wishlist.';
  const lines = rows.slice(0, 30).map(
    (w) =>
      `[${w.id}] ${w.title}` +
      (w.status ? ` · ${w.status}` : '') +
      (w.estimated_cost_cents != null ? ` · ~${fmt(w.estimated_cost_cents)}` : '')
  );
  return `Wishes (${rows.length}):\n${lines.join('\n')}`;
}

export async function getProductTrendsTool(
  ctx: ChatAssistantToolContext,
  input: Input
): Promise<ChatAssistantToolReturn> {
  const budget = new BudgetService(ctx.env, ctx.env.DB);
  const categories = await budget.getCategories(ctx.householdId, ctx.userId);
  const categoryName = asString(input.category) ?? 'Groceries';
  let categoryId = resolveCategoryId(categories, categoryName);
  if (!categoryId && categoryName.toLowerCase() === 'groceries') {
    const grocery = await budget.resolveGroceriesCategory(ctx.householdId, ctx.userId).catch(() => null);
    categoryId = grocery?.id;
  }
  if (!categoryId) return `No category matching "${categoryName}".`;
  const { year, month, label } = resolveMonth(input.month);
  const monthsBack = Math.min(Math.max(Number(input.months) || 6, 1), 24);
  const trends = await budget.getCategoryProductTrends(
    ctx.householdId,
    ctx.userId,
    categoryId,
    year,
    month,
    monthsBack
  );
  const top = trends.products.slice(0, 12);
  if (top.length === 0) return `No product spend in ${categoryName} for the last ${monthsBack} months ending ${label}.`;

  const lines = top.map(
    (p) =>
      `  • ${p.name}: total ${fmt(p.total)} (${p.count}x) · this month ${fmt(p.currentAmount)} · trend ${p.trend}`
  );
  const chart: ChatChartSpec = {
    type: 'bar',
    title: `${categoryName} — top products (${monthsBack} mo)`,
    valueFormat: 'currency',
    data: top.slice(0, 8).map((p) => ({ label: p.name.slice(0, 14), value: dollars(p.total) })),
  };
  const table: ChatTableSpec = {
    title: 'Products',
    columns: ['Product', 'Total', 'This mo', 'Trend'],
    rows: top.map((p) => [p.name, fmt(p.total), fmt(p.currentAmount), p.trend]),
  };
  const ui: ChatUiBlock[] = [
    { kind: 'chart', chart },
    { kind: 'table', table },
  ];
  return {
    result:
      `Product trends for ${categoryName} (ending ${label}, ${monthsBack} months):\n` +
      `Monthly category totals: ${trends.monthlyTotals.map((c, i) => `${trends.months[i]}=${fmt(c)}`).join(', ')}\n` +
      lines.join('\n'),
    ui,
  };
}

/** Thin chat adapter over {@link SpendTopicAnalysis}. */
export async function analyzeSpendTopicTool(
  ctx: ChatAssistantToolContext,
  input: Input
): Promise<ChatAssistantToolReturn> {
  const topic = asString(input.topic);
  if (!topic) return 'analyze_spend_topic needs a topic (e.g. "vegetables").';
  const analysis = new SpendTopicAnalysis(ctx.env, ctx.env.DB);
  const result = await analysis.analyze(ctx.householdId, ctx.userId, {
    topic,
    month: asString(input.month),
    months: typeof input.months === 'number' ? input.months : undefined,
    category: asString(input.category),
    nowIso: now(),
  });
  if ('empty' in result) return result.message;
  return {
    result: result.summary,
    ui: result.ui as ChatUiBlock[],
  };
}

/** Compact household brief appended to every assistant turn. */
export async function buildFullHouseholdContext(ctx: ChatAssistantToolContext): Promise<string> {
  const parts: string[] = [];
  try {
    const hh = new HouseholdService(ctx.env, ctx.env.DB);
    const members = await hh.getMembers(ctx.householdId, ctx.userId);
    parts.push(
      'HOUSEHOLD MEMBERS:\n' +
        members
          .map(
            (m) =>
              `  • ${m.display_name || m.email || 'Member'} (${m.role}, member_id=${m.id})`
          )
          .join('\n') +
        '\n(Expenses are household-shared; income/RRSP may be per member_id.)'
    );
  } catch (e) {
    console.error('[budget-chat] members context failed:', e);
  }

  try {
    const budget = new BudgetService(ctx.env, ctx.env.DB);
    const y = parseInt(now().slice(0, 4), 10);
    const m = parseInt(now().slice(5, 7), 10);
    const overview = await budget.getMonthlyOverview(ctx.householdId, ctx.userId, y, m);
    parts.push(
      `BUDGET THIS MONTH (${monthLabel(y, m)}): planned ${fmt(overview.plannedBudget)}, ` +
        `spent ${fmt(overview.actualSpent)}, remaining ${fmt(overview.remainingBudget)}.`
    );
    // Avoid getTimeline here — it loads every expense/item and can blow the
    // waitUntil budget on receipt turns. Planned detail is available via tools.
  } catch (e) {
    console.error('[budget-chat] budget context failed:', e);
  }

  if (await savingsEnabled(ctx)) {
    try {
      const savings = new SavingsService(ctx.env, ctx.env.DB);
      const y = parseInt(now().slice(0, 4), 10);
      const m = parseInt(now().slice(5, 7), 10);
      const overview = await savings.getOverview(ctx.householdId, ctx.userId, y, m);
      parts.push(
        `SAVINGS SNAPSHOT: income ${fmt(overview.income.total)}, ` +
          `recurring ${fmt(overview.spending.monthlyPayments)}, net ${fmt(overview.netSavings)}.`
      );
      const goals = await savings.listGoals(ctx.householdId, ctx.userId);
      const activeGoals = goals.filter((g) => g.status !== 'archived').slice(0, 3);
      if (activeGoals.length > 0) {
        parts.push(
          'SAVINGS GOALS:\n' +
            activeGoals
              .map(
                (g) =>
                  `  • ${g.name}: ${fmt(g.current_amount_cents)}/${fmt(g.target_amount_cents)}`
              )
              .join('\n')
        );
      }
      const accounts = await savings.listAccounts(ctx.householdId, ctx.userId);
      if (accounts.length > 0) {
        parts.push(
          'REGISTERED ACCOUNTS:\n' +
            accounts
              .slice(0, 6)
              .map(
                (a) =>
                  `  • ${a.account_type.toUpperCase()} ${fmt(a.balance_cents)}` +
                  (a.member_id ? ` (member ${a.member_id})` : '')
              )
              .join('\n')
        );
      }
    } catch (e) {
      console.error('[budget-chat] savings context failed:', e);
    }
  }

  return parts.filter(Boolean).join('\n\n');
}

export const FINANCE_READ_TOOLS: GenerateToolDef[] = [
  {
    name: 'list_household_members',
    description:
      'List household members with display names, roles, and member_ids. Use before answering per-person income/RRSP questions.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'list_planned_spending',
    description: 'List planned / upcoming spending items from the budget timeline.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Optional status filter, e.g. planned, in_progress.' },
      },
    },
  },
  {
    name: 'get_category_budgets',
    description: 'Get per-category monthly budget targets for a month.',
    input_schema: {
      type: 'object',
      properties: { month: { type: 'string', description: "YYYY-MM. Omit for current month." } },
    },
  },
  {
    name: 'list_budget_transfers',
    description: 'Get leftover budget and available transfer destinations for a month.',
    input_schema: {
      type: 'object',
      properties: { month: { type: 'string', description: "YYYY-MM." } },
    },
  },
  {
    name: 'get_savings_overview',
    description:
      'Income, recurring payments, budget spendings, and net savings for a month. Use for affordability and savings questions.',
    input_schema: {
      type: 'object',
      properties: { month: { type: 'string', description: "YYYY-MM." } },
    },
  },
  {
    name: 'list_income',
    description: 'List income entries for a month. Optional member_id filter.',
    input_schema: {
      type: 'object',
      properties: {
        month: { type: 'string' },
        member_id: { type: 'string', description: 'From list_household_members.' },
      },
    },
  },
  {
    name: 'list_recurring_payments',
    description: 'List recurring bills and subscriptions with monthly totals.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'list_savings_goals',
    description: 'List savings goals with progress and monthly pace.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_registered_accounts',
    description: 'List RRSP/TFSA/FHSA/etc. registered accounts and balances (per member when set).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_pension_overview',
    description: 'Pension / registered contribution overview for a calendar year (balances, room, by member).',
    input_schema: {
      type: 'object',
      properties: { year: { type: 'number', description: 'Calendar year. Default current.' } },
    },
  },
  {
    name: 'list_wishes',
    description: 'List wishlist / long-term wish items.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_product_trends',
    description:
      'Product-level spend trends inside a category (e.g. Groceries). Returns text plus a chart/table.',
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Category name. Default Groceries.' },
        month: { type: 'string', description: 'Anchor month YYYY-MM.' },
        months: { type: 'number', description: 'Window 1–24. Default 6.' },
      },
    },
  },
  {
    name: 'analyze_spend_topic',
    description:
      'Classify and aggregate spending for a topic like "vegetables", "coffee", or "gas" across months. Prefer this for produce/group questions. Auto-attaches chart, table, stats, and insight — do not invent chart numbers.',
    input_schema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'e.g. vegetables, fruit, coffee, gas.' },
        month: { type: 'string', description: 'End month YYYY-MM. Default current.' },
        months: { type: 'number', description: 'How many months back (1–24). Default 12.' },
        category: { type: 'string', description: 'Optional category filter, e.g. Groceries.' },
      },
      required: ['topic'],
    },
  },
];

export async function runFinanceTool(
  ctx: ChatAssistantToolContext,
  name: string,
  input: Input
): Promise<ChatAssistantToolReturn | null> {
  switch (name) {
    case 'list_household_members':
      return listHouseholdMembers(ctx);
    case 'list_planned_spending':
      return listPlannedSpending(ctx, input);
    case 'get_category_budgets':
      return getCategoryBudgets(ctx, input);
    case 'list_budget_transfers':
      return listBudgetTransfers(ctx, input);
    case 'get_savings_overview':
      return getSavingsOverviewTool(ctx, input);
    case 'list_income':
      return listIncomeTool(ctx, input);
    case 'list_recurring_payments':
      return listRecurringPaymentsTool(ctx);
    case 'list_savings_goals':
      return listSavingsGoalsTool(ctx);
    case 'get_registered_accounts':
      return getRegisteredAccountsTool(ctx);
    case 'get_pension_overview':
      return getPensionOverviewTool(ctx, input);
    case 'list_wishes':
      return listWishesTool(ctx);
    case 'get_product_trends':
      return getProductTrendsTool(ctx, input);
    case 'analyze_spend_topic':
      return analyzeSpendTopicTool(ctx, input);
    default:
      return null;
  }
}
