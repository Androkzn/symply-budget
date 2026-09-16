import { useQueryClient } from '@tanstack/react-query';
import { Redirect, useLocalSearchParams } from 'expo-router';
import React, { useEffect } from 'react';

import { aihousekeeperApi } from '@api/aihousekeeper';
import { isHouseBrand } from '@brand';
import { BriefingScreen } from '@screens/aihousekeeper/BriefingScreen';
import { useHouseholdStore } from '@stores/householdStore';

/**
 * Plan §H5 — expo-router deep link.
 *
 * `simplehouse://briefing/2026-04-23` (or the HTTPS variant) resolves here,
 * prefetches the briefing query before first paint, and hands off to
 * `BriefingScreen` with the route param's date.
 */
export default function BriefingRoute() {
  const params = useLocalSearchParams<{ date: string }>();
  const date = Array.isArray(params.date) ? params.date[0] : params.date;
  const queryClient = useQueryClient();
  const hid = useHouseholdStore((s) => s.currentHousehold?.id ?? null);

  useEffect(() => {
    if (!hid || !date) return;
    queryClient.prefetchQuery({
      queryKey: ['aihousekeeper', 'briefing', hid, date],
      queryFn: async () => {
        const { briefing } = await aihousekeeperApi.getBriefing(hid, date);
        return briefing;
      },
    });
  }, [hid, date, queryClient]);

  // AI Housekeeper briefings are a House-only feature; child apps bounce home.
  if (!isHouseBrand()) {
    return <Redirect href="/" />;
  }

  return <BriefingScreen date={date} />;
}
