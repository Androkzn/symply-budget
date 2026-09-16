/**
 * useGarbageSummary — lightweight summary of a household's garbage collection
 * state for the Home screen widget tile. Resolves whether a schedule has been
 * set up and what the next collection is, and produces a ready-to-render badge
 * string ("Not set up", "Today", "Thu · Recycling", …). The Home tile already
 * shows a trash Ionicon, so the badge label is plain type text (no emoji).
 *
 * The backend always returns a schedule row (getOrCreateSchedule), so "set up"
 * means it has at least one collection type configured.
 */

import { useQuery } from '@tanstack/react-query';

import { garbageCollectionApi } from '@api/garbage-collection';

const COLLECTION_LABELS: Record<string, string> = {
  garbage: 'Garbage',
  recycling: 'Recycling',
  organics: 'Organics',
  yardWaste: 'Yard Waste',
  bulkItem: 'Bulky Items',
};

export interface GarbageSummary {
  hasSchedule: boolean;
  /** Short label for the Home tile, or undefined while loading. */
  badge?: string;
}

export function shortDay(dateStr: string): string {
  const date = new Date(dateStr);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return date.toLocaleDateString('en-US', { weekday: 'short' });
}

export function useGarbageSummary(householdId?: string): GarbageSummary {
  const { data, isLoading } = useQuery({
    queryKey: ['garbage', 'summary', householdId],
    enabled: !!householdId,
    // Keep it fresh when returning to Home; the schedule is invalidated on save.
    staleTime: 30 * 1000,
    refetchOnMount: true,
    queryFn: async (): Promise<GarbageSummary> => {
      console.log('[GARBAGE] useGarbageSummary: fetching for household', householdId);
      const { schedule } = await garbageCollectionApi.getSchedule(householdId!);
      const hasSchedule = !!schedule && schedule.schedules.length > 0;
      console.log('[GARBAGE] useGarbageSummary: hasSchedule=', hasSchedule, 'items=', schedule?.schedules?.length ?? 0);

      if (!hasSchedule) {
        return { hasSchedule: false, badge: 'Not set up' };
      }

      try {
        const { dates } = await garbageCollectionApi.getNextCollections(householdId!, schedule.id, 14);
        const next = dates[0];
        console.log('[GARBAGE] useGarbageSummary: next collection', next);
        if (next) {
          // Show every type collected on the next pickup, not just the first.
          const labels = next.types.map((t) => COLLECTION_LABELS[t] || 'Garbage').join(', ');
          return { hasSchedule: true, badge: `${shortDay(next.date)} ${labels}` };
        }
      } catch (err) {
        console.log('[GARBAGE] useGarbageSummary: next-collections failed', err);
      }
      return { hasSchedule: true, badge: undefined };
    },
  });

  if (isLoading || !data) {
    return { hasSchedule: false, badge: undefined };
  }
  return data;
}
