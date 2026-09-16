import React, { useMemo, useState } from 'react';
import {
  View,
  Modal,
  StyleSheet,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Typography, Button, Card } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { useDeviceType } from '@hooks/useDeviceType';
import { useKeyboardInset } from '@hooks/useKeyboardInset';
import { Avatar, CornerRadius, IconSize, Layout, Spacing, TypographyTokens, useAppColors } from '@theme';
import { numericTextHandler } from '@utils/keyboard';

type FrequencyType = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom';

interface FrequencyOption {
  id: FrequencyType;
  label: string;
  days?: number;
}

const FREQUENCY_OPTIONS: FrequencyOption[] = [
  { id: 'daily', label: 'Daily', days: 1 },
  { id: 'weekly', label: 'Weekly', days: 7 },
  { id: 'monthly', label: 'Monthly', days: 30 },
  { id: 'quarterly', label: 'Quarterly', days: 90 },
  { id: 'yearly', label: 'Yearly', days: 365 },
  { id: 'custom', label: 'Custom' },
];

interface CustomFrequencyPickerProps {
  visible: boolean;
  currentFrequency: FrequencyType;
  customDays?: number;
  onClose: () => void;
  onSelect: (frequency: FrequencyType, customDays?: number) => void;
}

function primaryFill15(primary: string) {
  if (primary.startsWith('#') && primary.length === 7) return `${primary}15`;
  return primary;
}

export function CustomFrequencyPicker({
  visible,
  currentFrequency,
  customDays,
  onClose,
  onSelect,
}: CustomFrequencyPickerProps) {  const colors = useAppColors();
  const { isIPad, width, height: windowHeight } = useDeviceType();
  const useCenteredSheet = isIPad && width >= Layout.sidebarBreakpoint;
  const insets = useSafeAreaInsets();
  // The sheet is anchored to the bottom edge, so the keypad opened by "Repeat
  // every … days" lands on top of the very field that summoned it. Lift the
  // sheet by the inset and cap its height against what is LEFT above the
  // keyboard, so a short phone doesn't push it off the top instead.
  const keyboardInset = useKeyboardInset();
  const contentMaxHeight = windowHeight - keyboardInset - insets.top - Spacing.xxl;
  const styles = useMemo(
    () =>
      StyleSheet.create({
        overlay: {
          flex: 1,
          backgroundColor: colors.modalBackdrop,
          justifyContent: 'flex-end',
        },
        overlayCentered: {
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: Spacing.xl,
        },
        modal: {
          borderTopLeftRadius: CornerRadius.listItem,
          borderTopRightRadius: CornerRadius.listItem,
          padding: Layout.pageMargin,
          maxHeight: '80%' as const,
        },
        modalCentered: {
          width: '100%' as const,
          maxWidth: Layout.formSheetWidth,
          borderRadius: CornerRadius.xl,
          maxHeight: '78%' as const,
        },
        header: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: Spacing.lg,
        },
        closeButton: {
          width: Avatar.inlineSize,
          height: Avatar.inlineSize,
          alignItems: 'center',
          justifyContent: 'center',
        },
        options: {
          marginBottom: Spacing.lg,
        },
        option: {
          flexDirection: 'row',
          alignItems: 'center',
          padding: Spacing.base,
          borderRadius: CornerRadius.md,
          borderWidth: 1,
          marginBottom: Spacing.sm,
        },
        checkmark: {
          marginLeft: 'auto' as const,
          width: Spacing.xl,
          height: Spacing.xl,
          borderRadius: Spacing.xl / 2,
          alignItems: 'center',
          justifyContent: 'center',
        },
        customInputContainer: {
          marginBottom: Spacing.lg,
          padding: Spacing.base,
          borderRadius: CornerRadius.md,
        },
        customLabel: {
          marginBottom: Spacing.md,
        },
        customInputRow: {
          flexDirection: 'row',
          alignItems: 'center',
        },
        customInput: {
          width: 100,
          height: Avatar.memberListSize,
          borderWidth: 1,
          borderRadius: CornerRadius.sm,
          paddingHorizontal: Spacing.base,
          fontSize: TypographyTokens.bodyLarge.size,
          lineHeight: TypographyTokens.bodyLarge.lineHeight,
          textAlign: 'center',
        },
        daysLabel: {
          marginLeft: Spacing.md,
        },
        customHint: {
          marginTop: Spacing.sm,
        },
        actions: {
          flexDirection: 'row',
          gap: Spacing.md,
        },
        actionButton: {
          flex: 1,
        },
      }),
    [colors.modalBackdrop]
  );

  const [selectedFrequency, setSelectedFrequency] = useState<FrequencyType>(currentFrequency);
  const [customDaysInput, setCustomDaysInput] = useState(customDays?.toString() || '');
  const [showCustomInput, setShowCustomInput] = useState(currentFrequency === 'custom');

  const handleOptionPress = (option: FrequencyOption) => {
    setSelectedFrequency(option.id);
    setShowCustomInput(option.id === 'custom');

    if (option.id !== 'custom') {
      setCustomDaysInput('');
    }
  };

  const handleConfirm = () => {
    if (selectedFrequency === 'custom') {
      const days = parseInt(customDaysInput, 10);
      if (isNaN(days) || days < 1) {
        return;
      }
      onSelect('custom', days);
    } else {
      onSelect(selectedFrequency);
    }
    onClose();
  };

  const isValid = () => {
    if (selectedFrequency !== 'custom') return true;
    const days = parseInt(customDaysInput, 10);
    return !isNaN(days) && days >= 1;
  };

  return (
    <Modal
      visible={visible}
      animationType={useCenteredSheet ? 'fade' : 'slide'}
      transparent
      onRequestClose={onClose}
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
          <View style={styles.header}>
            <Typography variant="headline" weight="semibold">
              Repeat Frequency
            </Typography>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Icon name="close" size={IconSize.md} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <View style={styles.options}>
            {FREQUENCY_OPTIONS.map((option) => {
              const isSelected = selectedFrequency === option.id;
              return (
                <TouchableOpacity
                  key={option.id}
                  style={[
                    styles.option,
                    {
                      backgroundColor: isSelected
                        ? primaryFill15(colors.primary)
                        : colors.backgroundSecondary,
                      borderColor: isSelected ? colors.primary : colors.borderColor,
                    },
                  ]}
                  onPress={() => handleOptionPress(option)}
                >
                  <Typography
                    variant="body"
                    weight={isSelected ? 'semibold' : 'regular'}
                    color={isSelected ? colors.primary : colors.textPrimary}
                  >
                    {option.label}
                  </Typography>
                  {option.days && (
                    <Typography variant="footnote" color={colors.textSecondary}>
                      Every {option.days} {option.days === 1 ? 'day' : 'days'}
                    </Typography>
                  )}
                  {isSelected && (
                    <View
                      style={[styles.checkmark, { backgroundColor: colors.primary }]}
                    >
                      <Icon name="checkmark" size={IconSize.sm} color={colors.white} />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {showCustomInput && (
            <View
              style={[styles.customInputContainer, { backgroundColor: colors.cardSubtle }]}
            >
              <Typography variant="subheadline" weight="medium" style={styles.customLabel}>
                Repeat every
              </Typography>
              <View style={styles.customInputRow}>
                <TextInput
                  style={[
                    styles.customInput,
                    {
                      backgroundColor: colors.backgroundSecondary,
                      color: colors.textPrimary,
                      borderColor: colors.borderColor,
                    },
                  ]}
                  placeholder="30"
                  placeholderTextColor={colors.textTertiary}
                  value={customDaysInput}
                  onChangeText={numericTextHandler(setCustomDaysInput)}
                  keyboardType="number-pad"
                  maxLength={4}
                />
                <Typography variant="body" style={styles.daysLabel}>
                  days
                </Typography>
              </View>
              <Typography
                variant="footnote"
                color={colors.textSecondary}
                style={styles.customHint}
              >
                Enter a number between 1 and 9999
              </Typography>
            </View>
          )}

          <View style={styles.actions}>
            <View style={styles.actionButton}>
              <Button
                title="Cancel"
                variant="secondary"
                size="md"
                onPress={onClose}
                fullWidth
              />
            </View>
            <View style={styles.actionButton}>
              <Button
                title="Confirm"
                variant="primary"
                size="md"
                onPress={handleConfirm}
                disabled={!isValid()}
                fullWidth
              />
            </View>
          </View>
        </Card>
      </View>
    </Modal>
  );
}

export default CustomFrequencyPicker;
