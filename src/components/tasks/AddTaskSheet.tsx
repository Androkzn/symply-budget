/**
 * AddTaskSheet — the single, shared "add a task" surface.
 *
 * One bottom sheet, two lanes:
 *  1. Smart capture (top, always visible) — a 3-line, auto-growing text field
 *     with a mic. Type or speak a few words and the backend enriches the rest
 *     (risk / priority / time / subtasks) asynchronously via `tasksApi.quickCreate`.
 *  2. Manual entry (collapsed by default) — tap "Add details manually" to reveal
 *     the full {@link TaskFormBody} with every property and a precise "Create
 *     task" action via `tasksApi.create`.
 *
 * Replaces the old per-screen flows: the inline QuickAddTaskBar + the
 * AddTaskOptionsBottomSheet on the Tasks screen, and the ScheduleTaskScreen
 * modal on Home. Both screens now mount this one component.
 */
import React, { useEffect, useState } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { tasksApi, Task } from '@api/tasks';
import { Avatar, BottomSheet, Button, GradientButton, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { useHouseholdMembers } from '@hooks/useHouseholdMembers';
import { useQuickSpeech } from '@hooks/useQuickSpeech';
import { showToast } from '@services/toastManager';
import { useAuthStore } from '@stores/authStore';
import { useHouseholdStore } from '@stores/householdStore';
import { useNotificationStore } from '@stores/notificationStore';
import { useTaskStore } from '@stores/taskStore';
import {
  Accessibility,
  Chat,
  CornerRadius,
  Elevation,
  IconSize,
  Opacity,
  Spacing,
  TypographyTokens,
  useAppColors,
} from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';
import { buildTaskPhotoSavePayload } from '@utils/taskPhotoSave';

import {
  TaskFormBody,
  TaskFormData,
  createEmptyTaskForm,
  taskFormToRequest,
} from './TaskFormBody';

const MIN_INPUT_HEIGHT = 84; // ~3 lines + padding
const MAX_INPUT_HEIGHT = 180;
const RESET_DELAY_MS = 300; // let the dismiss animation finish before wiping state

/** Pull a human-readable message out of an axios-style error without `any`. */
function extractApiError(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { error?: string } }; message?: string };
  return e?.response?.data?.error || e?.message || fallback;
}

// A few starter prompts that fill the smart-capture field on tap.
const EXAMPLE_PROMPTS = [
  'Clean the gutters this weekend',
  'Service the furnace before winter',
  'Replace smoke detector batteries',
];

interface AddTaskSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Fires after a task is created via either lane (already added to the store). */
  onCreated?: (task: Task) => void;
  /** Optional secondary entry points, shown as buttons at the bottom when provided. */
  onCopyExisting?: () => void;
  onAddFromTemplates?: () => void;
}

export function AddTaskSheet({
  visible,
  onClose,
  onCreated,
  onCopyExisting,
  onAddFromTemplates,
}: AddTaskSheetProps) {  const colors = useAppColors();
  const { currentHousehold } = useHouseholdStore();
  const { addMaintenanceTask } = useTaskStore();
  const { data: members = [] } = useHouseholdMembers(currentHousehold?.id);
  // The signed-in user — used to default a shared task's assignee to "me" so the
  // (now required) assignee is pre-filled instead of forcing a manual pick.
  const currentUserId = useAuthStore((state) => state.user?.id) ?? null;

  const [text, setText] = useState('');
  const [inputHeight, setInputHeight] = useState(MIN_INPUT_HEIGHT);
  const [submitting, setSubmitting] = useState(false);
  const [manualExpanded, setManualExpanded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formData, setFormData] = useState<TaskFormData>(() => ({
    ...createEmptyTaskForm(),
    assigned_to: currentUserId,
  }));
  const [isPersonal, setIsPersonal] = useState(false);
  // Quick-capture assignee — lets a task be handed to a household member right
  // from the primary lane, instead of only via "Add details manually" or after
  // the fact in Task Details.
  const [assignedTo, setAssignedTo] = useState<string | null>(null);
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [showAssigneeList, setShowAssigneeList] = useState(false);

  const { isAvailable, isListening, transcript, error, start, stop, reset } = useQuickSpeech();

  // Mirror the live transcript into the field while dictating.
  useEffect(() => {
    if (isListening && transcript) setText(transcript);
  }, [isListening, transcript]);

  // Members load via useHouseholdMembers (RQ) when the household is known.

  // Reset everything once the sheet has closed so each open starts fresh.
  useEffect(() => {
    if (visible) return;
    const t = setTimeout(() => {
      setText('');
      setInputHeight(MIN_INPUT_HEIGHT);
      setSubmitting(false);
      setManualExpanded(false);
      setCreating(false);
      setFormData({ ...createEmptyTaskForm(), assigned_to: currentUserId });
      setIsPersonal(false);
      setAssignedTo(null);
      setSpaceId(null);
      setShowAssigneeList(false);
      reset();
    }, RESET_DELAY_MS);
    return () => clearTimeout(t);
  }, [visible, reset, currentUserId]);

  const canSubmit = text.trim().length > 0 && !submitting;

  // Request notification permission the first time a user creates a task with
  // reminders on — mirrors ScheduleTaskScreen's "ask after value" behaviour.
  const maybePromptForNotifications = (reminderEnabled: boolean) => {
    const { permissionGranted, permissionPrompted, requestPermission } =
      useNotificationStore.getState();
    if (reminderEnabled && !permissionGranted && !permissionPrompted) {
      setTimeout(async () => {
        const granted = await requestPermission();
        if (granted) {
          showToast('success', "Notifications enabled! You'll be reminded about this task.");
        }
      }, 600);
    }
  };

  const handleMicPress = async () => {
    if (isListening) {
      console.log('[AddTask] mic pressed → stopping dictation');
      await stop();
      return;
    }
    console.log('[AddTask] mic pressed → starting dictation');
    reset();
    await start();
  };

  const handleQuickSubmit = async () => {
    const value = text.trim();
    if (!value || submitting) return;
    if (!currentHousehold) {
      showToast('error', 'No property selected');
      return;
    }
    if (isListening) await stop();
    console.log('[AddTask] quickCreate → POST', {
      householdId: currentHousehold.id,
      textLen: value.length,
      text: value,
    });
    setSubmitting(true);
    const startedAt = Date.now();
    try {
      const { task } = await tasksApi.quickCreate(currentHousehold.id, {
        text: value,
        is_personal: isPersonal,
        // Personal tasks belong to the current user only, so never carry an assignee.
        assigned_to: isPersonal ? undefined : assignedTo ?? undefined,
        space_id: spaceId ?? undefined,
      });
      console.log('[AddTask] quickCreate ← response', {
        ms: Date.now() - startedAt,
        taskId: task.id,
        title: task.title,
        enrichment_status: task.enrichment_status,
        next_due_date: task.next_due_date ?? null,
        assigned_to: task.assigned_to?.display_name ?? null,
      });
      addMaintenanceTask(task);
      console.log('[AddTask] optimistic insert done — card should show "Analyzing…"');
      onCreated?.(task);
      showToast('success', "Task added — we're filling in the details");
      onClose();
    } catch (err) {
      console.warn('[AddTask] quickCreate failed', extractApiError(err, 'Failed to add task'));
      showToast('error', extractApiError(err, 'Failed to add task'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleManualCreate = async () => {
    if (!currentHousehold) {
      showToast('error', 'No property selected');
      return;
    }
    if (!formData.title.trim()) {
      showToast('error', 'Please enter a task name');
      return;
    }
    // Shared tasks must have an owner — personal tasks are implicitly the
    // current user's, so they skip this.
    if (!formData.is_personal && !formData.assigned_to) {
      showToast('error', 'Please assign this task to someone');
      return;
    }
    if (formData.frequency === 'custom') {
      const days = parseInt(formData.custom_interval_days, 10);
      if (isNaN(days) || days < 1) {
        showToast('error', 'Please enter a valid number of days');
        return;
      }
    }
    setCreating(true);
    try {
      const photoPayload = await buildTaskPhotoSavePayload(
        currentHousehold.id,
        formData.photos,
        formData.coverPhotoIndex
      );
      const result = await tasksApi.create(currentHousehold.id, {
        ...taskFormToRequest(formData),
        ...(formData.photos.length > 0 ? photoPayload : {}),
      });
      addMaintenanceTask(result.task);
      onCreated?.(result.task);
      showToast('success', 'Task created');
      maybePromptForNotifications(formData.reminder_enabled);
      onClose();
    } catch (err) {
      showToast('error', extractApiError(err, 'Failed to create task'));
    } finally {
      setCreating(false);
    }
  };

  const handleSecondary = (callback?: () => void) => {
    if (!callback) return;
    onClose();
    setTimeout(callback, RESET_DELAY_MS);
  };

  const togglePersonal = () => {
    setIsPersonal((prev) => {
      const next = !prev;
      // Personal tasks are never assigned to someone else — clear + collapse.
      if (next) {
        setAssignedTo(null);
        setShowAssigneeList(false);
      }
      return next;
    });
  };

  const assignedMember = members.find((m) => m.user_id === assignedTo) ?? null;
  const assigneeLabel = assignedTo
    ? assignedMember?.display_name || assignedMember?.email || 'Assigned'
    : 'Assign';

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      height="full"
      showHandle
      showCloseButton
      title="Add Task"
    >
      {/* A plain `View`, not a `KeyboardAvoidingView`: the shared `BottomSheet`
          already lifts and caps itself against the keyboard, and a KAV inside it
          only shrank this viewport without ever scrolling the focused field back
          into view. The ScrollView's `automaticallyAdjustKeyboardInsets` (from
          `keyboardDismissScrollProps`) is the half that actually reveals it. */}
      <View testID="add-task-sheet" style={styles.flex}>
        <ScrollView
          {...keyboardDismissScrollProps}
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Smart capture ───────────────────────────────────────────── */}
          <View
            style={[
              styles.captureCard,
              {
                backgroundColor: colors.backgroundSecondary,
                borderColor: isListening ? colors.primary : colors.borderColor,
                shadowColor: colors.black,
              },
            ]}
          >
            <View style={styles.captureHeaderRow}>
              <View style={styles.captureLabel}>
                <Icon name="sparkles" size={IconSize.sm} color={colors.primary} />
                <Typography variant="footnote" weight="semibold" color={colors.primary}>
                  Describe your task
                </Typography>
              </View>
              {text.length > 0 && !submitting && (
                <TouchableOpacity
                  onPress={() => setText('')}
                  hitSlop={{
                    top: Spacing.sm,
                    bottom: Spacing.sm,
                    left: Spacing.sm,
                    right: Spacing.sm,
                  }}
                  accessibilityLabel="Clear text"
                >
                  <Typography variant="caption1" color={colors.textSecondary}>
                    Clear
                  </Typography>
                </TouchableOpacity>
              )}
            </View>

            <TextInput
              testID="add-task-input"
              value={text}
              onChangeText={setText}
              placeholder="e.g. Clean the gutters before the rainy season…"
              placeholderTextColor={colors.textTertiary}
              style={[
                styles.input,
                {
                  color: colors.textPrimary,
                  height: Math.min(Math.max(inputHeight, MIN_INPUT_HEIGHT), MAX_INPUT_HEIGHT),
                },
              ]}
              editable={!submitting}
              multiline
              textAlignVertical="top"
              onContentSizeChange={(e) =>
                setInputHeight(e.nativeEvent.contentSize.height + Spacing.base)
              }
            />

            <View style={styles.captureActions}>
              {isAvailable && (
                <TouchableOpacity
                  onPress={handleMicPress}
                  disabled={submitting}
                  style={[
                    styles.micButton,
                    {
                      backgroundColor: isListening
                        ? colors.primary
                        : colors.secondaryButtonBackground,
                    },
                  ]}
                  accessibilityLabel={isListening ? 'Stop voice input' : 'Start voice input'}
                >
                  <Icon
                    name={isListening ? 'stop' : 'mic'}
                    size={IconSize.md}
                    color={isListening ? colors.white : colors.primary}
                  />
                </TouchableOpacity>
              )}

              <View style={styles.flex} />

              <GradientButton
                title={submitting ? 'Adding…' : 'Add task'}
                variant="blue"
                size="sm"
                onPress={handleQuickSubmit}
                disabled={!canSubmit}
                testID="add-task-submit"
              />
            </View>

            {isListening && (
              <View style={styles.hintRow}>
                <Icon name="radio-button-on" size={IconSize.sm} color={colors.primary} />
                <Typography variant="caption2" color={colors.primary}>
                  Listening… tap stop when done
                </Typography>
              </View>
            )}
            {!!error && !isListening && (
              <Typography variant="caption2" color={colors.error} style={styles.errorHint}>
                {error}
              </Typography>
            )}

            {/* Personal toggle + quick assignee — a task can be handed to a
                household member without opening "Add details manually". */}
            <View style={styles.pillRow}>
              <TouchableOpacity
                style={[
                  styles.pill,
                  isPersonal && { backgroundColor: colors.pillBackground, borderColor: colors.primary },
                  !isPersonal && { borderColor: colors.borderColor },
                ]}
                onPress={togglePersonal}
                activeOpacity={0.7}
                testID="add-task-personal-toggle"
              >
                <Icon
                  name={isPersonal ? 'lock-closed' : 'lock-open-outline'}
                  size={IconSize.sm}
                  color={isPersonal ? colors.primary : colors.textSecondary}
                />
                <Typography
                  variant="caption1"
                  weight={isPersonal ? 'semibold' : 'regular'}
                  color={isPersonal ? colors.primary : colors.textSecondary}
                >
                  {isPersonal ? 'Personal (only me)' : 'Shared with household'}
                </Typography>
              </TouchableOpacity>

              {!isPersonal && (
                <TouchableOpacity
                  style={[
                    styles.pill,
                    assignedTo
                      ? { backgroundColor: colors.pillBackground, borderColor: colors.primary }
                      : { borderColor: colors.borderColor },
                  ]}
                  onPress={() => setShowAssigneeList((v) => !v)}
                  activeOpacity={0.7}
                  testID="add-task-assignee-toggle"
                >
                  <Icon
                    name="person-circle-outline"
                    size={IconSize.sm}
                    color={assignedTo ? colors.primary : colors.textSecondary}
                  />
                  <Typography
                    variant="caption1"
                    weight={assignedTo ? 'semibold' : 'regular'}
                    color={assignedTo ? colors.primary : colors.textSecondary}
                  >
                    {assigneeLabel}
                  </Typography>
                  <Icon
                    name={showAssigneeList ? 'chevron-up' : 'chevron-down'}
                    size={IconSize.sm}
                    color={colors.textTertiary}
                  />
                </TouchableOpacity>
              )}
            </View>

            {/* Inline member list — avoids nesting a Modal inside this sheet. */}
            {!isPersonal && showAssigneeList && (
              <View style={[styles.assigneeList, { borderColor: colors.borderColor }]}>
                <TouchableOpacity
                  style={styles.assigneeOption}
                  onPress={() => {
                    setAssignedTo(null);
                    setShowAssigneeList(false);
                  }}
                  activeOpacity={0.7}
                >
                  <View style={styles.assigneeOptionLeft}>
                    <View style={[styles.autoAvatar, { backgroundColor: colors.pillBackground }]}>
                      <Icon name="sparkles" size={IconSize.sm} color={colors.primary} />
                    </View>
                    <Typography
                      variant="subheadline"
                      color={!assignedTo ? colors.primary : colors.textPrimary}
                    >
                      Auto (AI assigns)
                    </Typography>
                  </View>
                  {!assignedTo && (
                    <Icon name="checkmark" size={IconSize.sm} color={colors.primary} />
                  )}
                </TouchableOpacity>
                {members.map((member) => {
                  const selected = member.user_id === assignedTo;
                  return (
                    <TouchableOpacity
                      key={member.user_id}
                      style={[styles.assigneeOption, { borderTopColor: colors.borderColor }]}
                      onPress={() => {
                        setAssignedTo(member.user_id);
                        setShowAssigneeList(false);
                      }}
                      activeOpacity={0.7}
                    >
                      <View style={styles.assigneeOptionLeft}>
                        <Avatar
                          size="sm"
                          user={{
                            display_name: member.display_name,
                            avatar_url: member.avatar_url,
                            email: member.email,
                          }}
                        />
                        <Typography
                          variant="subheadline"
                          color={selected ? colors.primary : colors.textPrimary}
                        >
                          {member.display_name || member.email}
                        </Typography>
                      </View>
                      {selected && (
                        <Icon name="checkmark" size={IconSize.sm} color={colors.primary} />
                      )}
                    </TouchableOpacity>
                  );
                })}
                {members.length === 0 && (
                  <View style={styles.assigneeOption}>
                    <Typography variant="caption1" color={colors.textSecondary}>
                      No household members found
                    </Typography>
                  </View>
                )}
              </View>
            )}
          </View>

          {/* Example prompts — only useful before anything is typed */}
          {text.length === 0 && !manualExpanded && (
            <View style={styles.examplesRow}>
              {EXAMPLE_PROMPTS.map((prompt) => (
                <TouchableOpacity
                  key={prompt}
                  style={[styles.exampleChip, { backgroundColor: colors.pillBackground }]}
                  onPress={() => setText(prompt)}
                  activeOpacity={0.7}
                >
                  <Typography variant="caption1" color={colors.textSecondary}>
                    {prompt}
                  </Typography>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* ── Manual entry (collapsed by default) ──────────────────────── */}
          <TouchableOpacity
            style={[
              styles.manualToggle,
              {
                backgroundColor: colors.backgroundSecondary,
                borderColor: colors.borderColor,
              },
            ]}
            onPress={() => setManualExpanded((v) => !v)}
            activeOpacity={0.7}
            testID="add-task-manual-toggle"
          >
            <View
              style={[styles.manualIcon, { backgroundColor: colors.secondaryButtonBackground }]}
            >
              <Icon name="options-outline" size={IconSize.md} color={colors.primary} />
            </View>
            <View style={styles.manualToggleText}>
              <Typography variant="subheadline" weight="semibold" color={colors.textPrimary}>
                Add details manually
              </Typography>
              <Typography variant="caption1" color={colors.textSecondary}>
                Set category, priority, due date, reminders & more
              </Typography>
            </View>
            <Icon
              name={manualExpanded ? 'chevron-down' : 'chevron-forward'}
              size={IconSize.md}
              color={colors.textTertiary}
            />
          </TouchableOpacity>

          {manualExpanded && (
            <View style={styles.manualBody}>
              <TaskFormBody
                formData={formData}
                onChange={(patch) => setFormData((prev) => ({ ...prev, ...patch }))}
              />
              <GradientButton
                title={creating ? 'Creating…' : 'Create task'}
                variant="blue"
                onPress={handleManualCreate}
                disabled={creating}
                style={styles.createButton}
                fullWidth
                testID="add-task-create-manual"
              />
            </View>
          )}

          {/* ── Secondary entry points ───────────────────────────────────── */}
          {(onCopyExisting || onAddFromTemplates) && (
            <View style={styles.secondaryRow}>
              {onCopyExisting && (
                <Button
                  title="Copy existing"
                  variant="outline"
                  size="sm"
                  onPress={() => handleSecondary(onCopyExisting)}
                  style={styles.secondaryButton}
                  testID="add-task-copy-existing"
                  leftIcon={
                    <Icon name="copy-outline" size={IconSize.sm} color={colors.primary} />
                  }
                />
              )}
              {onAddFromTemplates && (
                <Button
                  title="Templates"
                  variant="outline"
                  size="sm"
                  onPress={() => handleSecondary(onAddFromTemplates)}
                  style={styles.secondaryButton}
                  testID="add-task-templates"
                  leftIcon={
                    <Icon name="library-outline" size={IconSize.sm} color={colors.primary} />
                  }
                />
              )}
            </View>
          )}
        </ScrollView>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.xxl,
  },
  captureCard: {
    borderRadius: CornerRadius.lg,
    borderWidth: 1,
    padding: Spacing.base,
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: Spacing.xs },
        shadowOpacity: Opacity.headerBarShadow,
        shadowRadius: Spacing.md,
      },
      android: {
        elevation: Elevation.cardRaised,
      },
    }),
  },
  captureHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  captureLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs + Spacing.xxs,
  },
  input: {
    fontSize: TypographyTokens.body.size,
    lineHeight: TypographyTokens.body.lineHeight,
    paddingVertical: 0,
  },
  captureActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.md,
  },
  micButton: {
    width: Chat.actionButtonSize,
    height: Chat.actionButtonSize,
    borderRadius: CornerRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.sm,
  },
  errorHint: {
    marginTop: Spacing.sm,
  },
  examplesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  exampleChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: CornerRadius.full,
  },
  manualToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderWidth: 1,
    borderRadius: CornerRadius.lg,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.md,
    marginTop: Spacing.xl,
  },
  manualIcon: {
    width: Accessibility.minTapTarget,
    height: Accessibility.minTapTarget,
    borderRadius: CornerRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manualToggleText: {
    flex: 1,
    gap: Spacing.xxs,
  },
  manualBody: {
    marginTop: Spacing.sm,
  },
  createButton: {
    marginTop: Spacing.xl,
  },
  secondaryRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: Spacing.xl,
  },
  secondaryButton: {
    flex: 1,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: CornerRadius.full,
    borderWidth: 1,
  },
  assigneeList: {
    marginTop: Spacing.sm,
    borderWidth: 1,
    borderRadius: CornerRadius.md,
    overflow: 'hidden',
  },
  assigneeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'transparent',
  },
  assigneeOptionLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  autoAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
