/**
 * ProviderBrandMark — a compact, recognisable mark for each AI provider.
 *
 * Each provider's official vector logo (see `ProviderLogo`) sits on a rounded
 * tile in the provider's own accent colour — reads as premium, stays crisp at
 * any size, and adds no bundled PNG weight. An optional `connected` badge
 * overlays a success check so pickers and the manage hub can show at a glance
 * which keys are already attached.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';

import type { AIProviderId } from '@api/aiAccess';
import { Icon } from '@components/ui';
import { useAppColors } from '@theme';

import { ProviderGlyph } from './ProviderLogo';
import { PROVIDER_META } from './providerMeta';

interface ProviderBrandMarkProps {
  provider: AIProviderId;
  /** Tile edge length. Default 44. */
  size?: number;
  /** Overlay a success check badge (already-connected state). */
  connected?: boolean;
}

export function ProviderBrandMark({ provider, size = 44, connected = false }: ProviderBrandMarkProps) {
  const colors = useAppColors();
  const meta = PROVIDER_META[provider];
  const radius = Math.round(size * 0.28);
  const badgeSize = Math.round(size * 0.42);

  return (
    <View style={{ width: size, height: size }}>
      <View
        style={[
          styles.tile,
          {
            width: size,
            height: size,
            borderRadius: radius,
            backgroundColor: meta.accent,
          },
        ]}
      >
        <ProviderGlyph provider={provider} size={Math.round(size * 0.56)} color={colors.white} />
      </View>

      {connected ? (
        <View
          style={[
            styles.badge,
            {
              width: badgeSize,
              height: badgeSize,
              borderRadius: badgeSize / 2,
              backgroundColor: colors.success,
              borderColor: colors.backgroundMain,
            },
          ]}
        >
          <Icon name="checkmark" size={Math.round(badgeSize * 0.62)} color={colors.white} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
});
