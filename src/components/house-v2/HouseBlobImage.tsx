/**
 * Render an H6 encrypted attachment as an image (plan §8 fetch policy).
 *
 * A `HouseBlobDescriptor` is not a URL. Nothing can point an `<Image>` at it:
 * the bytes are AES-GCM sealed in R2, and turning them into something a renderer
 * can read means fetching every chunk, opening each one, checking the whole
 * file's sha256 and writing the plaintext to `cacheDirectory`. That is a real
 * download, and the plan is explicit about when it may happen on its own:
 *
 *   **Lazy on first view, with an explicit "download" affordance on cellular.**
 *
 * So this component always asks two questions before it fetches. *Is it already
 * decrypted on this device?* — `isHouseBlobCached` answers without touching the
 * network, and a cached blob renders immediately regardless of connection.
 * *Would fetching cost the member money?* — if so it stops and offers a button
 * instead. Auto-fetching a screen of photos over cellular is not a rendering
 * detail; it is spending someone else's data allowance.
 *
 * Every failure is one of H6's four named states, rendered through
 * `houseBlobErrorCopy` — a corrupt hash and a key this device never held are
 * different situations with different answers, and neither is "image failed to
 * load".
 */
import { Image } from 'expo-image';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Icon, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import {
  BLOB_MAX_PLAINTEXT_BYTES,
  isHouseBlobCached,
  resolveHouseBlobUri,
  type HouseBlobDescriptor,
} from '@features/house/local/blobs';
import { CornerRadius, IconSize, Spacing, useAppColors } from '@theme';

import { houseBlobErrorCopy, formatBlobBytes, type HouseBlobErrorCopy } from './houseBlobErrorCopy';
import { isMeteredConnection } from './meteredConnection';

export type HouseBlobFetchPolicy =
  /** Fetch on first view unless the connection is metered (the plan's default). */
  | 'auto'
  /** Fetch on first view no matter what — for a full-screen viewer the member opened. */
  | 'always'
  /** Never fetch without a tap. */
  | 'manual';

export type HouseBlobImageProps = {
  descriptor: HouseBlobDescriptor;
  householdId?: string;
  fetchPolicy?: HouseBlobFetchPolicy;
  width?: number;
  height?: number;
  /** Alt text. Attachments have no filename in the descriptor, so callers supply it. */
  accessibilityLabel?: string;
  /**
   * How the bytes fill the box. `cover` for a thumbnail, where a crop is what
   * makes a row of photos line up; `contain` for a full-screen viewer, where
   * cropping the photo hides the very thing the member opened it to look at.
   */
  contentFit?: 'cover' | 'contain';
  style?: StyleProp<ViewStyle>;
  onError?: (error: unknown) => void;
  /** Prefix for this instance's testIDs — defaults to `lf-attach-image`. */
  testID?: string;
};

type Phase = 'checking' | 'needs_download' | 'loading' | 'ready' | 'error';

export function HouseBlobImage({
  descriptor,
  householdId,
  fetchPolicy = 'auto',
  width = 96,
  height = 96,
  accessibilityLabel,
  contentFit = 'cover',
  style,
  onError,
  testID = 'lf-attach-image',
}: HouseBlobImageProps) {
  const colors = useAppColors();
  const [phase, setPhase] = useState<Phase>('checking');
  const [uri, setUri] = useState<string | null>(null);
  const [error, setError] = useState<HouseBlobErrorCopy | null>(null);

  // A member can leave the screen mid-download; setting state after that is a
  // warning at best and a leak at worst.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const fetchNow = useCallback(
    async (forceRefresh = false) => {
      setPhase('loading');
      setError(null);
      try {
        const resolved = await resolveHouseBlobUri(descriptor, { householdId, forceRefresh });
        if (!alive.current) return;
        setUri(resolved);
        setPhase('ready');
      } catch (err) {
        if (!alive.current) return;
        setError(
          houseBlobErrorCopy(
            err,
            'We could not open this attachment right now. Try again in a moment.',
            BLOB_MAX_PLAINTEXT_BYTES,
          ),
        );
        setPhase('error');
        onError?.(err);
      }
    },
    [descriptor, householdId, onError],
  );

  // First view: decide between rendering, fetching and offering a download.
  useEffect(() => {
    let cancelled = false;
    setPhase('checking');
    setUri(null);
    setError(null);

    void (async () => {
      // Cached wins over every policy — the bytes are already here, and making
      // someone tap "Download" for a file sitting on their own disk is absurd.
      const cached = await isHouseBlobCached(descriptor.blobId).catch(() => false);
      if (cancelled || !alive.current) return;
      if (cached) {
        void fetchNow(false);
        return;
      }
      if (fetchPolicy === 'manual') {
        setPhase('needs_download');
        return;
      }
      if (fetchPolicy === 'always') {
        void fetchNow(false);
        return;
      }
      const metered = await isMeteredConnection();
      if (cancelled || !alive.current) return;
      if (metered) {
        setPhase('needs_download');
        return;
      }
      void fetchNow(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [descriptor.blobId, fetchPolicy, fetchNow]);

  const box: ViewStyle = { width, height, borderRadius: CornerRadius.sm };

  if (phase === 'ready' && uri) {
    return (
      <Image
        source={{ uri }}
        // The same box is shared by the image and its three placeholder Views,
        // so the prop is typed as a view style. `ImageStyle` is a superset of
        // the layout properties used here, which is why the cast is safe.
        style={[box, style] as StyleProp<ImageStyle>}
        contentFit={contentFit}
        accessible
        accessibilityLabel={accessibilityLabel ?? 'Attachment'}
        testID={`${testID}-view`}
      />
    );
  }

  if (phase === 'error' && error) {
    return (
      <View
        style={[styles.placeholder, box, { backgroundColor: colors.cardSubtle }, style]}
        testID={`${testID}-error`}
        accessibilityLabel={`${error.title}. ${error.message}`}
      >
        <Icon
          name="alert-circle-outline"
          size={IconSize.md}
          color={error.expected ? colors.textTertiary : colors.warning}
        />
        <Typography variant="captionSmall" color={colors.textSecondary} numberOfLines={3}>
          {error.title}
        </Typography>
        {error.retryable ? (
          <Pressable
            onPress={() => {
              // A hash mismatch means the cached copy is wrong; refetch rather
              // than re-read the bad bytes.
              void fetchNow(error.code === 'blob_corrupt');
            }}
            accessibilityRole="button"
            accessibilityLabel="Try loading this attachment again"
            testID={`${testID}-retry`}
          >
            <Typography variant="captionSmall" weight="semibold" color={colors.primary}>
              Try again
            </Typography>
          </Pressable>
        ) : null}
      </View>
    );
  }

  if (phase === 'needs_download') {
    return (
      <Pressable
        onPress={() => void fetchNow(false)}
        style={[styles.placeholder, box, { backgroundColor: colors.cardSubtle }, style]}
        accessibilityRole="button"
        accessibilityLabel={`Download attachment, ${formatBlobBytes(descriptor.bytes)}`}
        testID={`${testID}-download`}
      >
        <Icon name="cloud-download-outline" size={IconSize.md} color={colors.primary} />
        <Typography variant="captionSmall" weight="semibold" color={colors.primary}>
          Download
        </Typography>
        <Typography variant="captionSmall" color={colors.textTertiary}>
          {formatBlobBytes(descriptor.bytes)}
        </Typography>
      </Pressable>
    );
  }

  return (
    <View
      style={[styles.placeholder, box, { backgroundColor: colors.cardSubtle }, style]}
      testID={`${testID}-loading`}
      accessibilityLabel="Opening attachment"
    >
      <ActivityIndicator size="small" />
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xxs,
    padding: Spacing.xs,
    overflow: 'hidden',
  },
});
