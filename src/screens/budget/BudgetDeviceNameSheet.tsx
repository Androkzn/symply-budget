import React, { useEffect, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { BottomSheet, GradientButton, TextInput, Typography } from '@components/ui';
import { DEVICE_NAME_MAX_LENGTH, normalizeDeviceName } from '@features/budget/local/deviceName';
import { Spacing, useAppColors } from '@theme';

interface Props {
  visible: boolean;
  /** Current name of this device (override, or the OS suggestion). */
  value: string;
  /** What the phone calls itself — offered as a one-tap fill. */
  suggestion: string;
  onClose: () => void;
  onSave: (name: string) => void | Promise<void>;
}

/**
 * Rename this device, from Device Sync.
 *
 * Named devices are the whole point of the trusted-device list: "Revoke
 * dev_652de89b0240" is a decision nobody can make. The OS name is pre-filled,
 * so the common path is open → Save, and typing is only for households where
 * two phones answer to the same name.
 */
export function BudgetDeviceNameSheet({ visible, value, suggestion, onClose, onSave }: Props) {
  const colors = useAppColors();
  const [name, setName] = useState(value);
  const [saving, setSaving] = useState(false);

  // Re-seed each time it opens — the sheet outlives one edit.
  useEffect(() => {
    if (visible) setName(value);
  }, [visible, value]);

  const save = async () => {
    setSaving(true);
    try {
      await onSave(normalizeDeviceName(name));
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const canUseSuggestion = normalizeDeviceName(name) !== normalizeDeviceName(suggestion);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Name this device"
      height="content"
      showCloseButton
    >
      <View style={styles.body}>
        <Typography variant="caption1" color={colors.textSecondary}>
          Everyone in your household sees this name in their device list. It is stored with your
          household, never shown outside it.
        </Typography>

        <TextInput
          testID="budget-device-name-input"
          label="Device name"
          placeholder={suggestion}
          value={name}
          onChangeText={setName}
          maxLength={DEVICE_NAME_MAX_LENGTH}
          autoFocus
          autoCapitalize="words"
          returnKeyType="done"
          onSubmitEditing={() => void save()}
        />

        {canUseSuggestion ? (
          <TouchableOpacity
            onPress={() => setName(suggestion)}
            testID="budget-device-name-use-suggestion"
            style={[styles.suggestion, { borderColor: colors.borderColor }]}
          >
            <Typography variant="caption1" color={colors.primary}>
              Use “{suggestion}”
            </Typography>
          </TouchableOpacity>
        ) : null}

        <GradientButton
          title={saving ? 'Saving…' : 'Save'}
          disabled={saving}
          fullWidth
          onPress={() => void save()}
          testID="budget-device-name-save"
        />
        <Typography variant="caption2" color={colors.textSecondary} style={styles.hint}>
          Leave it empty to go back to the name your phone uses.
        </Typography>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: Spacing.base, paddingBottom: Spacing.lg },
  suggestion: {
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.xs,
  },
  hint: { textAlign: 'center' },
});
