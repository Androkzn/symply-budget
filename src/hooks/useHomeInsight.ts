/**
 * useHomeInsight — the dynamic, actionable Mira brief for the Home hero.
 *
 * Fetches the single most important thing about the home right now (overdue
 * task, bill due soon, garbage tomorrow, over budget, …): headline + Mira-voice
 * message + tone + due/days counter + a deep-link CTA. Cached so the hero
 * renders instantly on revisit; a failing request just yields `insight: null`
 * and the card shows a friendly fallback.
 *
 * **Two sources, one shape (DoD H7).** Which source runs is decided by
 * `isHouseLocalFirst()`:
 *
 *  - **Server (default, every non-local-first brand and build).** Unchanged:
 *    `aihousekeeperApi.getHomeInsight` composes the brief from D1 and the client
 *    renders it verbatim. The device timezone is passed through so the greeting
 *    and "days until due" are computed in the household's local day, not UTC.
 *
 *  - **Local-first House.** The Worker's D1 holds ciphertext, so the server
 *    composer has nothing to read and would cheerfully return "All clear" for a
 *    home with a month of overdue work. The brief is instead built on device by
 *    `buildHomeInsights` — the P2 ladder's home-insight consumer — over the
 *    encrypted ledger, which is the *whole current* ledger rather than whatever
 *    had synced.
 *
 * **The name collision, stated once so nobody conflates them again.** There are
 * two unrelated `HomeInsight` types:
 *
 *  - `@/types/aihousekeeper`'s — ONE composed hero brief: greeting, tone, icon,
 *    dueLabel, cta, chips. This is what the hook returns and what
 *    `HomeInsightCard` renders. Imported here as `HeroInsight`.
 *  - `features/house/local/ai`'s — a LIST of insight cards: id, kind, title,
 *    detail, priority, source. Imported here as `HouseAiHomeInsight`.
 *
 * They share a name and nothing else. `projectHeroInsight` below is the only
 * place the second becomes the first, and it is a projection, not a cast.
 *
 * **Stage C.** When the ladder runs out of rungs — a home with rows, no rule
 * hits and no provider key — there is no brief to render and the honest answer
 * is the ladder's own member-facing copy. It is returned as `unavailable`
 * rather than being smuggled into `insight.message`, so a screen renders it as
 * the deliberate "here is why" that it is instead of as a fabricated brief.
 */
import { useQuery } from '@tanstack/react-query';

import type { HomeInsight as HeroInsight, InsightCta, InsightTone } from '@/types/aihousekeeper';
import { aihousekeeperApi } from '@api/aihousekeeper';
import {
  buildHomeInsights,
  getHouseAiUnavailableCopy,
  getLocalHouseLedgerFor,
  isHouseLocalFirst,
  type HouseAiHomeInsight,
} from '@features/house/local';

const STALE_MS = 2 * 60 * 1000;

/** Stage C copy, ready for a card header + body. */
export type HomeInsightUnavailable = {
  title: string;
  message: string;
};

export type UseHomeInsightResult = {
  insight: HeroInsight | null;
  isLoading: boolean;
  /**
   * Non-null only on the local-first path, and only at Stage C. `insight` is
   * always null when this is set — they are the two halves of one answer, never
   * both at once.
   */
  unavailable: HomeInsightUnavailable | null;
};

/** Best-effort device IANA timezone; undefined if the runtime can't resolve it. */
function deviceTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** Matches the Worker's `greetingForHour` so the two paths read identically. */
function greetingForHour(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

const TONE_BY_PRIORITY: Record<HouseAiHomeInsight['priority'], InsightTone> = {
  high: 'urgent',
  medium: 'attention',
  low: 'info',
};

/**
 * Ionicons per insight kind, chosen to match the Worker's vocabulary for the
 * same situations — an overdue task shows `alert-circle` on both paths, so a
 * member who switches builds does not see the hero change character.
 */
const ICON_BY_KIND: Record<HouseAiHomeInsight['kind'], string> = {
  task_overdue: 'alert-circle',
  task_due_soon: 'calendar-outline',
  appliance_warranty_expiring: 'shield-outline',
  appliance_service_due: 'construct-outline',
  appliance_end_of_life: 'time-outline',
  assistant_suggestion: 'sparkles',
};

/**
 * The only CTA routes offered are ones the Worker already deep-links to, so a
 * tap cannot land on a route that does not exist in this brand's router.
 * An insight that concerns neither a task nor an appliance gets no CTA at all,
 * and the card falls back to opening chat exactly as it does server-side.
 */
function ctaFor(insight: HouseAiHomeInsight): InsightCta | null {
  if (insight.taskId) return { label: 'Review tasks', route: '/tasks' };
  if (insight.applianceId) return { label: 'View appliances', route: '/appliances' };
  return null;
}

/**
 * Collapse the on-device card list into the one hero brief the card renders.
 *
 * The list is already ranked by `buildHomeInsights` (priority, then id), so the
 * head is the primary and the next three become chips — the same 1 + 3 shape
 * the Worker produces.
 */
export function projectHeroInsight(
  insights: readonly HouseAiHomeInsight[],
  now: Date,
): HeroInsight {
  const greeting = greetingForHour(now.getHours());
  const generatedAt = now.toISOString();

  const [primary, ...rest] = insights;
  if (!primary) {
    return {
      greeting,
      title: 'All clear',
      message:
        "Everything's on track — nothing needs you right now. I'll keep watch and flag anything the moment it matters.",
      tone: 'celebrate',
      icon: 'checkmark-circle',
      dueLabel: null,
      dueDate: null,
      cta: null,
      attentionCount: 0,
      chips: [],
      generatedAt,
    };
  }

  return {
    greeting,
    title: primary.title,
    message: primary.detail,
    tone: TONE_BY_PRIORITY[primary.priority],
    icon: ICON_BY_KIND[primary.kind],
    // The rules produce no relative-day label of their own; inventing one from
    // `detail` would be a parse of prose, which is how a hero starts lying.
    dueLabel: null,
    dueDate: null,
    cta: ctaFor(primary),
    // Only the things that actually want attention, not the whole list — a
    // low-priority "warranty ends next year" is not something needing you now.
    attentionCount: insights.filter((i) => i.priority !== 'low').length,
    chips: rest.slice(0, 3).map((i) => ({
      icon: ICON_BY_KIND[i.kind],
      label: i.title,
      dueLabel: null,
    })),
    generatedAt,
  };
}

type InsightPayload = { insight: HeroInsight | null; unavailable: HomeInsightUnavailable | null };

/** The local-first branch: ledger → ladder → hero brief, all on device. */
async function loadLocalInsight(householdId: string): Promise<InsightPayload> {
  const ledger = await getLocalHouseLedgerFor(householdId);
  const result = await buildHomeInsights({ ledger, householdId });

  if (result.stage === 'C') {
    return { insight: null, unavailable: getHouseAiUnavailableCopy(result.reason) };
  }
  return { insight: projectHeroInsight(result.value, new Date()), unavailable: null };
}

export function useHomeInsight(householdId?: string): UseHomeInsightResult {
  const tz = deviceTimezone();
  const localFirst = isHouseLocalFirst();

  const { data, isLoading } = useQuery<InsightPayload>({
    // The source is part of the identity of the cached value: a build that
    // flips local-first must not serve a server-composed brief from cache.
    queryKey: ['home', 'insight', householdId, localFirst ? 'local' : 'server'],
    enabled: !!householdId,
    staleTime: STALE_MS,
    retry: 1,
    queryFn: async (): Promise<InsightPayload> => {
      if (localFirst) return loadLocalInsight(householdId!);
      return { insight: await aihousekeeperApi.getHomeInsight(householdId!, tz), unavailable: null };
    },
  });

  return {
    insight: data?.insight ?? null,
    isLoading,
    unavailable: data?.unavailable ?? null,
  };
}
