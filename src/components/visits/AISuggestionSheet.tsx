import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { useAppColors, type AppColors } from '@theme';

import { ChecklistItem } from '../../api/visit-checklists';
import { BottomSheet } from '../ui/BottomSheet';

interface AISuggestionSheetProps {
  visible: boolean;
  onClose: () => void;
  suggestions: ChecklistItem[];
  isGenerating: boolean;
  onAcceptSuggestion: (itemId: string) => Promise<void>;
  onDismissSuggestion: (itemId: string) => Promise<void>;
  onAcceptAll: (itemIds: string[]) => Promise<void>;
}

type Priority = ChecklistItem['priority'];

const getPriorityConfig = (colors: AppColors, priority: Priority) => {
  switch (priority) {
    case 'must_ask':
      return {
        label: 'Must Ask',
        color: colors.error,
        bgColor: colors.error + '1A',
        icon: 'alert-circle',
      };
    case 'nice_to_have':
      return {
        label: 'Nice to Have',
        color: colors.warning,
        bgColor: colors.warning + '1A',
        icon: 'star',
      };
    default:
      return {
        label: 'Optional',
        color: colors.textSecondary,
        bgColor: colors.pillBackground,
        icon: 'information',
      };
  }
};

export const AISuggestionSheet: React.FC<AISuggestionSheetProps> = ({
  visible,
  onClose,
  suggestions,
  isGenerating,
  onAcceptSuggestion,
  onDismissSuggestion,
  onAcceptAll,
}) => {
  const [acceptingIds, setAcceptingIds] = useState<Set<string>>(new Set());
  const [dismissingIds, setDismissingIds] = useState<Set<string>>(new Set());
  const [acceptingAll, setAcceptingAll] = useState(false);

  const colors = useAppColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const handleAccept = async (itemId: string) => {
    setAcceptingIds((prev) => new Set(prev).add(itemId));
    try {
      await onAcceptSuggestion(itemId);
    } finally {
      setAcceptingIds((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    }
  };

  const handleDismiss = async (itemId: string) => {
    setDismissingIds((prev) => new Set(prev).add(itemId));
    try {
      await onDismissSuggestion(itemId);
    } finally {
      setDismissingIds((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    }
  };

  const handleAcceptAll = async () => {
    setAcceptingAll(true);
    try {
      const itemIds = suggestions
        .filter((s) => !s.accepted_at && !s.dismissed_at)
        .map((s) => s.id);
      await onAcceptAll(itemIds);
      onClose();
    } finally {
      setAcceptingAll(false);
    }
  };

  const pendingSuggestions = suggestions.filter((s) => !s.accepted_at && !s.dismissed_at);
  const acceptedSuggestions = suggestions.filter((s) => s.accepted_at);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      height="tall"
      title="AI Question Suggestions"
      showCloseButton
    >
      <View style={styles.container}>
        {/* The count line the old in-body header carried, kept under the shared
            title rather than beside it. */}
        <View style={styles.header}>
          <View style={styles.aiIconContainer}>
            <Icon name="robot" size={24} color={colors.purple} />
          </View>
          <Text style={styles.subtitle}>
            {isGenerating
              ? 'Generating questions...'
              : `${pendingSuggestions.length} suggested questions`}
          </Text>
        </View>

        {/* Loading state */}
        {isGenerating && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.purple} />
            <Text style={styles.loadingText}>Analyzing task and generating questions...</Text>
            <Text style={styles.loadingSubtext}>
              This may take a few seconds
            </Text>
          </View>
        )}

        {/* Suggestions list */}
        {!isGenerating && (
          <>
            {pendingSuggestions.length > 0 && (
              <View style={styles.actionBar}>
                <TouchableOpacity
                  style={[styles.acceptAllButton, acceptingAll && styles.buttonDisabled]}
                  onPress={handleAcceptAll}
                  disabled={acceptingAll}
                >
                  {acceptingAll ? (
                    <ActivityIndicator size="small" color={colors.white} />
                  ) : (
                    <>
                      <Icon name="check-all" size={20} color={colors.white} />
                      <Text style={styles.acceptAllText}>
                        Accept All ({pendingSuggestions.length})
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            )}

            <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
              {/* Pending suggestions */}
              {pendingSuggestions.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Review Suggestions</Text>
                  {pendingSuggestions.map((suggestion, index) => (
                    <SuggestionCard
                      key={suggestion.id}
                      suggestion={suggestion}
                      index={index}
                      isAccepting={acceptingIds.has(suggestion.id)}
                      isDismissing={dismissingIds.has(suggestion.id)}
                      onAccept={handleAccept}
                      onDismiss={handleDismiss}
                    />
                  ))}
                </View>
              )}

              {/* Accepted suggestions */}
              {acceptedSuggestions.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>
                    <Icon name="check-circle" size={16} color={colors.success} />{' '}
                    Accepted ({acceptedSuggestions.length})
                  </Text>
                  {acceptedSuggestions.map((suggestion) => (
                    <View key={suggestion.id} style={styles.acceptedCard}>
                      <Icon name="check-circle" size={20} color={colors.success} />
                      <Text style={styles.acceptedText}>{suggestion.text}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Empty state */}
              {pendingSuggestions.length === 0 && acceptedSuggestions.length === 0 && (
                <View style={styles.emptyState}>
                  <Icon name="robot-outline" size={64} color={colors.textTertiary} />
                  <Text style={styles.emptyTitle}>No Suggestions</Text>
                  <Text style={styles.emptyText}>
                    AI couldn't generate suggestions for this task.
                    Try adding task details or images.
                  </Text>
                </View>
              )}
            </ScrollView>
          </>
        )}
      </View>
    </BottomSheet>
  );
};

interface SuggestionCardProps {
  suggestion: ChecklistItem;
  index: number;
  isAccepting: boolean;
  isDismissing: boolean;
  onAccept: (itemId: string) => void;
  onDismiss: (itemId: string) => void;
}

const SuggestionCard: React.FC<SuggestionCardProps> = ({
  suggestion,
  index,
  isAccepting,
  isDismissing,
  onAccept,
  onDismiss,
}) => {
  const colors = useAppColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const priorityConfig = getPriorityConfig(colors, suggestion.priority);

  return (
    <View style={styles.suggestionCard}>
      {/* Header with index and priority */}
      <View style={styles.suggestionHeader}>
        <View style={styles.suggestionIndex}>
          <Text style={styles.suggestionIndexText}>{index + 1}</Text>
        </View>
        <View style={[styles.priorityBadge, { backgroundColor: priorityConfig.bgColor }]}>
          <Icon name={priorityConfig.icon} size={12} color={priorityConfig.color} />
          <Text style={[styles.priorityText, { color: priorityConfig.color }]}>
            {priorityConfig.label}
          </Text>
        </View>
        {suggestion.category && (
          <View style={styles.categoryBadge}>
            <Text style={styles.categoryText}>{suggestion.category}</Text>
          </View>
        )}
      </View>

      {/* Question text */}
      <Text style={styles.suggestionText}>{suggestion.text}</Text>

      {/* Confidence score */}
      {suggestion.ai_confidence !== null && (
        <View style={styles.confidenceContainer}>
          <Icon name="chart-line" size={14} color={colors.textSecondary} />
          <Text style={styles.confidenceText}>
            Confidence: {Math.round(suggestion.ai_confidence * 100)}%
          </Text>
        </View>
      )}

      {/* Action buttons */}
      <View style={styles.suggestionActions}>
        <TouchableOpacity
          style={[styles.dismissButton, isDismissing && styles.buttonDisabled]}
          onPress={() => onDismiss(suggestion.id)}
          disabled={isDismissing || isAccepting}
        >
          {isDismissing ? (
            <ActivityIndicator size="small" color={colors.textSecondary} />
          ) : (
            <>
              <Icon name="close" size={18} color={colors.textSecondary} />
              <Text style={styles.dismissText}>Dismiss</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.acceptButton, isAccepting && styles.buttonDisabled]}
          onPress={() => onAccept(suggestion.id)}
          disabled={isAccepting || isDismissing}
        >
          {isAccepting ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <>
              <Icon name="check" size={18} color={colors.white} />
              <Text style={styles.acceptText}>Accept</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  aiIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.purple + '14',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  loadingText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    marginTop: 16,
    textAlign: 'center',
  },
  loadingSubtext: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 8,
    textAlign: 'center',
  },
  actionBar: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  acceptAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    gap: 8,
  },
  acceptAllText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.white,
  },
  scrollView: {
    flex: 1,
  },
  section: {
    padding: 20,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  suggestionCard: {
    backgroundColor: colors.cardBackground,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.borderColor,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  suggestionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  suggestionIndex: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.purple + '14',
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionIndexText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.purple,
  },
  priorityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
  },
  priorityText: {
    fontSize: 11,
    fontWeight: '600',
  },
  categoryBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: colors.pillBackground,
  },
  categoryText: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.textSecondary,
    textTransform: 'capitalize',
  },
  suggestionText: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textPrimary,
    marginBottom: 12,
  },
  confidenceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 6,
  },
  confidenceText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  suggestionActions: {
    flexDirection: 'row',
    gap: 12,
  },
  dismissButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: colors.pillBackground,
    gap: 6,
  },
  dismissText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  acceptButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: colors.primary,
    gap: 6,
  },
  acceptText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.white,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  acceptedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.success + '1A',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    gap: 10,
  },
  acceptedText: {
    flex: 1,
    fontSize: 14,
    color: colors.success,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
    marginTop: 16,
  },
  emptyText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  });
