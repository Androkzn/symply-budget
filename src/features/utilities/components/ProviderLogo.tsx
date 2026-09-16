import { Image } from 'expo-image';
import React from 'react';

import { Icon } from '@components/ui/Icon';
import type { ProviderKey } from '@features/utilities/api/utilities';
import type { IoniconName } from '@features/utilities/providers/bill-providers';
import { getProviderLogo } from '@features/utilities/providers/provider-logos';
import { useAppColors } from '@theme';

interface ProviderLogoProps {
  /** Fixed provider dashboard key (bc_hydro / fortisbc / city_of_surrey / …). */
  providerKey?: ProviderKey | null;
  /** Free-text provider name off a bill (e.g. "BC Hydro", "Coquitlam"). */
  providerName?: string | null;
  /** Ionicon shown when no bundled logo matches. */
  fallbackIcon: IoniconName;
  /** Logo/icon height in px (also the fallback icon size). */
  size?: number;
  /** Max logo width — wordmarks are wide, so this defaults to `size * 2.6`. */
  logoWidth?: number;
}

/**
 * Renders a utility provider's brand logo when one is bundled, otherwise falls
 * back to an Ionicon (matching the app's icon style).
 *
 * The logo/icon is drawn directly on the surface — no chip, background, or
 * border — and left-anchored so wide wordmarks line up with adjacent text.
 */
export function ProviderLogo({
  providerKey,
  providerName,
  fallbackIcon,
  size = 48,
  logoWidth,
}: ProviderLogoProps) {
  const colors = useAppColors();
  const logo = getProviderLogo(providerKey, providerName);

  if (logo) {
    return (
      <Image
        source={logo}
        style={{ width: logoWidth ?? size * 2.6, height: size }}
        contentFit="contain"
        contentPosition="left"
        transition={120}
      />
    );
  }

  return <Icon name={fallbackIcon} size={size} color={colors.primary} />;
}
