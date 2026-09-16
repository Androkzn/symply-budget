/**
 * TaskFormBody — the shared manual task form fields.
 *
 * Renders every "set it yourself" property of a task (name, category, priority,
 * contractor, due date, frequency, notes, reminders) as a stack of inline
 * fields with expand-in-place pickers. It is presentational: the host owns the
 * `formData` and receives patches via `onChange`. Used by both the full-screen
 * `ScheduleTaskScreen` (edit flow) and the collapsible "Add manually" section of
 * the shared `AddTaskSheet`.
 */
import DateTimePicker from '@react-native-community/datetimepicker';
import React, { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
// RNGH touchables: this form is hosted inside native-modal / bottom-sheet gesture
// roots (ScheduleTaskScreen, AddTaskSheet). Plain RN touchables lose the gesture
// arena to the surrounding handlers there — taps never fire, only scrolling works —
// so every tappable field must use the gesture-handler TouchableOpacity to stay
// interactive. See ScheduleTaskScreen's own header buttons (same import).
import { TouchableOpacity } from 'react-native-gesture-handler';

import { householdSpacesApi } from '@api/household-spaces';
import {
  Task,
  TaskPrioritySeverity,
  TASK_PRIORITY_SEVERITIES,
  TimeEffort,
  TIME_EFFORT_LABELS,
  TIME_EFFORTS,
} from '@api/tasks';
import { SpacePicker } from '@components/spaces/SpacePicker';
import { Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { useHouseholdMembers } from '@hooks/useHouseholdMembers';
import { useHouseholdStore } from '@stores/householdStore';
import { useSpaceStore } from '@stores/spaceStore';
import {
  CornerRadius,
  IconSize,
  Spacing,
  useAppColors,
  scaledFont,
} from '@theme';
import {
  getContractorCategoryIcon,
  getSystemCategoryIcon,
  type IoniconName,
} from '@utils/categoryIcons';
import type { TaskFormPhoto } from '@utils/taskPhotoSave';

import { TaskFormPhotos } from './TaskFormPhotos';
import { ReminderSettings, TaskReminderSettings } from './TaskReminderSettings';

// Map display types to system_category values. Grouped by section for the
// picker. Icons are resolved at the render site via getSystemCategoryIcon(value)
// (@utils/categoryIcons) so the whole app shares one taxonomy. Values must stay
// in sync with the backend `SYSTEM_CATEGORIES` enum (backend/src/types/index.ts).
export interface CategoryOption {
  label: string;
  value: string;
  group: string;
}

export const SYSTEM_CATEGORIES: CategoryOption[] = [
  // Home & Life — broader, everyday categories (not just maintenance)
  { label: 'General', value: 'other', group: 'Home & Life' },
  { label: 'Cleaning', value: 'cleaning', group: 'Home & Life' },
  { label: 'Errands & Shopping', value: 'errands', group: 'Home & Life' },
  { label: 'Finance & Bills', value: 'finance', group: 'Home & Life' },
  { label: 'Documents & Admin', value: 'documents', group: 'Home & Life' },
  { label: 'Family & Kids', value: 'family', group: 'Home & Life' },
  { label: 'Pets', value: 'pets', group: 'Home & Life' },
  { label: 'Health', value: 'health', group: 'Home & Life' },
  { label: 'Vehicle', value: 'vehicle', group: 'Home & Life' },
  { label: 'Events & Hosting', value: 'events', group: 'Home & Life' },
  { label: 'Moving', value: 'moving', group: 'Home & Life' },
  // Core Systems
  { label: 'HVAC', value: 'hvac', group: 'Systems' },
  { label: 'Plumbing', value: 'plumbing', group: 'Systems' },
  { label: 'Electrical', value: 'electrical', group: 'Systems' },
  { label: 'Gas', value: 'gas', group: 'Systems' },
  { label: 'Appliances', value: 'appliances', group: 'Systems' },
  { label: 'Smart Home', value: 'smart_home', group: 'Systems' },
  { label: 'Solar', value: 'solar', group: 'Systems' },
  { label: 'Phone/Internet', value: 'phone_internet', group: 'Systems' },
  // Structure
  { label: 'Roof', value: 'roof', group: 'Structure' },
  { label: 'Exterior', value: 'exterior', group: 'Structure' },
  { label: 'Interior', value: 'interior', group: 'Structure' },
  { label: 'Windows & Doors', value: 'windows_doors', group: 'Structure' },
  { label: 'Flooring', value: 'flooring', group: 'Structure' },
  { label: 'Painting', value: 'painting', group: 'Structure' },
  { label: 'Siding', value: 'siding', group: 'Structure' },
  { label: 'Gutters', value: 'gutters', group: 'Structure' },
  { label: 'Fencing', value: 'fencing', group: 'Structure' },
  { label: 'Deck/Patio', value: 'deck_patio', group: 'Structure' },
  { label: 'Garage Door', value: 'garage_door', group: 'Structure' },
  { label: 'Chimney/Fireplace', value: 'chimney', group: 'Structure' },
  // Water & Drainage
  { label: 'Drainage', value: 'drainage', group: 'Water & Outdoor' },
  { label: 'Septic', value: 'septic', group: 'Water & Outdoor' },
  { label: 'Pool/Spa', value: 'pool_spa', group: 'Water & Outdoor' },
  { label: 'Irrigation', value: 'irrigation', group: 'Water & Outdoor' },
  { label: 'Landscaping', value: 'landscaping', group: 'Water & Outdoor' },
  { label: 'Snow Removal', value: 'snow_removal', group: 'Water & Outdoor' },
  // Services
  { label: 'Safety', value: 'safety', group: 'Services' },
  { label: 'Security', value: 'security', group: 'Services' },
  { label: 'Pest Control', value: 'pest_control', group: 'Services' },
  { label: 'Inspection', value: 'inspection', group: 'Services' },
];

export type TaskFrequency =
  | 'one_time'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'quarterly'
  | 'yearly'
  | 'custom';

export const FREQUENCIES: { label: string; value: string }[] = [
  { label: 'One Time (No Repeat)', value: 'one_time' },
  { label: 'Daily', value: 'daily' },
  { label: 'Weekly', value: 'weekly' },
  { label: 'Monthly', value: 'monthly' },
  { label: 'Quarterly', value: 'quarterly' },
  { label: 'Yearly', value: 'yearly' },
  { label: 'Custom', value: 'custom' },
];

// Icons resolved at render via getContractorCategoryIcon(value).
export const CONTRACTOR_CATEGORIES: { label: string; value: string }[] = [
  // Trades
  { label: 'Plumber', value: 'plumber' },
  { label: 'Electrician', value: 'electrician' },
  { label: 'HVAC Technician', value: 'hvac' },
  { label: 'Roofer', value: 'roofer' },
  { label: 'General Contractor', value: 'general' },
  { label: 'Landscaper', value: 'landscaper' },
  { label: 'Painter', value: 'painter' },
  { label: 'Carpenter', value: 'carpenter' },
  { label: 'Appliance Repair', value: 'appliance' },
  { label: 'Pest Control', value: 'pest_control' },
  { label: 'Cleaning Service', value: 'cleaning' },
  // Government & Municipal
  { label: 'Government', value: 'government' },
  { label: 'City/Municipal', value: 'municipal' },
  // Utilities
  { label: 'BC Hydro', value: 'utility_bchydro' },
  { label: 'FortisBC', value: 'utility_fortisbc' },
  { label: 'Telus', value: 'utility_telus' },
  { label: 'Shaw/Rogers', value: 'utility_shaw' },
  { label: 'Water Utility', value: 'utility_water' },
  // Services
  { label: 'Insurance', value: 'insurance' },
  { label: 'Strata', value: 'strata' },
  { label: 'Property Mgmt', value: 'property_mgmt' },
  { label: 'Security', value: 'security' },
  { label: 'Waste Mgmt', value: 'waste_mgmt' },
  { label: 'Home Warranty', value: 'home_warranty' },
  { label: 'Inspector', value: 'inspector' },
  { label: 'Surveyor', value: 'surveyor' },
  // Other
  { label: 'Other', value: 'other' },
];

export const PRIORITY_LABELS: Record<TaskPrioritySeverity, string> = {
  nice_to_have: 'Nice to Have',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
  critical: 'Critical',
};

export interface TaskFormData {
  title: string;
  description: string;
  system_category: string;
  priority_severity: TaskPrioritySeverity;
  /** Coarse "how long will this take" tier, or null when unset (AI may fill it). */
  time_effort: TimeEffort | null;
  frequency: string;
  custom_interval_days: string;
  next_due_date: Date | null;
  needs_contractor: boolean;
  contractor_category: string;
  reminder_enabled: boolean;
  reminder_days_before: number;
  reminder_time: string;
  reminder_repeat: boolean;
  /** When true, this task is private — only visible to the current user. */
  is_personal: boolean;
  /** User id of the household member this task is assigned to, or null when unassigned. */
  assigned_to: string | null;
  /** Household space this task belongs to, or null when unset (AI may fill it). */
  space_id: string | null;
  photos: TaskFormPhoto[];
  /** Index into `photos` for the task card cover image. */
  coverPhotoIndex: number;
}

/** A blank form, used when creating a brand-new task. */
export function createEmptyTaskForm(): TaskFormData {
  return {
    title: '',
    description: '',
    system_category: 'other',
    priority_severity: 'nice_to_have',
    time_effort: null,
    frequency: 'one_time',
    custom_interval_days: '30',
    next_due_date: null,
    needs_contractor: false,
    contractor_category: 'general',
    reminder_enabled: true,
    reminder_days_before: 1,
    reminder_time: '09:00',
    reminder_repeat: true,
    is_personal: false,
    assigned_to: null,
    space_id: null,
    photos: [],
    coverPhotoIndex: 0,
  };
}

/** Hydrate the form from an existing task (edit flow). */
export function taskToFormData(task: Task): TaskFormData {
  return {
    title: task.title,
    description: task.description || '',
    system_category: task.system_category || 'other',
    priority_severity: task.priority_severity || 'nice_to_have',
    time_effort: task.time_effort ?? null,
    frequency: task.frequency,
    custom_interval_days: task.custom_interval_days?.toString() || '30',
    next_due_date: task.next_due_date ? new Date(task.next_due_date) : null,
    needs_contractor: task.needs_contractor || false,
    contractor_category: task.contractor_category || 'general',
    reminder_enabled: task.reminder_enabled ?? true,
    reminder_days_before: task.reminder_days_before ?? 1,
    reminder_time: task.reminder_time || '09:00',
    reminder_repeat: task.reminder_repeat ?? true,
    is_personal: task.is_personal ?? false,
    assigned_to: task.assigned_to?.id ?? null,
    space_id: task.space_id ?? null,
    photos: (task.photos ?? []).map(photo => ({
      id: photo.id,
      uri: photo.photo_url,
      photo_key: photo.photo_key,
      // Carry the H6 descriptor through the edit round-trip. Without this, a
      // task edited on any device would come back with the descriptor stripped
      // and only the synthetic `lf-blob/…` key left, which names nothing.
      blob: photo.blob ?? null,
    })),
    coverPhotoIndex: (() => {
      const items = task.photos ?? [];
      if (items.length === 0) return 0;
      const idx = items.findIndex(photo => photo.id === task.cover_photo_id);
      return idx >= 0 ? idx : 0;
    })(),
  };
}

/** Build the create/update API payload from form state. */
export function taskFormToRequest(
  formData: TaskFormData,
  options?: { isEditing?: boolean },
) {
  const isEditing = options?.isEditing ?? false;
  return {
    title: formData.title.trim(),
    description: formData.description.trim() || undefined,
    system_category: formData.system_category,
    frequency: formData.frequency as TaskFrequency,
    custom_interval_days:
      formData.frequency === 'custom'
        ? parseInt(formData.custom_interval_days, 10)
        : undefined,
    next_due_date: formData.next_due_date
      ? formData.next_due_date.toISOString()
      : undefined,
    priority_severity: formData.priority_severity,
    time_effort: formData.time_effort ?? undefined,
    needs_contractor: formData.needs_contractor,
    contractor_category: formData.needs_contractor
      ? formData.contractor_category
      : undefined,
    // Only seed workflow on create; edits must not reset an in-progress contractor flow.
    workflow_stage:
      !isEditing && formData.needs_contractor ? 'planning' : undefined,
    reminder_enabled: formData.reminder_enabled,
    reminder_days_before: formData.reminder_days_before,
    reminder_time: formData.reminder_time,
    reminder_repeat: formData.reminder_repeat,
    is_personal: formData.is_personal,
    // Personal tasks belong to the current user only, so never carry an assignee.
    // On edit, callers may override with the raw value (incl. null) to unassign.
    assigned_to: formData.is_personal
      ? undefined
      : formData.assigned_to ?? undefined,
    space_id: formData.space_id ?? undefined,
  };
}

export function getCategoryLabel(value: string): string {
  return SYSTEM_CATEGORIES.find(c => c.value === value)?.label || 'General';
}

export function getCategoryIcon(value: string): IoniconName {
  return getSystemCategoryIcon(value);
}

// ── Quick due-date shortcuts ────────────────────────────────────────────────
type QuickDateKey =
  | 'asap'
  | 'today'
  | 'tomorrow'
  | 'this_week'
  | 'next_week'
  | 'this_month'
  | 'this_year';

const QUICK_DATES: { key: QuickDateKey; label: string }[] = [
  { key: 'asap', label: 'ASAP' },
  { key: 'today', label: 'Today' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'this_week', label: 'This week' },
  { key: 'next_week', label: 'Next week' },
  { key: 'this_month', label: 'This month' },
  { key: 'this_year', label: 'This year' },
];

/** Midnight of the given date (local), so comparisons ignore the time of day. */
function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Resolve a quick shortcut to a concrete due date (end-of-period for ranges). */
function resolveQuickDate(key: QuickDateKey): Date {
  const today = startOfDay(new Date());
  switch (key) {
    case 'asap':
      // As soon as possible — treat as due today.
      return today;
    case 'today':
      return today;
    case 'tomorrow': {
      const d = new Date(today);
      d.setDate(d.getDate() + 1);
      return d;
    }
    case 'this_week': {
      // End of the current week — the upcoming Sunday (today if already Sunday).
      const d = new Date(today);
      d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
      return d;
    }
    case 'next_week': {
      // End of next week — the Sunday after this week's upcoming Sunday.
      const d = new Date(today);
      d.setDate(d.getDate() + ((7 - d.getDay()) % 7) + 7);
      return d;
    }
    case 'this_month':
      // Last calendar day of the current month.
      return new Date(today.getFullYear(), today.getMonth() + 1, 0);
    case 'this_year':
      // Last calendar day of the current year.
      return new Date(today.getFullYear(), 11, 31);
  }
}

function isSameDay(a: Date | null, b: Date): boolean {
  if (!a) return false;
  const x = startOfDay(a);
  return x.getTime() === b.getTime();
}

interface TaskFormBodyProps {
  formData: TaskFormData;
  onChange: (patch: Partial<TaskFormData>) => void;
  isEditing?: boolean;
}

export function TaskFormBody({
  formData,
  onChange,
  isEditing = false,
}: TaskFormBodyProps) {  const colors = useAppColors();
  const { currentHousehold } = useHouseholdStore();
  const { data: members = [] } = useHouseholdMembers(currentHousehold?.id);
  const spaces = useSpaceStore(state => state.spaces);
  const setSpaces = useSpaceStore(state => state.setSpaces);

  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [showSpacePicker, setShowSpacePicker] = useState(false);
  const [showPriorityPicker, setShowPriorityPicker] = useState(false);
  const [showTimeEffortPicker, setShowTimeEffortPicker] = useState(false);
  const [showAssigneePicker, setShowAssigneePicker] = useState(false);
  const [showFrequencyPicker, setShowFrequencyPicker] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showContractorCategoryPicker, setShowContractorCategoryPicker] =
    useState(false);
  const [categorySearchQuery, setCategorySearchQuery] = useState('');
  const [contractorSearchQuery, setContractorSearchQuery] = useState('');

  // Members load via useHouseholdMembers (RQ) when the household is known.

  // Load household spaces for the "Where" picker.
  useEffect(() => {
    if (!currentHousehold || spaces.length > 0) return;
    householdSpacesApi
      .list(currentHousehold.id)
      .then(({ spaces: loadedSpaces }) => setSpaces(loadedSpaces))
      .catch(() => {});
  }, [currentHousehold, spaces.length, setSpaces]);

  const assignedMember =
    members.find(m => m.user_id === formData.assigned_to) ?? null;
  const getAssigneeLabel = (): string => {
    if (!formData.assigned_to) return 'Select assignee';
    return assignedMember?.display_name || assignedMember?.email || 'Assigned';
  };

  const selectedSpace =
    spaces.find(space => space.id === formData.space_id) ?? null;
  const getSpaceLabel = (): string => {
    if (!formData.space_id) return 'Select space';
    return selectedSpace?.name || 'Selected space';
  };

  const updateField = <K extends keyof TaskFormData>(
    field: K,
    value: TaskFormData[K],
  ) => {
    onChange({ [field]: value } as Partial<TaskFormData>);
  };

  // Theme-aware separators (StyleSheet can't read the active theme).
  const dividerStyle = [styles.divider, { backgroundColor: colors.divider }];
  const hairlineColor = { borderBottomColor: colors.divider };
  const activeOptionStyle = { backgroundColor: colors.surfaceSelected };

  const visibleCategories = SYSTEM_CATEGORIES.filter(category =>
    category.label.toLowerCase().includes(categorySearchQuery.toLowerCase()),
  );

  const formatDateForDisplay = (date: Date | null): string => {
    if (!date) return 'Select date';
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const getFrequencyLabel = (value: string): string =>
    FREQUENCIES.find(f => f.value === value)?.label || 'One Time (No Repeat)';

  const getContractorCategoryLabel = (value: string): string => {
    const category = CONTRACTOR_CATEGORIES.find(c => c.value === value);
    return category ? category.label : 'General Contractor';
  };

  return (
    <View>
      {/* Task Name */}
      <View style={styles.formField}>
        <Typography
          variant="caption"
          color={colors.textSecondary}
          style={styles.fieldLabel}
        >
          Task Name *
        </Typography>
        <TextInput
          style={[styles.textInput, { color: colors.textPrimary }]}
          value={formData.title}
          onChangeText={text => updateField('title', text)}
          placeholder="e.g., Change HVAC Filter"
          placeholderTextColor={colors.textTertiary}
          testID="task-form-title"
        />
      </View>

      <View style={dividerStyle} />

      {/* Photos */}
      <View style={styles.formField}>
        <TaskFormPhotos
          photos={formData.photos}
          coverPhotoIndex={formData.coverPhotoIndex}
          onChange={patch => onChange(patch)}
          // The blob channel seals against a specific property's household key,
          // so hand it the one this form is editing rather than letting it fall
          // back to "whatever is active" mid property-switch.
          householdId={currentHousehold?.id}
        />
      </View>

      <View style={dividerStyle} />

      {/* Category */}
      <View style={styles.formField}>
        <Typography
          variant="caption"
          color={colors.textSecondary}
          style={styles.fieldLabel}
        >
          Category
        </Typography>
        <TouchableOpacity
          style={styles.pickerButton}
          onPress={() => {
            if (showCategoryPicker) {
              setCategorySearchQuery('');
            }
            setShowCategoryPicker(!showCategoryPicker);
          }}
        >
          <View style={styles.pickerValueRow}>
            <Icon
              name={getSystemCategoryIcon(formData.system_category)}
              size={IconSize.md}
              color={colors.textPrimary}
            />
            <Typography variant="body" color={colors.textPrimary}>
              {getCategoryLabel(formData.system_category)}
            </Typography>
          </View>
          <Icon
            name="chevron-forward"
            size={IconSize.md}
            color={colors.textTertiary}
          />
        </TouchableOpacity>
      </View>

      {showCategoryPicker && (
        <View
          style={[
            styles.pickerOptions,
            { backgroundColor: colors.backgroundMain },
          ]}
        >
          <View
            style={[
              styles.searchContainer,
              hairlineColor,
              { backgroundColor: colors.backgroundSecondary },
            ]}
          >
            <Icon
              name="search"
              size={IconSize.md}
              color={colors.textTertiary}
            />
            <TextInput
              style={[styles.searchInput, { color: colors.textPrimary }]}
              value={categorySearchQuery}
              onChangeText={setCategorySearchQuery}
              placeholder="Search categories..."
              placeholderTextColor={colors.textTertiary}
              autoFocus
            />
            {categorySearchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setCategorySearchQuery('')}>
                <Icon
                  name="close"
                  size={IconSize.md}
                  color={colors.textTertiary}
                />
              </TouchableOpacity>
            )}
          </View>

          {/* No `automaticallyAdjustKeyboardInsets` on either of this file's two
              `pickerScrollView`s: they are NESTED dropdown lists, not the form's
              own scroll container. Keyboard avoidance is already handled a level
              up — `ScheduleTaskScreen` spreads `keyboardDismissScrollProps` on the
              form scroller that holds this body, and `AddTaskSheet` does the same
              inside the shared `BottomSheet`, which lifts and caps itself.
              Insetting a dropdown inside an already-adjusting parent would double
              the shift and lift the options off the field they belong to. */}
          <ScrollView
            style={styles.pickerScrollView}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
          >
            {visibleCategories.map((category, index) => {
              const selected = formData.system_category === category.value;
              const showGroupHeader =
                index === 0 ||
                visibleCategories[index - 1].group !== category.group;
              return (
                <View key={category.value}>
                  {showGroupHeader && (
                    <Typography
                      variant="captionBold"
                      color={colors.textTertiary}
                      style={styles.groupHeader}
                    >
                      {category.group.toUpperCase()}
                    </Typography>
                  )}
                  <TouchableOpacity
                    style={[
                      styles.pickerOption,
                      hairlineColor,
                      selected && activeOptionStyle,
                    ]}
                    onPress={() => {
                      updateField('system_category', category.value);
                      setShowCategoryPicker(false);
                      setCategorySearchQuery('');
                    }}
                  >
                    <View style={styles.pickerValueRow}>
                      <Icon
                        name={getSystemCategoryIcon(category.value)}
                        size={IconSize.md}
                        color={
                          selected ? colors.primary : colors.textPrimary
                        }
                      />
                      <Typography
                        variant="body"
                        color={
                          selected ? colors.primary : colors.textPrimary
                        }
                      >
                        {category.label}
                      </Typography>
                    </View>
                    {selected && (
                      <Icon
                        name="checkmark"
                        size={IconSize.md}
                        color={colors.primary}
                      />
                    )}
                  </TouchableOpacity>
                </View>
              );
            })}
            {visibleCategories.length === 0 && (
              <View style={styles.noResults}>
                <Typography variant="body" color={colors.textSecondary}>
                  No categories found
                </Typography>
              </View>
            )}
          </ScrollView>
        </View>
      )}

      <View style={dividerStyle} />

      {/* Where — which room/area this task belongs to */}
      <View style={styles.formField}>
        <Typography
          variant="caption"
          color={colors.textSecondary}
          style={styles.fieldLabel}
        >
          Where
        </Typography>
        <TouchableOpacity
          style={styles.pickerButton}
          onPress={() => setShowSpacePicker(true)}
          testID="task-form-space"
        >
          <View style={styles.pickerValueRow}>
            <Icon
              name="location-outline"
              size={IconSize.md}
              color={colors.textTertiary}
            />
            <Typography
              variant="body"
              color={
                formData.space_id ? colors.textPrimary : colors.textTertiary
              }
            >
              {getSpaceLabel()}
            </Typography>
          </View>
          <Icon
            name="chevron-forward"
            size={IconSize.md}
            color={colors.textTertiary}
          />
        </TouchableOpacity>
      </View>

      {currentHousehold && (
        <SpacePicker
          visible={showSpacePicker}
          currentSpaceId={formData.space_id}
          householdId={currentHousehold.id}
          onClose={() => setShowSpacePicker(false)}
          onSelect={space => updateField('space_id', space?.id ?? null)}
        />
      )}

      <View style={dividerStyle} />

      {/* Priority / Severity */}
      <View style={styles.formField}>
        <Typography
          variant="caption"
          color={colors.textSecondary}
          style={styles.fieldLabel}
        >
          Priority
        </Typography>
        <TouchableOpacity
          style={styles.pickerButton}
          onPress={() => setShowPriorityPicker(!showPriorityPicker)}
        >
          <Typography variant="body" color={colors.textPrimary}>
            {PRIORITY_LABELS[formData.priority_severity]}
          </Typography>
          <Icon
            name="chevron-forward"
            size={IconSize.md}
            color={colors.textTertiary}
          />
        </TouchableOpacity>
      </View>

      {showPriorityPicker && (
        <View
          style={[
            styles.pickerOptions,
            { backgroundColor: colors.backgroundMain },
          ]}
        >
          {TASK_PRIORITY_SEVERITIES.map(severity => (
            <TouchableOpacity
              key={severity}
              style={[
                styles.pickerOption,
                hairlineColor,
                formData.priority_severity === severity && activeOptionStyle,
              ]}
              onPress={() => {
                updateField('priority_severity', severity);
                setShowPriorityPicker(false);
              }}
            >
              <Typography
                variant="body"
                color={
                  formData.priority_severity === severity
                    ? colors.primary
                    : colors.textPrimary
                }
              >
                {PRIORITY_LABELS[severity]}
              </Typography>
              {formData.priority_severity === severity && (
                <Icon
                  name="checkmark"
                  size={IconSize.md}
                  color={colors.primary}
                />
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={dividerStyle} />

      {/* Time effort — coarse "how long will this take" tier. Normally filled by
          AI enrichment, but user-settable here. Clearable back to "Not set". */}
      <View style={styles.formField}>
        <Typography
          variant="caption"
          color={colors.textSecondary}
          style={styles.fieldLabel}
        >
          Time effort
        </Typography>
        <TouchableOpacity
          style={styles.pickerButton}
          onPress={() => setShowTimeEffortPicker(!showTimeEffortPicker)}
          testID="task-form-time-effort"
        >
          <Typography
            variant="body"
            color={
              formData.time_effort ? colors.textPrimary : colors.textTertiary
            }
          >
            {formData.time_effort
              ? TIME_EFFORT_LABELS[formData.time_effort]
              : 'Not set'}
          </Typography>
          <Icon
            name="chevron-forward"
            size={IconSize.md}
            color={colors.textTertiary}
          />
        </TouchableOpacity>
      </View>

      {showTimeEffortPicker && (
        <View
          style={[
            styles.pickerOptions,
            { backgroundColor: colors.backgroundMain },
          ]}
        >
          <TouchableOpacity
            style={[
              styles.pickerOption,
              hairlineColor,
              formData.time_effort === null && activeOptionStyle,
            ]}
            onPress={() => {
              updateField('time_effort', null);
              setShowTimeEffortPicker(false);
            }}
          >
            <Typography
              variant="body"
              color={
                formData.time_effort === null
                  ? colors.primary
                  : colors.textSecondary
              }
            >
              Not set
            </Typography>
            {formData.time_effort === null && (
              <Icon
                name="checkmark"
                size={IconSize.md}
                color={colors.primary}
              />
            )}
          </TouchableOpacity>
          {TIME_EFFORTS.map(effort => (
            <TouchableOpacity
              key={effort}
              style={[
                styles.pickerOption,
                hairlineColor,
                formData.time_effort === effort && activeOptionStyle,
              ]}
              onPress={() => {
                updateField('time_effort', effort);
                setShowTimeEffortPicker(false);
              }}
            >
              <Typography
                variant="body"
                color={
                  formData.time_effort === effort
                    ? colors.primary
                    : colors.textPrimary
                }
              >
                {TIME_EFFORT_LABELS[effort]}
              </Typography>
              {formData.time_effort === effort && (
                <Icon
                  name="checkmark"
                  size={IconSize.md}
                  color={colors.primary}
                />
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Assignee — who owns this task. Required for shared tasks so nothing is
          left unowned. Hidden for personal tasks, which are only ever visible to
          the current user. */}
      {!formData.is_personal && (
        <>
          <View style={dividerStyle} />
          <View style={styles.formField}>
            <Typography
              variant="caption"
              color={colors.textSecondary}
              style={styles.fieldLabel}
            >
              Assign to{' '}
              <Typography variant="caption" color={colors.error}>
                *
              </Typography>
            </Typography>
            <TouchableOpacity
              style={styles.pickerButton}
              onPress={() => setShowAssigneePicker(!showAssigneePicker)}
              testID="task-form-assignee"
            >
              <View style={styles.pickerValueRow}>
                <Icon
                  name="person-circle-outline"
                  size={IconSize.md}
                  color={colors.textTertiary}
                />
                <Typography
                  variant="body"
                  color={
                    formData.assigned_to
                      ? colors.textPrimary
                      : colors.textTertiary
                  }
                >
                  {getAssigneeLabel()}
                </Typography>
              </View>
              <Icon
                name="chevron-forward"
                size={IconSize.md}
                color={colors.textTertiary}
              />
            </TouchableOpacity>
          </View>

          {showAssigneePicker && (
            <View
              style={[
                styles.pickerOptions,
                { backgroundColor: colors.backgroundMain },
              ]}
            >
              <ScrollView
                style={styles.pickerScrollView}
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
              >
                {members.map(member => {
                  const selected = member.user_id === formData.assigned_to;
                  return (
                    <TouchableOpacity
                      key={member.user_id}
                      style={[
                        styles.pickerOption,
                        hairlineColor,
                        selected && activeOptionStyle,
                      ]}
                      onPress={() => {
                        updateField('assigned_to', member.user_id);
                        setShowAssigneePicker(false);
                      }}
                    >
                      <Typography
                        variant="body"
                        color={
                          selected ? colors.primary : colors.textPrimary
                        }
                      >
                        {member.display_name || member.email}
                      </Typography>
                      {selected && (
                        <Icon
                          name="checkmark"
                          size={IconSize.md}
                          color={colors.primary}
                        />
                      )}
                    </TouchableOpacity>
                  );
                })}
                {members.length === 0 && (
                  <View style={styles.noResults}>
                    <Typography
                      variant="body"
                      color={colors.textSecondary}
                    >
                      No household members found
                    </Typography>
                  </View>
                )}
              </ScrollView>
            </View>
          )}
        </>
      )}

      <View style={dividerStyle} />

      {/* Personal Task Toggle */}
      <View style={styles.formField}>
        <TouchableOpacity
          style={styles.checkboxRow}
          onPress={() => updateField('is_personal', !formData.is_personal)}
        >
          <View
            style={[
              styles.checkbox,
              formData.is_personal && {
                backgroundColor: colors.accent,
                borderColor: colors.accent,
              },
              { borderColor: colors.primary },
            ]}
          >
            {formData.is_personal && (
              <Icon
                name="checkmark"
                size={IconSize.sm}
                color={colors.backgroundSecondary}
              />
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Typography
              variant="body"
              color={colors.textPrimary}
              style={styles.checkboxLabel}
            >
              Personal task (only visible to me)
            </Typography>
            <Typography variant="caption1" color={colors.textSecondary}>
              Other household members won't see this task
            </Typography>
          </View>
        </TouchableOpacity>
      </View>

      <View style={dividerStyle} />

      {/* Needs Contractor Checkbox */}
      <View style={styles.formField}>
        <TouchableOpacity
          style={styles.checkboxRow}
          onPress={() =>
            updateField('needs_contractor', !formData.needs_contractor)
          }
        >
          <View
            style={[
              styles.checkbox,
              formData.needs_contractor && {
                backgroundColor: colors.accent,
                borderColor: colors.accent,
              },
              { borderColor: colors.primary },
            ]}
          >
            {formData.needs_contractor && (
              <Icon
                name="checkmark"
                size={IconSize.sm}
                color={colors.backgroundSecondary}
              />
            )}
          </View>
          <Typography
            variant="body"
            color={colors.textPrimary}
            style={styles.checkboxLabel}
          >
            This task requires a contractor
          </Typography>
        </TouchableOpacity>
      </View>

      {formData.needs_contractor && (
        <>
          <View style={dividerStyle} />
          <View style={styles.formField}>
            <Typography
              variant="caption"
              color={colors.textSecondary}
              style={styles.fieldLabel}
            >
              Contractor Category
            </Typography>
            <TouchableOpacity
              style={styles.pickerButton}
              onPress={() => {
                if (showContractorCategoryPicker) {
                  setContractorSearchQuery('');
                }
                setShowContractorCategoryPicker(!showContractorCategoryPicker);
              }}
            >
              <View style={styles.pickerValueRow}>
                <Icon
                  name={getContractorCategoryIcon(formData.contractor_category)}
                  size={IconSize.md}
                  color={colors.textPrimary}
                />
                <Typography variant="body" color={colors.textPrimary}>
                  {getContractorCategoryLabel(formData.contractor_category)}
                </Typography>
              </View>
              <Icon
                name="chevron-forward"
                size={IconSize.md}
                color={colors.textTertiary}
              />
            </TouchableOpacity>
          </View>

          {showContractorCategoryPicker && (
            <View
              style={[
                styles.pickerOptions,
                { backgroundColor: colors.backgroundMain },
              ]}
            >
              <View
                style={[
                  styles.searchContainer,
                  hairlineColor,
                  { backgroundColor: colors.backgroundSecondary },
                ]}
              >
                <Icon
                  name="search"
                  size={IconSize.md}
                  color={colors.textTertiary}
                />
                <TextInput
                  style={[styles.searchInput, { color: colors.textPrimary }]}
                  value={contractorSearchQuery}
                  onChangeText={setContractorSearchQuery}
                  placeholder="Search contractor types..."
                  placeholderTextColor={colors.textTertiary}
                  autoFocus
                />
                {contractorSearchQuery.length > 0 && (
                  <TouchableOpacity
                    onPress={() => setContractorSearchQuery('')}
                  >
                    <Icon
                      name="close"
                      size={IconSize.md}
                      color={colors.textTertiary}
                    />
                  </TouchableOpacity>
                )}
              </View>

              <ScrollView
                style={styles.pickerScrollView}
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
              >
                {CONTRACTOR_CATEGORIES.filter(category =>
                  category.label
                    .toLowerCase()
                    .includes(contractorSearchQuery.toLowerCase()),
                ).map(category => (
                  <TouchableOpacity
                    key={category.value}
                    style={[
                      styles.pickerOption,
                      hairlineColor,
                      formData.contractor_category === category.value &&
                        activeOptionStyle,
                    ]}
                    onPress={() => {
                      updateField('contractor_category', category.value);
                      setShowContractorCategoryPicker(false);
                      setContractorSearchQuery('');
                    }}
                  >
                    <View style={styles.pickerValueRow}>
                      <Icon
                        name={getContractorCategoryIcon(category.value)}
                        size={IconSize.md}
                        color={
                          formData.contractor_category === category.value
                            ? colors.primary
                            : colors.textPrimary
                        }
                      />
                      <Typography
                        variant="body"
                        color={
                          formData.contractor_category === category.value
                            ? colors.primary
                            : colors.textPrimary
                        }
                      >
                        {category.label}
                      </Typography>
                    </View>
                    {formData.contractor_category === category.value && (
                      <Icon
                        name="checkmark"
                        size={IconSize.md}
                        color={colors.primary}
                      />
                    )}
                  </TouchableOpacity>
                ))}
                {CONTRACTOR_CATEGORIES.filter(category =>
                  category.label
                    .toLowerCase()
                    .includes(contractorSearchQuery.toLowerCase()),
                ).length === 0 && (
                  <View style={styles.noResults}>
                    <Typography
                      variant="body"
                      color={colors.textSecondary}
                    >
                      No contractor types found
                    </Typography>
                  </View>
                )}
              </ScrollView>
            </View>
          )}
        </>
      )}

      <View style={dividerStyle} />

      {/* Due Date */}
      <View style={styles.formField}>
        <Typography
          variant="caption"
          color={colors.textSecondary}
          style={styles.fieldLabel}
        >
          First Due Date
        </Typography>

        {/* Quick shortcuts — tap to set, tap again to clear */}
        <View style={styles.quickDateRow}>
          {/* Only the first preset matching the selected date is highlighted, so
              same-day presets (e.g. ASAP / Today) never both appear active. */}
          {(() => {
            const activeIndex = QUICK_DATES.findIndex(q =>
              isSameDay(formData.next_due_date, resolveQuickDate(q.key)),
            );
            return QUICK_DATES.map((quick, index) => {
              const active = index === activeIndex;
              return (
                <TouchableOpacity
                  key={quick.key}
                  style={[
                    styles.quickDateChip,
                    {
                      backgroundColor: active
                        ? colors.primary
                        : colors.pillBackground,
                    },
                  ]}
                  onPress={() =>
                    updateField(
                      'next_due_date',
                      active ? null : resolveQuickDate(quick.key),
                    )
                  }
                  activeOpacity={0.7}
                >
                  <Typography
                    variant="caption"
                    weight={active ? 'semibold' : 'regular'}
                    color={active ? colors.white : colors.textPrimary}
                  >
                    {quick.label}
                  </Typography>
                </TouchableOpacity>
              );
            });
          })()}
        </View>

        <TouchableOpacity
          style={styles.pickerButton}
          onPress={() => setShowDatePicker(true)}
        >
          <Typography
            variant="body"
            color={
              formData.next_due_date
                ? colors.textPrimary
                : colors.textTertiary
            }
          >
            {formatDateForDisplay(formData.next_due_date)}
          </Typography>
          <Icon
            name="calendar-outline"
            size={IconSize.md}
            color={colors.textTertiary}
          />
        </TouchableOpacity>
      </View>

      {showDatePicker && (
        <DateTimePicker
          value={formData.next_due_date || new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          minimumDate={new Date()}
          onChange={(_event, selectedDate) => {
            if (Platform.OS === 'android') {
              setShowDatePicker(false);
            }
            if (selectedDate) {
              updateField('next_due_date', selectedDate);
            }
          }}
        />
      )}
      {showDatePicker && Platform.OS === 'ios' && (
        <TouchableOpacity
          style={styles.datePickerDone}
          onPress={() => setShowDatePicker(false)}
        >
          <Typography
            variant="body"
            color={colors.primary}
            weight="semibold"
          >
            Done
          </Typography>
        </TouchableOpacity>
      )}

      <View style={dividerStyle} />

      {/* Frequency */}
      <View style={styles.formField}>
        <Typography
          variant="caption"
          color={colors.textSecondary}
          style={styles.fieldLabel}
        >
          Repeat Frequency
        </Typography>
        <TouchableOpacity
          style={styles.pickerButton}
          onPress={() => setShowFrequencyPicker(!showFrequencyPicker)}
        >
          <Typography variant="body" color={colors.textPrimary}>
            {getFrequencyLabel(formData.frequency)}
          </Typography>
          <Icon
            name="chevron-forward"
            size={IconSize.md}
            color={colors.textTertiary}
          />
        </TouchableOpacity>
      </View>

      {showFrequencyPicker && (
        <View
          style={[
            styles.pickerOptions,
            { backgroundColor: colors.backgroundMain },
          ]}
        >
          {FREQUENCIES.map(freq => (
            <TouchableOpacity
              key={freq.value}
              style={[
                styles.pickerOption,
                hairlineColor,
                formData.frequency === freq.value && activeOptionStyle,
              ]}
              onPress={() => {
                updateField('frequency', freq.value);
                setShowFrequencyPicker(false);
              }}
            >
              <Typography
                variant="body"
                color={
                  formData.frequency === freq.value
                    ? colors.primary
                    : colors.textPrimary
                }
              >
                {freq.label}
              </Typography>
              {formData.frequency === freq.value && (
                <Icon
                  name="checkmark"
                  size={IconSize.md}
                  color={colors.primary}
                />
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Custom Interval */}
      {formData.frequency === 'custom' && (
        <View style={styles.customIntervalContainer}>
          <Typography
            variant="caption"
            color={colors.textSecondary}
            style={styles.fieldLabel}
          >
            Repeat every
          </Typography>
          <View style={styles.customIntervalRow}>
            <TextInput
              style={[
                styles.customIntervalInput,
                {
                  color: colors.textPrimary,
                  backgroundColor: colors.backgroundMain,
                },
              ]}
              value={formData.custom_interval_days}
              onChangeText={text =>
                updateField('custom_interval_days', text.replace(/[^0-9]/g, ''))
              }
              keyboardType="number-pad"
              maxLength={4}
            />
            <Typography variant="body" color={colors.textSecondary}>
              days
            </Typography>
          </View>
        </View>
      )}

      <View style={dividerStyle} />

      {/* Description */}
      <View style={styles.formField}>
        <Typography
          variant="caption"
          color={colors.textSecondary}
          style={styles.fieldLabel}
        >
          Notes (Optional)
        </Typography>
        <TextInput
          style={[
            styles.textInput,
            styles.notesInput,
            { color: colors.textPrimary },
          ]}
          value={formData.description}
          onChangeText={text => updateField('description', text)}
          placeholder="Add any notes or instructions..."
          placeholderTextColor={colors.textTertiary}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
        />
      </View>

      <View style={dividerStyle} />

      {/* Reminder Settings */}
      <TaskReminderSettings
        settings={{
          reminder_enabled: formData.reminder_enabled,
          reminder_days_before: formData.reminder_days_before,
          reminder_time: formData.reminder_time,
          reminder_repeat: formData.reminder_repeat,
        }}
        onChange={(reminderSettings: ReminderSettings) => {
          onChange(reminderSettings);
        }}
        taskDueDate={formData.next_due_date}
        isEditing={isEditing}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  formField: {
    paddingVertical: Spacing.md,
  },
  fieldLabel: {
    marginBottom: Spacing.sm,
  },
  textInput: {
    ...scaledFont('buttonLabel'),
    paddingVertical: Spacing.sm,
  },
  notesInput: {
    minHeight: 80,
    paddingTop: Spacing.sm,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  pickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
  },
  pickerValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  quickDateRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  quickDateChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: CornerRadius.full,
  },
  pickerOptions: {
    borderRadius: CornerRadius.md,
    marginTop: Spacing.sm,
    marginBottom: Spacing.md,
    overflow: 'hidden',
    maxHeight: 400,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.smd,
    gap: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchInput: {
    flex: 1,
    ...scaledFont('buttonLabel'),
    paddingVertical: Spacing.xs,
  },
  pickerScrollView: {
    maxHeight: 340,
  },
  groupHeader: {
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xs,
  },
  pickerOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.base,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  noResults: {
    padding: Spacing.lg,
    alignItems: 'center',
  },
  customIntervalContainer: {
    paddingVertical: Spacing.md,
  },
  customIntervalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  customIntervalInput: {
    width: 80,
    ...scaledFont('buttonLabel'),
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: CornerRadius.sm,
    textAlign: 'center',
  },
  datePickerDone: {
    alignItems: 'flex-end',
    paddingVertical: Spacing.sm,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: CornerRadius.xs + Spacing.xxs,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  checkboxLabel: {
    flex: 1,
  },
});
