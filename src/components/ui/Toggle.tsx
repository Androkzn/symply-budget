import React from 'react';
import { Platform, Switch, type SwitchProps } from 'react-native';

import { useAppColors } from '@theme';

export interface ToggleProps
  extends Omit<SwitchProps, 'trackColor' | 'thumbColor' | 'ios_backgroundColor'> {
  /**
   * Override the "on" track color. Defaults to the brand accent
   * (`useAppColors().primary` — the mint/teal green). Only pass this for
   * toggles that sit on a colored/gradient surface where it wouldn't read.
   */
  activeColor?: string;
  /**
   * Override the "off" track color. Defaults to `useAppColors().borderColor`.
   * Only pass this (with `activeColor`) for toggles on a colored/gradient
   * surface where the default border gray wouldn't read.
   */
  inactiveColor?: string;
  /** Override the thumb color (defaults: white on Android, system on iOS). */
  thumbColor?: string;
}

/**
 * App-standard on/off switch.
 *
 * Wraps RN `Switch` so EVERY toggle in the app shares one tokenized "on"
 * color — the brand mint/teal accent (`colors.primary` #4ECDC4), matching
 * the app's buttons and badges — plus consistent off-track / thumb colors
 * across iOS and Android. Prefer this over using `Switch` directly — never
 * set `trackColor` / `thumbColor` / `ios_backgroundColor` inline per screen.
 */
export function Toggle({ activeColor, inactiveColor, thumbColor, value, ...props }: ToggleProps) {
  const colors = useAppColors();
  const onColor = activeColor ?? colors.primary;
  const offColor = inactiveColor ?? colors.borderColor;

  return (
    <Switch
      trackColor={{ false: offColor, true: onColor }}
      thumbColor={thumbColor ?? (Platform.OS === 'android' ? colors.white : undefined)}
      ios_backgroundColor={offColor}
      {...props}
      // RN's `Switch` renders `value === true` — STRICTLY. A row whose flag was
      // persisted as SQLite's 1/0 (or any other truthy non-boolean that slipped
      // past the `boolean` type at a JSON/storage boundary) reads as "on" to
      // every `if (row.flag)` in JS, yet renders OFF here — a silent, total
      // disagreement between the switch and the data around it (Monthly
      // Payments showed every active payment counted in its totals with every
      // toggle off). Coerce so the switch always agrees with truthiness.
      value={!!value}
    />
  );
}
