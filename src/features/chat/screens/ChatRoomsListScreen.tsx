import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, SectionList, StyleSheet, View } from 'react-native';

import { AppBackground, HeaderActionButton, ScreenHeader, SettingsGearButton } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import {
  BottomSheet,
  Button,
  Card,
  Chip,
  EmptyState,
  FilterTabs,
  TextInput,
  Toggle,
  Typography,
  type FilterTab,
} from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { navigateToHouseholds } from '@services/navigation';
import { useHouseholdStore } from '@stores/householdStore';
import {
  CornerRadius,
  EmptyState as EmptyStateTokens,
  Layout,
  Spacing,
  useAppColors,
} from '@theme';
import { getApiErrorMessage } from '@utils/apiError';

import { useChatConfig } from '../ChatConfigContext';
import {
  filterRoomsByTab,
  groupRoomsBySubject,
  groupUnread,
  isMaterialRoom,
  isProjectRoom,
  CHAT_FILTER_ALL,
  CHAT_FILTER_ASSISTANT,
  CHAT_FILTER_GENERAL,
  CHAT_FILTER_PROJECTS,
  HOUSEHOLD_GROUP_KEY,
  type ChatRoomFilter,
} from '../subjects';
import type { ChatRoom, ChatStackParamList } from '../types';
import { chatRoomsQueryKey, useChatRooms } from '../useChatRooms';

/** Per-tab empty copy. `canCreate` gates the "New conversation" CTA. */
const EMPTY_STATES: Record<
  ChatRoomFilter,
  { icon: string; title: string; description: string; canCreate: boolean }
> = {
  [CHAT_FILTER_ALL]: {
    icon: 'chatbubbles-outline',
    title: 'No conversations yet',
    description: 'Create a room to start chatting with your household — or ask the AI assistant.',
    canCreate: true,
  },
  [CHAT_FILTER_GENERAL]: {
    icon: 'chatbubbles-outline',
    title: 'No household chats yet',
    description: 'Create a room to start chatting with the people you live with.',
    canCreate: true,
  },
  [CHAT_FILTER_PROJECTS]: {
    icon: 'construct-outline',
    title: 'No project chats yet',
    description: 'Open a home project and start its chat — it shows up here.',
    canCreate: false,
  },
  [CHAT_FILTER_ASSISTANT]: {
    icon: 'sparkles-outline',
    title: 'Assistant not ready',
    description: 'Pull down to refresh — your AI assistant sets itself up on first open.',
    canCreate: false,
  },
};

export function ChatRoomsListScreen() {
  const config = useChatConfig();
  const api = config.api;
  const useChatStore = config.store;
  const colors = useAppColors();
  const navigation = useNavigation<NativeStackNavigationProp<ChatStackParamList>>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { content: containerPadding } = useLayoutPadding();

  const fetchHouseholds = useHouseholdStore((s) => s.fetchHouseholds);
  const setRooms = useChatStore((s) => s.setRooms);

  // "All" is the landing view: a member opening Chat sees every conversation,
  // and the other three tabs are there to narrow it, never to hide it on arrival.
  const [filter, setFilter] = useState<ChatRoomFilter>(CHAT_FILTER_ALL);
  const [createVisible, setCreateVisible] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAiEnabled, setNewAiEnabled] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const { rooms, householdId, isLoading, isRefetching, refetch } = useChatRooms(config);

  /** The rooms the active tab admits — the input to everything rendered below. */
  const visibleRooms = useMemo(() => filterRoomsByTab(rooms, filter), [rooms, filter]);

  /**
   * Rooms grouped by what they are about: the household's own conversations
   * first, then one section per project carrying its general chat and every
   * material chat under it. A flat list turned a project's worth of thinking
   * into a dozen unrelated-looking rows.
   */
  const sections = useMemo(() => groupRoomsBySubject(visibleRooms), [visibleRooms]);

  /**
   * Deliberately count-free. Four segments already share the row, and
   * "AI Assistant" is the longest label of the four — count badges would shrink
   * it past legibility on a phone for a number nobody navigates by.
   *
   * `subjectHref` is the app's "chats can belong to a project" signal: House
   * defines it, Budget does not. Gating on it keeps Budget's list from growing a
   * Projects tab that is empty by construction rather than by circumstance.
   */
  const tabs: FilterTab[] = useMemo(
    () =>
      [
        { id: CHAT_FILTER_ALL, label: 'All' },
        { id: CHAT_FILTER_GENERAL, label: 'General' },
        ...(config.subjectHref ? [{ id: CHAT_FILTER_PROJECTS, label: 'Projects' }] : []),
        { id: CHAT_FILTER_ASSISTANT, label: 'AI Assistant' },
      ] as FilterTab[],
    [config.subjectHref]
  );

  /**
   * The empty state answers the ACTIVE tab. Offering "New conversation" under
   * the Projects tab was the trap worth avoiding: it creates a household room,
   * which lands in a tab the member is not looking at and reads as a bug.
   */
  const emptyState = EMPTY_STATES[filter];
  /**
   * The first row in the FLATTENED list. `chat-rooms-first-room` is what the
   * E2E flows tap, and a per-section index would hand that testID to one row per
   * section — several elements, one id, and a flow that passes by matching the
   * wrong one.
   */
  const firstRoomId = sections[0]?.rooms[0]?.id;

  // The household store is in-memory only (no persistence), so it is null on a
  // cold start or after a JS reload. If we open the chat rooms list without a
  // selected household — e.g. deep-linked straight to /budget-chat — hydrate it
  // so the list and its "+ New" affordance render instead of dead-ending on the
  // "No household selected" empty state. fetchHouseholds auto-selects the first
  // household when none is chosen; a genuinely household-less user stays empty.
  useEffect(() => {
    if (!householdId) {
      void fetchHouseholds();
    }
  }, [householdId, fetchHouseholds]);

  useEffect(() => {
    const unsub = navigation.addListener('focus', () => {
      if (householdId) refetch();
    });
    return unsub;
  }, [navigation, householdId, refetch]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name || !householdId || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const room = await api.createRoom(householdId, { name, ai_enabled: newAiEnabled });
      setRooms([room, ...rooms]);
      setCreateVisible(false);
      // A room created from the Projects or AI Assistant tab is a HOUSEHOLD
      // room, so it would be invisible on the tab that created it — the member
      // comes back from the new room and finds the list apparently unchanged.
      setFilter(CHAT_FILTER_ALL);
      setNewName('');
      setNewAiEnabled(true);
      void queryClient.invalidateQueries({ queryKey: chatRoomsQueryKey(config, householdId) });
      navigation.navigate('ChatRoom', {
        roomId: room.id,
        roomName: room.name,
        aiEnabled: room.ai_enabled,
      });
    } catch (err) {
      console.error('[Chat] createRoom failed:', err);
      // Never surface the raw axios string ("Request failed with status code 401").
      // Map 401 to a session hint; everything else to safe copy via getApiErrorMessage.
      const status = (err as { response?: { status?: number } })?.response?.status;
      const message =
        status === 401
          ? 'Your session has expired. Please sign in again.'
          : getApiErrorMessage(err, 'Could not create the room. Please try again.');
      setCreateError(message);
      Alert.alert('Could not create room', message);
    } finally {
      setCreating(false);
    }
  };

  const closeCreateSheet = () => {
    setCreateVisible(false);
    setNewName('');
    setNewAiEnabled(true);
    setCreateError(null);
  };

  const renderRoom = ({ item }: { item: ChatRoom }) => {
    // The assistant row deliberately has NO fallback line: "AI Assistant" is the
    // whole row until it has something to preview. The old hint ("Ask me
    // anything — no @assistant needed") explained a mention syntax the room does
    // not use, on the one row that never needed explaining.
    const preview = item.last_message
      ? `${item.last_message.sender_type === 'ai' ? 'Assistant' : item.last_message.sender_name || ''}${
          item.last_message.sender_name || item.last_message.sender_type === 'ai' ? ': ' : ''
        }${item.last_message.body}`
      : item.is_assistant
        ? ''
        : isProjectRoom(item)
          ? 'Everything about this project — tag @ai for help'
          : isMaterialRoom(item)
            ? 'Decide this one material — tag @ai for help'
            : 'No messages yet';

    // Inside a project's section the header already says which project it is,
    // so its general chat reads as "General" rather than repeating the title on
    // the row directly beneath it.
    const title = isProjectRoom(item) ? 'General' : item.name;

    return (
      <Pressable
        testID={item.id === firstRoomId ? 'chat-rooms-first-room' : `chat-room-row-${item.id}`}
        onPress={() =>
          navigation.navigate('ChatRoom', {
            roomId: item.id,
            roomName: item.name,
            aiEnabled: item.ai_enabled,
          })
        }
      >
        <Card variant="outlined" style={styles.roomCard}>
          <View style={styles.roomRow}>
            <View style={styles.roomInfo}>
              <View style={styles.roomTitleRow}>
                <Typography variant="headline" weight="semibold" numberOfLines={1} style={styles.roomTitle}>
                  {title}
                </Typography>
                {item.is_assistant ? (
                  <Chip label="Assistant" variant="primary" size="sm" />
                ) : isMaterialRoom(item) ? (
                  <Chip label="Material" variant="secondary" size="sm" />
                ) : (
                  item.ai_enabled && <Chip label="AI" variant="primary" size="sm" />
                )}
              </View>
              {preview ? (
                <Typography variant="footnote" color={colors.textSecondary} numberOfLines={1}>
                  {preview}
                </Typography>
              ) : null}
            </View>
            {item.unread_count > 0 && (
              // Per-room id (matched in E2E as `chat-room-unread-.*`) so a second
              // member's device can prove an unseen message actually raised the
              // unread count on the ROOM ROW, not just landed in the thread.
              <View
                testID={`chat-room-unread-${item.id}`}
                style={[styles.unreadBadge, { backgroundColor: colors.primary }]}
              >
                <Typography variant="caption2" color={colors.white} weight="bold">
                  {item.unread_count > 99 ? '99+' : item.unread_count}
                </Typography>
              </View>
            )}
          </View>
        </Card>
      </Pressable>
    );
  };

  /**
   * A section header.
   *
   * A LONE "Household" header is suppressed — a household with no project chats
   * should see the list it has always seen, not a label explaining a distinction
   * that does not yet exist. A project header always renders, even alone: its
   * rows deliberately say "General" and the material's name, so the header is
   * the only thing naming the project. Under the Projects filter that is
   * routinely the only section on screen.
   */
  const renderSectionHeader = ({
    section,
  }: {
    section: { key: string; title: string; projectId: string | null };
  }) => {
    const isHousehold = section.key === HOUSEHOLD_GROUP_KEY;
    if (isHousehold && sections.length < 2) return null;
    const group = sections.find((s) => s.key === section.key);
    const unread = group ? groupUnread(group) : 0;
    return (
      <View style={styles.sectionHeader} testID={`chat-section-${section.key}`}>
        <Icon
          name={isHousehold ? 'home-outline' : 'construct-outline'}
          size={14}
          color={colors.textSecondary}
        />
        <Typography
          variant="footnote"
          weight="semibold"
          color={colors.textSecondary}
          numberOfLines={1}
          style={styles.sectionTitle}
        >
          {section.title}
        </Typography>
        {unread > 0 && (
          <View style={[styles.sectionDot, { backgroundColor: colors.primary }]} />
        )}
      </View>
    );
  };

  const renderBody = () => {
    if (!householdId) {
      return (
        <View style={styles.center}>
          <EmptyState
            icon="chatbubbles-outline"
            title="No household selected"
            description="Create or select a household to start chatting with your members."
            action={{
              label: 'Create household',
              onPress: () => navigateToHouseholds(),
              testID: 'chat-rooms-create-household',
            }}
          />
        </View>
      );
    }

    if (isLoading) {
      return (
        <View style={styles.center} testID="chat-rooms-loading">
          <ActivityIndicator color={colors.primary} />
        </View>
      );
    }

    return (
      <AdaptiveContainer padding={containerPadding}>
        {/* Hidden until the household HAS conversations — four filters over an
            empty list is chrome explaining nothing. */}
        {rooms.length > 0 && (
          <View style={styles.filterRow}>
            <FilterTabs
              tabs={tabs}
              activeTab={filter}
              onTabChange={(id) => setFilter(id as ChatRoomFilter)}
              showActiveIndicator={false}
              activeColor={colors.primary}
            />
          </View>
        )}
        <SectionList
          testID="chat-rooms-list"
          sections={sections.map((group) => ({
            key: group.key,
            title: group.title,
            projectId: group.projectId,
            data: group.rooms,
          }))}
          renderItem={renderRoom}
          renderSectionHeader={renderSectionHeader}
          keyExtractor={(item) => item.id}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: Layout.bottomTabBarClearance },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <EmptyState
                icon={emptyState.icon}
                title={emptyState.title}
                description={emptyState.description}
                action={
                  emptyState.canCreate
                    ? {
                        label: 'New conversation',
                        onPress: () => setCreateVisible(true),
                        testID: 'chat-rooms-empty-new-button',
                      }
                    : undefined
                }
              />
            </View>
          }
        />
      </AdaptiveContainer>
    );
  };

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container} testID="chat-rooms-screen">
        <ScreenHeader
          title="Chat"
          showBackButton={config.presentation === 'fab'}
          onBackPress={config.presentation === 'fab' ? () => router.back() : undefined}
          backButtonTestID="chat-rooms-close"
          showNotificationBell={false}
          onProfilePress={() => router.push('/profile')}
          showAvatar={false}
          showPropertySwitcher={false}
          rightElement={
            <>
              <SettingsGearButton />
              {householdId ? (
                <HeaderActionButton
                  label="+ New"
                  tone="tint"
                  onPress={() => setCreateVisible(true)}
                  testID="chat-rooms-new-button"
                />
              ) : null}
            </>
          }
        />

        {renderBody()}

        <BottomSheet
          visible={createVisible}
          onClose={closeCreateSheet}
          title="New conversation"
          height="standard"
          showCloseButton
        >
          <TextInput
            testID="chat-rooms-name-input"
            placeholder="Room name (e.g. Kitchen Reno)"
            value={newName}
            onChangeText={(text) => {
              setNewName(text);
              if (createError) setCreateError(null);
            }}
            autoFocus
            maxLength={80}
            // The Create button can sit behind the keyboard on short screens;
            // let the return key ("Done") create the room so the flow never
            // depends on reaching a button the keyboard is covering.
            returnKeyType="done"
            onSubmitEditing={() => {
              if (newName.trim() && !creating) void handleCreate();
            }}
          />
          {createError ? (
            <Typography variant="footnote" color={colors.error} testID="chat-rooms-create-error">
              {createError}
            </Typography>
          ) : null}
          <View style={styles.toggleRow}>
            <View style={styles.toggleLabel}>
              <Typography variant="body">Allow AI assistant</Typography>
              <Typography variant="caption1" color={colors.textSecondary}>
                Members can type @assistant to ask the AI
              </Typography>
            </View>
            <Toggle value={newAiEnabled} onValueChange={setNewAiEnabled} />
          </View>
          <View style={styles.sheetActions}>
            <Button title="Cancel" variant="ghost" onPress={closeCreateSheet} />
            <Button
              title={creating ? 'Creating…' : 'Create'}
              variant="primary"
              size="sm"
              loading={creating}
              disabled={!newName.trim() || creating}
              onPress={handleCreate}
              testID={creating ? 'chat-rooms-creating' : 'chat-rooms-create-button'}
            />
          </View>
        </BottomSheet>
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
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.xxl,
  },
  filterRow: {
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xxs,
  },
  list: {
    paddingTop: Spacing.sm,
    flexGrow: 1,
    gap: Layout.cardSpacing,
  },
  roomCard: {
    padding: Spacing.base,
    borderRadius: CornerRadius.listItem,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xxs,
    paddingHorizontal: Spacing.xxs,
  },
  sectionTitle: {
    flexShrink: 1,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  sectionDot: {
    width: Spacing.xs,
    height: Spacing.xs,
    borderRadius: Spacing.xs / 2,
  },
  roomRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  roomInfo: {
    flex: 1,
    minWidth: 0,
  },
  roomTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.xxs,
  },
  roomTitle: {
    flexShrink: 1,
  },
  unreadBadge: {
    minWidth: Spacing.base + Spacing.sm,
    height: Spacing.base + Spacing.sm,
    borderRadius: (Spacing.base + Spacing.sm) / 2,
    paddingHorizontal: Spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: Spacing.sm,
  },
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: EmptyStateTokens.blockPaddingVertical,
    paddingHorizontal: Spacing.xxl,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.base,
    marginBottom: Spacing.xl,
  },
  toggleLabel: {
    flex: 1,
    marginRight: Spacing.md,
    gap: Spacing.xxs,
  },
  sheetActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: Spacing.sm,
  },
});

export default ChatRoomsListScreen;
