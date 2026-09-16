import * as DocumentPicker from 'expo-document-picker';
import { useState, useEffect, useRef, type ComponentType, type ReactNode } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { CloudFilePicker } from '@components/cloud-storage';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { GlassCard } from '@features/kaizen/brand';
import {
  DriveImportIcon,
  HighlightIcon,
  ImportIcon,
  SkippedIcon,
  useBrandIconState,
  VideosIcon,
  type BrandGlyphProps,
} from '@features/kaizen/brand/iconset';
import { useAppColors } from '@features/kaizen/theme/appColors';
import { GlassRadius, Spacing, Typography } from '@features/kaizen/theme/designTokens';
import ImageCropPicker from '@services/image-picker-compat';
import { isPickerPermissionError, presentPickerPermissionDeniedAlert } from '@utils/pickerPermissionAlert';

import type { KaizenDriveRememberScope, KaizenUploadedFile } from '../upload/rememberScopes';

type SourceKey = 'camera' | 'gallery' | 'file' | 'drive';

type SourceOption = {
  key: SourceKey;
  label: string;
  testID: string;
  Icon: ComponentType<BrandGlyphProps>;
};

const SOURCE_OPTIONS: SourceOption[] = [
  { key: 'camera', label: 'Take Photo', testID: 'kaizen-upload-source-camera', Icon: HighlightIcon },
  { key: 'gallery', label: 'Gallery', testID: 'kaizen-upload-source-gallery', Icon: VideosIcon },
  { key: 'file', label: 'Upload File', testID: 'kaizen-upload-source-file', Icon: ImportIcon },
  { key: 'drive', label: 'Google Drive', testID: 'kaizen-upload-source-drive', Icon: DriveImportIcon },
];

const DEFAULT_DOCUMENT_TYPES = [
  'application/pdf',
  'text/*',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type KaizenFileUploadPanelProps = {
  title: string;
  subtitle?: string;
  /** Optional brushed icon beside the title (defaults to Import). */
  headerIcon?: ReactNode;
  rememberScope: KaizenDriveRememberScope;
  onFileSelected: (file: KaizenUploadedFile) => void | Promise<void>;
  mimeTypeFilter?: string | string[];
  /** When true, device + Drive pickers accept any file type. */
  allowAllFileTypes?: boolean;
  disabled?: boolean;
  loading?: boolean;
  selectedFileName?: string | null;
  onClearSelection?: () => void;
  showCamera?: boolean;
  autoRemember?: boolean;
};

function inferMimeFromName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'pdf':
      return 'application/pdf';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'txt':
      return 'text/plain';
    case 'doc':
      return 'application/msword';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    default:
      return 'application/octet-stream';
  }
}

export function KaizenFileUploadPanel({
  title,
  subtitle,
  headerIcon,
  rememberScope,
  onFileSelected,
  mimeTypeFilter,
  allowAllFileTypes = false,
  disabled = false,
  loading = false,
  selectedFileName,
  onClearSelection,
  showCamera = true,
  autoRemember = false,
}: KaizenFileUploadPanelProps) {
  const colors = useAppColors();
  const appColors = useAppColors();
  const tileIconState = useBrandIconState(true);
  const mutedIconState = useBrandIconState(false);
  const [showDrivePicker, setShowDrivePicker] = useState(false);
  const [picking, setPicking] = useState(false);
  const onFileSelectedRef = useRef(onFileSelected);
  onFileSelectedRef.current = onFileSelected;

  const busy = disabled || loading || picking;
  const visibleSources = showCamera
    ? SOURCE_OPTIONS
    : SOURCE_OPTIONS.filter(option => option.key !== 'camera');

  const deliver = async (file: KaizenUploadedFile) => {
    setPicking(true);
    try {
      await onFileSelectedRef.current(file);
    } finally {
      setPicking(false);
    }
  };
  const deliverRef = useRef(deliver);
  deliverRef.current = deliver;

  useEffect(() => {
    if (!__DEV__) return;
    const { registerE2EUploadDeliver } =
      require('@services/e2e-document-pick') as typeof import('@services/e2e-document-pick');
    registerE2EUploadDeliver(async file => {
      await deliverRef.current(file);
    });
    return () => registerE2EUploadDeliver(null);
  }, []);

  const handleCamera = async () => {
    try {
      setPicking(true);
      const image = await ImageCropPicker.openCamera({
        cropping: false,
        compressImageQuality: 0.85,
      });
      const name = image.filename || 'photo.jpg';
      await deliver({
        uri: image.path,
        name,
        size: image.size,
        mime: image.mime || 'image/jpeg',
      });
    } catch (error) {
      if (isPickerPermissionError(error)) {
        presentPickerPermissionDeniedAlert('camera');
      } else if ((error as { code?: string }).code !== 'E_PICKER_CANCELLED') {
        Alert.alert('Camera error', 'Could not take a photo. Please try again.');
      }
    } finally {
      setPicking(false);
    }
  };

  const handleGallery = async () => {
    try {
      setPicking(true);
      const image = await ImageCropPicker.openPicker({
        cropping: false,
        compressImageQuality: 0.85,
        mediaType: 'photo',
      });
      const name = image.filename || 'photo.jpg';
      await deliver({
        uri: image.path,
        name,
        size: image.size,
        mime: image.mime || 'image/jpeg',
      });
    } catch (error) {
      if (isPickerPermissionError(error)) {
        presentPickerPermissionDeniedAlert('library');
      } else if ((error as { code?: string }).code !== 'E_PICKER_CANCELLED') {
        Alert.alert('Gallery error', 'Could not pick an image. Please try again.');
      }
    } finally {
      setPicking(false);
    }
  };

  const handleDocument = async () => {
    try {
      setPicking(true);
      if (__DEV__) {
        const pickMod =
          require('@services/e2e-document-pick') as typeof import('@services/e2e-document-pick');
        // An ALREADY-queued fixture is consumed straight away. Deliberately no
        // wait loop: every Maestro flow fires `kaizen://e2e-pick` BEFORE tapping
        // this tile, and a link that lands after the tap is auto-applied by the
        // registerE2EUploadDeliver() effect above (which retries on its own).
        // Polling unconditionally froze this tile on "Working…" for 5s before the
        // real picker opened in EVERY dev build, E2E session or not.
        if (pickMod.hasPendingE2EDocumentPick()) {
          const e2eFile = await pickMod.consumeE2EDocumentPick();
          if (e2eFile) {
            await deliver(e2eFile);
            return;
          }
        }
      }
      const result = await DocumentPicker.getDocumentAsync({
        type: allowAllFileTypes ? '*/*' : [...DEFAULT_DOCUMENT_TYPES],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      await deliver({
        uri: asset.uri,
        name: asset.name,
        size: asset.size,
        mime: asset.mimeType ?? inferMimeFromName(asset.name),
      });
    } catch {
      Alert.alert('File error', 'Could not pick a file. Please try again.');
    } finally {
      setPicking(false);
    }
  };

  const handleSourcePress = (key: SourceKey) => {
    if (busy) return;
    switch (key) {
      case 'camera':
        void handleCamera();
        break;
      case 'gallery':
        void handleGallery();
        break;
      case 'file':
        void handleDocument();
        break;
      case 'drive':
        setShowDrivePicker(true);
        break;
    }
  };

  const handleDriveFileSelected = (file: { uri: string; name: string; size: number }) => {
    setShowDrivePicker(false);
    void deliver({
      uri: file.uri,
      name: file.name,
      size: file.size,
      mime: inferMimeFromName(file.name),
    });
  };

  const resolvedHeaderIcon =
    headerIcon ?? <ImportIcon size={24} state={tileIconState} color={colors.primary} />;

  return (
    <GlassCard padding={Spacing.base} radius={GlassRadius.cardTight}>
      <View style={styles.headerRow}>
        {resolvedHeaderIcon}
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
          {subtitle ? (
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</Text>
          ) : null}
        </View>
      </View>

      {selectedFileName ? (
        <View
          style={[
            styles.selectedRow,
            {
              backgroundColor: appColors.surfaceSelected,
              borderColor: appColors.glassBorder,
            },
          ]}
        >
          <ImportIcon size={22} state={tileIconState} color={colors.primary} />
          <Text
            testID="kaizen-upload-selected-file"
            style={[styles.selectedName, { color: colors.textPrimary }]}
            numberOfLines={1}
          >
            {selectedFileName}
          </Text>
          {onClearSelection ? (
            <Pressable onPress={onClearSelection} hitSlop={8} accessibilityLabel="Clear file">
              <SkippedIcon size={22} state={mutedIconState} color={colors.textSecondary} />
            </Pressable>
          ) : null}
        </View>
      ) : (
        <View style={styles.tilesRow} testID="kaizen-upload-sources">
          {visibleSources.map(option => {
            const TileIcon = option.Icon;
            return (
              <Pressable
                key={option.key}
                style={[
                  styles.tile,
                  {
                    backgroundColor: appColors.glassFill,
                    borderColor: appColors.glassBorder,
                  },
                  busy && styles.tileDisabled,
                ]}
                onPress={() => handleSourcePress(option.key)}
                disabled={busy}
                accessibilityLabel={option.label}
                testID={option.testID}
              >
                <View
                  style={[
                    styles.tileIcon,
                    { backgroundColor: appColors.surfaceSelected },
                  ]}
                >
                  <TileIcon size={24} state={tileIconState} color={colors.primary} />
                </View>
                <Text style={[styles.tileLabel, { color: colors.textPrimary }]} numberOfLines={2}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {(loading || picking) && (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={colors.primary} />
          <Text style={{ color: colors.textSecondary }}>Working…</Text>
        </View>
      )}

      <Text style={[styles.formats, { color: colors.textTertiary }]}>
        {allowAllFileTypes
          ? 'Any file type · PDF, images, documents, spreadsheets, and more'
          : 'PDF, images, Word, Excel, and plain text'}
      </Text>

      <CloudFilePicker
        visible={showDrivePicker}
        provider="google-drive"
        rememberScope={rememberScope}
        autoRemember={autoRemember}
        allowAllFileTypes={allowAllFileTypes}
        mimeTypeFilter={allowAllFileTypes ? undefined : mimeTypeFilter}
        onClose={() => setShowDrivePicker(false)}
        onFileSelected={handleDriveFileSelected}
      />
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    marginBottom: Spacing.xs,
  },
  headerText: { flex: 1, gap: Spacing.xxs },
  title: {
    fontSize: Typography.title.size,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  subtitle: {
    fontSize: Typography.body.size,
    lineHeight: Typography.body.lineHeight,
  },
  tilesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  tile: {
    width: '47%',
    flexGrow: 1,
    minHeight: 104,
    borderRadius: GlassRadius.button,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  tileDisabled: {
    opacity: 0.55,
  },
  tileIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: {
    fontSize: Typography.caption.size,
    fontWeight: '700',
    textAlign: 'center',
  },
  selectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: GlassRadius.button,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.md,
    marginTop: Spacing.sm,
  },
  selectedName: {
    flex: 1,
    fontSize: Typography.body.size,
    fontWeight: '600',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  formats: {
    fontSize: Typography.caption.size,
    textAlign: 'center',
    marginTop: Spacing.sm,
  },
});
