import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';

import { householdSpacesApi, type HouseholdSpace } from '@api/household-spaces';
import { AppBackground, ScreenHeader, ScreenScrollEnd, screenScrollEndTestId, screenScrollViewStyle, SettingsGearButton } from '@components/common';
import { SpaceFormModal, type SpaceFormData } from '@components/spaces/SpaceFormModal';
import { SpaceIcon } from '@components/spaces/SpaceIcon';
import { Button, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import type { SettingsStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { useSpaceStore } from '@stores/spaceStore';
import { useAppColors } from '@theme';
import { getFloorLabel, groupSpacesForDisplay, suggestUniqueSpaceName } from '@utils/spaceLabels';

type NavigationProp = NativeStackNavigationProp<SettingsStackParamList, 'SpacesManagement'>;

export function SpacesManagementScreen() {
  const navigation = useNavigation<NavigationProp>();
  const colors = useAppColors();
  const currentHousehold = useHouseholdStore((s) => s.currentHousehold);
  const { spaces, setSpaces, fetchSpaces } = useSpaceStore();

  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingSpace, setEditingSpace] = useState<HouseholdSpace | null>(null);
  const [presetTemplates, setPresetTemplates] = useState<
    Awaited<ReturnType<typeof householdSpacesApi.getPresets>>['templates']
  >([]);

  const load = useCallback(async () => {
    if (!currentHousehold) return;
    setLoading(true);
    try {
      await fetchSpaces(currentHousehold.id);
      const presets = await householdSpacesApi.getPresets(currentHousehold.id);
      setPresetTemplates(presets.templates);
    } catch {
      Alert.alert('Error', 'Failed to load spaces');
    } finally {
      setLoading(false);
    }
  }, [currentHousehold, fetchSpaces]);

  useEffect(() => {
    load();
  }, [load]);

  const grouped = useMemo(() => groupSpacesForDisplay(spaces), [spaces]);

  const handleSaveSpace = async (data: SpaceFormData) => {
    if (!currentHousehold) return;

    if (editingSpace) {
      const { space } = await householdSpacesApi.update(currentHousehold.id, editingSpace.id, {
        name: data.name,
        space_type: data.space_type,
        category: (data.category as HouseholdSpace['category']) ?? undefined,
        floor_level: data.floor_level,
        icon_emoji: data.icon_emoji,
        icon_color: data.icon_color,
        description: data.description,
        area_sqft: data.area_sqft,
        version: editingSpace.version,
      });
      useSpaceStore.getState().updateSpace(space.id, space);
    } else {
      const uniqueName = suggestUniqueSpaceName(data.name, spaces);
      const { space } = await householdSpacesApi.create(currentHousehold.id, {
        name: uniqueName,
        space_type: data.space_type,
        category: (data.category as HouseholdSpace['category']) ?? undefined,
        floor_level: data.floor_level,
        icon_emoji: data.icon_emoji,
        icon_color: data.icon_color,
        description: data.description,
        area_sqft: data.area_sqft,
      });
      useSpaceStore.getState().addSpace(space);
    }
    setEditingSpace(null);
  };

  const handleDelete = (space: HouseholdSpace) => {
    if (!currentHousehold) return;
    Alert.alert('Delete Space', `Remove "${space.name}"? Tasks in this space will become unassigned.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await householdSpacesApi.delete(currentHousehold.id, space.id, space.version);
          useSpaceStore.getState().removeSpace(space.id);
        },
      },
    ]);
  };

  const moveSpace = async (space: HouseholdSpace, direction: 'up' | 'down') => {
    if (!currentHousehold) return;
    const sorted = [...spaces].sort((a, b) => a.display_order - b.display_order);
    const index = sorted.findIndex((s) => s.id === space.id);
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= sorted.length) return;

    const reordered = [...sorted];
    const swappedIds = new Set([reordered[index].id, reordered[swapIndex].id]);
    const tempOrder = reordered[index].display_order;
    reordered[index] = { ...reordered[index], display_order: reordered[swapIndex].display_order };
    reordered[swapIndex] = { ...reordered[swapIndex], display_order: tempOrder };
    [reordered[index], reordered[swapIndex]] = [reordered[swapIndex], reordered[index]];

    await householdSpacesApi.reorder(
      currentHousehold.id,
      reordered
        .filter((s) => swappedIds.has(s.id))
        .map((s) => ({
          space_id: s.id,
          display_order: s.display_order,
          version: s.version,
        }))
    );
    setSpaces(
      reordered.map((s) =>
        swappedIds.has(s.id) ? { ...s, version: s.version + 1 } : s
      )
    );
  };

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container} testID="spaces-management-screen">
        {/*
          Spaces is both a pushed Settings screen and the root of the Spaces
          TAB. As a tab root there is nothing behind it, and an arrow that only
          switches tabs reads as a broken back button. `canGoBack()` bubbles to
          the parent navigator and answers "yes" there, so ask THIS stack's own
          index: 0 means this screen is the root.
        */}
        <ScreenHeader
          title="Spaces"
          showBackButton={(navigation.getState()?.index ?? 0) > 0}
          onBackPress={() => navigation.goBack()}
          showNotificationBell={false}
          showAvatar={false}
          rightElement={<SettingsGearButton />}
        />

        <ScrollView
        style={screenScrollViewStyle.scroll}
        contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Typography variant="body" color={colors.textSecondary} style={styles.intro}>
            Rooms and areas where tasks live — bathroom, garage, backyard, and more.
          </Typography>

          {loading ? (
            <Typography variant="body" color={colors.textSecondary} align="center">
              Loading spaces...
            </Typography>
          ) : spaces.length === 0 ? (
            <View style={styles.empty}>
              <Typography variant="headline" weight="semibold" align="center">
                No spaces yet
              </Typography>
              <Typography variant="body" color={colors.textSecondary} align="center" style={styles.emptyText}>
                Add your first space to organize tasks by location.
              </Typography>
            </View>
          ) : (
            grouped.map((group) => (
              <View key={group.key} style={styles.group}>
                <Typography variant="footnote" weight="semibold" color={colors.textSecondary} style={styles.groupLabel}>
                  {group.label}
                </Typography>
                {group.spaces.map((space) => (
                  <TouchableOpacity
                    key={space.id}
                    style={[styles.row, { backgroundColor: colors.cardBackground }]}
                    onPress={() =>
                      navigation.navigate('SpaceDetail', {
                        spaceId: space.id,
                        householdId: currentHousehold!.id,
                      })
                    }
                  >
                    <SpaceIcon
                      emoji={space.icon_emoji}
                      imageUrl={space.custom_image_url}
                      backgroundColor={space.icon_color || '#F5F5F5'}
                      size="small"
                    />
                    <View style={styles.rowInfo}>
                      <Typography variant="body" weight="medium">
                        {space.name}
                      </Typography>
                      <Typography variant="caption1" color={colors.textSecondary}>
                        {getFloorLabel(space.floor_level) ?? space.category ?? 'Space'}
                        {space.task_count != null ? ` · ${space.task_count} tasks` : ''}
                      </Typography>
                    </View>
                    <View style={styles.rowActions}>
                      <TouchableOpacity onPress={() => moveSpace(space, 'up')} hitSlop={8}>
                        <Icon name="chevron-up" size={18} color={colors.textSecondary} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => moveSpace(space, 'down')} hitSlop={8}>
                        <Icon name="chevron-down" size={18} color={colors.textSecondary} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => {
                          setEditingSpace(space);
                          setShowForm(true);
                        }}
                        hitSlop={8}
                      >
                        <Icon name="pencil" size={18} color={colors.textSecondary} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => handleDelete(space)} hitSlop={8}>
                        <Icon name="trash-outline" size={18} color={colors.error} />
                      </TouchableOpacity>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            ))
          )}

          <Button
            title="Add Space"
            variant="primary"
            onPress={() => {
              setEditingSpace(null);
              setShowForm(true);
            }}
            fullWidth
            testID="spaces-add-button"
          />
          <ScreenScrollEnd testID={screenScrollEndTestId('spaces-management-screen')} />
        </ScrollView>

        <SpaceFormModal
          visible={showForm}
          space={editingSpace}
          presetTemplates={presetTemplates}
          onClose={() => {
            setShowForm(false);
            setEditingSpace(null);
          }}
          onSave={handleSaveSpace}
        />
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  intro: { marginBottom: 20 },
  empty: { paddingVertical: 40, gap: 8 },
  emptyText: { marginTop: 4 },
  group: { marginBottom: 20 },
  groupLabel: { marginBottom: 8, textTransform: 'uppercase' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
  },
  rowInfo: { flex: 1 },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  addButton: { marginTop: 8 },
});
