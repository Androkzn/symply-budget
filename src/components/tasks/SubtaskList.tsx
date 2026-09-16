import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { TouchableOpacity } from 'react-native-gesture-handler';
import Sortable, { type SortableGridRenderItem } from 'react-native-sortables';

import { tasksApi, type MaintenanceSubtask } from '@api/tasks';
import { Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { showToast } from '@services/toastManager';
import { useTaskStore } from '@stores/taskStore';
import {IconSize, Spacing, useAppColors } from '@theme';

import { AddSubtaskModal } from './AddSubtaskModal';
import { SubtaskItem } from './SubtaskItem';

interface SubtaskListProps {
  subtasks: MaintenanceSubtask[];
  taskId: string;
  householdId: string;
  // Callback to reload parent task. `silent` skips the parent's full-screen
  // loading spinner (used after optimistic changes like reorder).
  onUpdate: (opts?: { silent?: boolean }) => void;
}

export function SubtaskList({
  subtasks,
  taskId,
  householdId,
  onUpdate,
}: SubtaskListProps) {
  const colors = useAppColors();  const updateTaskWithSubtasks = useTaskStore((state) => state.updateTaskWithSubtasks);
  const removeSubtask = useTaskStore((state) => state.removeSubtask);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingSubtask, setEditingSubtask] = useState<MaintenanceSubtask | null>(null);
  const [togglingSubtaskId, setTogglingSubtaskId] = useState<string | null>(null);

  // Local drag order: seeded from props, updated optimistically on drop, and
  // re-synced whenever the parent reloads the subtasks (e.g. after add/delete).
  const [orderedSubtasks, setOrderedSubtasks] = useState<MaintenanceSubtask[]>(subtasks);
  useEffect(() => {
    setOrderedSubtasks(subtasks);
  }, [subtasks]);

  // Calculate progress
  const completed = subtasks.filter(s => s.is_completed).length;
  const total = subtasks.length;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

  const handleReorder = useCallback(
    async (reordered: MaintenanceSubtask[]) => {
      const previous = orderedSubtasks;
      // Optimistic: reflect the new order immediately.
      setOrderedSubtasks(reordered);
      if (Platform.OS === 'ios') {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
      try {
        await tasksApi.reorderSubtasks(
          householdId,
          taskId,
          reordered.map((s) => s.id)
        );
        // Reload parent so the store's copy reflects the persisted order.
        // Silent: the new order is already shown optimistically, so don't flash
        // the parent's full-screen loading spinner.
        onUpdate({ silent: true });
      } catch (error) {
        console.error('[SubtaskList] Reorder failed:', error);
        showToast('error', 'Failed to reorder subtasks');
        // Revert to the last known-good order.
        setOrderedSubtasks(previous);
      }
    },
    [orderedSubtasks, householdId, taskId, onUpdate]
  );

  const handleToggle = async (subtaskId: string, isCompleted: boolean) => {
    try {
      setTogglingSubtaskId(subtaskId);

      // Call API - returns both updated subtask AND updated task with recalculated progress
      const response = isCompleted
        ? await tasksApi.uncompleteSubtask(householdId, taskId, subtaskId)
        : await tasksApi.completeSubtask(householdId, taskId, subtaskId);

      // Update store with backend response (authoritative progress calculation)
      updateTaskWithSubtasks(taskId, response.task);

      // Also notify parent in case it needs to update other UI. Silent: the
      // store was already updated above, so don't flash the full-screen spinner.
      onUpdate({ silent: true });
    } catch (error) {
      console.error('[SubtaskList] Toggle failed:', error);
      showToast('error', 'Failed to update subtask');
      // Reload to ensure consistency
      onUpdate();
    } finally {
      setTogglingSubtaskId(null);
    }
  };

  const handleEdit = (subtask: MaintenanceSubtask) => {
    setEditingSubtask(subtask);
    setShowAddModal(true);
  };

  const handleDelete = async (subtaskId: string) => {
    try {
      await tasksApi.deleteSubtask(householdId, taskId, subtaskId);

      // Update store to remove subtask and recalculate progress
      removeSubtask(taskId, subtaskId);

      showToast('success', 'Subtask deleted');

      // Notify parent so it can update other UI. Silent: the store was already
      // updated optimistically above, so don't flash the full-screen spinner.
      onUpdate({ silent: true });
    } catch (error) {
      console.error('[SubtaskList] Delete failed:', error);
      showToast('error', 'Failed to delete subtask');
    }
  };

  const handleCloseModal = () => {
    setShowAddModal(false);
    setEditingSubtask(null);
  };

  const handleSubtaskSaved = () => {
    setShowAddModal(false);
    setEditingSubtask(null);
    // Silent reload: the added/edited subtask updates in place without flashing
    // the parent's full-screen loading spinner.
    onUpdate({ silent: true });
  };

  // Each row: a drag grip (only when there's something to reorder) plus the
  // existing SubtaskItem. Dragging is restricted to the grip (`customHandle` on
  // the grid), so tap-to-toggle, the ⋮ menu, and the parent ScrollView all keep
  // working normally.
  const renderSubtask = useCallback<SortableGridRenderItem<MaintenanceSubtask>>(
    ({ item }) => (
      <View style={styles.draggableRow}>
        {total > 1 && (
          <Sortable.Handle>
            <View style={styles.dragHandle}>
              <Icon
                name="reorder-three"
                size={IconSize.md}
                color={colors.textTertiary}
              />
            </View>
          </Sortable.Handle>
        )}
        <View style={styles.draggableItem}>
          <SubtaskItem
            subtask={item}
            onToggle={handleToggle}
            onEdit={handleEdit}
            onDelete={handleDelete}
            disabled={togglingSubtaskId === item.id}
          />
        </View>
      </View>
    ),
    // handleToggle/handleEdit/handleDelete are stable within a render pass.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [total, colors.textTertiary, togglingSubtaskId]
  );

  return (
    <View style={styles.container} testID="task-detail-subtasks">
      {/* Header: title + progress counter on the left, Add on the right */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Typography variant="title3" weight="semibold">
            Subtasks
          </Typography>
          {total > 0 && (
            <View
              style={[
                styles.progressBadge,
                {
                  backgroundColor:
                    percentage === 100
                      ? colors.success + '20'
                      : colors.primary + '15',
                },
              ]}
            >
              <View style={styles.progressBadgeContent}>
                <Icon
                  name="checkmark"
                  size={12}
                  color={percentage === 100 ? colors.success : colors.primary}
                />
                <Typography
                  variant="footnote"
                  weight="semibold"
                  color={percentage === 100 ? colors.success : colors.primary}
                >
                  {completed}/{total}
                </Typography>
              </View>
            </View>
          )}
        </View>

        {/* Add button in the header - RNGH for taps inside Modal+ScrollView */}
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => setShowAddModal(true)}
          activeOpacity={0.7}
          testID="task-detail-add-subtask"
        >
          <View style={styles.addButtonContent}>
            <Icon name="add" size={IconSize.md} color={colors.primary} />
            <Typography variant="body" weight="medium" color={colors.primary}>
              Add Subtask
            </Typography>
          </View>
        </TouchableOpacity>
      </View>

      {/* Subtask list — drag the grip handle to reorder */}
      {total > 0 ? (
        <View style={styles.list}>
          <Sortable.Grid
            columns={1}
            data={orderedSubtasks}
            keyExtractor={(item) => item.id}
            renderItem={renderSubtask}
            customHandle
            rowGap={0}
            dragActivationDelay={0}
            activeItemScale={1.02}
            activeItemShadowOpacity={0.15}
            onDragStart={() => {
              if (Platform.OS === 'ios') {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }
            }}
            onDragEnd={({ data }) => {
              void handleReorder(data);
            }}
          />
        </View>
      ) : (
        <View style={styles.emptyState}>
          <Typography variant="body" color={colors.textSecondary} align="center">
            No subtasks yet. Break this task into smaller steps.
          </Typography>
        </View>
      )}

      {/* Add/Edit Modal */}
      <AddSubtaskModal
        visible={showAddModal}
        taskId={taskId}
        householdId={householdId}
        editingSubtask={editingSubtask}
        onClose={handleCloseModal}
        onSave={handleSubtaskSaved}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.gapTight5,
  },
  progressBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  progressBadgeContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  list: {
    gap: 4,
  },
  draggableRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dragHandle: {
    paddingVertical: Spacing.sm,
    paddingLeft: Spacing.xxs,
    paddingRight: Spacing.sm,
    // Nudge up so the grip visually centers on the card, not the row+margin.
    marginBottom: Spacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  draggableItem: {
    flex: 1,
  },
  emptyState: {
    paddingVertical: 24,
  },
  addButton: {
    paddingVertical: Spacing.xs,
  },
  addButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
});
