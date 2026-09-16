import type { PermissionResponseLike } from '@utils/permissionState';

const listeners = new Set<(response: PermissionResponseLike) => void>();

/** OS permission is independent of push-token creation and server registration. */
export function publishNotificationPermission(response: PermissionResponseLike): void {
  for (const listener of listeners) listener(response);
}

export function subscribeNotificationPermission(
  listener: (response: PermissionResponseLike) => void,
): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
