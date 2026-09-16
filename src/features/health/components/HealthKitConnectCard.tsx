import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { BottomSheet, Button, Card, Icon, Typography } from '@components/ui';
import { CornerRadius, Spacing, hexToRgba, useAppColors, type AppColors } from '@theme';

import type { HealthKitConnectionState } from '../healthKit';
import { HEALTHKIT_DESCRIPTORS, type HealthKitTypeDescriptor } from '../healthKitTypes';

/**
 * Apple Health connect card — the whole user-facing surface of the HealthKit
 * integration (parity phase P3).
 *
 * ## The four states are equals
 *
 * `unavailable`, `not-requested`, `denied` and `connected` are four ordinary
 * outcomes, not one success and three failures. Nothing here renders in an
 * error tone, nothing shows a system string, and nothing implies the app is
 * broken or diminished without Apple Health — because it isn't. Every Health tab
 * works on manual entry alone, which is why each state says so out loud instead
 * of leaving the user to wonder what they lost.
 *
 * `denied` in particular is a legitimate choice a privacy-minded person makes on
 * purpose. It gets a calm explanation and a route to Settings, never a retry
 * nag, never a red banner, never a toast.
 *
 * ## The scope list is not decoration
 *
 * Every state — including `not-requested`, BEFORE the OS sheet appears — lists
 * exactly which five data types we read and why, and states that we never write
 * back. A permission sheet is a bad place to learn what you are agreeing to; the
 * honest place is here, before the tap. The list is rendered from
 * `HEALTHKIT_DESCRIPTORS`, the same table the service hands to iOS, so the
 * promise on screen cannot drift from the request on the wire. `layout="full"`
 * (onboarding, where this IS the screen) keeps that list inline for exactly
 * this reason; `layout="compact"` (Home/Weight/More, where it's one card among
 * many) still says all of it, just one (i) tap away instead of unavoidable.
 */

export interface HealthKitConnectCardProps {
  state: HealthKitConnectionState;
  /** ISO instant of the last successful import, if any. */
  lastSyncedAt?: string | null;
  /** Connect (not-requested) / Sync now (connected). Omit to hide the action. */
  onConnect?: () => void;
  /** Deep link to iOS Settings, offered only in the `denied` state. */
  onOpenSettings?: () => void;
  /**
   * Renders a small dismiss (×) in the header when provided — for a card
   * pinned to Home (seen every session), matching `PermissionCard`'s same
   * capability. Omit on More/Weight/onboarding, where the card IS the content.
   */
  onDismiss?: () => void;
  /** Disables the action and shows progress copy while an import runs. */
  busy?: boolean;
  /**
   * `full` (default) renders the whole scope list and explanation inline —
   * for a dedicated screen (onboarding) where this IS the content, and the
   * five data types must be visible before the OS prompt, never behind a
   * tap. `compact` collapses everything but the title and action into a
   * single actionable banner row, moving the same explanation behind an
   * (i) bottom sheet — for a card that shares space with the rest of
   * Home/Weight/More instead of being the whole page.
   */
  layout?: 'full' | 'compact';
  testID?: string;
}

interface StateCopy {
  icon: string;
  title: string;
  /** Omit when the title and scope list already say enough on their own. */
  body?: string;
  /**
   * The reassurance that manual entry is unaffected. Omitted only for
   * `not-requested`, where the action label and scope list already carry
   * the whole pitch — nothing here restates a promise the other three
   * states still need to make in words.
   */
  manualNote?: string;
  actionLabel: string | null;
}

const COPY: Record<HealthKitConnectionState, StateCopy> = {
  unavailable: {
    icon: 'healthkit-off',
    title: 'Apple Health isn’t available here',
    body: 'This device doesn’t provide Apple Health data.',
    manualNote: 'Nothing is missing — every tab works exactly the same with entries you add yourself.',
    actionLabel: null,
  },
  'not-requested': {
    icon: 'healthkit-off',
    title: 'Apple Health — not connected',
    actionLabel: 'Connect Apple Health',
  },
  denied: {
    icon: 'denied',
    title: 'Apple Health access is off',
    body: 'That’s a fine choice — we asked, and the answer was no. Symply Health reads nothing from Apple Health.',
    manualNote: 'Everything still works. If you change your mind, Apple Health access lives in Settings › Health › Data Access & Devices.',
    actionLabel: null,
  },
  connected: {
    icon: 'healthkit',
    title: 'Apple Health connected',
    body: 'Symply Health reads the five data types below and adds them to your log.',
    manualNote: 'Days you logged yourself are never replaced — your own entries always win.',
    actionLabel: 'Sync now',
  },
};

/** "Last synced" line. Relative for today, absolute once it stops being useful. */
export function formatLastSynced(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return 'Not synced yet';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'Not synced yet';

  const minutes = Math.floor((now.getTime() - at.getTime()) / 60000);
  if (minutes < 1) return 'Synced just now';
  if (minutes < 60) return `Synced ${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Synced ${hours} h ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return 'Synced yesterday';
  if (days < 7) return `Synced ${days} days ago`;
  return `Synced ${at.toLocaleDateString()}`;
}

function ScopeRow({
  descriptor,
  testID,
  tint,
  subtle,
}: {
  descriptor: HealthKitTypeDescriptor;
  testID: string;
  tint: string;
  subtle: string;
}) {
  // The read/not-imported distinction is the user's to know: `bodyMass` is shown
  // in the app but never sent anywhere, and saying so is cheaper than being
  // asked later why a weight appeared in a log they didn't write.
  const detail = descriptor.notImportedReason ?? descriptor.purpose;

  return (
    <View
      style={styles.scopeRow}
      testID={testID}
      accessible
      accessibilityLabel={`${descriptor.label}. ${detail}`}
    >
      <Icon name={descriptor.icon} size={24} color={tint} />
      <View style={styles.scopeText}>
        <Typography variant="footnote" weight="medium">
          {descriptor.label}
        </Typography>
        <Typography variant="caption1" color={subtle}>
          {detail}
        </Typography>
      </View>
    </View>
  );
}

export function HealthKitConnectCard({
  state,
  lastSyncedAt = null,
  onConnect,
  onOpenSettings,
  onDismiss,
  busy = false,
  layout = 'full',
  testID = 'healthkit-connect-card',
}: HealthKitConnectCardProps) {
  const colors = useAppColors();
  const copy = COPY[state];

  // Brand color in every state — these are data-type/status icons, not a
  // success/failure signal, so they read as part of the app's identity.
  const tint = colors.primary;

  if (layout === 'compact') {
    return (
      <CompactHealthKitBanner
        state={state}
        copy={copy}
        colors={colors}
        tint={tint}
        lastSyncedAt={lastSyncedAt}
        onConnect={onConnect}
        onOpenSettings={onOpenSettings}
        onDismiss={onDismiss}
        busy={busy}
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
        <Icon name={copy.icon} size={22} color={tint} />
        <Typography variant="headline" weight="semibold" style={styles.headerTitle} testID={`${testID}-title`}>
          {copy.title}
        </Typography>
        {onDismiss ? (
          <Pressable
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            testID={`${testID}-dismiss`}
          >
            <Icon name="close" size={18} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>

      {copy.body ? (
        <Typography variant="body" color={colors.textSecondary} testID={`${testID}-body`}>
          {copy.body}
        </Typography>
      ) : null}

      {/* The HealthKit-OFF promise, restated in every state that has something
          to reassure a decision about. `not-requested` has none — no consent
          has been asked yet, so there is nothing to say still works. */}
      {copy.manualNote ? (
        <Typography
          variant="footnote"
          color={colors.textSecondary}
          testID={`${testID}-manual-note`}
        >
          {copy.manualNote}
        </Typography>
      ) : null}

      {state === 'connected' ? (
        <Typography
          variant="footnote"
          weight="medium"
          color={colors.textSecondary}
          testID={`${testID}-last-synced`}
        >
          {formatLastSynced(lastSyncedAt)}
        </Typography>
      ) : null}

      <View style={[styles.scope, { borderColor: colors.borderColor }]} testID={`${testID}-scope`}>
        <Typography
          variant="caption1"
          color={colors.textSecondary}
          style={styles.scopeLabel}
          testID={`${testID}-scope-label`}
        >
          {state === 'connected' ? 'WHAT WE READ' : 'WHAT WE WOULD READ'}
        </Typography>

        {HEALTHKIT_DESCRIPTORS.map((descriptor) => (
          <ScopeRow
            key={descriptor.type}
            descriptor={descriptor}
            testID={`${testID}-scope-${descriptor.type}`}
            tint={tint}
            subtle={colors.textSecondary}
          />
        ))}

        <Typography
          variant="caption1"
          color={colors.textSecondary}
          testID={`${testID}-read-only-note`}
        >
          Read-only. Symply Health never writes anything back to Apple Health, and asks for nothing beyond these five.
        </Typography>
      </View>

      {copy.actionLabel && onConnect ? (
        <Button
          // The label carries the progress rather than a spinner: swapping the
          // text out for a spinner would hide what is happening at exactly the
          // moment the user wants to know.
          title={busy ? 'Syncing…' : copy.actionLabel}
          variant={state === 'connected' ? 'outline' : 'primary'}
          onPress={onConnect}
          disabled={busy}
          testID={`${testID}-action`}
        />
      ) : null}

      {state === 'denied' && onOpenSettings ? (
        <Button
          title="Open Settings"
          variant="ghost"
          onPress={onOpenSettings}
          testID={`${testID}-settings`}
        />
      ) : null}
    </Card>
  );
}

interface CompactHealthKitBannerProps {
  state: HealthKitConnectionState;
  copy: StateCopy;
  colors: AppColors;
  tint: string;
  lastSyncedAt: string | null;
  onConnect?: () => void;
  onOpenSettings?: () => void;
  onDismiss?: () => void;
  busy: boolean;
  testID: string;
}

/**
 * The Home/Weight/More rendering of the card: one actionable row instead of
 * a full page of scope rows. The five-data-type explanation and read-only
 * promise aren't dropped — they move behind the (i) button's bottom sheet,
 * a tap away rather than unavoidable real estate on every visit.
 */
function CompactHealthKitBanner({
  state,
  copy,
  colors,
  tint,
  lastSyncedAt,
  onConnect,
  onOpenSettings,
  onDismiss,
  busy,
  testID,
}: CompactHealthKitBannerProps) {
  const [sheetVisible, setSheetVisible] = useState(false);

  const action =
    state === 'denied'
      ? onOpenSettings
        ? { label: 'Open Settings', onPress: onOpenSettings }
        : null
      : copy.actionLabel && onConnect
        ? { label: busy ? 'Syncing…' : copy.actionLabel, onPress: onConnect }
        : null;

  return (
    <Card
      variant="filled"
      style={[styles.bannerCard, { backgroundColor: hexToRgba(colors.primary, 0.1) }]}
      testID={testID}
    >
      <View style={styles.header}>
        <Icon name={copy.icon} size={20} color={tint} />
        <Typography
          variant="subheadline"
          weight="semibold"
          style={styles.headerTitle}
          numberOfLines={1}
          testID={`${testID}-title`}
        >
          {copy.title}
        </Typography>
        <Pressable
          onPress={() => setSheetVisible(true)}
          accessibilityRole="button"
          accessibilityLabel={`About ${copy.title}`}
          hitSlop={8}
          testID={`${testID}-info`}
        >
          <Icon name="information-circle" size={18} color={colors.error} />
        </Pressable>
        {onDismiss ? (
          <Pressable
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            testID={`${testID}-dismiss`}
          >
            <Icon name="close" size={18} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>

      {state === 'connected' ? (
        <Typography
          variant="caption1"
          weight="medium"
          color={colors.textSecondary}
          testID={`${testID}-last-synced`}
        >
          {formatLastSynced(lastSyncedAt)}
        </Typography>
      ) : null}

      {action ? (
        <Button
          title={action.label}
          variant={state === 'connected' ? 'outline' : 'primary'}
          size="sm"
          onPress={action.onPress}
          disabled={busy}
          style={styles.bannerAction}
          testID={`${testID}-action`}
        />
      ) : null}

      <BottomSheet
        visible={sheetVisible}
        onClose={() => setSheetVisible(false)}
        height="content"
        title={copy.title}
        showCloseButton
      >
        <View style={styles.sheetContent} testID={`${testID}-sheet-content`}>
          {copy.body ? (
            <Typography variant="body" color={colors.textSecondary} testID={`${testID}-body`}>
              {copy.body}
            </Typography>
          ) : null}

          {copy.manualNote ? (
            <Typography
              variant="footnote"
              color={colors.textSecondary}
              testID={`${testID}-manual-note`}
            >
              {copy.manualNote}
            </Typography>
          ) : null}

          <View style={[styles.scope, { borderColor: colors.borderColor }]} testID={`${testID}-scope`}>
            <Typography
              variant="caption1"
              color={colors.textSecondary}
              style={styles.scopeLabel}
              testID={`${testID}-scope-label`}
            >
              {state === 'connected' ? 'WHAT WE READ' : 'WHAT WE WOULD READ'}
            </Typography>

            {HEALTHKIT_DESCRIPTORS.map((descriptor) => (
              <ScopeRow
                key={descriptor.type}
                descriptor={descriptor}
                testID={`${testID}-scope-${descriptor.type}`}
                tint={tint}
                subtle={colors.textSecondary}
              />
            ))}

            <Typography
              variant="caption1"
              color={colors.textSecondary}
              testID={`${testID}-read-only-note`}
            >
              Read-only. Symply Health never writes anything back to Apple Health, and asks for nothing beyond these five.
            </Typography>
          </View>
        </View>
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
  sheetContent: {
    gap: Spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  headerTitle: {
    flex: 1,
  },
  scope: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: CornerRadius.sm,
    padding: Spacing.sm,
    gap: Spacing.xs,
  },
  scopeLabel: {
    letterSpacing: 0.6,
  },
  scopeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  scopeText: {
    flex: 1,
    gap: Spacing.xxs,
  },
});
