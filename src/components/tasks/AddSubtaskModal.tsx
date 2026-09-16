import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Modal, ScrollView, TextInput, TouchableOpacity, Platform, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { tasksApi, type MaintenanceSubtask } from '@api/tasks';
// Concrete path, not the @components/common barrel: that barrel re-exports
// screens' headers which import from @components/ui, so reaching SheetHeader
// through it closes a ui <-> common circular require and the component
// arrives undefined at render (see the same note in ui/BottomSheet).
import { SheetHeader } from '@components/common/SheetHeader';
import { Typography, Button } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useKeyboardInset } from '@hooks/useKeyboardInset';
import { showToast } from '@services/toastManager';
import { useTaskStore } from '@stores/taskStore';
import { IconSize, useAppColors } from '@theme';
import { numericTextHandler } from '@utils/keyboard';

interface AddSubtaskModalProps {
  visible: boolean;
  taskId: string;
  householdId: string;
  editingSubtask?: MaintenanceSubtask | null;
  onClose: () => void;
  onSave: () => void;
}

export function AddSubtaskModal({
  visible,
  taskId,
  householdId,
  editingSubtask,
  onClose,
  onSave,
}: AddSubtaskModalProps) {  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  // The sheet is anchored to the bottom edge of a `Modal`, so an open keyboard
  // sits on top of it. A `KeyboardAvoidingView` used to wrap this — it only
  // SHRANK the viewport and never moved the content, so the Save/Cancel row and
  // the reminder fields stayed behind the keypad. Measure the inset instead:
  // lift the sheet clear of the keyboard and cap its height by the same amount.
  const keyboardInset = useKeyboardInset();
  const contentMaxHeight = windowHeight - keyboardInset - insets.top - 48;
  const addSubtask = useTaskStore((state) => state.addSubtask);
  const updateSubtask = useTaskStore((state) => state.updateSubtask);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [showReminderSettings, setShowReminderSettings] = useState(false);
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderDaysBefore, setReminderDaysBefore] = useState('1');
  const [reminderTime, setReminderTime] = useState('09:00');
  const [isSaving, setIsSaving] = useState(false);

  // Populate form when editing
  useEffect(() => {
    if (editingSubtask) {
      setTitle(editingSubtask.title);
      setDescription(editingSubtask.description || '');
      setReminderEnabled(editingSubtask.reminder_enabled);
      setReminderDaysBefore(editingSubtask.reminder_days_before.toString());
      setReminderTime(editingSubtask.reminder_time);
      setShowReminderSettings(editingSubtask.reminder_enabled);
    } else {
      // Reset form for new subtask
      setTitle('');
      setDescription('');
      setReminderEnabled(false);
      setReminderDaysBefore('1');
      setReminderTime('09:00');
      setShowReminderSettings(false);
    }
  }, [editingSubtask, visible]);

  const handleSave = async () => {
    // Validate
    if (!title.trim()) {
      showToast('error', 'Please enter a subtask title');
      return;
    }

    try {
      setIsSaving(true);

      const data = {
        title: title.trim(),
        description: description.trim() || undefined,
        reminder_enabled: reminderEnabled,
        reminder_days_before: reminderEnabled ? parseInt(reminderDaysBefore, 10) : undefined,
        reminder_time: reminderEnabled ? reminderTime : undefined,
      };

      if (editingSubtask) {
        // Update existing subtask
        const updatedSubtask = await tasksApi.updateSubtask(
          householdId,
          taskId,
          editingSubtask.id,
          data
        );

        // Update store with the updated subtask
        updateSubtask(taskId, editingSubtask.id, updatedSubtask);

        showToast('success', 'Subtask updated');
      } else {
        // Create new subtask
        const newSubtask = await tasksApi.createSubtask(householdId, taskId, data);

        // Add to store
        addSubtask(taskId, newSubtask);

        showToast('success', 'Subtask added');
      }

      onSave();
    } catch (error) {
      console.error('[AddSubtaskModal] Save failed:', error);
      const message = editingSubtask ? 'Failed to update subtask' : 'Failed to add subtask';
      showToast('error', message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    /*
      `testID` goes on the CONTENT view below, not on `Modal`.

      An RN `<Modal>` is a native presentation, and a testID set on it does not
      reach Maestro's iOS accessibility tree — the hierarchy captured while this
      modal was open contained `add-subtask-title`, `add-subtask-save` and
      `add-subtask-cancel` but no `add-subtask-modal`, so `tasks-gaps` failed
      asserting a modal that was plainly on screen. The id had never worked; no
      other flow referenced it, so nothing caught it.
    */
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={[styles.modalContainer, keyboardInset > 0 && { paddingBottom: keyboardInset }]}>
        <TouchableOpacity
          style={[styles.backdrop, { backgroundColor: colors.modalBackdrop }]}
          activeOpacity={1}
          onPress={onClose}
        />

        <View
          testID="add-subtask-modal"
          style={[
            styles.modalContent,
            { backgroundColor: colors.backgroundMain },
            keyboardInset > 0 && { maxHeight: contentMaxHeight },
          ]}
        >
          {/* Header */}
          {/* The app's one sheet header — glass ✕ on the left, centred title,
              hairline rule under it. */}
          <SheetHeader
            title={editingSubtask ? 'Edit Subtask' : 'Add Subtask'}
            leftVariant="close"
            onLeftPress={onClose}
            leftTestID="add-subtask-close"
            leftAccessibilityLabel="Close"
            showDivider
          />

          {/* Form */}
          {/* No `automaticallyAdjustKeyboardInsets` here, and that is deliberate: the
              sheet is ALREADY lifted clear of the keypad by `keyboardInset` on the
              backdrop above. Letting the scroller offset by the keyboard height as
              well counts it twice and drives the focused field's own label off the
              top of the card. Verified on a device via ProjectionTargetModal. */}
          <ScrollView
            keyboardShouldPersistTaps="handled"
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Title */}
            <View style={styles.field}>
              <Typography
                variant="subheadline"
                color={colors.textSecondary}
                style={styles.label}
              >
                Title *
              </Typography>
              <TextInput
                style={[
                  styles.input,
                  {
                    color: colors.textPrimary,
                    backgroundColor: colors.backgroundSecondary,
                    borderColor: colors.borderColor,
                  },
                ]}
                value={title}
                onChangeText={setTitle}
                placeholder="e.g., Replace air filter"
                placeholderTextColor={colors.textTertiary}
                editable={!isSaving}
                autoFocus
                testID="add-subtask-title"
              />
            </View>

            {/* Description */}
            <View style={styles.field}>
              <Typography
                variant="subheadline"
                color={colors.textSecondary}
                style={styles.label}
              >
                Description (Optional)
              </Typography>
              <TextInput
                style={[
                  styles.input,
                  styles.textArea,
                  {
                    color: colors.textPrimary,
                    backgroundColor: colors.backgroundSecondary,
                    borderColor: colors.borderColor,
                  },
                ]}
                value={description}
                onChangeText={setDescription}
                placeholder="Add any notes or instructions..."
                placeholderTextColor={colors.textTertiary}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
                editable={!isSaving}
              />
            </View>

            {/* Reminder Settings Toggle */}
            <TouchableOpacity
              style={styles.reminderToggle}
              onPress={() => setShowReminderSettings(!showReminderSettings)}
              disabled={isSaving}
            >
              <Icon
                name={showReminderSettings ? 'chevron-down' : 'chevron-forward'}
                size={IconSize.sm}
                color={colors.textPrimary}
              />
              <Typography variant="body" color={colors.textPrimary}>
                Reminder Settings
              </Typography>
            </TouchableOpacity>

            {/* Reminder Settings (collapsed by default) */}
            {showReminderSettings && (
              <View style={styles.reminderSection}>
                {/* Enable Reminder */}
                <TouchableOpacity
                  style={styles.checkboxRow}
                  onPress={() => setReminderEnabled(!reminderEnabled)}
                  disabled={isSaving}
                >
                  <View
                    style={[
                      styles.checkbox,
                      {
                        borderColor: colors.primary,
                        backgroundColor: reminderEnabled
                          ? colors.primary
                          : 'transparent',
                      },
                    ]}
                  >
                    {reminderEnabled && (
                      <Icon name="checkmark" size={IconSize.sm} color={colors.backgroundSecondary} />
                    )}
                  </View>
                  <Typography variant="body" color={colors.textPrimary}>
                    Enable reminder for this subtask
                  </Typography>
                </TouchableOpacity>

                {reminderEnabled && (
                  <>
                    {/* Days Before */}
                    <View style={styles.field}>
                      <Typography
                        variant="subheadline"
                        color={colors.textSecondary}
                        style={styles.label}
                      >
                        Days Before
                      </Typography>
                      <TextInput
                        style={[
                          styles.input,
                          styles.smallInput,
                          {
                            color: colors.textPrimary,
                            backgroundColor: colors.backgroundSecondary,
                            borderColor: colors.borderColor,
                          },
                        ]}
                        value={reminderDaysBefore}
                        onChangeText={numericTextHandler(setReminderDaysBefore)}
                        keyboardType="number-pad"
                        editable={!isSaving}
                      />
                    </View>

                    {/* Time */}
                    <View style={styles.field}>
                      <Typography
                        variant="subheadline"
                        color={colors.textSecondary}
                        style={styles.label}
                      >
                        Time (HH:MM)
                      </Typography>
                      <TextInput
                        style={[
                          styles.input,
                          styles.smallInput,
                          {
                            color: colors.textPrimary,
                            backgroundColor: colors.backgroundSecondary,
                            borderColor: colors.borderColor,
                          },
                        ]}
                        value={reminderTime}
                        onChangeText={setReminderTime}
                        placeholder="09:00"
                        placeholderTextColor={colors.textTertiary}
                        editable={!isSaving}
                      />
                    </View>
                  </>
                )}
              </View>
            )}
          </ScrollView>

          {/* Buttons */}
          <View style={[styles.buttons, { borderTopColor: colors.divider }]}>
            <Button
              title="Cancel"
              variant="secondary"
              size="md"
              onPress={onClose}
              disabled={isSaving}
              style={styles.button}
              testID="add-subtask-cancel"
            />
            <Button
              title={isSaving ? 'Saving...' : editingSubtask ? 'Update' : 'Add Subtask'}
              variant="primary"
              size="md"
              onPress={handleSave}
              disabled={isSaving}
              style={styles.button}
              testID="add-subtask-save"
            />
          </View>

          {isSaving && (
            <View style={[styles.loadingOverlay, { backgroundColor: colors.backgroundMain + 'CC' }]}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  modalContent: {
    height: '85%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 20,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  field: {
    marginBottom: 20,
  },
  label: {
    marginBottom: 8,
  },
  input: {
    fontSize: 17,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
  },
  textArea: {
    minHeight: 80,
    paddingTop: 12,
  },
  smallInput: {
    width: 120,
  },
  reminderToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
    marginBottom: 12,
  },
  reminderSection: {
    paddingLeft: 16,
    gap: 16,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttons: {
    flexDirection: 'row',
    padding: 20,
    gap: 12,
    borderTopWidth: 1,
  },
  button: {
    flex: 1,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
