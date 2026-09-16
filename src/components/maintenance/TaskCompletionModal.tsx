import React, { useState } from 'react';
import {
  View,
  Modal,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Image,
  ScrollView,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Concrete path, not the @components/common barrel: that barrel re-exports
// screens' headers which import from @components/ui, so reaching SheetHeader
// through it closes a ui <-> common circular require and the component
// arrives undefined at render (see the same note in ui/BottomSheet).
import { SheetHeader } from '@components/common/SheetHeader';
import { ScanImportSources } from '@components/common/ScanImportSources';
import { useAttachmentSources } from '@components/common/useAttachmentSources';
import { Typography, Button, Card } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { useDeviceType } from '@hooks/useDeviceType';
import { useKeyboardInset } from '@hooks/useKeyboardInset';
import { IconSize, Layout, Spacing, useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';

/** How many completion photos one trip may add. */
const MAX_COMPLETION_PHOTOS = 10;

interface TaskCompletionModalProps {
  visible: boolean;
  taskTitle: string;
  onClose: () => void;
  onComplete: (data: { notes: string; photos: string[] }) => Promise<void>;
}

export function TaskCompletionModal({
  visible,
  taskTitle,
  onClose,
  onComplete,
}: TaskCompletionModalProps) {  const colors = useAppColors();
  const { isIPad, width, height: windowHeight } = useDeviceType();
  const useCenteredSheet = isIPad && width >= Layout.sidebarBreakpoint;
  const insets = useSafeAreaInsets();
  // The card is anchored to the bottom edge, so the keypad raised by the Notes
  // field lands on top of it — `keyboardDismissScrollProps` scrolls the field
  // within the scroller, but only lifting the card itself clears the Complete
  // button. Cap the height too so a short phone doesn't lose the header.
  const keyboardInset = useKeyboardInset();
  const contentMaxHeight = windowHeight - keyboardInset - insets.top - Spacing.xxl;
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  /**
   * Completion photos, from any of the four sources.
   *
   * This modal offered Take Photo and Choose Photo. Both are still here — they
   * are the first two tiles — but a member whose "before" shot arrived from the
   * contractor by email, or lives in the household's Drive folder, can now
   * attach it without first saving it to the camera roll.
   */
  const { sourceHandlers, drivePicker, driveOpen } = useAttachmentSources({
    rememberScope: 'task-completion',
    limit: MAX_COMPLETION_PHOTOS,
    pickerOptions: { cropping: true, mediaType: 'photo' },
    onPicked: picked =>
      setPhotos(prev => [...prev, ...picked.map(item => item.uri)]),
  });

  const removePhoto = (index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const handleComplete = async () => {
    setIsSubmitting(true);
    try {
      await onComplete({ notes, photos });
      // Reset state
      setNotes('');
      setPhotos([]);
      onClose();
    } catch {
      Alert.alert('Error', 'Failed to complete task. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setNotes('');
    setPhotos([]);
    onClose();
  };

  return (
    <>
    <Modal
      // Stand aside while the Drive browse is up: it is its own full-screen
      // Modal, and two stacked modals on iOS leave the inner one undismissable.
      visible={visible && !driveOpen}
      animationType="slide"
      transparent={true}
      onRequestClose={handleClose}
    >
      <View
        style={[
          styles.overlay,
          useCenteredSheet && styles.overlayCentered,
          keyboardInset > 0 && { paddingBottom: keyboardInset },
        ]}
      >
        <Card
          variant="filled"
          style={[
            styles.modal,
            useCenteredSheet && styles.modalCentered,
            { backgroundColor: colors.backgroundMain },
            keyboardInset > 0 && { maxHeight: contentMaxHeight },
          ]}
        >
          {/* Header */}
          {/* The app's one sheet header — glass ✕ on the left, centred title. */}
          <SheetHeader
            title="Complete Task"
            leftVariant="close"
            onLeftPress={handleClose}
            leftTestID="task-completion-close"
            leftAccessibilityLabel="Close"
          />

          <Typography
            variant="body"
            color={colors.textSecondary}
            style={styles.taskTitle}
          >
            {taskTitle}
          </Typography>

          <ScrollView {...keyboardDismissScrollProps} style={styles.content} showsVerticalScrollIndicator={false}>
            {/* Notes Input */}
            <View style={styles.section}>
              <Typography variant="subheadline" weight="medium" style={styles.label}>
                Notes (optional)
              </Typography>
              <TextInput
                style={[
                  styles.notesInput,
                  {
                    backgroundColor: colors.backgroundSecondary,
                    color: colors.textPrimary,
                    borderColor: colors.borderColor,
                  },
                ]}
                placeholder="Add any notes about this task..."
                placeholderTextColor={colors.textTertiary}
                value={notes}
                onChangeText={setNotes}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
            </View>

            {/* Photos Section */}
            <View style={styles.section}>
              <Typography variant="subheadline" weight="medium" style={styles.label}>
                Photos (optional)
              </Typography>

              {/* Photo Grid */}
              {photos.length > 0 && (
                <View style={styles.photoGrid}>
                  {photos.map((uri, index) => (
                    <View key={index} style={styles.photoContainer}>
                      <Image source={{ uri }} style={styles.photo} />
                      <TouchableOpacity
                        style={[
                          styles.removePhotoButton,
                          { backgroundColor: colors.error },
                        ]}
                        onPress={() => removePhoto(index)}
                      >
                        <Icon name="close" size={IconSize.sm} color={colors.white} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}

              {/* Camera · Gallery · File · Drive — the one shared list. */}
              <ScanImportSources
                testIDPrefix="task-completion-photo"
                {...sourceHandlers}
              />
            </View>
          </ScrollView>

          {/* Action Buttons */}
          <View style={styles.actions}>
            <View style={styles.actionButton}>
              <Button
                title="Cancel"
                variant="secondary"
                size="md"
                onPress={handleClose}
                fullWidth
              />
            </View>
            <View style={styles.actionButton}>
              <Button
                title="Complete Task"
                variant="primary"
                size="md"
                onPress={handleComplete}
                loading={isSubmitting}
                fullWidth
              />
            </View>
          </View>
        </Card>
      </View>
    </Modal>
    {/* Sibling, not child: it has to outlive the Modal being hidden above. */}
    {drivePicker}
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  overlayCentered: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
  },
  modal: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '85%',
  },
  modalCentered: {
    width: '100%',
    maxWidth: Layout.formSheetWidth,
    borderRadius: 28,
    maxHeight: '82%',
  },
  taskTitle: {
    marginBottom: 20,
  },
  content: {
    marginBottom: 20,
  },
  section: {
    marginBottom: 20,
  },
  label: {
    marginBottom: 8,
  },
  notesInput: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    minHeight: 100,
    fontSize: 16,
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  photoContainer: {
    position: 'relative',
  },
  photo: {
    width: 80,
    height: 80,
    borderRadius: 8,
  },
  removePhotoButton: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flex: 1,
  },
});

export default TaskCompletionModal;
