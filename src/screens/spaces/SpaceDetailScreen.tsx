import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useRouter } from 'expo-router';
import { useNavigation, useRoute, type RouteProp } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';

import { householdSpacesApi, type HouseholdSpace } from '@api/household-spaces';
import { tasksApi, type Task } from '@api/tasks';
import { isHouseBrand } from '@brand';
import { AppBackground, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { SpaceFormModal, type SpaceFormData } from '@components/spaces/SpaceFormModal';
import { SpaceIcon } from '@components/spaces/SpaceIcon';
import { Button, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import type { SettingsStackParamList } from '@navigation/types';
import { navigateToTask } from '@services/navigation';
import { useSpaceStore } from '@stores/spaceStore';
import { useAppColors } from '@theme';
import { getCategoryLabel, getFloorLabel } from '@utils/spaceLabels';

type NavigationProp = NativeStackNavigationProp<SettingsStackParamList, 'SpaceDetail'>;
type RouteProps = RouteProp<SettingsStackParamList, 'SpaceDetail'>;

export function SpaceDetailScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProps>();
  const router = useRouter();
  const { spaceId, householdId } = route.params;
  const colors = useAppColors();
  const updateSpaceInStore = useSpaceStore((s) => s.updateSpace);

  const [space, setSpace] = useState<HouseholdSpace | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [presetTemplates, setPresetTemplates] = useState<
    Awaited<ReturnType<typeof householdSpacesApi.getPresets>>['templates']
  >([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [spaceRes, tasksRes, presetsRes] = await Promise.all([
        householdSpacesApi.get(householdId, spaceId),
        tasksApi.list(householdId, { is_active: true }),
        householdSpacesApi.getPresets(householdId),
      ]);
      setSpace(spaceRes.space);
      setTasks(tasksRes.tasks.filter((t) => t.space_id === spaceId));
      setPresetTemplates(presetsRes.templates);
    } catch {
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  }, [householdId, spaceId, navigation]);

  useEffect(() => {
    load();
  }, [load]);

  const floorLabel = useMemo(
    () => (space ? getFloorLabel(space.floor_level) : null),
    [space]
  );

  const handleSave = async (data: SpaceFormData) => {
    if (!space) return;

    const { space: updated } = await householdSpacesApi.update(householdId, spaceId, {
      name: data.name,
      space_type: data.space_type,
      category: (data.category as HouseholdSpace['category']) ?? undefined,
      floor_level: data.floor_level,
      icon_emoji: data.icon_emoji,
      icon_color: data.icon_color,
      description: data.description,
      area_sqft: data.area_sqft,
      version: space.version,
    });
    setSpace(updated);
    updateSpaceInStore(spaceId, updated);
  };

  if (loading || !space) {
    return (
      <AppBackground opacity={0.5}>
        <View style={styles.container}>
          <ScreenHeader
            title="Space"
            showBackButton
            onBackPress={() => navigation.goBack()}
            showNotificationBell={false}
            showAvatar={false}
          />
          <Typography variant="body" color={colors.textSecondary} align="center" style={styles.loading}>
            Loading...
          </Typography>
        </View>
      </AppBackground>
    );
  }

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container}>
        <ScreenHeader
          title={space.name}
          showBackButton
          onBackPress={() => navigation.goBack()}
          showNotificationBell={false}
          showAvatar={false}
        />

        <ScrollView
        style={screenScrollViewStyle.scroll}
        contentContainerStyle={styles.content}>
          <View style={styles.hero}>
            <SpaceIcon
              emoji={space.icon_emoji}
              imageUrl={space.custom_image_url}
              backgroundColor={space.icon_color || '#F5F5F5'}
              size="large"
            />
            {/* The space name is shown in the centered header; the hero keeps the
                icon + meta chips without repeating it. */}
            <View style={styles.metaRow}>
              {floorLabel && (
                <View style={[styles.chip, { backgroundColor: colors.pillBackground }]}>
                  <Typography variant="caption1">{floorLabel}</Typography>
                </View>
              )}
              {space.category && (
                <View style={[styles.chip, { backgroundColor: colors.pillBackground }]}>
                  <Typography variant="caption1">{getCategoryLabel(space.category)}</Typography>
                </View>
              )}
            </View>
            {space.description ? (
              <Typography variant="body" color={colors.textSecondary} style={styles.description}>
                {space.description}
              </Typography>
            ) : null}
            {isHouseBrand() ? (
              <Button
                title="Plan improvement"
                variant="secondary"
                onPress={() =>
                  router.push({
                    pathname: '/projects',
                    params: { screen: 'CreateHomeProject', spaceId },
                  })
                }
                style={{ marginTop: 16 }}
                testID="space-plan-improvement"
              />
            ) : null}
          </View>

          <View style={styles.sectionHeader}>
            <Typography variant="headline" weight="semibold">
              Tasks in this space
            </Typography>
            <Typography variant="footnote" color={colors.textSecondary}>
              {tasks.length}
            </Typography>
          </View>

          {tasks.length === 0 ? (
            <Typography variant="body" color={colors.textSecondary}>
              No tasks assigned to this space yet.
            </Typography>
          ) : (
            tasks.map((task) => (
              <TouchableOpacity
                key={task.id}
                style={[styles.taskRow, { backgroundColor: colors.cardBackground }]}
                onPress={() => navigateToTask(task.id)}
              >
                <Icon name="checkbox-outline" size={20} color={colors.primary} />
                <Typography variant="body" style={styles.taskTitle} numberOfLines={2}>
                  {task.title}
                </Typography>
              </TouchableOpacity>
            ))
          )}

          <Button
            title="Edit Space"
            variant="secondary"
            onPress={() => setShowForm(true)}
            fullWidth
          />
        </ScrollView>

        <SpaceFormModal
          visible={showForm}
          space={space}
          presetTemplates={presetTemplates}
          onClose={() => setShowForm(false)}
          onSave={handleSave}
        />
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  loading: { marginTop: 40 },
  hero: { alignItems: 'center', marginBottom: 28 },
  heroTitle: { marginTop: 12 },
  metaRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  description: { marginTop: 12, textAlign: 'center' },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
  },
  taskTitle: { flex: 1 },
  editButton: { marginTop: 24 },
});
