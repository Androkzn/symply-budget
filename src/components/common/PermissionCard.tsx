import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { BottomSheet, Button, Card, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { Spacing, hexToRgba, useAppColors, type AppColors } from '@theme';
import type { PermissionState } from '@utils/permissionState';

/**
 * PermissionCard — the ONE surface for "this needs an OS permission" across
 * every app in the fleet, generalised from Health's `HealthKitConnectCard`
 * (the only permission that had this treatment before). Camera, microphone
 * and notifications all reduce to the same four states
 * (`unavailable` / `not-requested` / `denied` / `granted`), so the state
 * machine lives once here; only the explanatory copy is per call site.
 *
 * ## The two flows this exists for
 *
 * `not-requested` — the OS has never asked. `onRequest` fires the native
 * sheet directly; that sheet is the cheapest possible path and a detour
 * through Settings here would be actively worse.
 *
 * `denied` — the OS sheet already fired once and iOS/Android will never show
 * it again (`canAskAgain: false`). The ONLY route back is Settings, so this
 * is the one state with an "Open Settings" button instead of a request
 * button. It is a legitimate, calm choice — not rendered as an error.
 *
 * `granted` and `unavailable` are ordinary states too: nothing here implies
 * the app is broken or diminished, matching the tone `HealthKitConnectCard`
 * already established for Apple Health.
 */

export interface PermissionCardCopy {
  /** Explanation shown for this state. Required for `not-requested` and `denied`. */
  body: string;
}

export interface PermissionCardProps {
  state: PermissionState;
  icon: string;
  title: string;
  /** Per-state explanation. `granted` / `unavailable` fall back to a generic line if omitted. */
  copy: {
    'not-requested': PermissionCardCopy;
    denied: PermissionCardCopy;
    granted?: PermissionCardCopy;
    unavailable?: PermissionCardCopy;
  };
  /** Fires the native permission sheet. Omit to hide the action in `not-requested`. */
  onRequest?: () => void;
  /** Deep link to the OS Settings app. Shown only in `denied`. */
  onOpenSettings?: () => void;
  /**
   * Renders a small dismiss (×) in the header when provided. For a card
   * pinned to a Home tab — seen every session, not just once in Settings —
   * a member gets to say "not now" without the card blocking anything else
   * on the screen. Omit on a dedicated settings/onboarding screen, where the
   * card IS the content and dismissing it would just hide the only thing
   * there.
   */
  onDismiss?: () => void;
  busy?: boolean;
  /**
   * `full` (default) renders the explanation paragraph inline — for a
   * dedicated onboarding screen where this IS the content. `compact`
   * collapses to a single actionable banner row, moving the same
   * explanation behind an (i) bottom sheet — for a card sharing space with
   * the rest of a Home or settings screen. Matches `HealthKitConnectCard`'s
   * same `layout` prop, the two having always shared this treatment.
   */
  layout?: 'full' | 'compact';
  /**
   * Compact banners normally place their action below the heading. The
   * Budget home banner follows House's tighter notification treatment, with
   * Allow/Open Settings in the heading row.
   */
  compactActionPlacement?: 'below' | 'header';
  testID?: string;
}

const DEFAULT_GRANTED_BODY = 'Access is on.';
const DEFAULT_UNAVAILABLE_BODY = 'Not available on this device.';

export function PermissionCard({
  state,
  icon,
  title,
  copy,
  onRequest,
  onOpenSettings,
  onDismiss,
  busy = false,
  layout = 'full',
  compactActionPlacement = 'below',
  testID = 'permission-card',
}: PermissionCardProps) {
  const colors = useAppColors();
  const tint = state === 'granted' ? colors.primary : colors.textSecondary;

  const body =
    state === 'not-requested'
      ? copy['not-requested'].body
      : state === 'denied'
        ? copy.denied.body
        : state === 'granted'
          ? (copy.granted?.body ?? DEFAULT_GRANTED_BODY)
          : (copy.unavailable?.body ?? DEFAULT_UNAVAILABLE_BODY);

  if (layout === 'compact') {
    return (
      <CompactPermissionBanner
        state={state}
        icon={icon}
        title={title}
        body={body}
        tint={tint}
        colors={colors}
        onRequest={onRequest}
        onOpenSettings={onOpenSettings}
        onDismiss={onDismiss}
        busy={busy}
        actionPlacement={compactActionPlacement}
        testID={testID}
      />
    );
  }

  return (
    <Card
      variant="filled"
      style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
      testID={testID}
    >
      <View style={styles.header}>
        <Icon name={icon} size={22} color={tint} />
        <Typography variant="headline" weight="semibold" style={styles.headerTitle} testID={`${testID}-title`}>
          {title}
        </Typography>
        {onDismiss ? (
          <Pressable
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            testID={`${testID}-dismiss`}
          >
            <Icon name="close" size={18} color={colors.textTertiary} />
          </Pressable>
        ) : null}
      </View>

      <Typography variant="body" color={colors.textSecondary} testID={`${testID}-body`}>
        {body}
      </Typography>

      {state === 'not-requested' && onRequest ? (
        <Button
          title={busy ? 'Requesting…' : 'Allow'}
          variant="primary"
          onPress={onRequest}
          disabled={busy}
          testID={`${testID}-request`}
        />
      ) : null}

      {state === 'denied' && onOpenSettings ? (
        <Button
          title="Open Settings"
          variant="outline"
          onPress={onOpenSettings}
          testID={`${testID}-settings`}
        />
      ) : null}
    </Card>
  );
}

interface CompactPermissionBannerProps {
  state: PermissionState;
  icon: string;
  title: string;
  body: string;
  tint: string;
  colors: AppColors;
  onRequest?: () => void;
  onOpenSettings?: () => void;
  onDismiss?: () => void;
  busy: boolean;
  actionPlacement: 'below' | 'header';
  testID: string;
}

/**
 * The Home/settings-list rendering: one actionable row instead of a full
 * paragraph. The explanation isn't dropped — it moves behind the (i)
 * button's bottom sheet, matching `HealthKitConnectCard`'s compact layout.
 */
function CompactPermissionBanner({
  state,
  icon,
  title,
  body,
  tint,
  colors,
  onRequest,
  onOpenSettings,
  onDismiss,
  busy,
  actionPlacement,
  testID,
}: CompactPermissionBannerProps) {
  const [sheetVisible, setSheetVisible] = useState(false);

  const action =
    state === 'denied'
      ? onOpenSettings
        ? { label: 'Open Settings', onPress: onOpenSettings }
        : null
      : state === 'not-requested' && onRequest
        ? { label: busy ? 'Requesting…' : 'Allow', onPress: onRequest }
        : null;

  const actionControl = action ? (
    <Button
      title={action.label}
      variant="primary"
      size="sm"
      onPress={action.onPress}
      disabled={busy}
      style={styles.bannerAction}
      testID={`${testID}-action`}
    />
  ) : null;

  return (
    <Card
      variant="filled"
      style={[styles.bannerCard, { backgroundColor: hexToRgba(colors.primary, 0.1) }]}
      testID={testID}
    >
      <View style={styles.header}>
        <Icon name={icon} size={20} color={tint} />
        <Typography
          variant="subheadline"
          weight="semibold"
          style={styles.headerTitle}
          numberOfLines={1}
          testID={`${testID}-title`}
        >
          {title}
        </Typography>
        <Pressable
          onPress={() => setSheetVisible(true)}
          accessibilityRole="button"
          accessibilityLabel={`About ${title}`}
          hitSlop={8}
          testID={`${testID}-info`}
        >
          <Icon name="information-circle" size={18} color={state === 'granted' ? colors.primary : colors.error} />
        </Pressable>
        {actionPlacement === 'header' ? actionControl : null}
        {onDismiss ? (
          <Pressable
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            testID={`${testID}-dismiss`}
          >
            <Icon name="close" size={18} color={colors.textTertiary} />
          </Pressable>
        ) : null}
      </View>

      {actionPlacement === 'below' ? actionControl : null}

      <BottomSheet visible={sheetVisible} onClose={() => setSheetVisible(false)} height="content" title={title} showCloseButton>
        <Typography variant="body" color={colors.textSecondary} testID={`${testID}-body`}>
          {body}
        </Typography>
      </BottomSheet>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.base,
    gap: Spacing.sm,
  },
  bannerCard: {
    padding: Spacing.sm,
    gap: Spacing.xs,
  },
  bannerAction: {
    alignSelf: 'flex-start',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  headerTitle: {
    flex: 1,
  },
});
