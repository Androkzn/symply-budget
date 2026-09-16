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
import {
  SUPPORTED_REGION_COUNTRIES,
  findRegionCountry,
  resolveLocaleTaxRegion,
  type RegionSubdivision,
} from '@config/regions';
import { useDeviceType } from '@hooks/useDeviceType';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { useAppStore } from '@stores/appStore';
import { useAppColors } from '@theme';

import type { BackOnlyScreenProps } from './backOnlyScreenProps';

interface SelectRowProps {
  label: string;
  sublabel?: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}

function SelectRow({ label, sublabel, selected, onPress, testID }: SelectRowProps) {
  const colors = useAppColors();
  return (
    <Card
      variant="filled"
      pressable
      onPress={onPress}
      style={[styles.row, { backgroundColor: colors.backgroundSecondary }]}
      testID={testID}
    >
      <View style={styles.rowContent}>
        <Typography variant="body" weight="medium" color={colors.textPrimary}>
          {label}
        </Typography>
        {!!sublabel && (
          <Typography variant="footnote" color={colors.textSecondary}>
            {sublabel}
          </Typography>
        )}
      </View>
      {selected && <Icon name="checkmark-circle" size={22} color={colors.primary} />}
    </Card>
  );
}

export function RegionScreen({ navigation }: BackOnlyScreenProps = {}) {
  // Falls back to the ambient navigator when no prop arrives — the root
  // expo-router routes render this screen directly, with no `component=`
  // to hand one over. `NavigationContext` rather than `useNavigation()`
  // because the latter throws outside a navigator, and these screens are
  // rendered bare in their own unit tests.
  const ambientNavigation = useContext(NavigationContext);
  const goBack = () => (navigation ?? ambientNavigation)?.goBack();
  const colors = useAppColors();
  const taxCountry = useAppStore((state) => state.taxCountry);
  const taxRegion = useAppStore((state) => state.taxRegion);
  const setTaxRegion = useAppStore((state) => state.setTaxRegion);
  const { isTablet } = useDeviceType();
  const { content: containerPadding } = useLayoutPadding();

  const localeDefault = resolveLocaleTaxRegion();
  const displayCountry = taxCountry ?? localeDefault?.country ?? null;
  const country = findRegionCountry(displayCountry);
  const subdivisions: RegionSubdivision[] = country?.subdivisions ?? [];

  const selectCountry = (code: string) => {
    // Switching country invalidates the province/state until re-picked.
    setTaxRegion(code, code === displayCountry ? taxRegion : null);
  };

  return (
    <AppBackground opacity={0.5}>
      <ScreenHeader
        title="Region"
        showBackButton
        onBackPress={() => goBack()}
        showNotificationBell={false}
        showAvatar={false}
      />
      <View style={styles.container} testID="region-screen">
        <AdaptiveContainer maxWidth={isTablet ? 1000 : undefined} padding={containerPadding}>
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.section}>
              <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionHeader}>
                COUNTRY
              </Typography>
              {SUPPORTED_REGION_COUNTRIES.map((c) => (
                <SelectRow
                  key={c.code}
                  label={c.label}
                  selected={c.code === displayCountry}
                  onPress={() => selectCountry(c.code)}
                  testID={`region-country-${c.code}`}
                />
              ))}
            </View>

            {country && (
              <View style={styles.section}>
                <Typography
                  variant="footnote"
                  color={colors.textSecondary}
                  style={styles.sectionHeader}
                >
                  {country.subdivisionLabel.toUpperCase()}
                </Typography>
                {subdivisions.map((s) => (
                  <SelectRow
                    key={s.code}
                    label={s.label}
                    sublabel={s.code}
                    selected={s.code === taxRegion}
                    onPress={() => setTaxRegion(country.code, s.code)}
                    testID={`region-sub-${s.code}`}
                  />
                ))}
              </View>
            )}

            <Typography variant="footnote" color={colors.textSecondary} style={styles.footnote}>
              Used to calculate sales tax on scanned receipts when the receipt itself
              doesn’t print a tax total (e.g. GST/PST/HST in Canada, state sales tax in
              the US). A tax amount printed on the receipt always takes priority.
            </Typography>

            <ScreenScrollEnd testID={screenScrollEndTestId('region-screen')} />
          </ScrollView>
        </AdaptiveContainer>
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  scrollView: { flex: 1, backgroundColor: 'transparent' },
  content: { paddingTop: 16, paddingBottom: 100, backgroundColor: 'transparent' },
  section: { marginBottom: 24 },
  sectionHeader: { marginBottom: 12, marginLeft: 4, letterSpacing: 0.5 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  rowContent: { flex: 1 },
  footnote: { marginTop: 4, marginLeft: 4, lineHeight: 18 },
});
