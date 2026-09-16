import type { CompositeNavigationProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation, useRoute, RouteProp } from 'expo-router/react-navigation';
import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Platform, KeyboardAvoidingView, ScrollView } from 'react-native';
// Gesture-handler touchables — plain RN TouchableOpacity has its taps swallowed
// by the gesture root in the nested detail→edit stack, which made the header
// back arrow unresponsive. Matches TaskDetailScreen's buttons.
//
// The GestureHandlerRootView wrap below is REQUIRED: this screen is also
// registered on the parent Tasks stack with `presentation: 'modal'`, and RNGH
// touchables inside a native-stack modal live in a separate view controller
// OUTSIDE the app-root GestureHandlerRootView, so without their own root they
// receive no touches — the header back/save (and the whole screen) appear
// frozen. Nesting a root here restores touch handling in every presentation.
import { GestureHandlerRootView, TouchableOpacity } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Edge } from 'react-native-safe-area-context';

import { tasksApi, Task } from '@api/tasks';
import { AppBackground, SafeAreaView, ScreenHeader, SheetHeader } from '@components/common';
import {
  TaskFormBody,
  TaskFormData,
  createEmptyTaskForm,
  taskFormToRequest,
  taskToFormData,
} from '@components/tasks/TaskFormBody';
import { GradientButton, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { useTaskDetailSheetOnBack } from '@contexts/index';
import { useDeviceType } from '@hooks/useDeviceType';
import { useUnsavedChanges } from '@hooks/useUnsavedChanges';
import type { TaskDetailStackParamList, TasksStackParamList } from '@navigation/types';
import { showToast } from '@services/toastManager';
import { useAuthStore } from '@stores/authStore';
import { useHouseholdStore } from '@stores/householdStore';
import { useNotificationStore } from '@stores/notificationStore';
import { useTaskStore } from '@stores/taskStore';
import { CornerRadius, Spacing, useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';
import { buildTaskPhotoSavePayload } from '@utils/taskPhotoSave';

type ScheduleTaskRouteProp =
  | RouteProp<TaskDetailStackParamList, 'ScheduleTask'>
  | RouteProp<TasksStackParamList, 'ScheduleTask'>;
type ScheduleTaskNavigationProp = CompositeNavigationProp<
  NativeStackNavigationProp<TaskDetailStackParamList, 'ScheduleTask'>,
  NativeStackNavigationProp<TasksStackParamList>
>;

interface ScheduleTaskScreenProps {
  onClose?: () => void;
  onSave?: () => void;
}

const HEADER_HEIGHT = Spacing.xxl * 2;

export function ScheduleTaskScreen({ onClose, onSave }: ScheduleTaskScreenProps = {}) {  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const { isIPad } = useDeviceType();
  const navigation = useNavigation<ScheduleTaskNavigationProp>();
  const route = useRoute<ScheduleTaskRouteProp>();
  const sheetOnBack = useTaskDetailSheetOnBack();
  const inSheet = !!sheetOnBack;
  const { currentHousehold } = useHouseholdStore();
  const { addMaintenanceTask, updateMaintenanceTask } = useTaskStore();
  // Default a new shared task's (now required) assignee to the current user so
  // Save isn't blocked out of the gate; editing loads the task's real assignee.
  const currentUserId = useAuthStore((state) => state.user?.id) ?? null;

  const taskId = route.params?.taskId;
  const existingTask = route.params?.task as Task | undefined;
  const isEditing = !!taskId;

  const [formData, setFormData] = useState<TaskFormData>(() => ({
    ...createEmptyTaskForm(),
    assigned_to: currentUserId,
  }));
  // Last-saved snapshot to diff the form against: an empty form for create, the
  // loaded task for edit. See [[useUnsavedChanges]].
  const [baseline, setBaseline] = useState<TaskFormData>(() => ({
    ...createEmptyTaskForm(),
    assigned_to: currentUserId,
  }));
  const [scrollViewportHeight, setScrollViewportHeight] = useState<number | null>(null);

  // Populate form when editing (from route params or by fetching taskId)
  useEffect(() => {
    if (existingTask) {
      const loaded = taskToFormData(existingTask);
      setFormData(loaded);
      setBaseline(loaded);
      return;
    }

    if (!isEditing || !taskId || !currentHousehold) return;

    let cancelled = false;
    (async () => {
      try {
        const result = await tasksApi.get(currentHousehold.id, taskId);
        if (!cancelled) {
          const loaded = taskToFormData(result.task);
          setFormData(loaded);
          setBaseline(loaded);
        }
      } catch {
        if (!cancelled) showToast('error', 'Failed to load task');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [existingTask, isEditing, taskId, currentHousehold]);

  const handleChange = (patch: Partial<TaskFormData>) => {
    setFormData((prev) => ({ ...prev, ...patch }));
  };

  // Disable Save until the form diverges from its snapshot; on success show a
  // toast then run the existing post-save dismiss (callback prop when embedded,
  // otherwise pop the screen). See [[useUnsavedChanges]].
  const { isDirty, isSaving, save } = useUnsavedChanges({
    values: { formData },
    baseline: { formData: baseline },
    successMessage: isEditing ? 'Changes saved' : 'Task scheduled',
    onClose: () => {
      if (onSave) {
        onSave();
      } else {
        navigation.goBack();
      }
    },
    onSave: async () => {
      if (!currentHousehold) {
        showToast('error', 'No property selected');
        return false;
      }

      if (!formData.title.trim()) {
        showToast('error', 'Please enter a task name');
        return false;
      }

      // Shared tasks must have an owner — personal tasks are implicitly the
      // current user's, so they skip this.
      if (!formData.is_personal && !formData.assigned_to) {
        showToast('error', 'Please assign this task to someone');
        return false;
      }

      if (formData.frequency === 'custom') {
        const days = parseInt(formData.custom_interval_days, 10);
        if (isNaN(days) || days < 1) {
          showToast('error', 'Please enter a valid number of days');
          return false;
        }
      }

      const requestData = taskFormToRequest(formData, { isEditing });
      // Save-time upload is now the LEGACY path only. A photo added while House
      // local-first is on already went through the H6 encrypted blob channel in
      // `TaskFormPhotos` and carries a `HouseBlobDescriptor`;
      // `buildTaskPhotoSavePayload` recognises that and passes the descriptor
      // straight through instead of POSTing the same image to R2 a second time.
      // Photos with only a local uri (flag off, or a task created on the server
      // path) still upload here exactly as before.
      const photoPayload = await buildTaskPhotoSavePayload(
        currentHousehold.id,
        formData.photos,
        formData.coverPhotoIndex
      );
      const payload = {
        ...requestData,
        ...(formData.photos.length > 0 || isEditing ? photoPayload : {}),
      };

      if (isEditing && taskId) {
        // Pass the raw assignee (incl. null) so an edit can reassign or unassign.
        const result = await tasksApi.update(currentHousehold.id, taskId, {
          ...payload,
          assigned_to: formData.is_personal ? null : formData.assigned_to,
          space_id: formData.space_id,
        });
        updateMaintenanceTask(taskId, result.task);
      } else {
        const result = await tasksApi.create(currentHousehold.id, payload);
        addMaintenanceTask(result.task);

        // 2026 Best Practice: Request notification permission after user sees value.
        // Only prompt if reminders are enabled and we haven't prompted before.
        const { permissionGranted, permissionPrompted, requestPermission } =
          useNotificationStore.getState();
        if (formData.reminder_enabled && !permissionGranted && !permissionPrompted) {
          setTimeout(async () => {
            const granted = await requestPermission();
            if (granted) {
              showToast('success', "Notifications enabled! You'll be reminded about this task.");
            }
          }, 500);
        }
      }

      return;
    },
  });

  const handleClose = () => {
    if (onClose) {
      onClose();
      return;
    }
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    // Embedded in the Home bottom sheet with nothing to pop — let the sheet close.
    if (sheetOnBack) {
      sheetOnBack();
      return;
    }
    if (isEditing && taskId) {
      navigation.navigate('TaskDetail', {
        taskId,
        householdId: currentHousehold?.id,
      });
    }
  };

  const safeAreaEdges: Edge[] =
    inSheet && !isIPad ? ['bottom'] : isIPad ? ['bottom'] : [];
  const saveLabel = isSaving ? 'Saving...' : isEditing ? 'Save' : 'Create';
  const saveDisabled =
    isSaving ||
    !isDirty ||
    !formData.title.trim() ||
    (!formData.is_personal && !formData.assigned_to);
  const footerBottomInset = inSheet ? insets.bottom : Math.max(insets.bottom, Spacing.lg);
  const footerHeight = Spacing.xxl + Spacing.xl + footerBottomInset;
  const avoidKeyboard = Platform.OS === 'ios' && !isIPad;

  const body = (
    <View
      style={[styles.container, { backgroundColor: colors.backgroundMain }]}
      onLayout={(event) => {
        // Fixed scroll height is only needed for iPad bottom-sheet embeds where
        // flex ScrollView fails to receive touches; iPhone uses flex layout.
        if (!isIPad || !inSheet) return;
        const height = event.nativeEvent.layout.height;
        const bodyHeight = height - HEADER_HEIGHT - footerHeight;
        if (bodyHeight > 0) {
          setScrollViewportHeight(bodyHeight);
        }
      }}
    >
            {inSheet ? (
              <SheetHeader
                title={isEditing ? 'Edit Task' : 'New Task'}
                leftVariant="back"
                onLeftPress={handleClose}
                rightLabel={saveLabel}
                onRightPress={save}
                rightDisabled={saveDisabled}
                rightTestID="schedule-task-save-header"
                TouchableComponent={TouchableOpacity}
              />
            ) : (
              <ScreenHeader
                title={isEditing ? 'Edit Task' : 'New Task'}
                showBackButton
                onBackPress={handleClose}
                showNotificationBell={false}
                showAvatar={false}
                rightElement={
                  <TouchableOpacity
                    onPress={save}
                    disabled={saveDisabled}
                    activeOpacity={0.7}
                    testID="schedule-task-save-header"
                  >
                    <Typography
                      variant="body"
                      weight="semibold"
                      color={saveDisabled ? colors.textSecondary : colors.primary}
                    >
                      {saveLabel}
                    </Typography>
                  </TouchableOpacity>
                }
              />
            )}

          {/* `keyboardDismissScrollProps` carries `automaticallyAdjustKeyboardInsets`,
              which is the half that actually SCROLLS the focused field clear of the
              keypad. The `KeyboardAvoidingView` below only shrinks the viewport, so
              on its own it left Task Name / Notes behind the keyboard; it stays
              because the pinned Create-Task footer sits OUTSIDE this scroller and
              still needs lifting. */}
          <ScrollView
            {...keyboardDismissScrollProps}
            style={[
              styles.scrollView,
              scrollViewportHeight != null && { height: scrollViewportHeight },
            ]}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator
            keyboardDismissMode="on-drag"
            nestedScrollEnabled
          >
            {/* Form Card */}
            <View style={[styles.formCard, { backgroundColor: colors.backgroundSecondary, shadowColor: colors.black }]}>
              <TaskFormBody formData={formData} onChange={handleChange} isEditing={isEditing} />
            </View>
          </ScrollView>

          {/* Pinned footer — flex sibling, not absolute overlay */}
          <View
            style={[
              styles.footer,
              {
                paddingBottom: footerBottomInset,
                backgroundColor: colors.backgroundMain,
                borderTopColor: colors.borderColor,
              },
            ]}
          >
            <GradientButton
              title={isSaving ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Task'}
              variant="blue"
              onPress={save}
              disabled={saveDisabled}
              fullWidth
              testID="schedule-task-save"
              // RNGH touchable — plain RN Pressable taps are swallowed by the
              // gesture root when this screen is a native-stack modal (see header note).
              TouchableComponent={TouchableOpacity}
            />
            {isSaving && (
              <ActivityIndicator
                size="small"
                color={colors.primary}
                style={styles.savingIndicator}
              />
            )}
          </View>
    </View>
  );

  return (
    <GestureHandlerRootView style={styles.flex}>
      <AppBackground>
        <SafeAreaView edges={safeAreaEdges} style={[styles.flex, { backgroundColor: colors.backgroundMain }]}>
          {avoidKeyboard ? (
            <KeyboardAvoidingView behavior="padding" style={styles.flex}>
              {body}
            </KeyboardAvoidingView>
          ) : (
            body
          )}
        </SafeAreaView>
      </AppBackground>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  formCard: {
    borderRadius: CornerRadius.xl,
    padding: Spacing.lg,
    marginBottom: Spacing.xl,
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 12,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  footer: {
    flexShrink: 0,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  savingIndicator: {
    marginTop: Spacing.md,
    alignSelf: 'center',
  },
});

export default ScheduleTaskScreen;
