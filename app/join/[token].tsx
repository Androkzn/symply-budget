import { useLocalSearchParams } from 'expo-router';
import React from 'react';

import { JoinHouseholdScreen } from '@screens/households/JoinHouseholdScreen';

/**
 * expo-router deep link for shareable household invite links.
 *
 * `simplehouse://join/<token>` (or `https://…/join/<token>`) resolves here.
 * Short links use `app/j/[code].tsx` (`/j/<code>`).
 * Unauthenticated taps are handled by the capture/redirect logic in
 * `app/_layout.tsx` (the route isn't mounted until after sign-in).
 */
export default function JoinRoute() {
  const params = useLocalSearchParams<{ token: string }>();
  const token = Array.isArray(params.token) ? params.token[0] : params.token;
  return <JoinHouseholdScreen token={token ?? ''} />;
}
