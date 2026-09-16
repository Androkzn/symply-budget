import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from 'expo-router/react-navigation';
import { useNavigation, useRoute } from 'expo-router/react-navigation';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Linking, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT, type Region } from 'react-native-maps';

import { PERSON_ROLE_INFO, PLACE_SOURCE_LABELS, RELATION_INFO } from '@api/neighbours';
import type { NeighbourPerson } from '@api/neighbours';
import { AppBackground, ScreenHeader, ScreenScrollEnd, screenScrollViewStyle } from '@components/common';
import { HouseBlobImage } from '@components/house-v2';
import { AdaptiveContainer } from '@components/layout';
import { NeighbourAvatar } from '@components/neighbours';
import { Chip, FavoriteStar, Icon, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { useNeighbourMutations, useNeighbours } from '@hooks/useNeighbours';
import type { NeighboursStackParamList } from '@navigation/types';
import { exportPersonToContacts } from '@services/neighbourContacts';
import { showToast } from '@services/toastManager';
import { useHouseholdStore } from '@stores/householdStore';
import { CornerRadius, Spacing, useAppColors } from '@theme';
import { formatDistance, regionAround, shortAddressLabel } from '@utils/neighbourGeo';

type Nav = NativeStackNavigationProp<NeighboursStackParamList>;
type Route = RouteProp<NeighboursStackParamList, 'NeighbourDetail'>;

/**
 * One home, in full.
 *
 * ## The map at the top is not decoration
 *
 * It is a small, non-interactive frame around this pin and the property, and it
 * is the fastest way to answer *"is this the one I mean?"* — a question a member
 * arriving from a list has no other way to settle. It is `scrollEnabled={false}`
 * and `pointerEvents="none"`: a live map inside a scroll view eats the scroll
 * gesture, and there is nothing here to pan to.
 *
 * ## Export to Contacts is per PERSON, and it is a first-class action
 *
 * Not a hidden menu item. A member who has recorded a neighbour's number wants
 * it where they actually make calls — the phone app, the car, the watch — and
 * this is the button that puts it there. The export always CREATES a contact
 * (never merges into an existing one), which the confirmation says plainly.
 *
 * ## Everything destructive lives on the edit screen
 *
 * Except removing a person, which is here because removing one occupant is not
 * destructive in the same way and forcing a member through a full edit form to
 * do it is the sort of friction that makes a list go stale.
 */

export function NeighbourDetailScreen() {
  const colors = useAppColors();
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { content: containerPadding } = useLayoutPadding();
  const { currentHousehold } = useHouseholdStore();
  const householdId = currentHousehold?.id;
  const unitSystem: 'metric' | 'imperial' =
    currentHousehold?.unit_system === 'imperial' ? 'imperial' : 'metric';

  const { neighbourId } = route.params;
  const { data: neighbours = [], isLoading } = useNeighbours(householdId);
  const mutations = useNeighbourMutations(householdId);
  const [exportingId, setExportingId] = useState<string | null>(null);

  const neighbour = useMemo(
    () => neighbours.find((candidate) => candidate.id === neighbourId) ?? null,
    [neighbours, neighbourId]
  );

  const handleExport = useCallback(
    async (person: NeighbourPerson) => {
      if (!neighbour) return;
      setExportingId(person.id);
      const outcome = await exportPersonToContacts(person, neighbour);
      setExportingId(null);
      if (outcome.status === 'ok') {
        // The link is stored so a later re-import updates this row rather than
        // creating a second one. See `neighbourContacts.ts` on why nothing here
        // matches by name.
        await mutations.updatePerson
          .mutateAsync({
            personId: person.id,
            data: { device_contact_id: outcome.contactId },
          })
          .catch(() => undefined);
        showToast('success', `${person.name} saved to your contacts`);
        return;
      }
      showToast(
        'info',
        outcome.status === 'denied'
          ? 'Symply needs access to Contacts to save someone. You can turn it on in Settings.'
          : 'Could not save that contact. Try again.'
      );
    },
    [neighbour, mutations]
  );

  const handleRemovePerson = useCallback(
    (person: NeighbourPerson) => {
      Alert.alert(`Remove ${person.name}?`, 'They will be removed from this home on every device.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            mutations.removePerson.mutate(person.id);
          },
        },
      ]);
    },
    [mutations]
  );

  if (isLoading && !neighbour) {
    return (
      <AppBackground opacity={0.5}>
        <View style={styles.container}>
          <ScreenHeader
            title="Neighbour"
            showBackButton
            onBackPress={() => navigation.goBack()}
            showNotificationBell={false}
            showAvatar={false}
          />
          <View style={styles.loading}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        </View>
      </AppBackground>
    );
  }

  if (!neighbour) {
    // Reachable in one real way: a peer deleted this home while the screen was
    // open. Saying so beats an empty screen or a crash.
    return (
      <AppBackground opacity={0.5}>
        <View style={styles.container}>
          <ScreenHeader
            title="Neighbour"
            showBackButton
            onBackPress={() => navigation.goBack()}
            showNotificationBell={false}
            showAvatar={false}
          />
          <View style={styles.loading} testID="neighbour-detail-missing">
            <Typography variant="body" color={colors.textSecondary}>
              This neighbour is no longer in your household.
            </Typography>
          </View>
        </View>
      </AppBackground>
    );
  }

  const relation = RELATION_INFO[neighbour.relation] ?? RELATION_INFO.other;
  const distance = formatDistance(neighbour.distance_meters, unitSystem);
  const region = regionAround(neighbour, 0.003);

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container} testID="neighbour-detail-screen">
        <ScreenHeader
          title={neighbour.label}
          showBackButton
          onBackPress={() => navigation.goBack()}
          showNotificationBell={false}
          showAvatar={false}
        />

        <AdaptiveContainer padding={containerPadding}>
          <ScrollView
            style={screenScrollViewStyle.scroll}
            contentContainerStyle={styles.content}
            testID="neighbour-detail-scroll"
          >
            <View style={styles.mapCard}>
              <MapView
                provider={PROVIDER_DEFAULT}
                style={StyleSheet.absoluteFill}
                initialRegion={region as Region}
                scrollEnabled={false}
                zoomEnabled={false}
                rotateEnabled={false}
                pitchEnabled={false}
                pointerEvents="none"
                toolbarEnabled={false}
              >
                <Marker coordinate={neighbour} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
                  <View
                    style={[
                      styles.pin,
                      { backgroundColor: relation.color, borderColor: colors.backgroundMain },
                    ]}
                  />
                </Marker>
              </MapView>
              <TouchableOpacity
                style={[styles.directionsChip, { backgroundColor: colors.backgroundMain }]}
                onPress={() =>
                  Linking.openURL(
                    Platform.select({
                      ios: `http://maps.apple.com/?ll=${neighbour.latitude},${neighbour.longitude}&q=${encodeURIComponent(neighbour.label)}`,
                      default: `geo:${neighbour.latitude},${neighbour.longitude}?q=${neighbour.latitude},${neighbour.longitude}(${encodeURIComponent(neighbour.label)})`,
                    })
                  )
                }
                testID="neighbour-detail-directions"
                accessibilityRole="button"
                accessibilityLabel="Directions"
              >
                <Icon name="navigate" size={16} color={colors.primary} />
                <Typography variant="caption1" weight="medium" color={colors.primary}>
                  Directions
                </Typography>
              </TouchableOpacity>
            </View>

            {neighbour.photo_blob && (
              <View style={styles.photoCard} testID="neighbour-detail-photo">
                <HouseBlobImage
                  descriptor={neighbour.photo_blob}
                  householdId={householdId}
                  width={undefined}
                  height={180}
                  accessibilityLabel={`Photo of ${neighbour.label}`}
                  style={styles.photo}
                />
              </View>
            )}

            <View style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
              <View style={styles.titleRow}>
                <View style={styles.flex1}>
                  <Typography variant="title3" weight="semibold">
                    {neighbour.label}
                  </Typography>
                  <Typography variant="subheadline" color={colors.textSecondary}>
                    {shortAddressLabel(neighbour)}
                  </Typography>
                </View>
                <FavoriteStar
                  isFavorite={neighbour.is_favorite}
                  onToggle={() =>
                    mutations.toggleFavorite.mutate({
                      id: neighbour.id,
                      isFavorite: !neighbour.is_favorite,
                    })
                  }
                />
              </View>

              <View style={styles.chipRow}>
                <Chip label={relation.label} variant="secondary" />
                {!!distance && <Chip label={`${distance} away`} variant="secondary" outlined />}
                {neighbour.neighbourhood && (
                  <Chip label={neighbour.neighbourhood.name} variant="primary" outlined />
                )}
                {neighbour.has_spare_key && <Chip label="Has our key" variant="warning" />}
                {neighbour.is_emergency_contact && (
                  <Chip label="Emergency contact" variant="error" outlined />
                )}
              </View>

              {!!neighbour.notes && (
                <Typography variant="body" style={{ marginTop: Spacing.sm }}>
                  {neighbour.notes}
                </Typography>
              )}

              <Typography variant="caption2" color={colors.textTertiary}>
                {PLACE_SOURCE_LABELS[neighbour.place_source]}
              </Typography>
            </View>

            <View style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
              <Typography variant="caption1" weight="semibold" color={colors.textSecondary}>
                {neighbour.person_count === 0
                  ? 'NOBODY LISTED YET'
                  : neighbour.person_count === 1
                    ? '1 PERSON'
                    : `${neighbour.person_count} PEOPLE`}
              </Typography>

              {neighbour.people.length === 0 ? (
                <Typography variant="caption1" color={colors.textSecondary}>
                  Add the people who live here so everyone in your household knows who to call.
                </Typography>
              ) : (
                neighbour.people.map((person) => (
                  <View
                    key={person.id}
                    style={[styles.personRow, { borderColor: colors.borderColor }]}
                    testID={`neighbour-person-row-${person.id}`}
                  >
                    <NeighbourAvatar
                      name={person.name}
                      photo={person.photo_blob}
                      size={44}
                      householdId={householdId}
                    />
                    <View style={styles.flex1}>
                      <Typography variant="body" weight="medium" numberOfLines={1}>
                        {person.name}
                        {person.is_primary ? ' · main contact' : ''}
                      </Typography>
                      <Typography variant="caption1" color={colors.textSecondary} numberOfLines={1}>
                        {[PERSON_ROLE_INFO[person.role].label, person.phone, person.email]
                          .filter(Boolean)
                          .join(' · ')}
                      </Typography>
                    </View>
                    <View style={styles.personActions}>
                      {!!person.phone && (
                        <TouchableOpacity
                          onPress={() => Linking.openURL(`tel:${person.phone}`)}
                          testID={`neighbour-person-call-${person.id}`}
                          accessibilityRole="button"
                          accessibilityLabel={`Call ${person.name}`}
                        >
                          <Icon name="call" size={20} color={colors.primary} />
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        onPress={() => handleExport(person)}
                        disabled={exportingId === person.id}
                        testID={`neighbour-person-export-${person.id}`}
                        accessibilityRole="button"
                        accessibilityLabel={`Save ${person.name} to contacts`}
                      >
                        {exportingId === person.id ? (
                          <ActivityIndicator size="small" color={colors.primary} />
                        ) : (
                          <Icon name="person-add" size={20} color={colors.primary} />
                        )}
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleRemovePerson(person)}
                        testID={`neighbour-person-delete-${person.id}`}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${person.name}`}
                      >
                        <Icon name="trash" size={18} color={colors.textTertiary} />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              )}
            </View>

            <TouchableOpacity
              style={[styles.editButton, { backgroundColor: colors.primary }]}
              onPress={() => navigation.navigate('AddEditNeighbour', { neighbourId: neighbour.id })}
              testID="neighbour-detail-edit"
              accessibilityRole="button"
              accessibilityLabel="Edit this neighbour"
            >
              <Icon name="create" size={18} color={colors.white} />
              <Typography variant="body" weight="semibold" style={{ color: colors.white }}>
                Edit neighbour
              </Typography>
            </TouchableOpacity>

            {/* Scroll sentinel for the E2E scroll contract every screen in the
                fleet carries. See `screenScrollEndTestId`. */}
            <ScreenScrollEnd testID="neighbour-detail-screen-scroll-end" />
          </ScrollView>
        </AdaptiveContainer>
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  content: { paddingBottom: 100, gap: Spacing.md },
  mapCard: {
    height: 160,
    borderRadius: CornerRadius.lg,
    overflow: 'hidden',
  },
  pin: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 3,
  },
  directionsChip: {
    position: 'absolute',
    right: Spacing.sm,
    bottom: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: CornerRadius.xxl,
  },
  photoCard: { borderRadius: CornerRadius.lg, overflow: 'hidden' },
  photo: { width: '100%' },
  card: {
    borderRadius: CornerRadius.lg,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  flex1: { flex: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  personActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    borderRadius: CornerRadius.xxl,
  },
});
