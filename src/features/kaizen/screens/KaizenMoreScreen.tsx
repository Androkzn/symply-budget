
import { router } from 'expo-router';
import type { ComponentType } from 'react';
import { Pressable, Text, View } from 'react-native';



import { useAIAccessEntry } from '@components/ai/useAIAccessEntry';
import {
  AdminIcon,
  AiCoachIcon,
  CalendarIcon,
  CareerIcon,
  FocusIcon,
  HabitsIcon,
  InterviewIcon,
  LibraryIcon,
  NotesIcon,
  ProfileIcon,
  ProgressIcon,
  SettingsIcon,
  TrendsIcon,
} from '@features/kaizen/brand/iconset';
import { KaizenImportUploadSection } from '@features/kaizen/upload/KaizenImportUploadSection';
import { useAppColors } from '@theme';

import { KaizenScreen, Section, kaizenStyles } from './common';

/**
 * Kaizen "More" tab (shell/tab contract `KaizenMoreScreen`).
 * 1:1 port of the donor `(kaizen)/more.tsx` hub, with route hrefs remapped onto the ecosystem
 * `app/kaizen/*` pushed routes (and `systems`/`coach` pointing at the `/kaizen-systems` and
 * `/mira` tabs).
 */
const overflowSections = [
  ['Books', '/kaizen/books', 'Read & check comprehension'],
  ['Question banks', '/kaizen/banks', 'Practice & FSRS queue'],
  ['Weekly reviews', '/kaizen/reviews', 'Kaizen weekly pause'],
  ['Insights', '/kaizen/insights', 'Momentum & achievements'],
  // AI entry is rendered separately via the shared useAIAccessEntry (gated +
  // identical across brands), not hard-coded here.
  ['Settings', '/kaizen/settings', 'Systems, notifications, AI'],
] as const;

const careerTools = [
  ['Question import', '/kaizen/question-import'],
  ['Interview pipeline', '/kaizen/pipeline'],
  ['Career progress', '/kaizen/career-progress'],
  ['Resume review', '/kaizen/resume-review'],
  ['Career setup', '/kaizen/career-setup'],
] as const;

const systemTools = [
  ['Deep work', '/kaizen/deep-work'],
  ['Habit stacks', '/kaizen/habit-stacks'],
  ['Weekly rotations', '/kaizen/rotations'],
  ['Systems', '/kaizen-systems'],
  ['Guide', '/mira'],
  ['Coach memory', '/kaizen/memory'],
] as const;

type RowIcon = ComponentType<{ size?: number; color?: string }>;

/** Leading brand icon for each destination, keyed by href. */
const rowIcons: Record<string, RowIcon> = {
  '/kaizen/books': LibraryIcon,
  '/kaizen/banks': LibraryIcon,
  '/kaizen/reviews': CalendarIcon,
  '/kaizen/insights': TrendsIcon,
  '/ai-access': AiCoachIcon,
  '/kaizen/settings': SettingsIcon,
  '/kaizen/question-import': LibraryIcon,
  '/kaizen/pipeline': InterviewIcon,
  '/kaizen/career-progress': ProgressIcon,
  '/kaizen/resume-review': ProfileIcon,
  '/kaizen/career-setup': CareerIcon,
  '/kaizen/deep-work': FocusIcon,
  '/kaizen/habit-stacks': HabitsIcon,
  '/kaizen/rotations': CalendarIcon,
  '/kaizen-systems': AdminIcon,
  '/mira': AiCoachIcon,
  '/kaizen/memory': NotesIcon,
  '/symply-apps': AdminIcon,
};

function LinkRow({
  label,
  href,
  detail,
  testID,
}: {
  label: string;
  href: string;
  detail?: string;
  testID?: string;
}) {
  const Icon = rowIcons[href];
  const colors = useAppColors();
  return (
    <Pressable onPress={() => router.push(href as never)} testID={testID}>
      <View style={[kaizenStyles.row, { borderBottomColor: colors.borderColor }]}>
        {Icon ? (
          <Icon size={20} color={colors.primary} />
        ) : (
          /* istanbul ignore next -- every section/career/system href maps to an icon; this null guard is defensive */
          null
        )}
        <View style={kaizenStyles.rowText}>
          <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>{label}</Text>
          {detail ? (
            <Text style={[kaizenStyles.detail, { color: colors.textSecondary }]}>{detail}</Text>
          ) : null}
        </View>
        <Text style={{ color: colors.textTertiary }}>›</Text>
      </View>
    </Pressable>
  );
}

export function KaizenMoreScreen() {
  // Shared AI-access entry — identical gate/destination/copy across every brand.
  const aiEntry = useAIAccessEntry();
  return (
    <KaizenScreen
      variant="root"
      title="More"
      subtitle="Overflow sections plus career and system tools."
      screenTestId="kaizen-more-screen"
    >
      <Section title="Upload & import">
        <KaizenImportUploadSection purpose="auto" showQuickLinks />
      </Section>
      <Section title="Sections">
        {overflowSections.map(([label, href, detail]) => (
          <LinkRow
            key={href}
            label={label}
            href={href}
            detail={detail}
            testID={href === '/kaizen/settings' ? 'kaizen-more-settings' : undefined}
          />
        ))}
        {aiEntry.show && (
          <LinkRow
            label={aiEntry.title}
            href={aiEntry.route}
            detail={aiEntry.subtitle}
            testID="kaizen-more-ai-providers"
          />
        )}
      </Section>
      <Section title="Career tools" testID="kaizen-section-career-tools">
        {careerTools.map(([label, href]) => (
          <LinkRow key={href} label={label} href={href} />
        ))}
      </Section>
      <Section title="Systems & focus">
        {systemTools.map(([label, href]) => (
          <LinkRow key={href} label={label} href={href} />
        ))}
      </Section>
      <Section title="More Symply apps">
        <LinkRow
          label="Symply apps"
          href="/symply-apps"
          detail="Install the family & share your profile"
          testID="kaizen-more-symply-apps"
        />
      </Section>
    </KaizenScreen>
  );
}
