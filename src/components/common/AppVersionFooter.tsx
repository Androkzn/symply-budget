/**
 * APP VERSION FOOTER — the one line that says exactly which build a member (or a
 * tester on TestFlight) is looking at, and what it is talking to.
 *
 * It replaces the copy-pasted footer that lived at the bottom of both settings
 * hubs and reported `v1.0.0 (Build 1)` on every install, because `ENV.APP_VERSION`
 * / `ENV.BUILD_NUMBER` were hardcoded strings (House was on build 45). Those now
 * read the native bundle, and the second line adds the two facts a bug report is
 * useless without:
 *
 *  - WHICH BACKEND — staging or production. This used to render the literal
 *    `Staging` whenever `__DEV__`, which is neither of the two things that
 *    actually decide it (the EAS build profile and the Xcode scheme override,
 *    see `@config/env`): a release archive pointed at staging said nothing at
 *    all. Now it prints the resolved target, always.
 *  - WHEN THE BUNDLE WAS BUILT — stamped by app.config.ts, so an EAS Update that
 *    silently failed to apply is visible as an old timestamp under an unchanged
 *    version + build number.
 *
 * Staging is deliberately loud (warning colour) and production quiet: the point
 * of the line is to catch a build that is talking somewhere unexpected.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Typography } from '@components/ui';
import { ENV } from '@config/env';
import { useAppColors } from '@theme';

/**
 * `2026-09-04T14:32:11Z` → `Sep 4, 2026, 2:32 PM` in the device's own locale and
 * timezone. Falls back to a trimmed ISO string on a runtime whose `Intl` data is
 * missing (Hermes without full ICU), and to nothing at all when the bundle
 * carries no stamp — an unstamped build must not render "Invalid Date".
 */
export function formatBuildTime(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
  }
}

export interface AppVersionFooterProps {
  /** Root testID; the two lines get `-version` / `-meta` suffixes. */
  testID?: string;
}

export function AppVersionFooter({ testID = 'app-version-footer' }: AppVersionFooterProps) {
  const colors = useAppColors();
  const builtAt = formatBuildTime(ENV.BUILD_TIME);

  return (
    <View style={styles.footer} testID={testID}>
      <Typography
        variant="caption2"
        color={colors.textTertiary}
        align="center"
        testID={`${testID}-version`}
      >
        {`${ENV.APP_NAME} v${ENV.APP_VERSION} (Build ${ENV.BUILD_NUMBER})`}
      </Typography>
      <Typography
        variant="caption2"
        weight="semibold"
        color={ENV.IS_PRODUCTION ? colors.textTertiary : colors.warning}
        align="center"
        style={styles.meta}
        testID={`${testID}-meta`}
      >
        {builtAt ? `${ENV.ENV_LABEL} · Built ${builtAt}` : ENV.ENV_LABEL}
      </Typography>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    alignItems: 'center',
    marginTop: 8,
  },
  meta: {
    marginTop: 2,
    letterSpacing: 0.5,
  },
});
