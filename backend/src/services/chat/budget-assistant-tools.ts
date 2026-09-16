/**
 * Budget chat assistant tooling — the "smart budget adviser".
 *
 * Full household finance access: spendings, planning, goals, income, RRSP/TFSA,
 * recurring bills, transfers, wishes, members — plus inline charts/tables.
 * Finance read/analysis tools live in {@link ./budget-assistant-finance}.
 */
import type { GenerateToolDef } from '../../ai/provider';
import type { Expense } from '../../db/schema-budget';
import { now } from '../../utils/id';
import {
  ReceiptScanService,
  RecurringSpendAnalysis,
  toReceiptDraft,
  toReceiptMime,
} from '../budget-analysis';
import {
  BudgetService,
  type BudgetCategoryWithUsage,
  type MonthlyOverview,
} from '../budget-service';

import {
  buildFullHouseholdContext,
  FINANCE_READ_TOOLS,
  runFinanceTool,
} from './budget-assistant-finance';
import type {
  ChatAssistantCapability,
  ChatAssistantToolContext,
  ChatAssistantToolReturn,
  ChatChartSpec,
  ChatDiagramSpec,
  ChatInsightSpec,
  ChatStatSpec,
  ChatTableSpec,
} from './chat-room-service-core';

// ============ money + date helpers ============

/** cents → "$12.50". */
function fmt(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

/** A model-supplied dollar amount → integer cents (null when not a number). */
function toCents(dollars: unknown): number | null {
  const n = typeof dollars === 'number' ? dollars : Number(dollars);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** Today's date as YYYY-MM-DD (server clock). */
function today(): string {
  return now().slice(0, 10);
}

/** Parse a 'YYYY-MM' string to {year, month}; falls back to the current month. */
function resolveMonth(input: unknown): { year: number; month: number; label: string } {
  const fallback = now().slice(0, 7); // YYYY-MM
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

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

// ============ budget snapshot (awareness + overview tool) ============

/** Sum a month's expenses per category id (null → 'uncategorized'). */
function spentByCategory(expenses: Expense[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const e of expenses) {
    const key = e.category_id ?? 'uncategorized';
    map.set(key, (map.get(key) ?? 0) + e.amount);
  }
  return map;
}

/** Parse the goal's per-category budget JSON ({ categoryId: cents }). */
function categoryBudgets(overview: MonthlyOverview): Record<string, number> {
  const raw = overview.goal.category_budgets;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, number>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Build a compact, model-friendly budget snapshot for a month. Used both as the
 * always-on awareness context and as the `get_budget_overview` tool result.
 */
async function budgetSnapshot(
  ctx: ChatAssistantToolContext,
  budget: BudgetService,
  year: number,
  month: number
): Promise<string> {
  const overview = await budget.getMonthlyOverview(ctx.householdId, ctx.userId, year, month);
  const categories = await budget.getCategories(ctx.householdId, ctx.userId);
  const nameById = new Map(categories.map((c) => [c.id, c.name]));
  const spent = spentByCategory(overview.expenses);
  const budgets = categoryBudgets(overview);

  // Union of categories with either spend or a set budget this month.
  const catIds = new Set<string>([...spent.keys(), ...Object.keys(budgets)]);
  const catLines = [...catIds]
    .map((id) => ({
      name: id === 'uncategorized' ? 'Uncategorized' : nameById.get(id) ?? 'Unknown',
      spent: spent.get(id) ?? 0,
      budget: budgets[id] ?? null,
    }))
    .sort((a, b) => b.spent - a.spent)
    .slice(0, 12)
    .map(
      (c) =>
        `  • ${c.name}: ${fmt(c.spent)}${c.budget != null ? ` / ${fmt(c.budget)}` : ' (no budget)'}`
    );

  const recent = [...overview.expenses]
    .sort((a, b) => (a.expense_date < b.expense_date ? 1 : -1))
    .slice(0, 6)
    .map(
      (e) =>
        `  • ${e.title} ${fmt(e.amount)} (${e.expense_date}${
          e.category_id ? `, ${nameById.get(e.category_id) ?? 'Unknown'}` : ''
        })`
    );

  return [
    `CURRENT BUDGET — ${monthLabel(year, month)} (all figures the household's real data):`,
    `- Monthly budget: ${overview.plannedBudget > 0 ? fmt(overview.plannedBudget) : 'not set'}` +
      ` | Spent: ${fmt(overview.actualSpent)}` +
      ` | Remaining: ${fmt(overview.remainingBudget)}` +
      (overview.savedTotal > 0 ? ` | Saved on deals: ${fmt(overview.savedTotal)}` : ''),
    catLines.length > 0 ? `- By category (spent / budget):\n${catLines.join('\n')}` : '- No spending recorded yet this month.',
    recent.length > 0 ? `- Recent expenses:\n${recent.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Resolve a category NAME (as the model gave it) to an id, case-insensitively. */
function resolveCategoryId(
  categories: BudgetCategoryWithUsage[],
  name: string | undefined
): string | undefined {
  if (!name) return undefined;
  const q = name.trim().toLowerCase();
  return categories.find((c) => c.name.toLowerCase() === q)?.id;
}

// ============ tool handlers ============

type Input = Record<string, unknown>;

async function getBudgetOverview(ctx: ChatAssistantToolContext, input: Input): Promise<string> {
  const { year, month } = resolveMonth(input.month);
  const budget = new BudgetService(ctx.env, ctx.env.DB);
  return budgetSnapshot(ctx, budget, year, month);
}

async function listExpenses(ctx: ChatAssistantToolContext, input: Input): Promise<string> {
  const budget = new BudgetService(ctx.env, ctx.env.DB);
  const categories = await budget.getCategories(ctx.householdId, ctx.userId);
  const categoryId = resolveCategoryId(categories, asString(input.category));
  const search = asString(input.search)?.toLowerCase();
  const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 50);
  // Fetch a wider window when searching titles client-side.
  const expenses = await budget.getExpenses(ctx.householdId, ctx.userId, {
    startDate: asString(input.start_date),
    endDate: asString(input.end_date),
    categoryId,
    limit: search ? 200 : limit,
  });
  const filtered = search
    ? expenses.filter((e) => e.title.toLowerCase().includes(search)).slice(0, limit)
    : expenses;
  if (filtered.length === 0) return 'No expenses match that filter.';
  const nameById = new Map(categories.map((c) => [c.id, c.name]));
  const total = filtered.reduce((s, e) => s + e.amount, 0);
  const lines = filtered.map(
    (e) =>
      `[${e.id}] ${e.expense_date} — ${e.title} ${fmt(e.amount)}` +
      `${e.category_id ? ` (${nameById.get(e.category_id) ?? 'Unknown'})` : ''}` +
      `${e.saved_amount > 0 ? ` [saved ${fmt(e.saved_amount)}]` : ''}` +
      (e.created_by ? ` [logged by ${e.created_by}]` : '')
  );
  return `${filtered.length} expense(s), total ${fmt(total)}:\n${lines.join('\n')}`;
}

async function getSpendingBreakdown(ctx: ChatAssistantToolContext, input: Input): Promise<string> {
  const { year, month, label } = resolveMonth(input.month);
  const budget = new BudgetService(ctx.env, ctx.env.DB);
  const overview = await budget.getMonthlyOverview(ctx.householdId, ctx.userId, year, month);
  const categories = await budget.getCategories(ctx.householdId, ctx.userId);
  const nameById = new Map(categories.map((c) => [c.id, c.name]));
  const spent = spentByCategory(overview.expenses);
  if (spent.size === 0) return `No spending recorded for ${label}.`;
  const rows = [...spent.entries()]
    .map(([id, cents]) => ({
      name: id === 'uncategorized' ? 'Uncategorized' : nameById.get(id) ?? 'Unknown',
      cents,
    }))
    .sort((a, b) => b.cents - a.cents);
  const total = rows.reduce((s, r) => s + r.cents, 0);
  const lines = rows.map(
    (r) => `  • ${r.name}: ${fmt(r.cents)} (${Math.round((r.cents / total) * 100)}%)`
  );
  return `Spending breakdown for ${label} — total ${fmt(total)}:\n${lines.join('\n')}`;
}

async function addExpense(ctx: ChatAssistantToolContext, input: Input): Promise<string> {
  const title = asString(input.title);
  const amount = toCents(input.amount);
  if (!title) return 'An expense needs a title. Ask the member what it was for.';
  if (amount === null) return 'An expense needs a valid amount in dollars.';
  const budget = new BudgetService(ctx.env, ctx.env.DB);
  const categories = await budget.getCategories(ctx.householdId, ctx.userId);
  const categoryId = resolveCategoryId(categories, asString(input.category));
  const saved = toCents(input.saved) ?? 0;
  const expense = await budget.addExpense(ctx.householdId, ctx.userId, {
    title,
    amount,
    expenseDate: asString(input.date) ?? today(),
    categoryId,
    savedAmount: saved,
  });
  const catNote = categoryId
    ? ` under ${categories.find((c) => c.id === categoryId)?.name}`
    : asString(input.category)
      ? ` (no category "${asString(input.category)}" found — left uncategorized)`
      : '';
  return `Added "${expense.title}" ${fmt(expense.amount)}${catNote}, dated ${expense.expense_date}.`;
}

async function editExpense(ctx: ChatAssistantToolContext, input: Input): Promise<string> {
  const id = asString(input.expense_id);
  if (!id) return 'Editing an expense needs its id (from list_expenses).';
  const budget = new BudgetService(ctx.env, ctx.env.DB);
  const patch: {
    title?: string;
    amount?: number;
    expenseDate?: string;
    categoryId?: string | null;
  } = {};
  const title = asString(input.title);
  if (title) patch.title = title;
  if (input.amount !== undefined) {
    const cents = toCents(input.amount);
    if (cents === null) return 'The new amount must be a valid dollar figure.';
    patch.amount = cents;
  }
  const date = asString(input.date);
  if (date) patch.expenseDate = date;
  if (input.category !== undefined) {
    const categories = await budget.getCategories(ctx.householdId, ctx.userId);
    patch.categoryId = resolveCategoryId(categories, asString(input.category)) ?? null;
  }
  if (Object.keys(patch).length === 0) return 'Nothing to change was provided.';
  try {
    const updated = await budget.updateExpense(ctx.householdId, id, ctx.userId, patch);
    return `Updated "${updated.title}" — now ${fmt(updated.amount)}, dated ${updated.expense_date}.`;
  } catch {
    return "I couldn't find that expense to edit.";
  }
}

async function deleteExpense(ctx: ChatAssistantToolContext, input: Input): Promise<string> {
  const id = asString(input.expense_id);
  if (!id) return 'Deleting an expense needs its id (from list_expenses).';
  const budget = new BudgetService(ctx.env, ctx.env.DB);
  try {
    const existing = await budget.getExpense(ctx.householdId, id, ctx.userId);
    await budget.deleteExpense(ctx.householdId, id, ctx.userId);
    return `Deleted "${existing.title}" (${fmt(existing.amount)}).`;
  } catch {
    return "I couldn't find that expense to delete.";
  }
}

async function setMonthlyBudget(ctx: ChatAssistantToolContext, input: Input): Promise<string> {
  const amount = toCents(input.amount);
  if (amount === null) return 'Setting a monthly budget needs a valid dollar amount.';
  const { year, month, label } = resolveMonth(input.month);
  const budget = new BudgetService(ctx.env, ctx.env.DB);
  await budget.setMonthlyGoal(ctx.householdId, ctx.userId, year, month, { plannedBudget: amount });
  return `Set the ${label} budget to ${fmt(amount)}.`;
}

async function createCategory(ctx: ChatAssistantToolContext, input: Input): Promise<string> {
  const name = asString(input.name);
  if (!name) return 'A new category needs a name.';
  const budget = new BudgetService(ctx.env, ctx.env.DB);
  const existing = await budget.getCategories(ctx.householdId, ctx.userId);
  if (resolveCategoryId(existing, name)) return `A "${name}" category already exists.`;
  const category = await budget.createCategory(ctx.householdId, ctx.userId, {
    name,
    color: asString(input.color),
    icon: asString(input.icon),
  });
  return `Created the "${category.name}" category.`;
}

async function createPlannedSpending(ctx: ChatAssistantToolContext, input: Input): Promise<string> {
  const title = asString(input.title);
  if (!title) return 'A planned spending needs a title.';
  const budget = new BudgetService(ctx.env, ctx.env.DB);
  const categories = await budget.getCategories(ctx.householdId, ctx.userId);
  const categoryId = resolveCategoryId(categories, asString(input.category));
  const cents = toCents(input.amount);
  const item = await budget.createBudgetItem(ctx.householdId, ctx.userId, {
    title,
    categoryId,
    priority: asString(input.priority) ?? 'medium',
    estimatedCostMin: cents ?? undefined,
    estimatedCostMax: cents ?? undefined,
    targetDate: asString(input.target_date),
  });
  return `Planned "${item.title}"${cents != null ? ` (~${fmt(cents)})` : ''}${
    item.target_date ? `, targeted ${item.target_date}` : ''
  }.`;
}

/**
 * Thin adapter: load attachment from R2 → domain ReceiptScanService → draft.
 * Does NOT persist expenses — member confirms in BudgetReceiptScanScreen.
 */
async function scanReceiptForReview(ctx: ChatAssistantToolContext): Promise<ChatAssistantToolReturn> {
  const attachment = ctx.imageAttachments.find(
    (a) =>
      a.mimeType === undefined ||
      a.mimeType.startsWith('image/') ||
      a.mimeType === 'application/pdf'
  );
  if (!attachment) {
    return 'There was no receipt attached to scan. Ask the member to share a photo of the receipt.';
  }
  const object = await ctx.env.REPORTS_BUCKET.get(attachment.key);
  if (!object) return "I couldn't open the receipt image. Ask the member to send it again.";

  const scanner = new ReceiptScanService(ctx.env, ctx.env.DB);
  const scan = await scanner.scanReceipt(ctx.householdId, ctx.userId, {
    data: await object.arrayBuffer(),
    mimeType: toReceiptMime(attachment.mimeType),
  });
  if (scan.items.length === 0) {
    return "I couldn't read any items off that receipt. Ask for a clearer, well-lit photo of the whole receipt.";
  }

  const draft = toReceiptDraft(scan);
  const total = draft.items.reduce((s, i) => s + i.amount, 0);
  const saved = draft.items.reduce((s, i) => s + i.saved_amount, 0);
  const itemList = draft.items.map((i) => `${i.name} (${fmt(i.amount)})`).join(', ');
  const expenseDate = draft.purchase_date ?? today();
  return {
    result:
      `Scanned ${draft.items.length} item${draft.items.length === 1 ? '' : 's'} totaling ` +
      `${fmt(total)}` +
      (draft.vendor ? ` from ${draft.vendor}` : '') +
      ` (dated ${expenseDate}).` +
      (saved > 0 ? ` Detected ${fmt(saved)} in savings.` : '') +
      ` Items: ${itemList}. ` +
      `NOT saved yet — the member must review each item (name, amount, savings, category) and confirm in the app before anything is logged.`,
    receiptDraft: draft,
  };
}

async function analyzeRegularMonthlySpending(
  ctx: ChatAssistantToolContext,
  input: Input
): Promise<string> {
  const analysis = new RecurringSpendAnalysis(ctx.env, ctx.env.DB);
  const result = await analysis.analyze(ctx.householdId, ctx.userId, {
    month: asString(input.month),
    months: typeof input.months === 'number' ? input.months : undefined,
    nowIso: now(),
  });
  return result.summary;
}

// ============ UI tools (charts / stat cards) ============

function showChart(input: Input): ChatAssistantToolReturn {
  const type =
    input.type === 'pie' || input.type === 'donut' || input.type === 'line' ? input.type : 'bar';
  const rawData = Array.isArray(input.data) ? input.data : [];
  const data: ChatChartSpec['data'] = [];
  for (const d of rawData) {
    const row = d as Input;
    const label = asString(row.label);
    const value = Number(row.value);
    if (!label || !Number.isFinite(value)) continue;
    // Colour is client-owned (brand tokens) — never accept hex from the model.
    data.push({ label, value });
    if (data.length >= 12) break;
  }
  if (data.length === 0) return 'A chart needs at least one {label, value} data point.';
  const valueFormat =
    input.value_format === 'number' || input.value_format === 'percent'
      ? input.value_format
      : 'currency';
  const chart: ChatChartSpec = { type, title: asString(input.title), valueFormat, data };
  return { result: `Rendered a ${type} chart with ${data.length} points.`, ui: [{ kind: 'chart', chart }] };
}

function showStats(input: Input): ChatAssistantToolReturn {
  const rawStats = Array.isArray(input.stats) ? input.stats : [];
  const stats = rawStats
    .map((s) => {
      const row = s as Input;
      const label = asString(row.label);
      const value = asString(row.value);
      if (!label || !value) return null;
      const tone =
        row.tone === 'positive' || row.tone === 'warning' || row.tone === 'negative'
          ? row.tone
          : 'neutral';
      return { label, value, caption: asString(row.caption), tone } as ChatStatSpec;
    })
    .filter((s): s is ChatStatSpec => s !== null)
    .slice(0, 6);
  if (stats.length === 0) return 'A stat card needs at least one {label, value}.';
  return { result: `Rendered ${stats.length} stat card(s).`, ui: [{ kind: 'stats', stats }] };
}

function showTable(input: Input): ChatAssistantToolReturn {
  const title = asString(input.title);
  const columns = Array.isArray(input.columns)
    ? input.columns.map((c) => String(c)).filter(Boolean).slice(0, 6)
    : [];
  const rows = Array.isArray(input.rows)
    ? input.rows
        .filter((r): r is unknown[] => Array.isArray(r))
        .map((r) => r.map((c) => String(c ?? '')).slice(0, columns.length || 6))
        .slice(0, 20)
    : [];
  if (columns.length === 0 || rows.length === 0) {
    return 'A table needs columns[] and at least one row.';
  }
  const table: ChatTableSpec = { title, columns, rows };
  return { result: `Rendered a table with ${rows.length} row(s).`, ui: [{ kind: 'table', table }] };
}

function showInsight(input: Input): ChatAssistantToolReturn {
  const title = asString(input.title);
  const body = asString(input.body);
  if (!title || !body) return 'An insight needs title and body.';
  const tone =
    input.tone === 'positive' || input.tone === 'warning' || input.tone === 'negative'
      ? input.tone
      : 'neutral';
  const bullets = Array.isArray(input.bullets)
    ? input.bullets.map((b) => String(b)).filter(Boolean).slice(0, 6)
    : undefined;
  const insight: ChatInsightSpec = { title, body, bullets, tone };
  return { result: 'Rendered an insight card.', ui: [{ kind: 'insight', insight }] };
}

function showDiagram(input: Input): ChatAssistantToolReturn {
  const rawNodes = Array.isArray(input.nodes) ? input.nodes : [];
  const nodes: ChatDiagramSpec['nodes'] = [];
  for (const n of rawNodes) {
    const row = n as Input;
    const id = asString(row.id);
    const label = asString(row.label);
    if (!id || !label) continue;
    nodes.push({ id, label, value: asString(row.value) });
    if (nodes.length >= 12) break;
  }
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges: ChatDiagramSpec['edges'] = [];
  for (const e of Array.isArray(input.edges) ? input.edges : []) {
    const row = e as Input;
    const from = asString(row.from);
    const to = asString(row.to);
    if (!from || !to || !nodeIds.has(from) || !nodeIds.has(to)) continue;
    edges.push({ from, to, label: asString(row.label) });
    if (edges.length >= 16) break;
  }
  if (nodes.length < 2) return 'A diagram needs at least two nodes.';
  const diagram: ChatDiagramSpec = { title: asString(input.title), nodes, edges };
  return { result: `Rendered a diagram with ${nodes.length} nodes.`, ui: [{ kind: 'diagram', diagram }] };
}

// ============ tool schemas ============

const CATEGORY_PROP = {
  category: { type: 'string', description: 'Category name exactly as it appears in the budget.' },
} as const;

const TOOLS: GenerateToolDef[] = [
  {
    name: 'get_budget_overview',
    description:
      "Get the household's budget snapshot for a month: monthly budget, total spent, remaining, savings, and per-category spend vs budget. Use for 'how am I doing', 'what's my budget', 'am I over'. Defaults to the current month.",
    input_schema: {
      type: 'object',
      properties: { month: { type: 'string', description: "Month as 'YYYY-MM'. Omit for current month." } },
    },
  },
  {
    name: 'get_spending_breakdown',
    description:
      'Get spending totals grouped by category for a month, with each share of the total. Use before drawing a breakdown chart or answering "where is my money going". Defaults to the current month.',
    input_schema: {
      type: 'object',
      properties: { month: { type: 'string', description: "Month as 'YYYY-MM'. Omit for current month." } },
    },
  },
  {
    name: 'list_expenses',
    description:
      'List recorded expenses, newest first, optionally filtered by category and/or date range. Returns each expense id (needed to edit or delete). Amounts are the real recorded values.',
    input_schema: {
      type: 'object',
      properties: {
        ...CATEGORY_PROP,
        start_date: { type: 'string', description: "Inclusive start date 'YYYY-MM-DD'." },
        end_date: { type: 'string', description: "Exclusive end date 'YYYY-MM-DD'." },
        search: { type: 'string', description: 'Optional title substring filter (e.g. "tomato").' },
        limit: { type: 'number', description: 'Max rows (1–50, default 20).' },
      },
    },
  },
  {
    name: 'add_expense',
    description:
      'Record a single expense (spending) in the household budget. Use when the member says they spent/bought/paid for something. Amounts are in dollars.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'What it was for, e.g. "Gas", "Dinner".' },
        amount: { type: 'number', description: 'Amount paid, in dollars (e.g. 24.50).' },
        ...CATEGORY_PROP,
        date: { type: 'string', description: "Date 'YYYY-MM-DD'. Omit for today." },
        saved: { type: 'number', description: 'Discount saved, in dollars. Optional.' },
      },
      required: ['title', 'amount'],
    },
  },
  {
    name: 'scan_receipt_for_review',
    description:
      'Read the receipt photo/PDF the member just shared and prepare line items for review. Does NOT save spending — the app opens a confirm screen where the member can edit name/amount/savings/category per item and confirm. Call ONLY when a receipt was shared and they want it logged.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'analyze_regular_monthly_spending',
    description:
      'Analyze regular monthly spending: registered recurring bills/subscriptions plus expense patterns that look monthly (same vendor/title across months). Use for "what are my regular expenses", "monthly bills", "subscriptions".',
    input_schema: {
      type: 'object',
      properties: {
        month: { type: 'string', description: "Anchor month YYYY-MM. Default current." },
        months: { type: 'number', description: 'History window 2–24. Default 6.' },
      },
    },
  },
  {
    name: 'edit_expense',
    description:
      'Change an existing expense. Provide its expense_id (from list_expenses) plus the fields to change. Amounts in dollars.',
    input_schema: {
      type: 'object',
      properties: {
        expense_id: { type: 'string', description: 'Id from list_expenses.' },
        title: { type: 'string' },
        amount: { type: 'number', description: 'New amount in dollars.' },
        ...CATEGORY_PROP,
        date: { type: 'string', description: "New date 'YYYY-MM-DD'." },
      },
      required: ['expense_id'],
    },
  },
  {
    name: 'delete_expense',
    description: 'Delete an expense by its id (from list_expenses). Confirm with the member first if unsure.',
    input_schema: {
      type: 'object',
      properties: { expense_id: { type: 'string', description: 'Id from list_expenses.' } },
      required: ['expense_id'],
    },
  },
  {
    name: 'set_monthly_budget',
    description: 'Set the total planned budget for a month, in dollars. Defaults to the current month.',
    input_schema: {
      type: 'object',
      properties: {
        amount: { type: 'number', description: 'Planned monthly budget in dollars.' },
        month: { type: 'string', description: "Month 'YYYY-MM'. Omit for current month." },
      },
      required: ['amount'],
    },
  },
  {
    name: 'create_category',
    description: 'Create a new spending category for the household.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        color: { type: 'string', description: 'Optional hex color, e.g. "#4CAF50".' },
        icon: { type: 'string', description: 'Optional icon key.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'create_planned_spending',
    description:
      'Add a planned/upcoming spending (not yet paid) to the budget, e.g. a future purchase to save for. Amount is an estimate in dollars.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        amount: { type: 'number', description: 'Estimated cost in dollars.' },
        ...CATEGORY_PROP,
        target_date: { type: 'string', description: "When it's expected 'YYYY-MM-DD'. Optional." },
        priority: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Default medium.' },
      },
      required: ['title'],
    },
  },
  {
    name: 'show_chart',
    description:
      'Render a chart inline. Prefer analyze_spend_topic / get_product_trends when they already attach UI. Use bar for comparisons, pie/donut for share, line for trends. Never invent data. Do not send colors — the app brands the chart.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['bar', 'pie', 'donut', 'line'] },
        title: { type: 'string' },
        value_format: { type: 'string', enum: ['currency', 'number', 'percent'], description: 'Default currency.' },
        data: {
          type: 'array',
          description: 'Data points.',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              value: { type: 'number', description: 'For currency, the dollar amount (e.g. 210.00).' },
            },
            required: ['label', 'value'],
          },
        },
      },
      required: ['type', 'data'],
    },
  },
  {
    name: 'show_stats',
    description:
      'Render a row of headline stat cards (e.g. Spent, Remaining, Saved) inline. Use real figures from the read tools.',
    input_schema: {
      type: 'object',
      properties: {
        stats: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              value: { type: 'string', description: 'Pre-formatted, e.g. "$412.30".' },
              caption: { type: 'string' },
              tone: { type: 'string', enum: ['neutral', 'positive', 'warning', 'negative'] },
            },
            required: ['label', 'value'],
          },
        },
      },
      required: ['stats'],
    },
  },
  {
    name: 'show_table',
    description: 'Render a compact data table inline (e.g. product rankings). Prefer when analyze_* already attached a table.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        columns: { type: 'array', items: { type: 'string' } },
        rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
      },
      required: ['columns', 'rows'],
    },
  },
  {
    name: 'show_insight',
    description: 'Render a short analysis insight card with optional bullets.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
        bullets: { type: 'array', items: { type: 'string' } },
        tone: { type: 'string', enum: ['neutral', 'positive', 'warning', 'negative'] },
      },
      required: ['title', 'body'],
    },
  },
  {
    name: 'show_diagram',
    description: 'Render a simple money-flow diagram (nodes + edges), e.g. income → bills → savings.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        nodes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              label: { type: 'string' },
              value: { type: 'string' },
            },
            required: ['id', 'label'],
          },
        },
        edges: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              from: { type: 'string' },
              to: { type: 'string' },
              label: { type: 'string' },
            },
            required: ['from', 'to'],
          },
        },
      },
      required: ['nodes', 'edges'],
    },
  },
  ...FINANCE_READ_TOOLS,
];

// ============ capability wiring ============

/**
 * The Budget app's assistant capability: always-on budget awareness plus the
 * full adviser toolset. Wired into `BUDGET_CHAT_CONFIG`.
 */
export const BUDGET_CHAT_ASSISTANT: ChatAssistantCapability = {
  triggerOnImageAttachment: true,
  tools: TOOLS,

  async buildContext(ctx: ChatAssistantToolContext): Promise<string | null> {
    try {
      const budget = new BudgetService(ctx.env, ctx.env.DB);
      const nowYm = now().slice(0, 7).split('-').map((s) => parseInt(s, 10));
      const monthSnap = await budgetSnapshot(ctx, budget, nowYm[0], nowYm[1]);
      const household = await buildFullHouseholdContext(ctx);
      return [household, monthSnap].filter(Boolean).join('\n\n');
    } catch (error) {
      console.error('[budget-chat] buildContext snapshot failed:', error);
      return null;
    }
  },

  async runTool(ctx, call): Promise<ChatAssistantToolReturn> {
    const input = call.input;
    const finance = await runFinanceTool(ctx, call.name, input);
    if (finance !== null) return finance;

    switch (call.name) {
      case 'get_budget_overview':
        return getBudgetOverview(ctx, input);
      case 'get_spending_breakdown':
        return getSpendingBreakdown(ctx, input);
      case 'list_expenses':
        return listExpenses(ctx, input);
      case 'add_expense':
        return addExpense(ctx, input);
      case 'scan_receipt_for_review':
        return scanReceiptForReview(ctx);
      case 'analyze_regular_monthly_spending':
        return analyzeRegularMonthlySpending(ctx, input);
      case 'edit_expense':
        return editExpense(ctx, input);
      case 'delete_expense':
        return deleteExpense(ctx, input);
      case 'set_monthly_budget':
        return setMonthlyBudget(ctx, input);
      case 'create_category':
        return createCategory(ctx, input);
      case 'create_planned_spending':
        return createPlannedSpending(ctx, input);
      case 'show_chart':
        return showChart(input);
      case 'show_stats':
        return showStats(input);
      case 'show_table':
        return showTable(input);
      case 'show_insight':
        return showInsight(input);
      case 'show_diagram':
        return showDiagram(input);
      default:
        return `Unknown tool: ${call.name}`;
    }
  },
};
