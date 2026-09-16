import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useEffect, useState, useCallback } from 'react';
import { StyleSheet, View, ScrollView, TouchableOpacity, RefreshControl, Platform, Alert } from 'react-native';

import { garbageCollectionApi, GarbageSchedule, CollectionDate } from '@api/garbage-collection';
import type { GarbageScheduleType } from '@api/garbage-collection';
import { SafeAreaView, AppBackground, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { Typography, Card, Button } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useData } from '@contexts/DataContext';
import type { RootStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { useAppColors } from '@theme';
import type { IoniconName } from '@utils/categoryIcons';

import { GarbageDetectScreen } from './GarbageDetectScreen';
import { GarbageScheduleEditor } from './GarbageScheduleEditor';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

interface GarbageScheduleScreenProps {
  onClose?: () => void;
}

const COLLECTION_ICONS: Record<string, IoniconName> = {
  garbage: 'trash',
  recycling: 'refresh-circle',
  organics: 'leaf',
  yardWaste: 'leaf',
  bulkItem: 'cube',
};

// Maps each collection type to a semantic color token key (resolved per-theme
// inside the component via useAppColors()).
const COLLECTION_COLOR_TOKENS: Record<string, keyof ReturnType<typeof useAppColors>> = {
  garbage: 'textSecondary',
  recycling: 'accent',
  organics: 'success',
  yardWaste: 'warning',
  bulkItem: 'info',
};

export function GarbageScheduleScreen({ onClose }: GarbageScheduleScreenProps) {  const colors = useAppColors();
  const navigation = useNavigation<NavigationProp>();

  // Resolve a collection type to its themed color (fallback: secondary text).
  const getCollectionColor = (type: string): string =>
    colors[COLLECTION_COLOR_TOKENS[type] ?? 'textSecondary'];
  const { isLoading: isDataLoading } = useData();
  const currentHousehold = useHouseholdStore((state) => state.currentHousehold);
  const queryClient = useQueryClient();

  const [schedule, setSchedule] = useState<GarbageSchedule | null>(null);
  const [upcomingDates, setUpcomingDates] = useState<CollectionDate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showDetect, setShowDetect] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [editorSchedules, setEditorSchedules] = useState<GarbageScheduleType[]>([]);
  const [editorMunicipality, setEditorMunicipality] = useState<string | undefined>(undefined);
  const [editorNotes, setEditorNotes] = useState<string | undefined>(undefined);
  const [editorLookupUrl, setEditorLookupUrl] = useState<string | undefined>(undefined);

  // Open the per-stream editor pre-filled with the given streams (from AI
  // detection, an existing schedule, or empty for from-scratch).
  const openEditor = useCallback(
    (
      schedules: GarbageScheduleType[],
      municipality?: string,
      tips?: { notes?: string; lookupUrl?: string }
    ) => {
      setEditorSchedules(schedules);
      setEditorMunicipality(municipality);
      setEditorNotes(tips?.notes);
      setEditorLookupUrl(tips?.lookupUrl);
      setShowEditor(true);
    },
    []
  );

  // A schedule row always exists (getOrCreateSchedule), so "needs setup" means
  // a schedule with no collection types configured yet.
  const hasSchedule = !!schedule && schedule.schedules.length > 0;

  const loadData = useCallback(async () => {
    if (!currentHousehold) {
      console.log('[GARBAGE] GarbageScheduleScreen.loadData: no currentHousehold');
      return;
    }

    try {
      setIsLoading(true);
      console.log('[GARBAGE] GarbageScheduleScreen.loadData: fetching schedule for', currentHousehold.id);
      const scheduleResult = await garbageCollectionApi.getSchedule(currentHousehold.id);
      console.log('[GARBAGE] GarbageScheduleScreen.loadData: schedule items=', scheduleResult.schedule?.schedules?.length ?? 0);
      setSchedule(scheduleResult.schedule);

      if (scheduleResult.schedule?.id) {
        const datesResult = await garbageCollectionApi.getNextCollections(
          currentHousehold.id,
          scheduleResult.schedule.id,
          30
        );
        console.log('[GARBAGE] GarbageScheduleScreen.loadData: upcoming dates=', datesResult.dates.length);
        setUpcomingDates(datesResult.dates);
      }
    } catch (error) {
      console.log('[GARBAGE] GarbageScheduleScreen.loadData: error', error);
    } finally {
      setIsLoading(false);
    }
  }, [currentHousehold]);

  // After a save, refetch this screen AND invalidate the Home tile summary so
  // its badge updates without waiting for staleTime.
  const refreshAfterSave = useCallback(async () => {
    console.log('[GARBAGE] refreshAfterSave: invalidating + reloading');
    await loadData();
    queryClient.invalidateQueries({ queryKey: ['garbage'] });
  }, [loadData, queryClient]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  // Clear the schedule completely (back to the empty state). Reuses the update
  // endpoint with an empty streams list — this also cancels reminders.
  const handleClear = () => {
    if (!currentHousehold || !schedule) return;
    Alert.alert(
      'Clear Schedule',
      'Remove all collection types and reminders? You can set it up again anytime.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              console.log('[GARBAGE] handleClear: clearing schedule', schedule.id);
              await garbageCollectionApi.updateSchedule(currentHousehold.id, schedule.id, {
                schedules: [],
              });
              await refreshAfterSave();
            } catch (err) {
              console.log('[GARBAGE] handleClear: error', err);
              Alert.alert('Error', 'Could not clear the schedule. Please try again.');
            }
          },
        },
      ]
    );
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    }
    if (date.toDateString() === tomorrow.toDateString()) {
      return 'Tomorrow';
    }
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  };

  const getNextCollection = (): CollectionDate | null => {
    if (upcomingDates.length === 0) return null;
    return upcomingDates[0];
  };

  const nextCollection = getNextCollection();

  const handleBack = () => {
    if (onClose) onClose();
    else navigation.goBack();
  };

  const header = (
    <ScreenHeader
      title="Garbage & Recycling"
      showBackButton
      onBackPress={handleBack}
      showNotificationBell={false}
      showAvatar={false}
    />
  );

  // Show loading state while data is being fetched
  if (isDataLoading) {
    return (
      <AppBackground opacity={0.5}>
        {header}
        <SafeAreaView edges={[]}>
          <View style={styles.container}>
            <View style={styles.emptyState}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Typography variant="body" color={colors.textSecondary} style={{ marginTop: 12 }}>
                Loading...
              </Typography>
            </View>
          </View>
        </SafeAreaView>
      </AppBackground>
    );
  }

  if (!currentHousehold) {
    return (
      <AppBackground opacity={0.5}>
        {header}
        <SafeAreaView edges={[]}>
          <View style={styles.container}>
            <View style={styles.emptyState}>
              <Typography variant="title3" weight="semibold" align="center">
                No Home Selected
              </Typography>
            </View>
          </View>
        </SafeAreaView>
      </AppBackground>
    );
  }

  return (
    <AppBackground opacity={0.5}>
      {header}
      <SafeAreaView edges={[]}>
        <View style={styles.container}>
          <ScrollView
            style={[screenScrollViewStyle.scroll, styles.scrollView]}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
            }
          >
            {isLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            ) : !hasSchedule ? (
              <View style={styles.setupContainer}>
                <Card
                  variant="filled"
                  style={[styles.setupCard, { backgroundColor: colors.backgroundSecondary }]}
                >
                  <Icon name="trash" size={48} color={colors.textPrimary} style={styles.setupIcon} />
                  <Typography variant="title3" weight="bold" align="center">
                    No Schedule Set Up Yet
                  </Typography>
                  <Typography
                    variant="body"
                    color={colors.textSecondary}
                    align="center"
                    style={styles.setupText}
                  >
                    Never miss garbage day again. Let us find your collection schedule from your
                    address, or enter it yourself.
                  </Typography>
                  <Button
                    title="Find My Schedule Automatically"
                    variant="primary"
                    size="md"
                    onPress={() => setShowDetect(true)}
                    fullWidth
                    leftIcon={<Icon name="sparkles" size={16} color={colors.white} />}
                  />
                  <Button
                    title="Set Up Manually"
                    variant="secondary"
                    size="md"
                    onPress={() => openEditor([], schedule?.municipality)}
                    fullWidth
                    style={styles.manualButton}
                  />
                </Card>

                {/* Info Cards */}
                <Typography
                  variant="subheadline"
                  weight="semibold"
                  color={colors.textSecondary}
                  style={styles.sectionTitle}
                >
                  WHAT YOU'LL GET
                </Typography>

                <Card variant="outlined" style={styles.featureCard}>
                  <Icon name="alarm" size={24} color={colors.primary} />
                  <View style={styles.featureContent}>
                    <Typography variant="headline" weight="semibold">
                      Night-Before Reminders
                    </Typography>
                    <Typography variant="footnote" color={colors.textSecondary}>
                      Get notified the evening before collection day
                    </Typography>
                  </View>
                </Card>

                <Card variant="outlined" style={styles.featureCard}>
                  <Icon name="calendar" size={24} color={colors.primary} />
                  <View style={styles.featureContent}>
                    <Typography variant="headline" weight="semibold">
                      Holiday Adjustments
                    </Typography>
                    <Typography variant="footnote" color={colors.textSecondary}>
                      Automatic schedule shifts for statutory holidays
                    </Typography>
                  </View>
                </Card>

                <Card variant="outlined" style={styles.featureCard}>
                  <Icon name="leaf" size={24} color={colors.primary} />
                  <View style={styles.featureContent}>
                    <Typography variant="headline" weight="semibold">
                      GVA Municipality Data
                    </Typography>
                    <Typography variant="footnote" color={colors.textSecondary}>
                      Pre-configured schedules for Metro Vancouver cities
                    </Typography>
                  </View>
                </Card>
              </View>
            ) : (
              <>
                {/* Next Collection Card */}
                {nextCollection && (
                  <Card
                    variant="filled"
                    style={[styles.nextCard, { backgroundColor: colors.backgroundSecondary }]}
                  >
                    <Typography
                      variant="subheadline"
                      weight="semibold"
                      color={colors.textSecondary}
                    >
                      NEXT COLLECTION
                    </Typography>
                    <Typography variant="largeTitle" weight="bold" style={styles.nextDate}>
                      {formatDate(nextCollection.date)}
                    </Typography>
                    <View style={styles.collectionTypes}>
                      {nextCollection.types.map((type) => (
                        <View
                          key={type}
                          style={[
                            styles.typeChip,
                            { backgroundColor: `${getCollectionColor(type)}20` },
                          ]}
                        >
                          <Icon
                            name={COLLECTION_ICONS[type] || 'cube'}
                            size={16}
                            color={getCollectionColor(type)}
                          />
                          <Typography
                            variant="subheadline"
                            weight="medium"
                            color={getCollectionColor(type)}
                            style={styles.typeLabel}
                          >
                            {type.charAt(0).toUpperCase() + type.slice(1)}
                          </Typography>
                        </View>
                      ))}
                    </View>
                    {nextCollection.isHolidayShifted && (
                      <View style={styles.holidayNote}>
                        <Icon name="warning" size={14} color={colors.warning} />
                        <Typography variant="caption1" color={colors.warning}>
                          Schedule shifted due to holiday
                        </Typography>
                      </View>
                    )}
                  </Card>
                )}

                {/* Upcoming Schedule */}
                <Typography
                  variant="subheadline"
                  weight="semibold"
                  color={colors.textSecondary}
                  style={styles.sectionTitle}
                >
                  UPCOMING
                </Typography>

                <Card
                  variant="filled"
                  style={[styles.upcomingCard, { backgroundColor: colors.backgroundSecondary }]}
                >
                  {upcomingDates.slice(1, 6).map((collection, index) => (
                    <View
                      key={collection.date}
                      style={[
                        styles.upcomingItem,
                        index < 4 && styles.upcomingItemBorder,
                      ]}
                    >
                      <View style={styles.upcomingDate}>
                        <Typography variant="subheadline" weight="medium">
                          {formatDate(collection.date)}
                        </Typography>
                      </View>
                      <View style={styles.upcomingTypes}>
                        {collection.types.map((type) => (
                          <View
                            key={type}
                            style={[styles.upcomingChip, { backgroundColor: `${getCollectionColor(type)}1A` }]}
                          >
                            <Icon
                              name={COLLECTION_ICONS[type] || 'cube'}
                              size={12}
                              color={getCollectionColor(type)}
                            />
                            <Typography
                              variant="caption2"
                              weight="semibold"
                              color={getCollectionColor(type)}
                              style={styles.upcomingChipLabel}
                            >
                              {type.charAt(0).toUpperCase() + type.slice(1)}
                            </Typography>
                          </View>
                        ))}
                      </View>
                    </View>
                  ))}
                </Card>

                {/* What Goes Where Guide */}
                <Typography
                  variant="subheadline"
                  weight="semibold"
                  color={colors.textSecondary}
                  style={styles.sectionTitle}
                >
                  WHAT GOES WHERE
                </Typography>

                <Card
                  variant="outlined"
                  style={styles.guideCard}
                >
                  <TouchableOpacity style={styles.guideItem}>
                    <Icon name="trash" size={24} color={getCollectionColor('garbage')} />
                    <View style={styles.guideContent}>
                      <Typography variant="headline" weight="semibold">
                        Garbage
                      </Typography>
                      <Typography variant="footnote" color={colors.textSecondary}>
                        Non-recyclable waste, contaminated materials
                      </Typography>
                    </View>
                    <Icon name="chevron-forward" size={18} color={colors.textTertiary} />
                  </TouchableOpacity>

                  <View style={styles.guideDivider} />

                  <TouchableOpacity style={styles.guideItem}>
                    <Icon name="refresh-circle" size={24} color={getCollectionColor('recycling')} />
                    <View style={styles.guideContent}>
                      <Typography variant="headline" weight="semibold">
                        Recycling
                      </Typography>
                      <Typography variant="footnote" color={colors.textSecondary}>
                        Paper, cardboard, plastics, glass, metal
                      </Typography>
                    </View>
                    <Icon name="chevron-forward" size={18} color={colors.textTertiary} />
                  </TouchableOpacity>

                  <View style={styles.guideDivider} />

                  <TouchableOpacity style={styles.guideItem}>
                    <Icon name="leaf" size={24} color={getCollectionColor('organics')} />
                    <View style={styles.guideContent}>
                      <Typography variant="headline" weight="semibold">
                        Organics
                      </Typography>
                      <Typography variant="footnote" color={colors.textSecondary}>
                        Food scraps, yard trimmings, compostables
                      </Typography>
                    </View>
                    <Icon name="chevron-forward" size={18} color={colors.textTertiary} />
                  </TouchableOpacity>
                </Card>

                {/* Manage */}
                <Typography
                  variant="subheadline"
                  weight="semibold"
                  color={colors.textSecondary}
                  style={styles.sectionTitle}
                >
                  MANAGE
                </Typography>
                <Card variant="outlined" style={styles.guideCard}>
                  <TouchableOpacity
                    style={styles.guideItem}
                    onPress={() => schedule && openEditor(schedule.schedules, schedule.municipality)}
                  >
                    <Icon name="pencil" size={24} color={colors.textPrimary} />
                    <View style={styles.guideContent}>
                      <Typography variant="headline" weight="semibold">Edit Schedule</Typography>
                      <Typography variant="footnote" color={colors.textSecondary}>
                        Change types, frequency, or collection days
                      </Typography>
                    </View>
                    <Icon name="chevron-forward" size={18} color={colors.textTertiary} />
                  </TouchableOpacity>

                  <View style={styles.guideDivider} />

                  <TouchableOpacity style={styles.guideItem} onPress={() => setShowDetect(true)}>
                    <Icon name="sparkles" size={24} color={colors.textPrimary} />
                    <View style={styles.guideContent}>
                      <Typography variant="headline" weight="semibold">Re-detect with AI</Typography>
                      <Typography variant="footnote" color={colors.textSecondary}>
                        Search your municipality again
                      </Typography>
                    </View>
                    <Icon name="chevron-forward" size={18} color={colors.textTertiary} />
                  </TouchableOpacity>

                  <View style={styles.guideDivider} />

                  <TouchableOpacity style={styles.guideItem} onPress={handleClear}>
                    <Icon name="trash" size={24} color={colors.warning} />
                    <View style={styles.guideContent}>
                      <Typography variant="headline" weight="semibold" color={colors.warning}>
                        Clear Schedule
                      </Typography>
                      <Typography variant="footnote" color={colors.textSecondary}>
                        Remove everything and start over
                      </Typography>
                    </View>
                    <Icon name="chevron-forward" size={18} color={colors.textTertiary} />
                  </TouchableOpacity>
                </Card>
              </>
            )}
          </ScrollView>

          {/* AI detection flow */}
          <GarbageDetectScreen
            visible={showDetect}
            onClose={() => setShowDetect(false)}
            onSaved={() => {
              setShowDetect(false);
              refreshAfterSave();
            }}
            onManual={(draft) => {
              setShowDetect(false);
              openEditor(draft?.schedules ?? [], draft?.municipality ?? undefined, {
                notes: draft?.notes,
                lookupUrl: draft?.sources?.[0]?.url,
              });
            }}
          />

          {/* Per-stream editor — preserves each stream's own frequency + day */}
          <GarbageScheduleEditor
            visible={showEditor}
            onClose={() => setShowEditor(false)}
            onSaved={() => {
              setShowEditor(false);
              refreshAfterSave();
            }}
            title={editorSchedules.length > 0 ? 'Review Schedule' : 'Set Up Schedule'}
            municipality={editorMunicipality || schedule?.municipality}
            setOutTime={schedule?.set_out_time}
            initialSchedules={editorSchedules}
            notes={editorNotes}
            lookupUrl={editorLookupUrl}
          />
        </View>
      </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyState: {
    flex: 1,
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  setupContainer: {
    gap: 12,
  },
  setupCard: {
    padding: 24,
    borderRadius: 20,
    alignItems: 'center',
    marginBottom: 24,
    ...Platform.select({
      ios: {
        shadowColor: 'rgba(0, 0, 0, 1)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  setupIcon: {
    marginBottom: 16,
  },
  setupText: {
    marginTop: 8,
    marginBottom: 24,
  },
  manualButton: {
    marginTop: 12,
  },
  sectionTitle: {
    marginBottom: 12,
    marginTop: 8,
    marginLeft: 4,
  },
  featureCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    marginBottom: 8,
  },
  featureContent: {
    flex: 1,
    marginLeft: 12,
  },
  nextCard: {
    padding: 24,
    borderRadius: 20,
    alignItems: 'center',
    marginBottom: 24,
    ...Platform.select({
      ios: {
        shadowColor: 'rgba(0, 0, 0, 1)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  nextDate: {
    marginTop: 8,
    marginBottom: 16,
  },
  collectionTypes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
  },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
  },
  typeLabel: {
    textTransform: 'capitalize',
  },
  holidayNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 16,
    padding: 12,
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderRadius: 8,
  },
  upcomingCard: {
    borderRadius: 16,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: 'rgba(0, 0, 0, 1)',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 8,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  upcomingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  upcomingItemBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0, 0, 0, 0.08)',
  },
  upcomingDate: {
    flex: 1,
  },
  upcomingTypes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 6,
    flexShrink: 1,
    maxWidth: '62%',
  },
  upcomingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  upcomingChipLabel: {
    textTransform: 'capitalize',
  },
  guideCard: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  guideItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  guideDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(0, 0, 0, 0.08)',
    marginLeft: 56,
  },
  guideContent: {
    flex: 1,
    marginLeft: 12,
  },
  settingsLink: {
    marginTop: 24,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
});

export default GarbageScheduleScreen;
