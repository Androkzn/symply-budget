import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from 'expo-router/react-navigation';
import { useNavigation, useRoute } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

import type {
  CreateNeighbourPersonRequest,
  NeighbourPerson,
  NeighbourPersonRole,
  NeighbourPlaceSource,
  NeighbourRelation,
} from '@api/neighbours';
import { NEIGHBOUR_RELATIONS, PERSON_ROLE_INFO, RELATION_INFO } from '@api/neighbours';
import { AppBackground, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { HouseAttachmentField } from '@components/house-v2';
import { AdaptiveContainer } from '@components/layout';
import { NeighbourAvatar } from '@components/neighbours';
import {
  BottomSheet,
  Chip,
  GradientButton,
  Icon,
  TextInput,
  Toggle,
  Typography,
} from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import type { HouseBlobDescriptor } from '@features/house/local/blobs';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { useNeighbourMutations, useNeighbourhoods, useNeighbours } from '@hooks/useNeighbours';
import type { NeighboursStackParamList } from '@navigation/types';
import { reverseGeocode } from '@services/geocoding';
import { geocodeAddress } from '@services/geocoding';
import { showToast } from '@services/toastManager';
import { useHouseholdStore } from '@stores/householdStore';
import { CornerRadius, Spacing, useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';
import { composeFormattedAddress } from '@utils/neighbourGeo';

type Nav = NativeStackNavigationProp<NeighboursStackParamList>;
type Route = RouteProp<NeighboursStackParamList, 'AddEditNeighbour'>;

/**
 * Add or edit one home, and everyone in it.
 *
 * ## The people live HERE, not behind a second screen
 *
 * The obvious structure is "save the home, then open it, then add people one at
 * a time". It is wrong for the same reason a contact form does not make you save
 * a person before adding their phone number: the member is holding one thought —
 * *"the Wilsons, number 42, Sarah and Tom, Sarah's number is…"* — and every
 * screen boundary asks them to put half of it down. The occupants are edited
 * inline and saved with the home, in one write.
 *
 * On a local-first household that is not merely nicer, it is CORRECT: a home and
 * its occupants written as one ledger op reach a peer together or not at all,
 * where four separate saves can half-arrive and leave a family that is missing
 * two people with nothing to indicate it.
 *
 * ## Position is a first-class field with its own row
 *
 * Not buried among the address inputs. A neighbour without coordinates cannot
 * exist in this feature, so the position row is the one that turns Save on, it
 * is rendered first, and when it is empty it is the only actionable thing on the
 * screen. The address inputs below it are OPTIONAL and are labelled as such.
 *
 * ## Arriving from the map fills the address in, and says where it came from
 *
 * When the screen opens with coordinates and no address, it reverse-geocodes
 * once and drops the result into the fields — editable, because the geocoder's
 * idea of a rural address is often worse than the member's. `place_source`
 * records which of the two happened, and the detail card shows it.
 */

const ROLE_ORDER: NeighbourPersonRole[] = ['adult', 'child', 'tenant', 'owner', 'pet', 'other'];

/** A person being edited — an existing row, or one that has not been saved yet. */
type DraftPerson = {
  /** Present when this is an existing row; absent for a new one. */
  id?: string;
  name: string;
  role: NeighbourPersonRole;
  phone: string;
  email: string;
  notes: string;
  is_primary: boolean;
  photo_blob?: HouseBlobDescriptor;
  device_contact_id?: string | null;
};

function toDraft(person: NeighbourPerson): DraftPerson {
  return {
    id: person.id,
    name: person.name,
    role: person.role,
    phone: person.phone ?? '',
    email: person.email ?? '',
    notes: person.notes ?? '',
    is_primary: person.is_primary,
    photo_blob: person.photo_blob,
    device_contact_id: person.device_contact_id,
  };
}

function emptyDraft(isFirst: boolean): DraftPerson {
  return {
    name: '',
    role: 'adult',
    phone: '',
    email: '',
    notes: '',
    is_primary: isFirst,
  };
}

export function AddEditNeighbourScreen() {
  const colors = useAppColors();
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { content: containerPadding } = useLayoutPadding();
  const { currentHousehold } = useHouseholdStore();
  const householdId = currentHousehold?.id;

  const params = route.params ?? {};
  const editingId = params.neighbourId;
  const isEditing = Boolean(editingId);

  const { data: neighbours = [], isLoading } = useNeighbours(householdId);
  const { data: neighbourhoods = [] } = useNeighbourhoods(householdId);
  const mutations = useNeighbourMutations(householdId);

  const existing = useMemo(
    () => neighbours.find((neighbour) => neighbour.id === editingId) ?? null,
    [neighbours, editingId]
  );

  const [label, setLabel] = useState('');
  const [relation, setRelation] = useState<NeighbourRelation>('nearby');
  const [neighbourhoodId, setNeighbourhoodId] = useState<string | null>(null);
  const [addressLine1, setAddressLine1] = useState('');
  const [city, setCity] = useState('');
  const [stateProvince, setStateProvince] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [country, setCountry] = useState('');
  const [formattedAddress, setFormattedAddress] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [isFavorite, setIsFavorite] = useState(false);
  const [isEmergency, setIsEmergency] = useState(false);
  const [hasSpareKey, setHasSpareKey] = useState(false);
  const [photo, setPhoto] = useState<HouseBlobDescriptor | null>(null);
  const [placeSource, setPlaceSource] = useState<NeighbourPlaceSource>('manual');
  const [coordinates, setCoordinates] = useState<{ latitude: number; longitude: number } | null>(
    params.latitude != null && params.longitude != null
      ? { latitude: params.latitude, longitude: params.longitude }
      : null
  );
  const [people, setPeople] = useState<DraftPerson[]>([]);
  const [removedPersonIds, setRemovedPersonIds] = useState<string[]>([]);
  /**
   * Which occupant the sheet is editing.
   *
   * `null` = the sheet is closed, `'new'` = adding, a number = editing that row.
   * Three states rather than a `number | null` plus a boolean, because the two
   * would have to agree and the state where they do not (open, editing nothing)
   * is the one that renders an empty sheet over the form.
   */
  const [editingPersonIndex, setEditingPersonIndex] = useState<number | 'new' | null>(null);
  const [personDraft, setPersonDraft] = useState<DraftPerson>(emptyDraft(true));
  const [saving, setSaving] = useState(false);
  const [resolvingAddress, setResolvingAddress] = useState(false);

  const hydrated = useRef(false);
  const geocodedOnce = useRef(false);

  /** Load the row being edited, once. Re-running would discard live edits. */
  useEffect(() => {
    if (hydrated.current) return;
    if (isEditing && !existing) return;
    hydrated.current = true;

    if (existing) {
      setLabel(existing.label);
      setRelation(existing.relation);
      setNeighbourhoodId(existing.neighbourhood_id);
      setAddressLine1(existing.address_line1 ?? '');
      setCity(existing.city ?? '');
      setStateProvince(existing.state_province ?? '');
      setPostalCode(existing.postal_code ?? '');
      setCountry(existing.country ?? '');
      setFormattedAddress(existing.formatted_address);
      setNotes(existing.notes ?? '');
      setIsFavorite(existing.is_favorite);
      setIsEmergency(existing.is_emergency_contact);
      setHasSpareKey(existing.has_spare_key);
      setPhoto(existing.photo_blob ?? null);
      setPlaceSource(existing.place_source);
      setPeople(existing.people.map(toDraft));
      // A coordinate passed in params is a fresh pick from the map and WINS
      // over the stored one — that is the entire point of "change on map".
      setCoordinates((current) => current ?? { latitude: existing.latitude, longitude: existing.longitude });
    }

    const prefill = params.prefill;
    if (prefill) {
      if (prefill.label) setLabel(prefill.label);
      if (prefill.address_line1 !== undefined) setAddressLine1(prefill.address_line1 ?? '');
      if (prefill.city !== undefined) setCity(prefill.city ?? '');
      if (prefill.state_province !== undefined) setStateProvince(prefill.state_province ?? '');
      if (prefill.postal_code !== undefined) setPostalCode(prefill.postal_code ?? '');
      if (prefill.country !== undefined) setCountry(prefill.country ?? '');
      if (prefill.formatted_address !== undefined) {
        setFormattedAddress(prefill.formatted_address ?? null);
      }
      if (prefill.place_source) setPlaceSource(prefill.place_source);
      if (prefill.phone || prefill.email) {
        // Arrived from a contact import: the person is already known, so the
        // occupant list starts with them rather than empty.
        setPeople([
          {
            name: prefill.label ?? '',
            role: 'adult',
            phone: prefill.phone ?? '',
            email: prefill.email ?? '',
            notes: '',
            is_primary: true,
            device_contact_id: prefill.deviceContactId ?? null,
          },
        ]);
      }
    }
  }, [existing, isEditing, params.prefill]);

  /**
   * Fill the address in from the coordinate, once, when we have one and no
   * address. Guarded by a ref rather than by the address being empty: a member
   * who deliberately CLEARS the street line must not have it typed back in.
   */
  useEffect(() => {
    if (geocodedOnce.current) return;
    if (!coordinates) return;
    if (addressLine1 || formattedAddress) {
      geocodedOnce.current = true;
      return;
    }
    geocodedOnce.current = true;
    let cancelled = false;
    void (async () => {
      setResolvingAddress(true);
      const result = await reverseGeocode(coordinates);
      if (cancelled) return;
      setResolvingAddress(false);
      if (!result) return;
      setAddressLine1(result.address_line1 ?? '');
      setCity(result.city ?? '');
      setStateProvince(result.state_province ?? '');
      setPostalCode(result.postal_code ?? '');
      setCountry(result.country ?? '');
      setFormattedAddress(result.formatted_address);
    })();
    return () => {
      cancelled = true;
    };
  }, [coordinates, addressLine1, formattedAddress]);

  const canSave = Boolean(label.trim()) && Boolean(coordinates) && !saving;

  /**
   * Place a pin from the typed address.
   *
   * The escape hatch for the member who knows the address and does not want to
   * hunt for the roof — and the reason `place_source` exists: this pin is
   * `geocoded`, exact to whatever the provider knows and no more.
   */
  const handleGeocodeFromAddress = useCallback(async () => {
    const query = composeFormattedAddress({
      address_line1: addressLine1 || null,
      city: city || null,
      state_province: stateProvince || null,
      postal_code: postalCode || null,
      country: country || null,
    });
    if (!query) {
      showToast('info', 'Type at least a street and city, then try again.');
      return;
    }
    setResolvingAddress(true);
    const point = await geocodeAddress(query);
    setResolvingAddress(false);
    if (!point) {
      showToast('info', 'We could not find that address. Pick the house on the map instead.');
      return;
    }
    setCoordinates(point);
    setPlaceSource('geocoded');
    setFormattedAddress(query);
  }, [addressLine1, city, stateProvince, postalCode, country]);

  const openPersonEditor = useCallback(
    (index: number | 'new') => {
      setEditingPersonIndex(index);
      setPersonDraft(index === 'new' ? emptyDraft(people.length === 0) : people[index]!);
    },
    [people]
  );

  const commitPerson = useCallback(() => {
    if (!personDraft.name.trim()) return;
    setPeople((current) => {
      const next = [...current];
      if (editingPersonIndex === 'new' || editingPersonIndex === null) next.push(personDraft);
      else next[editingPersonIndex] = personDraft;
      // One primary, enforced here as well as in the api. Doing it in the UI
      // too means the member SEES the previous primary lose its badge in the
      // same tap, rather than discovering it after a save.
      if (personDraft.is_primary) {
        const keep =
          editingPersonIndex === 'new' || editingPersonIndex === null
            ? next.length - 1
            : editingPersonIndex;
        return next.map((person, index) =>
          index === keep ? person : { ...person, is_primary: false }
        );
      }
      return next;
    });
    setEditingPersonIndex(null);
    setPersonDraft(emptyDraft(false));
  }, [personDraft, editingPersonIndex]);

  const removePerson = useCallback((index: number) => {
    setPeople((current) => {
      const target = current[index];
      if (target?.id) setRemovedPersonIds((ids) => [...ids, target.id!]);
      const next = current.filter((_, i) => i !== index);
      // Never leave a home with people but no primary — the map bubble would
      // have no face to draw.
      if (next.length > 0 && !next.some((person) => person.is_primary)) {
        next[0] = { ...next[0]!, is_primary: true };
      }
      return next;
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!householdId || !coordinates || !label.trim()) return;
    setSaving(true);
    try {
      const base = {
        label: label.trim(),
        relation,
        neighbourhood_id: neighbourhoodId,
        address_line1: addressLine1 || null,
        city: city || null,
        state_province: stateProvince || null,
        postal_code: postalCode || null,
        country: country || null,
        formatted_address: formattedAddress,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        place_source: placeSource,
        photo_key: photo ? null : null,
        photo_blob: photo ?? undefined,
        notes: notes || null,
        is_favorite: isFavorite,
        is_emergency_contact: isEmergency,
        has_spare_key: hasSpareKey,
      };

      if (isEditing && editingId) {
        await mutations.update.mutateAsync({ id: editingId, data: base });
        // The occupants are reconciled against what was loaded: new drafts are
        // created, existing ones patched, and removals applied. A "delete all
        // then re-add" would be simpler and would change every person's id on
        // every save, breaking the contact links and the sort order.
        for (const personId of removedPersonIds) {
          await mutations.removePerson.mutateAsync(personId);
        }
        for (const [index, person] of people.entries()) {
          const payload = {
            name: person.name.trim(),
            role: person.role,
            phone: person.phone || null,
            email: person.email || null,
            notes: person.notes || null,
            is_primary: person.is_primary,
            sort_order: index,
            photo_blob: person.photo_blob,
            device_contact_id: person.device_contact_id ?? null,
          };
          if (person.id) {
            await mutations.updatePerson.mutateAsync({ personId: person.id, data: payload });
          } else {
            await mutations.addPerson.mutateAsync({ neighbourId: editingId, data: payload });
          }
        }
      } else {
        const payload: CreateNeighbourPersonRequest[] = people.map((person, index) => ({
          name: person.name.trim(),
          role: person.role,
          phone: person.phone || null,
          email: person.email || null,
          notes: person.notes || null,
          is_primary: person.is_primary,
          sort_order: index,
          photo_blob: person.photo_blob,
          device_contact_id: person.device_contact_id ?? null,
        }));
        // One call, one ledger op — the home and its family arrive together.
        await mutations.create.mutateAsync({ ...base, people: payload });
      }

      showToast('success', isEditing ? 'Neighbour updated' : 'Neighbour added');
      navigation.goBack();
    } catch (error) {
      showToast('error', 'Could not save this neighbour. Try again.');
      if (__DEV__) console.warn('[Neighbours] save failed', error);
    } finally {
      setSaving(false);
    }
  }, [
    householdId,
    coordinates,
    label,
    relation,
    neighbourhoodId,
    addressLine1,
    city,
    stateProvince,
    postalCode,
    country,
    formattedAddress,
    placeSource,
    photo,
    notes,
    isFavorite,
    isEmergency,
    hasSpareKey,
    isEditing,
    editingId,
    people,
    removedPersonIds,
    mutations,
    navigation,
  ]);

  const handleDelete = useCallback(() => {
    if (!editingId) return;
    Alert.alert(
      'Remove this neighbour?',
      'The home, everyone in it and any notes you kept will be deleted from every device in your household.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await mutations.remove.mutateAsync(editingId);
              showToast('success', 'Neighbour removed');
              // Two screens back: the detail screen this came from is now a
              // detail of nothing.
              navigation.navigate('NeighboursMap', undefined);
            } catch {
              showToast('error', 'Could not remove this neighbour.');
            }
          },
        },
      ]
    );
  }, [editingId, mutations, navigation]);

  if (isEditing && isLoading && !existing) {
    return (
      <AppBackground opacity={0.5}>
        <View style={styles.container}>
          <ScreenHeader
            title="Edit neighbour"
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

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container} testID="neighbour-form-screen">
        <ScreenHeader
          title={isEditing ? 'Edit neighbour' : 'New neighbour'}
          showBackButton
          onBackPress={() => navigation.goBack()}
          showNotificationBell={false}
          showAvatar={false}
        />

        <AdaptiveContainer padding={containerPadding}>
          <ScrollView
            {...keyboardDismissScrollProps}
            style={screenScrollViewStyle.scroll}
            contentContainerStyle={styles.content}
            testID="neighbour-form-scroll"
          >
            {/* ---- Where ---------------------------------------------------- */}
            <View style={[styles.section, { backgroundColor: colors.backgroundSecondary }]}>
              <Typography variant="caption1" weight="semibold" color={colors.textSecondary}>
                WHERE
              </Typography>
              <TouchableOpacity
                style={[styles.positionRow, { borderColor: colors.borderColor }]}
                onPress={() =>
                  navigation.navigate('NeighbourPickOnMap', {
                    returnTo: isEditing ? 'edit' : 'add',
                    neighbourId: editingId,
                    initialLatitude: coordinates?.latitude,
                    initialLongitude: coordinates?.longitude,
                  })
                }
                testID="neighbour-form-position"
                accessibilityRole="button"
                // Labelling the row makes iOS collapse its children out of the
                // accessibility tree, so the state below — set or not, and where —
                // is announced only if it is in the label itself. Without this a
                // VoiceOver user is told "change the position" and never told
                // whether there is one.
                accessibilityLabel={
                  coordinates
                    ? `Position set, ${coordinates.latitude.toFixed(5)}, ${coordinates.longitude.toFixed(5)}. Change the position on the map`
                    : 'Pick the house on the map. Required — this is what puts them on your map'
                }
              >
                <View style={[styles.positionIcon, { backgroundColor: `${colors.primary}1A` }]}>
                  <Icon name={coordinates ? 'location' : 'map'} size={20} color={colors.primary} />
                </View>
                <View style={styles.positionText}>
                  <Typography variant="body" weight="semibold">
                    {coordinates ? 'Position set' : 'Pick the house on the map'}
                  </Typography>
                  <Typography variant="caption1" color={colors.textSecondary}>
                    {coordinates
                      ? `${coordinates.latitude.toFixed(5)}, ${coordinates.longitude.toFixed(5)}`
                      : 'Required — this is what puts them on your map'}
                  </Typography>
                </View>
                <Icon name="chevron-forward" size={18} color={colors.textTertiary} />
              </TouchableOpacity>
            </View>

            {/* ---- Who ------------------------------------------------------ */}
            <View style={[styles.section, { backgroundColor: colors.backgroundSecondary }]}>
              <Typography variant="caption1" weight="semibold" color={colors.textSecondary}>
                THE HOME
              </Typography>
              <TextInput
                label="What do you call them?"
                placeholder="The Wilsons"
                value={label}
                onChangeText={setLabel}
                testID="neighbour-form-label"
              />

              <Typography variant="caption1" color={colors.textSecondary}>
                Where are they, relative to you?
              </Typography>
              <View style={styles.chipRow}>
                {NEIGHBOUR_RELATIONS.map((option) => (
                  <Chip
                    key={option}
                    label={RELATION_INFO[option].short}
                    variant={relation === option ? 'primary' : 'secondary'}
                    outlined={relation !== option}
                    onPress={() => setRelation(option)}
                    testID={`neighbour-form-relation-${option}`}
                  />
                ))}
              </View>

              {neighbourhoods.length > 0 && (
                <>
                  <Typography variant="caption1" color={colors.textSecondary}>
                    Neighbourhood
                  </Typography>
                  <View style={styles.chipRow}>
                    <Chip
                      label="None"
                      variant={neighbourhoodId === null ? 'primary' : 'secondary'}
                      outlined={neighbourhoodId !== null}
                      onPress={() => setNeighbourhoodId(null)}
                      testID="neighbour-form-area-none"
                    />
                    {neighbourhoods.map((area) => (
                      <Chip
                        key={area.id}
                        label={area.name}
                        variant={neighbourhoodId === area.id ? 'primary' : 'secondary'}
                        outlined={neighbourhoodId !== area.id}
                        onPress={() => setNeighbourhoodId(area.id)}
                        testID={`neighbour-form-area-${area.id}`}
                      />
                    ))}
                  </View>
                </>
              )}

              {/* The shared attachment field takes no `testID`, so the wrapper
                  carries it — Maestro needs a stable handle on the row and the
                  component is used by half a dozen other screens that should not
                  grow a prop for one of them. */}
              <View testID="neighbour-form-photo">
                <HouseAttachmentField
                  label="Photo of the home"
                  accept="image"
                  value={photo}
                  onChange={setPhoto}
                  householdId={householdId}
                />
              </View>
            </View>

            {/* ---- People --------------------------------------------------- */}
            <View style={[styles.section, { backgroundColor: colors.backgroundSecondary }]}>
              <View style={styles.sectionHeader}>
                <Typography variant="caption1" weight="semibold" color={colors.textSecondary}>
                  WHO LIVES THERE
                </Typography>
                <TouchableOpacity
                  onPress={() => openPersonEditor('new')}
                  testID="neighbour-form-add-person"
                  accessibilityRole="button"
                  accessibilityLabel="Add a person"
                >
                  <Typography variant="subheadline" weight="semibold" color={colors.primary}>
                    Add
                  </Typography>
                </TouchableOpacity>
              </View>

              {people.length === 0 ? (
                <Typography variant="caption1" color={colors.textSecondary}>
                  Optional. A home with nobody listed still shows on your map.
                </Typography>
              ) : (
                people.map((person, index) => (
                  <TouchableOpacity
                    key={person.id ?? `draft-${index}`}
                    style={[styles.personRow, { borderColor: colors.borderColor }]}
                    onPress={() => openPersonEditor(index)}
                    testID={`neighbour-form-person-${index}`}
                  >
                    <NeighbourAvatar
                      name={person.name || '?'}
                      photo={person.photo_blob}
                      size={36}
                      householdId={householdId}
                    />
                    <View style={styles.personText}>
                      <Typography variant="body" weight="medium" numberOfLines={1}>
                        {person.name || 'Unnamed'}
                        {person.is_primary ? ' · main contact' : ''}
                      </Typography>
                      <Typography variant="caption1" color={colors.textSecondary} numberOfLines={1}>
                        {[PERSON_ROLE_INFO[person.role].label, person.phone, person.email]
                          .filter(Boolean)
                          .join(' · ')}
                      </Typography>
                    </View>
                    <TouchableOpacity
                      onPress={() => removePerson(index)}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      testID={`neighbour-form-person-remove-${index}`}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${person.name || 'this person'}`}
                    >
                      <Icon name="close-circle" size={20} color={colors.textTertiary} />
                    </TouchableOpacity>
                  </TouchableOpacity>
                ))
              )}
            </View>

            {/* ---- Address -------------------------------------------------- */}
            <View style={[styles.section, { backgroundColor: colors.backgroundSecondary }]}>
              <View style={styles.sectionHeader}>
                <Typography variant="caption1" weight="semibold" color={colors.textSecondary}>
                  ADDRESS (OPTIONAL)
                </Typography>
                {resolvingAddress && <ActivityIndicator size="small" color={colors.textSecondary} />}
              </View>
              <TextInput
                label="Street"
                placeholder="42 Maple Street"
                value={addressLine1}
                onChangeText={setAddressLine1}
                testID="neighbour-form-street"
              />
              <View style={styles.inlineRow}>
                <TextInput
                  label="City"
                  value={city}
                  onChangeText={setCity}
                  containerStyle={styles.flex1}
                  testID="neighbour-form-city"
                />
                {/* Stays on the default keyboard: a Canadian postal code is
                    half letters ("K1A 0B1"), so a numeric keypad would lock a
                    Canadian neighbour's address out entirely. Upper-cased on
                    entry, as every other postal field in the app is. */}
                <TextInput
                  label="Postal code"
                  value={postalCode}
                  onChangeText={setPostalCode}
                  autoCapitalize="characters"
                  containerStyle={styles.flex1}
                  testID="neighbour-form-postal"
                />
              </View>
              <View style={styles.inlineRow}>
                <TextInput
                  label="Province / State"
                  value={stateProvince}
                  onChangeText={setStateProvince}
                  containerStyle={styles.flex1}
                  testID="neighbour-form-region"
                />
                <TextInput
                  label="Country"
                  value={country}
                  onChangeText={setCountry}
                  containerStyle={styles.flex1}
                  testID="neighbour-form-country"
                />
              </View>
              <TouchableOpacity
                style={styles.linkRow}
                onPress={handleGeocodeFromAddress}
                testID="neighbour-form-locate-address"
                accessibilityRole="button"
                accessibilityLabel="Find this address on the map"
              >
                <Icon name="search" size={16} color={colors.primary} />
                <Typography variant="subheadline" color={colors.primary}>
                  Put the pin on this address
                </Typography>
              </TouchableOpacity>
            </View>

            {/* ---- Notes & flags -------------------------------------------- */}
            <View style={[styles.section, { backgroundColor: colors.backgroundSecondary }]}>
              <TextInput
                label="Notes"
                placeholder="Feeds our cat when we travel. Has the gate code."
                value={notes}
                onChangeText={setNotes}
                multiline
                numberOfLines={3}
                testID="neighbour-form-notes"
              />
              <ToggleRow
                label="Favourite"
                hint="Pinned to the top of your list"
                value={isFavorite}
                onChange={setIsFavorite}
                testID="neighbour-form-favorite"
              />
              <ToggleRow
                label="Emergency contact"
                hint="Show them when something urgent happens at home"
                value={isEmergency}
                onChange={setIsEmergency}
                testID="neighbour-form-emergency"
              />
              <ToggleRow
                label="Has a key to our place"
                hint="Marked with a key badge on the map"
                value={hasSpareKey}
                onChange={setHasSpareKey}
                testID="neighbour-form-spare-key"
              />
            </View>

            <GradientButton
              title={isEditing ? 'Save changes' : 'Add neighbour'}
              onPress={handleSave}
              disabled={!canSave}
              loading={saving}
              testID="neighbour-form-save"
            />

            {isEditing && (
              <TouchableOpacity
                style={styles.deleteRow}
                onPress={handleDelete}
                testID="neighbour-form-delete"
                accessibilityRole="button"
                accessibilityLabel="Remove this neighbour"
              >
                <Icon name="trash" size={16} color={colors.destructive} />
                <Typography variant="subheadline" color={colors.destructive}>
                  Remove this neighbour
                </Typography>
              </TouchableOpacity>
            )}
          </ScrollView>
        </AdaptiveContainer>

        <PersonEditorSheet
          visible={editingPersonIndex !== null}
          draft={personDraft}
          onChange={setPersonDraft}
          onCancel={() => {
            setEditingPersonIndex(null);
            setPersonDraft(emptyDraft(false));
          }}
          onSave={commitPerson}
          householdId={householdId}
        />
      </View>
    </AppBackground>
  );
}

function ToggleRow({
  label,
  hint,
  value,
  onChange,
  testID,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (next: boolean) => void;
  testID?: string;
}) {
  const colors = useAppColors();
  return (
    <View style={styles.toggleRow} testID={testID}>
      <View style={styles.flex1}>
        <Typography variant="body">{label}</Typography>
        <Typography variant="caption1" color={colors.textSecondary}>
          {hint}
        </Typography>
      </View>
      <Toggle value={value} onValueChange={onChange} testID={testID ? `${testID}-switch` : undefined} />
    </View>
  );
}

function PersonEditorSheet({
  visible,
  draft,
  onChange,
  onCancel,
  onSave,
  householdId,
}: {
  visible: boolean;
  draft: DraftPerson;
  onChange: (next: DraftPerson) => void;
  onCancel: () => void;
  onSave: () => void;
  householdId?: string;
}) {
  const colors = useAppColors();
  return (
    <BottomSheet
      visible={visible}
      onClose={onCancel}
      title={draft.id ? 'Edit person' : 'Add a person'}
      height="tall"
      showCloseButton
    >
      <ScrollView
        {...keyboardDismissScrollProps}
        style={screenScrollViewStyle.scroll}
        contentContainerStyle={styles.sheetContent}
        testID="neighbour-person-sheet"
      >
        <TextInput
          label="Name"
          placeholder="Sarah Wilson"
          value={draft.name}
          onChangeText={(name) => onChange({ ...draft, name })}
          testID="neighbour-person-name"
        />
        <View style={styles.chipRow}>
          {ROLE_ORDER.map((role) => (
            <Chip
              key={role}
              label={PERSON_ROLE_INFO[role].label}
              variant={draft.role === role ? 'primary' : 'secondary'}
              outlined={draft.role !== role}
              onPress={() => onChange({ ...draft, role })}
              testID={`neighbour-person-role-${role}`}
            />
          ))}
        </View>
        <TextInput
          label="Phone"
          placeholder="+1 604 555 0142"
          keyboardType="phone-pad"
          value={draft.phone}
          onChangeText={(phone) => onChange({ ...draft, phone })}
          testID="neighbour-person-phone"
        />
        <TextInput
          label="Email"
          placeholder="sarah@example.com"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          value={draft.email}
          onChangeText={(email) => onChange({ ...draft, email })}
          testID="neighbour-person-email"
        />
        <View testID="neighbour-person-photo">
          <HouseAttachmentField
            label="Photo"
            accept="image"
            value={draft.photo_blob ?? null}
            onChange={(photo_blob) => onChange({ ...draft, photo_blob: photo_blob ?? undefined })}
            householdId={householdId}
          />
        </View>
        <View style={styles.toggleRow}>
          <View style={styles.flex1}>
            <Typography variant="body">Main contact</Typography>
            <Typography variant="caption1" color={colors.textSecondary}>
              Their face goes on the map pin, and Call reaches them first
            </Typography>
          </View>
          <Toggle
            value={draft.is_primary}
            onValueChange={(is_primary) => onChange({ ...draft, is_primary })}
            testID="neighbour-person-primary-switch"
          />
        </View>
        <GradientButton
          title={draft.id ? 'Save person' : 'Add person'}
          onPress={onSave}
          disabled={!draft.name.trim()}
          testID="neighbour-person-save"
        />
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingBottom: 120, gap: Spacing.md },
  section: {
    borderRadius: CornerRadius.lg,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  positionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: CornerRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  positionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  positionText: { flex: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: CornerRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  personText: { flex: 1 },
  inlineRow: { flexDirection: 'row', gap: Spacing.md },
  flex1: { flex: 1 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  deleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
  },
  sheetContent: { gap: Spacing.md, paddingBottom: Spacing.xl },
});
