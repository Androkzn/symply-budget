import { Redirect, useLocalSearchParams } from 'expo-router';
import React from 'react';

import { isHouseBrand } from '@brand';

/**
 * Legacy entry point. Home Projects is now the "Projects" TAB (`/projects`),
 * so this route only forwards — keeping every existing `/home-projects` deep
 * link and `router.push` working while the hub stays a single mounted copy
 * inside the tab navigator.
 */
export default function HomeProjectsRoute() {
  const params = useLocalSearchParams<{
    screen?: string | string[];
    projectId?: string | string[];
    spaceId?: string | string[];
  }>();

  if (!isHouseBrand()) {
    return <Redirect href="/" />;
  }

  const forwarded: Record<string, string> = {};
  for (const key of ['screen', 'projectId', 'spaceId'] as const) {
    const value = params[key];
    const first = Array.isArray(value) ? value[0] : value;
    if (first) forwarded[key] = first;
  }

  return <Redirect href={{ pathname: '/projects', params: forwarded }} />;
}
