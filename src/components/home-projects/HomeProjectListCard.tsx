/**
 * One row of the Home Projects list.
 *
 * The card this replaces was two lines tall — a title and `status · type` — for
 * a record that carries a budget, a schedule, a summary and a cover photo. A
 * member scanning five renovations could not tell which one was over budget,
 * which one starts next week, or which room any of them was even about.
 *
 * The cover is the reason the card is tall: a photo at thumbnail size is
 * decoration, at 120pt it is how you recognise "the upstairs bathroom" without
 * reading. The two backends address those bytes differently and NEITHER can
 * render the other's — a server-backed row carries `cover_url`, a local-first
 * row carries `cover_blob`, the sealed descriptor only `HouseBlobImage` opens
 * (the same split the hub's photo rows handle). A project with neither gets the
 * placeholder, which doubles as the add-a-photo affordance.
 */
import React from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import type { HomeProject } from '@api/home-projects';
import { HouseBlobImage } from '@components/house-v2/HouseBlobImage';
import { Icon } from '@components/ui/Icon';
import { Typography } from '@components/ui/Typography';
import { normalizeHomeProjectVisibility } from '@symply/contracts';
import { useAppColors, type AppColors } from '@theme';
import { formatMoney } from '@utils/money';

/** Card height, and with it the cover rail — three times the old two-line row. */
const CARD_HEIGHT = 186;
const COVER_WIDTH = 124;

interface HomeProjectListCardProps {
  project: HomeProject;
  onPress: () => void;
  /** Opens the add / change / remove sheet. Omit to render the cover inert. */
  onPressCover?: () => void;
  /**
   * Opens the rename sheet. Omit and the pencil is not drawn at all — a
   * read-only caller must not offer an edit it cannot carry out.
   */
  onPressRename?: () => void;
}

type StatusTone = { label: string; color: (c: AppColors) => string };

/**
 * The seven `home_projects.status` values (`patchProjectSchema`). Labour Hub's
 * `PROJECT_STATUS_INFO` is a different feature with a different vocabulary —
 * borrowing it would have mislabelled every row.
 */
const STATUS_TONE: Record<string, StatusTone> = {
  idea: { label: 'Idea', color: (c) => c.textTertiary },
  planning: { label: 'Planning', color: (c) => c.info },
  ready: { label: 'Ready', color: (c) => c.primary },
  in_progress: { label: 'In progress', color: (c) => c.warning },
  on_hold: { label: 'On hold', color: (c) => c.error },
  done: { label: 'Done', color: (c) => c.success },
  archived: { label: 'Archived', color: (c) => c.textTertiary },
};

function titleCase(value: string): string {
  const spaced = value.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Whole days between today and an ISO date, floored to midnight on both sides so
 * "tomorrow" never reads as "in 0 days" because of the clock.
 */
function daysUntil(iso: string): number | null {
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return null;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - start.getTime()) / 86_400_000);
}

function formatDate(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * The schedule line, which says something different depending on where the
 * project sits relative to its target end date. An overdue renovation is the one
 * fact on this card a member most needs to see without opening anything.
 */
function scheduleLabel(project: HomeProject): { text: string; overdue: boolean } | null {
  const { target_start_at: startAt, target_end_at: endAt } = project;
  if (endAt) {
    const days = daysUntil(endAt);
    const formatted = formatDate(endAt);
    if (days === null || !formatted) return null;
    if (project.status === 'done') return { text: `Finished ${formatted}`, overdue: false };
    if (days < 0) {
      const overdueBy = Math.abs(days);
      return { text: `${overdueBy}d overdue · due ${formatted}`, overdue: true };
    }
    if (days === 0) return { text: `Due today`, overdue: true };
    return { text: `Due ${formatted} · ${days}d left`, overdue: false };
  }
  if (startAt) {
    const days = daysUntil(startAt);
    const formatted = formatDate(startAt);
    if (days === null || !formatted) return null;
    return { text: days > 0 ? `Starts ${formatted}` : `Started ${formatted}`, overdue: false };
  }
  return null;
}

export function HomeProjectListCard({
  project,
  onPress,
  onPressCover,
  onPressRename,
}: HomeProjectListCardProps) {
  const colors = useAppColors();
  const tone = STATUS_TONE[project.status] ?? {
    label: titleCase(project.status),
    color: (c: AppColors) => c.textTertiary,
  };
  const statusColor = tone.color(colors);
  const schedule = scheduleLabel(project);
  const hasCover = !!project.cover_blob || !!project.cover_url;
  const isDraft = normalizeHomeProjectVisibility(project.visibility) === 'draft';

  const coverLabel = hasCover
    ? `Cover photo for ${project.title}. Tap to change or remove it.`
    : `Add a cover photo for ${project.title}`;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${project.title}. ${tone.label}. ${titleCase(project.type)}`}
      accessibilityHint="Opens the project hub"
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.borderColor }]}
      testID={`home-project-${project.id}`}
    >
      {/*
        Its own Pressable, not the card's: tapping a photo to manage the photo is
        what a member expects, and routing it through the card would open the hub
        instead. `onPressCover` absent (a read-only caller) leaves it inert.
      */}
      <Pressable
        onPress={onPressCover}
        disabled={!onPressCover}
        accessibilityRole={onPressCover ? 'button' : 'image'}
        accessibilityLabel={coverLabel}
        style={[styles.cover, { backgroundColor: colors.cardSubtle }]}
        testID={`home-project-cover-${project.id}`}
      >
        {project.cover_blob ? (
          <HouseBlobImage
            descriptor={project.cover_blob}
            width={COVER_WIDTH}
            height={CARD_HEIGHT}
            accessibilityLabel={`Cover photo for ${project.title}`}
            testID={`home-project-cover-blob-${project.id}`}
          />
        ) : project.cover_url ? (
          <Image
            source={{ uri: project.cover_url }}
            style={styles.coverImage}
            accessibilityLabel={`Cover photo for ${project.title}`}
            testID={`home-project-cover-remote-${project.id}`}
          />
        ) : (
          <View style={styles.coverEmpty} testID={`home-project-cover-empty-${project.id}`}>
            <Icon name="image-outline" size={26} color={colors.textTertiary} />
            {onPressCover ? (
              <Typography variant="caption2" color={colors.textTertiary} align="center">
                Add photo
              </Typography>
            ) : null}
          </View>
        )}

        {/* Only meaningful once there is a photo to change — an empty tile already says "Add photo". */}
        {hasCover && onPressCover ? (
          <View style={[styles.coverBadge, { backgroundColor: colors.card }]}>
            <Icon name="camera-outline" size={14} color={colors.textSecondary} />
          </View>
        ) : null}
      </Pressable>

      <View style={styles.body}>
        <View style={styles.badgeRow}>
          <View style={[styles.statusPill, { backgroundColor: `${statusColor}1F` }]}>
            <Typography variant="caption2" weight="semibold" color={statusColor}>
              {tone.label}
            </Typography>
          </View>
          {/*
            The one fact about a project that is invisible from its content:
            nobody else can see it. Rendered on the card and not only under the
            Drafts tab, because the same card appears in search results and on
            the home dashboard, where there is no tab to infer it from.
          */}
          {isDraft ? (
            <View
              style={[styles.statusPill, { backgroundColor: colors.cardSubtle }]}
              testID={`home-project-draft-${project.id}`}
            >
              <Typography variant="caption2" weight="semibold" color={colors.textSecondary}>
                Draft
              </Typography>
            </View>
          ) : null}
          <Typography variant="caption2" color={colors.textTertiary} numberOfLines={1}>
            {titleCase(project.type)}
          </Typography>
        </View>

        {/*
          The pencil sits beside the name rather than in the ⋯ menu for the same
          reason the camera sits on the photo: a member fixing a typo is editing
          the thing they are looking at, and the card is where they read it.
          Its own Pressable, or the card's onPress would swallow the tap and open
          the hub instead.
        */}
        <View style={styles.titleRow}>
          <Typography
            variant="headline"
            weight="semibold"
            color={colors.textPrimary}
            numberOfLines={2}
            style={styles.title}
          >
            {project.title}
          </Typography>

          {onPressRename ? (
            <Pressable
              onPress={onPressRename}
              accessibilityRole="button"
              accessibilityLabel={`Rename ${project.title}`}
              // The glyph is 15pt in a 28pt tile — too small a target on its own.
              hitSlop={8}
              style={[styles.renameButton, { backgroundColor: colors.cardSubtle }]}
              testID={`home-project-rename-${project.id}`}
            >
              <Icon name="pencil" size={15} color={colors.textSecondary} />
            </Pressable>
          ) : null}
        </View>

        {project.summary ? (
          <Typography variant="footnote" color={colors.textSecondary} numberOfLines={2}>
            {project.summary}
          </Typography>
        ) : null}

        <View style={styles.metaBlock}>
          {project.target_budget_cents != null ? (
            <View style={styles.metaRow}>
              <Icon name="wallet-outline" size={14} color={colors.textTertiary} />
              <Typography variant="footnote" color={colors.textSecondary} numberOfLines={1}>
                {formatMoney(project.target_budget_cents, { code: project.currency })} budget
                {project.contingency_pct > 0 ? ` · +${project.contingency_pct}% buffer` : ''}
              </Typography>
            </View>
          ) : null}

          {schedule ? (
            <View style={styles.metaRow}>
              <Icon
                name={schedule.overdue ? 'alert-circle-outline' : 'calendar-outline'}
                size={14}
                color={schedule.overdue ? colors.error : colors.textTertiary}
              />
              <Typography
                variant="footnote"
                weight={schedule.overdue ? 'semibold' : 'regular'}
                color={schedule.overdue ? colors.error : colors.textSecondary}
                numberOfLines={1}
              >
                {schedule.text}
              </Typography>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    height: CARD_HEIGHT,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    overflow: 'hidden',
  },
  cover: {
    width: COVER_WIDTH,
    height: CARD_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverImage: { width: COVER_WIDTH, height: CARD_HEIGHT },
  coverEmpty: { alignItems: 'center', justifyContent: 'center', gap: 4 },
  coverBadge: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, padding: 12, gap: 4 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 7 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  // `flexShrink` and NOT `flex: 1`: the row must hug the title so the pencil
  // sits 10pt off the end of the name, not out at the card's right edge with a
  // gap of dead space between them. Shrink is still needed so a long title
  // gives way and wraps instead of pushing the pencil off the card.
  title: { flexShrink: 1, letterSpacing: -0.3 },
  renameButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Pushed to the bottom so budget and schedule line up across cards whose
  // titles and summaries are different lengths.
  metaBlock: { marginTop: 'auto', gap: 3 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
