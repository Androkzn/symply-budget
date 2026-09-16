/**
 * "Chat about this" — the one hook every subject screen uses.
 *
 * A project hub and a material screen both need the same three things: the
 * unread count for their own conversation, a way to open it, and a way to make
 * sure the assistant knows what it is about. This packages all three so the two
 * screens agree on the behaviour instead of each growing its own version.
 *
 * ## Why opening is a network call and not just navigation
 *
 * The room may not exist yet. Rather than pre-creating a chat for every project
 * and every material a household ever adds — thousands of empty rooms, most
 * never opened — the room is created by the first tap. `openSubjectRoom` is
 * idempotent, so the tap is safe to repeat and safe for two members to make at
 * the same moment.
 *
 * ## Why the context snapshot rides along on every open
 *
 * The assistant is server-side; the project usually is not. A House V2 project
 * lives in the on-device ledger (Tier A), and chat is server-authoritative
 * (Tier B), so the Worker cannot look up the budget, the phases or the price per
 * square foot no matter how it is asked. The client can — it is rendering them.
 * So the client hands over a plain-text brief each time it opens the room, and
 * the assistant answers from the household's real numbers instead of from what
 * kitchens usually cost.
 */
import { useCallback, useMemo, useState } from 'react';
import { Alert } from 'react-native';

import { getApiErrorMessage } from '@utils/apiError';

import type { ChatConfig } from './ChatConfig';
import { findSubjectRoom } from './subjects';
import type { ChatRoom, ChatSubjectType } from './types';
import { useChatRooms } from './useChatRooms';

/** The subject a screen is chatting about, plus how to describe it to the AI. */
export interface SubjectChatTarget {
  type: ChatSubjectType | string;
  id: string;
  label: string;
  parentId?: string | null;
  parentLabel?: string | null;
  /**
   * Lazily-built grounding text. A thunk rather than a value so a screen that
   * never opens the chat never pays for assembling it — on a project hub that
   * means not walking every selection, phase and blocker on each render.
   */
  buildContext?: () => string | null;
  /**
   * The subject's own audience. Pass a private project's member list so its
   * chat is not readable by the whole household; omit to leave it open.
   */
  participantIds?: string[];
}

export interface UseSubjectChatResult {
  /** The room, once it exists and the rooms list has been loaded. */
  room: ChatRoom | undefined;
  /** Unread messages in this subject's conversation. 0 when it has no room yet. */
  unreadCount: number;
  /** True while the open request is in flight (drives the button spinner). */
  isOpening: boolean;
  /**
   * Create-or-fetch the room and refresh its AI context. Resolves to the room,
   * or null when the call failed (the member has already been told).
   */
  open: () => Promise<ChatRoom | null>;
}

export function useSubjectChat(
  config: ChatConfig,
  target: SubjectChatTarget | null
): UseSubjectChatResult {
  const [isOpening, setIsOpening] = useState(false);
  // Rooms are needed only for the unread badge, so a screen with no subject
  // (a list, a wizard step) does not fetch them at all.
  const { rooms, householdId } = useChatRooms(config, { enabled: !!target });
  const upsertRoom = config.store((s) => s.setRooms);
  const storedRooms = config.store((s) => s.rooms);

  const room = useMemo(
    () => (target ? findSubjectRoom(rooms, target.type, target.id) : undefined),
    [rooms, target]
  );

  const open = useCallback(async (): Promise<ChatRoom | null> => {
    if (!target || !householdId || isOpening) return null;
    setIsOpening(true);
    try {
      const opened = await config.api.openSubjectRoom(householdId, {
        subject_type: target.type,
        subject_id: target.id,
        subject_label: target.label,
        subject_parent_id: target.parentId ?? null,
        subject_parent_label: target.parentLabel ?? null,
        context: target.buildContext?.() ?? null,
        participant_ids: target.participantIds,
      });

      // Seed the store so the chat list and this screen's badge both know the
      // room exists before the next rooms fetch lands.
      const without = storedRooms.filter((r) => r.id !== opened.id);
      upsertRoom([opened, ...without]);
      return opened;
    } catch (err) {
      console.error('[Chat] openSubjectRoom failed:', err);
      const status = (err as { response?: { status?: number } })?.response?.status;
      Alert.alert(
        'Could not open the chat',
        status === 401
          ? 'Your session has expired. Please sign in again.'
          : getApiErrorMessage(err, 'Please check your connection and try again.')
      );
      return null;
    } finally {
      setIsOpening(false);
    }
  }, [config.api, householdId, isOpening, storedRooms, target, upsertRoom]);

  return {
    room,
    unreadCount: room?.unread_count ?? 0,
    isOpening,
    open,
  };
}
