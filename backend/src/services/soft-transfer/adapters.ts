/**
 * Soft Transfer package payload builders + importers.
 */
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { isFullBudgetBrand } from '../../config/brand-capabilities';
import type { TransferPackageId } from '../../config/transfer-package-registry';
import * as schema from '../../db/schema';
import { budgetGoals, expenses } from '../../db/schema-budget';
import {
  homeProjectBudgetLines,
  homeProjects,
} from '../../db/schema-home-projects';
import type { Env } from '../../types';
import { ValidationError } from '../../utils/errors';
import { generateId, now } from '../../utils/id';
import { upsertPlatformProfile } from '../shared-user-service';

/** Envelope payload for budget.summary.v1 (field manifest only). */
export type BudgetSummaryEnvelopePayload = {
  currency: string;
  monthTotal: number;
  ytdTotal: number;
  remaining: number | null;
  topCategories: Array<{ name: string; total: number }>;
};

function parseTopCategories(raw: unknown): Array<{ name: string; total: number }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ name: string; total: number }> = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (typeof row.name !== 'string' || typeof row.total !== 'number') continue;
    out.push({ name: row.name, total: row.total });
  }
  return out;
}

/**
 * Normalize a client-built budget.summary payload to the transfer envelope shape.
 * Accepts either manifest-only JSON or the richer local export document.
 */
export function normalizeBudgetSummaryClientPayload(
  raw: Record<string, unknown>
): BudgetSummaryEnvelopePayload {
  const currency = typeof raw.currency === 'string' ? raw.currency : null;
  const monthTotal = typeof raw.monthTotal === 'number' ? raw.monthTotal : null;
  const ytdTotal = typeof raw.ytdTotal === 'number' ? raw.ytdTotal : null;
  const remaining =
    raw.remaining === null
      ? null
      : typeof raw.remaining === 'number'
        ? raw.remaining
        : null;

  if (!currency || monthTotal === null || ytdTotal === null) {
    throw new ValidationError({
      client_payload: ['budget.summary.v1 requires currency, monthTotal, and ytdTotal'],
    });
  }

  return {
    currency,
    monthTotal,
    ytdTotal,
    remaining,
    topCategories: parseTopCategories(raw.topCategories),
  };
}

export function shouldUseClientBudgetSummaryPayload(args: {
  packageId: string;
  sourceBrandId: string;
  localFirstClient: boolean;
  clientPayload?: Record<string, unknown> | null;
}): boolean {
  return (
    args.packageId === 'budget.summary.v1' &&
    args.localFirstClient &&
    args.clientPayload != null &&
    isFullBudgetBrand(args.sourceBrandId)
  );
}

export function assertClientPayloadAllowed(args: {
  packageId: string;
  sourceBrandId: string;
  localFirstClient: boolean;
  clientPayload?: Record<string, unknown> | null;
}): void {
  if (!args.clientPayload) return;
  if (!args.localFirstClient) {
    throw new ValidationError({
      client_payload: ['Requires X-Budget-Local-First: 1'],
    });
  }
  if (args.packageId !== 'budget.summary.v1') {
    throw new ValidationError({
      client_payload: ['Only supported for budget.summary.v1'],
    });
  }
  if (!isFullBudgetBrand(args.sourceBrandId)) {
    throw new ValidationError({
      client_payload: ['Only supported when exporting from Symply Budget'],
    });
  }
}

function db(env: Env) {
  return drizzle(env.DB, { schema });
}

function sizeBand(n: number): string {
  if (n <= 1) return '1';
  if (n <= 2) return '2';
  if (n <= 4) return '3-4';
  return '5+';
}

export async function buildPackagePayload(
  env: Env,
  args: {
    packageId: TransferPackageId;
    userId: string;
    sourceHouseholdId?: string | null;
  }
): Promise<Record<string, unknown>> {
  const d = db(env);

  if (
    args.packageId === 'profile.core.v1' ||
    args.packageId === 'profile.core.health.v1' ||
    args.packageId === 'profile.core.language.v1'
  ) {
    const profile = await d
      .select()
      .from(schema.platformProfiles)
      .where(eq(schema.platformProfiles.user_id, args.userId))
      .get();
    const user = await d
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, args.userId))
      .get();
    return {
      displayName: profile?.display_name ?? user?.display_name ?? null,
      locale: profile?.locale ?? null,
      timezone: profile?.timezone ?? null,
    };
  }

  if (args.packageId === 'health.summary.v1') {
    // POC stub — Health domain metrics land as Soft Transfer expands.
    return {
      periodLabel: 'last_30_days',
      checkInCount: 0,
      goalProgress: null,
    };
  }

  if (args.packageId === 'language.summary.v1') {
    return {
      periodLabel: 'last_30_days',
      lessonsCompleted: 0,
      streakDays: 0,
    };
  }

  if (args.packageId === 'house.property.v1') {
    if (!args.sourceHouseholdId) {
      throw new Error('source_household_id required for house.property.v1');
    }
    const household = await d
      .select()
      .from(schema.households)
      .where(eq(schema.households.id, args.sourceHouseholdId))
      .get();
    if (!household) throw new Error('source household not found');

    const members = await d
      .select({ id: schema.householdMembers.id })
      .from(schema.householdMembers)
      .where(eq(schema.householdMembers.household_id, args.sourceHouseholdId))
      .all();

    const cityRegion = [household.city, household.state_province].filter(Boolean).join(', ') || null;
    return {
      cityRegion,
      propertyType: 'residence',
      householdSizeBand: sizeBand(members.length),
      ownershipFlags: {
        hasPurchasePrice: household.purchase_price != null,
        country: household.country ?? null,
        name: household.name,
      },
    };
  }

  if (args.packageId === 'budget.summary.v1') {
    if (!args.sourceHouseholdId) {
      throw new Error('source_household_id required for budget.summary.v1');
    }
    const year = new Date().getUTCFullYear();
    const month = new Date().getUTCMonth() + 1;
    const monthPad = String(month).padStart(2, '0');
    const yearStart = `${year}-01-01`;
    const monthStart = `${year}-${monthPad}-01`;
    const nextMonth =
      month === 12
        ? `${year + 1}-01-01`
        : `${year}-${String(month + 1).padStart(2, '0')}-01`;

    let monthTotal = 0;
    let ytdTotal = 0;
    let remaining: number | null = null;
    const currency = 'USD';

    try {
      const goal = await d
        .select()
        .from(budgetGoals)
        .where(
          and(
            eq(budgetGoals.household_id, args.sourceHouseholdId),
            eq(budgetGoals.year, year),
            eq(budgetGoals.month, month)
          )
        )
        .get();
      const planned = goal?.planned_budget ?? null;

      const monthSpend = await d
        .select({ total: sql<number>`coalesce(sum(${expenses.amount}), 0)` })
        .from(expenses)
        .where(
          and(
            eq(expenses.household_id, args.sourceHouseholdId),
            gte(expenses.expense_date, monthStart),
            lt(expenses.expense_date, nextMonth)
          )
        )
        .get();
      monthTotal = Number(monthSpend?.total ?? 0);

      const ytdSpend = await d
        .select({ total: sql<number>`coalesce(sum(${expenses.amount}), 0)` })
        .from(expenses)
        .where(
          and(
            eq(expenses.household_id, args.sourceHouseholdId),
            gte(expenses.expense_date, yearStart),
            lt(expenses.expense_date, `${year + 1}-01-01`)
          )
        )
        .get();
      ytdTotal = Number(ytdSpend?.total ?? 0);

      if (planned != null) remaining = planned - monthTotal;
    } catch (error) {
      console.warn('[soft-transfer] budget.summary build soft-fail', (error as Error).message);
    }

    return {
      currency,
      monthTotal,
      ytdTotal,
      remaining,
      topCategories: [] as { name: string; total: number }[],
    };
  }

  if (args.packageId === 'home_project_cost_summary.v1') {
    if (!args.sourceHouseholdId) {
      throw new Error('source_household_id required for home_project_cost_summary.v1');
    }
    const projectRows = await d
      .select()
      .from(homeProjects)
      .where(eq(homeProjects.household_id, args.sourceHouseholdId))
      .orderBy(desc(homeProjects.updated_at))
      .all();
    const project = projectRows.find((r) => r.status !== 'archived') ?? projectRows[0];

    if (!project) {
      return {
        projectId: null,
        title: null,
        currency: 'USD',
        targetBudgetCents: null,
        estimateTotalCents: 0,
        actualTotalCents: 0,
        categoryRollups: [] as { category: string; estimateCents: number; actualCents: number }[],
      };
    }

    const lines = await d
      .select()
      .from(homeProjectBudgetLines)
      .where(eq(homeProjectBudgetLines.project_id, project.id))
      .all();
    const byCat = new Map<string, { estimateCents: number; actualCents: number }>();
    let estimateTotalCents = 0;
    let actualTotalCents = 0;
    for (const line of lines) {
      estimateTotalCents += line.estimate_cents || 0;
      actualTotalCents += line.actual_cents || 0;
      const cur = byCat.get(line.category) || { estimateCents: 0, actualCents: 0 };
      cur.estimateCents += line.estimate_cents || 0;
      cur.actualCents += line.actual_cents || 0;
      byCat.set(line.category, cur);
    }
    return {
      projectId: project.id,
      title: project.title,
      currency: project.currency,
      targetBudgetCents: project.target_budget_cents,
      estimateTotalCents,
      actualTotalCents,
      categoryRollups: [...byCat.entries()].map(([category, v]) => ({
        category,
        ...v,
      })),
    };
  }

  throw new Error(`unsupported package ${args.packageId}`);
}

export async function applyPackagePayload(
  env: Env,
  args: {
    packageId: TransferPackageId;
    userId: string;
    destinationHouseholdId?: string | null;
    payload: Record<string, unknown>;
    operationId: string;
  }
): Promise<void> {
  const d = db(env);
  const timestamp = now();

  if (
    args.packageId === 'profile.core.v1' ||
    args.packageId === 'profile.core.health.v1' ||
    args.packageId === 'profile.core.language.v1'
  ) {
    await upsertPlatformProfile(env, args.userId, {
      display_name:
        typeof args.payload.displayName === 'string' ? args.payload.displayName : null,
      locale: typeof args.payload.locale === 'string' ? args.payload.locale : null,
      timezone: typeof args.payload.timezone === 'string' ? args.payload.timezone : null,
    });
    if (typeof args.payload.displayName === 'string') {
      await d
        .update(schema.users)
        .set({
          display_name: args.payload.displayName,
          updated_at: timestamp,
        })
        .where(eq(schema.users.id, args.userId));
    }
    return;
  }

  if (
    args.packageId === 'health.summary.v1' ||
    args.packageId === 'language.summary.v1' ||
    args.packageId === 'home_project_cost_summary.v1'
  ) {
    // Destination: stash onboarding context (Budget/House summary cards read later).
    const contextHash = args.operationId;
    const existingSummary = await d
      .select()
      .from(schema.transferOnboardingContexts)
      .where(eq(schema.transferOnboardingContexts.context_hash, contextHash))
      .get();
    if (!existingSummary) {
      await d.insert(schema.transferOnboardingContexts).values({
        id: generateId(),
        context_hash: contextHash,
        user_id: args.userId,
        brand_id: env.APP_BRAND ?? 'unknown',
        purpose: args.packageId,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        created_at: timestamp,
      });
    }
    return;
  }

  const contextHash = args.operationId;
  const existing = await d
    .select()
    .from(schema.transferOnboardingContexts)
    .where(eq(schema.transferOnboardingContexts.context_hash, contextHash))
    .get();
  if (!existing) {
    await d.insert(schema.transferOnboardingContexts).values({
      id: generateId(),
      context_hash: contextHash,
      user_id: args.userId,
      brand_id: env.APP_BRAND ?? 'unknown',
      purpose: args.packageId,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      created_at: timestamp,
    });
  }

  if (args.packageId === 'house.property.v1' && args.destinationHouseholdId) {
    const ownership = (args.payload.ownershipFlags ?? {}) as { name?: string };
    const cityRegion =
      typeof args.payload.cityRegion === 'string' ? args.payload.cityRegion : '';
    const [city, ...rest] = cityRegion.split(',').map((s) => s.trim());
    await d
      .update(schema.households)
      .set({
        ...(ownership.name ? { name: ownership.name } : {}),
        ...(city ? { city } : {}),
        ...(rest.length ? { state_province: rest.join(', ') } : {}),
        updated_at: timestamp,
      })
      .where(eq(schema.households.id, args.destinationHouseholdId));
  }
}
