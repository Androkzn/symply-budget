import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Image } from 'expo-image';
import { useNavigation, useRoute, type RouteProp } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, KeyboardAvoidingView, Linking, Modal, Platform, ScrollView, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';

import {
  wishesApi,
  type WishEntry,
  type WishStatus,
  type WishWithEntries,
} from '@api/wishes';
import { SafeAreaView, ScreenHeader, SheetHeader } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Avatar, Button, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { ENV } from '@config/env';
import { useKeyboardInset } from '@hooks/useKeyboardInset';
import type { BudgetStackParamList } from '@navigation/types';
import { PhotoUploadService } from '@services/photo-upload';
import { showToast } from '@services/toastManager';
import { useAuthStore } from '@stores/authStore';
import { useBudgetStore } from '@stores/budgetStore';
import { useHouseholdStore } from '@stores/householdStore';
import { CornerRadius, IconSize, scaledFont, Spacing, useAppColors } from '@theme';
import { numericTextHandler } from '@utils/keyboard';
import { formatMoney, useDisplayCurrency } from '@utils/money';

import { AddWishModal } from './AddWishModal';

type Nav = NativeStackNavigationProp<BudgetStackParamList>;
type DetailRoute = RouteProp<BudgetStackParamList, 'WishDetail'>;

function formatCost(cents: number): string {
  return formatMoney(cents, { decimals: cents % 100 === 0 ? 0 : 2 });
}

/** ISO → 'Jul 6, 2:15 PM'. */
function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function WishDetailScreen() {  const colors = useAppColors();
  // Re-render amounts when Settings → Currency changes.
  useDisplayCurrency();
  const navigation = useNavigation<Nav>();
  const route = useRoute<DetailRoute>();
  const { wishId } = route.params;
  const { currentHousehold } = useHouseholdStore();
  const dataRevision = useBudgetStore((s) => s.dataRevision);
  const { user } = useAuthStore();
  const currentUserId = user?.id ?? null;
  const householdId = currentHousehold?.id;

  const [wish, setWish] = useState<WishWithEntries | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [noteText, setNoteText] = useState('');
  const [busy, setBusy] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showLink, setShowLink] = useState(false);
  // When set, the composer / link sheet edits an existing item instead of adding.
  const [editingNote, setEditingNote] = useState<WishEntry | null>(null);
  const [editingLink, setEditingLink] = useState<WishEntry | null>(null);
  // When set, the next note / photo / link is posted as a reply to this entry.
  const [replyTo, setReplyTo] = useState<WishEntry | null>(null);

  const scrollRef = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    if (!householdId) return;
    try {
      const result = await wishesApi.get(householdId, wishId);
      setWish(result);
    } catch (error) {
      console.error('[WishDetail] load failed:', error);
      showToast('error', 'Could not load this wish');
    } finally {
      setIsLoading(false);
    }
  }, [householdId, wishId]);

  useEffect(() => {
    if (dataRevision > 0) load();
  }, [dataRevision, load]);

  useEffect(() => {
    setIsLoading(true);
    load();
  }, [load]);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, []);

  const submitComposer = useCallback(async () => {
    const body = noteText.trim();
    if (!body || !householdId) return;
    setBusy(true);
    try {
      if (editingNote) {
        await wishesApi.updateEntry(householdId, wishId, editingNote.id, { body });
        setEditingNote(null);
      } else {
        await wishesApi.addEntry(householdId, wishId, {
          kind: 'note',
          body,
          parent_entry_id: replyTo?.id,
        });
        setReplyTo(null);
      }
      setNoteText('');
      await load();
      scrollToEnd();
    } catch (error) {
      console.error('[WishDetail] submitComposer failed:', error);
      showToast('error', editingNote ? 'Could not save changes' : 'Could not add note');
    } finally {
      setBusy(false);
    }
  }, [noteText, householdId, wishId, editingNote, replyTo, load, scrollToEnd]);

  const startEditNote = useCallback((entry: WishEntry) => {
    setEditingNote(entry);
    setNoteText(entry.body ?? '');
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingNote(null);
    setNoteText('');
  }, []);

  const addPhoto = useCallback(async () => {
    if (!householdId) return;
    try {
      const asset = await PhotoUploadService.pickPhoto({ allowsEditing: false, quality: 0.8 });
      if (!asset) return;
      setBusy(true);
      const caption = noteText.trim() || undefined;
      const imageKey = await wishesApi.uploadImage(householdId, wishId, asset);
      await wishesApi.addEntry(householdId, wishId, {
        kind: 'image',
        image_key: imageKey,
        body: caption,
        parent_entry_id: replyTo?.id,
      });
      if (caption) setNoteText('');
      setReplyTo(null);
      await load();
      scrollToEnd();
    } catch (error) {
      console.error('[WishDetail] addPhoto failed:', error);
      showToast('error', 'Could not add photo');
    } finally {
      setBusy(false);
    }
  }, [householdId, wishId, noteText, replyTo, load, scrollToEnd]);

  const performDeleteEntry = useCallback(
    async (entry: WishEntry) => {
      if (!householdId) return;
      try {
        await wishesApi.deleteEntry(householdId, wishId, entry.id);
        await load();
      } catch (error) {
        console.error('[WishDetail] deleteEntry failed:', error);
        showToast('error', 'Could not remove item');
      }
    },
    [householdId, wishId, load]
  );

  /** Promote an existing image entry to be the wish's main (cover) photo. */
  const setAsCover = useCallback(
    async (imageKey: string) => {
      if (!householdId) return;
      try {
        await wishesApi.update(householdId, wishId, { cover_image_key: imageKey });
        showToast('success', 'Main photo updated');
        await load();
      } catch (error) {
        console.error('[WishDetail] setAsCover failed:', error);
        showToast('error', 'Could not update main photo');
      }
    },
    [householdId, wishId, load]
  );

  /** Pick + upload a fresh photo, add it to the feed, and make it the cover. */
  const changeCoverPhoto = useCallback(async () => {
    if (!householdId) return;
    try {
      const asset = await PhotoUploadService.pickPhoto({ allowsEditing: true, quality: 0.8, aspect: [16, 9] });
      if (!asset) return;
      setBusy(true);
      const imageKey = await wishesApi.uploadImage(householdId, wishId, asset);
      await wishesApi.addEntry(householdId, wishId, { kind: 'image', image_key: imageKey });
      await wishesApi.update(householdId, wishId, { cover_image_key: imageKey });
      await load();
      showToast('success', 'Main photo updated');
    } catch (error) {
      console.error('[WishDetail] changeCoverPhoto failed:', error);
      showToast('error', 'Could not update main photo');
    } finally {
      setBusy(false);
    }
  }, [householdId, wishId, load]);

  const startEditLink = useCallback((entry: WishEntry) => {
    setEditingLink(entry);
    setShowLink(true);
  }, []);

  const startReply = useCallback((entry: WishEntry) => {
    setEditingNote(null);
    setReplyTo(entry);
  }, []);

  /** Long-press menu for a feed entry: reply, edit text items, promote/remove photos. */
  const openEntryMenu = useCallback(
    (entry: WishEntry) => {
      if (!householdId) return;
      type Action = { label: string; run: () => void; destructive?: boolean };

      // Build the action list per entry kind, then present it through the platform's
      // native menu. iOS uses ActionSheetIOS (no button limit); Android's Alert only
      // has 3 button slots, so the link menu (Reply/Edit/Open/Remove) previously
      // silently dropped actions there — mirror BudgetPlannedFitCard's split instead.
      const actions: Action[] = [{ label: 'Reply', run: () => startReply(entry) }];
      let title = 'Note';

      if (entry.kind === 'image' && entry.image_key) {
        const key = entry.image_key;
        title = 'Photo';
        if (wish?.cover_image_key !== key) {
          actions.push({ label: 'Set as main photo', run: () => setAsCover(key) });
        }
        actions.push({ label: 'Remove photo', run: () => performDeleteEntry(entry), destructive: true });
      } else if (entry.kind === 'link') {
        title = 'Link';
        actions.push({ label: 'Edit', run: () => startEditLink(entry) });
        actions.push({
          label: 'Open',
          run: () => {
            if (entry.url) Linking.openURL(entry.url);
          },
        });
        actions.push({ label: 'Remove', run: () => performDeleteEntry(entry), destructive: true });
      } else {
        actions.push({ label: 'Edit', run: () => startEditNote(entry) });
        actions.push({ label: 'Remove', run: () => performDeleteEntry(entry), destructive: true });
      }

      const options = [...actions.map((a) => a.label), 'Cancel'];
      const cancelButtonIndex = options.length - 1;
      const destructiveIndex = actions.findIndex((a) => a.destructive);

      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            title,
            options,
            cancelButtonIndex,
            ...(destructiveIndex >= 0 ? { destructiveButtonIndex: destructiveIndex } : {}),
          },
          (index) => {
            if (index >= 0 && index < actions.length) actions[index].run();
          }
        );
      } else {
        Alert.alert(title, undefined, [
          ...actions.map((a) => ({
            text: a.label,
            onPress: a.run,
            style: a.destructive ? ('destructive' as const) : undefined,
          })),
          { text: 'Cancel', style: 'cancel' as const },
        ]);
      }
    },
    [householdId, wish, setAsCover, performDeleteEntry, startEditNote, startEditLink, startReply]
  );

  const setStatus = useCallback(
    async (status: WishStatus) => {
      if (!householdId) return;
      try {
        await wishesApi.update(householdId, wishId, { status });
        showToast('success', status === 'achieved' ? 'Marked as achieved 🎉' : 'Updated');
        await load();
      } catch (error) {
        console.error('[WishDetail] setStatus failed:', error);
        showToast('error', 'Could not update');
      }
    },
    [householdId, wishId, load]
  );

  const confirmDeleteWish = useCallback(() => {
    if (!householdId) return;
    Alert.alert('Delete wish?', 'This removes the wish and its whole feed. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await wishesApi.remove(householdId, wishId);
            navigation.goBack();
          } catch (error) {
            console.error('[WishDetail] delete failed:', error);
            showToast('error', 'Could not delete');
          }
        },
      },
    ]);
  }, [householdId, wishId, navigation]);

  const openMenu = useCallback(() => {
    if (!wish) return;
    const options: Array<{ text: string; style?: 'destructive' | 'cancel'; onPress?: () => void }> = [
      { text: 'Edit details', onPress: () => setShowEdit(true) },
      {
        text: wish.cover_image_key ? 'Change cover photo' : 'Add cover photo',
        onPress: () => { changeCoverPhoto(); },
      },
    ];
    if (wish.status !== 'achieved') {
      options.push({ text: 'Mark as achieved', onPress: () => { setStatus('achieved'); } });
    } else {
      options.push({ text: 'Move back to dreaming', onPress: () => { setStatus('active'); } });
    }
    if (wish.status !== 'archived') {
      options.push({ text: 'Archive', onPress: () => { setStatus('archived'); } });
    } else {
      options.push({ text: 'Unarchive', onPress: () => { setStatus('active'); } });
    }
    options.push({ text: 'Delete wish', style: 'destructive', onPress: confirmDeleteWish });
    options.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(wish.title, undefined, options);
  }, [wish, setStatus, confirmDeleteWish, changeCoverPhoto]);

  return (
    // No top edge here: ScreenHeader owns the top safe-area inset. The bottom
    // edge lifts the composer clear of the home indicator now that the floating
    // tab bar is hidden on this screen.
    <SafeAreaView style={styles.safe} edges={['bottom']} testID="wish-detail-screen">
      <ScreenHeader
        title={wish?.title ?? 'Wish'}
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
        showPropertySwitcher={false}
        rightElement={
          <TouchableOpacity onPress={openMenu} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Icon name="ellipsis-horizontal" size={IconSize.lg} color={colors.textPrimary} />
          </TouchableOpacity>
        }
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        {/* Cap + center the feed/composer on iPad to a reading-width column so
            the photo/note feed doesn't sprawl; no-op on iPhone. padding={0}
            keeps the existing per-view horizontal padding. */}
        <AdaptiveContainer width="reading" padding={0} style={styles.flex}>
        {isLoading || !wish ? (
          <View style={styles.centered} testID="wish-detail-loading">
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <ScrollView keyboardShouldPersistTaps="handled"
            ref={scrollRef}
            style={styles.flex}
            contentContainerStyle={styles.feed}
            showsVerticalScrollIndicator={false}
          >
            {/* Hero / summary */}
            <View style={[styles.hero, { backgroundColor: colors.backgroundSecondary, borderColor: colors.divider }]}>
              {wish.cover_image_key ? (
                <View>
                  <Image
                    source={{ uri: `${ENV.API_BASE_URL}/files/${wish.cover_image_key}` }}
                    style={styles.heroImage}
                    contentFit="cover"
                    transition={150}
                  />
                  <TouchableOpacity
                    style={[styles.changeCoverPill, { backgroundColor: colors.modalBackdrop }]}
                    onPress={changeCoverPhoto}
                    disabled={busy}
                    testID="wish-change-cover"
                    accessibilityLabel="Change main photo"
                  >
                    <Icon name="camera-outline" size={IconSize.sm} color={colors.white} />
                    <Typography variant="caption1" weight="semibold" color={colors.white}>
                      Change photo
                    </Typography>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.addCover, { borderColor: colors.divider }]}
                  onPress={changeCoverPhoto}
                  disabled={busy}
                  testID="wish-add-cover"
                  accessibilityLabel="Add a main photo"
                >
                  <Icon name="image-outline" size={IconSize.lg} color={colors.primary} />
                  <Typography variant="subheadline" weight="medium" color={colors.primary}>
                    Add a main photo
                  </Typography>
                </TouchableOpacity>
              )}
              <View style={styles.heroBody}>
                {!!wish.notes && (
                  <Typography variant="subheadline" color={colors.textSecondary}>
                    {wish.notes}
                  </Typography>
                )}
                {wish.estimated_cost_cents != null && (
                  <View style={[styles.pill, { backgroundColor: colors.surfaceSelected }]}>
                    <Icon name="pricetag-outline" size={IconSize.sm} color={colors.primary} />
                    <Typography variant="caption1" weight="medium" color={colors.textPrimary}>
                      Ballpark {formatCost(wish.estimated_cost_cents)}
                    </Typography>
                  </View>
                )}
              </View>
            </View>

            {wish.entries.length === 0 ? (
              <View style={styles.emptyFeed}>
                <Icon name="chatbubbles-outline" size={IconSize.lg} color={colors.textTertiary} />
                <Typography variant="subheadline" color={colors.textSecondary} style={styles.emptyFeedText}>
                  Start collecting toward this dream — drop in a note, a photo you love, or a link to
                  something you found.
                </Typography>
              </View>
            ) : (
              wish.entries.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  colors={colors}
                  surface={colors.backgroundSecondary}
                  isCover={!!entry.image_key && entry.image_key === wish.cover_image_key}
                  isMine={!!entry.author_id && entry.author_id === currentUserId}
                  onLongPress={() => openEntryMenu(entry)}
                />
              ))
            )}
          </ScrollView>
        )}

        {/* Composer */}
        {!isLoading && wish && (
          <View style={{ backgroundColor: colors.backgroundMain }}>
            {(editingNote || replyTo) && (
              <View style={[styles.editBanner, { backgroundColor: colors.surfaceSelected, borderTopColor: colors.divider }]}>
                <Icon name={editingNote ? 'pencil' : 'arrow-undo'} size={IconSize.sm} color={colors.primary} />
                <Typography variant="caption1" weight="medium" color={colors.textSecondary} style={styles.editBannerText} numberOfLines={1}>
                  {editingNote
                    ? 'Editing note'
                    : `Replying to ${
                        replyTo?.author_id === currentUserId ? 'yourself' : replyTo?.author_name || 'a message'
                      }`}
                </Typography>
                <TouchableOpacity
                  onPress={() => {
                    if (editingNote) cancelEdit();
                    else setReplyTo(null);
                  }}
                  testID="wish-cancel-edit"
                >
                  <Typography variant="caption1" weight="semibold" color={colors.primary}>
                    Cancel
                  </Typography>
                </TouchableOpacity>
              </View>
            )}
            <View style={[styles.composer, { borderTopColor: colors.divider }]}>
            <TouchableOpacity
              style={[styles.composerIcon, { backgroundColor: colors.backgroundSecondary }]}
              onPress={addPhoto}
              disabled={busy}
              testID="wish-add-photo"
              accessibilityLabel="Add photo"
            >
              <Icon name="image-outline" size={IconSize.md} color={colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.composerIcon, { backgroundColor: colors.backgroundSecondary }]}
              onPress={() => setShowLink(true)}
              disabled={busy}
              testID="wish-add-link"
              accessibilityLabel="Add link"
            >
              <Icon name="link-outline" size={IconSize.md} color={colors.primary} />
            </TouchableOpacity>
            <TextInput
              style={[
                styles.composerInput,
                { color: colors.textPrimary, backgroundColor: colors.backgroundSecondary, borderColor: colors.divider },
              ]}
              value={noteText}
              onChangeText={setNoteText}
              placeholder={editingNote ? 'Edit note…' : 'Add a note…'}
              placeholderTextColor={colors.textTertiary}
              multiline
              editable={!busy}
            />
            <TouchableOpacity
              style={[
                styles.sendButton,
                { backgroundColor: busy || noteText.trim() ? colors.primary : colors.actionDisabled },
              ]}
              onPress={submitComposer}
              disabled={!noteText.trim() || busy}
              testID="wish-send-note"
              accessibilityLabel={busy ? 'Saving…' : editingNote ? 'Save note' : 'Send note'}
            >
              {busy ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <Icon name={editingNote ? 'checkmark' : 'arrow-up'} size={IconSize.md} color={colors.white} />
              )}
            </TouchableOpacity>
            </View>
          </View>
        )}
        </AdaptiveContainer>
      </KeyboardAvoidingView>

      {householdId && wish && (
        <AddWishModal
          visible={showEdit}
          householdId={householdId}
          editingWish={wish}
          onClose={() => setShowEdit(false)}
          onSaved={load}
        />
      )}
      {householdId && (
        <AddLinkModal
          visible={showLink}
          isEditing={!!editingLink}
          initial={
            editingLink
              ? {
                  url: editingLink.url ?? '',
                  title: editingLink.link_title ?? '',
                  price: editingLink.price_cents != null ? String(editingLink.price_cents / 100) : '',
                }
              : undefined
          }
          onClose={() => {
            setShowLink(false);
            setEditingLink(null);
          }}
          onSubmit={async ({ url, title, priceCents }) => {
            setShowLink(false);
            setBusy(true);
            try {
              if (editingLink) {
                await wishesApi.updateEntry(householdId, wishId, editingLink.id, {
                  url,
                  link_title: title ?? null,
                  price_cents: priceCents ?? null,
                });
                setEditingLink(null);
              } else {
                await wishesApi.addEntry(householdId, wishId, {
                  kind: 'link',
                  url,
                  link_title: title,
                  price_cents: priceCents,
                  parent_entry_id: replyTo?.id,
                });
                setReplyTo(null);
              }
              await load();
              scrollToEnd();
            } catch (error) {
              console.error('[WishDetail] save link failed:', error);
              showToast('error', 'Could not save link');
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// One feed entry (note / image / link)
// ---------------------------------------------------------------------------

function EntryRow({
  entry,
  colors,
  surface,
  isCover,
  isMine,
  onLongPress,
}: {
  entry: WishEntry;
  colors: ReturnType<typeof useAppColors>;
  surface: string;
  isCover: boolean;
  isMine: boolean;
  onLongPress: () => void;
}) {
  const priceTag =
    entry.price_cents != null ? (
      <View style={[styles.pill, { backgroundColor: colors.surfaceSelected }]}>
        <Typography variant="caption1" weight="semibold" color={colors.primary}>
          {formatCost(entry.price_cents)}
        </Typography>
      </View>
    ) : null;

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onLongPress={onLongPress}
      delayLongPress={300}
      testID={`wish-entry-${entry.id}`}
      style={[styles.entry, { backgroundColor: surface, borderColor: colors.divider }]}
    >
      {/* Author header — who posted this, chat-style */}
      <View style={styles.entryHeader}>
        <Avatar
          user={{ display_name: entry.author_name, avatar_url: entry.author_avatar_url }}
          size="sm"
        />
        <View style={styles.entryAuthorText}>
          <Typography variant="footnote" weight="semibold" numberOfLines={1}>
            {isMine ? 'You' : entry.author_name || 'Someone'}
          </Typography>
          <Typography variant="caption2" color={colors.textTertiary}>
            {formatWhen(entry.created_at)}
          </Typography>
        </View>
      </View>

      {/* Quoted reply reference (chat-style) */}
      {entry.reply_to && (
        <View style={[styles.replyQuote, { borderLeftColor: colors.primary }]}>
          <Typography variant="caption2" weight="semibold" color={colors.primary} numberOfLines={1}>
            {entry.reply_to.author_name || 'Someone'}
          </Typography>
          <Typography variant="caption1" color={colors.textTertiary} numberOfLines={1}>
            {entry.reply_to.snippet}
          </Typography>
        </View>
      )}
      {entry.kind === 'image' && entry.image_key && (
        <View>
          <Image
            source={{ uri: `${ENV.API_BASE_URL}/files/${entry.image_key}` }}
            style={styles.entryImage}
            contentFit="cover"
            transition={150}
          />
          {isCover && (
            <View style={[styles.coverBadge, { backgroundColor: colors.primary }]}>
              <Icon name="star" size={IconSize.sm} color={colors.white} />
              <Typography variant="caption2" weight="semibold" color={colors.white}>
                Main photo
              </Typography>
            </View>
          )}
        </View>
      )}

      {entry.kind === 'link' && (
        <TouchableOpacity
          style={styles.linkRow}
          onPress={() => entry.url && Linking.openURL(entry.url)}
          activeOpacity={0.7}
        >
          <View style={[styles.linkIcon, { backgroundColor: colors.surfaceSelected }]}>
            <Icon name="link" size={IconSize.md} color={colors.primary} />
          </View>
          <View style={styles.linkText}>
            <Typography variant="subheadline" weight="semibold" color={colors.primary} numberOfLines={1}>
              {entry.link_title || entry.url}
            </Typography>
            {!!entry.link_title && (
              <Typography variant="caption1" color={colors.textTertiary} numberOfLines={1}>
                {entry.url}
              </Typography>
            )}
          </View>
        </TouchableOpacity>
      )}

      {!!entry.body && (
        <Typography variant="body" color={colors.textPrimary} style={styles.entryBody}>
          {entry.body}
        </Typography>
      )}

      {priceTag && <View style={styles.entryFooter}>{priceTag}</View>}
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// Add-link modal
// ---------------------------------------------------------------------------

function AddLinkModal({
  visible,
  isEditing,
  initial,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  isEditing?: boolean;
  initial?: { url: string; title: string; price: string };
  onClose: () => void;
  onSubmit: (input: { url: string; title?: string; priceCents?: number }) => void;
}) {
  const colors = useAppColors();
  // Bottom-anchored sheet inside a Modal: the keypad opens on top of the price
  // field, and a KeyboardAvoidingView is unreliable in a Modal. Lift by the
  // measured inset instead (see `@hooks/useKeyboardInset`).
  const keyboardInset = useKeyboardInset();
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');

  useEffect(() => {
    if (visible) {
      setUrl(initial?.url ?? '');
      setTitle(initial?.title ?? '');
      setPrice(initial?.price ?? '');
    }
  }, [visible, initial?.url, initial?.title, initial?.price]);

  const submit = () => {
    let normalized = url.trim();
    if (!normalized) {
      showToast('error', 'Paste a link first');
      return;
    }
    if (!/^https?:\/\//i.test(normalized)) normalized = `https://${normalized}`;
    const parsed = price.trim() ? Math.round(parseFloat(price.replace(/[^0-9.]/g, '')) * 100) : undefined;
    onSubmit({
      url: normalized,
      title: title.trim() || undefined,
      priceCents: parsed != null && Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined,
    });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={[styles.linkModalContainer, { paddingBottom: keyboardInset }]}>
        <TouchableOpacity
          style={[styles.backdrop, { backgroundColor: colors.modalBackdrop }]}
          activeOpacity={1}
          onPress={onClose}
        />
        <View style={[styles.linkSheet, { backgroundColor: colors.backgroundMain }]}>
          {/* The app's one sheet header — glass ✕ on the left, centred title,
              hairline rule under it. */}
          <SheetHeader
            title={isEditing ? 'Edit link' : 'Add a link'}
            leftVariant="close"
            onLeftPress={onClose}
            leftTestID="wish-link-close"
            leftAccessibilityLabel="Close"
            showDivider
          />
          <View style={styles.linkBody}>
            <TextInput
              style={[styles.linkInput, { color: colors.textPrimary, backgroundColor: colors.backgroundSecondary, borderColor: colors.divider }]}
              value={url}
              onChangeText={setUrl}
              placeholder="Paste a link (a listing, an idea…)"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              testID="wish-link-url"
              autoFocus
            />
            <TextInput
              style={[styles.linkInput, { color: colors.textPrimary, backgroundColor: colors.backgroundSecondary, borderColor: colors.divider }]}
              value={title}
              onChangeText={setTitle}
              placeholder="Label (optional) — e.g. “The one I love”"
              placeholderTextColor={colors.textTertiary}
            />
            <View
              style={[styles.linkInput, styles.priceRow, { backgroundColor: colors.backgroundSecondary, borderColor: colors.divider }]}
            >
              <Typography variant="body" color={colors.textSecondary}>
                $
              </Typography>
              <TextInput
                style={[styles.priceInput, { color: colors.textPrimary }]}
                value={price}
                onChangeText={numericTextHandler(setPrice)}
                placeholder="Price (optional)"
                placeholderTextColor={colors.textTertiary}
                keyboardType="decimal-pad"
              />
            </View>
            <Button title={isEditing ? 'Save link' : 'Add link'} variant="primary" onPress={submit} fullWidth testID="wish-link-submit" />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  feed: { padding: Spacing.base, gap: Spacing.md, paddingBottom: Spacing.xl },

  hero: {
    borderRadius: CornerRadius.card,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  heroImage: { width: '100%', aspectRatio: 16 / 9 },
  changeCoverPill: {
    position: 'absolute',
    bottom: Spacing.sm,
    right: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    borderRadius: CornerRadius.full,
  },
  addCover: {
    height: 120,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
  },
  coverBadge: {
    position: 'absolute',
    top: Spacing.sm,
    left: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
    paddingVertical: Spacing.xxs,
    paddingHorizontal: Spacing.sm,
    borderRadius: CornerRadius.full,
  },
  heroBody: { padding: Spacing.base, gap: Spacing.sm },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
    alignSelf: 'flex-start',
    paddingVertical: Spacing.xxs,
    paddingHorizontal: Spacing.sm,
    borderRadius: CornerRadius.full,
  },

  emptyFeed: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xl, paddingHorizontal: Spacing.lg },
  emptyFeedText: { textAlign: 'center' },

  entry: {
    borderRadius: CornerRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.md,
    gap: Spacing.sm,
    overflow: 'hidden',
  },
  entryHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  entryAuthorText: { flex: 1, gap: 1 },
  entryImage: { width: '100%', aspectRatio: 16 / 9, borderRadius: CornerRadius.md },
  entryBody: {},
  entryFooter: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  editBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  editBannerText: { flex: 1 },
  replyQuote: {
    borderLeftWidth: 3,
    paddingLeft: Spacing.sm,
    paddingVertical: Spacing.xxs,
    gap: 1,
  },

  linkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  linkIcon: {
    width: 40,
    height: 40,
    borderRadius: CornerRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkText: { flex: 1 },

  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  composerIcon: {
    width: 40,
    height: 40,
    borderRadius: CornerRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerInput: {
    flex: 1,
    maxHeight: 120,
    minHeight: 40,
    ...scaledFont('body'),
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    borderRadius: CornerRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: CornerRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },

  linkModalContainer: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  linkSheet: {
    borderTopLeftRadius: CornerRadius.sheet,
    borderTopRightRadius: CornerRadius.sheet,
    paddingTop: Spacing.base,
    paddingBottom: Spacing.xl,
  },
  linkBody: { padding: Spacing.lg, gap: Spacing.md },
  linkInput: {
    ...scaledFont('body'),
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.base,
    borderRadius: CornerRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, paddingVertical: 0, minHeight: 48 },
  priceInput: { flex: 1, ...scaledFont('body'), paddingVertical: Spacing.md },
});
