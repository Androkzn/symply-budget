/**
 * Pure composer text helpers shared by the chat room's `@mention` autocomplete
 * and its "always ask the assistant" toggle.
 *
 * They live outside `ChatRoomScreen` because both behaviours are string logic
 * whose edge cases (a mention typed in the MIDDLE of an edited message, a body
 * that already addresses the assistant) are worth testing without rendering a
 * screen that needs a household, a socket and an upload pipeline.
 */

/**
 * The handles that pull the assistant into a room.
 *
 * This MIRRORS `ASSISTANT_MENTION` in
 * `backend/src/services/chat/chat-room-service-core.ts`: the Worker decides
 * whether to answer by testing that pattern against the stored body. A
 * divergence here is silent and one-sided — the member sees a message they
 * believe is addressed to the assistant, and the assistant never sees it.
 */
export const ASSISTANT_MENTION_RE = /@(?:assistant|ai)\b/i;

/**
 * The handle the composer INSERTS. `@ai` is accepted by the backend and by the
 * suggestion row's matching, but `@assistant` is what shipped conversations and
 * the E2E flows already contain.
 */
export const ASSISTANT_HANDLE = '@assistant';

/** True when this body already pulls in the assistant. */
export function bodyMentionsAssistant(body: string): boolean {
  return ASSISTANT_MENTION_RE.test(body);
}

/**
 * The body to actually send when "always ask the assistant" is on: prefixed
 * with `@assistant` unless it already addresses the assistant. Prefixing the
 * VISIBLE body (rather than passing a flag) keeps one source of truth — the
 * message renders as an assistant mention for every member in the room, and the
 * Worker triggers on exactly the text it stored.
 */
export function withAssistantMention(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return trimmed;
  return bodyMentionsAssistant(trimmed) ? trimmed : `${ASSISTANT_HANDLE} ${trimmed}`;
}

export interface MentionToken {
  /** Text between the `@` and the caret — what the suggestion list filters on. */
  query: string;
  /** Index of the `@`. */
  start: number;
  /** Index just past the token (the caret). */
  end: number;
}

/**
 * The `@token` the caret currently sits in, or `null`.
 *
 * The composer used to match `@name` only at the END of the input, which is why
 * the suggestion bar never appeared while EDITING a message: an edit puts the
 * mention in FRONT of the existing text, so the `@` is mid-string and the
 * end-anchored match failed — there was no way to tag anyone, the assistant
 * included, from the edit composer.
 */
export function mentionTokenAt(text: string, caret: number): MentionToken | null {
  const end = Math.max(0, Math.min(caret, text.length));
  const match = text.slice(0, end).match(/(?:^|\s)@([^\s@]*)$/);
  if (!match) return null;
  const query = match[1];
  return { query, start: end - query.length - 1, end };
}

/**
 * Where the caret lands after `prev` becomes `next`.
 *
 * React Native does not guarantee that `onSelectionChange` fires before
 * `onChangeText`, so the position the member is typing at is derived from the
 * edit itself — the common prefix and the common suffix pin the changed span,
 * and the caret sits at its end.
 */
export function caretAfterEdit(prev: string, next: string): number {
  const max = Math.min(prev.length, next.length);
  let head = 0;
  while (head < max && prev[head] === next[head]) head += 1;
  let tail = 0;
  while (tail < max - head && prev[prev.length - 1 - tail] === next[next.length - 1 - tail]) {
    tail += 1;
  }
  return Math.max(head, next.length - tail);
}

/**
 * Storage key for a room's "always ask the assistant" preference. Scoped by app
 * (`house` / `budget` chats are separate conversations) and by room, so turning
 * it on in a project chat doesn't silently address the assistant in the
 * household room.
 */
export function assistantDefaultKey(configId: string, roomId: string): string {
  return `chat:${configId}:assistant-default:${roomId}`;
}
