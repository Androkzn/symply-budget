import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { router } from 'expo-router';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useEffect, useRef } from 'react';

import {
  ChatConfigProvider,
  ChatRoomScreen,
  ChatRoomSettingsScreen,
  houseChatConfig,
} from '@features/chat';
import {
  CreateHomeProjectWizard,
  HomeProjectHubScreen,
  MaterialDetailScreen,
  HomeProjectsListScreen,
  SmartProjectWizard,
  SurfaceStudioScreen,
} from '@screens/home-projects';
import { navigateAfterInteractions } from '@services/nav-when-ready';

import type { HomeProjectsStackParamList } from './types';

const Stack = createNativeStackNavigator<HomeProjectsStackParamList>();

type RouterParam = string | string[] | undefined;

interface HomeProjectsNavigatorProps {
  initialParams?: {
    screen?: RouterParam;
    projectId?: RouterParam;
    spaceId?: RouterParam;
  };
  /**
   * Changes whenever the Projects TAB is entered. Each change pops this stack
   * back to the list — see the note in `app/(tabs)/projects.tsx`.
   */
  resetNonce?: number;
}

function firstString(value: RouterParam): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function NavigationHandler({
  initialParams,
  children,
}: {
  initialParams?: HomeProjectsNavigatorProps['initialParams'];
  children: React.ReactNode;
}) {
  const navigation = useNavigation<NativeStackNavigationProp<HomeProjectsStackParamList>>();
  const hasNavigated = useRef<string | null>(null);
  useEffect(() => {
    const screen = firstString(initialParams?.screen);
    const projectId = firstString(initialParams?.projectId);
    const spaceId = firstString(initialParams?.spaceId);
    if (!screen && !projectId && !spaceId) return;

    const key = `${screen || ''}:${projectId || ''}:${spaceId || ''}`;
    if (hasNavigated.current === key) return;
    hasNavigated.current = key;

    let cancelled = false;
    navigateAfterInteractions(() => {
      if (cancelled) return;
      try {
        if ((screen === 'HomeProjectHub' || !screen) && projectId) {
          navigation.navigate('HomeProjectHub', { projectId });
        } else if (screen === 'CreateHomeProject' || spaceId) {
          navigation.navigate('CreateHomeProject', spaceId ? { spaceId } : undefined);
        }
      } catch (err) {
        if (__DEV__) {
          console.warn('[HomeProjectsNavigator] deep-link navigate failed', err);
        }
        return;
      }
      try {
        router.setParams({
          screen: undefined,
          projectId: undefined,
          spaceId: undefined,
        });
      } catch {
        // ignore
      }
    });

    return () => {
      cancelled = true;
    };
  }, [initialParams, navigation]);

  return <>{children}</>;
}

export function HomeProjectsNavigator({
  initialParams,
  resetNonce,
}: HomeProjectsNavigatorProps = {}) {
  /**
   * Re-entering the tab must land on the LIST, not on whatever project the tab
   * was left on. Resetting the stack has to happen ON the stack, and that is
   * the whole reason this is a key rather than an effect: `NavigationHandler`
   * renders ABOVE `Stack.Navigator`, so its `useNavigation()` resolves to the
   * PARENT (tabs) navigator. The `popToTop()` that used to live there was
   * dispatched at the wrong navigator and silently did nothing to this stack —
   * it only ever looked fixed because the flows that exercised it never left
   * the stack deep. Remounting on a changed key resets to `HomeProjectsList`
   * with no ambiguity about which navigator is being addressed.
   *
   * Deep links keep a STABLE key: they carry their own destination, and
   * remounting underneath them would throw it away.
   */
  const deepLinked = Boolean(initialParams?.projectId || initialParams?.spaceId);
  const stackKey = deepLinked ? 'home-projects-deep-link' : `home-projects-${resetNonce ?? 0}`;

  return (
    <NavigationHandler initialParams={initialParams}>
      {/* The chat config wraps the whole stack, not just the two chat routes:
          `ChatRoomScreen` reads it from context on mount, and a provider nested
          per-screen would have to be repeated for the settings route it pushes.
          Providing it here costs nothing on the screens that ignore it. */}
      <ChatConfigProvider config={houseChatConfig}>
        {/* Native header is off everywhere in this app — every screen renders its
            own shared `ScreenHeader` (with `BackButton`) instead, so Home Projects
            matches the rest of the fleet. */}
        <Stack.Navigator key={stackKey} screenOptions={{ headerShown: false }}>
          <Stack.Screen name="HomeProjectsList" component={HomeProjectsListScreen} />
          <Stack.Screen name="CreateHomeProject" component={CreateHomeProjectWizard} />
          <Stack.Screen name="SmartProject" component={SmartProjectWizard} />
          <Stack.Screen name="HomeProjectHub" component={HomeProjectHubScreen} />
          <Stack.Screen name="SurfaceStudio" component={SurfaceStudioScreen} />
          <Stack.Screen
            name="MaterialDetail"
            component={MaterialDetailScreen}
          />
          {/* The project's / a material's conversation, in place — Back returns
              to the thing being discussed rather than to another tab. */}
          <Stack.Screen name="ChatRoom" component={ChatRoomScreen} />
          <Stack.Screen name="ChatRoomSettings" component={ChatRoomSettingsScreen} />
        </Stack.Navigator>
      </ChatConfigProvider>
    </NavigationHandler>
  );
}
