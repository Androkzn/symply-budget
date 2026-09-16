import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as FileSystem from 'expo-file-system/legacy';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Image, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

import { authApi } from '@api/auth';
import { isHouseBrand } from '@brand';
import {
  AppBackground,
  AttachmentSourceSheet,
  HeaderActionButton,
  SafeAreaView,
  ScreenHeader,
  ScreenScrollEnd,
  screenScrollEndTestId,
} from '@components/common';
import { SubscriptionSection } from '@components/subscription/SubscriptionSection';
import { Card, Icon, Typography, Button, TextInput } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { useData } from '@contexts/DataContext';
import { useI18n } from '@contexts/I18nContext';
import { useProfile } from '@contexts/ProfileContext';
import { isFullBudget } from '@features/budget';

import { useProfileComposition } from './profile/useProfileComposition';
import { showToast } from '@services/toastManager';
import { useAuthStore } from '@stores/authStore';
import { CornerRadius, Header, Spacing, useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';


type ProfileScreenProps = NativeStackScreenProps<{ Profile: undefined }, 'Profile'>;

export function ProfileScreen({ navigation }: ProfileScreenProps) {  const colors = useAppColors();
  const router = useRouter();
  const { user, isLoading: _isLoading, updateProfile } = useProfile();
  const { lastSyncAt } = useData();
  const { t } = useI18n();
  const logout = useAuthStore((state) => state.logout);
  // Face ID / Touch ID quick sign-in. Shared with the More tab, which still
  // draws the same row for every brand that kept an ACCOUNT section there.
  const composition = useProfileComposition();

  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [isDeleting, setIsDeleting] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Check if name has changed from original
  const originalName = user?.display_name || '';
  const hasNameChanged = displayName.trim() !== originalName.trim();

  const handleSave = async () => {
    if (!hasNameChanged) return;

    setIsSaving(true);
    try {
      await updateProfile({ display_name: displayName.trim() });
      showToast('success', 'Profile updated');
    } catch {
      Alert.alert(t('common.error'), 'Failed to update profile');
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * The avatar chooser.
   *
   * Was a two-option `Alert` — Take Photo and Choose from Library — with the
   * camera hidden on the simulator. That meant a member whose portrait lived in
   * Files or in the household's Drive could not use it, and the simulator
   * special-case was papering over the fact that a camera failure is already
   * answered honestly by the shared picker. It is now the same four-source
   * sheet every other upload surface shows, with Remove kept beneath it because
   * "change my photo" and "get rid of my photo" start from the same tap.
   */
  const [avatarSheetOpen, setAvatarSheetOpen] = useState(false);

  const processAndUploadImage = async (uri: string, mime: string) => {
    setIsUploadingAvatar(true);
    try {
      // Image is already cropped and resized by the picker. `fetch(uri).blob()` +
      // FileReader.readAsDataURL is unreliable for local file:// URIs under the
      // New Architecture — expo-file-system's base64 reader is the pattern used
      // everywhere else in the app for this exact conversion.
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });

      // Upload avatar
      await updateProfile({ avatar_url: `data:${mime};base64,${base64}` });
    } catch (error) {
      console.error('Error uploading avatar:', error);
      Alert.alert(t('common.error'), 'Failed to upload avatar');
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handleRemoveAvatar = async () => {
    setIsUploadingAvatar(true);
    try {
      await updateProfile({ avatar_url: null });
    } catch {
      Alert.alert(t('common.error'), 'Failed to remove avatar');
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handleSignOut = () => {
    Alert.alert(
      t('profile.signOut'),
      'Are you sure you want to sign out?',
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('profile.signOut'),
          style: 'destructive',
          onPress: () => logout(),
        },
      ]
    );
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  /** "Today"/"Yesterday" while the calendar day still reads naturally, absolute after that. */
  const formatDateTime = (date: Date, now: Date = new Date()) => {
    const time = date.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    });

    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const daysAgo = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
    if (daysAgo === 0) return `Today at ${time}`;
    if (daysAgo === 1) return `Yesterday at ${time}`;

    const day = date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
    return `${day} at ${time}`;
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'Are you sure you want to delete your account? This action cannot be undone. All your data will be permanently deleted.',
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: 'Delete Account',
          style: 'destructive',
          onPress: () => confirmDeleteAccount(),
        },
      ]
    );
  };

  const confirmDeleteAccount = async () => {
    setIsDeleting(true);
    try {
      await authApi.deleteAccount();
      Alert.alert(
        'Account Deleted',
        'Your account has been scheduled for deletion.',
        [{ text: 'OK', onPress: () => logout() }]
      );
    } catch {
      Alert.alert(t('common.error'), 'Failed to delete account. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleBack = () => {
    if (navigation?.canGoBack?.()) {
      navigation.goBack();
    } else {
      router.back();
    }
  };

  /**
   * The gear opens the app's own settings screen, which differs by brand.
   *
   * Full Budget: `BudgetSettings` (sync, backup, invites, monthly budget…). It
   * lives in the Budget stack nested inside the Home tab, which is driven by a
   * `screen=` search param the tab reads with `useLocalSearchParams`.
   *
   * Re-enter through the app's own URL rather than `router.push`, for the same
   * reason `app/_layout.tsx` does it for a tapped invite link: an imperative
   * push to `/` re-focuses a tab that is ALREADY MOUNTED without delivering the
   * new params, so the Budget stack never sees `screen` and you land on the Home
   * dashboard. Handing the same URL to Linking is the door that does work, and
   * the one the E2E suites use.
   *
   * `navNonce` is required on top of that: the stack's NavigationHandler dedupes
   * on `screen:itemId:navNonce`, so without a fresh nonce every visit after the
   * first is swallowed by its dedupe ref.
   *
   * House: `/house-settings`, the root route that mounts the Settings stack on
   * its own hub screen. Pushed above the tabs for the same reason the gear on
   * every House tab header pushes it — the hub is not the More tab any more, and
   * "open settings" should not move the member to another tab.
   *
   * Every other brand keeps the shared settings hub on `/settings`.
   */
  const handleSettingsPress = () => {
    if (isHouseBrand()) {
      router.push('/house-settings');
      return;
    }
    if (!isFullBudget()) {
      router.push('/settings');
      return;
    }
    const url = Linking.createURL('/', {
      queryParams: { screen: 'BudgetSettings', navNonce: String(Date.now()) },
    });
    Linking.openURL(url).catch((error) => {
      console.warn('[profile] could not open Budget Settings', error);
    });
  };

  return (
    <AppBackground opacity={0.5}>
      <ScreenHeader
        title="Profile"
        showBackButton
        onBackPress={handleBack}
        showNotificationBell={false}
        showAvatar={false}
        rightElement={
          <HeaderActionButton
            iconOnly
            onPress={handleSettingsPress}
            testID="profile-settings-button"
            accessibilityLabel="Settings"
          >
            <Icon name="cog-outline" size={Header.actionIconSize} color={colors.primary} />
          </HeaderActionButton>
        }
      />
      <SafeAreaView edges={[]}>
        <ScrollView
          {...keyboardDismissScrollProps}
          style={styles.container}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          testID="profile-screen"
        >
          {/* Avatar Section */}
          <View style={styles.avatarSection}>
            <TouchableOpacity
              style={[
                styles.avatarContainer,
                { backgroundColor: colors.primary, borderColor: colors.cardBackground },
              ]}
              onPress={() => setAvatarSheetOpen(true)}
              disabled={isUploadingAvatar}
              accessibilityRole="button"
              accessibilityLabel="Change profile photo"
              testID="profile-avatar-edit"
            >
              {isUploadingAvatar ? (
                <ActivityIndicator size="large" color={colors.white} />
              ) : user?.avatar_url ? (
                <Image source={{ uri: user.avatar_url }} style={styles.avatar} />
              ) : (
                <Typography variant="title1" weight="bold" color={colors.white}>
                  {user?.display_name?.charAt(0).toUpperCase() ||
                    user?.email?.charAt(0).toUpperCase() ||
                    '?'}
                </Typography>
              )}
              {!isUploadingAvatar && (
                <View style={styles.cameraOverlay}>
                  <Typography variant="caption2" weight="semibold" color={colors.white}>
                    Edit
                  </Typography>
                </View>
              )}
            </TouchableOpacity>
          </View>

          {/* Profile Info */}
          <Card variant="filled" style={styles.card}>
            <View style={styles.field}>
              <Typography variant="footnote" color={colors.textSecondary} style={styles.label}>
                {t('profile.displayName')}
              </Typography>
              <TextInput
                containerStyle={styles.inputContainer}
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="Enter your name"
                returnKeyType="done"
                testID="profile-display-name-input"
              />
            </View>

            <View style={[styles.divider, { backgroundColor: colors.borderColor }]} />

            <View style={styles.field}>
              <Typography variant="footnote" color={colors.textSecondary} style={styles.label}>
                {t('profile.email')}
              </Typography>
              <View style={styles.emailRow}>
                <Typography variant="body" style={styles.emailText}>
                  {user?.email}
                </Typography>
                {user?.email_verified && (
                  <View style={[styles.verifiedBadge, { backgroundColor: colors.primary + '20' }]}>
                    <Typography variant="caption2" color={colors.primary} weight="semibold">
                      Verified
                    </Typography>
                  </View>
                )}
              </View>
            </View>

            <View style={[styles.divider, { backgroundColor: colors.borderColor }]} />

            <View style={styles.field}>
              <Typography variant="footnote" color={colors.textSecondary} style={styles.label}>
                {t('profile.memberSince')}
              </Typography>
              <Typography variant="body">
                {user?.created_at ? formatDate(user.created_at) : 'Unknown'}
              </Typography>
            </View>
          </Card>

          {/* Subscription Info — shared across every app in the ecosystem. */}
          <SubscriptionSection />

          {/* Brand slots — see `./profile/compositions.tsx`. What appears here
              is declared by THIS APP's composition, not by conditionals in the
              shared shell: that is what lets two apps change their profile in
              the same window without landing on the same lines. */}
          {composition.syncSections}
          {composition.extras}

          {/* Sync Info */}
          {lastSyncAt && (
            <Typography variant="footnote" color={colors.textSecondary} style={styles.syncInfo}>
              Last synced: {formatDateTime(lastSyncAt)}
            </Typography>
          )}

          {/* Actions */}
          <View style={styles.actions}>
            {hasNameChanged && (
              <Button
                title={t('common.save')}
                variant="primary"
                size="md"
                onPress={handleSave}
                loading={isSaving}
                fullWidth
                testID="profile-save"
              />
            )}

            <Button
              title={t('profile.signOut')}
              variant="secondary"
              size="md"
              onPress={handleSignOut}
              fullWidth
              testID="profile-sign-out"
            />
          </View>

          {/* Danger Zone */}
          <View style={[styles.dangerZone, { borderTopColor: colors.error + '33' }]}>
            <Typography
              variant="caption1"
              weight="semibold"
              color={colors.error}
              style={styles.dangerZoneLabel}
            >
              DANGER ZONE
            </Typography>
            <Button
              title="Delete Account"
              variant="destructive"
              size="md"
              onPress={handleDeleteAccount}
              loading={isDeleting}
              fullWidth
              testID="profile-delete-account"
            />
          </View>

          {composition.about}

          <ScreenScrollEnd testID={screenScrollEndTestId('profile-screen')} />
        </ScrollView>
      </SafeAreaView>

      <AttachmentSourceSheet
        visible={avatarSheetOpen}
        onClose={() => setAvatarSheetOpen(false)}
        title="Profile photo"
        testIDPrefix="profile-avatar"
        rememberScope="profile-avatar"
        pickerOptions={{
          cropping: true,
          cropperToolbarTitle: 'Crop Profile Photo',
          compressImageQuality: 0.8,
          mediaType: 'photo',
          freeStyleCropEnabled: false,
        }}
        onPicked={([picked]) => {
          if (!picked) return;
          void processAndUploadImage(picked.uri, picked.mime ?? 'image/jpeg');
        }}
        {...(user?.avatar_url
          ? {
              extraAction: {
                label: 'Remove photo',
                destructive: true,
                onPress: () => void handleRemoveAvatar(),
                testID: 'profile-avatar-remove',
              },
            }
          : {})}
      />
    </AppBackground>
  );
}

const AVATAR_SIZE = 100;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  content: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.base,
    paddingBottom: 100,
    backgroundColor: 'transparent',
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: Spacing.xl,
  },
  avatarContainer: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
  },
  cameraOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    paddingVertical: Spacing.xs + 2,
    alignItems: 'center',
  },
  // Radius/padding come from Card's own tokens so every card on the screen matches.
  card: {
    marginBottom: Spacing.base,
  },
  field: {
    paddingVertical: Spacing.sm,
  },
  label: {
    marginBottom: Spacing.xs,
  },
  /** The shared TextInput ships a bottom margin for form stacks; this is a single row. */
  inputContainer: {
    marginBottom: 0,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: Spacing.xs,
  },
  emailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  emailText: {
    flexShrink: 1,
  },
  verifiedBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
    borderRadius: CornerRadius.full,
  },
  syncSharing: {
    marginBottom: Spacing.base,
  },
  biometricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  biometricText: {
    flex: 1,
  },
  about: {
    marginTop: Spacing.xxl,
  },
  aboutLabel: {
    marginBottom: Spacing.sm,
    letterSpacing: 0.5,
  },
  aboutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.smd,
  },
  syncInfo: {
    textAlign: 'center',
    marginBottom: Spacing.xl,
  },
  actions: {
    marginTop: Spacing.sm,
    gap: Spacing.md,
  },
  dangerZone: {
    marginTop: Spacing.xxl,
    paddingTop: Spacing.base,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  dangerZoneLabel: {
    marginBottom: Spacing.md,
    letterSpacing: 0.5,
  },
});
