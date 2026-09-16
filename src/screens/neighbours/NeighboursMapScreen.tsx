import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import MapView, {
  Marker,
  PROVIDER_DEFAULT,
  type LongPressEvent,
  type Region,
} from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { NeighbourFilters, NeighbourWithPeople } from '@api/neighbours';
import { RELATION_INFO } from '@api/neighbours';
import { AppBackground, ScreenHeader, ScreenScrollEnd } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import {
  NeighbourCard,
  NeighbourClusterMarker,
  NeighbourMapMarker,
  NeighbourPeekCard,
} from '@components/neighbours';
import { BottomSheet, EmptyState, FilterTabs, Icon, SearchBar, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import {
  useNeighbourMutations,
  useNeighbourOrigin,
  useNeighbourhoods,
  useNeighbours,
} from '@hooks/useNeighbours';
import type { NeighboursStackParamList } from '@navigation/types';
import { getDevicePosition } from '@services/geocoding';
import { showToast } from '@services/toastManager';
import { useHouseholdStore } from '@stores/householdStore';
import { CornerRadius, Spacing, useAppColors } from '@theme';
import {
  clusterPoints,
  regionAround,
  regionForPoints,
  type MapRegion,
} from '@utils/neighbourGeo';

type Nav = NativeStackNavigationProp<NeighboursStackParamList>;
type ViewMode = 'map' | 'list';

/**
 * Neighbours — the map.
 *
 * ## What this screen is for
 *
 * A member opens it to answer one of three questions, and the layout is ordered
 * by how often each is asked:
 *
 *  1. *"Who lives there?"* — tap a pin, read the card. The common case, and the
 *     reason the map is the default view rather than a tab beside a list.
 *  2. *"I just met someone — record them."* — long-press the roof. One gesture,
 *     no address typing, and the reverse geocode fills the form.
 *  3. *"Who do I call about X?"* — the list view, with search.
 *
 * ## Long-press to add, tap to inspect
 *
 * A short tap on empty map does nothing but dismiss the card. Adding on a plain
 * tap sounds faster and is a trap: a member panning a map taps it constantly by
 * accident, and every stray tap would open a create form over their place on the
 * map. Long-press is the gesture every map product reserves for "put something
 * here", it is undoable by not confirming, and it fires a haptic so the member
 * knows it registered before the sheet animates.
 *
 * ## Clustering runs off the CURRENT region, not the data
 *
 * `clusterPoints` is given the region the map is actually showing, so the same
 * forty homes are six bubbles at neighbourhood zoom and forty pins at street
 * zoom, with nothing to configure. The region is tracked in state from
 * `onRegionChangeComplete` — the *complete* variant, not the continuous one:
 * re-clustering on every frame of a pan is the single easiest way to make this
 * screen stutter, and the pins visibly do not need to re-group mid-gesture.
 *
 * ## `tracksViewChanges` is switched OFF after first paint
 *
 * A `<Marker>` wrapping a custom view re-rasterises on every render while
 * tracking is on. With thirty markers that is the difference between a smooth
 * pan and a slideshow. It stays on just long enough for the first layout to
 * settle (the avatars need one frame to measure), then goes off; a marker whose
 * content genuinely changes gets a new `key`, which remounts it.
 */

const FILTER_ALL = 'all';
const FILTER_FAVORITES = 'favorites';
const FILTER_KEY_HOLDERS = 'key-holders';

export function NeighboursMapScreen() {
  const colors = useAppColors();
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { content: containerPadding } = useLayoutPadding();
  const { currentHousehold } = useHouseholdStore();
  const householdId = currentHousehold?.id;
  const unitSystem: 'metric' | 'imperial' =
    currentHousehold?.unit_system === 'imperial' ? 'imperial' : 'metric';

  const [viewMode, setViewMode] = useState<ViewMode>('map');
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<string>(FILTER_ALL);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [region, setRegion] = useState<MapRegion | null>(null);
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [tracksChanges, setTracksChanges] = useState(true);
  const mapRef = useRef<MapView | null>(null);
  const framedOnce = useRef(false);

  // The filters that the DATA layer can answer go to the api; the ones that are
  // pure predicates over the result (spare key) stay here. Splitting them this
  // way means the local ledger and the Worker apply the same filter set, and the
  // one filter neither supports is not silently different between them.
  const apiFilters: NeighbourFilters | undefined = useMemo(() => {
    const filters: NeighbourFilters = {};
    if (search.trim()) filters.search = search.trim();
    if (activeFilter === FILTER_FAVORITES) filters.is_favorite = true;
    else if (activeFilter !== FILTER_ALL && activeFilter !== FILTER_KEY_HOLDERS) {
      filters.relation = activeFilter as NeighbourFilters['relation'];
    }
    return Object.keys(filters).length > 0 ? filters : undefined;
  }, [search, activeFilter]);

  const { data: neighbours = [], isLoading } = useNeighbours(householdId, apiFilters);
  const { data: neighbourhoods = [] } = useNeighbourhoods(householdId);
  const { toggleFavorite } = useNeighbourMutations(householdId);
  const { origin, resolving: originResolving, unresolvable } = useNeighbourOrigin(currentHousehold);

  const visible = useMemo(
    () =>
      activeFilter === FILTER_KEY_HOLDERS
        ? neighbours.filter((neighbour) => neighbour.has_spare_key)
        : neighbours,
    [neighbours, activeFilter]
  );

  const selected = useMemo(
    () => visible.find((neighbour) => neighbour.id === selectedId) ?? null,
    [visible, selectedId]
  );

  /**
   * Frame the map ONCE, on the first render that has something to frame.
   *
   * Re-framing on every data change would yank the map out from under a member
   * who has panned somewhere deliberately — including on a peer's write
   * arriving, which is the worst version because they did not touch anything.
   */
  useEffect(() => {
    if (framedOnce.current) return;
    if (originResolving) return;
    const points = [...visible.map((n) => ({ latitude: n.latitude, longitude: n.longitude }))];
    if (origin) points.push(origin);
    const next = points.length > 0 ? regionForPoints(points) : null;
    if (next) {
      framedOnce.current = true;
      setRegion(next);
      mapRef.current?.animateToRegion(next as Region, 400);
    } else if (origin) {
      framedOnce.current = true;
      setRegion(regionAround(origin));
    }
  }, [visible, origin, originResolving]);

  // Markers can stop re-rasterising once the first frame has painted. 600ms is
  // comfortably past the avatars' own layout pass without being perceptible.
  useEffect(() => {
    const timer = setTimeout(() => setTracksChanges(false), 600);
    return () => clearTimeout(timer);
  }, []);

  const clusters = useMemo(() => {
    if (!region) return [];
    return clusterPoints(visible, region);
  }, [visible, region]);

  const handleLongPress = useCallback(
    (event: LongPressEvent) => {
      const { coordinate } = event.nativeEvent;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setSelectedId(null);
      // Straight to the form with the coordinate — the form does the reverse
      // geocode itself and shows its own "finding the address" state. Doing it
      // here would leave the member looking at an unchanged map wondering
      // whether their press registered.
      navigation.navigate('AddEditNeighbour', {
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
        prefill: {
          place_source: 'map_tap',
        },
      });
    },
    [navigation]
  );

  const handleCentreOnMe = useCallback(async () => {
    const outcome = await getDevicePosition();
    if (outcome.status === 'ok') {
      const next = regionAround(outcome.point);
      setRegion(next);
      mapRef.current?.animateToRegion(next as Region, 400);
      return;
    }
    // Three outcomes, three answers. "Something went wrong" would be true and
    // useless in both failing cases.
    showToast(
      'info',
      outcome.status === 'denied'
        ? 'Location is off for Symply. Turn it on in Settings to centre the map on you.'
        : 'Could not get a location fix. Try again outside or move the map by hand.'
    );
  }, []);

  const handleClusterPress = useCallback(
    (items: NeighbourWithPeople[], centre: { latitude: number; longitude: number }) => {
      if (items.length === 1) {
        setSelectedId(items[0]!.id);
        return;
      }
      // Zoom IN on a cluster rather than opening a list of its members. The
      // member's question is "which of these", and the map already answers it
      // once the pins separate — a list would make them re-find the same homes
      // in a second representation.
      const next = regionForPoints(items, 0.6) ?? regionAround(centre);
      setRegion(next);
      mapRef.current?.animateToRegion(next as Region, 350);
    },
    []
  );

  const filterTabs = useMemo(
    () => [
      { id: FILTER_ALL, label: 'All' },
      { id: FILTER_FAVORITES, label: 'Favourites' },
      { id: FILTER_KEY_HOLDERS, label: 'Has our key' },
      { id: 'next_door', label: RELATION_INFO.next_door.short },
      { id: 'across', label: RELATION_INFO.across.short },
    ],
    []
  );

  const mapHeight = Math.max(320, windowHeight - insets.top - insets.bottom - 210);

  const addOptions = [
    {
      key: 'map',
      icon: 'map',
      title: 'Pick on the map',
      subtitle: 'Tap the house — we fill in the address',
      onPress: () =>
        navigation.navigate('NeighbourPickOnMap', {
          returnTo: 'add',
          initialLatitude: region?.latitude ?? origin?.latitude,
          initialLongitude: region?.longitude ?? origin?.longitude,
        }),
    },
    {
      key: 'contacts',
      icon: 'people',
      title: 'From your contacts',
      subtitle: 'Bring people you already have numbers for',
      onPress: () => navigation.navigate('NeighbourImportContacts'),
    },
    {
      key: 'manual',
      icon: 'create',
      title: 'Enter by hand',
      subtitle: 'Type a name and address yourself',
      onPress: () => navigation.navigate('AddEditNeighbour', undefined),
    },
  ];

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container} testID="neighbours-screen">
        <ScreenHeader
          title="Neighbours"
          showBackButton
          onBackPress={() => navigation.goBack()}
          showNotificationBell={false}
          showAvatar={false}
        />

        <AdaptiveContainer padding={containerPadding}>
          <View style={styles.controls}>
            <SearchBar
              value={search}
              onChangeText={setSearch}
              placeholder="Search neighbours"
              testID="neighbours-search"
            />
            <View style={styles.controlRow}>
              <View style={styles.filterWrap}>
                <FilterTabs
                  tabs={filterTabs}
                  activeTab={activeFilter}
                  onTabChange={setActiveFilter}
                />
              </View>
              <TouchableOpacity
                style={[styles.modeToggle, { backgroundColor: colors.pillBackground }]}
                onPress={() => setViewMode((mode) => (mode === 'map' ? 'list' : 'map'))}
                testID="neighbours-view-toggle"
                accessibilityRole="button"
                accessibilityLabel={viewMode === 'map' ? 'Show list' : 'Show map'}
              >
                <Icon name={viewMode === 'map' ? 'list' : 'map'} size={18} color={colors.primary} />
              </TouchableOpacity>
            </View>
          </View>
        </AdaptiveContainer>

        {isLoading ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : viewMode === 'map' ? (
          <View style={[styles.mapWrap, { height: mapHeight }]} testID="neighbours-map">
            <MapView
              ref={mapRef}
              provider={PROVIDER_DEFAULT}
              style={StyleSheet.absoluteFill}
              initialRegion={(region ?? undefined) as Region | undefined}
              region={(region ?? undefined) as Region | undefined}
              onRegionChangeComplete={(next) => setRegion(next)}
              onPress={() => setSelectedId(null)}
              onLongPress={handleLongPress}
              showsUserLocation={false}
              showsMyLocationButton={false}
              toolbarEnabled={false}
            >
              {/* The property itself, so every pin is read relative to home. */}
              {origin && (
                <Marker
                  coordinate={origin}
                  anchor={{ x: 0.5, y: 0.5 }}
                  tracksViewChanges={tracksChanges}
                  testID="neighbours-home-marker"
                >
                  <View
                    style={[
                      styles.homeMarker,
                      { backgroundColor: colors.primary, borderColor: colors.backgroundMain },
                    ]}
                  >
                    <Icon name="home" size={16} color={colors.white} />
                  </View>
                </Marker>
              )}

              {clusters.map((cluster) =>
                cluster.items.length === 1 ? (
                  <Marker
                    key={cluster.key}
                    coordinate={{ latitude: cluster.latitude, longitude: cluster.longitude }}
                    anchor={{ x: 0.5, y: 1 }}
                    tracksViewChanges={tracksChanges}
                    onPress={() => setSelectedId(cluster.items[0]!.id)}
                    testID={`neighbour-marker-${cluster.items[0]!.id}`}
                  >
                    <NeighbourMapMarker
                      neighbour={cluster.items[0]!}
                      selected={cluster.items[0]!.id === selectedId}
                      householdId={householdId}
                    />
                  </Marker>
                ) : (
                  <Marker
                    key={cluster.key}
                    coordinate={{ latitude: cluster.latitude, longitude: cluster.longitude }}
                    anchor={{ x: 0.5, y: 0.5 }}
                    tracksViewChanges={tracksChanges}
                    onPress={() =>
                      handleClusterPress(cluster.items, {
                        latitude: cluster.latitude,
                        longitude: cluster.longitude,
                      })
                    }
                    testID={`neighbour-cluster-${cluster.key}`}
                  >
                    <NeighbourClusterMarker
                      homeCount={cluster.items.length}
                      personCount={cluster.items.reduce((sum, item) => sum + item.person_count, 0)}
                    />
                  </Marker>
                )
              )}
            </MapView>

            <View style={[styles.mapControls, { top: Spacing.md }]}>
              <TouchableOpacity
                style={[styles.mapButton, { backgroundColor: colors.backgroundMain }]}
                onPress={handleCentreOnMe}
                testID="neighbours-centre-me"
                accessibilityRole="button"
                accessibilityLabel="Centre on my location"
              >
                <Icon name="locate" size={20} color={colors.primary} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.mapButton, { backgroundColor: colors.backgroundMain }]}
                onPress={() => navigation.navigate('Neighbourhoods')}
                testID="neighbours-areas-button"
                accessibilityRole="button"
                accessibilityLabel="Neighbourhoods"
              >
                <Icon name="layers" size={20} color={colors.primary} />
                {neighbourhoods.length > 0 && (
                  <View style={[styles.badgeDot, { backgroundColor: colors.primary }]} />
                )}
              </TouchableOpacity>
            </View>

            {/* The hint sits on the map, not in a toast: it is the one gesture
                nobody discovers, and it must be readable at the moment the
                member is looking for somewhere to start. It goes away as soon as
                there is anything on the map, which is after the first add. */}
            {visible.length === 0 && (
              <View
                style={[styles.hint, { backgroundColor: `${colors.backgroundMain}F2` }]}
                pointerEvents="none"
                testID="neighbours-empty-hint"
              >
                <Icon name="hand-left" size={18} color={colors.primary} />
                <Typography variant="subheadline" weight="medium" style={{ textAlign: 'center' }}>
                  Press and hold a house to add your first neighbour
                </Typography>
                {unresolvable && (
                  <Typography
                    variant="caption1"
                    color={colors.textSecondary}
                    style={{ textAlign: 'center' }}
                  >
                    We could not place your own address, so the map starts where you are.
                  </Typography>
                )}
              </View>
            )}

            {selected && (
              <View style={[styles.peekWrap, { bottom: Spacing.md }]}>
                <NeighbourPeekCard
                  neighbour={selected}
                  unitSystem={unitSystem}
                  householdId={householdId}
                  onOpen={() =>
                    navigation.navigate('NeighbourDetail', { neighbourId: selected.id })
                  }
                  onClose={() => setSelectedId(null)}
                />
              </View>
            )}
          </View>
        ) : (
          <AdaptiveContainer padding={containerPadding}>
            <ScrollView
              style={styles.list}
              contentContainerStyle={styles.listContent}
              keyboardShouldPersistTaps="handled"
              testID="neighbours-list"
            >
              {visible.length === 0 ? (
                <EmptyState
                  icon="people"
                  title="No neighbours yet"
                  description="Add the homes around you so everyone in the household knows who to call — and who has a key."
                  action={{ label: 'Add a neighbour', onPress: () => setAddSheetOpen(true) }}
                />
              ) : (
                visible.map((neighbour) => (
                  <NeighbourCard
                    key={neighbour.id}
                    neighbour={neighbour}
                    unitSystem={unitSystem}
                    householdId={householdId}
                    onPress={() =>
                      navigation.navigate('NeighbourDetail', { neighbourId: neighbour.id })
                    }
                    onToggleFavorite={() => {
                      toggleFavorite.mutate({
                        id: neighbour.id,
                        isFavorite: !neighbour.is_favorite,
                      });
                    }}
                    testID={`neighbour-card-${neighbour.id}`}
                  />
                ))
              )}
              <ScreenScrollEnd testID="neighbours-screen-scroll-end" />
            </ScrollView>
          </AdaptiveContainer>
        )}

        {/* A plain round FAB rather than the shared `FloatingActionButton`: this
            one opens a CHOICE of three ways to add, and a full-width pill
            labelled "Add Neighbour" would promise a form and deliver a sheet. */}
        <TouchableOpacity
          style={[
            styles.fab,
            { backgroundColor: colors.primary, bottom: insets.bottom + Spacing.xl },
          ]}
          onPress={() => setAddSheetOpen(true)}
          testID="neighbours-add-fab"
          accessibilityRole="button"
          accessibilityLabel="Add a neighbour"
        >
          <Icon name="add" size={28} color={colors.white} />
        </TouchableOpacity>

        <BottomSheet
          visible={addSheetOpen}
          onClose={() => setAddSheetOpen(false)}
          title="Add a neighbour"
          height="content"
          showCloseButton
        >
          <View style={styles.sheetBody} testID="neighbours-add-sheet">
            {addOptions.map((option) => (
              <TouchableOpacity
                key={option.key}
                style={[styles.sheetRow, { backgroundColor: colors.backgroundSecondary }]}
                onPress={() => {
                  setAddSheetOpen(false);
                  option.onPress();
                }}
                testID={`neighbours-add-${option.key}`}
                accessibilityRole="button"
                // The subtitle is the half that says what the option actually
                // does; labelling the row hides it, so it goes in the label.
                accessibilityLabel={`${option.title}. ${option.subtitle}`}
              >
                <View style={[styles.sheetIcon, { backgroundColor: `${colors.primary}1A` }]}>
                  <Icon name={option.icon} size={20} color={colors.primary} />
                </View>
                <View style={styles.sheetText}>
                  <Typography variant="body" weight="semibold">
                    {option.title}
                  </Typography>
                  <Typography variant="caption1" color={colors.textSecondary}>
                    {option.subtitle}
                  </Typography>
                </View>
                <Icon name="chevron-forward" size={18} color={colors.textTertiary} />
              </TouchableOpacity>
            ))}
          </View>
        </BottomSheet>
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  controls: { gap: Spacing.sm, paddingBottom: Spacing.sm },
  controlRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  filterWrap: { flex: 1 },
  modeToggle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  mapWrap: {
    marginHorizontal: Spacing.md,
    borderRadius: CornerRadius.xl,
    overflow: 'hidden',
  },
  mapControls: {
    position: 'absolute',
    right: Spacing.md,
    gap: Spacing.sm,
  },
  mapButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  badgeDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  homeMarker: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    top: '42%',
    borderRadius: CornerRadius.lg,
    padding: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.sm,
  },
  peekWrap: {
    position: 'absolute',
    left: Spacing.md,
    right: Spacing.md,
  },
  list: { flex: 1 },
  listContent: { paddingBottom: 140 },
  fab: {
    position: 'absolute',
    right: Spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  sheetBody: { gap: Spacing.sm, paddingBottom: Spacing.md },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: CornerRadius.lg,
  },
  sheetIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetText: { flex: 1 },
});
