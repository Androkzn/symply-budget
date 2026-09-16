/**
 * BR-044 — the surface for edits the merge threw away.
 *
 * This is a product requirement, not a debug view. When two members edit the
 * same field before their devices meet, last-writer-wins keeps one value and
 * **silently discards the other**. Nothing is queued, nothing retried: the
 * losing edit exists only as a row on `ledger.conflicts`. If this list is not
 * rendered, the member who typed that value watches it turn into someone else's
 * on the next render and has no way to tell that from the app losing their work.
 *
 * Hence the three rules the component follows:
 *
 *   - It names what was **kept** and what was **lost** (see `houseConflictCopy`),
 *     never "conflict detected".
 *   - It renders nothing when there is nothing to say. A permanently visible
 *     empty "conflicts" panel trains people to ignore the one that matters.
 *   - Dismissal is explicit and one-way. `clearLocalHouseConflicts()` erases the
 *     log, so it only runs once the member has actually seen every entry —
 *     never on mount, never on a screen transition.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Typography } from '@components/ui';
import {
  clearLocalHouseConflicts,
  getLocalHouseConflictsFor,
  getLocalHouseLedger,
  getLocalHouseMemberId,
} from '@features/house/local/engine';
import type { LedgerConflict } from '@features/house/local/projection';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import { describeHouseConflict, houseConflictSummary } from './houseConflictCopy';
import { useHouseLedgerRevision } from './useHouseLedgerRevision';

export type HouseConflictListProps = {
  /** Read one property's log. Omit for whatever property is active. */
  householdId?: string;
  /** Rows shown before the "+N more" line. */
  maxVisible?: number;
  /** Fired after the engine log is cleared, e.g. to close a sheet. */
  onDismissAll?: () => void;
  style?: StyleProp<ViewStyle>;
};

/**
 * Every engine accessor throws when the session is not open (or the property is
 * unknown) — and a card that renders before `ensureHouseLocalSession` finishes
 * is the normal case, not an edge one. An empty list is the honest answer there:
 * we have nothing to report yet, as opposed to "nothing was discarded".
 */
function readConflicts(householdId?: string): LedgerConflict[] {
  try {
    if (householdId) return getLocalHouseConflictsFor(householdId);
    return getLocalHouseLedger().conflicts ?? [];
  } catch {
    return [];
  }
}

function readSelfMemberId(): string | null {
  try {
    return getLocalHouseMemberId();
  } catch {
    return null;
  }
}

export function HouseConflictList({
  householdId,
  maxVisible = 4,
  onDismissAll,
  style,
}: HouseConflictListProps) {
  const colors = useAppColors();
  // The conflict log is engine state, not React state: without this subscription
  // the list would be frozen at whatever it held on first render — exactly the
  // failure BR-044 is about. The revision number itself is not needed; being
  // re-rendered is.
  useHouseLedgerRevision(householdId);

  // Locally dismissed ids. The engine log is all-or-nothing (there is no
  // per-row clear), so a row the member has acknowledged is hidden here and the
  // log is cleared once the last one goes — which keeps "dismiss" honest
  // without inventing per-row persistence the engine does not have.
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const [expanded, setExpanded] = useState(false);

  // Read on every render rather than memoized: both are array/property lookups
  // off an in-memory projection, and a memo would have to depend on the ledger
  // revision — a value the reads never mention, which is precisely the stale
  // dependency the linter is right to reject.
  const conflicts = readConflicts(householdId);
  const selfMemberId = readSelfMemberId();
  const visible = conflicts.filter((conflict) => !dismissed.has(conflict.id));

  const clearAll = () => {
    setDismissed(new Set(conflicts.map((conflict) => conflict.id)));
    void clearLocalHouseConflicts()
      .catch(() => {
        // Clearing is a courtesy write. If it fails the log stays on disk and
        // reappears next launch, which is strictly better than pretending the
        // discarded edits never happened.
      })
      .finally(() => onDismissAll?.());
  };

  const dismissOne = (id: string) => {
    const next = new Set(dismissed);
    next.add(id);
    setDismissed(next);
    // Last one acknowledged — now the persisted log can go.
    if (conflicts.every((conflict) => next.has(conflict.id))) {
      void clearLocalHouseConflicts().catch(() => {});
      onDismissAll?.();
    }
  };

  if (visible.length === 0) return null;

  const shown = expanded ? visible : visible.slice(0, maxVisible);
  const hidden = visible.length - shown.length;

  return (
    <View
      style={[styles.wrap, { borderColor: colors.warning, backgroundColor: colors.cardSubtle }, style]}
      testID="lf-conflict-list"
      accessibilityRole="summary"
      accessibilityLabel={houseConflictSummary(visible.length)}
    >
      <View style={styles.header}>
        <Typography variant="body" weight="semibold" style={styles.headerText} testID="lf-conflict-count">
          {houseConflictSummary(visible.length)}
        </Typography>
      </View>
      <Typography variant="caption1" color={colors.textSecondary} style={styles.intro}>
        When two people change the same thing before their devices catch up, only one version can be
        kept. Here is what was replaced.
      </Typography>

      {shown.map((conflict, index) => {
        const copy = describeHouseConflict(conflict, selfMemberId);
        return (
          <View
            key={conflict.id}
            style={[styles.row, { borderTopColor: colors.divider }]}
            testID={`lf-conflict-row-${index}`}
          >
            <View style={styles.rowText}>
              <Typography
                variant="bodySmallSemibold"
                color={copy.mine ? colors.warning : colors.textPrimary}
                testID={`lf-conflict-title-${index}`}
              >
                {copy.title}
              </Typography>
              <Typography
                variant="caption1"
                color={colors.textSecondary}
                style={styles.body}
                testID={`lf-conflict-body-${index}`}
              >
                {copy.body}
              </Typography>
              <Typography variant="captionSmall" color={colors.textTertiary} testID={`lf-conflict-when-${index}`}>
                {copy.when}
              </Typography>
            </View>
            <Pressable
              onPress={() => dismissOne(conflict.id)}
              hitSlop={Spacing.sm}
              accessibilityRole="button"
              accessibilityLabel={`Dismiss: ${copy.title}`}
              testID={`lf-conflict-dismiss-${index}`}
            >
              <Typography variant="caption1" weight="semibold" color={colors.primary}>
                Dismiss
              </Typography>
            </Pressable>
          </View>
        );
      })}

      {hidden > 0 ? (
        <Pressable
          onPress={() => setExpanded(true)}
          accessibilityRole="button"
          accessibilityLabel={`Show ${hidden} more replaced ${hidden === 1 ? 'change' : 'changes'}`}
          style={styles.more}
          testID="lf-conflict-more"
        >
          <Typography variant="caption1" weight="semibold" color={colors.primary}>
            {`Show ${hidden} more`}
          </Typography>
        </Pressable>
      ) : null}

      <Pressable
        onPress={clearAll}
        accessibilityRole="button"
        accessibilityLabel="Dismiss all replaced changes"
        style={styles.dismissAll}
        testID="lf-conflict-dismiss-all"
      >
        <Typography variant="caption1" weight="semibold" color={colors.primary}>
          Dismiss all
        </Typography>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: 1,
    borderRadius: CornerRadius.md,
    padding: Spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerText: {
    flex: 1,
  },
  intro: {
    marginTop: Spacing.xxs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.sm,
    marginTop: Spacing.sm,
  },
  rowText: {
    flex: 1,
    gap: Spacing.xxs,
  },
  body: {
    marginBottom: Spacing.xxs,
  },
  more: {
    marginTop: Spacing.sm,
  },
  dismissAll: {
    marginTop: Spacing.sm,
    alignSelf: 'flex-start',
  },
});
