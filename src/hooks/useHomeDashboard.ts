/**
 * useHomeDashboard — live, glanceable status for the Home "Today" dashboard.
 *
 * Aggregates the few signals worth surfacing above the fold (budget left this
 * month, inspection drafts awaiting review, warranties expiring soon, pending
 * contractor quotes, active projects) from APIs that already exist. Each source
 * is its own cached query so the dashboard renders progressively and a single
 * failing endpoint never blanks the others. Counts default to 0 / null so the
 * consuming cards simply stay hidden when there's nothing to show.
 */
import { useQuery } from '@tanstack/react-query';

import type { Appliance } from '@api/appliances';
import { appliancesApi } from '@api/appliances';
import { homeBudgetApi } from '@api/home-budget';
import { projectsApi } from '@api/projects';
import { quotesApi } from '@api/quotes';
import { taskDraftsApi } from '@api/task-drafts';
import { isMinimalBudget } from '@features/budget';

const STALE_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Days within which an appliance warranty counts as "expiring soon". */
const WARRANTY_WINDOW_DAYS = 45;

export interface HomeDashboardData {
  /** Money left in this month's budget, or null when no budget is configured. */
  budgetRemaining: number | null;
  /** Inspection task-drafts awaiting review. */
  draftsTotal: number;
  /** How many of those drafts are critical-severity. */
  draftsCritical: number;
  /** Appliance warranties expiring within the next ~45 days. */
  warrantiesExpiring: number;
  /** Contractor quotes awaiting a decision. */
  quotesPending: number;
  /** Active home-improvement projects. */
  projectsActive: number;
}

export function countExpiringWarranties(appliances: Appliance[], withinDays: number): number {
  const now = Date.now();
  const horizon = now + withinDays * DAY_MS;
  return appliances.reduce((count, appliance) => {
    const expirations = [
      appliance.warranty?.manufacturer?.expiration,
      appliance.warranty?.extended?.expiration,
    ];
    const expiringSoon = expirations.some((value) => {
      if (!value) return false;
      const time = new Date(value).getTime();
      return !Number.isNaN(time) && time >= now && time <= horizon;
    });
    return expiringSoon ? count + 1 : count;
  }, 0);
}

export function useHomeDashboard(householdId?: string): HomeDashboardData {
  const enabled = !!householdId;
  const common = { enabled, staleTime: STALE_MS, retry: 1 } as const;

  // House minimal → home-budget Worker route. Full Budget brand uses its own screens.
  const budget = useQuery({
    ...common,
    enabled: enabled && isMinimalBudget(),
    queryKey: ['home', 'home-budget', householdId],
    queryFn: () => {
      const now = new Date();
      return homeBudgetApi.getMonthlyOverview(
        householdId!,
        now.getFullYear(),
        now.getMonth() + 1
      );
    },
  });

  const drafts = useQuery({
    ...common,
    queryKey: ['home', 'drafts', householdId],
    queryFn: () => taskDraftsApi.getSummary(householdId!),
  });

  const appliances = useQuery({
    ...common,
    queryKey: ['home', 'appliances', householdId],
    queryFn: () => appliancesApi.list(householdId!),
  });

  const quotes = useQuery({
    ...common,
    queryKey: ['home', 'quotes', householdId],
    queryFn: () => quotesApi.getPending(householdId!),
  });

  const projects = useQuery({
    ...common,
    queryKey: ['home', 'projects', householdId],
    queryFn: () => projectsApi.getActive(householdId!),
  });

  // Only surface a budget figure once the user has actually planned one —
  // a $0 "remaining" on an unconfigured budget reads as broken, not helpful.
  const hasBudget = !!budget.data && budget.data.plannedBudget > 0;

  return {
    budgetRemaining: hasBudget ? budget.data!.remainingBudget : null,
    draftsTotal: drafts.data?.total ?? 0,
    draftsCritical: drafts.data?.by_severity.critical ?? 0,
    warrantiesExpiring: appliances.data
      ? countExpiringWarranties(appliances.data.appliances, WARRANTY_WINDOW_DAYS)
      : 0,
    quotesPending: quotes.data?.quotes.length ?? 0,
    projectsActive: projects.data?.projects.length ?? 0,
  };
}
