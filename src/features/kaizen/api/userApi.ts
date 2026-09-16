/**
 * Symply Life (brand `symply-kaizen`) — userApi shim.
 *
 * The donor ProfileScreen imported a `userApi` that owned avatar upload/delete alongside the
 * profile calls. The ecosystem `@api/user` provides the profile calls but not avatar editing
 * (a Stage-6 affordance). This shim re-exports the ecosystem `userApi` unchanged and adds
 * interim `uploadAvatar` / `deleteAvatar` so the ported ProfileScreen keeps its exact call
 * surface. Wire these to the platform files/avatar endpoint in Stage 6.
 */
import { userApi as ecosystemUserApi } from '@api/user';

import type { PickedAvatar } from '../hooks/useAvatarPicker';

/** Interim: avatar upload is not yet wired to platform storage (Stage 6). */
async function uploadAvatar(_asset: PickedAvatar): Promise<{ avatar_url: string }> {
  throw new Error('Avatar upload is not available yet.');
}

/** Interim: avatar delete is a client-side no-op until wired to platform storage (Stage 6). */
async function deleteAvatar(): Promise<void> {
  // No-op: the caller clears the local avatar optimistically.
}

export const userApi = {
  ...ecosystemUserApi,
  uploadAvatar,
  deleteAvatar,
};
