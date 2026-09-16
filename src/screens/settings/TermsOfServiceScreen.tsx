import { NavigationContext } from 'expo-router/react-navigation';
import React, { useContext } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { brandId } from '@brand';
import { AppBackground, SafeAreaView, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { buildTermsSections, LegalSections } from '@components/onboarding';
import { Typography } from '@components/ui';
import { ENV } from '@config/env';
import { useAppColors } from '@theme';

import type { BackOnlyScreenProps } from './backOnlyScreenProps';

const LAST_UPDATED = 'January 25, 2026';
const EFFECTIVE_DATE = 'January 25, 2026';

/**
 * Terms of Service — shared UI, per-brand content. The document body comes from
 * the active brand's content pack (@config/brandContent) via the shared
 * LegalDocument builders, so every app renders its own Terms without forking
 * this screen. Same content is shown in the onboarding agreement sheet.
 */
export function TermsOfServiceScreen({ navigation }: BackOnlyScreenProps = {}) {
  // Falls back to the ambient navigator when no prop arrives — the root
  // expo-router routes render this screen directly, with no `component=`
  // to hand one over. `NavigationContext` rather than `useNavigation()`
  // because the latter throws outside a navigator, and these screens are
  // rendered bare in their own unit tests.
  const ambientNavigation = useContext(NavigationContext);
  const goBack = () => (navigation ?? ambientNavigation)?.goBack();
  const colors = useAppColors();

  return (
    <AppBackground>
    <SafeAreaView edges={[]}>
      <ScreenHeader
        title="Terms of Service"
        showBackButton
        onBackPress={() => goBack()}
        showNotificationBell={false}
        showAvatar={false}
      />

      <ScrollView
        style={[screenScrollViewStyle.scroll, styles.container, { backgroundColor: colors.backgroundMain }]}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.dateCard, { backgroundColor: colors.backgroundSecondary }]}>
          <Typography variant="footnote" color={colors.textSecondary}>
            Last Updated: {LAST_UPDATED}
          </Typography>
          <Typography variant="footnote" color={colors.textSecondary}>
            Effective Date: {EFFECTIVE_DATE}
          </Typography>
        </View>

        <LegalSections sections={buildTermsSections(ENV.APP_NAME, brandId)} />
      </ScrollView>
    </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 60,
  },
  dateCard: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 24,
    gap: 4,
  },
});
