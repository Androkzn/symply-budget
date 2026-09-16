import { Picker } from '@react-native-picker/picker';
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@contexts/ThemeContext';
import { Spacing, useAppColors } from '@theme';

import { BottomSheet } from './BottomSheet';
import { Icon } from './Icon';
import { Typography } from './Typography';

export interface OptionWheelPickerOption<T extends string> {
  key: T;
  label: string;
  /** Shown below the wheel, live, for whichever option is currently highlighted. */
  description?: string;
  /** Rendered next to `description` — an Ionicons/brand-kit glyph name. */
  icon?: string;
}

interface OptionWheelPickerSheetProps<T extends string> {
  visible: boolean;
  title: string;
  options: OptionWheelPickerOption<T>[];
  value: T;
  onConfirm: (value: T) => void;
  onClose: () => void;
  testID?: string;
}

/**
 * A native wheel (bottom sheet + `Picker`) for a small fixed set of string
 * choices — the enum counterpart to `NumberWheelPickerSheet`. No "Enter
 * manually" escape hatch: unlike a numeric range, there is no value outside
 * the option list to type.
 */
export function OptionWheelPickerSheet<T extends string>({
  visible,
  title,
  options,
  value,
  onConfirm,
  onClose,
  testID = 'option-wheel-picker',
}: OptionWheelPickerSheetProps<T>) {
  const colors = useAppColors();
  const { isDark } = useTheme();

  const [draft, setDraft] = useState<T>(value);

  useEffect(() => {
    if (visible) setDraft(value);
  }, [visible, value]);

  const handleDone = () => {
    onConfirm(draft);
    onClose();
  };

  const draftOption = options.find((option) => option.key === draft);
  const hasDescriptions = options.some((option) => option.description);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      height="standard"
      noPadding
      title={title}
      showCloseButton
      headerAction={{ label: 'Done', onPress: handleDone, testID: `${testID}-done` }}
    >
      <View style={[styles.body, { backgroundColor: colors.backgroundMain }]}>
        <Picker
          selectedValue={draft}
          onValueChange={(picked) => setDraft(picked as T)}
          itemStyle={styles.pickerItem}
          testID={testID}
        >
          {options.map((option) => (
            <Picker.Item
              key={option.key}
              value={option.key}
              label={option.label}
              color={isDark ? colors.textPrimary : undefined}
            />
          ))}
        </Picker>
        {hasDescriptions && draftOption ? (
          <View
            testID={`${testID}-description`}
            style={[
              styles.descriptionRow,
              { borderTopColor: colors.borderColor, backgroundColor: colors.backgroundMain },
            ]}
          >
            {draftOption.icon ? (
              <View style={[styles.descriptionIcon, { backgroundColor: colors.groupedListBackground }]}>
                <Icon name={draftOption.icon} size={20} color={colors.primary} />
              </View>
            ) : null}
            {draftOption.description ? (
              <Typography variant="footnote" color={colors.textSecondary} style={styles.descriptionText}>
                {draftOption.description}
              </Typography>
            ) : null}
          </View>
        ) : null}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    paddingHorizontal: Spacing.base,
  },
  pickerItem: {
    fontSize: 22,
  },
  descriptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  descriptionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  descriptionText: {
    flex: 1,
  },
});
