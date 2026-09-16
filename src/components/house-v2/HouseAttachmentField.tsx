/**
 * The H6 encrypted attachment channel's first caller.
 *
 * `uploadHouseBlob` / `resolveHouseBlobUri` / `deleteHouseBlob` /
 * `getHouseBlobUsage` were built, tested and deployed to eight D1s with **zero
 * call sites outside their own module**. This component is the one that reaches
 * them, and it exists to make one specific class of bug impossible: Budget's
 * `localWishMedia.ts` copies a picked image into `documentDirectory` and puts a
 * device path in the ledger, so the row syncs and the bytes never do. Here the
 * only thing that ever reaches `onChange` is a `HouseBlobDescriptor` —
 * content-derived, device-independent, openable by any enrolled peer.
 *
 * **Why the pending upload is kept on failure.** `uploadHouseBlob` is resumable
 * by construction: each chunk is sealed to disk *before* it is PUT, and re-running
 * with the same `blobId` re-reads the staged envelope instead of re-sealing it.
 * Re-sealing would mint a second GCM nonce for the same (contentKey, chunkIndex)
 * — the nonce-reuse bug the whole staging design exists to prevent. So an
 * interrupted upload must resume with the *same* id, which means this component
 * holds onto `{blobId, sourceUri, mime}` across the failure and hands all three
 * back on "Resume". Discarding and re-picking would be correct but would re-send
 * every chunk; silently minting a new id on retry would be a security bug.
 *
 * **Every H6 error state is named here**, because they need different answers:
 * quota (delete something), too large (pick something else), corrupt (retry),
 * key-unavailable (nothing this device can do — it enrolled after the blob was
 * sealed), and still-uploading (wait). None of them is "upload failed".
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ScanImportSources } from '@components/common/ScanImportSources';
import {
  IMAGE_MIME_TYPES,
  useAttachmentSources,
} from '@components/common/useAttachmentSources';
import { Icon, ProgressBar, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import {
  BLOB_MAX_PLAINTEXT_BYTES,
  deleteHouseBlob,
  getHouseBlobUsage,
  newBlobId,
  resolveHouseBlobUri,
  stageHouseBlobOrigin,
  uploadHouseBlob,
  type HouseBlobDescriptor,
  type RemoteBlobUsage,
} from '@features/house/local/blobs';
import { CornerRadius, IconSize, Spacing, useAppColors } from '@theme';

import { formatBlobBytes, houseBlobErrorCopy, type HouseBlobErrorCopy } from './houseBlobErrorCopy';
import { HouseBlobImage } from './HouseBlobImage';

/** What is picked. `any` shows both actions. */
export type HouseAttachmentKind = 'image' | 'file' | 'any';

export type HouseAttachmentFieldProps = {
  /** Section label, e.g. "Receipt" or "Photo of the problem". */
  label?: string;
  /** The descriptor stored on the ledger row, or null when there is none. */
  value?: HouseBlobDescriptor | null;
  /**
   * Called with the descriptor to persist, or null after a delete. The caller
   * writes it to the ledger — this component never touches the ledger itself.
   */
  onChange: (next: HouseBlobDescriptor | null) => void;
  householdId?: string;
  accept?: HouseAttachmentKind;
  disabled?: boolean;
  /**
   * Fraction of the household soft limit at which the storage line appears.
   * Below it the number is noise; the server hard-stops well above it.
   */
  usageWarnFraction?: number;
  /** Hand a decrypted local file path to the caller, e.g. to open a viewer. */
  onOpen?: (localUri: string, descriptor: HouseBlobDescriptor) => void;
  style?: StyleProp<ViewStyle>;
};

/** An upload in flight, or one that failed and can be resumed with the same id. */
type PendingUpload = {
  blobId: string;
  sourceUri: string;
  mime: string;
  percent: number;
  /** False once it has failed — the id is retained so "Resume" reuses the staging. */
  running: boolean;
};

function isImageMime(mime: string | undefined | null): boolean {
  return typeof mime === 'string' && mime.startsWith('image/');
}

export function HouseAttachmentField({
  label = 'Attachment',
  value,
  onChange,
  householdId,
  accept = 'any',
  disabled = false,
  usageWarnFraction = 0.8,
  onOpen,
  style,
}: HouseAttachmentFieldProps) {
  const colors = useAppColors();
  const [pending, setPending] = useState<PendingUpload | null>(null);
  const [error, setError] = useState<HouseBlobErrorCopy | null>(null);
  const [usage, setUsage] = useState<RemoteBlobUsage | null>(null);
  const [opening, setOpening] = useState(false);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refreshUsage = useCallback(() => {
    void getHouseBlobUsage(householdId)
      .then((next) => {
        if (alive.current) setUsage(next);
      })
      // Usage is decoration. A household that cannot read its rollup can still
      // attach files, and an error banner about a storage *number* would be
      // noise next to the thing the member is actually doing.
      .catch(() => {});
  }, [householdId]);

  useEffect(refreshUsage, [refreshUsage]);

  /**
   * Seal and upload. Shared by "pick" and "resume" — the only difference is
   * whether `blobId` already exists, and that difference is what makes a resume
   * a resume instead of a second upload.
   */
  const runUpload = useCallback(
    async (input: { sourceUri: string; mime: string; blobId: string }) => {
      setError(null);
      setPending({ ...input, percent: 0, running: true });
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
        onChange(descriptor);
        refreshUsage();
      } catch (err) {
        if (!alive.current) return;
        const copy = houseBlobErrorCopy(
          err,
          'We could not finish adding that attachment. Your file is still on this device — try again.',
          BLOB_MAX_PLAINTEXT_BYTES,
        );
        setError(copy);
        // Quota and size are permanent for this file: keeping a "Resume" button
        // in front of an upload that provably cannot succeed is the dishonesty
        // this whole error-copy layer exists to avoid.
        if (copy.retryable) {
          setPending({ ...input, percent: 0, running: false });
        } else {
          setPending(null);
          void deleteHouseBlob(input.blobId, householdId).catch(() => {});
        }
        if (copy.code === 'blob_quota_exceeded') refreshUsage();
      }
    },
    [householdId, onChange, refreshUsage],
  );

  const startUpload = useCallback(
    (sourceUri: string, mime: string) => {
      const blobId = newBlobId();
      // Copy the picked file somewhere durable first: the picker's uri lives in
      // a cache the OS may reclaim, and an attachment chosen offline has to
      // survive an app restart before its upload ever begins.
      void stageHouseBlobOrigin(sourceUri, blobId)
        .catch(() => sourceUri)
        .then((staged) => runUpload({ sourceUri: staged || sourceUri, mime, blobId }));
    },
    [runUpload],
  );

  /**
   * The four sources, from the one place that defines them.
   *
   * This field used to offer "Add photo" (library only) and "Add file", which
   * meant an attachment living in the member's camera roll took a detour
   * through the Photos app and one living in Drive could not be attached at
   * all. `useAttachmentSources` supplies the same Camera · Gallery · File ·
   * Drive list every other upload surface now shows, and hands back a uri plus
   * whatever mime the source knew — which is exactly what `startUpload` needs.
   *
   * A file whose mime nothing could determine falls back to
   * `application/octet-stream`, as the Files branch always did: the H6 envelope
   * stores the mime it is given, and an honest "unknown bytes" is recoverable
   * where a guessed `image/jpeg` renders as a broken tile forever.
   */
  const { sourceHandlers, drivePicker } = useAttachmentSources({
    rememberScope: `house-attachment-${accept}`,
    mimeTypes: accept === 'image' ? IMAGE_MIME_TYPES : ['*/*'],
    maxFileBytes: BLOB_MAX_PLAINTEXT_BYTES,
    disabled,
    onPicked: ([picked]) => {
      if (!picked) return;
      startUpload(
        picked.uri,
        picked.mime ??
          (accept === 'image' ? 'image/jpeg' : 'application/octet-stream'),
      );
    },
  });

  const resume = useCallback(() => {
    if (!pending) return;
    void runUpload({ sourceUri: pending.sourceUri, mime: pending.mime, blobId: pending.blobId });
  }, [pending, runUpload]);

  const discardPending = useCallback(() => {
    if (!pending) return;
    const { blobId } = pending;
    setPending(null);
    setError(null);
    // Drop the staged envelopes and any chunks that did land, so an abandoned
    // upload does not sit against the household's quota forever.
    void deleteHouseBlob(blobId, householdId)
      .catch(() => {})
      .finally(() => refreshUsage());
  }, [pending, householdId, refreshUsage]);

  const remove = useCallback(() => {
    if (!value) return;
    const { blobId } = value;
    setError(null);
    void deleteHouseBlob(blobId, householdId)
      .then(() => {
        if (!alive.current) return;
        onChange(null);
        refreshUsage();
      })
      .catch((err: unknown) => {
        if (!alive.current) return;
        setError(
          houseBlobErrorCopy(err, 'We could not remove that attachment. Try again in a moment.'),
        );
      });
  }, [value, householdId, onChange, refreshUsage]);

  const open = useCallback(() => {
    if (!value || !onOpen) return;
    setOpening(true);
    setError(null);
    void resolveHouseBlobUri(value, { householdId })
      .then((uri) => {
        if (!alive.current) return;
        onOpen(uri, value);
      })
      .catch((err: unknown) => {
        if (!alive.current) return;
        setError(
          houseBlobErrorCopy(
            err,
            'We could not open that attachment. Try again in a moment.',
            BLOB_MAX_PLAINTEXT_BYTES,
          ),
        );
      })
      .finally(() => {
        if (alive.current) setOpening(false);
      });
  }, [value, householdId, onOpen]);

  const showUsage =
    usage != null &&
    (usage.overSoftLimit ||
      (usage.softLimitBytes > 0 && usage.cipherBytes / usage.softLimitBytes >= usageWarnFraction));

  const busy = pending?.running === true;
  const canAdd = !disabled && !busy && value == null && pending == null;

  return (
    <View style={[styles.wrap, style]} testID="lf-attach-field">
      <Typography variant="bodySmallSemibold" testID="lf-attach-label">
        {label}
      </Typography>

      {/* --- an upload in flight, or one that stopped and can resume ------- */}
      {pending ? (
        <View
          style={[styles.panel, { borderColor: colors.borderColor }]}
          testID="lf-attach-pending"
        >
          <View style={styles.pendingRow}>
            {pending.running ? <ActivityIndicator size="small" /> : null}
            <Typography
              variant="caption1"
              color={colors.textSecondary}
              style={styles.grow}
              testID="lf-attach-progress-label"
            >
              {pending.running
                ? `Adding attachment — ${pending.percent}%`
                : 'Upload stopped. Nothing was lost — it will pick up where it left off.'}
            </Typography>
          </View>
          <ProgressBar
            progress={pending.percent / 100}
            color={pending.running ? colors.primary : colors.warning}
            testID="lf-attach-progress"
          />
          <View style={styles.actionRow}>
            {!pending.running ? (
              <Pressable
                onPress={resume}
                accessibilityRole="button"
                accessibilityLabel="Resume this upload"
                testID="lf-attach-resume"
              >
                <Typography variant="caption1" weight="semibold" color={colors.primary}>
                  Resume upload
                </Typography>
              </Pressable>
            ) : null}
            <Pressable
              onPress={discardPending}
              accessibilityRole="button"
              accessibilityLabel="Discard this upload"
              testID="lf-attach-discard"
            >
              <Typography variant="caption1" weight="semibold" color={colors.error}>
                Discard
              </Typography>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* --- what is attached --------------------------------------------- */}
      {value && !pending ? (
        <View style={[styles.panel, { borderColor: colors.borderColor }]} testID="lf-attach-value">
          {isImageMime(value.mime) ? (
            <HouseBlobImage
              descriptor={value}
              householdId={householdId}
              accessibilityLabel={`${label} attachment`}
              testID="lf-attach-image"
            />
          ) : (
            <View style={styles.fileRow} testID="lf-attach-file">
              <Icon name="document-outline" size={IconSize.lg} color={colors.textSecondary} />
              <View style={styles.grow}>
                <Typography variant="caption1" numberOfLines={1}>
                  {value.mime}
                </Typography>
                <Typography variant="captionSmall" color={colors.textTertiary}>
                  {formatBlobBytes(value.bytes)}
                </Typography>
              </View>
              {onOpen ? (
                <Pressable
                  onPress={open}
                  disabled={opening}
                  accessibilityRole="button"
                  accessibilityLabel="Download and open this attachment"
                  testID="lf-attach-download"
                >
                  {opening ? (
                    <ActivityIndicator size="small" />
                  ) : (
                    <Typography variant="caption1" weight="semibold" color={colors.primary}>
                      Open
                    </Typography>
                  )}
                </Pressable>
              ) : null}
            </View>
          )}

          {!disabled ? (
            <Pressable
              onPress={remove}
              accessibilityRole="button"
              accessibilityLabel="Remove this attachment"
              style={styles.removeRow}
              testID="lf-attach-remove"
            >
              <Typography variant="caption1" weight="semibold" color={colors.error}>
                Remove
              </Typography>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* --- add ----------------------------------------------------------- */}
      {canAdd ? (
        <ScanImportSources testIDPrefix="lf-attach-add" {...sourceHandlers} />
      ) : null}

      {/* --- the named H6 failure, in words a member can act on ------------ */}
      {error ? (
        <View
          style={[styles.errorPanel, { backgroundColor: colors.cardSubtle, borderColor: colors.warning }]}
          testID="lf-attach-error"
        >
          <Typography variant="bodySmallSemibold" color={colors.warning} testID="lf-attach-error-title">
            {error.title}
          </Typography>
          <Typography variant="caption1" color={colors.textSecondary} testID="lf-attach-error-message">
            {error.message}
          </Typography>
        </View>
      ) : null}

      {/* --- household storage, only once it is close to mattering --------- */}
      {showUsage && usage ? (
        <Typography
          variant="captionSmall"
          color={usage.overSoftLimit ? colors.warning : colors.textTertiary}
          testID="lf-attach-usage"
        >
          {usage.overSoftLimit
            ? `Attachment storage is nearly full — ${formatBlobBytes(usage.cipherBytes)} of ${formatBlobBytes(usage.hardLimitBytes)} used across ${usage.blobCount} attachment${usage.blobCount === 1 ? '' : 's'}. Remove a few to keep adding.`
            : `${formatBlobBytes(usage.cipherBytes)} of ${formatBlobBytes(usage.softLimitBytes)} attachment storage used.`}
        </Typography>
      ) : null}

      {/* The Drive browse. Its own Modal, mounted here and invisible until the
          Drive tile is tapped. */}
      {drivePicker}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.sm,
  },
  panel: {
    borderWidth: 1,
    borderRadius: CornerRadius.md,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  grow: {
    flex: 1,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  removeRow: {
    alignSelf: 'flex-start',
  },
  errorPanel: {
    borderWidth: 1,
    borderRadius: CornerRadius.md,
    padding: Spacing.md,
    gap: Spacing.xxs,
  },
});
