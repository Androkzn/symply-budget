import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View, TouchableOpacity, Animated, Platform, Image } from 'react-native';

import { TIME_EFFORT_LABELS } from '@api/tasks';
import type {
  TaskPrioritySeverity,
  TaskRiskLevel,
  TaskEnrichmentStatus,
  TimeEffort,
} from '@api/tasks';
import { PropertyBadge } from '@components/common/PropertyBadge';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Avatar } from '@components/ui/Avatar';
import { Icon } from '@components/ui/Icon';
import { Typography } from '@components/ui/Typography';
import { useTheme } from '@contexts/ThemeContext';
import { useAppColors, type AppColors } from '@theme';

export type TaskCategory =
  | 'hvac'
  | 'cleaning'
  | 'safety'
  | 'plumbing'
  | 'electrical'
  | 'exterior'
  | 'garden'
  | 'general';

interface HomeTaskCardProps {
  title: string;
  dueText: string;
  /** When the task is due in under a day (or overdue), the due label pulses red. */
  dueUrgent?: boolean;
  category: TaskCategory;
  /** True category name shown on the chip (falls back to the 8-bucket name). */
  categoryLabel?: string;
  /** True category icon shown on the leading tile (falls back to the bucket icon). */
  categoryIconName?: keyof typeof Ionicons.glyphMap;
  /** Task priority/severity — applies semi-transparent bg and shows badge */
  prioritySeverity?: TaskPrioritySeverity;
  onPress?: () => void;
  onMenuPress?: () => void;
  // Multi-property support
  householdId?: string;
  householdName?: string;
  // ===== Smart Task Assistant enrichment =====
  /** When 'pending'/'enriching', the card shows an "Analyzing…" state. */
  enrichmentStatus?: TaskEnrichmentStatus | null;
  /** AI-assessed risk — shown as a chip for high/critical. */
  riskLevel?: TaskRiskLevel | null;
  /** AI-assessed effort tier — shown as a chip (Quick … All day). */
  timeEffort?: TimeEffort | null;
  /** Set when enrichmentStatus='needs_clarification' — shown instead of risk/priority chips. */
  clarificationQuestion?: string | null;
  // ===== Household sharing =====
  /** Assignee display name — shows avatar + label when present. */
  assigneeName?: string | null;
  /** Household space name — shown as a location pill when present. */
  spaceName?: string | null;
  /** Optional profile photo for the assignee. */
  assigneeAvatarUrl?: string | null;
  /** Subtask completion for an at-a-glance progress indicator. */
  subtaskProgress?: { completed: number; total: number } | null;
  /** Blocked tasks show a distinct badge and are excluded from the planner. */
  blocked?: boolean;
  /** Personal tasks show a lock badge — only visible to the creator. */
  isPersonal?: boolean;
  /** Cover image shown on the task card (falls back to category icon). */
  coverPhotoUrl?: string | null;
  testID?: string;
}


const PRIORITY_LABELS: Record<TaskPrioritySeverity, string> = {
  nice_to_have: 'Nice to Have',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
  critical: 'Critical',
};

/**
 * Priority only earns a chip when it's genuinely elevated. Medium and below are
 * the quiet default — surfacing them just adds noise to every card.
 */
const getPriorityChip = (
  colors: AppColors,
  severity: TaskPrioritySeverity
): { label: string; bg: string; fg: string } | null => {
  switch (severity) {
    case 'critical':
      return { label: PRIORITY_LABELS.critical, bg: colors.error + '33', fg: colors.error };
    case 'urgent':
      return { label: PRIORITY_LABELS.urgent, bg: colors.error + '2E', fg: colors.error };
    case 'high':
      return { label: PRIORITY_LABELS.high, bg: colors.warning + '2E', fg: colors.warning };
    default:
      return null;
  }
};

const CATEGORY_ICONS: Record<TaskCategory, keyof typeof Ionicons.glyphMap> = {
  hvac: 'snow',
  cleaning: 'sparkles',
  safety: 'shield-checkmark',
  plumbing: 'water',
  electrical: 'flash',
  exterior: 'home',
  garden: 'leaf',
  general: 'list',
};

const CATEGORY_NAMES: Record<TaskCategory, string> = {
  hvac: 'HVAC',
  cleaning: 'Cleaning',
  safety: 'Safety',
  plumbing: 'Plumbing',
  electrical: 'Electrical',
  exterior: 'Exterior',
  garden: 'Garden',
  general: 'General',
};

const CATEGORY_COLORS: Record<TaskCategory, { bg: string; iconBg: string; glassOverlay: string }> = {
  hvac: { bg: 'rgba(78, 205, 196, 0.12)', iconBg: '#4ED9CC', glassOverlay: 'rgba(78, 205, 196, 0.12)' },
  cleaning: { bg: 'rgba(255, 149, 0, 0.12)', iconBg: '#FFA31A', glassOverlay: 'rgba(255, 149, 0, 0.12)' },
  safety: { bg: 'rgba(93, 173, 226, 0.12)', iconBg: '#66B8E8', glassOverlay: 'rgba(93, 173, 226, 0.12)' },
  plumbing: { bg: 'rgba(33, 150, 243, 0.12)', iconBg: '#3FA3F5', glassOverlay: 'rgba(33, 150, 243, 0.12)' },
  electrical: { bg: 'rgba(255, 214, 0, 0.12)', iconBg: '#FFDD1A', glassOverlay: 'rgba(255, 214, 0, 0.12)' },
  exterior: { bg: 'rgba(139, 195, 74, 0.12)', iconBg: '#98CC5F', glassOverlay: 'rgba(139, 195, 74, 0.12)' },
  garden: { bg: 'rgba(76, 175, 80, 0.14)', iconBg: '#66BB6A', glassOverlay: 'rgba(76, 175, 80, 0.12)' },
  general: { bg: 'rgba(120, 144, 156, 0.12)', iconBg: '#889BA6', glassOverlay: 'rgba(120, 144, 156, 0.12)' },
};

export function HomeTaskCard({
  title,
  dueText,
  dueUrgent,
  category,
  categoryLabel,
  categoryIconName,
  prioritySeverity,
  onPress,
  householdId,
  householdName,
  enrichmentStatus,
  riskLevel,
  timeEffort,
  clarificationQuestion,
  assigneeName,
  assigneeAvatarUrl,
  spaceName,
  subtaskProgress,
  blocked,
  isPersonal,
  coverPhotoUrl,
  testID = 'home-task-card',
}: HomeTaskCardProps) {
  const { theme } = useTheme();
  const colors = useAppColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const categoryColors = CATEGORY_COLORS[category];
  const icon = categoryIconName ?? CATEGORY_ICONS[category];
  const categoryName = categoryLabel ?? CATEGORY_NAMES[category];
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const needsClarification = enrichmentStatus === 'needs_clarification';

  const isAnalyzing = enrichmentStatus === 'pending' || enrichmentStatus === 'enriching';
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const urgentPulse = useRef(new Animated.Value(1)).current;

  // Trace enrichment-status transitions so the full capture→analyze→enriched
  // lifecycle is visible in the JS console while testing voice capture.
  useEffect(() => {
    console.log('[TaskCard] render', {
      title,
      enrichmentStatus: enrichmentStatus ?? null,
      isAnalyzing,
      dueText,
      assigneeName: assigneeName ?? null,
      riskLevel: riskLevel ?? null,
    });
  }, [title, enrichmentStatus, isAnalyzing, dueText, assigneeName, riskLevel]);

  // Gentle pulse while the AI is analyzing a freshly-captured task.
  useEffect(() => {
    if (!isAnalyzing) {
      pulseAnim.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.55, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isAnalyzing, pulseAnim]);

  // Urgent due dates (under a day out, or overdue) pulse red to pull the eye.
  useEffect(() => {
    if (!dueUrgent || isAnalyzing) {
      urgentPulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(urgentPulse, { toValue: 0.3, duration: 600, useNativeDriver: true }),
        Animated.timing(urgentPulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [dueUrgent, isAnalyzing, urgentPulse]);

  const priorityChip = prioritySeverity ? getPriorityChip(colors, prioritySeverity) : null;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.97,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  };

  return (
    <TouchableOpacity
      testID={testID}
      accessibilityLabel={`Task: ${title}`}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      activeOpacity={1}
    >
      <Animated.View
        style={[
          styles.card,
          {
            backgroundColor: colors.backgroundMain,
            borderColor: theme.pastel.teal,
            transform: [{ scale: scaleAnim }],
          },
        ]}
      >
        {/* Leading visual — the assignee's avatar takes priority so every task
            shows who's on the hook at a glance; falls back to a cover photo, then
            the category icon for unassigned tasks. */}
        {assigneeName || assigneeAvatarUrl ? (
          <View style={styles.leadingAvatar}>
            <Avatar
              size="md"
              user={{
                display_name: assigneeName ?? undefined,
                avatar_url: assigneeAvatarUrl ?? undefined,
              }}
            />
          </View>
        ) : coverPhotoUrl ? (
          <Image source={{ uri: coverPhotoUrl }} style={styles.coverPhoto} />
        ) : (
          <View style={[styles.iconContainer, { backgroundColor: categoryColors.bg }]}>
            <Icon name={icon} size={22} color={categoryColors.iconBg} />
          </View>
        )}

        {/* Content */}
        <View style={styles.content}>
          <Typography
            variant="headline"
            weight="semibold"
            numberOfLines={2}
            color={isAnalyzing ? colors.primary : colors.textPrimary}
            style={styles.title}
          >
            {isAnalyzing
              ? '✨ Analyzing your task…'
              : needsClarification
                ? `"${title}"`
                : title}
          </Typography>

          {isAnalyzing ? (
            <Animated.View style={[styles.metaRow, { opacity: pulseAnim }]}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Typography variant="footnote" color={colors.textSecondary}>
                Analyzing…
              </Typography>
            </Animated.View>
          ) : needsClarification ? (
            <View style={styles.metaRow}>
              <View style={[styles.priorityBadge, { backgroundColor: colors.textSecondary + '29' }]}>
                <Icon name="help-circle" size={12} color={colors.textSecondary} />
                <Typography variant="caption2" color={colors.textSecondary} weight="semibold" numberOfLines={1}>
                  Needs clarification
                </Typography>
              </View>
              <PropertyBadge householdId={householdId} householdName={householdName} size="sm" />
            </View>
          ) : (
            <>
              {/* Primary signals — category identity plus only the risk/priority
                  that's actually elevated. Everything quieter lives in the footer. */}
              <View style={styles.metaRow}>
                {/* Blocked badge (takes visual priority) */}
                {blocked && (
                  <View style={[styles.priorityBadge, { backgroundColor: colors.error + '2E' }]}>
                    <Icon name="remove-circle" size={12} color={colors.error} />
                    <Typography variant="caption2" color={colors.error} weight="semibold" numberOfLines={1}>
                      Blocked
                    </Typography>
                  </View>
                )}

                {/* Personal task badge */}
                {isPersonal && (
                  <View style={[styles.priorityBadge, { backgroundColor: colors.purple + '1F' }]}>
                    <Icon name="lock-closed" size={12} color={colors.purple} />
                    <Typography variant="caption2" color={colors.purple} weight="semibold" numberOfLines={1}>
                      Personal
                    </Typography>
                  </View>
                )}

                {/* Category badge */}
                <View style={[styles.categoryBadge, { backgroundColor: categoryColors.bg }]}>
                  <Typography variant="caption2" color={categoryColors.iconBg} weight="medium">
                    {categoryName}
                  </Typography>
                </View>

                {/* Priority chip — only when high/urgent/critical */}
                {priorityChip && (
                  <View style={[styles.priorityBadge, { backgroundColor: priorityChip.bg }]}>
                    <Typography variant="caption2" color={priorityChip.fg} weight="medium" numberOfLines={1}>
                      {priorityChip.label}
                    </Typography>
                  </View>
                )}

                {/* Effort tier (AI-assessed) — quiet neutral pill */}
                {!!timeEffort && (
                  <View style={styles.neutralPill}>
                    <Icon name="hourglass-outline" size={12} color={colors.textSecondary} />
                    <Typography variant="caption2" color={colors.textSecondary} numberOfLines={1}>
                      {TIME_EFFORT_LABELS[timeEffort]}
                    </Typography>
                  </View>
                )}

                {/* Space / location */}
                {!!spaceName && (
                  <View style={styles.neutralPill}>
                    <Icon name="location-outline" size={12} color={colors.textSecondary} />
                    <Typography variant="caption2" color={colors.textSecondary} numberOfLines={1}>
                      {spaceName}
                    </Typography>
                  </View>
                )}

                {/* Subtask progress — quiet neutral pill */}
                {!!subtaskProgress && subtaskProgress.total > 0 && (
                  <View style={styles.neutralPill}>
                    <Icon name="checkmark" size={12} color={colors.textSecondary} />
                    <Typography variant="caption2" color={colors.textSecondary} numberOfLines={1}>
                      {subtaskProgress.completed}/{subtaskProgress.total}
                    </Typography>
                  </View>
                )}

                {/* Property badge */}
                <PropertyBadge householdId={householdId} householdName={householdName} size="sm" />
              </View>

              {/* Footer — the countdown to due. Urgent tasks (under a day out or
                  overdue) pulse in red; everything else is a quiet day count. The
                  assignee now lives in the leading avatar, so it's dropped here. */}
              {dueText ? (
                dueUrgent ? (
                  <Animated.View style={{ opacity: urgentPulse }}>
                    <Typography
                      variant="footnote"
                      weight="semibold"
                      color={colors.error}
                      numberOfLines={1}
                      style={styles.dueInline}
                    >
                      {dueText}
                    </Typography>
                  </Animated.View>
                ) : (
                  <Typography
                    variant="footnote"
                    weight="medium"
                    color={colors.textSecondary}
                    numberOfLines={1}
                    style={styles.dueInline}
                  >
                    {dueText}
                  </Typography>
                )
              ) : null}
            </>
          )}

          {/* Analyzing / clarification states keep their own supporting line. */}
          {(isAnalyzing || needsClarification) && (
            <Typography
              variant="footnote"
              color={colors.textSecondary}
              numberOfLines={2}
              style={styles.dueText}
            >
              {isAnalyzing
                ? title
                  ? `“${title}”`
                  : 'Just added — filling in the details'
                : clarificationQuestion || 'Tap to tell me more about this task'}
            </Typography>
          )}
        </View>
      </Animated.View>
    </TouchableOpacity>
  );
}

const makeStyles = (colors: AppColors) => StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
    borderRadius: 16,
    borderWidth: 1,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.04,
        shadowRadius: 4,
      },
      android: {
        elevation: 1,
      },
    }),
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  leadingAvatar: {
    marginRight: 12,
  },
  coverPhoto: {
    width: 44,
    height: 44,
    borderRadius: 12,
    marginRight: 12,
    backgroundColor: colors.pillBackground,
  },
  content: {
    flex: 1,
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
    gap: 6,
  },
  title: {
    fontSize: 16,
    letterSpacing: -0.2,
    lineHeight: 20,
    textAlign: 'left',
    alignSelf: 'stretch',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  categoryBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  priorityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  neutralPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: colors.pillBackground,
  },
  dueInline: {
    fontSize: 13,
    letterSpacing: -0.08,
    flexShrink: 0,
  },
  dueText: {
    fontSize: 13,
    letterSpacing: -0.08,
    marginTop: 2,
  },
});
