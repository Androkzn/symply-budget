import { NavigationContext } from 'expo-router/react-navigation';
import React, { useContext } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import {
  AppBackground,
  ScreenHeader,
  ScreenScrollEnd,
  screenScrollEndTestId,
} from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Card, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { SUPPORTED_CURRENCIES, type CurrencyOption } from '@config/currencies';
import { useDeviceType } from '@hooks/useDeviceType';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { useAppStore } from '@stores/appStore';
import { useAppColors } from '@theme';

import type { BackOnlyScreenProps } from './backOnlyScreenProps';

interface CurrencyRowProps {
  option: CurrencyOption;
  selected: boolean;
  onPress: () => void;
}

function CurrencyRow({ option, selected, onPress }: CurrencyRowProps) {
  const colors = useAppColors();
  return (
    <Card
      variant="filled"
      pressable
      onPress={onPress}
      style={[styles.row, { backgroundColor: colors.backgroundSecondary }]}
      testID={`currency-row-${option.code}`}
    >
      <View style={[styles.symbolBadge, { backgroundColor: colors.surfaceSelected }]}>
        <Typography variant="body" weight="bold" color={colors.textPrimary}>
          {option.symbol}
        </Typography>
      </View>
      <View style={styles.rowContent}>
        <Typography variant="body" weight="medium" color={colors.textPrimary}>
          {option.label}
        </Typography>
        <Typography variant="footnote" color={colors.textSecondary}>
          {option.code}
        </Typography>
      </View>
      {selected && (
        <Icon name="checkmark-circle" size={22} color={colors.primary} />
      )}
    </Card>
  );
}

export function CurrencyScreen({ navigation }: BackOnlyScreenProps = {}) {
  // Falls back to the ambient navigator when no prop arrives — the root
  // expo-router routes render this screen directly, with no `component=`
  // to hand one over. `NavigationContext` rather than `useNavigation()`
  // because the latter throws outside a navigator, and these screens are
  // rendered bare in their own unit tests.
  const ambientNavigation = useContext(NavigationContext);
  const goBack = () => (navigation ?? ambientNavigation)?.goBack();
  const colors = useAppColors();
  const currency = useAppStore((state) => state.currency);
  const setCurrency = useAppStore((state) => state.setCurrency);
  const { isTablet } = useDeviceType();
  const { content: containerPadding } = useLayoutPadding();

  return (
    <AppBackground opacity={0.5}>
      <ScreenHeader
        title="Currency"
        showBackButton
        onBackPress={() => goBack()}
        showNotificationBell={false}
        showAvatar={false}
      />
      <View style={styles.container} testID="currency-screen">
        <AdaptiveContainer maxWidth={isTablet ? 1000 : undefined} padding={containerPadding}>
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.section}>
              <Typography
                variant="footnote"
                color={colors.textSecondary}
                style={styles.sectionHeader}
              >
                DISPLAY CURRENCY
              </Typography>

              {SUPPORTED_CURRENCIES.map((option) => (
                <CurrencyRow
                  key={option.code}
                  option={option}
                  selected={option.code === currency}
                  onPress={() => setCurrency(option.code)}
                />
              ))}

              <Typography
                variant="footnote"
                color={colors.textSecondary}
                style={styles.footnote}
              >
                Changes the symbol used to display amounts. Existing amounts are
                not converted between currencies.
              </Typography>
            </View>
            <ScreenScrollEnd testID={screenScrollEndTestId('currency-screen')} />
          </ScrollView>
        </AdaptiveContainer>
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  scrollView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  content: {
    paddingTop: 16,
    paddingBottom: 100,
    backgroundColor: 'transparent',
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    marginBottom: 12,
    marginLeft: 4,
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  symbolBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rowContent: {
    flex: 1,
  },
  footnote: {
    marginTop: 12,
    marginLeft: 4,
    lineHeight: 18,
  },
});
