/**
 * The phases of a project, in the member's order, each one editable.
 *
 * This was a read-only render for as long as there was nothing to change: no
 * route could rename a phase, mark it done or move it, so a Smart Project draft
 * arrived as a fixed list the member had to accept whole. Migration 0171's
 * sibling routes (`PATCH`/`DELETE`/`reorder` on phases) are what this now
 * exposes.
 *
 * The numbering is POSITIONAL — `1.`, `2.` — and is drawn from the row's place
 * in the list rather than from `sort_order`, so a drop renumbers everything
 * immediately, before the write comes back.
 */
import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { HomeProjectPhase } from '@api/home-projects';
import { Icon } from '@components/ui/Icon';
import { IconSize, useAppColors } from '@theme';

import { ReorderableList } from './ReorderableList';
import { PHASE_STATUS_LABELS, readPhaseStatus } from './StepEditSheet';

interface Props {
  phases: HomeProjectPhase[];
  /** Opens the edit sheet. Omitted, or with `canEdit` false, rows are inert. */
  onEditPhase?: (phase: HomeProjectPhase) => void;
  /** Persists a drag. `false` puts the list back — see `ReorderableList`. */
  onReorder?: (phaseIds: string[]) => Promise<boolean | void>;
  /** False for a view-only member: no grips, no pencils, no taps. */
  canEdit?: boolean;
}

export function Timeline({
  phases,
  onEditPhase,
  onReorder,
  canEdit = false,
}: Props) {
  const colors = useAppColors();
  const editable = canEdit && !!onEditPhase;

  const dotColor = useCallback(
    (status: string) => {
      const value = readPhaseStatus(status);
      if (value === 'done') return colors.success;
      if (value === 'in_progress') return colors.primary;
      // Not started: the same neutral the connector uses, so a plan that has not
      // begun reads as one shape rather than a column of live-looking dots.
      return colors.borderColor;
    },
    [colors],
  );

  const renderPhase = useCallback(
    (phase: HomeProjectPhase, index: number) => {
      const last = index === phases.length - 1;
      const dates = [phase.starts_on, phase.ends_on].filter(Boolean).join(' → ');
      return (
        <Pressable
          style={styles.row}
          onPress={editable ? () => onEditPhase?.(phase) : undefined}
          disabled={!editable}
          accessibilityRole={editable ? 'button' : undefined}
          accessibilityLabel={
            editable ? `Edit phase ${index + 1}, ${phase.title}` : undefined
          }
          testID={`home-project-phase-${phase.id}`}
        >
          <View style={styles.rail}>
            <View
              style={[
                styles.dot,
                { backgroundColor: dotColor(phase.status) },
              ]}
            />
            {last ? null : (
              <View
                style={[styles.line, { backgroundColor: colors.borderColor }]}
              />
            )}
          </View>
          <View style={styles.body}>
            {/* Interpolated into ONE string each. Split across text children a
                title reads as "7." and "Paint and finish" to anything matching
                on the a11y tree, which is how a passing assertion stops meaning
                the member can see the line. */}
            <Text style={[styles.title, { color: colors.textPrimary }]}>
              {`${index + 1}. ${phase.title}`}
            </Text>
            <Text style={[styles.meta, { color: colors.textSecondary }]}>
              {`${PHASE_STATUS_LABELS[readPhaseStatus(phase.status)]}${
                dates ? ` · ${dates}` : ''
              }`}
            </Text>
          </View>
          {editable ? (
            <Icon
              name="create-outline"
              size={IconSize.sm}
              color={colors.textTertiary}
            />
          ) : null}
        </Pressable>
      );
    },
    [phases.length, editable, onEditPhase, dotColor, colors],
  );

  if (phases.length === 0) {
    return <Text style={{ color: colors.textSecondary }}>No phases yet</Text>;
  }

  /*
   * Without a reorder handler this is still the plain list it always was —
   * a view-only member, and any caller that has not wired the write, gets the
   * rows and no drag machinery at all rather than grips that do nothing.
   */
  if (!onReorder || !canEdit) {
    return (
      <View testID="home-project-timeline">
        {phases.map((phase, index) => (
          <View key={phase.id}>{renderPhase(phase, index)}</View>
        ))}
      </View>
    );
  }

  return (
    <ReorderableList
      data={phases}
      renderItem={renderPhase}
      onReorder={items => onReorder(items.map(item => item.id))}
      testID="home-project-timeline"
    />
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    minHeight: 48,
    paddingLeft: 4,
  },
  /* The dot and the connector below it, as one column, so the line always
     starts under the dot however tall the row's text grows. */
  rail: { width: 10, alignItems: 'center', alignSelf: 'stretch' },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  line: { position: 'absolute', top: 16, bottom: -4, width: 2 },
  body: { flex: 1, paddingBottom: 14 },
  title: { fontSize: 15, fontWeight: '600' },
  meta: { marginTop: 2, fontSize: 12 },
});
