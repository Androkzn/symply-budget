import { create } from 'zustand';

export type JoinRequestOutcome = {
  householdId: string;
  status: 'approved' | 'denied';
};

/**
 * Holds a pending shareable-invite token captured from a deep link
 * (`simplehouse://join/<token>`, `simplehouse://j/<code>`, or the matching
 * https universal-link paths).
 *
 * The app's navigation tree is split: unauthenticated users render the
 * React-Navigation `RootNavigator` while authenticated users render the
 * expo-router `<Slot />`. A cold-start invite link therefore can't always be
 * routed immediately — when the tapper isn't signed in yet, the `/join/<token>`
 * route simply isn't mounted. We stash the token here so that, once the user
 * finishes signing in (same process, so in-memory state survives), the root
 * layout can forward them into the Join screen.
 */
interface InviteState {
  pendingJoinToken: string | null;
  /** Set when push/in-app notifies the requester their join request was handled. */
  joinRequestOutcome: JoinRequestOutcome | null;
  setPendingJoinToken: (token: string) => void;
  clearPendingJoinToken: () => void;
  setJoinRequestOutcome: (outcome: JoinRequestOutcome) => void;
  clearJoinRequestOutcome: () => void;
}

export const useInviteStore = create<InviteState>((set) => ({
  pendingJoinToken: null,
  joinRequestOutcome: null,
  setPendingJoinToken: (token) => set({ pendingJoinToken: token }),
  clearPendingJoinToken: () => set({ pendingJoinToken: null }),
  setJoinRequestOutcome: (outcome) => set({ joinRequestOutcome: outcome }),
  clearJoinRequestOutcome: () => set({ joinRequestOutcome: null }),
}));

/**
 * Extract a join token from a deep link URL. Handles both the custom scheme
 * (`simplehouse://join/<token>`) and universal links (`https://…/join/<token>`
 * or `https://…/j/<code>`), with or without query/hash.
 * Returns null when the URL isn't a join link.
 */
export function parseJoinToken(url: string | null | undefined): string | null {
  if (!url) return null;
  // Matches the full-token form (`/join/<token>`) and the short-link form
  // (`/j/<code>`). The captured value is opaque — the backend resolves either a
  // token or a short code, so the client doesn't need to tell them apart.
  const match = url.match(/\/(?:join|j)\/([^/?#]+)/i);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/**
 * Decide whether a parsed invite token should be forwarded into the Join flow.
 *
 * `Linking.getInitialURL()` returns the URL that launched the app and keeps
 * returning it on every relaunch / re-mount, so a one-time invite tap would
 * otherwise be replayed forever — re-navigating to a link that has since been
 * consumed or expired and showing "Invite Unavailable" on every launch.
 *
 * - A warm `url` event (`fromInitialUrl: false`) is always a genuine, fresh user
 *   tap, so it is always honored.
 * - A cold-start initial URL (`fromInitialUrl: true`) is honored only the first
 *   time we see its token; `handledToken` is the last initial-URL token we
 *   already processed (persisted across launches).
 */
export function shouldForwardInviteToken(params: {
  token: string;
  handledToken: string | null | undefined;
  fromInitialUrl: boolean;
}): boolean {
  if (!params.fromInitialUrl) return true;
  return params.handledToken !== params.token;
}
