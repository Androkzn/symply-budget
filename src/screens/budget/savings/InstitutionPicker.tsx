import React, { useMemo, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { InstitutionLogo, TextInput, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, IconSize, Spacing, useAppColors } from '@theme';
import { POPULAR_INSTITUTIONS } from '@utils/institution-logos';

interface InstitutionPickerProps {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  testID?: string;
}

const MAX_RESULTS = 8;

/**
 * Searchable institution field for the registered-account form: a tappable field
 * that expands into a search box + a list of popular Canadian institutions (each
 * with a normalized brand badge), plus a "Use …" row to add any custom name.
 * Inline (not a nested modal) so it composes inside the account-form sheet. Purely
 * a value picker — it stores the chosen name as a plain string.
 */
export function InstitutionPicker({
  value,
  onChange,
  label = 'Institution (optional)',
  testID = 'institution-picker',
}: InstitutionPickerProps) {
  const colors = useAppColors();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const trimmed = query.trim();
  const filtered = useMemo(() => {
    const q = trimmed.toLowerCase();
    const list = q
      ? POPULAR_INSTITUTIONS.filter((i) => i.name.toLowerCase().includes(q))
      : POPULAR_INSTITUTIONS;
    return list.slice(0, MAX_RESULTS);
  }, [trimmed]);

  const exactMatch = POPULAR_INSTITUTIONS.some(
    (i) => i.name.toLowerCase() === trimmed.toLowerCase()
  );
  const canAddCustom = trimmed.length > 0 && !exactMatch;

  const select = (name: string) => {
    onChange(name);
    setQuery('');
    setOpen(false);
  };

  return (
    <View testID={testID}>
      <Typography variant="caption1" color={colors.textSecondary} style={styles.label}>
        {label}
      </Typography>

      <TouchableOpacity
        style={[styles.field, { borderColor: colors.borderColor, backgroundColor: colors.inputFieldBackground }]}
        onPress={() => setOpen((o) => !o)}
        activeOpacity={0.7}
        testID={`${testID}-field`}
      >
        {value ? (
          <View style={styles.valueRow}>
            <InstitutionLogo name={value} size={24} />
            <Typography variant="body" color={colors.textPrimary}>
              {value}
            </Typography>
          </View>
        ) : (
          <Typography variant="body" color={colors.textTertiary}>
            Select or search…
          </Typography>
        )}
        <View style={styles.fieldRight}>
          {value ? (
            <TouchableOpacity onPress={() => onChange('')} hitSlop={8} testID={`${testID}-clear`}>
              <Icon name="close-circle" size={IconSize.sm} color={colors.textTertiary} />
            </TouchableOpacity>
          ) : null}
          <Icon
            name={open ? 'chevron-up' : 'chevron-down'}
            size={IconSize.sm}
            color={colors.textSecondary}
          />
        </View>
      </TouchableOpacity>

      {open && (
        <View style={[styles.panel, { borderColor: colors.borderColor, backgroundColor: colors.cardBackground }]}>
          <TextInput
            placeholder="Search institutions…"
            value={query}
            onChangeText={setQuery}
            autoFocus
            autoCorrect={false}
            autoCapitalize="words"
            testID={`${testID}-search`}
          />

          {canAddCustom && (
            <TouchableOpacity
              style={styles.row}
              onPress={() => select(trimmed)}
              testID={`${testID}-add-custom`}
            >
              <InstitutionLogo name={trimmed} size={24} />
              <Typography variant="body" weight="semibold" color={colors.primary}>
                Use “{trimmed}”
              </Typography>
            </TouchableOpacity>
          )}

          {filtered.map((inst) => (
            <TouchableOpacity
              key={inst.name}
              style={styles.row}
              onPress={() => select(inst.name)}
              testID={`${testID}-option-${inst.name}`}
            >
              <InstitutionLogo name={inst.name} size={24} />
              <Typography variant="body" color={colors.textPrimary}>
                {inst.name}
              </Typography>
            </TouchableOpacity>
          ))}

          {filtered.length === 0 && !canAddCustom && (
            <Typography variant="caption1" color={colors.textTertiary} style={styles.empty}>
              No matches
            </Typography>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { marginBottom: Spacing.xs },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: CornerRadius.md,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.md,
    minHeight: 52,
  },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flex: 1 },
  fieldRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  panel: {
    marginTop: Spacing.sm,
    borderWidth: 1,
    borderRadius: CornerRadius.md,
    padding: Spacing.sm,
    gap: Spacing.xxs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xs,
  },
  empty: { padding: Spacing.sm },
});
