import * as Haptics from 'expo-haptics';
import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, TextInput, Alert, TouchableOpacity, ScrollView } from 'react-native';

import { householdsApi, type UserSearchResult } from '@api/households';
import { BottomSheet, Typography, Button, Avatar } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, LegacyTextVariant, Spacing, useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';

interface InviteBottomSheetProps {
  visible: boolean;
  onClose: () => void;
  onInvite: (email: string, role: 'owner' | 'member') => Promise<void>;
  isLoading?: boolean;
  householdId?: string;
}

function primaryFill20(primary: string) {
  if (primary.startsWith('#') && primary.length === 7) return `${primary}20`;
  return primary;
}

function createStyles(themeColors: { text: string }) {
  return StyleSheet.create({
    section: {
      marginBottom: Spacing.xl,
    },
    label: {
      marginBottom: Spacing.sm,
    },
    input: {
      fontSize: LegacyTextVariant.headline.size,
      lineHeight: LegacyTextVariant.headline.lineHeight,
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.base,
      borderWidth: 1,
      borderRadius: CornerRadius.sm,
      color: themeColors.text,
    },
    roleOptions: {
      gap: Spacing.md,
    },
    roleOption: {
      padding: Spacing.base,
      borderRadius: CornerRadius.md,
      borderWidth: Spacing.xxs,
    },
    roleHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: Spacing.sm,
    },
    roleDescription: {
      lineHeight: LegacyTextVariant.footnote.lineHeight,
    },
    info: {
      padding: Spacing.base,
      borderRadius: CornerRadius.sm,
      marginBottom: Spacing.xl,
    },
    actions: {
      flexDirection: 'row',
      gap: Spacing.md,
      marginBottom: Spacing.xxl,
    },
    actionButton: {
      flex: 1,
    },
    searchStatus: {
      marginTop: Spacing.md,
    },
    resultRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      paddingVertical: Spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    resultInfo: {
      flex: 1,
    },
  });
}

export function InviteBottomSheet({
  visible,
  onClose,
  onInvite,
  isLoading = false,
  householdId,
}: InviteBottomSheetProps) {  const colors = useAppColors();
  const styles = useMemo(() => createStyles({ text: colors.textPrimary }), [colors.textPrimary]);
  const [email, setEmail] = useState('');
  const [selectedRole, setSelectedRole] = useState<'owner' | 'member'>('member');

  // In-app user search: find existing app users by name/email and tap to
  // pre-fill the invite. Falls back to manual email entry below.
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!householdId || q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let cancelled = false;
    const handle = setTimeout(() => {
      householdsApi
        .searchUsers(householdId, q)
        .then(({ users }) => {
          if (!cancelled) setResults(users);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query, householdId]);

  const handleSelectUser = async (user: UserSearchResult) => {
    await Haptics.selectionAsync();
    setEmail(user.email);
    setQuery('');
    setResults([]);
  };

  const validateEmail = (value: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(value);
  };

  const handleInvite = async () => {
    if (!email.trim()) {
      Alert.alert('Error', 'Please enter an email address');
      return;
    }

    if (!validateEmail(email.trim())) {
      Alert.alert('Error', 'Please enter a valid email address');
      return;
    }

    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await onInvite(email.trim().toLowerCase(), selectedRole);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setEmail('');
      setSelectedRole('member');
      onClose();
    } catch (error) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

      const errorMessage = error instanceof Error ? error.message : 'Failed to send invitation';
      let title = 'Error';
      let message = errorMessage;

      if (errorMessage.includes('already been sent')) {
        title = 'Already Invited';
        message =
          'An invitation has already been sent to this email address. You can resend it from the pending invitations list.';
      } else if (errorMessage.includes('already a member')) {
        title = 'Already a Member';
        message = 'This person is already a member of this property.';
      }

      Alert.alert(title, message);
    }
  };

  const handleRoleSelect = async (role: 'owner' | 'member') => {
    await Haptics.selectionAsync();
    setSelectedRole(role);
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      height="tall"
      title="Invite Member"
      showHandle
      showCloseButton
    >
      <ScrollView showsVerticalScrollIndicator={false} {...keyboardDismissScrollProps}>
        {householdId ? (
          <View style={styles.section}>
            <Typography
              variant="footnote"
              color={colors.textSecondary}
              style={styles.label}
            >
              Find a member
            </Typography>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: colors.backgroundSecondary,
                  borderColor: colors.borderColor,
                },
              ]}
              placeholder="Search by name or email"
              placeholderTextColor={colors.textTertiary}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isLoading}
            />

            {searching && (
              <View style={styles.searchStatus}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            )}

            {!searching && query.trim().length >= 2 && results.length === 0 && (
              <Typography
                variant="caption1"
                color={colors.textTertiary}
                style={styles.searchStatus}
              >
                No app users found. Invite by email below.
              </Typography>
            )}

            {results.map((user) => (
              <TouchableOpacity
                key={user.id}
                style={[styles.resultRow, { borderColor: colors.borderColor }]}
                onPress={() => handleSelectUser(user)}
                disabled={isLoading}
              >
                <Avatar
                  user={{
                    display_name: user.display_name,
                    avatar_url: user.avatar_url,
                    email: user.email,
                  }}
                  size="sm"
                />
                <View style={styles.resultInfo}>
                  <Typography variant="body" weight="semibold">
                    {user.display_name || user.email}
                  </Typography>
                  {user.display_name ? (
                    <Typography variant="caption2" color={colors.textTertiary}>
                      {user.email}
                    </Typography>
                  ) : null}
                </View>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        <View style={styles.section}>
          <Typography
            variant="footnote"
            color={colors.textSecondary}
            style={styles.label}
          >
            Email Address
          </Typography>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.backgroundSecondary,
                borderColor: colors.borderColor,
              },
            ]}
            placeholder="member@example.com"
            placeholderTextColor={colors.textTertiary}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isLoading}
          />
        </View>

        <View style={styles.section}>
          <Typography
            variant="footnote"
            color={colors.textSecondary}
            style={styles.label}
          >
            Role
          </Typography>

          <View style={styles.roleOptions}>
            <TouchableOpacity
              style={[
                styles.roleOption,
                {
                  backgroundColor:
                    selectedRole === 'member' ? primaryFill20(colors.primary) : colors.backgroundSecondary,
                  borderColor: selectedRole === 'member' ? colors.primary : colors.borderColor,
                },
              ]}
              onPress={() => handleRoleSelect('member')}
              disabled={isLoading}
            >
              <View style={styles.roleHeader}>
                <Typography variant="body" weight="semibold">
                  Member
                </Typography>
                {selectedRole === 'member' && (
                  <Icon name="checkmark" size={20} color={colors.primary} />
                )}
              </View>
              <Typography
                variant="caption1"
                color={colors.textSecondary}
                style={styles.roleDescription}
              >
                Can view all data, manage tasks, add reports, but cannot remove members or delete the
                household
              </Typography>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.roleOption,
                {
                  backgroundColor:
                    selectedRole === 'owner' ? primaryFill20(colors.primary) : colors.backgroundSecondary,
                  borderColor: selectedRole === 'owner' ? colors.primary : colors.borderColor,
                },
              ]}
              onPress={() => handleRoleSelect('owner')}
              disabled={isLoading}
            >
              <View style={styles.roleHeader}>
                <Typography variant="body" weight="semibold">
                  Owner
                </Typography>
                {selectedRole === 'owner' && (
                  <Icon name="checkmark" size={20} color={colors.primary} />
                )}
              </View>
              <Typography
                variant="caption1"
                color={colors.textSecondary}
                style={styles.roleDescription}
              >
                Full access including member management, household deletion, and all member permissions
              </Typography>
            </TouchableOpacity>
          </View>
        </View>

        <View style={[styles.info, { backgroundColor: colors.groupedListBackground }]}>
          <Typography variant="caption1" color={colors.textSecondary}>
            The invitation will be sent via email and will expire in 7 days. They can accept the
            invitation by clicking the link in the email.
          </Typography>
        </View>

        <View style={styles.actions}>
          <View style={styles.actionButton}>
            <Button
              title="Cancel"
              variant="secondary"
              size="lg"
              onPress={onClose}
              disabled={isLoading}
              fullWidth
            />
          </View>
          <View style={styles.actionButton}>
            <Button
              title="Send Invitation"
              variant="primary"
              size="lg"
              onPress={handleInvite}
              loading={isLoading}
              fullWidth
            />
          </View>
        </View>
      </ScrollView>
    </BottomSheet>
  );
}
