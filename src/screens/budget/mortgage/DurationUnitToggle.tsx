import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import { FilterTabs, Typography } from '@components/ui';

import { DURATION_UNIT_TABS, type DurationUnit } from './duration';

interface DurationUnitToggleProps {
  /** Caption above the toggle, e.g. "Enter duration in". */
  label: string;
  unit: DurationUnit;
  onChange: (unit: DurationUnit) => void;
  labelStyle?: StyleProp<ViewStyle>;
}

/**
 * Years/Months segmented toggle used by the mortgage forms. One toggle drives
 * every duration field on the screen (§ amortization + term), so the user picks
 * the unit once and both inputs follow. Reuses the shared FilterTabs primitive.
 */
export function DurationUnitToggle({ label, unit, onChange, labelStyle }: DurationUnitToggleProps) {
  return (
    <>
      <Typography variant="label" weight="semibold" style={labelStyle}>
        {label}
      </Typography>
      <FilterTabs
        tabs={DURATION_UNIT_TABS}
        activeTab={unit}
        onTabChange={(id) => onChange(id as DurationUnit)}
        showActiveIndicator={false}
      />
    </>
  );
}
