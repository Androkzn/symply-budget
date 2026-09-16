import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { useAppColors } from '@theme';
import { formatMoney, useDisplayCurrency } from '@utils/money';

import {
  SPENDING_EXTRA_BANNER_TEST_IDS,
  SPENDING_EXTRA_COPY,
  type SpendingExtraKind,
} from './budgetSpendingExtras';

interface Props {
  kind: SpendingExtraKind;
  /** The month's figure, in cents. The caller hides the banner at zero. */
  cents: number;
  /**
   * Opens the figure's detail page (what it is, how it is summed, the previous
   * months). When absent the banner is a plain statement with no chevron.
   */
  onPress?: (kind: SpendingExtraKind) => void;
}

/** Accent per kind — the same three tones the banners carried before they became links. */
export function spendingExtraAccent(
  kind: SpendingExtraKind,
  colors: ReturnType<typeof useAppColors>,
): string {
  switch (kind) {
    case 'discounts':
      return colors.success;
    case 'deposits':
      return colors.warning;
    case 'taxes':
      return colors.info;
  }
}

/**
 * One "You saved / You paid … this month" banner on the Spent tab. Given an
 * `onPress` the whole row is the link and a trailing chevron says so — the
 * same affordance the dashboard's category rows use. The figure follows
 * Settings → Currency; the sentence and the icon come from `SPENDING_EXTRA_COPY`.
 */
export function BudgetSpendingExtraBanner({ kind, cents, onPress }: Props) {
  const colors = useAppColors();
  // Re-render the figure when the display currency changes.
  useDisplayCurrency();
  const copy = SPENDING_EXTRA_COPY[kind];
  const accent = spendingExtraAccent(kind, colors);
  const testID = SPENDING_EXTRA_BANNER_TEST_IDS[kind];
  const tappable = !!onPress;

  const content = (
    <>
      <Icon name={copy.icon} size={18} color={accent} />
      <Typography variant="body" style={styles.text}>
        {copy.bannerLead}{' '}
        <Typography variant="body" weight="bold" color={accent}>
          {formatMoney(cents, { decimals: 2 })}
        </Typography>{' '}
        {copy.bannerTail}
      </Typography>
      {tappable && <Icon name="chevron-forward" size={16} color={colors.textTertiary} />}
    </>
  );

  const bannerStyle = [
    styles.banner,
    { backgroundColor: colors.backgroundSecondary, borderColor: accent },
  ];

  if (!tappable) {
    return (
      <View style={bannerStyle} testID={testID}>
        {content}
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={bannerStyle}
      onPress={() => onPress(kind)}
      activeOpacity={0.6}
      accessibilityRole="button"
      accessibilityLabel={copy.detailLabel}
      testID={testID}
    >
      {content}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
  },
  text: {
    flex: 1,
  },
});
