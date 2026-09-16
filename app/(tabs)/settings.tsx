import { useLocalSearchParams } from 'expo-router';
import { NavigationContainer, NavigationIndependentTree, useFocusEffect } from "expo-router/react-navigation";
import { useCallback } from 'react';

import { HealthMoreScreen, isHealthBrand } from '@features/health';
import {
  isKaizenBrand,
  KaizenMoreScreen,
} from '@features/kaizen';
import { isLanguageBrand, LanguageMoreScreen } from '@features/language';
import { SettingsNavigator } from '@navigation/SettingsNavigator';
import { flushPendingSettingsNavigation } from '@stores/settingsNavigationStore';

export default function SettingsTab() {
  const params = useLocalSearchParams();

  useFocusEffect(
    useCallback(() => {
      if (isKaizenBrand() || isHealthBrand() || isLanguageBrand()) return;
      setTimeout(() => flushPendingSettingsNavigation(), 100);
    }, [])
  );

  if (isKaizenBrand()) {
    return <KaizenMoreScreen />;
  }

  if (isHealthBrand()) {
    return <HealthMoreScreen />;
  }

  if (isLanguageBrand()) {
    return <LanguageMoreScreen />;
  }

  // SettingsNavigator is a raw native-stack navigator; under expo-router it needs
  // its own container. Mirror the in-repo pattern in TaskDetailStackHost.tsx
  // (NavigationIndependentTree + NavigationContainer) so it doesn't crash with
  // "Couldn't register the navigator".
  return (
    <NavigationIndependentTree>
      <NavigationContainer>
        <SettingsNavigator initialParams={params} />
      </NavigationContainer>
    </NavigationIndependentTree>
  );
}
