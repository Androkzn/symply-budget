import React from 'react';
import { StyleSheet, View, ScrollView } from 'react-native';

import type { Task } from '@api/tasks';
import { Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import type { BoardSection } from '@hooks/useTaskBoardData';
import { useAppColors } from '@theme';

import { TaskCardItem } from './TaskCardItem';

interface TaskBoardColumnProps {
  section: BoardSection;
  width: number;
  onTaskPress: (task: Task) => void;
  onTaskMenu: (task: Task) => void;
}

/** A single vertical column in the Board view: header + scrollable card stack. */
export function TaskBoardColumn({ section, width, onTaskPress, onTaskMenu }: TaskBoardColumnProps) {
  const colors = useAppColors();  const accent = section.color ?? colors.primary;

  return (
    <View style={[styles.column, { width, backgroundColor: colors.backgroundMain }]}>
      <View style={[styles.header, { borderBottomColor: colors.borderColor }]}>
        <View style={[styles.rail, { backgroundColor: accent }]} />
        {section.icon ? (
          <Icon name={section.icon} size={16} color={accent} />
        ) : null}
        <Typography variant="subheadline" weight="bold" color={colors.textPrimary} numberOfLines={1} style={styles.headerTitle}>
          {section.emoji ? `${section.emoji} ` : ''}
          {section.title}
        </Typography>
        <View style={[styles.countBadge, { backgroundColor: `${accent}1F` }]}>
          <Typography variant="caption2" weight="bold" color={accent}>
            {section.tasks.length}
          </Typography>
        </View>
      </View>

      <ScrollView
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.cards}
      >
        {section.tasks.length === 0 ? (
          <View style={styles.empty}>
            <Typography variant="caption1" color={colors.textTertiary} align="center">
              No tasks
            </Typography>
          </View>
        ) : (
          section.tasks.map((task) => (
            <TaskCardItem
              key={task.id}
              task={task}
              onPress={() => onTaskPress(task)}
              onMenuPress={() => onTaskMenu(task)}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  column: {
    flex: 1,
    borderRadius: 16,
    paddingHorizontal: 8,
    paddingTop: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 8,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rail: {
    width: 4,
    height: 18,
    borderRadius: 2,
  },
  headerTitle: {
    flex: 1,
  },
  countBadge: {
    minWidth: 24,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    alignItems: 'center',
  },
  cards: {
    paddingTop: 10,
    paddingBottom: 24,
  },
  empty: {
    paddingVertical: 32,
  },
});
