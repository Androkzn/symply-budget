/**
 * The Blockers tab's list — the Timeline's twin, and deliberately so.
 *
 * Phases and blockers are the same object from the member's side: a short list
 * of lines they wrote or a draft wrote for them, on two tabs of one screen. So
 * they get the same grip, the same tap-to-edit, and the same empty state. A
 * drag that worked on one tab and not the other would read as a bug in the tab
 * rather than a missing feature.
 *
 * Blockers got `sort_order` in migration 0171; phases have had one since the
 * table existed. That is the whole of the difference between the two lists.
 */
import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { HomeProjectBlocker } from '@api/home-projects';
import { Icon } from '@components/ui/Icon';
import { IconSize, useAppColors } from '@theme';

import { BlockerRow } from './BlockerRow';
import { ReorderableList } from './ReorderableList';

interface Props {
  blockers: HomeProjectBlocker[];
  onEditBlocker?: (blocker: HomeProjectBlocker) => void;
  onReorder?: (blockerIds: string[]) => Promise<boolean | void>;
  canEdit?: boolean;
}

export function BlockerList({
  blockers,
  onEditBlocker,
  onReorder,
  canEdit = false,
}: Props) {
  const colors = useAppColors();
  const editable = canEdit && !!onEditBlocker;

  const renderBlocker = useCallback(
    (blocker: HomeProjectBlocker) => (
      <Pressable
        style={styles.row}
        onPress={editable ? () => onEditBlocker?.(blocker) : undefined}
        disabled={!editable}
        accessibilityRole={editable ? 'button' : undefined}
        accessibilityLabel={editable ? `Edit blocker ${blocker.title}` : undefined}
        testID={`home-project-blocker-${blocker.id}`}
      >
        <View style={styles.rowBody}>
          <BlockerRow blocker={blocker} />
        </View>
        {editable ? (
          <Icon
            name="create-outline"
            size={IconSize.sm}
            color={colors.textTertiary}
          />
        ) : null}
      </Pressable>
    ),
    [editable, onEditBlocker, colors.textTertiary],
  );

  if (blockers.length === 0) {
    return (
      <Text style={{ color: colors.textSecondary }}>
        Nothing in the way — add anything you need to find out before this work
        can start.
      </Text>
    );
  }

  if (!onReorder || !canEdit) {
    return (
      <View testID="home-project-blockers">
        {blockers.map(blocker => (
          <View key={blocker.id}>{renderBlocker(blocker)}</View>
        ))}
      </View>
    );
  }

  return (
    <ReorderableList
      data={blockers}
      renderItem={renderBlocker}
      onReorder={items => onReorder(items.map(item => item.id))}
      testID="home-project-blockers"
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowBody: { flex: 1, minWidth: 0 },
});
