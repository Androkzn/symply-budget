import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { useNavigation, useRoute, type RouteProp } from 'expo-router/react-navigation';
import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { AppBackground, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { Avatar, Button, Card, TextInput, Toggle, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { useHouseholdStore } from '@stores/householdStore';
import { CornerRadius, Layout, Spacing, useAppColors } from '@theme';
import { getApiErrorMessage } from '@utils/apiError';
import { keyboardDismissScrollProps } from '@utils/keyboard';

import { useChatConfig } from '../ChatConfigContext';
import type { ChatStackParamList } from '../types';

type SettingsRoute = { ChatRoomSettings: { roomId: string; roomName: string; canManage: boolean } };

export function ChatRoomSettingsScreen() {
  const config = useChatConfig();
  const api = config.api;
  const useChatStore = config.store;
  const colors = useAppColors();
  const navigation = useNavigation<NativeStackNavigationProp<ChatStackParamList>>();
  const route = useRoute<RouteProp<SettingsRoute, 'ChatRoomSettings'>>();
  const { roomId, roomName, canManage } = route.params;

  const householdId = useHouseholdStore((s) => s.currentHousehold?.id);
  const removeRoom = useChatStore((s) => s.removeRoom);
  const renameRoomInStore = useChatStore((s) => s.renameRoom);
  const clearMessagesInStore = useChatStore((s) => s.clearMessages);
  const storeRoom = useChatStore((s) => s.rooms.find((r) => r.id === roomId));
  const isDefault = storeRoom?.is_default ?? false;
  // The dedicated 1:1 AI assistant room: participants are locked to you + the
  // assistant, and it can't be deleted (it's always pinned on top).
  const isAssistant = storeRoom?.is_assistant ?? false;
  // Rooms whose audience is fixed (General = everyone, Assistant = you + AI).
  const participantsLocked = isDefault || isAssistant;
  const canDelete = !isDefault && !isAssistant;

  const [name, setName] = useState(storeRoom?.name ?? roomName);
  const [everyone, setEveryone] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [clearing, setClearing] = useState(false);

  const trimmedName = name.trim();
  const nameDirty = trimmedName.length > 0 && trimmedName !== (storeRoom?.name ?? roomName);

  const { data, isLoading } = useQuery({
    queryKey: ['chat', 'participants', householdId, roomId],
    enabled: !!householdId,
    queryFn: async () => {
      const result = await api.getParticipants(householdId!, roomId);
      setEveryone(!result.restricted);
      setSelected(
        new Set(result.restricted ? result.participant_ids : result.members.map((m) => m.user_id))
      );
      return result;
    },
  });

  const members = data?.members ?? [];

  const toggleMember = (userId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const dirty = useMemo(() => {
    if (!data) return false;
    const wasRestricted = data.restricted;
    if (everyone) return wasRestricted; // switching to open only matters if it was restricted
    // Restricted: compare the selected set to the previous participant set.
    const prev = new Set(
      data.restricted ? data.participant_ids : data.members.map((m) => m.user_id)
    );
    if (prev.size !== selected.size) return true;
    for (const id of selected) if (!prev.has(id)) return true;
    return true; // switching from open → restricted is always a change
  }, [data, everyone, selected]);

  const handleSave = async () => {
    if (!householdId || saving) return;
    setSaving(true);
    try {
      await api.setParticipants(householdId, roomId, everyone ? [] : [...selected]);
      navigation.goBack();
    } catch (err) {
      Alert.alert('Could not save', getApiErrorMessage(err, 'Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  const handleRename = async () => {
    if (!householdId || renaming || !nameDirty) return;
    setRenaming(true);
    try {
      const updated = await api.renameRoom(householdId, roomId, trimmedName);
      renameRoomInStore(roomId, updated.name);
      setName(updated.name);
      navigation.goBack();
    } catch (err) {
      Alert.alert('Could not rename', getApiErrorMessage(err, 'Please try again.'));
    } finally {
      setRenaming(false);
    }
  };

  const handleClearHistory = () => {
    if (!householdId) return;
    Alert.alert(
      'Clear all messages?',
      `Every message in “${storeRoom?.name ?? roomName}” will be permanently deleted for everyone. This can’t be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear all',
          style: 'destructive',
          onPress: async () => {
            setClearing(true);
            try {
              await api.clearHistory(householdId, roomId);
              clearMessagesInStore(roomId);
              navigation.goBack();
            } catch (err) {
              Alert.alert('Could not clear', getApiErrorMessage(err, 'Please try again.'));
              setClearing(false);
            }
          },
        },
      ]
    );
  };

  const handleDelete = () => {
    if (!householdId) return;
    Alert.alert(
      'Delete room?',
      `“${roomName}” and all its messages will be permanently deleted for everyone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await api.deleteRoom(householdId, roomId);
              removeRoom(roomId);
              /*
                Pop the two screens the deleted room owns — this settings screen
                and the room itself — rather than navigating to `ChatRoomsList`
                by name.

                These screens are hosted by more than one stack now: the chat
                tab (where the list IS the root) and the Home Projects stack,
                where a project or material chat is pushed on top of the thing it
                is about and there is no `ChatRoomsList` route at all. Navigating
                to a name that stack has never heard of is a silent no-op — the
                member confirms a delete and stays on the settings screen for a
                room that no longer exists. Popping lands correctly in both: the
                rooms list in one, the project in the other.
              */
              navigation.pop(2);
            } catch (err) {
              Alert.alert('Could not delete', getApiErrorMessage(err, 'Please try again.'));
              setDeleting(false);
            }
          },
        },
      ]
    );
  };

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container} testID="chat-room-settings-screen">
        <ScreenHeader
          title="Room settings"
          showBackButton
          onBackPress={() => navigation.goBack()}
          showNotificationBell={false}
          showAvatar={false}
          showPropertySwitcher={false}
        />

        {isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <ScrollView
            {...keyboardDismissScrollProps}
            style={screenScrollViewStyle.scroll}
            contentContainerStyle={[styles.content, { paddingBottom: Layout.bottomTabBarClearance }]}
          >
            {canManage && (
              <>
                <Typography
                  variant="footnote"
                  weight="semibold"
                  color={colors.textSecondary}
                  style={styles.sectionLabel}
                >
                  ROOM NAME
                </Typography>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Room name"
                  maxLength={80}
                  autoCorrect={false}
                  testID="chat-room-name-input"
                />
                <Button
                  title={renaming ? 'Saving…' : 'Save name'}
                  variant="primary"
                  onPress={handleRename}
                  disabled={renaming || !nameDirty}
                  style={styles.saveButton}
                  testID="chat-room-settings-rename"
                />
              </>
            )}

            <Typography variant="footnote" weight="semibold" color={colors.textSecondary} style={styles.sectionLabel}>
              PARTICIPANTS
            </Typography>
            <Card variant="filled" style={styles.card}>
              <View style={styles.row}>
                <View style={styles.rowText}>
                  <Typography variant="body" color={colors.textPrimary}>
                    Everyone in the household
                  </Typography>
                  <Typography variant="caption1" color={colors.textSecondary}>
                    {isAssistant
                      ? 'This is your private chat with the AI assistant — no one else can join.'
                      : isDefault
                        ? 'The General room is always open to everyone.'
                        : 'Turn off to limit who can see this room.'}
                  </Typography>
                </View>
                <Toggle
                  value={everyone}
                  onValueChange={setEveryone}
                  disabled={!canManage || participantsLocked}
                  testID="chat-room-settings-everyone-toggle"
                />
              </View>

              {!everyone &&
                members.map((m) => (
                  <View key={m.user_id} style={[styles.row, styles.memberRow, { borderTopColor: colors.divider }]}>
                    <Avatar user={m} size="sm" />
                    <View style={styles.rowText}>
                      <Typography variant="body" color={colors.textPrimary}>
                        {m.display_name || m.email}
                      </Typography>
                      {m.role === 'owner' && (
                        <Typography variant="caption2" color={colors.textSecondary}>
                          Owner
                        </Typography>
                      )}
                    </View>
                    <Toggle
                      value={selected.has(m.user_id)}
                      onValueChange={() => toggleMember(m.user_id)}
                      disabled={!canManage}
                      testID={`chat-room-settings-member-${m.user_id}`}
                    />
                  </View>
                ))}
            </Card>

            {canManage && !participantsLocked && (
              <Button
                title={saving ? 'Saving…' : 'Save participants'}
                variant="primary"
                onPress={handleSave}
                disabled={saving || !dirty}
                style={styles.saveButton}
                testID="chat-room-settings-save"
              />
            )}

            {canManage && (
              <>
                <Typography
                  variant="footnote"
                  weight="semibold"
                  color={colors.textSecondary}
                  style={styles.sectionLabel}
                >
                  DANGER ZONE
                </Typography>
                <Button
                  title={clearing ? 'Clearing…' : 'Clear all messages'}
                  variant="outline"
                  textColor={colors.error}
                  onPress={handleClearHistory}
                  disabled={clearing}
                  testID="chat-room-settings-clear-history"
                />
                <Typography variant="caption1" color={colors.textSecondary} style={styles.dangerHint}>
                  Permanently deletes every message in this room for all members. The room stays.
                </Typography>
                {canDelete && (
                  <>
                    <Button
                      title={deleting ? 'Deleting…' : 'Delete room'}
                      variant="outline"
                      textColor={colors.error}
                      onPress={handleDelete}
                      disabled={deleting}
                      style={styles.dangerSpacer}
                      testID="chat-room-settings-delete"
                    />
                    <Typography variant="caption1" color={colors.textSecondary} style={styles.dangerHint}>
                      Deleting removes the room and its message history for every member.
                    </Typography>
                  </>
                )}
              </>
            )}

            {!canManage && (
              <Typography variant="caption1" color={colors.textSecondary} style={styles.dangerHint}>
                Only a household owner can rename this room, change participants, clear its history, or delete it.
              </Typography>
            )}
          </ScrollView>
        )}
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.sm,
    gap: Spacing.sm,
  },
  sectionLabel: {
    marginTop: Spacing.md,
    marginBottom: Spacing.xxs,
    marginLeft: Spacing.xs,
    letterSpacing: 0.5,
  },
  card: {
    borderRadius: CornerRadius.lg,
    paddingHorizontal: Spacing.base,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.smd,
  },
  memberRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  saveButton: {
    marginTop: Spacing.xs,
  },
  dangerSpacer: {
    marginTop: Spacing.md,
  },
  dangerHint: {
    marginTop: Spacing.xs,
    marginLeft: Spacing.xs,
  },
});

export default ChatRoomSettingsScreen;
