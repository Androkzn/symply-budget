import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { StyleSheet, View, TouchableOpacity, ScrollView, Platform } from 'react-native';

import type { HouseholdSpace } from '@api/household-spaces';
import type { HouseholdMember } from '@api/households';
import type { TaskPrioritySeverity } from '@api/tasks';
import { BottomSheet, FilterTabs, Typography } from '@components/ui';
import type { FilterTab } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import {
  hasActiveFilters,
  useTaskBoardStore,
  type TaskGroupBy,
} from '@stores/taskBoardStore';
import {
  CornerRadius,
  Elevation,
  IconSize,
  Opacity,
  Spacing,
  useAppColors,
} from '@theme';
import {
  PRIORITY_META,
  PRIORITY_ORDER,
  UNASSIGNED_KEY,
  NO_AREA_KEY,
  type IoniconName,
} from '@utils/taskStatus';

interface TaskFilterControlsProps {
  members: HouseholdMember[];
  spaces: HouseholdSpace[];
}

interface Option {
  key: string;
  label: string;
  /** Ionicon shown before the label (preferred over emoji). */
  icon?: IoniconName;
  /** Tint for the leading icon; falls back to secondary text color. */
  iconColor?: string;
  /** Custom emoji (e.g. a space's own emoji); used only when no `icon` is set. */
  emoji?: string;
}

const GROUP_TABS: FilterTab[] = [
  { id: 'status', label: 'Status' },
  { id: 'assignee', label: 'Who' },
  { id: 'area', label: 'Area' },
  { id: 'priority', label: 'Priority' },
];

/** A single toggleable filter chip, with an optional leading icon and (for
 *  sheet-opening chips) a trailing chevron. */
function FilterChip({
  label,
  active,
  onPress,
  testID,
  icon,
  trailingIcon,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  testID?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  trailingIcon?: keyof typeof Ionicons.glyphMap;
}) {
  const colors = useAppColors();
  const fg = active ? colors.white : colors.textSecondary;
  return (
    <TouchableOpacity
      testID={testID}
      activeOpacity={0.8}
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: active ? colors.primary : colors.card,
          borderColor: active ? colors.primary : colors.borderColor,
        },
      ]}
    >
      {icon && <Icon name={icon} size={IconSize.sm} color={fg} />}
      <Typography variant="caption1" weight="semibold" color={fg}>
        {label}
      </Typography>
      {trailingIcon && <Icon name={trailingIcon} size={IconSize.sm} color={fg} />}
    </TouchableOpacity>
  );
}

/** Generic multi-select bottom sheet for assignee / area / priority. */
function MultiSelectSheet({
  visible,
  title,
  options,
  selected,
  onClose,
  onChange,
}: {
  visible: boolean;
  title: string;
  options: Option[];
  selected: string[];
  onClose: () => void;
  onChange: (next: string[]) => void;
}) {  const colors = useAppColors();
  const toggle = (key: string) => {
    onChange(
      selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]
    );
  };
  return (
    <BottomSheet visible={visible} onClose={onClose} title={title} height="standard" showCloseButton>
      <ScrollView contentContainerStyle={styles.sheetContent}>
        {options.length === 0 && (
          <Typography variant="body" color={colors.textSecondary} align="center">
            Nothing to filter by yet.
          </Typography>
        )}
        {options.map((opt) => {
          const isOn = selected.includes(opt.key);
          return (
            <TouchableOpacity
              key={opt.key}
              activeOpacity={0.7}
              onPress={() => toggle(opt.key)}
              style={[styles.optionRow, { borderColor: colors.borderColor }]}
            >
              <View style={styles.optionLabel}>
                {opt.icon ? (
                  <Icon
                    name={opt.icon}
                    size={IconSize.md}
                    color={opt.iconColor ?? colors.textSecondary}
                  />
                ) : opt.emoji ? (
                  <Typography variant="body" color={colors.textPrimary}>
                    {opt.emoji}
                  </Typography>
                ) : null}
                <Typography variant="body" color={colors.textPrimary}>
                  {opt.label}
                </Typography>
              </View>
              <View
                style={[
                  styles.checkbox,
                  {
                    backgroundColor: isOn ? colors.primary : 'transparent',
                    borderColor: isOn ? colors.primary : colors.borderColor,
                  },
                ]}
              >
                {isOn && (
                  <Icon name="checkmark" size={IconSize.sm} color={colors.white} />
                )}
              </View>
            </TouchableOpacity>
          );
        })}
        {selected.length > 0 && (
          <TouchableOpacity style={styles.clearRow} onPress={() => onChange([])}>
            <Typography variant="subheadline" color={colors.primary} weight="semibold">
              Clear selection
            </Typography>
          </TouchableOpacity>
        )}
      </ScrollView>
    </BottomSheet>
  );
}

type SheetKind = 'assignee' | 'area' | 'priority' | null;

/**
 * The dashboard's control surface: group-by segmented control + List/Board view
 * toggle, then a scrollable row of filter chips (Mine, Hide done, and
 * multi-select Who/Area/Priority). All state lives in the persisted board store.
 */
export function TaskFilterControls({ members, spaces }: TaskFilterControlsProps) {
  const colors = useAppColors();
  const {
    viewMode,
    setViewMode,
    groupBy,
    setGroupBy,
    filters,
    toggleMineOnly,
    toggleHideDone,
    togglePersonalOnly,
    setAssigneeIds,
    setSpaceIds,
    setPriorities,
    clearFilters,
  } = useTaskBoardStore();

  const [sheet, setSheet] = useState<SheetKind>(null);

  const activeToggleShadow = Platform.select({
    ios: {
      shadowColor: colors.black,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: Opacity.tabThumb,
      shadowRadius: 4,
    },
    android: { elevation: Elevation.floating },
  });

  const assigneeOptions: Option[] = [
    ...members.map((m) => ({
      key: m.user_id,
      label: m.display_name || m.email,
      icon: 'person-outline' as IoniconName,
    })),
    { key: UNASSIGNED_KEY, label: 'Unassigned', icon: 'person-circle-outline' },
  ];
  const areaOptions: Option[] = [
    ...spaces.map((s) =>
      s.icon_emoji
        ? { key: s.id, label: s.name, emoji: s.icon_emoji }
        : { key: s.id, label: s.name, icon: 'location-outline' as IoniconName }
    ),
    { key: NO_AREA_KEY, label: 'No area', icon: 'home-outline' },
  ];
  const priorityOptions: Option[] = PRIORITY_ORDER.map((p) => ({
    key: p,
    label: PRIORITY_META[p].label,
    icon: PRIORITY_META[p].icon,
    iconColor: PRIORITY_META[p].color,
  }));

  const chipLabel = (base: string, count: number) => (count > 0 ? `${base} · ${count}` : base);

  return (
    <View style={styles.wrap} testID="task-filter-controls">
      {/* Group-by + view toggle */}
      <View style={styles.topRow}>
        <View style={styles.groupTabs}>
          <FilterTabs
            tabs={GROUP_TABS}
            activeTab={groupBy}
            onTabChange={(id) => setGroupBy(id as TaskGroupBy)}
            showActiveIndicator={false}
          />
        </View>
        <View style={[styles.viewToggle, { backgroundColor: colors.secondaryButtonBackground }]}>
          {(['list', 'board'] as const).map((mode) => {
            const active = viewMode === mode;
            return (
              <TouchableOpacity
                key={mode}
                testID={`tasks-view-${mode}`}
                onPress={() => setViewMode(mode)}
                style={[
                  styles.viewBtn,
                  active && [{ backgroundColor: colors.card }, activeToggleShadow],
                ]}
                activeOpacity={0.8}
              >
                <Icon
                  name={mode === 'list' ? 'list' : 'grid'}
                  size={IconSize.md}
                  color={active ? colors.primary : colors.textSecondary}
                />
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        <FilterChip icon="person-outline" label="Mine" active={filters.mineOnly} onPress={toggleMineOnly} testID="task-filter-mine" />
        <FilterChip icon="lock-closed-outline" label="Personal" active={filters.personalOnly} onPress={togglePersonalOnly} testID="task-filter-personal" />
        <FilterChip icon="eye-off-outline" label="Hide done" active={filters.hideDone} onPress={toggleHideDone} testID="task-filter-hide-done" />
        <FilterChip
          icon="people-outline"
          trailingIcon="chevron-down"
          label={chipLabel('Who', filters.assigneeIds.length)}
          active={filters.assigneeIds.length > 0}
          onPress={() => setSheet('assignee')}
          testID="task-filter-who"
        />
        <FilterChip
          icon="location-outline"
          trailingIcon="chevron-down"
          label={chipLabel('Area', filters.spaceIds.length)}
          active={filters.spaceIds.length > 0}
          onPress={() => setSheet('area')}
          testID="task-filter-area"
        />
        <FilterChip
          icon="flag-outline"
          trailingIcon="chevron-down"
          label={chipLabel('Priority', filters.priorities.length)}
          active={filters.priorities.length > 0}
          onPress={() => setSheet('priority')}
          testID="task-filter-priority"
        />
        {hasActiveFilters(filters) && (
          <TouchableOpacity style={styles.clearChip} onPress={clearFilters} activeOpacity={0.8} testID="task-filter-clear">
            <Typography variant="caption1" weight="semibold" color={colors.error}>
              Clear
            </Typography>
          </TouchableOpacity>
        )}
      </ScrollView>

      <MultiSelectSheet
        visible={sheet === 'assignee'}
        title="Filter by who"
        options={assigneeOptions}
        selected={filters.assigneeIds}
        onClose={() => setSheet(null)}
        onChange={setAssigneeIds}
      />
      <MultiSelectSheet
        visible={sheet === 'area'}
        title="Filter by area"
        options={areaOptions}
        selected={filters.spaceIds}
        onClose={() => setSheet(null)}
        onChange={setSpaceIds}
      />
      <MultiSelectSheet
        visible={sheet === 'priority'}
        title="Filter by priority"
        options={priorityOptions}
        selected={filters.priorities}
        onClose={() => setSheet(null)}
        onChange={(next) => setPriorities(next as TaskPrioritySeverity[])}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.smd,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.smd,
  },
  groupTabs: {
    flex: 1,
  },
  viewToggle: {
    flexDirection: 'row',
    borderRadius: Spacing.smd,
    padding: Spacing.inset3,
    gap: Spacing.xxs,
  },
  viewBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipRow: {
    gap: Spacing.sm,
    paddingVertical: Spacing.xxs,
    paddingRight: Spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: CornerRadius.full,
    borderWidth: 1,
  },
  clearChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    justifyContent: 'center',
  },
  sheetContent: {
    paddingBottom: Spacing.xl,
    gap: Spacing.xs,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  optionLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flexShrink: 1,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: CornerRadius.sm,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearRow: {
    paddingVertical: Spacing.base,
    alignItems: 'center',
  },
});
