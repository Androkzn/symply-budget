/**
 * A short list the member can put in their own order, dragged by a grip.
 *
 * Both lists on the project hub that the member WROTE — the Timeline's phases
 * and the Blockers tab — are the same interaction, so the interaction lives
 * here once rather than twice.
 *
 * ## Three decisions worth stating
 *
 * **The drag is confined to a grip (`customHandle`).** The hub is one long
 * `ScrollView` and every row is also a tap target: a whole-row drag would eat
 * both, so a phase could not be opened for editing and the tab could not be
 * scrolled past. `maestro-visibility-ignores-the-floating-tab-bar` is the same
 * failure from the other side — a control that takes an input meant for
 * something else fails many steps later, somewhere unrelated.
 *
 * **The new order is shown before it is saved, and put back if the save
 * fails.** A drop that visibly springs back a moment later is how a member
 * learns the write did not land; a drop that stays put while the request fails
 * silently is how they lose an order they think they set.
 *
 * **One grip appears only when there is something to reorder.** A one-item list
 * shows no grip at all — an affordance that cannot do anything is noise, and on
 * this screen it would sit next to a real one on the tab beside it.
 */
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Sortable, { type SortableGridRenderItem } from 'react-native-sortables';

import { Icon } from '@components/ui/Icon';
import { IconSize, Spacing, useAppColors } from '@theme';

interface Props<T> {
  data: T[];
  /** The row itself. The grip is drawn by this component, to its left. */
  renderItem: (item: T, index: number) => React.ReactNode;
  /**
   * Persist the new order. Resolving `false` — or rejecting — puts the list
   * back the way it was, so a refused or failed write is never left on screen
   * as if it had succeeded.
   */
  onReorder: (items: T[]) => Promise<boolean | void>;
  /** False for a view-only member: rows still render, grips do not. */
  canReorder?: boolean;
  testID?: string;
}

export function ReorderableList<T extends { id: string }>({
  data,
  renderItem,
  onReorder,
  canReorder = true,
  testID,
}: Props<T>) {
  const colors = useAppColors();

  /**
   * The order on screen. Seeded from props and re-seeded whenever they change,
   * which is what makes a refetch — someone else's drag, an added row —
   * authoritative over a stale optimistic order rather than fighting it.
   */
  const [ordered, setOrdered] = useState<T[]>(data);
  useEffect(() => {
    setOrdered(data);
  }, [data]);

  const showGrips = canReorder && data.length > 1;

  const handleDrop = useCallback(
    async (next: T[]) => {
      const previous = ordered;
      setOrdered(next);
      if (Platform.OS === 'ios') {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
      try {
        const result = await onReorder(next);
        if (result === false) setOrdered(previous);
      } catch {
        // The caller presents the failure — it knows whether this was a
        // conflict, a refusal or a dead network. This only undoes the move.
        setOrdered(previous);
      }
    },
    [ordered, onReorder],
  );

  const render = useCallback<SortableGridRenderItem<T>>(
    ({ item, index }) => (
      <View style={styles.row}>
        {showGrips ? (
          <Sortable.Handle>
            <View style={styles.grip} testID={`${testID ?? 'reorderable'}-grip`}>
              <Icon
                name="reorder-three"
                size={IconSize.md}
                color={colors.textTertiary}
              />
            </View>
          </Sortable.Handle>
        ) : null}
        <View style={styles.body}>{renderItem(item, index)}</View>
      </View>
    ),
    [showGrips, colors.textTertiary, renderItem, testID],
  );

  if (data.length === 0) return null;

  return (
    <View testID={testID}>
      <Sortable.Grid
        columns={1}
        data={ordered}
        keyExtractor={item => item.id}
        renderItem={render}
        customHandle
        rowGap={0}
        // No hold-to-start: the grip is already a deliberate target, and a delay
        // on top of it reads as the list ignoring the first attempt.
        dragActivationDelay={0}
        activeItemScale={1.02}
        activeItemShadowOpacity={0.15}
        onDragStart={() => {
          if (Platform.OS === 'ios') {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }
        }}
        onDragEnd={({ data: next }) => {
          void handleDrop(next);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  grip: {
    paddingTop: Spacing.sm,
    paddingRight: Spacing.sm,
    paddingLeft: Spacing.xxs,
    justifyContent: 'center',
    alignItems: 'center',
  },
  body: { flex: 1, minWidth: 0 },
});

export default ReorderableList;
