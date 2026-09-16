import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
// Expo SDK 54 made the top-level `readAsStringAsync` a throw-on-call deprecation
// stub; use the `/legacy` subpath until the app migrates to the File API.
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Image as ExpoImage } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from 'expo-router/react-navigation';
import * as Sharing from 'expo-sharing';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, FlatList, KeyboardAvoidingView, Linking, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CloudFilePicker } from '@components/cloud-storage';
import { AppBackground, HeaderActionButton, ScreenHeader } from '@components/common';
import { Avatar, Card, Icon, Typography, hasBrandIcon } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { useAIEntitlement } from '@hooks/useAIEntitlement';
import { useHouseholdMembers } from '@hooks/useHouseholdMembers';
import { storageHelpers } from '@services/storage';
import { useAuthStore } from '@stores/authStore';
import { useHouseholdStore } from '@stores/householdStore';
import { useNotificationStore } from '@stores/notificationStore';
import {
  Chat as ChatTokens,
  CornerRadius,
  EmptyState as EmptyStateTokens,
  Header,
  Layout,
  Spacing,
  scaledFont,
  useAppColors,
} from '@theme';
import { getApiErrorMessage } from '@utils/apiError';
import { toVisionSafeAttachment } from '@utils/visionSafeAttachment';

import { ChatActionCard } from '../actions/ChatActionCard';
import { useChatActions } from '../actions/useChatActions';
import { useChatConfig } from '../ChatConfigContext';
import { ChatMessageUi } from '../ChatMessageUi';
import {
  ASSISTANT_HANDLE,
  assistantDefaultKey,
  caretAfterEdit,
  mentionTokenAt,
  withAssistantMention,
} from '../composerMentions';
import {
  chatMessageReceiptDraft,
  openBudgetReceiptConfirm,
} from '../receiptDraftStore';
import type { ChatMessage, ChatStackParamList, OutgoingAttachment } from '../types';
import { chatMessageUiBlocks } from '../types';
import { useChatSocket } from '../useChatSocket';

/** Stable empty list so the actions hook is a no-op outside House. */
const EMPTY_MESSAGES: ChatMessage[] = [];

type ChatRoomRouteParams = {
  ChatRoom: { roomId: string; roomName: string; aiEnabled?: boolean };
};

/** A local attachment (image or document) the user picked but hasn't sent yet. */
interface PendingImage {
  id: string;
  uri: string;
  mimeType: string;
  /** 'image' renders a thumbnail; 'file' renders a document chip. */
  kind: 'image' | 'file';
  /** Original filename — the label for document attachments. */
  name?: string;
  width?: number;
  height?: number;
  status: 'uploading' | 'ready' | 'failed';
  progress: number;
  /** R2 key once the upload completes. */
  key?: string;
}

/** True for MIME types the app can render as an inline image thumbnail. */
const isImageMime = (mime?: string): boolean => !!mime && mime.startsWith('image/');

/**
 * The assistant's face in this chat, resolved against the ACTIVE brand's kit.
 *
 * This screen is shared by every app, but the icon kits are not: Budget/Kaizen/
 * Health ship `ai-coach`, House ships `ai-housekeeper`. Naming one slug outright
 * is what put a missing-glyph "?" where House's assistant avatar belongs —
 * `<Icon>` falls through to Ionicons for a name its kit lacks, and `ai-coach`
 * is not an Ionicons glyph either. Ask each kit in turn (as OnboardingWelcome
 * does) and keep a real Ionicons glyph as the last resort. The kit is baked at
 * build time, so this resolves once per module, not per render.
 */
const ASSISTANT_ICON_FALLBACK = 'sparkles';
const ASSISTANT_ICON =
  ['ai-coach', 'ai-housekeeper', 'ai-robot'].find(hasBrandIcon) ?? ASSISTANT_ICON_FALLBACK;

/** Short wall-clock label for a bubble (e.g. "10:38 AM"). Empty for bad input. */
function formatMessageTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Best-effort MIME guess from a filename — Google Drive gives us a name but no content type. */
function guessMimeFromName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    heic: 'image/heic',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    csv: 'text/csv',
    txt: 'text/plain',
  };
  return map[ext] ?? 'application/octet-stream';
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const decoder = (globalThis as any).atob as (s: string) => string;
  const binary = decoder(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function ChatRoomScreen() {
  const config = useChatConfig();
  const api = config.api;
  const useChatStore = config.store;
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<ChatStackParamList>>();
  const router = useRouter();
  const route = useRoute<RouteProp<ChatRoomRouteParams, 'ChatRoom'>>();
  const { roomId, roomName, aiEnabled: aiEnabledParam } = route.params;
  /** Rooms opened via deeplink omit aiEnabled; default ON so @assistant rows work. */
  const aiEnabled = aiEnabledParam !== false;

  // The room may allow AI (`aiEnabled`), but @assistant is only usable when this
  // account actually has AI access (BYOK key connected or subscribed). Gate the
  // mention row + hint on both so we never offer @assistant to a user whose send
  // would 403 server-side. Connecting a provider flips `canUseAI` via the shared
  // ['ai-access'] query and re-renders this row on.
  const { canUseAI } = useAIEntitlement();
  const aiAvailable = aiEnabled && canUseAI;

  const householdId = useHouseholdStore((s) => s.currentHousehold?.id);
  const currentUserId = useAuthStore((s) => s.user?.id);

  // Members drive both the @mention picker and the owner gate (RQ).
  const { data: members = [] } = useHouseholdMembers(householdId);
  const isOwner = useMemo(
    () => members.some((m) => m.user_id === currentUserId && m.role === 'owner'),
    [members, currentUserId]
  );
  /** Taggable members = everyone but me. */
  const mentionCandidates = useMemo(
    () => members.filter((m) => m.user_id !== currentUserId),
    [members, currentUserId]
  );


  // Prefer the live store name so a rename (local or via `room_renamed` socket
  // event) updates the header immediately; fall back to the nav param.
  const storeRoomName = useChatStore((s) => s.rooms.find((r) => r.id === roomId)?.name);
  const displayName = storeRoomName ?? roomName;

  // The dedicated 1:1 AI assistant room answers every message without an
  // `@assistant` mention, so its composer hints and empty state differ.
  const isAssistantRoom = useChatStore(
    (s) => s.rooms.find((r) => r.id === roomId)?.is_assistant ?? false
  );

  /**
   * What this room is ABOUT, when it belongs to a project or a material.
   *
   * Opened from the Chat tab, a room called "Herringbone Oak" is a conversation
   * with no visible anchor — the member has to remember which of three projects
   * that material is in. The banner says so, and offers the way back to it.
   */
  const subject = useChatStore((s) => s.rooms.find((r) => r.id === roomId)?.subject) ?? null;
  const subjectHref = subject ? config.subjectHref?.(subject) ?? null : null;

  const messagesRaw = useChatStore((s) => s.messagesByRoom[roomId]);
  const messages = useMemo(() => messagesRaw ?? [], [messagesRaw]);

  /**
   * Writes the assistant decided on, performed HERE rather than on the Worker.
   *
   * A home project is Tier A — on a local-first household its rows exist only
   * in this device's ledger — so "add that material" cannot be an insert in the
   * Worker's tool handler. It arrives as an envelope on the AI message and runs
   * through `homeProjectsApi`, the same call the project hub makes. House only:
   * Budget's assistant writes through its own server-side tools.
   *
   * The hook decides whose device applies and dedupes replays; see its header.
   */
  const {
    byMessage: messageActions,
    confirm: confirmActions,
    decline: declineActions,
  } = useChatActions(
    config.id === 'house' ? roomId : undefined,
    householdId,
    currentUserId,
    config.id === 'house' ? messages : EMPTY_MESSAGES
  );
  const setMessages = useChatStore((s) => s.setMessages);
  const appendMessage = useChatStore((s) => s.appendMessage);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const clearUnread = useChatStore((s) => s.clearUnread);

  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  // user_ids the composer has tagged (reconciled against the text on send).
  const [taggedIds, setTaggedIds] = useState<string[]>([]);
  // When set, the composer is editing an existing message instead of sending.
  const [editing, setEditing] = useState<{ id: string; original: string } | null>(null);
  // When set, the next sent message replies to this one (quoted preview banner).
  const [replyingTo, setReplyingTo] = useState<{
    id: string;
    senderName: string;
    preview: string;
  } | null>(null);
  const inputRef = useRef<TextInput>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  /**
   * Where the caret is in the composer. The @mention autocomplete keys off the
   * token AT THE CARET, not at the end of the text — an edit types the mention
   * in front of the existing body, so an end-anchored match never fires there.
   */
  const caretRef = useRef(0);
  /**
   * The composer's current text, readable synchronously. `onChangeText` diffs
   * against it to locate the caret, and two keystrokes can arrive before a
   * re-render — the state value would be one edit stale there.
   */
  const textRef = useRef('');
  /**
   * A caret position we are imposing after rewriting the text ourselves (a
   * picked mention). Released on the next selection event so the field goes
   * back to owning its own caret.
   */
  const [forcedSelection, setForcedSelection] = useState<{ start: number; end: number } | null>(
    null
  );
  /**
   * "Every message in this room goes to the assistant" — so a member working
   * through a project with the AI doesn't have to type `@assistant` on each
   * line. Persisted per room (see `assistantDefaultKey`).
   */
  const [alwaysAskAssistant, setAlwaysAskAssistant] = useState(false);

  /** Set the composer text and keep the tracked caret with it (defaults to end). */
  const setComposerText = useCallback((next: string, caret?: number) => {
    textRef.current = next;
    caretRef.current = caret ?? next.length;
    setInputText(next);
  }, []);

  const { isPeerTyping, typingActor, typingUserId, sendTyping } = useChatSocket(
    config,
    householdId,
    roomId
  );

  /**
   * Who the indicator is about. The assistant's "thinking" and a member's
   * keystrokes arrive as the same socket frame, so both used to read "Someone
   * is typing…" — which, in a room where the member had just asked the
   * assistant a question, named the one participant it could not possibly be.
   * The relay carries the member's id, so say their name when we know it.
   */
  const typingLabel = useMemo(() => {
    if (typingActor === 'ai') return 'Assistant is typing…';
    const member = typingUserId ? members.find((m) => m.user_id === typingUserId) : undefined;
    return `${member?.display_name || member?.email || 'Someone'} is typing…`;
  }, [typingActor, typingUserId, members]);

  const { isLoading } = useQuery({
    queryKey: ['chat', 'messages', householdId, roomId],
    enabled: !!householdId,
    queryFn: async () => {
      const history = await api.getMessages(householdId!, roomId, { limit: 50 });
      setMessages(roomId, history);
      return history;
    },
  });

  const markRead = useCallback(() => {
    if (!householdId || messages.length === 0) return;
    const lastId = messages[messages.length - 1]?.id;
    api
      .markRead(householdId, roomId, lastId)
      // Reading the room also clears its chat notifications server-side; refresh
      // the local unread counter so the notification (bell) badge drops too.
      .then(() => useNotificationStore.getState().refreshUnreadCount())
      .catch(() => undefined);
    clearUnread(roomId);
  }, [api, householdId, roomId, messages, clearUnread]);

  // Mark the room read whenever it's focused, and again whenever new messages
  // arrive while it's open (markRead's identity changes with `messages`). Using
  // focus (not a bare mount effect) re-marks read when returning to the room.
  useFocusEffect(useCallback(() => { markRead(); }, [markRead]));

  // Dev/E2E: apply `simplebudget://e2e-prime-chat-mention` while this room is
  // mounted — Maestro `inputText` often skips onChangeText on iOS, so we set
  // controlled state directly instead of relying on the native field alone.
  useEffect(() => {
    if (!__DEV__) return;
    const { consumeE2EPrimeChatMention } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('@services/e2e-chat-mention') as typeof import('@services/e2e-chat-mention');
    const applyPrime = () => {
      if (!consumeE2EPrimeChatMention()) return;
      setComposerText('@');
      setMentionQuery('');
    };
    applyPrime();
    const timer = setInterval(applyPrime, 400);
    return () => clearInterval(timer);
  }, [roomId, setComposerText]);

  // ---------- "always ask the assistant" ----------

  const assistantDefaultStorageKey = assistantDefaultKey(config.id, roomId);

  // Restore the room's saved preference. A failed read just leaves it off —
  // the member can still tag `@assistant` by hand.
  useEffect(() => {
    let cancelled = false;
    storageHelpers
      .getBoolean(assistantDefaultStorageKey)
      .then((saved) => {
        if (!cancelled) setAlwaysAskAssistant(saved ?? false);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [assistantDefaultStorageKey]);

  const toggleAlwaysAskAssistant = useCallback(() => {
    setAlwaysAskAssistant((prev) => {
      const next = !prev;
      storageHelpers.setBoolean(assistantDefaultStorageKey, next).catch(() => undefined);
      return next;
    });
  }, [assistantDefaultStorageKey]);

  /**
   * Address the assistant when the toggle is on. The dedicated assistant room
   * already answers everything, so it needs no prefix. A photo sent with no
   * caption still gets the handle — otherwise "every message goes to the
   * assistant" would quietly exclude the receipt the member just shot.
   */
  const applyAssistantDefault = useCallback(
    (body: string, hasAttachment = false): string => {
      if (!alwaysAskAssistant || !aiAvailable || isAssistantRoom) return body;
      const trimmed = body.trim();
      if (!trimmed) return hasAttachment ? ASSISTANT_HANDLE : trimmed;
      return withAssistantMention(trimmed);
    },
    [alwaysAskAssistant, aiAvailable, isAssistantRoom]
  );

  // ---------- @mention autocomplete ----------

  const onChangeInput = useCallback(
    (text: string) => {
      // Derive the caret from the edit itself: `onSelectionChange` is not
      // guaranteed to have fired yet, and a stale caret would look at the wrong
      // token (or none at all, which is what broke mentions while editing).
      const caret = caretAfterEdit(textRef.current, text);
      setComposerText(text, caret);
      sendTyping();
      const token = mentionTokenAt(text, caret);
      setMentionQuery(token ? token.query : null);
    },
    [sendTyping, setComposerText]
  );

  // Keep mention autocomplete in sync when the composer value changes through
  // paths other than onChangeText (some iOS driver batches skip the callback).
  useEffect(() => {
    const token = mentionTokenAt(inputText, caretRef.current);
    setMentionQuery(token ? token.query : null);
  }, [inputText]);

  const mentionMatches = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    const memberMatches = mentionCandidates
      .filter((m) => {
        const name = (m.display_name || m.email).toLowerCase();
        return q === '' || name.includes(q);
      })
      .slice(0, 6);
    const mentionActive = mentionQuery !== null;
    const showAssistant =
      aiAvailable || (__DEV__ && mentionActive && inputText.includes('@'));
    // `ai` matches too — it is what members reach for, and the backend accepts
    // `@ai` alongside `@assistant`. The row still INSERTS `@assistant`, which is
    // the handle already in shipped conversations and in the E2E flows.
    const assistantMatch =
      showAssistant &&
      (q === '' || 'assistant'.includes(q) || 'ai'.includes(q) || ASSISTANT_HANDLE.slice(1).includes(q))
        ? [
            {
              user_id: 'assistant',
              display_name: 'assistant',
              email: 'assistant',
              role: 'member' as const,
            },
          ]
        : [];
    return [...memberMatches, ...assistantMatch].slice(0, 6);
  }, [mentionQuery, mentionCandidates, aiAvailable, inputText]);

  const insertMention = useCallback(
    (userId: string, label: string) => {
      // Replace the token the caret is IN, keeping whatever follows it — an
      // edit types the mention in front of the existing body, so appending
      // would drop that body on the floor.
      const current = textRef.current;
      const token = mentionTokenAt(current, caretRef.current);
      const start = token ? token.start : current.lastIndexOf('@');
      const from = start >= 0 ? start : current.length;
      const to = token ? token.end : current.length;
      const handle = `@${label} `;
      const next = current.slice(0, from) + handle + current.slice(to);
      const caret = from + handle.length;
      setComposerText(next, caret);
      setForcedSelection({ start: caret, end: caret });
      if (userId !== 'assistant') {
        setTaggedIds((prev) => (prev.includes(userId) ? prev : [...prev, userId]));
      }
      setMentionQuery(null);
    },
    [setComposerText]
  );

  /** Only keep tags whose `@name` still appears in the body when we send. */
  const resolveMentions = useCallback(
    (body: string): string[] => {
      return taggedIds.filter((id) => {
        const m = members.find((mm) => mm.user_id === id);
        if (!m) return false;
        const label = m.display_name || m.email;
        return body.includes(`@${label}`);
      });
    },
    [taggedIds, members]
  );

  // ---------- attachments (images + documents) ----------

  const [showDrivePicker, setShowDrivePicker] = useState(false);

  /**
   * Shared upload pipeline for any local file (camera/library image, a document
   * from the Files app, or a file downloaded from Google Drive). Reserves an R2
   * key, streams the bytes up, and tracks progress in the pending tray.
   */
  const uploadLocalFile = useCallback(
    async (file: {
      uri: string;
      name: string;
      mimeType: string;
      kind: 'image' | 'file';
      width?: number;
      height?: number;
    }) => {
      if (!householdId) return;
      const localId = `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      setPendingImages((prev) => [
        ...prev,
        {
          id: localId,
          uri: file.uri,
          mimeType: file.mimeType,
          kind: file.kind,
          name: file.name,
          width: file.width,
          height: file.height,
          status: 'uploading',
          progress: 0,
        },
      ]);
      try {
        const created = await api.getImageUploadUrl(householdId, roomId, {
          filename: file.name,
          content_type: file.mimeType,
        });
        const base64 = await FileSystem.readAsStringAsync(file.uri, { encoding: 'base64' });
        const bytes = base64ToArrayBuffer(base64);
        if (bytes.byteLength === 0) throw new Error('read 0 bytes');
        await api.uploadImageBytes(created.upload_url, bytes, file.mimeType, (p) =>
          setPendingImages((prev) =>
            prev.map((i) => (i.id === localId ? { ...i, progress: p } : i))
          )
        );
        setPendingImages((prev) =>
          prev.map((i) =>
            i.id === localId ? { ...i, status: 'ready', progress: 1, key: created.image_key } : i
          )
        );
      } catch (err) {
        console.warn('[chat] attachment upload failed', err);
        setPendingImages((prev) =>
          prev.map((i) => (i.id === localId ? { ...i, status: 'failed' } : i))
        );
      }
    },
    [api, householdId, roomId]
  );

  const pickImage = useCallback(
    async (source: 'camera' | 'library') => {
      try {
        if (source === 'camera') {
          const perm = await ImagePicker.requestCameraPermissionsAsync();
          if (perm.status !== 'granted') {
            Alert.alert('Camera permission needed', 'Enable camera access in Settings.');
            return;
          }
          const result = await ImagePicker.launchCameraAsync({ quality: 0.8, exif: false });
          if (result.canceled || !result.assets[0]) return;
          const asset = result.assets[0];
          const safe = await toVisionSafeAttachment({
            uri: asset.uri,
            name: asset.fileName ?? `photo_${Date.now()}.jpg`,
            type: asset.mimeType ?? 'image/jpeg',
          });
          await uploadLocalFile({
            uri: safe.uri,
            name: safe.name,
            mimeType: safe.type,
            kind: 'image',
            width: asset.width,
            height: asset.height,
          });
        } else {
          const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (perm.status !== 'granted') {
            Alert.alert('Photo permission needed', 'Enable photo access in Settings.');
            return;
          }
          const result = await ImagePicker.launchImageLibraryAsync({
            quality: 0.8,
            exif: false,
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
          });
          if (result.canceled || !result.assets[0]) return;
          const asset = result.assets[0];
          const safe = await toVisionSafeAttachment({
            uri: asset.uri,
            name: asset.fileName ?? `photo_${Date.now()}.jpg`,
            type: asset.mimeType ?? 'image/jpeg',
          });
          await uploadLocalFile({
            uri: safe.uri,
            name: safe.name,
            mimeType: safe.type,
            kind: 'image',
            width: asset.width,
            height: asset.height,
          });
        }
      } catch (err) {
        Alert.alert('Could not add photo', getApiErrorMessage(err, 'Unknown error'));
      }
    },
    [uploadLocalFile]
  );

  /** "File from iPhone" — the system document picker (Files app, iCloud Drive, etc.). */
  const pickDocument = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const mimeType = asset.mimeType ?? guessMimeFromName(asset.name ?? '');
      await uploadLocalFile({
        uri: asset.uri,
        name: asset.name ?? `file_${Date.now()}`,
        mimeType,
        kind: isImageMime(mimeType) ? 'image' : 'file',
      });
    } catch (err) {
      Alert.alert('Could not add file', getApiErrorMessage(err, 'Unknown error'));
    }
  }, [uploadLocalFile]);

  /** "Google Drive" — a file the user selected in the CloudFilePicker (downloaded to a local uri). */
  const handleDriveFileSelected = useCallback(
    (file: { uri: string; name: string; size: number }) => {
      setShowDrivePicker(false);
      const mimeType = guessMimeFromName(file.name);
      void uploadLocalFile({
        uri: file.uri,
        name: file.name,
        mimeType,
        kind: isImageMime(mimeType) ? 'image' : 'file',
      });
    },
    [uploadLocalFile]
  );

  const openAttachMenu = useCallback(() => {
    const options = ['Take Photo', 'Photo Library', 'File from iPhone', 'Google Drive', 'Cancel'];
    const handle = (idx: number) => {
      if (idx === 0) void pickImage('camera');
      else if (idx === 1) void pickImage('library');
      else if (idx === 2) void pickDocument();
      else if (idx === 3) setShowDrivePicker(true);
    };
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions({ options, cancelButtonIndex: 4 }, handle);
    } else {
      Alert.alert('Add attachment', undefined, [
        { text: options[0], onPress: () => handle(0) },
        { text: options[1], onPress: () => handle(1) },
        { text: options[2], onPress: () => handle(2) },
        { text: options[3], onPress: () => handle(3) },
        { text: options[4], style: 'cancel' },
      ]);
    }
  }, [pickImage, pickDocument]);

  const removePendingImage = useCallback((id: string) => {
    setPendingImages((prev) => prev.filter((i) => i.id !== id));
  }, []);

  // ---------- send / edit ----------

  const resetComposer = useCallback(() => {
    setComposerText('');
    setPendingImages([]);
    setTaggedIds([]);
    setEditing(null);
    setReplyingTo(null);
    setMentionQuery(null);
  }, [setComposerText]);

  const handleSend = async () => {
    const typed = inputText.trim();
    // With "always ask the assistant" on, the sent body carries the handle even
    // though the member never typed it — the Worker decides whether to answer
    // from the stored text, so the mention has to be IN it.
    const body = applyAssistantDefault(
      typed,
      pendingImages.some((i) => i.status === 'ready' && i.key)
    );
    if (!householdId || isSending) return;

    // Edit path — text and/or images may have changed. Reuse the same
    // upload-state guards as sending so a still-uploading or failed photo can't
    // be silently dropped from the edit.
    if (editing) {
      if (pendingImages.some((i) => i.status === 'uploading')) return;
      if (pendingImages.some((i) => i.status === 'failed')) {
        Alert.alert(
          'Photo not uploaded',
          'A photo failed to upload. Remove it or try adding it again before saving.'
        );
        return;
      }
      const editReady = pendingImages.filter((i) => i.status === 'ready' && i.key);
      if (!body && editReady.length === 0) return;
      // Send the FULL desired image set so the server drops any the user removed.
      const editAttachments: OutgoingAttachment[] = editReady.map((i) => ({
        key: i.key as string,
        mimeType: i.mimeType,
        name: i.name,
        width: i.width,
        height: i.height,
      }));
      setIsSending(true);
      try {
        const updated = await api.editMessage(householdId, roomId, editing.id, {
          body: body || undefined,
          attachments: editAttachments,
        });
        updateMessage(roomId, updated);
        resetComposer();
      } catch (err) {
        Alert.alert('Could not save edit', getApiErrorMessage(err, 'Please try again.'));
      } finally {
        setIsSending(false);
      }
      return;
    }

    const readyImages = pendingImages.filter((i) => i.status === 'ready' && i.key);
    const stillUploading = pendingImages.some((i) => i.status === 'uploading');
    if (stillUploading) return; // wait for uploads to finish
    // Don't silently drop a photo that failed to upload — the user thinks it's
    // attached (e.g. a receipt for "add to my spendings") and would send text-only.
    const failedImages = pendingImages.filter((i) => i.status === 'failed');
    if (failedImages.length > 0) {
      Alert.alert(
        'Photo not uploaded',
        'A photo failed to upload. Remove it or try adding it again before sending.'
      );
      return;
    }
    if (!body && readyImages.length === 0) return;

    const attachments: OutgoingAttachment[] = readyImages.map((i) => ({
      key: i.key as string,
      mimeType: i.mimeType,
      name: i.name,
      width: i.width,
      height: i.height,
    }));
    const mentions = resolveMentions(body);
    const replyToId = replyingTo?.id;

    resetComposer();
    setIsSending(true);
    try {
      const message = await api.sendMessage(householdId, roomId, {
        body: body || undefined,
        attachments: attachments.length > 0 ? attachments : undefined,
        mentions: mentions.length > 0 ? mentions : undefined,
        reply_to_id: replyToId,
      });
      appendMessage(roomId, message);
    } catch (err) {
      // Restore what the member actually typed (not the assistant prefix we
      // added for them) so a retry doesn't stack a second handle.
      setComposerText(typed);
      Alert.alert('Message not sent', getApiErrorMessage(err, 'Please try again.'));
    } finally {
      setIsSending(false);
    }
  };

  const beginEdit = useCallback((message: ChatMessage) => {
    setEditing({ id: message.id, original: message.body });
    setComposerText(message.body);
    // Seed the tray with the message's existing images so they can be kept or
    // removed. They're already uploaded, so mark them `ready` with their R2 key
    // and use the remote URL as the thumbnail source.
    setPendingImages(
      (message.attachments ?? []).map((a) => ({
        id: a.key,
        uri: a.url,
        mimeType: a.mimeType ?? 'image/jpeg',
        kind: isImageMime(a.mimeType) ? 'image' : 'file',
        name: a.name,
        width: a.width,
        height: a.height,
        status: 'ready' as const,
        progress: 1,
        key: a.key,
      }))
    );
  }, [setComposerText]);

  /** Start replying to a message — shows the quoted banner and focuses input. */
  const startReply = useCallback((message: ChatMessage) => {
    const senderName = message.sender_type === 'ai' ? 'Assistant' : message.sender_name || 'Member';
    let preview = message.body.trim();
    if (!preview && (message.attachments?.length ?? 0) > 0) {
      const count = message.attachments!.length;
      preview = count === 1 ? '📷 Photo' : `📷 ${count} photos`;
    }
    setReplyingTo({ id: message.id, senderName, preview });
    inputRef.current?.focus();
  }, []);

  /**
   * Save a received image to the device. Downloads it to a cache file, then
   * hands it to the iOS share sheet — which offers both "Save Image" (Photos)
   * and "Save to Files" — so no extra media-library permission is needed.
   */
  const saveImage = useCallback(async (url: string, name?: string) => {
    try {
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('Saving not available', 'This device can’t save images.');
        return;
      }
      const ext = (name?.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const target = `${FileSystem.cacheDirectory}chat-image-${Date.now()}.${ext}`;
      const { uri } = await FileSystem.downloadAsync(url, target);
      await Sharing.shareAsync(uri, {
        mimeType: 'image/jpeg',
        UTI: 'public.image',
        dialogTitle: 'Save image',
      });
    } catch (err) {
      Alert.alert('Could not save image', getApiErrorMessage(err, 'Please try again.'));
    }
  }, []);

  const confirmDelete = useCallback(
    (message: ChatMessage) => {
      if (!householdId) return;
      Alert.alert('Delete message?', 'This can’t be undone.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            api
              .deleteMessage(householdId, roomId, message.id)
              .then((deleted) => updateMessage(roomId, deleted))
              .catch((err) =>
                Alert.alert('Could not delete', getApiErrorMessage(err, 'Please try again.'))
              );
          },
        },
      ]);
    },
    [api, householdId, roomId, updateMessage]
  );

  const onLongPressMessage = useCallback(
    (message: ChatMessage) => {
      if (message.deleted_at) return;
      const isMine = message.sender_type === 'user' && message.sender_user_id === currentUserId;
      const canEdit = isMine && !!message.body;
      const canDelete = isMine || isOwner;
      const firstImage = (message.attachments ?? []).find((a) => isImageMime(a.mimeType));

      // Build the menu dynamically: everyone can Reply / Save Image; only the
      // author edits; author or owner deletes.
      const actions: { label: string; destructive?: boolean; run: () => void }[] = [
        { label: 'Reply', run: () => startReply(message) },
      ];
      if (firstImage) {
        actions.push({ label: 'Save Image', run: () => void saveImage(firstImage.url, firstImage.name) });
      }
      if (canEdit) actions.push({ label: 'Edit', run: () => beginEdit(message) });
      if (canDelete) actions.push({ label: 'Delete', destructive: true, run: () => confirmDelete(message) });

      const destructiveIndex = actions.findIndex((a) => a.destructive);
      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: [...actions.map((a) => a.label), 'Cancel'],
            cancelButtonIndex: actions.length,
            destructiveButtonIndex: destructiveIndex >= 0 ? destructiveIndex : undefined,
          },
          (idx) => actions[idx]?.run()
        );
      } else {
        Alert.alert('Message', undefined, [
          ...actions.map((a) => ({
            text: a.label,
            style: a.destructive ? ('destructive' as const) : ('default' as const),
            onPress: a.run,
          })),
          { text: 'Cancel', style: 'cancel' as const },
        ]);
      }
    },
    [currentUserId, isOwner, beginEdit, confirmDelete, startReply, saveImage]
  );

  // ---------- render ----------

  /**
   * Highlight any `@Member` handles in a message body. `mentionColor` must
   * contrast with the bubble — my own bubbles are `primary`, so a primary
   * mention would be invisible there; the caller passes white for those.
   */
  const renderBody = useCallback(
    (body: string, textColor: string, mentionColor: string) => {
      const handles = members
        .map((m) => `@${m.display_name || m.email}`)
        .concat(ASSISTANT_HANDLE)
        .sort((a, b) => b.length - a.length); // longest first so names beat prefixes
      if (handles.length === 0) return <Typography variant="body" color={textColor}>{body}</Typography>;

      const escaped = handles.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      const re = new RegExp(`(${escaped.join('|')})`, 'g');
      const parts = body.split(re);
      return (
        <Typography variant="body" color={textColor}>
          {parts.map((part, i) =>
            handles.includes(part) ? (
              <Typography
                key={i}
                variant="body"
                weight="semibold"
                color={mentionColor}
                style={styles.mention}
              >
                {part}
              </Typography>
            ) : (
              part
            )
          )}
        </Typography>
      );
    },
    [members]
  );

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    const isMine = item.sender_type === 'user' && item.sender_user_id === currentUserId;
    const isAI = item.sender_type === 'ai';
    const isSystem = item.sender_type === 'system';
    const isDeleted = !!item.deleted_at;

    if (isSystem) {
      return (
        <View style={styles.systemRow}>
          <Typography variant="caption1" color={colors.textSecondary}>
            {item.body}
          </Typography>
        </View>
      );
    }

    const bubbleColor = isMine ? colors.primary : colors.backgroundSecondary;
    const textColor = isMine ? colors.white : colors.textPrimary;
    const metaColor = isMine ? colors.white : colors.textSecondary;
    const attachments = item.attachments ?? [];
    const time = formatMessageTime(item.created_at);
    // Rich UI (charts / stat cards) the assistant attached to this reply.
    const uiBlocks = isAI && !isDeleted ? chatMessageUiBlocks(item) : [];
    const receiptDraft =
      isAI && !isDeleted && config.id === 'budget' ? chatMessageReceiptDraft(item) : null;
    // Project writes carried on this reply — what the assistant changed, or is
    // asking to. Absent on every ordinary message.
    const actionEntry = isAI && !isDeleted ? messageActions[item.id] : undefined;

    // Incoming messages show the speaker's avatar to the left of the bubble;
    // the AI uses the brushed brand icon, members use their initials avatar.
    const avatar = isAI ? (
      <View
        testID="chat-assistant-avatar"
        style={[styles.aiAvatar, { backgroundColor: colors.card }]}
      >
        <Icon name={ASSISTANT_ICON} active size={22} accessibilityLabel="Assistant" />
      </View>
    ) : (
      <Avatar user={{ display_name: item.sender_name }} size={32} />
    );

    return (
      <View style={[styles.messageRow, isMine ? styles.rowMine : styles.rowTheirs]}>
        {!isMine && <View style={styles.avatarSlot}>{avatar}</View>}
        <Pressable
          // `mine` / `theirs` in the id (not just the body text) is what lets an
          // E2E run prove CROSS-MEMBER delivery: a second household member's
          // device must render the first member's message as an INCOMING bubble,
          // which a body-text assertion alone can't distinguish from an echo of
          // one's own send. Maestro matches ids by regex → `chat-msg-theirs-.*`.
          testID={`chat-msg-${isMine ? 'mine' : 'theirs'}-${item.id}`}
          onLongPress={() => onLongPressMessage(item)}
          delayLongPress={300}
          style={[
            styles.messageContainer,
            isMine ? styles.mineContainer : styles.theirsContainer,
            // Charts/cards need room, so widen bubbles that carry rich UI.
            uiBlocks.length > 0 && styles.uiContainer,
          ]}
        >
          {!isMine && (
            <Typography variant="caption1" color={colors.textSecondary} style={styles.senderName}>
              {isAI ? 'Assistant' : item.sender_name || 'Member'}
            </Typography>
          )}
          <Card
            variant="filled"
            style={[
              styles.messageBubble,
              {
                backgroundColor: isDeleted ? colors.backgroundSecondary : bubbleColor,
                borderTopLeftRadius: isMine ? ChatTokens.bubbleRadius : ChatTokens.bubbleTailRadius,
                borderTopRightRadius: isMine ? ChatTokens.bubbleTailRadius : ChatTokens.bubbleRadius,
              },
            ]}
          >
            {isDeleted ? (
              <Typography variant="body" color={colors.textSecondary} style={styles.deletedText}>
                This message was deleted
              </Typography>
            ) : (
              <>
                {/* Quoted message this one replies to */}
                {item.reply_to && (
                  <View
                    style={[
                      styles.replyQuote,
                      {
                        borderLeftColor: isMine ? colors.white : colors.primary,
                        backgroundColor: isMine ? colors.mediaOverlayScrim : colors.card,
                      },
                    ]}
                  >
                    <Typography
                      variant="caption2"
                      weight="semibold"
                      color={isMine ? colors.white : colors.primary}
                      numberOfLines={1}
                    >
                      {item.reply_to.sender_name || 'Member'}
                    </Typography>
                    <Typography
                      variant="caption1"
                      color={isMine ? colors.white : colors.textSecondary}
                      numberOfLines={2}
                    >
                      {item.reply_to.preview || 'Message'}
                    </Typography>
                  </View>
                )}
                {attachments.length > 0 && (
                  <View style={styles.attachmentGrid}>
                    {attachments.map((a) =>
                      isImageMime(a.mimeType) ? (
                        <Pressable
                          key={a.key}
                          onPress={() => void saveImage(a.url, a.name)}
                          accessibilityLabel="Save image"
                        >
                          <ExpoImage
                            source={{ uri: a.url }}
                            style={styles.attachmentImage}
                            contentFit="cover"
                            transition={150}
                          />
                        </Pressable>
                      ) : (
                        <Pressable
                          key={a.key}
                          onPress={() => void Linking.openURL(a.url)}
                          style={[
                            styles.docAttachment,
                            { backgroundColor: isMine ? colors.mediaOverlayScrim : colors.card },
                          ]}
                        >
                          <Icon
                            name="document-text-outline"
                            size={22}
                            color={isMine ? colors.white : colors.primary}
                          />
                          <Typography
                            variant="footnote"
                            color={isMine ? colors.white : colors.textPrimary}
                            numberOfLines={1}
                            style={styles.docAttachmentLabel}
                          >
                            {a.name || 'Document'}
                          </Typography>
                        </Pressable>
                      )
                    )}
                  </View>
                )}
                {!!item.body && renderBody(item.body, textColor, isMine ? colors.white : colors.primary)}
                {uiBlocks.length > 0 && <ChatMessageUi blocks={uiBlocks} />}
                {actionEntry && (
                  <ChatActionCard
                    entry={actionEntry}
                    onConfirm={() => confirmActions(item.id)}
                    onDecline={() => declineActions(item.id)}
                  />
                )}
                {receiptDraft && (
                  <Pressable
                    onPress={() => openBudgetReceiptConfirm(receiptDraft)}
                    style={[
                      styles.receiptReviewBtn,
                      { backgroundColor: colors.primary },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Review and confirm receipt items"
                    testID="chat-receipt-review"
                  >
                    <Typography variant="footnote" weight="semibold" color={colors.white}>
                      Review & confirm items
                    </Typography>
                  </Pressable>
                )}
              </>
            )}
            {/* Time (+ edited) footer — shown on every bubble */}
            <View style={styles.metaRow}>
              {!isDeleted && item.edited_at && (
                <Typography variant="caption2" color={metaColor} style={styles.metaEdited}>
                  edited
                </Typography>
              )}
              {!!time && (
                <Typography variant="caption2" color={metaColor} style={styles.metaTime}>
                  {time}
                </Typography>
              )}
            </View>
          </Card>
        </Pressable>
      </View>
    );
  };

  const readyImageCount = pendingImages.filter((i) => i.status === 'ready').length;
  // Editing follows the same rule as sending: text OR at least one ready image,
  // and never while an upload is in flight (so a kept/added photo isn't dropped).
  const canSend =
    (inputText.trim().length > 0 || readyImageCount > 0) &&
    !pendingImages.some((i) => i.status === 'uploading');

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container} testID="chat-room-screen">
        <ScreenHeader
          title={displayName}
          showBackButton
          onBackPress={() => navigation.goBack()}
          showNotificationBell={false}
          showAvatar={false}
          showPropertySwitcher={false}
          rightElement={
            <HeaderActionButton
              iconOnly
              onPress={() =>
                navigation.navigate('ChatRoomSettings', {
                  roomId,
                  roomName: displayName,
                  canManage: isOwner,
                })
              }
              testID="chat-room-settings"
              accessibilityLabel="Room settings"
            >
              <Icon name="cog-outline" size={Header.actionIconSize} color={colors.primary} />
            </HeaderActionButton>
          }
        />

        {subject && (
          <Pressable
            testID="chat-room-subject-banner"
            disabled={!subjectHref}
            onPress={() => subjectHref && router.push(subjectHref as never)}
            accessibilityRole={subjectHref ? 'button' : 'text'}
            accessibilityLabel={
              subject.parent_label
                ? `Material in ${subject.parent_label}`
                : `Project chat for ${subject.label}`
            }
            style={[
              styles.subjectBanner,
              { backgroundColor: colors.backgroundSecondary, borderBottomColor: colors.divider },
            ]}
          >
            <Icon
              name={subject.parent_label ? 'cube-outline' : 'construct-outline'}
              size={14}
              color={colors.primary}
            />
            <Typography
              variant="caption1"
              color={colors.textSecondary}
              numberOfLines={1}
              style={styles.subjectBannerText}
            >
              {subject.parent_label
                ? `Material in ${subject.parent_label}`
                : 'Project chat — everything about this project'}
            </Typography>
            {!!subjectHref && (
              <Icon name="chevron-forward" size={14} color={colors.textSecondary} />
            )}
          </Pressable>
        )}

        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={0}
        >
          {isLoading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : (
            <FlatList
              ref={flatListRef}
              data={messages}
              renderItem={renderMessage}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.messagesList}
              showsVerticalScrollIndicator={false}
              // The composer is pinned outside this list, so the KeyboardAvoidingView
              // above is the right tool for occlusion — but the list still needs
              // "handled" so a tap on empty transcript dismisses the keyboard and a
              // tap on a message action fires on the first tap, not the second.
              keyboardShouldPersistTaps="handled"
              onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
              onLayout={() => flatListRef.current?.scrollToEnd({ animated: false })}
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Typography variant="body" color={colors.textSecondary} style={styles.emptyText}>
                    {isAssistantRoom
                      ? 'Ask me anything, or share a receipt photo and I’ll help — every message goes straight to the assistant.'
                      : subject
                        ? `No messages yet. This chat is about ${subject.label}${
                            subject.parent_label ? ` in ${subject.parent_label}` : ''
                          } — tag a member with @${aiAvailable ? ', or type @ai to ask the AI.' : '.'}`
                        : `No messages yet. Say hello, tag a member with @, or share a photo${
                            aiAvailable ? ' — type @ai to ask the AI.' : '.'
                          }`}
                  </Typography>
                </View>
              }
            />
          )}

          {isPeerTyping && (
            <View style={styles.typingRow} testID="chat-room-typing">
              {typingActor === 'ai' && (
                <View style={[styles.typingAvatar, { backgroundColor: colors.card }]}>
                  <Icon name={ASSISTANT_ICON} active size={14} />
                </View>
              )}
              <Typography variant="caption1" color={colors.textSecondary}>
                {typingLabel}
              </Typography>
            </View>
          )}

          {/* @mention suggestions */}
          {mentionMatches.length > 0 && (
            <View
              testID="chat-room-mention-bar"
              style={[styles.mentionBar, { backgroundColor: colors.backgroundSecondary, borderTopColor: colors.divider }]}
            >
              {mentionMatches.map((m) => (
                <Pressable
                  key={m.user_id}
                  style={styles.mentionRow}
                  onPress={() =>
                    insertMention(
                      m.user_id,
                      m.user_id === 'assistant' ? 'assistant' : m.display_name || m.email,
                    )
                  }
                  testID={`mention-${m.user_id}`}
                >
                  {/* The assistant is not a household member with initials —
                      give the suggestion row the same face as its bubbles. */}
                  {m.user_id === 'assistant' ? (
                    <View style={[styles.aiAvatar, { backgroundColor: colors.card }]}>
                      <Icon name={ASSISTANT_ICON} active size={22} accessibilityLabel="Assistant" />
                    </View>
                  ) : (
                    <Avatar user={m} size="sm" />
                  )}
                  <Typography variant="callout" color={colors.textPrimary} style={styles.mentionName}>
                    {m.display_name || m.email}
                  </Typography>
                  {m.role === 'owner' && (
                    <Typography variant="caption2" color={colors.textSecondary}>
                      Owner
                    </Typography>
                  )}
                </Pressable>
              ))}
            </View>
          )}

          {/* Reply banner — the quoted message the composer will reply to */}
          {replyingTo && !editing && (
            <View
              testID="chat-room-reply-bar"
              style={[
                styles.replyBar,
                { backgroundColor: colors.backgroundSecondary, borderLeftColor: colors.primary },
              ]}
            >
              <Icon name="arrow-undo-outline" size={16} color={colors.primary} />
              <View style={styles.replyBarText}>
                <Typography variant="caption2" weight="semibold" color={colors.primary} numberOfLines={1}>
                  Replying to {replyingTo.senderName}
                </Typography>
                {!!replyingTo.preview && (
                  <Typography variant="caption1" color={colors.textSecondary} numberOfLines={1}>
                    {replyingTo.preview}
                  </Typography>
                )}
              </View>
              <Pressable onPress={() => setReplyingTo(null)} hitSlop={8} testID="chat-room-reply-cancel">
                <Icon name="close" size={18} color={colors.textSecondary} />
              </Pressable>
            </View>
          )}

          {/* Editing banner */}
          {editing && (
            <View style={[styles.editingBar, { backgroundColor: colors.backgroundSecondary }]}>
              <Icon name="pencil" size={16} color={colors.textSecondary} />
              <Typography variant="caption1" color={colors.textSecondary} style={styles.editingText}>
                Editing message
              </Typography>
              <Pressable onPress={resetComposer} hitSlop={8}>
                <Typography variant="caption1" weight="semibold" color={colors.primary}>
                  Cancel
                </Typography>
              </Pressable>
            </View>
          )}

          {/* Pending image tray */}
          {pendingImages.length > 0 && (
            <View style={[styles.imageTray, { borderTopColor: colors.divider }]}>
              {pendingImages.map((img) => (
                <View key={img.id} style={styles.imageChip}>
                  {img.kind === 'image' ? (
                    <ExpoImage source={{ uri: img.uri }} style={styles.imageChipThumb} contentFit="cover" />
                  ) : (
                    <View
                      style={[
                        styles.imageChipThumb,
                        styles.docChipThumb,
                        { backgroundColor: colors.card },
                      ]}
                    >
                      <Icon name="document-text-outline" size={20} color={colors.primary} />
                      <Typography
                        variant="caption2"
                        color={colors.textSecondary}
                        numberOfLines={1}
                        style={styles.docChipLabel}
                      >
                        {img.name || 'File'}
                      </Typography>
                    </View>
                  )}
                  {img.status === 'uploading' && (
                    <View style={[styles.imageChipOverlay, { backgroundColor: colors.mediaOverlayScrim }]}>
                      <ActivityIndicator size="small" color={colors.white} />
                    </View>
                  )}
                  {img.status === 'failed' && (
                    <View style={[styles.imageChipOverlay, { backgroundColor: colors.mediaOverlayScrim }]}>
                      <Icon name="alert-circle" size={18} color={colors.white} />
                    </View>
                  )}
                  <Pressable
                    onPress={() => removePendingImage(img.id)}
                    hitSlop={8}
                    style={[styles.imageChipRemove, { backgroundColor: colors.mediaOverlayScrim }]}
                  >
                    <Icon name="close" size={12} color={colors.white} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          {/*
            Clear the floating tab bar when this room is inside a TAB.

            The capsule is `position: absolute; bottom: 0; zIndex: 9999`, so on
            the House chat tab it paints straight over this row: measured on a
            402x874 device the send button lands at y=[792,836] and the capsule
            occupies y=[770,830] — a tap on `chat-room-send` hits `tab-settings`
            and switches tab instead. `chat-room-input` and `chat-room-attach`
            are occluded the same way, so the composer could not even be
            focused. Budget's chat is a `fab` presentation on a root route with
            no capsule over it, which is why only the tab presentation is
            affected and why this went unnoticed.

            `Layout.bottomTabBarClearance` is the token the capsule's own height
            is expressed in, so this tracks it rather than restating 116.
          */}
          <View
            style={[
              styles.inputContainer,
              {
                borderTopColor: colors.divider,
                paddingBottom:
                  config.presentation === 'tab'
                    ? Layout.bottomTabBarClearance
                    : Math.max(insets.bottom, Spacing.sm),
              },
            ]}
          >
            <Pressable
              onPress={openAttachMenu}
              hitSlop={6}
              testID="chat-room-attach"
              style={[styles.attachButton, { backgroundColor: colors.backgroundSecondary }]}
              accessibilityLabel="Add an attachment"
            >
              <Icon name="plus" size={22} color={colors.primary} />
            </Pressable>
            {/*
              "Always ask the assistant" — the alternative to typing @assistant
              on every line. Hidden where it would be meaningless: rooms without
              AI, accounts without AI access, and the dedicated assistant room
              (which answers everything already).
            */}
            {aiAvailable && !isAssistantRoom && (
              <Pressable
                onPress={toggleAlwaysAskAssistant}
                hitSlop={6}
                testID="chat-room-assistant-toggle"
                accessibilityRole="switch"
                accessibilityState={{ checked: alwaysAskAssistant }}
                accessibilityLabel="Always ask the assistant"
                accessibilityHint="Sends every message in this chat to the assistant without typing @assistant"
                style={[
                  styles.attachButton,
                  {
                    backgroundColor: alwaysAskAssistant
                      ? colors.primary
                      : colors.backgroundSecondary,
                  },
                ]}
              >
                <Icon
                  name={alwaysAskAssistant ? 'sparkles' : 'sparkles-outline'}
                  size={20}
                  color={alwaysAskAssistant ? colors.white : colors.textSecondary}
                />
              </Pressable>
            )}
            <TextInput
              ref={inputRef}
              style={[
                styles.input,
                {
                  backgroundColor: colors.backgroundSecondary,
                  color: colors.textPrimary,
                  borderColor: colors.divider,
                },
              ]}
              placeholder={
                editing
                  ? 'Edit message…'
                  : isAssistantRoom || (alwaysAskAssistant && aiAvailable)
                    ? 'Ask the assistant…'
                    : 'Message… (@ to tag)'
              }
              placeholderTextColor={colors.textTertiary}
              value={inputText}
              selection={forcedSelection ?? undefined}
              onSelectionChange={(e) => {
                caretRef.current = e.nativeEvent.selection.start;
                // Hand the caret back to the field now that it has taken ours.
                setForcedSelection((prev) => (prev ? null : prev));
              }}
              onChangeText={onChangeInput}
              onFocus={() => {
                if (!__DEV__) return;
                const token = mentionTokenAt(inputText, caretRef.current);
                if (token) setMentionQuery(token.query);
              }}
              multiline
              maxLength={4000}
              testID="chat-room-input"
            />
            <Pressable
              style={[
                styles.sendButton,
                {
                  backgroundColor:
                    canSend && !isSending ? colors.primary : colors.backgroundSecondary,
                },
              ]}
              onPress={handleSend}
              disabled={!canSend || isSending}
              testID="chat-room-send"
            >
              <Typography
                variant="callout"
                weight="semibold"
                color={canSend && !isSending ? colors.white : colors.textSecondary}
              >
                {editing ? 'Save' : 'Send'}
              </Typography>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </View>

      <CloudFilePicker
        visible={showDrivePicker}
        provider="google-drive"
        allowAllFileTypes
        rememberScope={config.rememberScope}
        onClose={() => setShowDrivePicker(false)}
        onFileSelected={handleDriveFileSelected}
      />
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  messagesList: {
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
    flexGrow: 1,
    gap: ChatTokens.bubbleRowSpacing,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.xs,
  },
  rowMine: {
    justifyContent: 'flex-end',
  },
  rowTheirs: {
    justifyContent: 'flex-start',
  },
  avatarSlot: {
    marginBottom: Spacing.base,
  },
  aiAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageContainer: {
    maxWidth: `${ChatTokens.bubbleMaxWidthRatio * 100}%` as `${number}%`,
    flexShrink: 1,
  },
  // Wider cap for assistant bubbles that carry a chart / stat cards.
  uiContainer: {
    maxWidth: '92%',
    width: '92%',
  },
  mineContainer: {
    alignSelf: 'flex-end',
  },
  theirsContainer: {
    alignSelf: 'flex-start',
  },
  senderName: {
    marginBottom: Spacing.xxs,
    marginLeft: Spacing.xs,
  },
  messageBubble: {
    paddingHorizontal: ChatTokens.bubblePaddingHorizontal,
    paddingVertical: ChatTokens.bubblePaddingVertical,
    borderRadius: ChatTokens.bubbleRadius,
  },
  deletedText: {
    fontStyle: 'italic',
  },
  mention: {
    textDecorationLine: 'underline',
  },
  replyQuote: {
    borderLeftWidth: 3,
    borderRadius: CornerRadius.sm,
    paddingVertical: Spacing.xxs,
    paddingHorizontal: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: Spacing.xxs,
    marginTop: Spacing.xxs,
  },
  metaEdited: {
    opacity: 0.7,
  },
  metaTime: {
    opacity: 0.7,
  },
  attachmentGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xxs,
    marginBottom: Spacing.xs,
  },
  receiptReviewBtn: {
    marginTop: Spacing.sm,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: CornerRadius.md,
  },
  attachmentImage: {
    width: 200,
    height: 200,
    borderRadius: CornerRadius.md,
    maxWidth: '100%',
  },
  docAttachment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    borderRadius: CornerRadius.md,
    maxWidth: 220,
  },
  docAttachmentLabel: {
    flexShrink: 1,
  },
  docChipThumb: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  docChipLabel: {
    marginTop: 2,
    maxWidth: 56,
    textAlign: 'center',
  },
  systemRow: {
    alignItems: 'center',
    marginVertical: Spacing.sm,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingTop: EmptyStateTokens.blockPaddingVertical,
  },
  emptyText: {
    textAlign: 'center',
  },
  typingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xs,
  },
  typingAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subjectBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  subjectBannerText: {
    flex: 1,
  },
  mentionBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.xxs,
  },
  mentionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.xs,
  },
  mentionName: {
    flex: 1,
  },
  editingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.xs,
  },
  editingText: {
    flex: 1,
  },
  replyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.xs,
    borderLeftWidth: 3,
  },
  replyBarText: {
    flex: 1,
  },
  imageTray: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  imageChip: {
    width: 64,
    height: 64,
    borderRadius: CornerRadius.md,
    overflow: 'hidden',
  },
  imageChipThumb: {
    width: '100%',
    height: '100%',
  },
  imageChipOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageChipRemove: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputContainer: {
    flexDirection: 'row',
    paddingHorizontal: ChatTokens.inputRowPadding,
    paddingTop: ChatTokens.inputRowPadding,
    borderTopWidth: StyleSheet.hairlineWidth,
    alignItems: 'flex-end',
    gap: ChatTokens.inputRowGap,
  },
  attachButton: {
    width: ChatTokens.inputMinHeight,
    height: ChatTokens.inputMinHeight,
    borderRadius: CornerRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xxs,
  },
  input: {
    flex: 1,
    minHeight: ChatTokens.inputMinHeight,
    maxHeight: ChatTokens.inputMaxHeight,
    borderRadius: CornerRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.smd,
    ...scaledFont('body'),
  },
  sendButton: {
    minWidth: ChatTokens.sendButtonMinWidth,
    minHeight: ChatTokens.inputMinHeight,
    borderRadius: CornerRadius.xl,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.base,
    marginBottom: Spacing.xxs,
  },
});

export default ChatRoomScreen;
