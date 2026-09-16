import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { HomeProjectBlocker } from '@api/home-projects';
import { useAppColors } from '@theme';

import {
  BLOCKER_SEVERITY_LABELS,
  BLOCKER_STATUS_LABELS,
  readBlockerStatus,
} from './StepEditSheet';

/**
 * One blocker, as it reads in the list.
 *
 * Purely visual — the tap target, the pencil and the drag grip belong to
 * `BlockerList`, which is what knows whether this member may edit anything.
 *
 * A RESOLVED blocker stays in the list rather than disappearing: "we checked,
 * the wall is not load-bearing" is the answer to a question the household asked
 * and is worth keeping where the question was. It is drawn in the muted colour
 * with the severity dot hollowed out, so a list of eight with two answered
 * reads as six things still in the way.
 */
export function BlockerRow({ blocker }: { blocker: HomeProjectBlocker }) {
  const colors = useAppColors();
  const resolved = readBlockerStatus(blocker.status) === 'resolved';
  const severityColor =
    blocker.severity === 'critical' || blocker.severity === 'high'
      ? colors.error
      : colors.warning;

  return (
    <View style={[styles.row, { borderColor: colors.borderColor }]}>
      <View
        style={[
          styles.dot,
          resolved
            ? { borderColor: colors.textTertiary, borderWidth: 1.5 }
            : { backgroundColor: severityColor },
        ]}
      />
      <View style={styles.body}>
        <Text
          style={[
            styles.title,
            { color: resolved ? colors.textSecondary : colors.textPrimary },
          ]}
        >
          {blocker.title}
        </Text>
        {/* One interpolated string, not four text children: a label split
            across children is one string to a reader and four to anything
            matching on it — a test, or Maestro walking the a11y tree. */}
        <Text style={[styles.meta, { color: colors.textSecondary }]}>
          {`${BLOCKER_SEVERITY_LABELS[blocker.severity] ?? blocker.severity} · ${
            BLOCKER_STATUS_LABELS[readBlockerStatus(blocker.status)]
          }`}
        </Text>
        {blocker.notes ? (
          <Text
            style={[styles.notes, { color: colors.textSecondary }]}
            numberOfLines={2}
          >
            {blocker.notes}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  body: { flex: 1 },
  title: { fontSize: 15, fontWeight: '500' },
  meta: { fontSize: 12, marginTop: 2 },
  notes: { fontSize: 12, marginTop: 4 },
});
