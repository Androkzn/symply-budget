import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as DocumentPicker from 'expo-document-picker';
import { useNavigation, useRoute, type RouteProp } from 'expo-router/react-navigation';
import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

import { budgetApi, type SuggestedSpending } from '@api/budget';
import { AIAccessGate } from '@components/ai/AIAccessGate';
import { CloudFilePicker } from '@components/cloud-storage';
import { AppBackground, SafeAreaView, ScanImportSources, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { GradientButton, TextInput, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { useTheme } from '@contexts/ThemeContext';
import { budgetLocalUnsupportedCopyFromError } from '@features/budget/local/ai/localAiUnsupported';
import { useIsScrollableFormSheet } from '@navigation/presentation';
import type { BudgetStackParamList } from '@navigation/types';
import ImageCropPicker from '@services/image-picker-compat';
import { useBudgetStore } from '@stores/budgetStore';
import { useHouseholdStore } from '@stores/householdStore';
import { useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';
import { formatMoney, useDisplayCurrency } from '@utils/money';
import { isPickerPermissionError, presentPickerPermissionDeniedAlert } from '@utils/pickerPermissionAlert';
import { toVisionSafeAttachment } from '@utils/visionSafeAttachment';

import { budgetPriorityColor } from './budgetFormat';
import { resolveReceiptExpenseDate } from './budgetQuickAddHelpers';


type Nav = NativeStackNavigationProp<BudgetStackParamList, 'BudgetItemAI'>;
type AIRoute = RouteProp<BudgetStackParamList, 'BudgetItemAI'>;

const BUDGET_ATTACHMENT_MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

interface Attachment {
  uri: string;
  name: string;
  type: string;
}

function formatRange(min: number | null, max: number | null): string {
  const f = (c: number) => formatMoney(c);
  if (min == null && max == null) return 'No estimate';
  if (max == null || min === max) return f((min ?? max) as number);
  return `${f(min as number)}–${f(max)}`;
}

function whenLabel(s: SuggestedSpending): string {
  if (!s.scheduled || !s.target_date) return 'Anytime';
  // target_date is a 'YYYY-MM-DD' string — parse its parts in local time so the
  // label doesn't show a day early west of UTC (new Date('YYYY-MM-DD') is UTC).
  const [y, m, day] = s.target_date.slice(0, 10).split('-').map(Number);
  const d = new Date(y, (m || 1) - 1, day || 1);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function guessMimeType(name: string, fallback = 'application/pdf'): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return fallback;
}

interface Draft extends SuggestedSpending {
  include: boolean;
}

export function BudgetItemAIScreen() {
  // Re-render amounts when Settings → Currency changes.
  useDisplayCurrency();
  const { theme } = useTheme();
  const colors = useAppColors();
  // Page sheet on iPhone, full-screen modal on iPad — the header pads for the
  // status bar only in the second case. Derived, never hardcoded (see the hook).
  const insideSheet = useIsScrollableFormSheet();
  const navigation = useNavigation<Nav>();
  const route = useRoute<AIRoute>();
  // Which list opened this flow: 'planned' → create planned budget items,
  // 'spent' → record expenses. Planning and Spending are separate entities
  // (createItem vs addExpense), so a spending-origin add must NOT create a
  // planned item — it would land in the wrong tab and look like nothing saved.
  const kind = route.params?.kind ?? 'planned';
  const { currentHousehold } = useHouseholdStore();
  const { selectedYear, selectedMonth, markInsightsDirty } = useBudgetStore();

  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [showDrivePicker, setShowDrivePicker] = useState(false);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const canGenerate = Boolean(text.trim() || attachment);

  const handleGenerate = async () => {
    if (!currentHousehold?.id || !canGenerate) return;
    setIsGenerating(true);
    setDrafts(null);
    try {
      const requestBase = { year: selectedYear, month: selectedMonth };
      const { suggestions } = attachment
        ? await budgetApi.aiDetectItemsWithFile(currentHousehold.id, {
            ...requestBase,
            text: text.trim() || undefined,
            file: await toVisionSafeAttachment(attachment),
          })
        : await budgetApi.aiDetectItems(currentHousehold.id, {
            ...requestBase,
            text: text.trim(),
          });

      if (suggestions.length === 0) {
        Alert.alert(
          'Nothing found',
          'Try describing the spending with an amount or name, or attach a clearer receipt or quote.'
        );
      }
      setDrafts(suggestions.map((s) => ({ ...s, include: true })));
    } catch (error) {
      console.error('Error detecting spendings:', error);
      const offlineCopy = budgetLocalUnsupportedCopyFromError(error, 'ai-detect');
      Alert.alert(
        offlineCopy?.title ?? 'Error',
        offlineCopy?.message ?? 'Could not read that. Please try again.',
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePickFromCamera = async () => {
    try {
      const image = await ImageCropPicker.openCamera({
        cropping: false,
        compressImageQuality: 0.8,
        mediaType: 'photo',
      });
      setAttachment({
        uri: image.path,
        name: image.filename || 'photo.jpg',
        type: image.mime || 'image/jpeg',
      });
    } catch (error: unknown) {
      if (isPickerPermissionError(error)) {
        presentPickerPermissionDeniedAlert('camera');
      } else if ((error as { code?: string }).code !== 'E_PICKER_CANCELLED') {
        console.error('Error opening camera:', error);
        Alert.alert('Error', 'Could not open the camera.');
      }
    }
  };

  const handlePickFromGallery = async () => {
    try {
      const image = await ImageCropPicker.openPicker({
        cropping: false,
        compressImageQuality: 0.8,
        mediaType: 'photo',
      });
      setAttachment({
        uri: image.path,
        name: image.filename || 'photo.jpg',
        type: image.mime || 'image/jpeg',
      });
    } catch (error: unknown) {
      if (isPickerPermissionError(error)) {
        presentPickerPermissionDeniedAlert('library');
      } else if ((error as { code?: string }).code !== 'E_PICKER_CANCELLED') {
        console.error('Error picking image:', error);
        Alert.alert('Error', 'Could not open the photo library.');
      }
    }
  };

  const handleUploadFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [...BUDGET_ATTACHMENT_MIMES],
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        setAttachment({
          uri: asset.uri,
          name: asset.name || 'attachment',
          type: asset.mimeType || guessMimeType(asset.name || ''),
        });
      }
    } catch (error) {
      console.error('Error picking file:', error);
      Alert.alert('Error', 'Could not open the file picker.');
    }
  };

  const handleDriveFileSelected = (file: { uri: string; name: string; size: number }) => {
    setShowDrivePicker(false);
    setAttachment({
      uri: file.uri,
      name: file.name || 'drive-file',
      type: guessMimeType(file.name || ''),
    });
  };

  const toggle = (index: number) =>
    setDrafts((prev) =>
      prev ? prev.map((d, i) => (i === index ? { ...d, include: !d.include } : d)) : prev
    );

  const selected = drafts?.filter((d) => d.include) ?? [];

  const handleAdd = async () => {
    if (!currentHousehold?.id || selected.length === 0) return;
    setIsSaving(true);
    try {
      for (const s of selected) {
        if (kind === 'spent') {
          // Record an expense so the row shows up in the Spending tab (which
          // reads overview.expenses, not planned items). The estimate becomes
          // the amount; the date is honored only when it's a valid recent date,
          // otherwise it falls back to the month being viewed.
          await budgetApi.addExpense(currentHousehold.id, {
            title: s.title,
            description: s.description ?? undefined,
            category_id: s.category_id ?? undefined,
            amount: s.estimated_cost_max ?? s.estimated_cost_min ?? 0,
            expense_date: resolveReceiptExpenseDate(s.target_date, selectedYear, selectedMonth),
          });
        } else {
          await budgetApi.createItem(currentHousehold.id, {
            title: s.title,
            description: s.description ?? undefined,
            category_id: s.category_id ?? undefined,
            timeframe: 'immediate',
            priority: s.priority,
            estimated_cost_min: s.estimated_cost_min ?? undefined,
            estimated_cost_max: s.estimated_cost_max ?? undefined,
            is_recurring: s.is_recurring,
            recurrence_frequency: s.recurrence_frequency ?? undefined,
            ...(s.scheduled && s.target_date ? { target_date: s.target_date } : {}),
          });
        }
      }
      markInsightsDirty(currentHousehold.id);
      navigation.goBack();
    } catch (error) {
      console.error('Error saving spendings:', error);
      Alert.alert('Error', 'Could not save these spendings. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AIAccessGate title="Unlock AI for budget">
    <AppBackground>
    <SafeAreaView edges={[]} testID="budget-item-ai">
      <ScreenHeader
        title="Add with AI"
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
        showPropertySwitcher={false}
        insideSheet={insideSheet}
      />
      {/* No KeyboardAvoidingView: it only SHRINKS the viewport, it never scrolls
          the focused field back into view, and stacked on
          `automaticallyAdjustKeyboardInsets` it double-counts the keyboard.
          `keyboardDismissScrollProps` is the half that actually reveals the
          field — see `@utils/keyboard`. */}
      <ScrollView
        {...keyboardDismissScrollProps}
        style={[screenScrollViewStyle.scroll, styles.flex]}
        contentContainerStyle={styles.content}
      >
        <View style={styles.attachSection}>
          <Typography variant="caption1" weight="medium" color={colors.textSecondary}>
            Attach a receipt, invoice, or quote
          </Typography>
          <ScanImportSources
            testIDPrefix="budget-item-ai"
            disabled={isGenerating}
            onCamera={handlePickFromCamera}
            onGallery={handlePickFromGallery}
            onFile={handleUploadFile}
            onDrive={() => setShowDrivePicker(true)}
          />
          {attachment && (
            <View
              style={[
                styles.attachmentChip,
                { backgroundColor: colors.backgroundSecondary, borderColor: theme.pastel.teal },
              ]}
            >
              <Icon name="document-attach-outline" size={18} color={theme.pastel.teal} />
              <Typography variant="caption1" weight="medium" style={styles.attachmentName} numberOfLines={1}>
                {attachment.name}
              </Typography>
              <TouchableOpacity
                onPress={() => setAttachment(null)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                testID="budget-item-ai-remove-attachment"
              >
                <Icon name="close-circle" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          )}
        </View>

        <TextInput
          testID="budget-item-ai-input"
          label="Describe your spending"
          placeholder="e.g. Replace the water heater, about $2k next month. Also Netflix $16/mo."
          value={text}
          onChangeText={setText}
          multiline
          numberOfLines={4}
          style={styles.multiline}
        />

        <GradientButton
          title="Generate"
          variant="blue"
          onPress={handleGenerate}
          disabled={isGenerating || !canGenerate}
          loading={isGenerating}
          fullWidth
          testID="budget-item-ai-generate"
        />

        {drafts && drafts.length > 0 && (
          <>
            <Typography variant="caption1" color={colors.textSecondary} style={styles.reviewLabel}>
              Review and tap to include
            </Typography>
            {drafts.map((d, i) => {
              const pColor = budgetPriorityColor(colors, d.priority);
              return (
                <TouchableOpacity
                  key={`${d.title}-${i}`}
                  activeOpacity={0.8}
                  onPress={() => toggle(i)}
                  style={[
                    styles.card,
                    {
                      backgroundColor: colors.backgroundSecondary,
                      borderColor: d.include ? theme.pastel.teal : colors.borderColor,
                    },
                  ]}
                >
                  <View style={styles.cardTop}>
                    <View
                      style={[
                        styles.check,
                        {
                          borderColor: d.include ? theme.pastel.teal : colors.borderColor,
                          backgroundColor: d.include ? theme.pastel.teal : 'transparent',
                        },
                      ]}
                    >
                      {d.include && <Icon name="checkmark" size={14} color={colors.white} />}
                    </View>
                    <Typography variant="body" weight="semibold" style={styles.cardTitle} numberOfLines={2}>
                      {d.title}
                    </Typography>
                    <Typography variant="subheadline" weight="semibold">
                      {formatRange(d.estimated_cost_min, d.estimated_cost_max)}
                    </Typography>
                  </View>
                  <View style={styles.tagRow}>
                    <View style={[styles.tag, { borderColor: pColor }]}>
                      <Typography variant="caption2" weight="semibold" color={pColor}>
                        {d.priority}
                      </Typography>
                    </View>
                    <View style={[styles.tag, { borderColor: colors.borderColor }]}>
                      <Typography variant="caption2" color={colors.textSecondary}>
                        {whenLabel(d)}
                        {d.is_recurring ? ` · ${d.recurrence_frequency ?? 'recurring'}` : ''}
                      </Typography>
                    </View>
                    {!!d.category_name && (
                      <View style={[styles.tag, { borderColor: colors.borderColor }]}>
                        <Typography variant="caption2" color={colors.textSecondary}>
                          {d.category_name}
                        </Typography>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}

            <GradientButton
              title={
                isSaving
                  ? 'Adding…'
                  : selected.length > 0
                    ? `Add ${selected.length} spending${selected.length > 1 ? 's' : ''}`
                    : 'Select at least one'
              }
              variant="blue"
              onPress={handleAdd}
              disabled={isSaving || selected.length === 0}
              fullWidth
              style={styles.addButton}
            />
          </>
        )}
      </ScrollView>

      <CloudFilePicker
        visible={showDrivePicker}
        provider="google-drive"
        mimeTypeFilter={[...BUDGET_ATTACHMENT_MIMES]}
        rememberScope="budget-ai"
        onClose={() => setShowDrivePicker(false)}
        onFileSelected={handleDriveFileSelected}
      />
    </SafeAreaView>
    </AppBackground>
    </AIAccessGate>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, paddingBottom: 40, gap: 16 },
  multiline: { minHeight: 100, textAlignVertical: 'top' },
  attachSection: { gap: 10 },
  attachmentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  attachmentName: { flex: 1 },
  reviewLabel: { marginTop: 4, marginBottom: -4 },
  card: {
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 14,
    gap: 10,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { flex: 1 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingLeft: 32 },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
  },
  addButton: { marginTop: 4 },
});
