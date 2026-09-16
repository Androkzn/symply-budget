import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { useTheme } from '@contexts/ThemeContext';
import { CornerRadius, IconSize, Spacing, useAppColors } from '@theme';

export type ScanImportSourceKey = 'camera' | 'gallery' | 'file' | 'drive';

interface SourceMeta {
  /** Ionicons glyph name. */
  icon: string;
  label: string;
}

const SOURCE_META: Record<ScanImportSourceKey, SourceMeta> = {
  camera: { icon: 'camera-outline', label: 'Camera' },
  gallery: { icon: 'images-outline', label: 'Gallery' },
  file: { icon: 'document-text-outline', label: 'File' },
  drive: { icon: 'cloud-outline', label: 'Drive' },
};

// Canonical left-to-right order; a tile renders only when its handler is set.
const ORDER: ScanImportSourceKey[] = ['camera', 'gallery', 'file', 'drive'];

interface ScanImportSourcesProps {
  onCamera?: () => void;
  onGallery?: () => void;
  onFile?: () => void;
  onDrive?: () => void;
  /** Explicit subset/order. Defaults to every source that has a handler. */
  sources?: ScanImportSourceKey[];
  disabled?: boolean;
  /** Icon tint. Defaults to the pastel teal shared across scan/import surfaces. */
  accentColor?: string;
  /** Per-tile testID = `${testIDPrefix}-${source}` (e.g. `budget-receipt-camera`). */
  testIDPrefix?: string;
}

/**
 * The shared Camera · Gallery · File · Drive tile row for every "Scan / import
 * (AI)" surface (receipt scan, savings import, mortgage statement). One picker
 * UI — icons, tint, and spacing live here so no screen re-forks plain buttons.
 * Pass only the handlers you support (Drive typically opens a `CloudFilePicker`).
 */
export function ScanImportSources({
  onCamera,
  onGallery,
  onFile,
  onDrive,
  sources,
  disabled,
  accentColor,
  testIDPrefix,
}: ScanImportSourcesProps) {
  const colors = useAppColors();
  const { theme } = useTheme();
  const tint = accentColor ?? theme.pastel.teal;

  const handlers: Record<ScanImportSourceKey, (() => void) | undefined> = {
    camera: onCamera,
    gallery: onGallery,
    file: onFile,
    drive: onDrive,
  };
  const visible = (sources ?? ORDER).filter((key) => handlers[key]);

  return (
    <View style={styles.row}>
      {visible.map((key) => {
        const meta = SOURCE_META[key];
        return (
          <TouchableOpacity
            key={key}
            style={[
              styles.button,
              { backgroundColor: colors.backgroundSecondary, borderColor: colors.borderColor },
            ]}
            onPress={handlers[key]}
            disabled={disabled}
            testID={testIDPrefix ? `${testIDPrefix}-${key}` : undefined}
          >
            <Icon name={meta.icon} size={IconSize.lg} color={tint} />
            <Typography variant="caption1" weight="semibold" color={colors.textPrimary}>
              {meta.label}
            </Typography>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.smd },
  button: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.base + Spacing.xxs,
    borderRadius: CornerRadius.md + Spacing.xxs,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
