import React, { useMemo } from 'react';

import type { Task } from '@api/tasks';
import { HomeTaskCard } from '@components/home';
import { useAuthStore } from '@stores/authStore';
import { useMemberStore } from '@stores/memberStore';
import { useSpaceStore } from '@stores/spaceStore';
import { getSystemCategoryIcon, getSystemCategoryLabel } from '@utils/categoryIcons';
import { formatDueDate, mapSystemCategory } from '@utils/taskCardHelpers';

interface TaskCardItemProps {
  task: Task;
  onPress: () => void;
  /** Quick-complete / menu action (renders the card's menu affordance). */
  onMenuPress?: () => void;
  /** Multi-property badge when tasks are aggregated across households. */
  householdId?: string;
  householdName?: string;
}

/**
 * Single source of truth for rendering a task as a card. Used by both the
 * grouped list and the board columns so every task looks identical everywhere.
 */
export function TaskCardItem({
  task,
  onPress,
  onMenuPress,
  householdId,
  householdName,
  testID = 'tasks-list-item',
}: TaskCardItemProps & { testID?: string }) {
  const members = useMemberStore((state) => state.members);
  const spaces = useSpaceStore((state) => state.spaces);
  const currentUser = useAuthStore((state) => state.user);

  // Every card leads with a real avatar: the explicit assignee when there is one,
  // otherwise you (unassigned tasks default to the current user, since quick tasks
  // land with no assignee). So you always see your own face on your tasks and a
  // teammate's face on anything delegated. The avatar URL comes from the member
  // directory; assigned_to only carries { id, display_name }.
  const assigneeId = task.assigned_to?.id ?? currentUser?.id ?? null;
  const assigneeMember = useMemo(
    () => (assigneeId ? members.find((member) => member.user_id === assigneeId) : undefined),
    [members, assigneeId]
  );
  const assigneeName =
    task.assigned_to?.display_name ??
    assigneeMember?.display_name ??
    currentUser?.display_name ??
    currentUser?.email ??
    null;
  const assigneeAvatarUrl = assigneeMember?.avatar_url ?? currentUser?.avatar_url ?? null;

  // Show the card's TRUE category (name + icon), consistent with the detail view —
  // `mapSystemCategory` is used only to tint it into one of the 8 color buckets.
  const categoryLabel = getSystemCategoryLabel(task.system_category);
  const categoryIconName = getSystemCategoryIcon(task.system_category);

  const spaceName = task.space_id
    ? spaces.find((space) => space.id === task.space_id)?.name ?? null
    : null;

  const due = formatDueDate(task);
  return (
    <HomeTaskCard
      title={task.title}
      dueText={due.label}
      dueUrgent={due.urgent}
      category={mapSystemCategory(task.system_category)}
      categoryLabel={categoryLabel}
      categoryIconName={categoryIconName}
      prioritySeverity={task.priority_severity ?? 'nice_to_have'}
      enrichmentStatus={task.enrichment_status}
      riskLevel={task.risk_level}
      timeEffort={task.time_effort}
      clarificationQuestion={task.clarification_question}
      assigneeName={assigneeName}
      assigneeAvatarUrl={assigneeAvatarUrl}
      spaceName={spaceName}
      subtaskProgress={task.subtask_progress}
      blocked={task.blocked}
      isPersonal={task.is_personal}
      coverPhotoUrl={task.cover_photo_url}
      householdId={householdId}
      householdName={householdName}
      onPress={onPress}
      onMenuPress={onMenuPress}
      testID={testID}
    />
  );
}
