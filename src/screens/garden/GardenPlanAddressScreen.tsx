import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import { useNavigation, useRoute } from 'expo-router/react-navigation';
import type { RouteProp } from 'expo-router/react-navigation';
import React, { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { gardenPlansApi, type GardenPlanAddressInput } from '@api/garden-plans';
import type { Household } from '@api/households';
import { AppBackground, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { HousePropertyPhoto } from '@components/house-v2/HousePropertyPhoto';
import { AdaptiveContainer } from '@components/layout';
import { Typography, GradientButton, Card } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import type { GardeningStackParamList } from '@navigation/types';
import { navigateToHouseholds } from '@services/navigation';
import { showToast } from '@services/toastManager';
import { useHouseholdStore } from '@stores/householdStore';
import {Spacing, CornerRadius, Layout, useAppColors } from '@theme';

type Nav = NativeStackNavigationProp<
  GardeningStackParamList,
  'GardenPlanAddress'
>;
type Route = RouteProp<GardeningStackParamList, 'GardenPlanAddress'>;

export function GardenPlanAddressScreen() {
  const colors = useAppColors();
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();  const insets = useSafeAreaInsets();
  const { currentHousehold, households, setCurrentHousehold } =
    useHouseholdStore();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const selectableHouseholds = useMemo(
    () => households.filter(isSelectableHouse),
    [households],
  );
  const [selectedHouseholdId, setSelectedHouseholdId] = useState<string | null>(
    () =>
      pickInitialHousehold(
        selectableHouseholds,
        currentHousehold,
        route.params?.initialAddressLine1,
      )?.id ?? null,
  );

  useEffect(() => {
    if (selectableHouseholds.some(h => h.id === selectedHouseholdId)) return;

    setSelectedHouseholdId(
      pickInitialHousehold(
        selectableHouseholds,
        currentHousehold,
        route.params?.initialAddressLine1,
      )?.id ?? null,
    );
  }, [
    currentHousehold,
    route.params?.initialAddressLine1,
    selectableHouseholds,
    selectedHouseholdId,
  ]);

  const selectedHousehold = useMemo(
    () => selectableHouseholds.find(h => h.id === selectedHouseholdId) ?? null,
    [selectableHouseholds, selectedHouseholdId],
  );

  const address = useMemo(
    () => (selectedHousehold ? addressFromHousehold(selectedHousehold) : null),
    [selectedHousehold],
  );

  const canSubmit = Boolean(
    selectedHousehold && address?.address_line1?.trim(),
  );

  const submit = async () => {
    if (!selectedHousehold || !address || !canSubmit || isSubmitting) return;
    try {
      setIsSubmitting(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setCurrentHousehold(selectedHousehold);
      const response = await gardenPlansApi.createBoundaryDraft(
        selectedHousehold.id,
        {
          address,
        },
      );
      navigation.navigate('GardenPlanBoundaryConfirm', {
        draftId: response.boundary_draft.id,
      });
    } catch (error) {
      console.error('Failed to create boundary draft:', error);
      const status = typeof error === 'object' && error !== null
        ? (error as { response?: { status?: number } }).response?.status
        : undefined;
      if (status === 410) {
        showToast(
          'info',
          'Satellite map preview was removed. Upload a yard photo instead.'
        );
        navigation.navigate('GardenPlanUpload');
        return;
      }
      showToast('error', 'Could not start the garden plan flow');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container}>
        <ScreenHeader
          title="Create Garden Plan"
          showBackButton
          onBackPress={() => navigation.goBack()}
          showNotificationBell={false}
          showAvatar={false}
        />

        <AdaptiveContainer>
          <KeyboardAvoidingView
            style={styles.flex}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <ScrollView
        style={screenScrollViewStyle.scroll}
        contentContainerStyle={[
                styles.content,
                {
                  paddingBottom:
                    insets.bottom + Layout.bottomTabBarClearance + Spacing.xl,
                },
              ]}
              keyboardShouldPersistTaps="handled">
              <Typography
                variant="body"
                color={colors.textSecondary}
                style={styles.headerCopy}
              >
                Choose one of your saved houses. We’ll find it on a satellite
                map and ask you to confirm the boundary before AI draws
                anything.
              </Typography>

              <Card style={styles.card}>
                <Typography variant="headline" color={colors.textPrimary}>
                  Select house
                </Typography>
                <Typography
                  variant="body"
                  color={colors.textSecondary}
                  style={styles.helper}
                >
                  Garden plans use saved houses only. Condos and apartments are
                  hidden from this list.
                </Typography>

                {selectableHouseholds.length > 0 ? (
                  <View style={styles.houseList}>
                    {selectableHouseholds.map(household => {
                      const isSelected = household.id === selectedHouseholdId;

                      return (
                        <TouchableOpacity
                          key={household.id}
                          style={[
                            styles.houseOption,
                            {
                              backgroundColor: isSelected
                                ? colors.primaryLight
                                : colors.backgroundSecondary,
                              borderColor: isSelected
                                ? colors.primary
                                : colors.borderColor,
                            },
                          ]}
                          onPress={() => setSelectedHouseholdId(household.id)}
                          activeOpacity={0.75}
                        >
                          {/*
                            A local-first home has no usable `photo_url` — the
                            bytes are H6-sealed and the key is synthetic, so a
                            URL signed from it points at nothing. This picker is
                            how a member identifies WHICH home they are planning
                            a garden for, so a blank tile here is worse than
                            cosmetic.
                          */}
                          <HousePropertyPhoto
                            household={household}
                            width={64}
                            borderRadius={CornerRadius.md}
                            iconSize={24}
                            style={{ backgroundColor: colors.groupedListBackground }}
                          />
                          <View style={styles.houseText}>
                            <Typography
                              variant="headline"
                              weight={isSelected ? 'semibold' : 'regular'}
                              color={colors.textPrimary}
                            >
                              {household.name}
                            </Typography>
                            <Typography
                              variant="caption1"
                              color={colors.textSecondary}
                              numberOfLines={2}
                            >
                              {formatHouseholdAddress(household)}
                            </Typography>
                            <Typography
                              variant="caption2"
                              color={colors.textTertiary}
                            >
                              {household.member_count}{' '}
                              {household.member_count === 1
                                ? 'member'
                                : 'members'}{' '}
                              • {household.my_role}
                            </Typography>
                          </View>
                          {isSelected && (
                            <Typography
                              variant="caption1"
                              color={colors.primary}
                              weight="semibold"
                            >
                              Selected
                            </Typography>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ) : (
                  <View style={styles.emptyState}>
                    <Icon
                      name="home"
                      size={40}
                      color={colors.textSecondary}
                      style={styles.emptyIcon}
                    />
                    <Typography
                      variant="headline"
                      color={colors.textPrimary}
                      weight="semibold"
                    >
                      Create your first property
                    </Typography>
                    <Typography
                      variant="body"
                      color={colors.textSecondary}
                      style={styles.emptyText}
                    >
                      Add a saved house or property first. Once it has an
                      address, you can create a garden plan from it.
                    </Typography>
                    <TouchableOpacity
                      style={[
                        styles.emptyAction,
                        { backgroundColor: colors.primary },
                      ]}
                      onPress={navigateToHouseholds}
                      activeOpacity={0.8}
                    >
                      <Typography
                        variant="body"
                        color={colors.backgroundMain}
                        weight="semibold"
                      >
                        Go to My Properties
                      </Typography>
                    </TouchableOpacity>
                  </View>
                )}
              </Card>

              <GradientButton
                title={
                  isSubmitting
                    ? 'Finding property...'
                    : 'Find property boundary'
                }
                onPress={submit}
                disabled={!canSubmit || isSubmitting}
                style={styles.primaryButton}
                fullWidth
              />
              {isSubmitting && (
                <ActivityIndicator color={colors.primary} />
              )}

              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() =>
                  navigation.navigate('GardenPlanUpload', {
                    defaultPlanType: 'front_yard',
                  })
                }
              >
                <Typography variant="body" color={colors.primary}>
                  Upload my own sketch/photo instead
                </Typography>
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        </AdaptiveContainer>
      </View>
    </AppBackground>
  );
}

const NON_HOUSE_KEYWORDS = [
  'apartment',
  'apt',
  'condo',
  'condominium',
  'flat',
  'suite',
  'unit',
];

function isSelectableHouse(household: Household) {
  if (!household.address_line1?.trim()) return false;

  const searchable = [
    household.name,
    household.address_line1,
    household.address_line2,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return !NON_HOUSE_KEYWORDS.some(keyword =>
    new RegExp(`\\b${keyword}\\b`).test(searchable),
  );
}

function pickInitialHousehold(
  households: Household[],
  currentHousehold: Household | null,
  initialAddressLine1?: string,
) {
  const addressHint = initialAddressLine1?.trim().toLowerCase();
  if (addressHint) {
    const hintedHousehold = households.find(
      household =>
        household.address_line1?.trim().toLowerCase() === addressHint,
    );
    if (hintedHousehold) return hintedHousehold;
  }

  if (
    currentHousehold &&
    households.some(household => household.id === currentHousehold.id)
  ) {
    return currentHousehold;
  }

  return households[0] ?? null;
}

function addressFromHousehold(household: Household): GardenPlanAddressInput {
  return {
    address_line1: household.address_line1 ?? '',
    address_line2: household.address_line2 ?? '',
    city: household.city ?? '',
    state_province: household.state_province ?? '',
    postal_code: household.postal_code ?? '',
    country: household.country ?? 'US',
  };
}

function formatHouseholdAddress(household: Household) {
  return [
    household.address_line1,
    household.address_line2,
    household.city,
    household.state_province,
    household.postal_code,
    household.country,
  ]
    .filter(Boolean)
    .join(', ');
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Layout.headerBottom,
    gap: Spacing.md,
  },
  card: {
    padding: Spacing.lg,
    borderRadius: CornerRadius.xl,
    gap: Spacing.md,
  },
  helper: {
    lineHeight: 20,
  },
  headerCopy: {
    lineHeight: 20,
  },
  houseList: {
    gap: Spacing.sm,
  },
  houseOption: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: CornerRadius.lg,
    padding: Spacing.md,
    gap: Spacing.md,
  },
  houseText: {
    flex: 1,
  },
  emptyState: {
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.lg,
  },
  emptyIcon: {
    marginBottom: Spacing.sm,
  },
  emptyText: {
    lineHeight: 20,
    textAlign: 'center',
  },
  emptyAction: {
    marginTop: Spacing.sm,
    borderRadius: CornerRadius.lg,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  primaryButton: {
    marginTop: Spacing.sm,
  },
  secondaryButton: {
    alignItems: 'center',
    paddingVertical: Spacing.md,
  },
});
