import { router } from 'expo-router';
import type { ComponentType } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  ImportIcon,
  InboxIcon,
  InterviewIcon,
  LibraryIcon,
  NotesIcon,
  ProfileIcon,
  useBrandIconState,
  type BrandGlyphProps,
} from '@features/kaizen/brand/iconset';
import { KaizenFileUploadPanel } from '@features/kaizen/components/KaizenFileUploadPanel';
import { useAppColors } from '@features/kaizen/theme/appColors';
import { Spacing, Typography } from '@features/kaizen/theme/designTokens';

import type { KaizenImportPurpose } from './importHandlers';
import {
  KAIZEN_DRIVE_SCOPES,
  type KaizenDriveRememberScope,
} from './rememberScopes';
import { useKaizenFileImport } from './useKaizenFileImport';

type PanelConfig = {
  title: string;
  subtitle: string;
  rememberScope: KaizenDriveRememberScope;
  allowAllFileTypes?: boolean;
  mimeTypeFilter?: string | string[];
  HeaderIcon: ComponentType<BrandGlyphProps>;
};

export function importPanelConfig(purpose: KaizenImportPurpose): PanelConfig {
  switch (purpose) {
    case 'book':
      return {
        title: 'Upload book PDF',
        subtitle: 'Creates a library entry and attaches the PDF for chapter checks.',
        rememberScope: KAIZEN_DRIVE_SCOPES.books,
        mimeTypeFilter: 'application/pdf',
        HeaderIcon: LibraryIcon,
      };
    case 'questions':
      return {
        title: 'Upload question list',
        subtitle: 'Imports lines into pending review before they enter practice banks.',
        rememberScope: KAIZEN_DRIVE_SCOPES.questions,
        allowAllFileTypes: true,
        HeaderIcon: InterviewIcon,
      };
    case 'resume':
      return {
        title: 'Upload resume',
        subtitle: 'Analyzes and saves to your career profile.',
        rememberScope: KAIZEN_DRIVE_SCOPES.resume,
        allowAllFileTypes: true,
        HeaderIcon: ProfileIcon,
      };
    case 'knowledge':
      return {
        title: 'Upload notes or document',
        subtitle: 'Saves text into your PARA knowledge library.',
        rememberScope: KAIZEN_DRIVE_SCOPES.general,
        allowAllFileTypes: true,
        HeaderIcon: NotesIcon,
      };
    default:
      return {
        title: 'Upload a file',
        subtitle: 'Resume, questions, books, or notes — we route it to the right place.',
        rememberScope: KAIZEN_DRIVE_SCOPES.general,
        allowAllFileTypes: true,
        HeaderIcon: ImportIcon,
      };
  }
}

function QuickLink({
  label,
  href,
  Icon,
}: {
  label: string;
  href: string;
  Icon: ComponentType<BrandGlyphProps>;
}) {
  const colors = useAppColors();
  const iconState = useBrandIconState(false);
  return (
    <Pressable
      style={styles.quickLink}
      onPress={() => router.push(href as never)}
      accessibilityLabel={label}
    >
      <Icon size={20} state={iconState} color={colors.primary} />
      <Text style={[styles.link, { color: colors.primary }]}>{label}</Text>
      <Text style={[styles.linkArrow, { color: colors.primary }]}>→</Text>
    </Pressable>
  );
}

export function KaizenImportUploadSection({
  purpose,
  bookId,
  navigateAfterImport = true,
  onImported,
  showQuickLinks = false,
}: {
  purpose: KaizenImportPurpose;
  bookId?: string;
  navigateAfterImport?: boolean;
  onImported?: NonNullable<Parameters<typeof useKaizenFileImport>[1]>['onImported'];
  showQuickLinks?: boolean;
}) {
  const colors = useAppColors();
  const config = importPanelConfig(purpose);
  const headerIconState = useBrandIconState(true);
  const { importFile, busy, lastFileName, clearLastFileName } = useKaizenFileImport(purpose, {
    bookId,
    navigateAfterImport,
    onImported,
  });
  const HeaderIcon = config.HeaderIcon;

  return (
    <View style={styles.wrap} testID="kaizen-import-upload-section">
      <KaizenFileUploadPanel
        {...config}
        headerIcon={
          <HeaderIcon size={26} state={headerIconState} color={colors.primary} />
        }
        loading={busy}
        selectedFileName={lastFileName}
        onClearSelection={clearLastFileName}
        onFileSelected={file => void importFile(file)}
      />
      {showQuickLinks ? (
        <View style={styles.links}>
          <QuickLink label="Resume review" href="/kaizen/resume-review" Icon={ProfileIcon} />
          <QuickLink label="Import questions" href="/kaizen/question-import" Icon={InboxIcon} />
          <QuickLink label="Books" href="/kaizen/books" Icon={LibraryIcon} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.sm },
  links: { gap: Spacing.xxs, marginTop: Spacing.xs },
  quickLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: 44,
    paddingHorizontal: Spacing.xs,
  },
  link: {
    flex: 1,
    fontWeight: '700',
    fontSize: Typography.body.size,
  },
  linkArrow: { fontWeight: '700', fontSize: Typography.body.size },
});
