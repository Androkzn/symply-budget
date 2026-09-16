// Expo SDK 54 made the top-level FileSystem API a throw-on-call deprecation
// stub. Use the `/legacy` subpath, as every other reader/writer here does.
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { healthFileContentSource } from '@api/healthAssets';
import { ProcessingOverlay, ScanImportSources } from '@components/common';
import { useAttachmentSources } from '@components/common/useAttachmentSources';
import { Card, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import { HealthSectionScreen, HealthStatTiles } from '../components';
import {
  deleteHealthFile,
  fileDayKey,
  formatFileSize,
  HEALTH_DOCUMENT_MIME_TYPES,
  HEALTH_FILE_FILTER_LABELS,
  HEALTH_FILE_FILTERS,
  HEALTH_FILE_TYPE_ICONS,
  HEALTH_FILE_TYPE_LABELS,
  HEALTH_PHOTO_MIME_TYPES,
  loadFiles,
  summarizeFiles,
  uploadHealthFile,
  viewFiles,
  type HealthFileEntry,
  type HealthFileFilter,
  type HealthFileWriteResult,
} from '../healthFilesStorage';

/**
 * Files — the donor's "My Files" (`Presentation/Features/Files`, 754 lines),
 * rebuilt on the deployed `/health/files` routes.
 *
 * Six handlers had shipped with no client at all, so nothing in the app could
 * store or read a health document. This is that surface: pick from camera,
 * gallery or the file browser; see what is stored, how big it is and when it
 * arrived; open, save out, or delete.
 *
 * ## What this screen is careful about
 *
 * - **Body photos are named as such.** `body_photo` is the sensitive class in
 *   this domain, so it is a deliberate, separately-labelled upload choice rather
 *   than something a photo silently becomes, and it has its own filter so it can
 *   be found and deleted on purpose.
 * - **A thumbnail is an authenticated request.** There is no public URL for a
 *   health file: `healthFileContentSource` attaches the session token to the
 *   image load. Signed out, the row falls back to its type glyph instead of
 *   firing a request that can only 401.
 * - **No raw error strings.** Every failure comes back from
 *   `healthFilesStorage` already in plain words, mapped by HTTP status.
 *
 * ## Deliberately absent
 *
 * The donor's storage-usage endpoint (`GET /files/storage-usage`) has no
 * counterpart on this Worker, so the header counts what the list actually
 * returned and says so, rather than printing a quota that does not exist.
 * Image cropping before upload is the donor's `RecipeImageCropperView`, a photo
 * editor rather than a file feature; the picker's own edit step covers it.
 */

/** What the member picked, before it is known whether it is a body photo. */
type UploadIntent = 'photo' | 'body_photo' | 'document';

const UPLOAD_LABEL: Record<UploadIntent, string> = {
  photo: 'Photo',
  body_photo: 'Body photo',
  document: 'Document',
};

export function HealthFilesScreen() {
  const colors = useAppColors();

  const [files, setFiles] = useState<HealthFileEntry[]>([]);
  const [filter, setFilter] = useState<HealthFileFilter>('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  /** Photos can be stored as an ordinary photo or as a body photo. */
  const [asBodyPhoto, setAsBodyPhoto] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadFiles()
      .then((next) => {
        if (!cancelled) setFiles(next);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const summary = useMemo(() => summarizeFiles(files), [files]);
  const visible = useMemo(() => viewFiles(files, { filter, query }), [files, filter, query]);

  const applyResult = useCallback((result: HealthFileWriteResult) => {
    setFiles(result.files);
    setMessage(result.message);
  }, []);

  const upload = useCallback(
    async (
      request: { uri: string; name?: string | null; mimeType?: string | null },
      intent: UploadIntent
    ) => {
      setBusy(`Uploading ${UPLOAD_LABEL[intent].toLowerCase()}…`);
      setMessage(null);
      try {
        applyResult(
          await uploadHealthFile({
            uri: request.uri,
            name: request.name,
            mimeType: request.mimeType,
            fileType: intent === 'document' ? 'document' : intent,
          })
        );
      } finally {
        setBusy(null);
      }
    },
    [applyResult]
  );

  const photoIntent: UploadIntent = asBodyPhoto ? 'body_photo' : 'photo';

  /**
   * Camera, gallery, Files and Drive — one list, one set of failure messages.
   *
   * Drive was missing, which is the wrong omission for exactly this screen: a
   * discharge summary or a lab report arrives as a PDF by email and is filed in
   * the household's Drive folder, never in a camera roll. The intent is still
   * decided by the file's own type, not by which source it came from — an image
   * is a photo, anything else is a document.
   */
  const { sourceHandlers, drivePicker } = useAttachmentSources({
    rememberScope: 'health-files',
    mimeTypes: [...HEALTH_DOCUMENT_MIME_TYPES, ...HEALTH_PHOTO_MIME_TYPES],
    pickerOptions: {
      cropping: false,
      compressImageQuality: 0.9,
      mediaType: 'photo',
    },
    // Inline, not an alert: this screen answers every other failure with the
    // `message` line under the tiles, and one modal among them would read as a
    // different class of problem.
    onError: setMessage,
    onPicked: async ([picked]) => {
      if (!picked) return;
      const isImage = (picked.mime ?? '').startsWith('image/');
      await upload(
        { uri: picked.uri, name: picked.name, mimeType: picked.mime },
        isImage ? photoIntent : 'document'
      );
    },
  });

  /**
   * Download to a cache file, then hand it to the system share sheet — which
   * offers both "Save to Files" and app-to-app sending, so no extra media
   * permission is needed. Streams to disk rather than through JS memory: these
   * objects go up to 50MB.
   */
  const handleOpen = useCallback(async (file: HealthFileEntry) => {
    const source = healthFileContentSource(file.contentPath);
    if (!source) {
      setMessage('Please sign in again to open this file.');
      return;
    }
    setBusy('Preparing…');
    setMessage(null);
    try {
      if (!(await Sharing.isAvailableAsync())) {
        setMessage('This device cannot open files from here.');
        return;
      }
      const safeName = file.name.replace(/[^\w.\-() ]+/g, '_') || 'file';
      const target = `${FileSystem.cacheDirectory}health-file-${Date.now()}-${safeName}`;
      const { uri } = await FileSystem.downloadAsync(source.uri, target, {
        headers: source.headers,
      });
      await Sharing.shareAsync(uri, { mimeType: file.mimeType, dialogTitle: file.name });
    } catch {
      setMessage('That file could not be opened. Check your connection and try again.');
    } finally {
      setBusy(null);
    }
  }, []);

  const handleDelete = useCallback(
    (file: HealthFileEntry) => {
      Alert.alert(
        'Delete this file?',
        `“${file.name}” will be removed from your account. This cannot be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              setBusy('Deleting…');
              void deleteHealthFile(file.id)
                .then(applyResult)
                .finally(() => setBusy(null));
            },
          },
        ]
      );
    },
    [applyResult]
  );

  return (
    <HealthSectionScreen title="Files" testID="health-files-screen" loading={loading}>
      <Card
        variant="filled"
        style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
        testID="health-files-summary"
      >
        <HealthStatTiles
          stats={[
            { label: 'Files', value: String(summary.total), testID: 'health-files-stat-total' },
            {
              label: 'Photos',
              value: String(summary.photos + summary.bodyPhotos),
              testID: 'health-files-stat-photos',
            },
            {
              label: 'Documents',
              value: String(summary.documents),
              testID: 'health-files-stat-documents',
            },
          ]}
        />
        <Typography variant="caption2" color={colors.textSecondary}>
          {summary.total === 0
            ? 'Nothing stored yet.'
            : `${formatFileSize(summary.totalBytes)} across ${summary.total} ${
                summary.total === 1 ? 'file' : 'files'
              }.`}
        </Typography>
      </Card>

      <Card
        variant="filled"
        style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
        testID="health-files-add"
      >
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          ADD A FILE
        </Typography>

        {/* Body photos are the sensitive class, so storing one is an explicit
            choice rather than something a photo silently becomes. */}
        <Pressable
          onPress={() => setAsBodyPhoto((prev) => !prev)}
          accessibilityRole="switch"
          accessibilityState={{ checked: asBodyPhoto }}
          accessibilityLabel="Store photos as body photos"
          testID="health-files-body-toggle"
          style={[styles.toggleRow, { borderColor: colors.borderColor }]}
        >
          <Icon
            name={asBodyPhoto ? 'checkbox-outline' : 'square-outline'}
            size={20}
            color={asBodyPhoto ? colors.primary : colors.textSecondary}
          />
          <View style={styles.toggleText}>
            <Typography variant="footnote" weight="semibold" color={colors.textPrimary}>
              Store photos as body photos
            </Typography>
            <Typography variant="caption2" color={colors.textSecondary}>
              Kept apart from ordinary photos so progress shots are easy to find — and easy to
              delete.
            </Typography>
          </View>
        </Pressable>

        <ScanImportSources
          {...sourceHandlers}
          disabled={busy !== null}
          testIDPrefix="health-files"
        />
        <Typography variant="caption2" color={colors.textSecondary}>
          Photos (JPEG, PNG, WebP, HEIC), PDFs and plain text, up to{' '}
          {formatFileSize(50 * 1024 * 1024)} each.
        </Typography>
      </Card>

      {message !== null && (
        <Card
          variant="filled"
          style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
          testID="health-files-message"
        >
          <Typography variant="footnote" color={colors.textSecondary} accessibilityLabel={message}>
            {message}
          </Typography>
        </Card>
      )}

      <Card
        variant="filled"
        style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
        testID="health-files-list"
      >
        <View style={styles.chipRow}>
          {HEALTH_FILE_FILTERS.map((key) => {
            const selected = filter === key;
            return (
              <Pressable
                key={key}
                onPress={() => setFilter(key)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={HEALTH_FILE_FILTER_LABELS[key]}
                testID={`health-files-filter-${key}`}
                style={[
                  styles.chip,
                  {
                    backgroundColor: selected ? colors.primary : 'transparent',
                    borderColor: selected ? colors.primary : colors.borderColor,
                  },
                ]}
              >
                <Typography
                  variant="caption1"
                  weight="semibold"
                  color={selected ? colors.white : colors.textSecondary}
                >
                  {HEALTH_FILE_FILTER_LABELS[key]}
                </Typography>
              </Pressable>
            );
          })}
        </View>

        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search by name"
          placeholderTextColor={colors.textSecondary}
          accessibilityLabel="Search files"
          testID="health-files-search"
          style={[
            styles.input,
            { borderColor: colors.borderColor, color: colors.textPrimary },
          ]}
        />

        {visible.length === 0 ? (
          <Typography variant="footnote" color={colors.textSecondary} testID="health-files-empty">
            {files.length === 0
              ? 'No files yet. Anything you add here stays private to your account.'
              : 'Nothing matches that filter.'}
          </Typography>
        ) : (
          visible.map((file) => (
            <FileRow
              key={file.id}
              file={file}
              onOpen={() => void handleOpen(file)}
              onDelete={() => handleDelete(file)}
            />
          ))
        )}
      </Card>

      <ProcessingOverlay visible={busy !== null} message={busy ?? 'Working…'} />
      {drivePicker}
    </HealthSectionScreen>
  );
}

/* ==================================================================== */
/* Row                                                                   */
/* ==================================================================== */

function FileRow({
  file,
  onOpen,
  onDelete,
}: {
  file: HealthFileEntry;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const colors = useAppColors();
  // Resolved per render rather than memoised: the token can be refreshed
  // mid-session, and a stale header would 401 the thumbnail forever.
  const source = file.isImage ? healthFileContentSource(file.contentPath) : null;

  return (
    <View style={[styles.row, { borderTopColor: colors.borderColor }]} testID={`health-file-${file.id}`}>
      {source ? (
        <Image
          source={source}
          style={styles.thumb}
          accessibilityLabel={file.name}
          testID={`health-file-thumb-${file.id}`}
        />
      ) : (
        <View style={[styles.thumb, styles.thumbFallback, { backgroundColor: colors.backgroundMain }]}>
          <Icon name={HEALTH_FILE_TYPE_ICONS[file.type]} size={20} color={colors.textSecondary} />
        </View>
      )}

      <Pressable style={styles.rowBody} onPress={onOpen} accessibilityRole="button" accessibilityLabel={`Open ${file.name}`}>
        <Typography variant="footnote" weight="semibold" color={colors.textPrimary} numberOfLines={1}>
          {file.name}
        </Typography>
        <Typography variant="caption2" color={colors.textSecondary}>
          {HEALTH_FILE_TYPE_LABELS[file.type]} · {formatFileSize(file.sizeBytes)} ·{' '}
          {fileDayKey(file.createdAt)}
        </Typography>
      </Pressable>

      <Pressable
        onPress={onDelete}
        accessibilityRole="button"
        accessibilityLabel={`Delete ${file.name}`}
        testID={`health-file-delete-${file.id}`}
        hitSlop={8}
      >
        <Typography variant="caption1" weight="semibold" color={colors.error}>
          Delete
        </Typography>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.md,
    gap: Spacing.smd,
  },
  sectionLabel: {
    letterSpacing: 0.6,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  chip: {
    paddingHorizontal: Spacing.smd,
    paddingVertical: Spacing.xs,
    borderRadius: CornerRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: CornerRadius.md,
    paddingHorizontal: Spacing.smd,
    paddingVertical: Spacing.sm,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    padding: Spacing.smd,
    borderRadius: CornerRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  toggleText: {
    flex: 1,
    gap: Spacing.xxs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.smd,
    paddingTop: Spacing.smd,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowBody: {
    flex: 1,
    gap: Spacing.xxs,
  },
  thumb: {
    width: 44,
    height: 44,
    borderRadius: CornerRadius.sm,
  },
  thumbFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
