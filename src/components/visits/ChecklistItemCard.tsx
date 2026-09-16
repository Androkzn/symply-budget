import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Image, ScrollView, Animated } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon as BrandIcon } from '@components/ui/Icon';
import { useAppColors, type AppColors } from '@theme';

import { ChecklistItem, ChecklistItemPhoto } from '../../api/visit-checklists';

interface ChecklistItemCardProps {
  item: ChecklistItem;
  photos: ChecklistItemPhoto[];
  onToggleCheck: (itemId: string, checked: boolean) => Promise<void>;
  onUpdateComment: (itemId: string, comment: string) => Promise<void>;
  onDeleteItem: (itemId: string) => Promise<void>;
  onAddPhoto: (itemId: string) => Promise<void>;
  onDeletePhoto: (photoId: string) => Promise<void>;
  onRecordVoice: (itemId: string) => Promise<void>;
  onPlayVoice: (voiceNoteKey: string) => void;
  isRecording?: boolean;
  householdId: string;
}

type Priority = ChecklistItem['priority'];

const getPriorityConfig = (colors: AppColors, priority: Priority) => {
  switch (priority) {
    case 'must_ask':
      return { label: 'Must Ask', color: colors.error, bgColor: colors.error + '1A' };
    case 'nice_to_have':
      return { label: 'Nice to Have', color: colors.warning, bgColor: colors.warning + '1A' };
    default:
      return { label: 'Optional', color: colors.textSecondary, bgColor: colors.pillBackground };
  }
};

export const ChecklistItemCard: React.FC<ChecklistItemCardProps> = ({
  item,
  photos,
  onToggleCheck,
  onUpdateComment,
  onDeleteItem,
  onAddPhoto,
  onDeletePhoto,
  onRecordVoice,
  onPlayVoice,
  isRecording = false,
  householdId: _householdId,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [comment, setComment] = useState(item.comment || '');
  const [isUpdatingComment, setIsUpdatingComment] = useState(false);
  const [isCheckingItem, setIsCheckingItem] = useState(false);
  const [scaleAnim] = useState(new Animated.Value(1));

  const colors = useAppColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const priorityConfig = getPriorityConfig(colors, item.priority);

  const handleCheckToggle = async () => {
    if (isCheckingItem) return;

    setIsCheckingItem(true);

    // Spring animation on checkbox press
    Animated.sequence([
      Animated.spring(scaleAnim, {
        toValue: 0.9,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        useNativeDriver: true,
      }),
    ]).start();

    try {
      await onToggleCheck(item.id, !item.checked);
    } finally {
      setIsCheckingItem(false);
    }
  };

  const handleCommentBlur = async () => {
    if (comment === item.comment) return;

    setIsUpdatingComment(true);
    try {
      await onUpdateComment(item.id, comment);
    } finally {
      setIsUpdatingComment(false);
    }
  };

  const renderRightActions = () => {
    return (
      <TouchableOpacity
        style={styles.deleteAction}
        onPress={() => onDeleteItem(item.id)}
      >
        <Icon name="delete" size={24} color={colors.white} />
        <Text style={styles.deleteActionText}>Delete</Text>
      </TouchableOpacity>
    );
  };

  const renderPhotoGallery = () => {
    if (photos.length === 0) return null;

    // No `automaticallyAdjustKeyboardInsets` (i.e. not `keyboardDismissScrollProps`):
    // horizontal photo strip with no fields in it. The card's comment box is laid
    // out by the parent screen's scroll container, which carries the inset.
    return (
      <ScrollView keyboardShouldPersistTaps="handled" horizontal showsHorizontalScrollIndicator={false} style={styles.photoGallery}>
        {photos.map((photo) => (
          <View key={photo.id} style={styles.photoContainer}>
            <Image
              source={{ uri: photo.thumbnail_key || photo.photo_key }}
              style={styles.photoThumbnail}
            />
            <TouchableOpacity
              style={styles.photoDeleteBtn}
              onPress={() => onDeletePhoto(photo.id)}
            >
              <Icon name="close-circle" size={20} color={colors.error} />
            </TouchableOpacity>
            {photo.caption && (
              <Text style={styles.photoCaption} numberOfLines={1}>
                {photo.caption}
              </Text>
            )}
          </View>
        ))}
      </ScrollView>
    );
  };

  return (
    <Swipeable renderRightActions={renderRightActions}>
      <Animated.View style={[styles.card, { transform: [{ scale: scaleAnim }] }]}>
        {/* Header with checkbox and question */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={handleCheckToggle}
            style={styles.checkboxContainer}
            disabled={isCheckingItem}
          >
            <View style={[styles.checkbox, item.checked && styles.checkboxChecked]}>
              {isCheckingItem ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : item.checked ? (
                <Icon name="check" size={18} color={colors.white} />
              ) : null}
            </View>
          </TouchableOpacity>

          <View style={styles.questionContainer}>
            <View style={styles.badgeRow}>
              <View style={[styles.priorityBadge, { backgroundColor: priorityConfig.bgColor }]}>
                <Text style={[styles.priorityText, { color: priorityConfig.color }]}>
                  {priorityConfig.label}
                </Text>
              </View>

              {item.source === 'ai_suggested' && !item.accepted_at && (
                <View style={styles.aiBadge}>
                  <Icon name="robot" size={12} color={colors.purple} />
                  <Text style={styles.aiText}>AI</Text>
                </View>
              )}

              {item.category && (
                <View style={styles.categoryBadge}>
                  <Text style={styles.categoryText}>{item.category}</Text>
                </View>
              )}
            </View>

            <Text style={[styles.questionText, item.checked && styles.questionTextChecked]}>
              {item.text}
            </Text>

            {item.technical_term && (
              <TouchableOpacity style={styles.infoButton}>
                <BrandIcon name="information-circle-outline" size={16} color={colors.primary} />
                <Text style={styles.infoText}>{item.technical_term}</Text>
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity
            onPress={() => setIsExpanded(!isExpanded)}
            style={styles.expandButton}
          >
            <Icon
              name={isExpanded ? 'chevron-up' : 'chevron-down'}
              size={24}
              color={colors.textSecondary}
            />
          </TouchableOpacity>
        </View>

        {/* Expanded content */}
        {isExpanded && (
          <View style={styles.expandedContent}>
            {/* Comment/Notes input */}
            <View style={styles.commentSection}>
              <Text style={styles.sectionLabel}>Notes</Text>
              <TextInput
                style={styles.commentInput}
                value={comment}
                onChangeText={setComment}
                onBlur={handleCommentBlur}
                placeholder="Add notes or contractor's response..."
                placeholderTextColor={colors.textTertiary}
                multiline
                maxLength={1000}
              />
              {isUpdatingComment && (
                <ActivityIndicator
                  size="small"
                  color={colors.primary}
                  style={styles.commentLoader}
                />
              )}
            </View>

            {/* Voice note section */}
            <View style={styles.voiceSection}>
              <Text style={styles.sectionLabel}>Voice Note</Text>
              <View style={styles.voiceControls}>
                {item.voice_note_key ? (
                  <>
                    <TouchableOpacity
                      style={styles.voiceButton}
                      onPress={() => onPlayVoice(item.voice_note_key!)}
                    >
                      <Icon name="play-circle" size={24} color={colors.primary} />
                      <Text style={styles.voiceButtonText}>Play Recording</Text>
                    </TouchableOpacity>
                    {item.voice_note_transcription && (
                      <View style={styles.transcriptionBox}>
                        <Icon name="text" size={14} color={colors.textSecondary} />
                        <Text style={styles.transcriptionText}>
                          {item.voice_note_transcription}
                        </Text>
                      </View>
                    )}
                  </>
                ) : (
                  <TouchableOpacity
                    style={[styles.voiceButton, isRecording && styles.voiceButtonRecording]}
                    onPress={() => onRecordVoice(item.id)}
                    disabled={isRecording}
                  >
                    <Icon
                      name={isRecording ? 'stop-circle' : 'microphone'}
                      size={24}
                      color={isRecording ? colors.error : colors.primary}
                    />
                    <Text style={styles.voiceButtonText}>
                      {isRecording ? 'Recording...' : 'Record Voice Note'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* Photo gallery */}
            {photos.length > 0 && (
              <View style={styles.photoSection}>
                <Text style={styles.sectionLabel}>Photos ({photos.length})</Text>
                {renderPhotoGallery()}
              </View>
            )}

            {/* Action buttons */}
            <View style={styles.actionButtons}>
              <TouchableOpacity style={styles.actionButton} onPress={() => onAddPhoto(item.id)}>
                <Icon name="camera" size={20} color={colors.primary} />
                <Text style={styles.actionButtonText}>Add Photo</Text>
              </TouchableOpacity>
            </View>

            {/* Metadata */}
            {(item.checked_at || item.suggested_at) && (
              <View style={styles.metadata}>
                {item.checked_at && (
                  <Text style={styles.metadataText}>
                    Completed: {new Date(item.checked_at).toLocaleString()}
                  </Text>
                )}
                {item.suggested_at && item.ai_confidence && (
                  <Text style={styles.metadataText}>
                    AI Confidence: {Math.round(item.ai_confidence * 100)}%
                  </Text>
                )}
              </View>
            )}
          </View>
        )}
      </Animated.View>
    </Swipeable>
  );
};

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
  card: {
    backgroundColor: colors.cardBackground,
    marginHorizontal: 16,
    marginVertical: 6,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 16,
  },
  checkboxContainer: {
    marginRight: 12,
    marginTop: 4,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.borderColor,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  questionContainer: {
    flex: 1,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    flexWrap: 'wrap',
  },
  priorityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginRight: 6,
    marginBottom: 4,
  },
  priorityText: {
    fontSize: 11,
    fontWeight: '600',
  },
  aiBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: colors.purple + '14',
    marginRight: 6,
    marginBottom: 4,
  },
  aiText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.purple,
    marginLeft: 4,
  },
  categoryBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: colors.pillBackground,
    marginBottom: 4,
  },
  categoryText: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.textSecondary,
    textTransform: 'capitalize',
  },
  questionText: {
    fontSize: 16,
    color: colors.textPrimary,
    lineHeight: 22,
  },
  questionTextChecked: {
    textDecorationLine: 'line-through',
    color: colors.textSecondary,
  },
  infoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  infoText: {
    fontSize: 13,
    color: colors.primary,
    marginLeft: 4,
    fontWeight: '500',
  },
  expandButton: {
    padding: 4,
    marginLeft: 8,
  },
  expandedContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 8,
    marginTop: 12,
  },
  commentSection: {
    position: 'relative',
  },
  commentInput: {
    borderWidth: 1,
    borderColor: colors.borderColor,
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    color: colors.textPrimary,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  commentLoader: {
    position: 'absolute',
    right: 12,
    top: 44,
  },
  voiceSection: {
    marginTop: 4,
  },
  voiceControls: {
    gap: 8,
  },
  voiceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 8,
    gap: 8,
  },
  voiceButtonRecording: {
    borderColor: colors.error,
    backgroundColor: colors.error + '1A',
  },
  voiceButtonText: {
    fontSize: 15,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  transcriptionBox: {
    flexDirection: 'row',
    backgroundColor: colors.pillBackground,
    padding: 12,
    borderRadius: 8,
    gap: 8,
  },
  transcriptionText: {
    flex: 1,
    fontSize: 14,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  photoSection: {
    marginTop: 4,
  },
  photoGallery: {
    marginTop: 8,
  },
  photoContainer: {
    marginRight: 12,
    position: 'relative',
  },
  photoThumbnail: {
    width: 100,
    height: 100,
    borderRadius: 8,
  },
  photoDeleteBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: colors.cardBackground,
    borderRadius: 10,
  },
  photoCaption: {
    marginTop: 4,
    fontSize: 12,
    color: colors.textSecondary,
    width: 100,
  },
  actionButtons: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 12,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: colors.pillBackground,
    gap: 6,
  },
  actionButtonText: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '500',
  },
  metadata: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  metadataText: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  deleteAction: {
    backgroundColor: colors.error,
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    marginVertical: 6,
    marginRight: 16,
    borderRadius: 12,
  },
  deleteActionText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  });
