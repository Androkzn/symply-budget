import { useFocusEffect, useNavigation, useRoute } from 'expo-router/react-navigation';
import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, Animated } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { AppBackground, ScreenFooterGlass, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { GradientButton as GradientButtonSizes, useAppColors, scaledFont } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';

import { contractorsApi } from '../../api/contractors';
import { visitChecklistsApi, ChecklistWithItems, ChecklistItemPhoto } from '../../api/visit-checklists';
import { ChecklistItemCard } from '../../components/visits/ChecklistItemCard';
import { PhotoUploadService } from '../../services/photo-upload';
import { VoiceRecordingService } from '../../services/voice-recording';
import { useHouseholdStore } from '../../stores/householdStore';

interface ActiveVisitRouteParams {
  visitId: string;
  checklistId: string;
}

export const ActiveVisitScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { visitId, checklistId } = (route.params ?? {}) as ActiveVisitRouteParams;
  const colors = useAppColors();
  const { content: containerPadding } = useLayoutPadding();
  const currentHousehold = useHouseholdStore((state) => state.currentHousehold);

  const [checklist, setChecklist] = useState<ChecklistWithItems | null>(null);
  const [photos, setPhotos] = useState<Record<string, ChecklistItemPhoto[]>>({});
  const [visit, setVisit] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [contractorRepName, setContractorRepName] = useState('');
  const [additionalNotes, setAdditionalNotes] = useState('');
  const [isCompletingVisit, setIsCompletingVisit] = useState(false);
  const [recordingItemId, setRecordingItemId] = useState<string | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [progressAnim] = useState(new Animated.Value(0));

  useEffect(() => {
    // Timer for elapsed time
    const interval = setInterval(() => {
      if (visit?.visit_mode_started_at) {
        const startTime = new Date(visit.visit_mode_started_at).getTime();
        const now = Date.now();
        setElapsedTime(Math.floor((now - startTime) / 1000));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [visit]);

  const loadData = async () => {
    if (!currentHousehold) return;

    setIsLoading(true);
    try {
      // Load checklist
      const { checklist: fetchedChecklist } = await visitChecklistsApi.getOne(
        currentHousehold.id,
        checklistId
      );
      setChecklist(fetchedChecklist);

      // Load photos for all items
      const photoPromises = fetchedChecklist.items.map(async (item) => {
        const { photos: itemPhotos } = await visitChecklistsApi.getPhotos(
          currentHousehold.id,
          checklistId,
          item.id
        );
        return { itemId: item.id, photos: itemPhotos };
      });

      const photoResults = await Promise.all(photoPromises);
      const photosMap: Record<string, ChecklistItemPhoto[]> = {};
      photoResults.forEach(({ itemId, photos: itemPhotos }) => {
        photosMap[itemId] = itemPhotos;
      });
      setPhotos(photosMap);

      // Load visit
      const { visits } = await contractorsApi.getAllVisits(currentHousehold.id);
      const currentVisit = visits.find((v: any) => v.id === visitId);
      setVisit(currentVisit);
      setContractorRepName(currentVisit?.contractor_rep_name || '');
    } catch (error) {
      console.error('Failed to load data:', error);
      Alert.alert('Error', 'Failed to load visit data. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [visitId, checklistId, currentHousehold])
  );

  useEffect(() => {
    if (checklist) {
      const completedCount = checklist.items.filter((item) => item.checked).length;
      const totalCount = checklist.items.length;
      const progress = totalCount > 0 ? completedCount / totalCount : 0;

      Animated.spring(progressAnim, {
        toValue: progress,
        useNativeDriver: false,
      }).start();
    }
  }, [checklist]);

  const handleToggleCheck = async (itemId: string, checked: boolean) => {
    if (!currentHousehold || !checklist) return;

    try {
      const { item: updatedItem } = await visitChecklistsApi.checkItem(
        currentHousehold.id,
        checklistId,
        itemId,
        checked
      );

      setChecklist((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: prev.items.map((item) => (item.id === itemId ? updatedItem : item)),
        };
      });
    } catch (error) {
      console.error('Failed to toggle check:', error);
      Alert.alert('Error', 'Failed to update checklist item.');
    }
  };

  const handleUpdateComment = async (itemId: string, comment: string) => {
    if (!currentHousehold || !checklist) return;

    try {
      const { item: updatedItem } = await visitChecklistsApi.updateItem(
        currentHousehold.id,
        checklistId,
        itemId,
        { comment }
      );

      setChecklist((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: prev.items.map((item) => (item.id === itemId ? updatedItem : item)),
        };
      });
    } catch (error) {
      console.error('Failed to update comment:', error);
      Alert.alert('Error', 'Failed to save notes.');
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    Alert.alert(
      'Delete During Visit?',
      'Are you sure you want to delete this question during the active visit?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (!currentHousehold || !checklist) return;
            try {
              await visitChecklistsApi.deleteItem(currentHousehold.id, checklistId, itemId);
              setChecklist((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  items: prev.items.filter((item) => item.id !== itemId),
                };
              });
            } catch (error) {
              console.error('Failed to delete item:', error);
              Alert.alert('Error', 'Failed to delete question.');
            }
          },
        },
      ]
    );
  };

  const handleAddPhoto = async (itemId: string) => {
    if (!currentHousehold || !checklist) return;

    try {
      const uploadResult = await PhotoUploadService.uploadChecklistItemPhoto(
        currentHousehold.id,
        checklistId,
        itemId
      );

      if (!uploadResult) return;

      // Add photo to checklist item
      const { photo } = await visitChecklistsApi.addPhoto(
        currentHousehold.id,
        checklistId,
        itemId,
        {
          photo_key: uploadResult.photo_key,
          thumbnail_key: uploadResult.thumbnail_key,
          taken_at: new Date().toISOString(),
          file_size: uploadResult.file_size,
          mime_type: uploadResult.mime_type,
          width: uploadResult.width,
          height: uploadResult.height,
        }
      );

      // Update photos state
      setPhotos((prev) => ({
        ...prev,
        [itemId]: [...(prev[itemId] || []), photo],
      }));
    } catch (error) {
      console.error('Failed to add photo:', error);
      Alert.alert('Error', 'Failed to add photo. Please try again.');
    }
  };

  const handleDeletePhoto = async (photoId: string) => {
    if (!currentHousehold) return;

    try {
      const itemId = Object.keys(photos).find((key) =>
        photos[key].some((p) => p.id === photoId)
      );
      if (!itemId) return;

      await visitChecklistsApi.deletePhoto(currentHousehold.id, checklistId, itemId, photoId);

      setPhotos((prev) => ({
        ...prev,
        [itemId]: prev[itemId].filter((p) => p.id !== photoId),
      }));
    } catch (error) {
      console.error('Failed to delete photo:', error);
      Alert.alert('Error', 'Failed to delete photo.');
    }
  };

  const handleRecordVoice = async (itemId: string) => {
    if (!currentHousehold || !checklist) return;

    try {
      if (recordingItemId === itemId) {
        // Stop recording
        const result = await VoiceRecordingService.stopRecording();
        if (!result) return;

        setRecordingItemId(null);

        // Upload voice note
        const uploadResult = await VoiceRecordingService.uploadVoiceRecording(
          currentHousehold.id,
          result.uri,
          result.duration
        );

        // Add voice note to checklist item
        const { item: updatedItem } = await visitChecklistsApi.addVoiceNote(
          currentHousehold.id,
          checklistId,
          itemId,
          uploadResult.voice_note_key
        );

        // Update checklist state
        setChecklist((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            items: prev.items.map((item) => (item.id === itemId ? updatedItem : item)),
          };
        });
      } else {
        // Start recording
        const started = await VoiceRecordingService.startRecording();
        if (started) {
          setRecordingItemId(itemId);
        }
      }
    } catch (error) {
      console.error('Failed to handle voice recording:', error);
      Alert.alert('Error', 'Failed to record voice note. Please try again.');
      setRecordingItemId(null);
    }
  };

  const handlePlayVoice = async (voiceNoteKey: string) => {
    if (!currentHousehold) return;

    try {
      // Construct voice note URL
      const voiceNoteUrl = `${process.env.EXPO_PUBLIC_API_URL}/households/${currentHousehold.id}/voice-notes/${voiceNoteKey}`;

      await VoiceRecordingService.playVoiceNote(voiceNoteUrl);
    } catch (error) {
      console.error('Failed to play voice note:', error);
      Alert.alert('Error', 'Failed to play voice note.');
    }
  };

  const handleSaveRepName = async () => {
    if (!currentHousehold || !visit) return;

    try {
      await contractorsApi.updateVisit(currentHousehold.id, visitId, {
        notes: contractorRepName ? `Rep: ${contractorRepName}` : undefined,
      });
    } catch (error) {
      console.error('Failed to save rep name:', error);
    }
  };

  const handleCompleteVisit = () => {
    if (!checklist) return;

    const completedCount = checklist.items.filter((item) => item.checked).length;
    const totalCount = checklist.items.length;
    const unansweredCount = totalCount - completedCount;

    if (unansweredCount > 0) {
      Alert.alert(
        'Incomplete Checklist',
        `You have ${unansweredCount} unanswered question${unansweredCount === 1 ? '' : 's'}. Complete the visit anyway?`,
        [
          { text: 'Continue Working', style: 'cancel' },
          { text: 'Complete Anyway', onPress: confirmCompleteVisit },
        ]
      );
    } else {
      confirmCompleteVisit();
    }
  };

  const confirmCompleteVisit = () => {
    Alert.alert(
      'Complete Visit',
      'Are you ready to complete this visit? This will save all your notes and mark the visit as complete.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Complete',
          style: 'default',
          onPress: finalizeVisit,
        },
      ]
    );
  };

  const finalizeVisit = async () => {
    if (!currentHousehold) return;

    setIsCompletingVisit(true);
    try {
      await contractorsApi.completeVisit(currentHousehold.id, visitId, {
        notes: additionalNotes,
      });

      Alert.alert(
        'Visit Complete',
        'The visit has been completed successfully!',
        [
          {
            text: 'OK',
            onPress: () => {
              navigation.reset({
                index: 0,
                routes: [{ name: 'Main' }],
              });
            },
          },
        ]
      );
    } catch (error) {
      console.error('Failed to complete visit:', error);
      Alert.alert('Error', 'Failed to complete visit. Please try again.');
    } finally {
      setIsCompletingVisit(false);
    }
  };

  const formatElapsedTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  if (isLoading) {
    return (
      <AppBackground>
        <ScreenHeader
          title="Active Visit"
          showBackButton
          onBackPress={() => navigation.goBack()}
          showNotificationBell={false}
          showAvatar={false}
        />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </AppBackground>
    );
  }

  if (!checklist || !visit) {
    return (
      <AppBackground>
        <ScreenHeader
          title="Active Visit"
          showBackButton
          onBackPress={() => navigation.goBack()}
          showNotificationBell={false}
          showAvatar={false}
        />
        <View style={styles.errorContainer}>
          <Icon name="alert-circle" size={64} color={colors.error} />
          <Typography variant="body" color={colors.error} style={styles.errorText}>
            Failed to load visit data
          </Typography>
        </View>
      </AppBackground>
    );
  }

  const completedCount = checklist.items.filter((item) => item.checked).length;
  const totalCount = checklist.items.length;

  return (
    <AppBackground>
      <ScreenHeader
        title="Active Visit"
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
      />

      {/* Active visit header */}
      <View style={[styles.activeHeader, { backgroundColor: colors.success }]}>
        <View style={styles.activeIndicator}>
          <View style={[styles.pulsingDot, { backgroundColor: colors.white }]} />
          <Typography variant="bodySmall" weight="bold" color={colors.white} style={styles.activeText}>
            VISIT IN PROGRESS
          </Typography>
        </View>
        <View style={styles.timerContainer}>
          <Icon name="clock-outline" size={16} color={colors.white} />
          <Typography variant="body" weight="semibold" color={colors.white} style={styles.timerText}>
            {formatElapsedTime(elapsedTime)}
          </Typography>
        </View>
      </View>

      {/* Contractor rep name */}
      <View style={[styles.repNameContainer, { backgroundColor: colors.card, borderBottomColor: colors.borderColor }]}>
        <Icon name="account" size={20} color={colors.textTertiary} />
        <TextInput
          style={[styles.repNameInput, { color: colors.textPrimary }]}
          value={contractorRepName}
          onChangeText={setContractorRepName}
          onBlur={handleSaveRepName}
          placeholder="Contractor representative name"
          placeholderTextColor={colors.textTertiary}
        />
      </View>

      {/* Circular progress */}
      <View style={[styles.progressCircleContainer, { backgroundColor: colors.card, borderBottomColor: colors.borderColor }]}>
        <View style={[styles.progressCircle, { backgroundColor: colors.primary, shadowColor: colors.primary }]}>
          <Typography variant="display" weight="bold" color={colors.white} style={styles.progressNumber}>
            {completedCount}
          </Typography>
          <Typography variant="bodySmall" weight="medium" color={colors.white} style={styles.progressTotal}>
            of {totalCount}
          </Typography>
        </View>
        <Typography variant="bodySmall" color={colors.textTertiary} style={styles.progressLabel}>
          Questions Completed
        </Typography>
      </View>

      {/* Checklist */}
      <ScrollView
        {...keyboardDismissScrollProps}
        style={[screenScrollViewStyle.scroll, styles.scrollView]}
        showsVerticalScrollIndicator={false}
      >
        {checklist.items.map((item) => (
          <ChecklistItemCard
            key={item.id}
            item={item}
            photos={photos[item.id] || []}
            onToggleCheck={handleToggleCheck}
            onUpdateComment={handleUpdateComment}
            onDeleteItem={handleDeleteItem}
            onAddPhoto={handleAddPhoto}
            onDeletePhoto={handleDeletePhoto}
            onRecordVoice={handleRecordVoice}
            onPlayVoice={handlePlayVoice}
            isRecording={recordingItemId === item.id}
            householdId={currentHousehold?.id || ''}
          />
        ))}

        {/* Additional notes section */}
        <View style={[styles.notesSection, { backgroundColor: colors.card, shadowColor: colors.black }]}>
          <Typography variant="body" weight="semibold" color={colors.textPrimary} style={styles.notesLabel}>
            Additional Notes
          </Typography>
          <Typography variant="caption" color={colors.textTertiary} style={styles.notesHint}>
            Any other observations or details from the visit
          </Typography>
          <TextInput
            style={[styles.notesInput, { borderColor: colors.borderColor, color: colors.textPrimary }]}
            value={additionalNotes}
            onChangeText={setAdditionalNotes}
            placeholder="Enter additional notes..."
            placeholderTextColor={colors.textTertiary}
            multiline
            numberOfLines={6}
            textAlignVertical="top"
          />
        </View>

        <View style={styles.bottomPadding} />
      </ScrollView>

      {/* Complete visit button */}
      <View style={[styles.completeVisitContainer, { paddingHorizontal: containerPadding }]}>
        <ScreenFooterGlass />
        <TouchableOpacity
          style={[styles.completeVisitButton, { backgroundColor: colors.success }, isCompletingVisit && styles.buttonDisabled]}
          onPress={handleCompleteVisit}
          disabled={isCompletingVisit}
        >
          {isCompletingVisit ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <>
              <Icon name="check-circle" size={24} color={colors.white} />
              <Typography variant="bodyLarge" weight="bold" color={colors.white} style={styles.completeVisitText}>
                Complete Visit
              </Typography>
            </>
          )}
        </TouchableOpacity>
      </View>
    </AppBackground>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  errorText: {
    marginTop: 16,
  },
  activeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  activeIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pulsingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  activeText: {
    letterSpacing: 1,
  },
  timerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  timerText: {
    fontVariant: ['tabular-nums'],
  },
  repNameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  repNameInput: {
    flex: 1,
    ...scaledFont('body'),
  },
  progressCircleContainer: {
    alignItems: 'center',
    paddingVertical: 24,
    borderBottomWidth: 1,
  },
  progressCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  progressNumber: {},
  progressTotal: {
    opacity: 0.9,
  },
  progressLabel: {
    marginTop: 12,
  },
  scrollView: {
    flex: 1,
  },
  notesSection: {
    marginHorizontal: 16,
    marginVertical: 16,
    borderRadius: 12,
    padding: 16,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  notesLabel: {
    marginBottom: 4,
  },
  notesHint: {
    marginBottom: 12,
  },
  notesInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    ...scaledFont('labelRegular'),
    minHeight: 120,
  },
  bottomPadding: {
    height: 100,
  },
  completeVisitContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: 16,
    // Tall enough that the glass fade begins well above the button, so its
    // top edge reads as transparent rather than a hard line over the content.
    paddingTop: 32,
    overflow: 'hidden',
  },
  completeVisitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: GradientButtonSizes.lg.paddingV,
    borderRadius: 12,
    gap: 10,
  },
  completeVisitText: {},
  buttonDisabled: {
    opacity: 0.5,
  },
});
