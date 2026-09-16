import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { mortgageApi, type UpdateMortgageRequest } from '@api/mortgage';
import { AppBackground, SafeAreaView, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { Button, Card, TextInput, Toggle, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import type { BudgetStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { useMortgageStore } from '@stores/mortgageStore';
import { Spacing, useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';

import { LenderPicker } from './LenderPicker';

/**
 * Edit an existing property's editable fields — name, lender, property address,
 * current home value (for appreciation equity) and its active flag. The
 * financial structure (principal, amortization, rate, term) is fixed at setup /
 * renewal, so it isn't editable here; those flows own it. Saving PATCHes only
 * the changed shape and bumps `dataRevision` so the dashboard reloads.
 */
export function MortgageEditScreen() {
  const colors = useAppColors();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<BudgetStackParamList, 'MortgageEdit'>>();
  const mortgageId = route.params?.mortgageId;
  const { currentHousehold } = useHouseholdStore();
  const { selectedMortgageId, setSelectedMortgage, markDirty } = useMortgageStore();

  const [loading, setLoading] = useState(true);
  const [nickname, setNickname] = useState('');
  const [lender, setLender] = useState('');
  const [propertyAddress, setPropertyAddress] = useState('');
  const [homeValue, setHomeValue] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!currentHousehold?.id || !mortgageId) {
        setLoading(false);
        return;
      }
      try {
        const m = await mortgageApi.get(currentHousehold.id, mortgageId);
        if (cancelled) return;
        setNickname(m.nickname);
        setLender(m.lender ?? '');
        setPropertyAddress(m.property_address ?? '');
        setHomeValue(
          m.current_home_value_cents != null ? String(Math.round(m.current_home_value_cents / 100)) : ''
        );
        setIsActive(m.is_active);
      } catch {
        if (!cancelled) setError('Could not load this property.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentHousehold?.id, mortgageId]);

  const onSave = async () => {
    setError(null);
    if (!nickname.trim()) return setError('Give your property a name.');
    if (!currentHousehold?.id || !mortgageId) return setError('Missing property.');

    const homeValueNum = parseFloat(homeValue);
    const body: UpdateMortgageRequest = {
      nickname: nickname.trim(),
      lender: lender.trim() || null,
      propertyAddress: propertyAddress.trim() || null,
      currentHomeValueCents: homeValueNum > 0 ? Math.round(homeValueNum * 100) : null,
      isActive,
    };

    setSaving(true);
    try {
      await mortgageApi.update(currentHousehold.id, mortgageId, body);
      markDirty();
      navigation.goBack();
    } catch {
      setError('Could not save your changes. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const onDelete = () => {
    Alert.alert(
      'Delete property?',
      `“${nickname.trim() || 'This property'}” and all of its statements, terms and history will be permanently removed. This can’t be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (!currentHousehold?.id || !mortgageId) return;
            try {
              await mortgageApi.remove(currentHousehold.id, mortgageId);
              if (selectedMortgageId === mortgageId) setSelectedMortgage(null);
              markDirty();
              navigation.goBack();
            } catch {
              Alert.alert('Error', 'Could not delete this property. Please try again.');
            }
          },
        },
      ]
    );
  };

  return (
    <AppBackground>
    <SafeAreaView style={styles.safe} edges={[]} testID="mortgage-edit-screen">
      <ScreenHeader
        title="Edit property"
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
        showPropertySwitcher={false}
      />
      {loading ? (
        <View style={styles.center} testID="mortgage-edit-loading">
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          style={screenScrollViewStyle.scroll}
          contentContainerStyle={styles.body}
          {...keyboardDismissScrollProps}
        >
          <TextInput label="Name" placeholder="Main home" value={nickname} onChangeText={setNickname} testID="mortgage-edit-nickname" />
          <LenderPicker value={lender} onChange={setLender} testID="mortgage-edit-lender" />
          <TextInput
            label="Property address (optional)"
            placeholder="123 Main St"
            value={propertyAddress}
            onChangeText={setPropertyAddress}
            testID="mortgage-edit-address"
          />
          <TextInput
            label="Current home value ($, optional)"
            placeholder="750000"
            keyboardType="decimal-pad"
            value={homeValue}
            onChangeText={setHomeValue}
            testID="mortgage-edit-home-value"
          />
          <Typography variant="caption" color={colors.textSecondary}>
            Used to show appreciation in your equity breakdown.
          </Typography>

          <Card variant="filled" style={styles.toggleRow}>
            <View style={styles.toggleText}>
              <Typography variant="body" weight="medium">
                Active
              </Typography>
              <Typography variant="caption" color={colors.textSecondary}>
                Inactive properties stay saved but drop below active ones.
              </Typography>
            </View>
            <Toggle value={isActive} onValueChange={setIsActive} testID="mortgage-edit-active" />
          </Card>

          {error ? (
            <Typography variant="caption" color={colors.error}>
              {error}
            </Typography>
          ) : null}

          <Button
            title={saving ? 'Saving…' : 'Save changes'}
            onPress={onSave}
            disabled={saving}
            testID="mortgage-edit-save"
          />

          <View style={[styles.divider, { backgroundColor: colors.divider }]} />

          <Button
            title="Delete this property"
            variant="ghost"
            textColor={colors.destructive}
            onPress={onDelete}
            testID="mortgage-edit-delete"
          />
        </ScrollView>
      )}
    </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: 140 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.base,
  },
  toggleText: { flex: 1, gap: Spacing.xxs },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: Spacing.md },
});
