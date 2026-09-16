/**
 * The header gear — one component, every House tab root.
 *
 * House's settings used to be reachable only from the More tab, which meant
 * every preference was a tab switch, a scroll and two taps away from wherever
 * the member actually was. The gear now sits in the header of each pinned tab,
 * left of the notification bell and the avatar, exactly as it does on Budget's
 * tabs — so "change something about this app" is one tap from anywhere.
 *
 * It renders NOTHING outside House. The screens that draw it (Home, Tasks,
 * Chat, Reports, …) are shared with other brands, and full Budget already has
 * its own gear wired to `BudgetSettings`; a component that self-gates keeps
 * every one of those call sites a single unconditional line.
 *
 * `/house-settings` rather than a push into the Settings stack: that stack is
 * hosted by the More TAB, and a gear on the Garden tab cannot navigate into
 * another tab's navigator without switching tabs. See `app/house-settings.tsx`.
 */

import { useRouter } from 'expo-router';
import React from 'react';

import { isHouseBrand } from '@brand';
import { HeaderActionButton } from '@components/common/HeaderActionButton';
import { Icon } from '@components/ui/Icon';
import { Header, useAppColors } from '@theme';

interface SettingsGearButtonProps {
  /** Overrides the default id — only needed if a screen already ships one. */
  testID?: string;
}

export function SettingsGearButton({
  testID = 'header-settings-gear',
}: SettingsGearButtonProps = {}) {
  const router = useRouter();
  const colors = useAppColors();

  if (!isHouseBrand()) return null;

  return (
    <HeaderActionButton
      iconOnly
      onPress={() => router.push('/house-settings')}
      testID={testID}
      accessibilityLabel="Settings"
    >
      <Icon name="cog-outline" size={Header.actionIconSize} color={colors.primary} />
    </HeaderActionButton>
  );
}
