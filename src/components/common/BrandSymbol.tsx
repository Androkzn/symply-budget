import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';

import { Icon, hasBrandIcon } from '@components/ui/Icon';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

export type BrandSymbolProps = {
  /** @deprecated SF Symbols are not used when the brand kit covers the glyph. */
  sfSymbol?: string;
  /** Ionicons glyph (Android + legacy fallback). */
  ionicon: string;
  /** Brand PNG icon-kit name. When set and present in the kit, it wins. */
  brandIcon?: string;
  focused?: boolean;
  size?: number;
  color: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Tab / nav chrome icon. Resolution order:
 *   1. Brand PNG kit (`brandIcon`, then aliased `ionicon`)
 *   2. Tinted Ionicons when the active brand has no kit entry
 */
export function BrandSymbol({
  ionicon,
  brandIcon,
  focused = false,
  size = 24,
  color,
  style,
}: BrandSymbolProps) {
  const kitName = brandIcon && hasBrandIcon(brandIcon) ? brandIcon : undefined;
  const resolved = kitName ?? (hasBrandIcon(ionicon) ? ionicon : undefined);

  if (resolved) {
    return (
      <Icon
        name={resolved}
        active={focused}
        size={size}
        color={color}
        style={style as StyleProp<import('react-native').ImageStyle>}
      />
    );
  }

  const ionName = (focused ? ionicon : `${ionicon}-outline`) as IoniconName;
  return (
    <Ionicons name={ionName} size={size} color={color} style={style} />
  );
}
