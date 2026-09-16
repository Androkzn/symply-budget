import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

import type { NeighbourhoodWithCount } from '@api/neighbours';
import { AppBackground, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { HouseAttachmentField, HouseBlobImage } from '@components/house-v2';
import { AdaptiveContainer } from '@components/layout';
import {
  BottomSheet,
  EmptyState,
  GradientButton,
  Icon,
  TextInput,
  Typography,
} from '@components/ui';
import type { HouseBlobDescriptor } from '@features/house/local/blobs';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { useNeighbourMutations, useNeighbourhoods } from '@hooks/useNeighbours';
import type { NeighboursStackParamList } from '@navigation/types';
import { showToast } from '@services/toastManager';
import { useHouseholdStore } from '@stores/householdStore';
import { CornerRadius, Spacing, useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';

type Nav = NativeStackNavigationProp<NeighboursStackParamList>;

/**
 * Neighbourhoods — named areas, with a picture and a tint.
 *
 * ## What an area is FOR
 *
 * Three things, in order of how much they matter:
 *
 *  1. **Filtering.** "Show me just Maple Court" on a map with forty pins.
 *  2. **A picture.** A photo of the cul-de-sac, the strata building, the lane —
 *     the thing a member points at when explaining where someone lives. This is
 *     the reason areas have their own screen rather than being a text field.
 *  3. **Colour.** Pins tint by area, so a glance separates two streets.
 *
 * It is entirely optional. A household that never opens this screen loses
 * nothing; every home works unfiled.
 *
 * ## Deleting an area does NOT delete its homes
 *
 * The confirmation says so explicitly, because "delete Maple Court" reads like
 * it might. D1 declares `ON DELETE SET NULL` and the local facade performs the
 * same unfiling by hand — see `localNeighboursApi.deleteNeighbourhood`.
 */

const AREA_COLORS = [
  '#4CAF50',
  '#2196F3',
  '#7E57C2',
  '#FF9800',
  '#00BCD4',
  '#EC407A',
  '#8D6E63',
] as const;

type Draft = {
  id?: string;
  name: string;
  description: string;
  color: string | null;
  photo: HouseBlobDescriptor | null;
};

const EMPTY_DRAFT: Draft = { name: '', description: '', color: null, photo: null };

export function NeighbourhoodsScreen() {
  const colors = useAppColors();
  const navigation = useNavigation<Nav>();
  const { content: containerPadding } = useLayoutPadding();
  const { currentHousehold } = useHouseholdStore();
  const householdId = currentHousehold?.id;

  const { data: neighbourhoods = [] } = useNeighbourhoods(householdId);
  const mutations = useNeighbourMutations(householdId);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);

  const openEditor = useCallback((area?: NeighbourhoodWithCount) => {
    setDraft(
      area
        ? {
            id: area.id,
            name: area.name,
            description: area.description ?? '',
            color: area.color,
            photo: area.photo_blob ?? null,
          }
        : EMPTY_DRAFT
    );
    setSheetOpen(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!draft.name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: draft.name.trim(),
        description: draft.description || null,
        color: draft.color,
        photo_blob: draft.photo ?? undefined,
      };
      if (draft.id) {
        await mutations.updateNeighbourhood.mutateAsync({ id: draft.id, data: payload });
      } else {
        await mutations.createNeighbourhood.mutateAsync(payload);
      }
      setSheetOpen(false);
      setDraft(EMPTY_DRAFT);
    } catch {
      showToast('error', 'Could not save this neighbourhood.');
    } finally {
      setSaving(false);
    }
  }, [draft, mutations]);

  const handleDelete = useCallback(
    (area: NeighbourhoodWithCount) => {
      Alert.alert(
        `Delete ${area.name}?`,
        area.neighbour_count > 0
          ? `The ${area.neighbour_count === 1 ? 'home' : `${area.neighbour_count} homes`} in it will stay on your map — they just will not be grouped any more.`
          : 'This neighbourhood has no homes in it yet.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => mutations.deleteNeighbourhood.mutate(area.id),
          },
        ]
      );
    },
    [mutations]
  );

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container} testID="neighbourhoods-screen">
        <ScreenHeader
          title="Neighbourhoods"
          showBackButton
          onBackPress={() => navigation.goBack()}
          showNotificationBell={false}
          showAvatar={false}
        />

        <AdaptiveContainer padding={containerPadding}>
          <ScrollView
            style={screenScrollViewStyle.scroll}
            contentContainerStyle={styles.content}
            testID="neighbourhoods-list"
          >
            {neighbourhoods.length === 0 ? (
              <EmptyState
                icon="layers"
                title="No neighbourhoods yet"
                description="Group homes into a named area — a street, a cul-de-sac, a building — with its own photo and colour."
                action={{ label: 'Create one', onPress: () => openEditor() }}
              />
            ) : (
              neighbourhoods.map((area) => (
                <TouchableOpacity
                  key={area.id}
                  style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
                  onPress={() => openEditor(area)}
                  testID={`neighbourhood-card-${area.id}`}
                  accessibilityRole="button"
                  // Labelling the card hides the line under the name, which is
                  // the only place the count (or description) is stated.
                  accessibilityLabel={`${area.name}. ${
                    area.description ||
                    (area.neighbour_count === 1 ? '1 home' : `${area.neighbour_count} homes`)
                  }`}
                >
                  {area.photo_blob ? (
                    <HouseBlobImage
                      descriptor={area.photo_blob}
                      householdId={householdId}
                      width={64}
                      height={64}
                      accessibilityLabel={`Photo of ${area.name}`}
                      style={styles.thumb}
                    />
                  ) : (
                    <View
                      style={[
                        styles.thumb,
                        styles.thumbFallback,
                        { backgroundColor: `${area.color ?? colors.primary}22` },
                      ]}
                    >
                      <Icon name="layers" size={24} color={area.color ?? colors.primary} />
                    </View>
                  )}
                  <View style={styles.cardText}>
                    <Typography variant="body" weight="semibold" numberOfLines={1}>
                      {area.name}
                    </Typography>
                    <Typography variant="caption1" color={colors.textSecondary} numberOfLines={2}>
                      {area.description ||
                        (area.neighbour_count === 1
                          ? '1 home'
                          : `${area.neighbour_count} homes`)}
                    </Typography>
                  </View>
                  <TouchableOpacity
                    onPress={() => handleDelete(area)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    testID={`neighbourhood-delete-${area.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${area.name}`}
                  >
                    <Icon name="trash" size={18} color={colors.textTertiary} />
                  </TouchableOpacity>
                </TouchableOpacity>
              ))
            )}

            {neighbourhoods.length > 0 && (
              <TouchableOpacity
                style={[styles.addRow, { borderColor: colors.borderColor }]}
                onPress={() => openEditor()}
                testID="neighbourhoods-add"
                accessibilityRole="button"
                accessibilityLabel="Add a neighbourhood"
              >
                <Icon name="add" size={20} color={colors.primary} />
                <Typography variant="body" color={colors.primary}>
                  Add a neighbourhood
                </Typography>
              </TouchableOpacity>
            )}
          </ScrollView>
        </AdaptiveContainer>

        <BottomSheet
          visible={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title={draft.id ? 'Edit neighbourhood' : 'New neighbourhood'}
          height="tall"
          showCloseButton
        >
          <ScrollView
            {...keyboardDismissScrollProps}
            style={screenScrollViewStyle.scroll}
            contentContainerStyle={styles.sheetContent}
            testID="neighbourhood-sheet"
          >
            <TextInput
              label="Name"
              placeholder="Maple Court"
              value={draft.name}
              onChangeText={(name) => setDraft((current) => ({ ...current, name }))}
              testID="neighbourhood-name"
            />
            <TextInput
              label="Description"
              placeholder="The cul-de-sac behind us"
              value={draft.description}
              onChangeText={(description) => setDraft((current) => ({ ...current, description }))}
              testID="neighbourhood-description"
            />

            <Typography variant="caption1" color={colors.textSecondary}>
              Colour
            </Typography>
            <View style={styles.swatchRow}>
              {AREA_COLORS.map((swatch) => (
                <TouchableOpacity
                  key={swatch}
                  style={[
                    styles.swatch,
                    {
                      backgroundColor: swatch,
                      borderColor: draft.color === swatch ? colors.textPrimary : 'transparent',
                    },
                  ]}
                  onPress={() => setDraft((current) => ({ ...current, color: swatch }))}
                  testID={`neighbourhood-color-${swatch.replace('#', '')}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Colour ${swatch}`}
                />
              ))}
            </View>

            <View testID="neighbourhood-photo">
              <HouseAttachmentField
                label="Photo of the area"
                accept="image"
                value={draft.photo}
                onChange={(photo) => setDraft((current) => ({ ...current, photo }))}
                householdId={householdId}
              />
            </View>

            <GradientButton
              title={draft.id ? 'Save' : 'Create'}
              onPress={handleSave}
              disabled={!draft.name.trim() || saving}
              loading={saving}
              testID="neighbourhood-save"
            />
          </ScrollView>
        </BottomSheet>
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  content: { paddingBottom: 100, gap: Spacing.md },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: CornerRadius.lg,
  },
  thumb: { width: 64, height: 64, borderRadius: CornerRadius.md },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  cardText: { flex: 1 },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    borderRadius: CornerRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
  },
  sheetContent: { gap: Spacing.md, paddingBottom: Spacing.xl },
  swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  swatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 3 },
});
