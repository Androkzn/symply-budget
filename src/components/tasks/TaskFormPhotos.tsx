/**
 * The task photo strip — where H6 attachment BYTES finally leave the device.
 *
 * The gap this closes: `LocalTask` is `Omit<Task, …> & Owned`, so `photos[]`,
 * `cover_photo_id` and `cover_photo_url` have always synced peer-to-peer. What
 * synced was *metadata*. The keys in it named R2 objects written by
 * `POST /tasks/photos/upload-url` — a Worker call a local-first household never
 * makes — so a peer received a photo row describing a file that, from its point
 * of view, did not exist. Exactly Budget's `localWishMedia.ts` failure, one
 * table over.
 *
 * So this component keeps its whole surface and swaps what happens underneath.
 * When `isHouseLocalFirst()` is on, a picked image is staged, sealed and
 * uploaded through `@features/house/local/blobs`, and what lands in the form is
 * a `HouseBlobDescriptor` — content-derived, device-independent, openable by any
 * enrolled peer. When it is off, the legacy R2 path runs exactly as before: the
 * form keeps a plain local uri and `buildTaskPhotoSavePayload` uploads it at
 * save time. Both paths stay live, and a single photo array can hold photos from
 * both (a task created on the server path and edited on a local-first device).
 *
 * **The UI is a hard contract and is deliberately untouched.** The two-device
 * E2E flows drive this strip by visible text and accessibility label, not by
 * testID: the `Photos` header, the `1/5` counter, the `Add photo` label, the
 * `Choose a source` → `Choose from Library` action sheet, and `Task cover photo`
 * on the first thumbnail. Every one of those is byte-identical to the version
 * that shipped; only the internals moved. `HouseBlobImage` renders a thumbnail
 * whose bytes are a descriptor — it is NOT `HouseAttachmentField`, which is
 * single-valued and has neither a counter nor a cover.
 *
 * **Failures are the five named H6 states**, rendered through
 * `houseBlobErrorCopy`. The retryable/non-retryable split is what decides
 * whether the pending upload survives: a corrupt chunk or an interrupted
 * transfer can be resumed with the SAME blob id (re-sealing would mint a second
 * GCM nonce for the same chunk, which is why the id is retained rather than
 * regenerated), while quota, size and a key this device never held are permanent
 * for this file — those drop the pending upload and its staged bytes instead of
 * leaving a spinner in front of an upload that provably cannot finish.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  houseBlobErrorCopy,
  type HouseBlobErrorCopy,
} from '@components/house-v2/houseBlobErrorCopy';
import { HouseBlobImage } from '@components/house-v2/HouseBlobImage';
import { Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import {
  BLOB_MAX_PLAINTEXT_BYTES,
  deleteHouseBlob,
  newBlobId,
  stageHouseBlobOrigin,
  uploadHouseBlob,
} from '@features/house/local/blobs';
import { isHouseLocalFirst } from '@features/house/local/flag';
import { CornerRadius, IconSize, Spacing, useAppColors } from '@theme';
import {
  MAX_TASK_PHOTOS,
  pickTaskPhotoFromLibrary,
  takeTaskPhoto,
  type TaskFormPhoto,
} from '@utils/taskPhotoSave';

interface TaskFormPhotosProps {
  photos: TaskFormPhoto[];
  coverPhotoIndex: number;
  onChange: (patch: { photos?: TaskFormPhoto[]; coverPhotoIndex?: number }) => void;
  /**
   * Which property's blob channel to seal against. Optional: the store falls
   * back to the active household, so a host that does not have one handy still
   * works — it is passed where it is known so a multi-property device cannot
   * seal an attachment to the wrong home mid-switch.
   */
  householdId?: string;
}

/**
 * An upload in flight, or one that stopped and can resume.
 *
 * `blobId` and `sourceUri` are retained across a retryable failure ON PURPOSE:
 * `uploadHouseBlob` resumes by re-reading the staged envelopes for that id, and
 * minting a fresh id would re-seal every chunk under a new nonce.
 */
type PendingPhotoUpload = {
  blobId: string;
  sourceUri: string;
  mime: string;
  percent: number;
  /** False once it has failed — the id is kept so "Retry" resumes the staging. */
  running: boolean;
};

export function TaskFormPhotos({
  photos,
  coverPhotoIndex,
  onChange,
  householdId,
}: TaskFormPhotosProps) {
  const colors = useAppColors();
  const [pending, setPending] = useState<PendingPhotoUpload | null>(null);
  const [error, setError] = useState<HouseBlobErrorCopy | null>(null);

  // An upload outlives a render. Appending to the `photos` prop captured when
  // the picker opened would silently drop any photo added while it ran, so the
  // append reads the latest array from a ref instead.
  const latest = useRef({ photos, coverPhotoIndex });
  latest.current = { photos, coverPhotoIndex };

  // A member can close the form mid-upload; setting state after that is a
  // warning at best and a leak at worst.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** Append a finished photo and make it the cover if it is the first one. */
  const appendPhoto = useCallback(
    (photo: TaskFormPhoto) => {
      const current = latest.current;
      onChange({
        photos: [...current.photos, photo],
        coverPhotoIndex: current.photos.length === 0 ? 0 : current.coverPhotoIndex,
      });
    },
    [onChange],
  );

  /**
   * Seal and upload through the H6 channel. Shared by "pick" and "retry" — the
   * only difference is whether `blobId` already exists, and that difference is
   * what makes a resume a resume rather than a second upload.
   */
  const runBlobUpload = useCallback(
    async (input: { sourceUri: string; mime: string; blobId: string }) => {
      setError(null);
      setPending({
        blobId: input.blobId,
        sourceUri: input.sourceUri,
        mime: input.mime,
        percent: 0,
        running: true,
      });
      try {
        const descriptor = await uploadHouseBlob({
          sourceUri: input.sourceUri,
          mime: input.mime,
          blobId: input.blobId,
          householdId,
          onProgress: (progress) => {
            if (!alive.current) return;
            setPending((current) =>
              current && current.blobId === input.blobId
                ? { ...current, percent: progress.percent }
                : current,
            );
          },
        });
        if (!alive.current) return;
        setPending(null);
        // `uri` stays empty: the descriptor is the only address these bytes
        // have, and a device path here is precisely the bug this replaces.
        appendPhoto({ uri: '', blob: descriptor });
      } catch (err) {
        if (!alive.current) return;
        const copy = houseBlobErrorCopy(
          err,
          'We could not finish adding that photo. It is still on this device — try again.',
          BLOB_MAX_PLAINTEXT_BYTES,
        );
        setError(copy);
        if (copy.retryable) {
          setPending({
            blobId: input.blobId,
            sourceUri: input.sourceUri,
            mime: input.mime,
            percent: 0,
            running: false,
          });
        } else {
          // Quota, size and a missing key are permanent for this file. Keeping a
          // spinner (or a "Retry") in front of it would be a lie, and the staged
          // envelopes would sit against the household's quota forever.
          setPending(null);
          void deleteHouseBlob(input.blobId, householdId).catch(() => {});
        }
      }
    },
    [appendPhoto, householdId],
  );

  const addPhoto = async (source: 'camera' | 'library') => {
    if (photos.length >= MAX_TASK_PHOTOS) {
      Alert.alert('Photo limit', `You can attach up to ${MAX_TASK_PHOTOS} photos per task.`);
      return;
    }

    try {
      const picked =
        source === 'camera'
          ? await takeTaskPhoto(colors.accent)
          : await pickTaskPhotoFromLibrary(colors.accent);
      if (!picked) return;

      if (!isHouseLocalFirst()) {
        // Legacy R2 path, unchanged: the form holds a local uri and
        // `buildTaskPhotoSavePayload` uploads it when the task is saved.
        const nextPhotos = [...photos, { uri: picked.uri }];
        onChange({
          photos: nextPhotos,
          coverPhotoIndex: photos.length === 0 ? 0 : coverPhotoIndex,
        });
        return;
      }

      const blobId = newBlobId();
      // Copy the picked file somewhere durable first: the picker's uri lives in
      // a cache the OS may reclaim, and a photo attached offline has to survive
      // an app restart before its upload ever begins.
      const staged = await stageHouseBlobOrigin(picked.uri, blobId).catch(() => picked.uri);
      await runBlobUpload({ sourceUri: staged || picked.uri, mime: picked.mime, blobId });
    } catch {
      Alert.alert('Error', 'Failed to add photo. Please try again.');
    }
  };

  const retryUpload = () => {
    if (!pending) return;
    void runBlobUpload({
      sourceUri: pending.sourceUri,
      mime: pending.mime,
      blobId: pending.blobId,
    });
  };

  const discardUpload = () => {
    const stopped = pending;
    setPending(null);
    setError(null);
    if (stopped) void deleteHouseBlob(stopped.blobId, householdId).catch(() => {});
  };

  const removePhoto = (index: number) => {
    const removed = photos[index];
    const nextPhotos = photos.filter((_, i) => i !== index);
    let nextCover = coverPhotoIndex;
    if (index === coverPhotoIndex) {
      nextCover = 0;
    } else if (index < coverPhotoIndex) {
      nextCover = Math.max(0, coverPhotoIndex - 1);
    }
    if (nextPhotos.length === 0) {
      nextCover = 0;
    } else if (nextCover >= nextPhotos.length) {
      nextCover = nextPhotos.length - 1;
    }
    onChange({ photos: nextPhotos, coverPhotoIndex: nextCover });
    // Reclaim the household's attachment quota. Best-effort: a failed delete
    // costs storage, while blocking the removal on it would cost the edit.
    if (removed?.blob) void deleteHouseBlob(removed.blob.blobId, householdId).catch(() => {});
  };

  const setCover = (index: number) => {
    onChange({ coverPhotoIndex: index });
  };

  const showAddOptions = () => {
    Alert.alert('Add Photo', 'Choose a source', [
      { text: 'Take Photo', onPress: () => addPhoto('camera') },
      { text: 'Choose from Library', onPress: () => addPhoto('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const uploading = pending?.running === true;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Typography variant="caption" color={colors.textSecondary}>
          Photos
        </Typography>
        <Typography variant="caption2" color={colors.textTertiary} testID="task-photo-counter">
          {`${photos.length}/${MAX_TASK_PHOTOS}`}
        </Typography>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.photoRow}
      >
        {photos.map((photo, index) => {
          const isCover = index === coverPhotoIndex;
          return (
            <View key={`${photo.id ?? photo.blob?.blobId ?? photo.uri}-${index}`} style={styles.photoWrap}>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => setCover(index)}
                accessibilityRole="button"
                accessibilityLabel={isCover ? 'Task cover photo' : 'Set as task cover photo'}
                testID={`task-photo-item-${index}`}
              >
                {photo.blob ? (
                  // A descriptor is not a URL — the bytes are AES-GCM sealed in
                  // R2 and have to be fetched, opened and hash-checked before
                  // anything can render them. The label is deliberately NOT
                  // "Task cover photo": that string belongs to the touchable
                  // above and the E2E flows match it exactly.
                  <HouseBlobImage
                    descriptor={photo.blob}
                    householdId={householdId}
                    width={PHOTO_SIZE}
                    height={PHOTO_SIZE}
                    accessibilityLabel={`Task photo ${index + 1}`}
                    style={styles.photo}
                    testID={`task-photo-blob-${index}`}
                  />
                ) : (
                  <Image
                    source={{ uri: photo.uri }}
                    style={styles.photo}
                    resizeMode="cover"
                    testID={`task-photo-image-${index}`}
                  />
                )}
                {isCover && (
                  <View style={[styles.coverBadge, { backgroundColor: colors.accent }]}>
                    <Icon name="star" size={12} color={colors.white} />
                  </View>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.removeButton, { backgroundColor: colors.error }]}
                onPress={() => removePhoto(index)}
                accessibilityRole="button"
                accessibilityLabel="Remove photo"
                testID={`task-photo-remove-${index}`}
              >
                <Typography variant="caption2" color={colors.white}>
                  ×
                </Typography>
              </TouchableOpacity>
            </View>
          );
        })}

        {pending && (
          <View
            style={[
              styles.pendingTile,
              { borderColor: colors.borderColor, backgroundColor: colors.backgroundSecondary },
            ]}
            testID="task-photo-pending"
            accessibilityLabel={
              pending.running
                ? `Adding photo, ${pending.percent} percent`
                : 'Photo upload stopped'
            }
          >
            {pending.running ? (
              <>
                <ActivityIndicator size="small" />
                <Typography variant="caption2" color={colors.textSecondary}>
                  {`${pending.percent}%`}
                </Typography>
              </>
            ) : (
              <Icon name="cloud-offline-outline" size={IconSize.md} color={colors.warning} />
            )}
          </View>
        )}

        {photos.length < MAX_TASK_PHOTOS && (
          <TouchableOpacity
            style={[
              styles.addButton,
              { borderColor: colors.borderColor, backgroundColor: colors.backgroundSecondary },
            ]}
            onPress={showAddOptions}
            disabled={uploading}
            accessibilityRole="button"
            accessibilityLabel="Add photo"
            testID="task-photo-add"
          >
            <Icon name="camera-outline" size={IconSize.lg} color={colors.primary} />
            <Typography variant="caption2" color={colors.textSecondary} style={styles.addLabel}>
              Add
            </Typography>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* The named H6 failure, in words a member can act on. */}
      {error && (
        <View
          style={[
            styles.errorPanel,
            { backgroundColor: colors.backgroundSecondary, borderColor: colors.warning },
          ]}
          testID="task-photo-error"
        >
          <Typography variant="caption" weight="semibold" color={colors.warning}>
            {error.title}
          </Typography>
          <Typography variant="caption2" color={colors.textSecondary}>
            {error.message}
          </Typography>
          <View style={styles.errorActions}>
            {pending && !pending.running && (
              <TouchableOpacity
                onPress={retryUpload}
                accessibilityRole="button"
                accessibilityLabel="Retry adding this photo"
                testID="task-photo-retry"
              >
                <Typography variant="caption2" weight="semibold" color={colors.primary}>
                  Try again
                </Typography>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={discardUpload}
              accessibilityRole="button"
              accessibilityLabel="Dismiss this photo error"
              testID="task-photo-error-dismiss"
            >
              <Typography variant="caption2" weight="semibold" color={colors.textSecondary}>
                Dismiss
              </Typography>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {photos.length > 0 && (
        <Typography variant="caption2" color={colors.textTertiary}>
          Tap a photo to set it as the task card image
        </Typography>
      )}
    </View>
  );
}

const PHOTO_SIZE = 88;

const styles = StyleSheet.create({
  container: {
    gap: Spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  photoRow: {
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  photoWrap: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE,
  },
  photo: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE,
    borderRadius: CornerRadius.md,
  },
  coverBadge: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.2,
        shadowRadius: 2,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  removeButton: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingTile: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE,
    borderRadius: CornerRadius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  addButton: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE,
    borderRadius: CornerRadius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  addLabel: {
    marginTop: 2,
  },
  errorPanel: {
    borderWidth: 1,
    borderRadius: CornerRadius.md,
    padding: Spacing.sm,
    gap: Spacing.xxs,
  },
  errorActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginTop: Spacing.xxs,
  },
});
