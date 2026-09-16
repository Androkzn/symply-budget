import React, { useCallback, useEffect, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { brandId } from '@brand';
import { PermissionCard } from '@components/common';
import { Card, Toggle, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { getNotificationBenefit } from '@config/brandContent';
import { useDismissiblePermissionBanner } from '@hooks/useDismissiblePermissionBanner';
import { useNotificationPermission } from '@hooks/useNotificationPermission';
import { Spacing, useAppColors } from '@theme';

import { HealthSettingsShell } from '../components/HealthSettingsShell';
import {
  DEFAULT_HEALTH_NOTIFICATION_PREFERENCES,
  HEALTH_NOTIFICATION_GROUPS,
  loadNotificationPreferences,
  resetNotificationPreferences,
  saveNotificationPreferences,
  type HealthNotificationPreferences,
  type HealthNotificationToggle,
} from '../healthSettingsStorage';

/**
 * Notification settings — the donor's `ActivityNotificationPreferencesView`.
 *
 * Ten booleans have been deployed on `PUT /health/activity-preferences` since
 * parity P2 with no caller at all; this is the screen that owns them.
 *
 * ## Three decisions worth knowing about
 *
 * 1. **Each switch saves on its own.** The donor saves the whole object after
 *    every toggle; here only the changed flag is sent, because the route merges
 *    server-side and a whole-object PUT from an older build would overwrite a
 *    flag a newer one added. There is no Save button and nothing to lose by
 *    leaving.
 * 2. **A failed save is not an error box.** The member's choice is kept, cached,
 *    and a plain sentence says it will sync later. No status code and no system
 *    string ever reaches this screen.
 * 3. **The screen says what these switches do NOT do yet.** Nothing on the
 *    Worker reads these flags to gate a send, because the donor features that
 *    produce those events (family sharing, the buddy community) are not part of
 *    this port. Each group carries that disclosure — see the header of
 *    `healthSettingsStorage.ts`. Recording a preference for a feature that has
 *    not shipped is fine; implying it silences something today is not.
 *
 * The OS-level permission is shown as its own state via the shared
 * `PermissionCard` (`useNotificationPermission`) — a member who has never been
 * asked gets the native "Allow" sheet; one who already said no gets Open
 * Settings instead, since iOS will not show its own prompt a second time.
 * Either way they need to know before they wonder why nothing arrives.
 */
export function HealthNotificationSettingsScreen() {
  const colors = useAppColors();

  const [prefs, setPrefs] = useState<HealthNotificationPreferences>(
    DEFAULT_HEALTH_NOTIFICATION_PREFERENCES
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const {
    state: pushState,
    busy: pushBusy,
    request: requestPush,
  } = useNotificationPermission();
  const notificationBanner = useDismissiblePermissionBanner(
    pushState !== 'granted' && pushState !== 'unavailable'
  );

  useEffect(() => {
    let cancelled = false;
    void loadNotificationPreferences().then((loaded) => {
      if (cancelled) return;
      setPrefs(loaded);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = useCallback(async (flag: keyof HealthNotificationPreferences, next: boolean) => {
    // Optimistic: the switch must move under the finger, not after a round trip.
    setPrefs((current) => ({ ...current, [flag]: next }));
    setBusy(true);
    const result = await saveNotificationPreferences({ [flag]: next });
    setPrefs(result.preferences);
    setMessage(result.message);
    setBusy(false);
  }, []);

  const reset = useCallback(async () => {
    setBusy(true);
    const result = await resetNotificationPreferences();
    setPrefs(result.preferences);
    setMessage(result.message ?? 'Reset to the standard settings.');
    setBusy(false);
  }, []);

  return (
    <HealthSettingsShell title="Notifications" testID="health-notifications-screen" loading={loading}>
      {notificationBanner.visible ? (
        <PermissionCard
          state={pushState}
          icon="notifications"
          title="Notifications"
          copy={{
            'not-requested': { body: getNotificationBenefit(brandId) },
            denied: {
              body: 'Your choices below are saved either way, but nothing can reach this device until you allow notifications in the system settings.',
            },
          }}
          onRequest={() => void requestPush()}
          onOpenSettings={() => void Linking.openSettings()}
          onDismiss={notificationBanner.dismiss}
          busy={pushBusy}
          layout="compact"
          testID="health-notifications-permission-card"
        />
      ) : null}

      {HEALTH_NOTIFICATION_GROUPS.map((group) => (
        <Card
          key={group.id}
          variant="filled"
          style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
          testID={`health-notifications-group-${group.id}`}
        >
          <Typography variant="footnote" weight="semibold" color={colors.textSecondary} style={styles.sectionLabel}>
            {group.title.toUpperCase()}
          </Typography>
          {group.disclosure !== null && (
            <Typography
              variant="footnote"
              color={colors.textSecondary}
              testID={`health-notifications-disclosure-${group.id}`}
            >
              {group.disclosure}
            </Typography>
          )}
          {group.toggles.map((item: HealthNotificationToggle) => (
            <View key={item.flag} style={styles.toggleRow}>
              <View style={[styles.iconTile, { backgroundColor: colors.primary + '1F' }]}>
                <Icon name={item.icon} size={18} color={colors.textPrimary} />
              </View>
              <View style={styles.toggleText}>
                <Typography variant="body" weight="medium" color={colors.textPrimary}>
                  {item.title}
                </Typography>
                <Typography variant="footnote" color={colors.textSecondary}>
                  {item.description}
                </Typography>
              </View>
              <Toggle
                value={prefs[item.flag]}
                onValueChange={(next) => void toggle(item.flag, next)}
                disabled={busy}
                testID={`health-notify-${item.flag}`}
              />
            </View>
          ))}
        </Card>
      ))}

      {message !== null && (
        <Typography
          variant="footnote"
          color={colors.textSecondary}
          testID="health-notifications-message"
        >
          {message}
        </Typography>
      )}

      <Card
        variant="filled"
        pressable
        onPress={() => void reset()}
        style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
        testID="health-notifications-reset"
      >
        <Typography variant="body" weight="medium" color={colors.primary}>
          Reset to standard settings
        </Typography>
        <Typography variant="footnote" color={colors.textSecondary}>
          Puts all ten switches back the way Symply Health ships them.
        </Typography>
      </Card>
    </HealthSettingsShell>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.base,
    gap: Spacing.sm,
  },
  sectionLabel: {
    letterSpacing: 0.6,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  iconTile: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleText: {
    flex: 1,
  },
});
