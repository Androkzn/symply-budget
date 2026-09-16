/** Dev-only: prime the chat composer with `@` for mention-bar Maestro rows. */
let pendingPrimeChatMention = false;

export function queueE2EPrimeChatMention(): void {
  if (!__DEV__) return;
  pendingPrimeChatMention = true;
}

export function consumeE2EPrimeChatMention(): boolean {
  if (!__DEV__ || !pendingPrimeChatMention) return false;
  pendingPrimeChatMention = false;
  return true;
}

/** @internal test helper */
export function __resetE2EPrimeChatMentionForTests(): void {
  pendingPrimeChatMention = false;
}
