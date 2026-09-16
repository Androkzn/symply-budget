import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';

import { brandId } from '@brand';
import { HealthSpinner } from '@features/health/components/HealthSpinner';
import { HouseSpinner } from '@features/house/components/HouseSpinner';

import { SymplySpinner } from './SymplySpinner';

/**
 * Branded drop-in replacement for React Native's `ActivityIndicator`.
 *
 * Every screen in the ecosystem imports `ActivityIndicator` from here instead of
 * from `react-native`, so the platform spinner is transparently replaced by the
 * Symply brush-stroke spinner everywhere. The prop surface mirrors RN's component
 * (`size`, `color`, `animating`, `style`, `testID`) so call sites need no change.
 *
 * The spinner is brand-aware: Symply Health renders its own red brush-stroke
 * [HealthSpinner] (a rotating enso ring with a beating heart); Symply House
 * renders its own teal brush-stroke [HouseSpinner] (a rotating ring with a
 * pulsing house mark); every other brand (Budget, Kaizen, Language) renders the
 * lime→teal [SymplySpinner].
 */
export interface ActivityIndicatorProps {
  /** `'small'` (20px) · `'large'` (36px) · explicit diameter in px. */
  size?: 'small' | 'large' | number;
  /**
   * Solid override colour — used on coloured surfaces (e.g. white inside a
   * gradient button). Omit to render the branded lime→teal gradient.
   */
  color?: string;
  /** When `false`, nothing renders (mirrors a stopped RN indicator). */
  animating?: boolean;
  /** Accepted for RN parity; the spinner is vector so it never leaves a gap. */
  hidesWhenStopped?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function ActivityIndicator({
  size = 'small',
  color,
  animating = true,
  style,
  testID,
}: ActivityIndicatorProps) {
  if (animating === false) {
    return null;
  }
  if (brandId === 'symply-health') {
    return <HealthSpinner size={size} style={style} testID={testID} />;
  }
  if (brandId === 'symply-house') {
    return <HouseSpinner size={size} color={color} style={style} testID={testID} />;
  }
  return <SymplySpinner size={size} color={color} style={style} testID={testID} />;
}

export default ActivityIndicator;
