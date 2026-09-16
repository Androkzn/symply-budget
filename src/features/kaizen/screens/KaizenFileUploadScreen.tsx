import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { BrandButton } from '@features/kaizen/brand';
import { useBrandIconState } from '@features/kaizen/brand/iconset';
import { KaizenFileUploadPanel } from '@features/kaizen/components/KaizenFileUploadPanel';
import { Spacing, Typography } from '@features/kaizen/theme/designTokens';
import {
  scopeToImportPurpose,
  type KaizenImportPurpose,
} from '@features/kaizen/upload/importHandlers';
import { importPanelConfig } from '@features/kaizen/upload/KaizenImportUploadSection';
import {
  KAIZEN_DRIVE_SCOPES,
  type KaizenDriveRememberScope,
  type KaizenUploadedFile,
} from '@features/kaizen/upload/rememberScopes';
import { resolveImportPurpose, useKaizenFileImport } from '@features/kaizen/upload/useKaizenFileImport';
import { useAppColors } from '@theme';

import { KaizenScreen } from './common';

function firstParam(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? '' : v ?? '';
}

function parseScope(raw: string): KaizenDriveRememberScope {
  const values = Object.values(KAIZEN_DRIVE_SCOPES) as string[];
  if (values.includes(raw)) return raw as KaizenDriveRememberScope;
  return KAIZEN_DRIVE_SCOPES.general;
}

function parseAllowAll(raw: string): boolean {
  return raw === '1' || raw === 'true';
}

function parsePurpose(raw: string, scope: KaizenDriveRememberScope): KaizenImportPurpose {
  const allowed: KaizenImportPurpose[] = ['resume', 'questions', 'book', 'knowledge', 'auto'];
  if (allowed.includes(raw as KaizenImportPurpose)) return raw as KaizenImportPurpose;
  return scopeToImportPurpose(scope);
}

export function KaizenFileUploadScreen() {
  const colors = useAppColors();
  const headerIconState = useBrandIconState(true);
  const params = useLocalSearchParams<{
    scope?: string;
    purpose?: string;
    title?: string;
    subtitle?: string;
    allowAll?: string;
    mime?: string;
    bookId?: string;
  }>();

  const scope = parseScope(firstParam(params.scope) || KAIZEN_DRIVE_SCOPES.general);
  const purpose = parsePurpose(firstParam(params.purpose), scope);
  const panel = importPanelConfig(purpose);
  const HeaderIcon = panel.HeaderIcon;
  const title = firstParam(params.title) || panel.title;
  const subtitle =
    firstParam(params.subtitle) ||
    'Choose from camera, gallery, device files, or Google Drive. Each area remembers its own Drive folder.';
  const allowAllFileTypes = parseAllowAll(firstParam(params.allowAll)) || panel.allowAllFileTypes;
  const mimeParam = firstParam(params.mime);
  const mimeTypeFilter =
    mimeParam?.split(',').map(s => s.trim()).filter(Boolean) ?? panel.mimeTypeFilter;
  const bookId = firstParam(params.bookId) || undefined;

  const [selected, setSelected] = useState<KaizenUploadedFile | null>(null);
  const { importFile, busy } = useKaizenFileImport(resolveImportPurpose(purpose), {
    bookId,
    navigateAfterImport: false,
  });

  const confirm = async () => {
    if (!selected) return;
    const result = await importFile(selected);
    if (!result) return;
    Alert.alert('Saved', result.message, [
      {
        text: 'OK',
        onPress: () => router.back(),
      },
    ]);
  };

  return (
    <KaizenScreen title={title} subtitle={subtitle} showBackButton>
      <KaizenFileUploadPanel
        title="Choose a source"
        subtitle="Google Drive opens with the folder you last used for this area."
        rememberScope={scope}
        allowAllFileTypes={allowAllFileTypes}
        mimeTypeFilter={mimeTypeFilter}
        selectedFileName={selected?.name ?? null}
        onClearSelection={() => setSelected(null)}
        onFileSelected={file => {
          setSelected(file);
        }}
        headerIcon={
          <HeaderIcon size={26} state={headerIconState} color={colors.primary} />
        }
      />

      {selected ? (
        <View style={styles.footer}>
          <Text style={[styles.fileMeta, { color: colors.textSecondary }]}>
            Ready: {selected.name}
          </Text>
          <BrandButton title="Save to Kaizen" loading={busy} onPress={() => void confirm()} />
        </View>
      ) : null}
    </KaizenScreen>
  );
}

const styles = StyleSheet.create({
  footer: {
    marginTop: Spacing.lg,
    gap: Spacing.md,
    paddingHorizontal: Spacing.xs,
  },
  fileMeta: {
    fontSize: Typography.caption.size,
    textAlign: 'center',
  },
});
