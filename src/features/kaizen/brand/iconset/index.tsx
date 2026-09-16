/**
 * Kaizen iconset shim.
 *
 * Feature-local adapter that maps every donor `@brand/iconset` glyph onto the
 * ecosystem `<Icon>` primitive. Each glyph names a Kaizen PNG-kit icon name (or
 * a universal Ionicons slug that aliases to one); the ecosystem `<Icon>` renders
 * the active brand PNG kit when a matching name exists and otherwise DEGRADES to
 * the tinted Ionicons glyph named here. Donor screens import these names
 * directly, so the export surface must stay identical.
 *
 * NOTE: names below are the Kaizen kit names
 * (brands/symply-kaizen/src/assets/icons/png/**), not raw Ionicons slugs, so the
 * branded green→blue brushed art renders across the Systems / Guide / More
 * surfaces. Only universal chrome glyphs (checkmark) stay as Ionicons.
 *
 * Donor glyph props are `{ size?, color?, state? }`. `state` is the donor's
 * `SimpleKaizenIconState`; `adapt()` collapses it onto the ecosystem `<Icon>`
 * `active` / `color` / opacity model:
 *   branded-*  → active (brand gradient)   ·  inactive-* → neutral  ·  disabled → dimmed
 */
import React from 'react';

import { Icon, type IconProps } from '@components/ui/Icon';
import { useTheme } from '@contexts/ThemeContext';

/** Rendering states shared by every Kaizen glyph (mirrors the donor enum). */
export type SimpleKaizenIconState =
  | 'branded-dark'
  | 'branded-light'
  | 'inactive-dark'
  | 'inactive-light'
  | 'disabled';

export interface BrandGlyphProps {
  size?: number;
  color?: string;
  state?: SimpleKaizenIconState;
  /** Donor "new API": paint the glyph with the brand gradient (active) when true. */
  gradient?: boolean;
  accessibilityLabel?: string;
  testID?: string;
  style?: IconProps['style'];
}

/** Resolve the icon state from theme + interaction flags (donor signature). */
export function brandIconState(
  isDark: boolean,
  active: boolean,
  disabled = false,
): SimpleKaizenIconState {
  if (disabled) return 'disabled';
  if (active) return isDark ? 'branded-dark' : 'branded-light';
  return isDark ? 'inactive-dark' : 'inactive-light';
}

/** Hook form — reads the active theme and returns the icon state. */
export function useBrandIconState(active: boolean, disabled = false): SimpleKaizenIconState {
  const { isDark } = useTheme();
  return brandIconState(isDark, active, disabled);
}

/** Collapse donor glyph props onto ecosystem `<Icon>` props. */
function adapt({ size, color, state, gradient, accessibilityLabel, testID, style }: BrandGlyphProps): Omit<
  IconProps,
  'name'
> {
  const active = gradient === true || state === 'branded-dark' || state === 'branded-light';
  const disabled = state === 'disabled';
  return {
    size,
    active,
    color,
    accessibilityLabel,
    testID,
    style: disabled ? [{ opacity: 0.42 }, style] : style,
  };
}

/* ------------------------------------------------------------------ Task glyphs */

export const InboxIcon = (p: BrandGlyphProps) => <Icon name="inbox" {...adapt(p)} />;
export const CompleteIcon = (p: BrandGlyphProps) => <Icon name="complete" {...adapt(p)} />;
export const PendingIcon = (p: BrandGlyphProps) => <Icon name="pending" {...adapt(p)} />;
export const LibraryIcon = (p: BrandGlyphProps) => <Icon name="library" {...adapt(p)} />;
export const InterviewIcon = (p: BrandGlyphProps) => <Icon name="interview" {...adapt(p)} />;
export const ProgressIcon = (p: BrandGlyphProps) => <Icon name="progress" {...adapt(p)} />;
export const AssessIcon = (p: BrandGlyphProps) => <Icon name="assess" {...adapt(p)} />;
export const CalendarIcon = (p: BrandGlyphProps) => <Icon name="calendar" {...adapt(p)} />;
export const FocusIcon = (p: BrandGlyphProps) => <Icon name="focus" {...adapt(p)} />;
export const TimerIcon = (p: BrandGlyphProps) => <Icon name="timer" {...adapt(p)} />;
export const ReportsIcon = (p: BrandGlyphProps) => <Icon name="reports" {...adapt(p)} />;
export const SettingsIcon = (p: BrandGlyphProps) => <Icon name="settings" {...adapt(p)} />;
export const RemindersIcon = (p: BrandGlyphProps) => <Icon name="reminders" {...adapt(p)} />;
export const StreaksIcon = (p: BrandGlyphProps) => <Icon name="streaks" {...adapt(p)} />;
export const TrendsIcon = (p: BrandGlyphProps) => <Icon name="trends" {...adapt(p)} />;
export const AchievementsIcon = (p: BrandGlyphProps) => <Icon name="achievements" {...adapt(p)} />;
export const HabitsIcon = (p: BrandGlyphProps) => <Icon name="habits" {...adapt(p)} />;
export const AddIcon = (p: BrandGlyphProps) => <Icon name="add" {...adapt(p)} />;
export const AiCoachIcon = (p: BrandGlyphProps) => <Icon name="ai-coach" {...adapt(p)} />;

/* ------------------------------------------------------------- Life-system glyphs */

// `fallbackIonicon` keeps these degrading to a sensible vector glyph (not the
// "?" missing-glyph box) if a build bakes a kit lacking these brand-only names.
export const HealthIcon = (p: BrandGlyphProps) => (
  <Icon name="health" fallbackIonicon="fitness" {...adapt(p)} />
);
export const CareerSystemIcon = (p: BrandGlyphProps) => (
  <Icon name="career-system" fallbackIonicon="briefcase" {...adapt(p)} />
);
export const MentalIcon = (p: BrandGlyphProps) => (
  <Icon name="mental" fallbackIonicon="happy" {...adapt(p)} />
);
export const RelationshipsIcon = (p: BrandGlyphProps) => (
  <Icon name="relationships" fallbackIonicon="people" {...adapt(p)} />
);
export const AdminIcon = (p: BrandGlyphProps) => (
  <Icon name="admin" fallbackIonicon="file-tray-full" {...adapt(p)} />
);
export const LearningIcon = (p: BrandGlyphProps) => (
  <Icon name="learning" fallbackIonicon="school" {...adapt(p)} />
);
export const FinanceIcon = (p: BrandGlyphProps) => (
  <Icon name="finance" fallbackIonicon="wallet" {...adapt(p)} />
);

/* ---------------------------------------------- Additional glyphs used by screens */

export const TodayIcon = (p: BrandGlyphProps) => <Icon name="today" {...adapt(p)} />;
export const GoalsIcon = (p: BrandGlyphProps) => <Icon name="goals" {...adapt(p)} />;
export const NotesIcon = (p: BrandGlyphProps) => <Icon name="notes" {...adapt(p)} />;
export const ProfileIcon = (p: BrandGlyphProps) => <Icon name="profile" {...adapt(p)} />;
export const SkillsIcon = (p: BrandGlyphProps) => <Icon name="skills" {...adapt(p)} />;
export const PracticeIcon = (p: BrandGlyphProps) => <Icon name="practice" {...adapt(p)} />;
export const InProgressIcon = (p: BrandGlyphProps) => <Icon name="in-progress" {...adapt(p)} />;
export const OnHoldIcon = (p: BrandGlyphProps) => <Icon name="on-hold" {...adapt(p)} />;
export const SkippedIcon = (p: BrandGlyphProps) => <Icon name="skipped" {...adapt(p)} />;

/* ------------------------------------------------ Career / Today / Coach glyphs */

export const CareerIcon = (p: BrandGlyphProps) => <Icon name="career" {...adapt(p)} />;
export const CheckIcon = (p: BrandGlyphProps) => <Icon name="checkmark" {...adapt(p)} />;
export const CoachIcon = (p: BrandGlyphProps) => <Icon name="chat" {...adapt(p)} />;
export const SyncIcon = (p: BrandGlyphProps) => <Icon name="sync" {...adapt(p)} />;

/* --------------------------------------------------------- Import / upload glyphs */

export const ImportIcon = (p: BrandGlyphProps) => <Icon name="import" {...adapt(p)} />;
export const DriveImportIcon = (p: BrandGlyphProps) => (
  <Icon name="drive-import" fallbackIonicon="cloud-download" {...adapt(p)} />
);
export const BackupIcon = (p: BrandGlyphProps) => (
  <Icon name="backup" fallbackIonicon="folder" {...adapt(p)} />
);
export const HighlightIcon = (p: BrandGlyphProps) => (
  <Icon name="highlight" fallbackIonicon="camera" {...adapt(p)} />
);
export const VideosIcon = (p: BrandGlyphProps) => (
  <Icon name="videos" fallbackIonicon="images" {...adapt(p)} />
);
export const ExportIcon = (p: BrandGlyphProps) => <Icon name="export" {...adapt(p)} />;
export const KnowledgeIcon = (p: BrandGlyphProps) => (
  <Icon name="knowledge" fallbackIonicon="bulb" {...adapt(p)} />
);
