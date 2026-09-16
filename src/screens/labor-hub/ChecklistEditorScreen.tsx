import { useNavigation, useRoute, type RouteProp } from "expo-router/react-navigation";
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View, TouchableOpacity, Alert, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  visitChecklistsApi,
  type ChecklistItem,
} from '@api/visit-checklists';
import { AppBackground, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import type { ContractorsStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { scaledFont, useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';

type ChecklistEditorRoute = RouteProp<ContractorsStackParamList, 'ChecklistEditor'>;

// Checklist Item Component
interface ChecklistItemRowProps {
  item: ChecklistItem;
  onToggle: () => void;
  onUpdate: (updates: Partial<ChecklistItem>) => void;
  onDelete: () => void;
  onInfoPress?: () => void;
  disabled?: boolean;
}

function ChecklistItemRow({
  item,
  onToggle,
  onUpdate,
  onDelete,
  onInfoPress,
  disabled,
}: ChecklistItemRowProps) {  const colors = useAppColors();
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(item.text);

  const handleSaveEdit = () => {
    if (editText.trim()) {
      onUpdate({ text: editText.trim() });
    }
    setIsEditing(false);
  };

  return (
    <View
      style={[
        styles.itemRow,
        { backgroundColor: colors.groupedListBackground },
        item.checked && { opacity: 0.7 },
      ]}
    >
      <TouchableOpacity
        style={[
          styles.checkbox,
          {
            backgroundColor: item.checked ? colors.success : 'transparent',
            borderColor: item.checked ? colors.success : colors.borderColor,
          },
        ]}
        onPress={onToggle}
        disabled={disabled}
      >
        {item.checked && <Icon name="checkmark" size={16} color={colors.white} />}
      </TouchableOpacity>

      <View style={styles.itemContent}>
        {isEditing ? (
          <TextInput
            style={[styles.itemInput, { color: colors.textPrimary }]}
            value={editText}
            onChangeText={setEditText}
            onBlur={handleSaveEdit}
            onSubmitEditing={handleSaveEdit}
            autoFocus
          />
        ) : (
          <TouchableOpacity onPress={() => setIsEditing(true)} style={{ flex: 1 }}>
            <Typography
              variant="subheadline"
              style={item.checked ? { textDecorationLine: 'line-through' } : undefined}
            >
              {item.text}
            </Typography>
            {item.comment && (
              <Typography variant="caption2" color="secondary" numberOfLines={1}>
                Note: {item.comment}
              </Typography>
            )}
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.itemActions}>
        {item.has_info_icon && item.technical_term && (
          <TouchableOpacity
            style={[styles.infoButton, { backgroundColor: colors.primary + '20' }]}
            onPress={onInfoPress}
          >
            <Icon name="information-circle" size={20} color={colors.primary} />
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={onDelete} style={styles.deleteItemButton}>
          <Icon name="close-circle" size={22} color={colors.error} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// Main Screen Component
export function ChecklistEditorScreen() {
  const colors = useAppColors();
  const navigation = useNavigation<any>();
  const route = useRoute<ChecklistEditorRoute>();
  const insets = useSafeAreaInsets();
  const { currentHousehold } = useHouseholdStore();

  const { checklistId, appointmentId, templateId } = route.params || {};

  const isEditing = !!checklistId;

  // State
  const [title, setTitle] = useState('');
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [newItemText, setNewItemText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const householdId = currentHousehold?.id;

  // Fetch existing checklist
  useEffect(() => {
    const fetchChecklist = async () => {
      if (!householdId || !checklistId) return;

      setIsLoading(true);
      try {
        const response = await visitChecklistsApi.getOne(householdId, checklistId);
        setTitle(response.checklist.title);
        setItems(response.checklist.items || []);
      } catch (error) {
        console.error('Error fetching checklist:', error);
        Alert.alert('Error', 'Failed to load checklist');
      } finally {
        setIsLoading(false);
      }
    };

    if (isEditing) {
      fetchChecklist();
    }
  }, [householdId, checklistId, isEditing]);

  const handleSave = async () => {
    if (!householdId) return;

    if (!title.trim()) {
      Alert.alert('Required', 'Please enter a title for the checklist');
      return;
    }

    setIsSaving(true);
    try {
      if (isEditing) {
        await visitChecklistsApi.update(householdId, checklistId!, {
          title: title.trim(),
        });
      } else {
        const response = await visitChecklistsApi.create(householdId, {
          title: title.trim(),
          appointment_id: appointmentId,
          template_id: templateId,
        });

        // Add items if any
        if (items.length > 0) {
          for (const item of items) {
            await visitChecklistsApi.addItem(householdId, response.checklist.id, {
              text: item.text,
              has_info_icon: item.has_info_icon,
              technical_term: item.technical_term ?? undefined,
              category: item.category ?? undefined,
              priority: item.priority,
            });
          }
        }
      }

      navigation.goBack();
    } catch (error) {
      console.error('Error saving checklist:', error);
      Alert.alert('Error', 'Failed to save checklist');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddItem = async () => {
    if (!newItemText.trim()) return;

    if (isEditing && householdId && checklistId) {
      try {
        const response = await visitChecklistsApi.addItem(householdId, checklistId, {
          text: newItemText.trim(),
          priority: 'must_ask',
        });
        setItems((prev) => [...prev, response.item]);
        setNewItemText('');
      } catch (error) {
        Alert.alert('Error', 'Failed to add item');
      }
    } else {
      // For new checklists, add to local state
      const newItem: ChecklistItem = {
        id: `temp-${Date.now()}`,
        checklist_id: '',
        text: newItemText.trim(),
        checked: false,
        checked_at: null,
        comment: null,
        voice_note_key: null,
        voice_note_transcription: null,
        has_info_icon: false,
        technical_term: null,
        category: null,
        priority: 'must_ask',
        sort_order: items.length,
        source: 'manual',
        ai_confidence: null,
        suggested_at: null,
        accepted_at: null,
        dismissed_at: null,
        created_at: new Date().toISOString(),
      };
      setItems((prev) => [...prev, newItem]);
      setNewItemText('');
    }
  };

  const handleToggleItem = async (item: ChecklistItem) => {
    if (!householdId || !checklistId) {
      // Local toggle for new checklists
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, checked: !i.checked } : i))
      );
      return;
    }

    try {
      const response = await visitChecklistsApi.checkItem(householdId, checklistId, item.id, !item.checked);
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? response.item : i))
      );
    } catch (error) {
      Alert.alert('Error', 'Failed to update item');
    }
  };

  const handleUpdateItem = async (itemId: string, updates: Partial<ChecklistItem>) => {
    if (!householdId || !checklistId) {
      // Local update for new checklists
      setItems((prev) =>
        prev.map((i) => (i.id === itemId ? { ...i, ...updates } : i))
      );
      return;
    }

    try {
      // Build UpdateItemRequest with only allowed fields
      const updateRequest: {
        text?: string;
        has_info_icon?: boolean;
        technical_term?: string;
        category?: string;
        priority?: 'must_ask' | 'nice_to_have' | 'optional';
        comment?: string;
        sort_order?: number;
      } = {};

      if (updates.text !== undefined) updateRequest.text = updates.text;
      if (updates.has_info_icon !== undefined) updateRequest.has_info_icon = updates.has_info_icon;
      if (updates.technical_term !== undefined) updateRequest.technical_term = updates.technical_term ?? undefined;
      if (updates.category !== undefined) updateRequest.category = updates.category ?? undefined;
      if (updates.priority !== undefined) updateRequest.priority = updates.priority;
      if (updates.comment !== undefined) updateRequest.comment = updates.comment ?? undefined;
      if (updates.sort_order !== undefined) updateRequest.sort_order = updates.sort_order;

      const response = await visitChecklistsApi.updateItem(householdId, checklistId, itemId, updateRequest);
      setItems((prev) =>
        prev.map((i) => (i.id === itemId ? response.item : i))
      );
    } catch (error) {
      Alert.alert('Error', 'Failed to update item');
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!householdId || !checklistId) {
      // Local delete for new checklists
      setItems((prev) => prev.filter((i) => i.id !== itemId));
      return;
    }

    try {
      await visitChecklistsApi.deleteItem(householdId, checklistId, itemId);
      setItems((prev) => prev.filter((i) => i.id !== itemId));
    } catch (error) {
      Alert.alert('Error', 'Failed to delete item');
    }
  };

  const handleInfoPress = (item: ChecklistItem) => {
    if (item.technical_term) {
      navigation.navigate('AITechnicalInfo', {
        technicalTerm: item.technical_term,
        checklistItemId: item.id,
      });
    }
  };

  const handleStartVisitMode = () => {
    if (checklistId && appointmentId) {
      navigation.navigate('VisitMode', {
        appointmentId,
        checklistId,
      });
    }
  };

  // Calculate progress
  const completedCount = items.filter((i) => i.checked).length;
  const progressPercent = items.length > 0 ? Math.round((completedCount / items.length) * 100) : 0;

  const checklistTitle = isEditing ? 'Edit Checklist' : 'New Checklist';
  const saveButton = (
    <TouchableOpacity onPress={handleSave} disabled={isSaving} style={styles.saveButton}>
      {isSaving ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : (
        <Typography variant="subheadline" weight="semibold" color="primary">
          Save
        </Typography>
      )}
    </TouchableOpacity>
  );

  if (isLoading) {
    return (
      <AppBackground>
        <ScreenHeader
          title={checklistTitle}
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

  return (
    <AppBackground>
      <ScreenHeader
        title={checklistTitle}
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
        rightElement={saveButton}
      />

      <ScrollView
        style={[screenScrollViewStyle.scroll, styles.scrollView]}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]}
        {...keyboardDismissScrollProps}
      >
        <AdaptiveContainer style={styles.stack}>
          {/* Title */}
          <View style={[styles.titleSection, { backgroundColor: colors.backgroundSecondary }]}>
            <TextInput
              style={[styles.titleInput, { color: colors.textPrimary }]}
              placeholder="Checklist title..."
              placeholderTextColor={colors.textSecondary}
              value={title}
              onChangeText={setTitle}
            />
          </View>

          {/* Progress */}
          {items.length > 0 && (
            <View style={[styles.progressCard, { backgroundColor: colors.backgroundSecondary }]}>
              <View style={styles.progressHeader}>
                <Typography variant="headline" weight="semibold">
                  Progress
                </Typography>
                <Typography variant="title3" weight="bold" style={{ color: colors.primary }}>
                  {progressPercent}%
                </Typography>
              </View>
              <View style={[styles.progressBar, { backgroundColor: colors.groupedListBackground }]}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${progressPercent}%`,
                      backgroundColor:
                        progressPercent === 100 ? colors.success : colors.primary,
                    },
                  ]}
                />
              </View>
              <Typography variant="caption1" color="secondary" style={{ marginTop: 8 }}>
                {completedCount} of {items.length} items completed
              </Typography>
            </View>
          )}

          {/* Items */}
          <View style={[styles.itemsSection, { backgroundColor: colors.backgroundSecondary }]}>
            <Typography variant="headline" weight="semibold" style={{ marginBottom: 12 }}>
              Items
            </Typography>

            {items.map((item) => (
              <ChecklistItemRow
                key={item.id}
                item={item}
                onToggle={() => handleToggleItem(item)}
                onUpdate={(updates) => handleUpdateItem(item.id, updates)}
                onDelete={() => handleDeleteItem(item.id)}
                onInfoPress={item.has_info_icon ? () => handleInfoPress(item) : undefined}
              />
            ))}

            {/* Add Item */}
            <View style={[styles.addItemRow, { backgroundColor: colors.groupedListBackground }]}>
              <TextInput
                style={[styles.addItemInput, { color: colors.textPrimary }]}
                placeholder="Add a new item..."
                placeholderTextColor={colors.textSecondary}
                value={newItemText}
                onChangeText={setNewItemText}
                onSubmitEditing={handleAddItem}
                returnKeyType="done"
              />
              <TouchableOpacity
                style={[
                  styles.addItemButton,
                  { backgroundColor: newItemText.trim() ? colors.primary : colors.borderColor },
                ]}
                onPress={handleAddItem}
                disabled={!newItemText.trim()}
              >
                <Icon name="add" size={20} color={colors.white} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Start Visit Mode */}
          {isEditing && appointmentId && (
            <TouchableOpacity
              style={[styles.visitModeButton, { backgroundColor: colors.primary }]}
              onPress={handleStartVisitMode}
            >
              <Icon name="clipboard" size={24} color={colors.white} />
              <Typography variant="subheadline" weight="semibold" color="onPrimary" style={{ marginLeft: 12 }}>
                Start Visit Mode
              </Typography>
            </TouchableOpacity>
          )}

          {/* Tips */}
          <View style={[styles.tipsCard, { backgroundColor: colors.primary + '10' }]}>
            <Icon name="bulb" size={24} color={colors.primary} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Typography variant="subheadline" weight="semibold" color="primary">
                Tips
              </Typography>
              <Typography variant="caption1" color="secondary">
                Add items you want to discuss or ask about during your contractor visit. Tap the
                info icon on items to learn technical terms.
              </Typography>
            </View>
          </View>
        </AdaptiveContainer>
      </ScrollView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRight: {
    width: 60,
    alignItems: 'flex-end',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  // The ScrollView has a single child (AdaptiveContainer), so the vertical
  // rhythm has to live here — otherwise every card stacks flush.
  stack: {
    gap: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveButton: {
    padding: 4,
  },
  // Title
  titleSection: {
    borderRadius: 16,
    padding: 16,
  },
  titleInput: {
    ...scaledFont('titleSmall'),
  },
  // Progress
  progressCard: {
    borderRadius: 16,
    padding: 16,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  progressBar: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  // Items
  itemsSection: {
    borderRadius: 16,
    padding: 16,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  itemContent: {
    flex: 1,
  },
  itemInput: {
    ...scaledFont('body'),
    flex: 1,
  },
  itemActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  infoButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteItemButton: {
    padding: 2,
  },
  // Add Item
  addItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderRadius: 12,
    marginTop: 8,
  },
  addItemInput: {
    ...scaledFont('body'),
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  addItemButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Visit Mode
  visitModeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 16,
  },
  // Tips
  tipsCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 16,
    borderRadius: 16,
  },
});

export default ChecklistEditorScreen;
