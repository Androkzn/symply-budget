import type { KaizenDriveRememberScope, KaizenUploadedFile } from './rememberScopes';

type PendingPick = KaizenUploadedFile & { scope: KaizenDriveRememberScope };

let pendingPick: PendingPick | null = null;

/** Set by {@link KaizenFileUploadScreen} before navigating back to the caller. */
export function setKaizenPendingFilePick(
  scope: KaizenDriveRememberScope,
  file: KaizenUploadedFile,
): void {
  pendingPick = { ...file, scope };
}

/** Consumed by callers on focus; returns the file only when scope matches. */
export function consumeKaizenPendingFilePick(
  scope: KaizenDriveRememberScope,
): KaizenUploadedFile | null {
  if (!pendingPick || pendingPick.scope !== scope) return null;
  const { uri, name, size, mime } = pendingPick;
  pendingPick = null;
  return { uri, name, size, mime };
}

/** Test helper — clears any in-flight pick. */
export function resetKaizenPendingFilePick(): void {
  pendingPick = null;
}
