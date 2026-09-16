/**
 * HomeMiraBrief — the proactive, actionable hero at the top of Home.
 *
 * Fronts the AI housekeeper (persona avatar + name) with the single most
 * important thing about the home right now — an overdue task, a bill due soon,
 * garbage going out tomorrow, an over-budget month — composed server-side into
 * a headline, a Mira-voice sentence, a severity tone, a due-date + relative
 * days counter, and one deep-link CTA. Tapping the card takes you straight to
 * that action; a small "Ask {name}" affordance always opens the full chat.
 *
 * When there's nothing to fetch yet (or the request fails) it falls back to a
 * friendly greeting so the hero always speaks.
 */
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import type { HomeInsight, InsightCta, InsightTone } from '@/types/aihousekeeper';
import type { PersonaMeta } from '@assets/aihousekeeper/personas';
import { PersonaAvatar } from '@components/aihousekeeper';
import { Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import {
  Avatar,
  CornerRadius,
  hexToRgba,
  IconSize,
  Spacing,
  useAppColors,
  type AppColors,
} from '@theme';

interface HomeMiraBriefProps {
  /** Effective display name (custom nickname or persona default). */
  name: string;
  persona: PersonaMeta;
  /** Composed insight from the backend, or null while loading / on failure. */
  insight: HomeInsight | null;
  /** Client-computed greeting fallback used only when `insight` is null. */
  greeting: string;
  /** Open the full assistant chat. */
  onOpenAssistant: () => void;
  /** Navigate to the insight's deep-link action. */
  onAction: (cta: InsightCta) => void;
}

/** Tone → accent + wash colors. Urgent reds, attention ambers, calm/brand teal. */
function toneColors(tone: InsightTone, colors: AppColors): { accent: string; wash: string } {
  switch (tone) {
    case 'urgent':
      return { accent: colors.statusOverdue ?? colors.error, wash: hexToRgba(colors.error, 0.1) };
    case 'attention':
      return { accent: colors.warning, wash: hexToRgba(colors.warning, 0.12) };
    case 'celebrate':
      return { accent: colors.success, wash: hexToRgba(colors.success, 0.12) };
    case 'info':
    case 'calm':
    default:
      return { accent: colors.primary, wash: hexToRgba(colors.primary, 0.1) };
  }
}

export function HomeMiraBrief({
  name,
  persona,
  insight,
  greeting,
  onOpenAssistant,
  onAction,
}: HomeMiraBriefProps) {  const colors = useAppColors();

  const effectiveGreeting = insight?.greeting ?? greeting;
  const tone = insight?.tone ?? 'calm';
  const { accent, wash } = toneColors(tone, colors);
  const hasCta = !!insight?.cta;

  // The whole card does the most useful thing: the CTA action when there is one,
  // otherwise it opens the assistant chat.
  const handlePress = () => {
    if (insight?.cta) onAction(insight.cta);
    else onOpenAssistant();
  };

  const body =
    insight?.message ??
    `${effectiveGreeting} — I'm keeping an eye on your home. Tap to ask me anything.`;

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: wash, borderColor: hexToRgba(accent, 0.25) }]}
      onPress={handlePress}
      activeOpacity={0.85}
      testID="home-mira-brief"
      accessibilityRole="button"
      accessibilityLabel={insight ? `${insight.title}. ${insight.message}` : `Open ${name}`}
    >
      <View style={styles.headerRow}>
        <PersonaAvatar persona={persona} size={Avatar.cardSize} backgroundColor="transparent" />
        <View style={styles.headerText}>
          <Typography variant="caption1" color={accent} weight="semibold">
            {name}
          </Typography>
          <Typography variant="caption2" color={colors.textSecondary}>
            {effectiveGreeting}
          </Typography>
        </View>
        {insight && insight.attentionCount > 0 ? (
          <View style={[styles.countBadge, { backgroundColor: accent }]}>
            <Typography variant="caption2" weight="bold" color={colors.white}>
              {insight.attentionCount > 9 ? '9+' : String(insight.attentionCount)}
            </Typography>
          </View>
        ) : (
          <Icon name="sparkles" size={IconSize.md} color={colors.primary} />
        )}
      </View>

      {insight ? (
        <View style={styles.titleRow}>
          <Icon name={insight.icon as keyof typeof Ionicons.glyphMap} size={IconSize.md} color={accent} />
          <Typography variant="subheadline" weight="bold" color={colors.textPrimary} style={styles.titleText}>
            {insight.title}
          </Typography>
        </View>
      ) : null}

      <Typography variant="body" color={colors.textPrimary} style={styles.body}>
        {body}
      </Typography>

      {insight?.dueLabel ? (
        <View style={[styles.duePill, { backgroundColor: hexToRgba(accent, 0.14) }]}>
          <Icon name="time-outline" size={IconSize.sm} color={accent} />
          <Typography variant="caption1" weight="semibold" color={accent}>
            {insight.dueLabel}
          </Typography>
        </View>
      ) : null}

      {insight && insight.chips.length > 0 ? (
        <View style={styles.chipsRow}>
          {insight.chips.map((chip, i) => (
            <View
              key={`${chip.label}-${i}`}
              style={[styles.chip, { backgroundColor: hexToRgba(colors.textSecondary, 0.08) }]}
            >
              <Icon
                name={chip.icon as keyof typeof Ionicons.glyphMap}
                size={IconSize.sm}
                color={colors.textSecondary}
              />
              <Typography variant="caption2" color={colors.textSecondary} numberOfLines={1}>
                {chip.label}
                {chip.dueLabel ? ` · ${chip.dueLabel}` : ''}
              </Typography>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.footerRow}>
        {hasCta ? (
          <TouchableOpacity
            onPress={onOpenAssistant}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={`Ask ${name}`}
            testID="home-mira-brief-ask"
          >
            <Typography variant="caption1" weight="semibold" color={colors.textSecondary}>
              Ask {name}
            </Typography>
          </TouchableOpacity>
        ) : (
          <View />
        )}

        <View style={styles.ctaRow}>
          <Typography variant="subheadline" weight="semibold" color={accent}>
            {insight?.cta?.label ?? `Ask ${name}`}
          </Typography>
          <Icon name="chevron-forward" size={IconSize.sm} color={accent} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: CornerRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.base,
    marginBottom: Spacing.base,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  headerText: {
    flex: 1,
    gap: Spacing.xxs,
  },
  countBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: Spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  titleText: {
    flex: 1,
  },
  body: {
    lineHeight: 22,
  },
  duePill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.xxs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
    borderRadius: CornerRadius.full,
    marginTop: Spacing.sm,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    marginTop: Spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
    borderRadius: CornerRadius.full,
    maxWidth: '100%',
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.md,
  },
  ctaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
  },
});
