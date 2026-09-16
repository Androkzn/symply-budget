/**
 * A {@link ChatConfig} is everything that differs between one app's household
 * chat and another's. The shared screens/hooks/navigator read it (via
 * {@link useChatConfig}) instead of importing app-specific modules, so ONE chat
 * implementation serves every app. Colors are NOT here — they come from the
 * brand-aware theme (`useAppColors`) automatically, so only these plumbing knobs
 * differ per app.
 */
import type { E2EChatSocketChannel } from '@hooks/e2eChatSocketObservability';

import type { ChatApi } from './createChatApi';
import type { ChatStoreHook } from './createChatStore';
import type { ChatRoomSubject } from './types';

export interface ChatConfig {
  /** Stable id, e.g. `house` | `budget`. */
  id: string;
  /** REST + WS URL segment under `/households/:hid/`, e.g. `chat-rooms`. */
  routeSegment: string;
  /**
   * Observability brand label for socket logs, e.g. `house-chat`. A new app adds
   * its label to the {@link E2EChatSocketChannel} union in e2eChatSocketObservability.
   */
  socketLabel: E2EChatSocketChannel;
  /** CloudFilePicker remember-scope key, e.g. `chat`. */
  rememberScope: string;
  /**
   * How the rooms list is hosted: `tab` = a bottom-tab root (no back button);
   * `fab` = a pushed route opened from a floating button (shows a back button).
   */
  presentation: 'tab' | 'fab';
  /** The app's chat API client (bound to `routeSegment`). */
  api: ChatApi;
  /** The app's chat Zustand store hook (its own isolated instance). */
  store: ChatStoreHook;
  /** Notification namespace — matches this chat's pushes for unread + tap routing. */
  notif: { messageType: string; mentionType: string };
  /**
   * Where this chat is hosted + its routing sentinel. `host` is the expo-router
   * path the notification tap opens (`/chat` for a tab, `/budget-chat` for the
   * FAB route); `screen` matches the notification `data.screen` sentinel.
   */
  route: { host: string; screen: string };
  /**
   * Where the "about" banner on a subject-scoped room sends the member — the
   * project or material this conversation belongs to. An expo-router href, or
   * null when this app has nowhere to send them.
   *
   * A function on the config rather than a switch inside the room screen: the
   * shared chat module must not learn what a `home_project` is. It knows a room
   * has a subject; the app that owns that subject knows where it lives.
   */
  subjectHref?: (subject: ChatRoomSubject) => string | null;
}
