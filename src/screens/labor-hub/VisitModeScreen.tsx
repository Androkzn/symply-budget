import { useNavigation, useRoute, type RouteProp } from "expo-router/react-navigation";
import React, { useEffect, useState, useCallback } from 'react';
import { ScrollView, StyleSheet, View, TouchableOpacity, Alert, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  appointmentsApi,
  type AppointmentWithDetails,
  APPOINTMENT_TYPE_INFO,
} from '@api/appointments';
import {
  visitChecklistsApi,
  type ChecklistWithItems,
  type ChecklistItem,
} from '@api/visit-checklists';
import { AppBackground, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import type { ContractorsStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { CornerRadius, Opacity, scaledFont, Spacing, useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';

/** Apply an alpha channel to a solid `#RRGGBB` color. */
function withAlpha(hex: string, alpha: number): string {
  const sanitized = hex.replace('#', '');
  if (sanitized.length !== 6) return hex;
  const r = parseInt(sanitized.substring(0, 2), 16);
  const g = parseInt(sanitized.substring(2, 4), 16);
  const b = parseInt(sanitized.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

type VisitModeRoute = RouteProp<ContractorsStackParamList, 'VisitMode'>;

// Visit mode header actions (timer + end visit)
interface VisitModeHeaderActionsProps {
  onEnd: () => void;
  startTime: Date | null;
}

function VisitModeHeaderActions({ onEnd, startTime }: VisitModeHeaderActionsProps) {
  const colors = useAppColors();
  const [elapsed, setElapsed] = useState('00:00');

  useEffect(() => {
    if (!startTime) return;

    const interval = setInterval(() => {
      const diff = Date.now() - startTime.getTime();
      const minutes = Math.floor(diff / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      setElapsed(`${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
    }, 1000);

    return () => clearInterval(interval);
  }, [startTime]);

  return (
    <View style={styles.headerRight}>
      <View style={[styles.timerBadge, { backgroundColor: withAlpha(colors.primary, Opacity.onColorFill) }]}>
        <Icon name="time" size={16} color={colors.primary} />
        <Typography variant="subheadline" weight="semibold" color={colors.primary} style={{ marginLeft: 4 }}>
          {elapsed}
        </Typography>
      </View>
      <TouchableOpacity
        style={[styles.endButton, { backgroundColor: colors.error }]}
        onPress={onEnd}
      >
        <Typography variant="caption1" weight="semibold" color="onPrimary">
          End Visit
        </Typography>
      </TouchableOpacity>
    </View>
  );
}

// Checklist Item in Visit Mode
interface VisitChecklistItemProps {
  item: ChecklistItem;
  onToggle: () => void;
  onAddNote: (note: string) => void;
  onInfoPress?: () => void;
}

function VisitChecklistItem({ item, onToggle, onAddNote, onInfoPress }: VisitChecklistItemProps) {
  const colors = useAppColors();
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [noteText, setNoteText] = useState(item.comment || '');

  const handleSaveNote = () => {
    if (noteText.trim()) {
      onAddNote(noteText.trim());
    }
    setShowNoteInput(false);
  };

  return (
    <View style={[styles.visitItem, { backgroundColor: colors.backgroundSecondary }]}>
      <TouchableOpacity
        style={[
          styles.visitCheckbox,
          {
            backgroundColor: item.checked ? colors.success : 'transparent',
            borderColor: item.checked ? colors.success : colors.borderColor,
          },
        ]}
        onPress={onToggle}
      >
        {item.checked && <Icon name="checkmark" size={24} color={colors.white} />}
      </TouchableOpacity>

      <View style={styles.visitItemContent}>
        <Typography
          variant="headline"
          weight="medium"
          style={item.checked ? { textDecorationLine: 'line-through', opacity: 0.7 } : undefined}
        >
          {item.text}
        </Typography>

        {item.comment && !showNoteInput && (
          <View style={[styles.noteDisplay, { backgroundColor: colors.groupedListBackground }]}>
            <Icon name="chatbubble" size={14} color={colors.textSecondary} />
            <Typography variant="caption1" color="secondary" style={{ marginLeft: 6 }}>
              {item.comment}
            </Typography>
          </View>
        )}

        {showNoteInput && (
          <View style={styles.noteInputContainer}>
            <TextInput
              style={[styles.noteInput, { backgroundColor: colors.groupedListBackground, color: colors.textPrimary }]}
              placeholder="Add a note..."
              placeholderTextColor={colors.textSecondary}
              value={noteText}
              onChangeText={setNoteText}
              multiline
              autoFocus
            />
            <View style={styles.noteActions}>
              <TouchableOpacity onPress={() => setShowNoteInput(false)}>
                <Typography variant="caption1" color="secondary">
                  Cancel
                </Typography>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleSaveNote}>
                <Typography variant="caption1" weight="semibold" color="primary">
                  Save
                </Typography>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      <View style={styles.visitItemActions}>
        <TouchableOpacity
          style={[styles.visitActionBtn, { backgroundColor: colors.groupedListBackground }]}
          onPress={() => setShowNoteInput(true)}
        >
          <Icon name="chatbubble-outline" size={20} color={colors.textSecondary} />
        </TouchableOpacity>
        {item.has_info_icon && item.technical_term && onInfoPress && (
          <TouchableOpacity
            style={[styles.visitActionBtn, { backgroundColor: colors.primary + '20' }]}
            onPress={onInfoPress}
          >
            <Icon name="information-circle" size={20} color={colors.primary} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// Main Screen Component
export function VisitModeScreen() {
  const colors = useAppColors();
  const navigation = useNavigation<any>();
  const route = useRoute<VisitModeRoute>();
  const insets = useSafeAreaInsets();
  const { currentHousehold } = useHouseholdStore();

  const { appointmentId, checklistId } = route.params;

  const [appointment, setAppointment] = useState<AppointmentWithDetails | null>(null);
  const [checklist, setChecklist] = useState<ChecklistWithItems | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [quickNote, setQuickNote] = useState('');

  const householdId = currentHousehold?.id;

  const fetchData = useCallback(async () => {
    if (!householdId) return;

    setIsLoading(true);
    try {
      const [appointmentRes, checklistRes] = await Promise.all([
        appointmentsApi.getOne(householdId, appointmentId),
        checklistId ? visitChecklistsApi.getOne(householdId, checklistId) : Promise.resolve(null),
      ]);

      setAppointment(appointmentRes.appointment);
      if (checklistRes) {
        setChecklist(checklistRes.checklist);
      }
      setStartTime(new Date());

      // Start the appointment if it's not already in progress
      if (!['in_progress', 'completed'].includes(appointmentRes.appointment.status)) {
        await appointmentsApi.start(householdId, appointmentId);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      Alert.alert('Error', 'Failed to load visit data');
    } finally {
      setIsLoading(false);
    }
  }, [householdId, appointmentId, checklistId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleEndVisit = () => {
    Alert.alert(
      'End Visit',
      'Are you sure you want to end this visit?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End Visit',
          onPress: async () => {
            if (householdId && appointment?.status === 'in_progress') {
              try {
                await appointmentsApi.complete(householdId, appointmentId);
              } catch (error) {
                console.error('Error completing appointment:', error);
              }
            }
            navigation.goBack();
          },
        },
      ]
    );
  };

  const handleToggleItem = async (item: ChecklistItem) => {
    if (!householdId || !checklistId) return;

    try {
      const response = await visitChecklistsApi.checkItem(householdId, checklistId, item.id, !item.checked);
      setChecklist((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((i: ChecklistItem) => (i.id === item.id ? response.item : i)),
            }
          : null
      );
    } catch (error) {
      console.error('Error toggling item:', error);
    }
  };

  const handleAddNote = async (itemId: string, note: string) => {
    if (!householdId || !checklistId) return;

    try {
      const response = await visitChecklistsApi.updateItem(householdId, checklistId, itemId, {
        comment: note,
      });
      setChecklist((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((i: ChecklistItem) => (i.id === itemId ? response.item : i)),
            }
          : null
      );
    } catch (error) {
      console.error('Error adding note:', error);
    }
  };

  const handleInfoPress = (item: ChecklistItem) => {
    if (item.technical_term) {
      navigation.navigate('AITechnicalInfo', {
        technicalTerm: item.technical_term,
        checklistItemId: item.id,
        context: {
          visitPurpose: appointment?.type,
          contractorSpecialty: appointment?.contractor.specialty,
        },
      });
    }
  };

  const handleAddQuickNote = () => {
    if (!quickNote.trim()) return;
    // In a real implementation, this would save to visit notes
    Alert.alert('Note Saved', `Note: ${quickNote.trim()}`);
    setQuickNote('');
  };

  // Calculate progress
  const items = checklist?.items || [];
  const completedCount = items.filter((i: ChecklistItem) => i.checked).length;
  const progressPercent = items.length > 0 ? Math.round((completedCount / items.length) * 100) : 0;

  if (isLoading) {
    return (
      <AppBackground>
        <ScreenHeader
          title="Visit Mode"
          showBackButton
          onBackPress={() => navigation.goBack()}
          showNotificationBell={false}
          showAvatar={false}
        />
        <View style={[styles.loadingContainer, { backgroundColor: colors.backgroundMain }]}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Typography variant="subheadline" color="secondary" style={{ marginTop: 16 }}>
            Starting visit mode...
          </Typography>
        </View>
      </AppBackground>
    );
  }

  const typeInfo = appointment
    ? APPOINTMENT_TYPE_INFO[appointment.type] || APPOINTMENT_TYPE_INFO.consultation
    : null;

  return (
    <AppBackground>
      <ScreenHeader
        title="Visit Mode"
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
        rightElement={<VisitModeHeaderActions onEnd={handleEndVisit} startTime={startTime} />}
      />

      {appointment ? (
        <View style={styles.appointmentInfoRow}>
          {typeInfo ? <Icon name={typeInfo.iconName} size={16} color={colors.primary} /> : null}
          <Typography variant="caption1" color={colors.textSecondary}>
            {appointment.contractor.name}
          </Typography>
        </View>
      ) : null}

      <ScrollView
        {...keyboardDismissScrollProps}
        style={[screenScrollViewStyle.scroll, styles.scrollView]}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]}
      >
        <AdaptiveContainer style={styles.stack}>
          {/* Progress Card */}
          {items.length > 0 && (
            <View style={[styles.progressCard, { backgroundColor: colors.backgroundSecondary }]}>
              <View style={styles.progressRow}>
                <Typography variant="headline" weight="semibold">
                  Checklist Progress
                </Typography>
                <Typography variant="title3" weight="bold" style={{ color: colors.success }}>
                  {progressPercent}%
                </Typography>
              </View>
              <View style={[styles.progressBar, { backgroundColor: colors.groupedListBackground }]}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${progressPercent}%`,
                      backgroundColor: colors.success,
                    },
                  ]}
                />
              </View>
              <Typography variant="caption1" color="secondary" style={{ marginTop: 6 }}>
                {completedCount} of {items.length} items discussed
              </Typography>
            </View>
          )}

          {/* Checklist Items */}
          {items.length > 0 ? (
            <View style={styles.itemsContainer}>
              {items.map((item) => (
                <VisitChecklistItem
                  key={item.id}
                  item={item}
                  onToggle={() => handleToggleItem(item)}
                  onAddNote={(note) => handleAddNote(item.id, note)}
                  onInfoPress={item.has_info_icon ? () => handleInfoPress(item) : undefined}
                />
              ))}
            </View>
          ) : (
            <View style={[styles.noChecklist, { backgroundColor: colors.backgroundSecondary }]}>
              <Icon name="clipboard" size={40} color={colors.textSecondary} />
              <Typography variant="headline" weight="semibold" style={{ marginTop: 12 }}>
                No Checklist
              </Typography>
              <Typography variant="body" color="secondary" style={{ textAlign: 'center', marginTop: 4 }}>
                You can still take notes during this visit
              </Typography>
            </View>
          )}

          {/* Quick Note */}
          <View style={[styles.quickNoteCard, { backgroundColor: colors.backgroundSecondary }]}>
            <Typography variant="headline" weight="semibold" style={{ marginBottom: 12 }}>
              Quick Note
            </Typography>
            <View style={styles.quickNoteInput}>
              <TextInput
                style={[styles.noteTextInput, { backgroundColor: colors.groupedListBackground, color: colors.textPrimary }]}
                placeholder="Tap to add a quick note..."
                placeholderTextColor={colors.textSecondary}
                value={quickNote}
                onChangeText={setQuickNote}
                multiline
              />
              {quickNote.trim() && (
                <TouchableOpacity
                  style={[styles.saveNoteButton, { backgroundColor: colors.primary }]}
                  onPress={handleAddQuickNote}
                >
                  <Icon name="checkmark" size={20} color={colors.white} />
                </TouchableOpacity>
              )}
            </View>
          </View>
        </AdaptiveContainer>
      </ScrollView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: Spacing.base,
  },
  // The ScrollView has a single child (AdaptiveContainer), so the vertical
  // rhythm has to live here — otherwise every card stacks flush.
  stack: {
    gap: Spacing.base,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  appointmentInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.base,
    paddingBottom: Spacing.sm,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  timerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + Spacing.xxs,
    borderRadius: CornerRadius.lg,
  },
  endButton: {
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    borderRadius: CornerRadius.lg,
  },
  // Progress
  progressCard: {
    borderRadius: CornerRadius.lg,
    padding: Spacing.base,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  progressBar: {
    height: Spacing.sm,
    borderRadius: CornerRadius.xs,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: CornerRadius.xs,
  },
  // Items
  itemsContainer: {
    gap: Spacing.md,
  },
  visitItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: Spacing.base,
    borderRadius: CornerRadius.lg,
  },
  visitCheckbox: {
    width: 32,
    height: 32,
    borderRadius: CornerRadius.lg,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  visitItemContent: {
    flex: 1,
  },
  visitItemActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginLeft: Spacing.sm,
  },
  visitActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Note
  noteDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: CornerRadius.sm,
  },
  noteInputContainer: {
    marginTop: Spacing.sm,
  },
  noteInput: {
    padding: Spacing.md,
    borderRadius: CornerRadius.sm,
    ...scaledFont('bodySmall'),
    minHeight: 60,
  },
  noteActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.base,
    marginTop: Spacing.sm,
  },
  // No Checklist
  noChecklist: {
    alignItems: 'center',
    padding: Spacing.xxl,
    borderRadius: CornerRadius.lg,
  },
  // Quick Note
  quickNoteCard: {
    borderRadius: CornerRadius.lg,
    padding: Spacing.base,
  },
  quickNoteInput: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.md,
  },
  noteTextInput: {
    flex: 1,
    padding: Spacing.md,
    borderRadius: CornerRadius.md,
    ...scaledFont('body'),
    minHeight: 50,
    maxHeight: 120,
  },
  saveNoteButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default VisitModeScreen;
