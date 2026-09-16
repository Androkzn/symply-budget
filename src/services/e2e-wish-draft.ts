/** Dev-only: stash a wish title for Maestro create flows (native inputText sync). */
let pendingWishTitle: string | null = null;
/** Dev-only: open AddWishModal when the deeplink fires (Maestro tap can miss). */
let pendingOpenWishAdd = false;

export function queueE2EWishDraftTitle(title: string): void {
  if (!__DEV__) return;
  const trimmed = title.trim();
  pendingWishTitle = trimmed || null;
  pendingOpenWishAdd = true;
}

export function consumeE2EOpenWishAdd(): boolean {
  if (!__DEV__ || !pendingOpenWishAdd) return false;
  pendingOpenWishAdd = false;
  return true;
}

export function peekE2EWishDraftTitle(): string | null {
  if (!__DEV__ || !pendingWishTitle) return null;
  return pendingWishTitle;
}

export function consumeE2EWishDraftTitle(): string | null {
  if (!__DEV__ || !pendingWishTitle) return null;
  const title = pendingWishTitle;
  pendingWishTitle = null;
  return title;
}

/** @internal test helper */
export function __resetE2EWishDraftForTests(): void {
  pendingWishTitle = null;
  pendingOpenWishAdd = false;
}
