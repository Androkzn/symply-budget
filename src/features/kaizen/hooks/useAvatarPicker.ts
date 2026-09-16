/**
 * Symply Life — avatar picker (interim feature-local stub).
 *
 * The donor imported `@hooks/useAvatarPicker`, which the ecosystem does not provide. Avatar
 * editing is a low-priority Profile affordance; this preserves the donor
 * `{ takePhoto, pickFromLibrary }` contract (each resolving a processed `PickedAvatar` ready
 * for upload, or `null` when the user cancels / denies access) so ProfileScreen compiles and
 * behaves gracefully. Wire to the ecosystem image/avatar pipeline in Stage 6.
 */

/** A processed image ready to upload as an avatar (donor shape). */
export interface PickedAvatar {
  uri: string;
  mimeType?: string;
}

export function useAvatarPicker() {
  return {
    takePhoto: async (): Promise<PickedAvatar | null> => {
      // TODO(Stage 6): adapt to ecosystem avatar/image pipeline. Interim: no-op (cancels).
      return null;
    },
    pickFromLibrary: async (): Promise<PickedAvatar | null> => {
      // TODO(Stage 6): adapt to ecosystem avatar/image pipeline. Interim: no-op (cancels).
      return null;
    },
  };
}
