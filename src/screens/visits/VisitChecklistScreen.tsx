import { useFocusEffect, useNavigation, useRoute } from 'expo-router/react-navigation';
import React, { useState, useCallback } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, RefreshControl } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { AppBackground, ScreenFooterGlass, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { useRequireAIAccess } from '@hooks/useRequireAIAccess';
import { GradientButton as GradientButtonSizes, useAppColors, scaledFont } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';

import { contractorsApi } from '../../api/contractors';
import { visitChecklistsApi, ChecklistWithItems, ChecklistItem, ChecklistItemPhoto } from '../../api/visit-checklists';
import { AISuggestionSheet } from '../../components/visits/AISuggestionSheet';
import { ChecklistItemCard } from '../../components/visits/ChecklistItemCard';
import { PhotoUploadService } from '../../services/photo-upload';
import { VoiceRecordingService } from '../../services/voice-recording';
import { useHouseholdStore } from '../../stores/householdStore';

interface VisitChecklistRouteParams {
  checklistId: string;
  taskId?: string;
  contractorId?: string;
  visitId?: string;
}

export const VisitChecklistScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { checklistId, taskId, visitId } = (route.params ?? {}) as VisitChecklistRouteParams;
  const colors = useAppColors();
  const { content: containerPadding } = useLayoutPadding();
  const { ensureCanUseAI } = useRequireAIAccess();
  const currentHousehold = useHouseholdStore((state) => state.currentHousehold);

  const [checklist, setChecklist] = useState<ChecklistWithItems | null>(null);
  const [photos, setPhotos] = useState<Record<string, ChecklistItemPhoto[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAISuggestions, setShowAISuggestions] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<ChecklistItem[]>([]);
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [showAddQuestion, setShowAddQuestion] = useState(false);
  const [newQuestion, setNewQuestion] = useState('');
  const [isAddingQuestion, setIsAddingQuestion] = useState(false);
  const [recordingItemId, setRecordingItemId] = useState<string | null>(null);

  const loadChecklist = async (showLoader = true) => {
    if (!currentHousehold) return;

    if (showLoader) setIsLoading(true);
    try {
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
    } catch (error) {
      console.error('Failed to load checklist:', error);
      Alert.alert('Error', 'Failed to load checklist. Please try again.');
    } finally {
      if (showLoader) setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadChecklist();
    }, [checklistId, currentHousehold])
  );

  const handleRefresh = () => {
    setIsRefreshing(true);
    loadChecklist(false);
  };

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
    if (!currentHousehold || !checklist) return;

    Alert.alert('Delete Question', 'Are you sure you want to delete this question?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
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
    ]);
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

  const handleGenerateAI = async () => {
    if (!ensureCanUseAI()) return;
    if (!currentHousehold || !checklist) return;

    setIsGeneratingAI(true);
    setShowAISuggestions(true);

    try {
      const { suggestions } = await visitChecklistsApi.generateAISuggestions(
        currentHousehold.id,
        checklistId,
        {
          task_id: taskId,
          task_category: checklist.contractor_specialty || undefined,
          task_title: checklist.title,
        }
      );

      setAiSuggestions(suggestions);
    } catch (error) {
      console.error('Failed to generate AI suggestions:', error);
      Alert.alert('Error', 'Failed to generate AI suggestions. Please try again.');
      setShowAISuggestions(false);
    } finally {
      setIsGeneratingAI(false);
    }
  };

  const handleAcceptSuggestion = async (itemId: string) => {
    if (!currentHousehold) return;

    try {
      const { item: acceptedItem } = await visitChecklistsApi.acceptAISuggestion(
        currentHousehold.id,
        checklistId,
        itemId
      );

      // Move to main checklist
      setChecklist((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: [...prev.items, acceptedItem],
        };
      });

      // Update suggestions list
      setAiSuggestions((prev) =>
        prev.map((s) => (s.id === itemId ? { ...s, accepted_at: acceptedItem.accepted_at } : s))
      );
    } catch (error) {
      console.error('Failed to accept suggestion:', error);
      Alert.alert('Error', 'Failed to accept suggestion.');
    }
  };

  const handleDismissSuggestion = async (itemId: string) => {
    if (!currentHousehold) return;

    try {
      await visitChecklistsApi.dismissAISuggestion(currentHousehold.id, checklistId, itemId);

      setAiSuggestions((prev) =>
        prev.map((s) => (s.id === itemId ? { ...s, dismissed_at: new Date().toISOString() } : s))
      );
    } catch (error) {
      console.error('Failed to dismiss suggestion:', error);
      Alert.alert('Error', 'Failed to dismiss suggestion.');
    }
  };

  const handleAcceptAllSuggestions = async (itemIds: string[]) => {
    if (!currentHousehold) return;

    try {
      const acceptPromises = itemIds.map((itemId) =>
        visitChecklistsApi.acceptAISuggestion(currentHousehold.id, checklistId, itemId)
      );

      const results = await Promise.all(acceptPromises);
      const acceptedItems = results.map((r) => r.item);

      setChecklist((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: [...prev.items, ...acceptedItems],
        };
      });

      setAiSuggestions((prev) =>
        prev.map((s) => {
          const accepted = acceptedItems.find((item) => item.id === s.id);
          return accepted ? { ...s, accepted_at: accepted.accepted_at } : s;
        })
      );
    } catch (error) {
      console.error('Failed to accept all suggestions:', error);
      Alert.alert('Error', 'Failed to accept suggestions.');
    }
  };

  const handleAddManualQuestion = async () => {
    if (!currentHousehold || !checklist || !newQuestion.trim()) return;

    setIsAddingQuestion(true);
    try {
      const { item: newItem } = await visitChecklistsApi.addItem(
        currentHousehold.id,
        checklistId,
        {
          text: newQuestion.trim(),
          priority: 'nice_to_have',
        }
      );

      setChecklist((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: [...prev.items, newItem],
        };
      });

      setNewQuestion('');
      setShowAddQuestion(false);
    } catch (error) {
      console.error('Failed to add question:', error);
      Alert.alert('Error', 'Failed to add question.');
    } finally {
      setIsAddingQuestion(false);
    }
  };

  const handleStartVisit = async () => {
    if (!currentHousehold || !visitId) {
      Alert.alert('Error', 'No visit associated with this checklist.');
      return;
    }

    Alert.alert(
      'Start Visit',
      'Ready to start the on-site visit?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start',
          onPress: async () => {
            try {
              await contractorsApi.startVisitMode(currentHousehold.id, visitId);
              navigation.navigate('ActiveVisit', { visitId, checklistId });
            } catch (error) {
              console.error('Failed to start visit:', error);
              Alert.alert('Error', 'Failed to start visit.');
            }
          },
        },
      ]
    );
  };

  const screenTitle = checklist?.title ?? 'Visit Checklist';

  if (isLoading) {
    return (
      <AppBackground>
        <ScreenHeader
          title="Visit Checklist"
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

  if (!checklist) {
    return (
      <AppBackground>
        <ScreenHeader
          title="Visit Checklist"
          showBackButton
          onBackPress={() => navigation.goBack()}
          showNotificationBell={false}
          showAvatar={false}
        />
        <View style={styles.errorContainer}>
          <Icon name="alert-circle" size={64} color={colors.error} />
          <Typography variant="body" color={colors.error} style={styles.errorText}>
            Failed to load checklist
          </Typography>
        </View>
      </AppBackground>
    );
  }

  const completedCount = checklist.items.filter((item) => item.checked).length;
  const totalCount = checklist.items.length;
  const progress = totalCount > 0 ? completedCount / totalCount : 0;

  return (
    <AppBackground>
      <ScreenHeader
        title={screenTitle}
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
      />

      <Typography variant="bodySmall" color={colors.textTertiary} style={styles.headerSubtitle}>
        {completedCount} of {totalCount} questions completed
      </Typography>

      {/* Progress bar */}
      <View style={[styles.progressContainer, { backgroundColor: colors.card }]}>
        <View style={[styles.progressBar, { backgroundColor: colors.borderColor }]}>
          <View style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: colors.primary }]} />
        </View>
        <Typography variant="bodySmall" weight="semibold" color={colors.primary} style={styles.progressText}>
          {Math.round(progress * 100)}%
        </Typography>
      </View>

      {/* Action buttons */}
      <View style={styles.actionButtonsRow}>
        <TouchableOpacity
          style={[styles.actionButtonPrimary, { backgroundColor: colors.info }]}
          onPress={handleGenerateAI}
          disabled={isGeneratingAI}
        >
          <Icon name="robot" size={20} color={colors.white} />
          <Typography variant="body" weight="semibold" color={colors.white} style={styles.actionButtonPrimaryText}>
            Ask AI
          </Typography>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButtonSecondary, { backgroundColor: colors.card, borderColor: colors.primary }]}
          onPress={() => setShowAddQuestion(true)}
        >
          <Icon name="plus" size={20} color={colors.primary} />
          <Typography variant="body" weight="semibold" color={colors.primary} style={styles.actionButtonSecondaryText}>
            Add Question
          </Typography>
        </TouchableOpacity>
      </View>

      {/* Add question input */}
      {showAddQuestion && (
        <View style={[styles.addQuestionContainer, { backgroundColor: colors.card, shadowColor: colors.black }]}>
          <TextInput
            style={[styles.addQuestionInput, { color: colors.textPrimary, borderColor: colors.borderColor }]}
            value={newQuestion}
            onChangeText={setNewQuestion}
            placeholder="Enter your question..."
            placeholderTextColor={colors.textTertiary}
            multiline
            autoFocus
          />
          <View style={styles.addQuestionActions}>
            <TouchableOpacity
              style={[styles.addQuestionCancel, { backgroundColor: colors.backgroundSecondary }]}
              onPress={() => {
                setShowAddQuestion(false);
                setNewQuestion('');
              }}
            >
              <Typography variant="labelRegular" weight="semibold" color={colors.textTertiary} style={styles.addQuestionCancelText}>
                Cancel
              </Typography>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.addQuestionSave, { backgroundColor: colors.primary }, !newQuestion.trim() && styles.buttonDisabled]}
              onPress={handleAddManualQuestion}
              disabled={!newQuestion.trim() || isAddingQuestion}
            >
              {isAddingQuestion ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <Typography variant="labelRegular" weight="semibold" color={colors.white} style={styles.addQuestionSaveText}>
                  Add
                </Typography>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Checklist items */}
      <ScrollView
        {...keyboardDismissScrollProps}
        style={[screenScrollViewStyle.scroll, styles.scrollView]}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
      >
        {checklist.items.length === 0 ? (
          <View style={styles.emptyState}>
            <Icon name="clipboard-list-outline" size={64} color={colors.textTertiary} />
            <Typography variant="bodyLarge" weight="semibold" color={colors.textPrimary} style={styles.emptyTitle}>
              No Questions Yet
            </Typography>
            <Typography variant="bodySmall" color={colors.textTertiary} style={styles.emptyText}>
              Add questions manually or use AI to generate suggestions.
            </Typography>
          </View>
        ) : (
          checklist.items.map((item) => (
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
          ))
        )}

        <View style={styles.bottomPadding} />
      </ScrollView>

      {/* Start visit button */}
      {visitId && (
        <View style={[styles.startVisitContainer, { paddingHorizontal: containerPadding }]}>
          <ScreenFooterGlass />
          <TouchableOpacity style={[styles.startVisitButton, { backgroundColor: colors.primary }]} onPress={handleStartVisit}>
            <Icon name="play-circle" size={24} color={colors.white} />
            <Typography variant="bodyLarge" weight="bold" color={colors.white} style={styles.startVisitText}>
              Start On-Site Visit
            </Typography>
          </TouchableOpacity>
        </View>
      )}

      {/* AI Suggestions Sheet */}
      <AISuggestionSheet
        visible={showAISuggestions}
        onClose={() => setShowAISuggestions(false)}
        suggestions={aiSuggestions}
        isGenerating={isGeneratingAI}
        onAcceptSuggestion={handleAcceptSuggestion}
        onDismissSuggestion={handleDismissSuggestion}
        onAcceptAll={handleAcceptAllSuggestions}
      />
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
  headerSubtitle: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  progressBar: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  progressText: {
    minWidth: 45,
    textAlign: 'right',
  },
  actionButtonsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  actionButtonPrimary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 10,
    gap: 8,
  },
  actionButtonPrimaryText: {},
  actionButtonSecondary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    paddingVertical: 14,
    borderRadius: 10,
    gap: 8,
  },
  actionButtonSecondaryText: {},
  addQuestionContainer: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 12,
    padding: 16,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  addQuestionInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    ...scaledFont('labelRegular'),
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: 12,
  },
  addQuestionActions: {
    flexDirection: 'row',
    gap: 12,
  },
  addQuestionCancel: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  addQuestionCancelText: {},
  addQuestionSave: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  addQuestionSaveText: {},
  buttonDisabled: {
    opacity: 0.5,
  },
  scrollView: {
    flex: 1,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    marginTop: 16,
  },
  emptyText: {
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  bottomPadding: {
    height: 120,
  },
  startVisitContainer: {
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
  startVisitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: GradientButtonSizes.lg.paddingV,
    borderRadius: 12,
    gap: 10,
  },
  startVisitText: {},
});
