import { Redirect, useLocalSearchParams } from 'expo-router';
import React from 'react';

import { isHouseBrand } from '@brand';
import { NeighboursNavigator } from '@navigation/NeighboursNavigator';

/**
 * `/neighbours` — the homes around this property.
 *
 * A top-level route rather than a tab: the map is a place a member goes
 * deliberately, a handful of times a month, not one of the five things they
 * reach for every day. Adding a sixth tab would cost every member bar-space they
 * use constantly to save a few taps for something they do not.
 *
 * House-only. Child brands bounce home, exactly as `/home-projects` and
 * `/my-home` do — a Budget household has no property to have neighbours of, and
 * the Worker 404s the router for them anyway (`gateHomeApiPaths`).
 */
export default function NeighboursRoute() {
  const params = useLocalSearchParams<{
    screen?: string | string[];
    neighbourId?: string | string[];
  }>();

  if (!isHouseBrand()) {
    return <Redirect href="/" />;
  }

  return <NeighboursNavigator initialParams={params} />;
}
