import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import DraggableFlatList, {
  RenderItemParams,
  ScaleDecorator,
} from 'react-native-draggable-flatlist';

import { Card, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, Spacing, useAppColors } from '@theme';

export interface WidgetOrderMeta {
  key: string;
  title: string;
  icon: string;
  description: string;
}

interface WidgetOrderSectionProps {
  /** Prefixes every testID this section renders, e.g. `customize-tabs-home`. */
  testIDPrefix: string;
  title: string;
  hint: string;
  widgets: readonly WidgetOrderMeta[];
  /** Enabled widget keys, in render order. */
  order: readonly string[];
  onToggle: (key: string) => void;
  /** Called with the new enabled-subsequence order once a drag settles. */
  onReorder: (nextOrder: string[]) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onReset: () => void;
  resetLabel?: string;
  defaultExpanded?: boolean;
}

/**
 * One collapsible "which cards, in what order" editor.
 *
 * Extracted from the inline panels Home and Weight used to carry on their own
 * screens (`health-home-customise-*` / `health-weight-customise-*`) so Home,
 * Weight and Activity can all point their per-screen widget layout at ONE
 * editor, reachable from More → Customize Tabs, instead of three copies of the
 * same toggle/reorder markup living on three different screens.
 *
 * Every row is checkbox + drag handle, dragged with the platform's native
 * long-press-and-drag gesture (`react-native-draggable-flatlist`, the same
 * library this screen's own tab-bar list already uses) rather than up/down
 * buttons. Hidden widgets stay in the list (unchecked, draggable) rather than
 * splitting into a second "add back" list, so reordering and show/hide share
 * one gesture model.
 */
export function WidgetOrderSection({
  testIDPrefix,
  title,
  hint,
  widgets,
  order,
  onToggle,
  onReorder,
  onSelectAll,
  onDeselectAll,
  onReset,
  resetLabel = 'Reset to the default order',
  defaultExpanded = false,
}: WidgetOrderSectionProps) {
  const colors = useAppColors();
  const [expanded, setExpanded] = useState(defaultExpanded);

  const metaByKey = useMemo(() => new Map(widgets.map((w) => [w.key, w])), [widgets]);
  // Shown widgets first, in their stored order, then hidden ones in the
  // registry's own order. Every row is draggable; only the shown subsequence
  // of the dragged result is ever persisted — see `handleDragEnd`.
  const displayOrder = useMemo(
    () => [...order, ...widgets.map((w) => w.key).filter((key) => !order.includes(key))],
    [order, widgets],
  );
  const allShown = order.length >= widgets.length;
  const canDeselectAll = order.length > 1;

  const handleDragEnd = ({ data }: { data: string[] }) => {
    onReorder(data.filter((key) => order.includes(key)));
  };

  const renderItem = ({ item, drag, isActive }: RenderItemParams<string>) => {
    const meta = metaByKey.get(item);
    if (!meta) return null;
    const shown = order.includes(item);
    return (
      <ScaleDecorator>
        <View
          style={[
            styles.row,
            { borderTopColor: colors.borderColor },
            isActive && { backgroundColor: colors.backgroundMain },
          ]}
          testID={`${testIDPrefix}-${item}`}
        >
          <Pressable
            onPress={() => onToggle(item)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: shown }}
            accessibilityLabel={`${shown ? 'Hide' : 'Show'} ${meta.title}`}
            testID={`${testIDPrefix}-toggle-${item}`}
            hitSlop={6}
          >
            <View
              style={[
                styles.checkbox,
                {
                  borderColor: shown ? colors.primary : colors.borderColor,
                  backgroundColor: shown ? colors.primary : 'transparent',
                },
              ]}
            >
              {shown ? <Icon name="checkmark" size={15} color={colors.white} /> : null}
            </View>
          </Pressable>
          <Icon name={meta.icon} size={18} color={shown ? colors.primary : colors.textSecondary} />
          <View style={styles.customText}>
            <Typography
              variant="body"
              weight={shown ? 'semibold' : 'regular'}
              color={shown ? colors.textPrimary : colors.textSecondary}
            >
              {meta.title}
            </Typography>
            <Typography variant="caption1" color={colors.textSecondary}>
              {meta.description}
            </Typography>
          </View>
          <Pressable
            onPressIn={drag}
            accessibilityRole="button"
            accessibilityLabel={`Drag to reorder ${meta.title}`}
            testID={`${testIDPrefix}-drag-${item}`}
            hitSlop={8}
            style={styles.dragHandle}
          >
            <Icon name="reorder-three" size={20} color={colors.textSecondary} />
          </Pressable>
        </View>
      </ScaleDecorator>
    );
  };

  return (
    <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
      <Pressable
        onPress={() => setExpanded((open) => !open)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        testID={`${testIDPrefix}-toggle`}
        style={styles.rowBetween}
      >
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          {title}
        </Typography>
        <Icon name={expanded ? 'arrow-up' : 'arrow-down'} size={16} color={colors.textSecondary} />
      </Pressable>

      {expanded ? (
        <>
          <Typography variant="caption1" color={colors.textSecondary}>
            {hint}
          </Typography>
          <View style={styles.bulkRow}>
            <Pressable
              onPress={onSelectAll}
              disabled={allShown}
              accessibilityRole="button"
              testID={`${testIDPrefix}-select-all`}
              hitSlop={6}
            >
              <Typography
                variant="footnote"
                weight="semibold"
                color={allShown ? colors.textTertiary : colors.primary}
              >
                Select all
              </Typography>
            </Pressable>
            <Pressable
              onPress={onDeselectAll}
              disabled={!canDeselectAll}
              accessibilityRole="button"
              testID={`${testIDPrefix}-deselect-all`}
              hitSlop={6}
            >
              <Typography
                variant="footnote"
                weight="semibold"
                color={canDeselectAll ? colors.primary : colors.textTertiary}
              >
                Deselect all
              </Typography>
            </Pressable>
          </View>
          <DraggableFlatList
            data={displayOrder}
            renderItem={renderItem}
            keyExtractor={(key) => key}
            onDragEnd={handleDragEnd}
            scrollEnabled={false}
            activationDistance={10}
          />
          <Pressable
            onPress={onReset}
            accessibilityRole="button"
            testID={`${testIDPrefix}-reset`}
            style={[styles.resetButton, { borderColor: colors.borderColor }]}
          >
            <Typography variant="footnote" weight="semibold" color={colors.textSecondary}>
              {resetLabel}
            </Typography>
          </Pressable>
        </>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.base,
    gap: Spacing.sm,
  },
  sectionLabel: {
    letterSpacing: 0.6,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bulkRow: {
    flexDirection: 'row',
    gap: Spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: CornerRadius.sm,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  customText: {
    flex: 1,
    gap: 2,
  },
  dragHandle: {
    padding: Spacing.xs,
  },
  resetButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
});
