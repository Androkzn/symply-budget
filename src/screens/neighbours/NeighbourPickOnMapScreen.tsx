import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import type { RouteProp } from 'expo-router/react-navigation';
import { useNavigation, useRoute } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT, type Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBackground, ScreenHeader } from '@components/common';
import { GradientButton, Icon, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { useNeighbourOrigin, useNeighbours } from '@hooks/useNeighbours';
import type { NeighboursStackParamList } from '@navigation/types';
import { getDevicePosition, reverseGeocode, type GeocodeResult } from '@services/geocoding';
import { showToast } from '@services/toastManager';
import { useHouseholdStore } from '@stores/householdStore';
import { CornerRadius, Spacing, useAppColors } from '@theme';
import { regionAround, suggestRelation, type MapRegion } from '@utils/neighbourGeo';

type Nav = NativeStackNavigationProp<NeighboursStackParamList>;
type Route = RouteProp<NeighboursStackParamList, 'NeighbourPickOnMap'>;

/**
 * Drop a pin on a house — the feature's centre of gravity.
 *
 * ## The crosshair moves the map, not the pin
 *
 * The pin is FIXED at the centre of the screen and the map slides underneath it.
 * The alternative — a draggable marker — is the obvious design and is worse in
 * three concrete ways: the member's thumb covers the exact spot they are aiming
 * at, precision is bounded by finger size rather than by zoom, and the marker
 * can be dragged off-screen. Every ride-hailing and delivery app converged on
 * the fixed-centre crosshair for these reasons, and a house needs more precision
 * than a kerbside pickup, not less.
 *
 * ## The address resolves while you move, and is DEBOUNCED
 *
 * Reverse geocoding on every region change would fire dozens of lookups per pan
 * and be rate-limited within seconds. The lookup runs 500 ms after the map
 * settles, which is below the threshold where a member notices a delay and far
 * above the rate a pan generates.
 *
 * Every in-flight lookup is invalidated by the next one (`requestSeq`). Without
 * that, a slow response from three pans ago lands last and labels the pin with
 * an address the member has already moved away from — which is worse than no
 * address, because it looks authoritative.
 *
 * ## A failed lookup does not block the save
 *
 * "Address unavailable" is a normal outcome (offline, rural, a brand-new
 * subdivision) and it must not stop the member recording their neighbour. The
 * coordinates are what this feature actually needs; the address is a convenience
 * the member can type later. The button stays enabled and says so.
 *
 * ## The existing pins stay visible
 *
 * Muted, non-interactive, but present — so the member can see they are about to
 * add a second pin to a house that already has one, which is the single most
 * common way this feature would accumulate duplicates.
 */

const GEOCODE_DEBOUNCE_MS = 500;

export function NeighbourPickOnMapScreen() {
  const colors = useAppColors();
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const { currentHousehold } = useHouseholdStore();
  const householdId = currentHousehold?.id;
  const { origin } = useNeighbourOrigin(currentHousehold);
  const { data: existing = [] } = useNeighbours(householdId);

  const { returnTo, neighbourId, initialLatitude, initialLongitude } = route.params ?? {
    returnTo: 'add' as const,
  };

  const [region, setRegion] = useState<MapRegion | null>(() =>
    initialLatitude != null && initialLongitude != null
      ? regionAround({ latitude: initialLatitude, longitude: initialLongitude })
      : null
  );
  const [address, setAddress] = useState<GeocodeResult | null>(null);
  const [resolving, setResolving] = useState(false);
  const mapRef = useRef<MapView | null>(null);
  const framed = useRef(region !== null);
  // Monotonic — every lookup carries the sequence it was started at, and a
  // response whose sequence is stale is dropped. See the header.
  const requestSeq = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Open on the property, when nothing more specific was passed.
  useEffect(() => {
    if (framed.current || !origin) return;
    framed.current = true;
    setRegion(regionAround(origin));
  }, [origin]);

  const resolveAddress = useCallback((centre: { latitude: number; longitude: number }) => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      const seq = (requestSeq.current += 1);
      setResolving(true);
      const result = await reverseGeocode(centre);
      if (seq !== requestSeq.current) return; // A newer pan has already started.
      setAddress(result);
      setResolving(false);
    }, GEOCODE_DEBOUNCE_MS);
  }, []);

  // Hoisted out of the effect so the dependency array can name the two values
  // that actually matter. Depending on `region` itself would re-run the lookup
  // on every pinch, and a pure zoom does not change the address under the pin.
  const centreLat = region?.latitude;
  const centreLon = region?.longitude;

  useEffect(() => {
    if (centreLat !== undefined && centreLon !== undefined) {
      resolveAddress({ latitude: centreLat, longitude: centreLon });
    }
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [centreLat, centreLon, resolveAddress]);

  const handleCentreOnMe = useCallback(async () => {
    const outcome = await getDevicePosition();
    if (outcome.status !== 'ok') {
      showToast(
        'info',
        outcome.status === 'denied'
          ? 'Location is off for Symply. Turn it on in Settings, or move the map by hand.'
          : 'Could not get a location fix. Move the map by hand instead.'
      );
      return;
    }
    const next = regionAround(outcome.point);
    setRegion(next);
    mapRef.current?.animateToRegion(next as Region, 400);
  }, []);

  const handleConfirm = useCallback(() => {
    if (!region) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const point = { latitude: region.latitude, longitude: region.longitude };
    const prefill = {
      address_line1: address?.address_line1 ?? null,
      city: address?.city ?? null,
      state_province: address?.state_province ?? null,
      postal_code: address?.postal_code ?? null,
      country: address?.country ?? null,
      formatted_address: address?.formatted_address ?? null,
      // The pin was placed by hand; the address (if any) was derived from it.
      // The distinction is stored, and the detail card shows it.
      place_source: 'map_tap' as const,
    };

    // `replace`, not `navigate`: the picker is a step on the way to the form,
    // not a place to come back to. Leaving it on the stack means "back" from
    // the form returns to a map showing a pin the member already committed.
    if (returnTo === 'edit' && neighbourId) {
      navigation.replace('AddEditNeighbour', {
        neighbourId,
        latitude: point.latitude,
        longitude: point.longitude,
        prefill,
      });
    } else {
      navigation.replace('AddEditNeighbour', {
        latitude: point.latitude,
        longitude: point.longitude,
        prefill,
      });
    }
  }, [region, address, returnTo, neighbourId, navigation]);

  const suggestion = region
    ? suggestRelation(origin, { latitude: region.latitude, longitude: region.longitude })
    : 'nearby';

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container} testID="neighbour-pick-screen">
        <ScreenHeader
          title="Pick the house"
          showBackButton
          onBackPress={() => navigation.goBack()}
          showNotificationBell={false}
          showAvatar={false}
        />

        <View style={styles.mapWrap}>
          <MapView
            ref={mapRef}
            provider={PROVIDER_DEFAULT}
            style={StyleSheet.absoluteFill}
            initialRegion={(region ?? undefined) as Region | undefined}
            onRegionChangeComplete={(next) => setRegion(next)}
            showsUserLocation={false}
            showsMyLocationButton={false}
            toolbarEnabled={false}
            testID="neighbour-pick-map"
          >
            {origin && (
              <Marker coordinate={origin} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
                <View
                  style={[
                    styles.homeMarker,
                    { backgroundColor: colors.primary, borderColor: colors.backgroundMain },
                  ]}
                >
                  <Icon name="home" size={14} color={colors.white} />
                </View>
              </Marker>
            )}
            {/* Already-recorded homes, muted. See the header — this is the
                duplicate guard, and it costs one glance instead of a dialog. */}
            {existing.map((neighbour) => (
              <Marker
                key={neighbour.id}
                coordinate={{ latitude: neighbour.latitude, longitude: neighbour.longitude }}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={false}
                opacity={0.55}
                testID={`neighbour-pick-existing-${neighbour.id}`}
              >
                <View
                  style={[
                    styles.existingMarker,
                    { backgroundColor: colors.textTertiary, borderColor: colors.backgroundMain },
                  ]}
                />
              </Marker>
            ))}
          </MapView>

          {/* The crosshair. `pointerEvents="none"` so every gesture reaches the
              map underneath — without it the pin swallows the pan it exists to
              be moved by. */}
          <View style={styles.crosshair} pointerEvents="none" testID="neighbour-pick-crosshair">
            <View style={[styles.crosshairPin, { borderColor: colors.primary }]}>
              <View style={[styles.crosshairDot, { backgroundColor: colors.primary }]} />
            </View>
            <View style={[styles.crosshairStem, { backgroundColor: colors.primary }]} />
            <View style={[styles.crosshairShadow, { backgroundColor: `${colors.black}22` }]} />
          </View>

          <TouchableOpacity
            style={[
              styles.mapButton,
              { backgroundColor: colors.backgroundMain, top: Spacing.md, right: Spacing.md },
            ]}
            onPress={handleCentreOnMe}
            testID="neighbour-pick-centre-me"
            accessibilityRole="button"
            accessibilityLabel="Centre on my location"
          >
            <Icon name="locate" size={20} color={colors.primary} />
          </TouchableOpacity>
        </View>

        <View
          style={[
            styles.footer,
            {
              backgroundColor: colors.backgroundMain,
              paddingBottom: insets.bottom + Spacing.md,
              borderTopColor: colors.borderColor,
            },
          ]}
        >
          <View style={styles.addressRow}>
            <Icon name="location" size={18} color={colors.primary} />
            <View style={styles.addressText}>
              {resolving ? (
                <View style={styles.resolvingRow}>
                  <ActivityIndicator size="small" color={colors.textSecondary} />
                  <Typography variant="subheadline" color={colors.textSecondary}>
                    Finding the address…
                  </Typography>
                </View>
              ) : address?.formatted_address ? (
                <Typography
                  variant="subheadline"
                  weight="medium"
                  numberOfLines={2}
                  testID="neighbour-pick-address"
                >
                  {address.formatted_address}
                </Typography>
              ) : (
                <Typography
                  variant="subheadline"
                  color={colors.textSecondary}
                  testID="neighbour-pick-address"
                >
                  No address here — you can still save the spot and name it yourself.
                </Typography>
              )}
              {!!region && (
                <Typography variant="caption2" color={colors.textTertiary}>
                  {region.latitude.toFixed(5)}, {region.longitude.toFixed(5)}
                  {suggestion === 'next_door'
                    ? ' · looks like next door'
                    : suggestion === 'across'
                      ? ' · looks like across the street'
                      : suggestion === 'behind'
                        ? ' · looks like it backs onto you'
                        : ''}
                </Typography>
              )}
            </View>
          </View>

          <GradientButton
            title="Use this spot"
            onPress={handleConfirm}
            disabled={!region}
            testID="neighbour-pick-confirm"
          />
        </View>
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  mapWrap: { flex: 1, overflow: 'hidden' },
  crosshair: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crosshairPin: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    // Lifts the ring so its CENTRE sits on the map centre once the stem and the
    // ground shadow below it are accounted for.
    marginBottom: 26,
  },
  crosshairDot: { width: 6, height: 6, borderRadius: 3 },
  crosshairStem: {
    position: 'absolute',
    width: 2,
    height: 18,
    top: '50%',
    marginTop: -8,
  },
  crosshairShadow: {
    position: 'absolute',
    width: 14,
    height: 5,
    borderRadius: 7,
    top: '50%',
    marginTop: 10,
  },
  homeMarker: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  existingMarker: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
  },
  mapButton: {
    position: 'absolute',
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
  footer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: CornerRadius.xl,
    borderTopRightRadius: CornerRadius.xl,
    gap: Spacing.md,
  },
  addressRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  addressText: { flex: 1, gap: 2 },
  resolvingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
});
