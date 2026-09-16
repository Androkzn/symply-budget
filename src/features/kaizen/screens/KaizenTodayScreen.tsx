import { Redirect } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';


import { BrandBackground } from '@features/kaizen/brand';
import { useAuthStore } from '@stores/authStore';

import {
  isSetupFlowActive,
  needsCareerSetupStep,
  nextUnconfiguredSystem,
} from '../services/setupFlow';
import { useKaizenStore } from '../stores/kaizenStore';

import { TodayScreen } from './TodayScreen';

/**
 * Kaizen "Today" tab entry (shell/tab contract `KaizenTodayScreen`).
 *
 * Ported from the donor `(kaizen)/_layout.tsx` init + `(kaizen)/index.tsx` gate: it triggers the
 * first hydrate → sync of the Symply Life store once authenticated, then applies the onboarding
 * / setup-queue gate before rendering the 1:1 donor Today screen. Route paths are the ecosystem
 * `/kaizen/*` equivalents of the donor `/(kaizen)/*`.
 */
export function KaizenTodayScreen() {
  const user = useAuthStore(state => state.user);
  const profile = useKaizenStore(state => state.profile);
  const isHydrated = useKaizenStore(state => state.isHydrated);

  useEffect(() => {
    if (!user) return;
    const store = useKaizenStore.getState();
    store
      .hydrate()
      .then(() => store.sync())
      .catch(() => undefined);
  }, [user]);

  if (!isHydrated) {
    return (
      <BrandBackground>
        <View testID="kaizen-today-loading" style={{ flex: 1 }} />
      </BrandBackground>
    );
  }

  if (!profile?.onboarding_complete) {
    if (isSetupFlowActive()) {
      const nextSystem = nextUnconfiguredSystem();
      if (nextSystem) {
        return (
          <Redirect
            href={{
              pathname: '/kaizen/system-config',
              params: { system: nextSystem, setup: '1' },
            }}
          />
        );
      }
      if (needsCareerSetupStep() && profile?.career_setup_step !== 'complete') {
        return <Redirect href="/kaizen/career-setup?setup=1" />;
      }
    }
    return <Redirect href="/kaizen/onboarding" />;
  }

  return <TodayScreen />;
}
