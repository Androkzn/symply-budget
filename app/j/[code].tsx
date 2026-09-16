import { useLocalSearchParams } from 'expo-router';
import React from 'react';

import { JoinHouseholdScreen } from '@screens/households/JoinHouseholdScreen';

/**
 * expo-router deep link for short household invite links.
 *
 * `https://…/j/<code>` (universal link) and `simplehouse://j/<code>` resolve
 * here. The backend accepts either a full token or a short code — same join
 * flow as `/join/<token>`.
 */
export default function ShortJoinRoute() {
  const params = useLocalSearchParams<{ code: string }>();
  const code = Array.isArray(params.code) ? params.code[0] : params.code;
  return <JoinHouseholdScreen token={code ?? ''} />;
}
