import { Redirect, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React from 'react';

import { isHouseBrand } from '@brand';
import { HomeProjectsNavigator } from '@navigation/HomeProjectsNavigator';

/**
 * Projects (formerly "Home Projects") as a bottom-nav tab. The standalone
 * `/home-projects` route redirects here so the hub is never mounted twice.
 */
export default function ProjectsTab() {
  const params = useLocalSearchParams<{
    screen?: string | string[];
    projectId?: string | string[];
    spaceId?: string | string[];
  }>();

  /**
   * Bumped every time this TAB gains focus, which resets the stack inside it.
   *
   * A tab keeps its own navigation stack, so coming back to Projects landed the
   * member on whichever project they last opened — sometimes several screens
   * deep — even though the tab is labelled Projects and shows a project count.
   * Nothing in the UI suggested they were still inside an old project.
   *
   * `useFocusEffect` here fires when the TAB is entered, not when moving
   * between screens within it, so drilling into a project and pressing back
   * still behaves normally. The cost is deliberate and small: switching to
   * another tab and returning starts at the list rather than where you were.
   */
  const [focusNonce, setFocusNonce] = React.useState(0);
  useFocusEffect(
    React.useCallback(() => {
      setFocusNonce(n => n + 1);
    }, []),
  );

  if (!isHouseBrand()) {
    return <Redirect href="/" />;
  }

  return <HomeProjectsNavigator initialParams={params} resetNonce={focusNonce} />;
}
