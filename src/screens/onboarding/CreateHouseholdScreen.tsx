import { Picker } from '@react-native-picker/picker';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useState, useMemo, useRef } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  TouchableOpacity,
  Modal,
} from 'react-native';
import { GooglePlacesAutocomplete, type GooglePlacesAutocompleteRef, type GooglePlaceData, type GooglePlaceDetail } from 'react-native-google-places-autocomplete';

import { householdsApi, type HouseUnitSystem } from '@api/households';
import { userApi } from '@api/user';
import { SafeAreaView, AppBackground, SheetHeader } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import {
  OnboardingChoiceChips,
  OnboardingStepHeader,
} from '@components/onboarding';
import { Typography, TextInput, Card, GradientButton } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { ENV } from '@config/env';
import { houseOnboardingProgress } from '@features/house/onboarding/aiSteps';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { useNativeModalPresentation } from '@navigation/presentation';
import { usePropertyAddressCaptureGate } from '@navigation/RootNavigator';
import type {
  OnboardingStackParamList,
} from '@navigation/types';
import { trackEvent, AnalyticsEvent } from '@services/analytics';
import { useAuthStore } from '@stores/authStore';
import { useHouseholdStore } from '@stores/householdStore';
import { IconSize, scaledFont, useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';

const US_STATES = [
  { code: '', name: 'Select State' },
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
  { code: 'DC', name: 'Washington D.C.' },
];

const CA_PROVINCES = [
  { code: '', name: 'Select Province' },
  { code: 'AB', name: 'Alberta' },
  { code: 'BC', name: 'British Columbia' },
  { code: 'MB', name: 'Manitoba' },
  { code: 'NB', name: 'New Brunswick' },
  { code: 'NL', name: 'Newfoundland and Labrador' },
  { code: 'NS', name: 'Nova Scotia' },
  { code: 'NT', name: 'Northwest Territories' },
  { code: 'NU', name: 'Nunavut' },
  { code: 'ON', name: 'Ontario' },
  { code: 'PE', name: 'Prince Edward Island' },
  { code: 'QC', name: 'Quebec' },
  { code: 'SK', name: 'Saskatchewan' },
  { code: 'YT', name: 'Yukon' },
];

const UNIT_SYSTEMS: { key: HouseUnitSystem; label: string }[] = [
  { key: 'imperial', label: 'Imperial (sq ft)' },
  { key: 'metric', label: 'Metric (sq m)' },
];

type CreateHouseholdScreenNavigationProp = NativeStackNavigationProp<
  OnboardingStackParamList,
  'CreateHousehold'
>;

export function CreateHouseholdScreen() {
  const colors = useAppColors();
  /**
   * Is this form open BECAUSE a home has no region?
   *
   * `usePropertyAddressCaptureGate` routes an already-onboarded member here
   * when their household has no `state_province`, and its own comment says it
   * "closes the instant the household gains a region — which is the same act
   * that fixes the bug". That was only true if the form always sets one, and it
   * did not: the address block is captioned Optional and Create Home is enabled
   * on the name alone. Submit without a province and the gate re-fires on the
   * very next render — the member is returned to this screen, forever, with no
   * back button and no way to tell why.
   *
   * Observed on a device: a home created from the local-first "Start a new home"
   * path re-opened this wizard on every relaunch, minting another household each
   * time. It also fails every E2E flow, because `launch-logged-in` waits for a
   * Home screen that can never arrive.
   *
   * So when the gate opened this form, the region it is asking for becomes
   * required. First-run onboarding is untouched: `needsAddressCapture` is false
   * for a brand-new account, the caption still reads Optional, and Create Home
   * still needs only a name.
   *
   * ## …and it must EDIT that home, not make another one
   *
   * Requiring the region closed the loop but not the hole underneath it. This
   * screen only ever knew how to CREATE, so satisfying the gate produced a
   * second household — one with an address — beside the address-less home the
   * gate was complaining about. The loop stopped because `currentHousehold`
   * became the new home; the original was left exactly as broken as before, and
   * the member was one home richer for it.
   *
   * That is the same duplicate-home outcome `HouseRecoverHomeScreen` exists to
   * prevent (its header counts 17 of them on staging), reached by a different
   * road. Restoring a backup is the sharpest version: the member recovers their
   * real home, the restored row has no region, this form opens, and the only
   * button on it offers to create a home they already have.
   *
   * So when the gate opened this form over a home that EXISTS, the form binds to
   * that home: prefilled from it, saving into it, and worded as the address
   * capture it actually is. `create` stays exactly as it was for first-run
   * onboarding, which has no household to bind to.
   */
  const openedByAddressGate = usePropertyAddressCaptureGate();
  const currentHousehold = useHouseholdStore(state => state.currentHousehold);
  /**
   * The home this form is fixing, or null when it is genuinely creating one.
   *
   * Both halves are required: the gate can only be open because a household is
   * missing a region, but reading the store defensively means a race that leaves
   * `currentHousehold` null falls back to the create path rather than throwing
   * on `.id`.
   */
  const editingHousehold = openedByAddressGate ? currentHousehold : null;
  /**
   * The home this form WRITES INTO — null only when there genuinely isn't one.
   *
   * `editingHousehold` above answers "did the gate send me here", which drives
   * the wording and the chrome. This answers the narrower question the submit
   * button has to ask, and the two differ in exactly one case: the first-run
   * member who created their home, walked on, and then came BACK to this step.
   *
   * Before the wizard had a back button that case could not arise, so
   * `handleCreate` only ever knew how to POST. Now it can, and posting again
   * would hand the member a second home named the same as the first — the very
   * duplicate this file's other comments spend so long guarding against,
   * reached this time by the back arrow. Binding to whatever household is
   * already active makes a re-visit an edit, which is what a member returning
   * to "Set Up Your Home" means by it. It also quietly fixes the older version
   * of the same hazard: a force-quit mid-wizard used to restart at Welcome and
   * create a second home on the way through.
   */
  const boundHousehold = currentHousehold;
  const { content: containerPadding } = useLayoutPadding();
  const navigation = useNavigation<CreateHouseholdScreenNavigationProp>();
  // Prefilled from the home being fixed (or re-visited), so the member is
  // correcting what they have rather than retyping it. Lazy initialisers, not
  // an effect: the values are the initial state of this form, and an effect
  // would fight anything the member typed before `currentHousehold` settled.
  const [name, setName] = useState(() => boundHousehold?.name ?? '');
  const [addressLine1, setAddressLine1] = useState(
    () => boundHousehold?.address_line1 ?? '',
  );
  const [city, setCity] = useState(() => boundHousehold?.city ?? '');
  const [stateProvince, setStateProvince] = useState(
    () => boundHousehold?.state_province ?? '',
  );
  const [postalCode, setPostalCode] = useState(
    () => boundHousehold?.postal_code ?? '',
  );
  const [country, setCountry] = useState<'CA' | 'US'>(() =>
    boundHousehold?.country === 'US' ? 'US' : 'CA',
  );
  const [unitSystem, setUnitSystem] = useState<HouseUnitSystem>(() =>
    boundHousehold?.unit_system === 'metric' ? 'metric' : 'imperial',
  );
  const [isLoading, setIsLoading] = useState(false);
  const [showStatePicker, setShowStatePicker] = useState(false);
  const [tempStateProvince, setTempStateProvince] = useState('');
  const [tempCountry, setTempCountry] = useState<'CA' | 'US'>('CA');
  const autocompleteRef = useRef<GooglePlacesAutocompleteRef>(null);
  const modalPresentation = useNativeModalPresentation('pageSheet');

  /**
   * Are Places suggestions actually available, or is this a plain field?
   *
   * `GooglePlacesAutocomplete` does not care that its key is empty: it renders a
   * perfectly ordinary-looking input and then quietly never returns a
   * suggestion. That is how this screen spent a long time *having* address
   * autocomplete that nobody could see working — `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY`
   * reaches the bundle from `.env.local` / the EAS profile, and a clone without
   * one gets a dead field with no error anywhere to explain it.
   *
   * So when there is no key we render the same `@components/ui/TextInput` every
   * sibling field uses. A plain field that looks plain is honest; a Google field
   * that never suggests is not. It also keeps this screen — which is the address
   * GATE, the only thing between the member and the app — off the network on a
   * path where a typed address has always been enough.
   */
  const canAutocompleteAddress = !!ENV.GOOGLE_PLACES_API_KEY.trim();

  const addHousehold = useHouseholdStore(state => state.addHousehold);
  const setCurrentHousehold = useHouseholdStore(
    state => state.setCurrentHousehold,
  );
  const updateHouseholdInStore = useHouseholdStore(
    state => state.updateHousehold,
  );

  const stateProvinceList = useMemo(() => {
    return tempCountry === 'US' ? US_STATES : CA_PROVINCES;
  }, [tempCountry]);

  const getStateProvinceName = (code: string, countryCode: 'US' | 'CA') => {
    const list = countryCode === 'US' ? US_STATES : CA_PROVINCES;
    const item = list.find(s => s.code === code);
    return item?.name || code;
  };

  const handleOpenStatePicker = () => {
    setTempStateProvince(stateProvince);
    setTempCountry(country);
    setShowStatePicker(true);
  };

  const handleConfirmStatePicker = () => {
    setStateProvince(tempStateProvince);
    setCountry(tempCountry);
    setShowStatePicker(false);
  };

  const handleCancelStatePicker = () => {
    setShowStatePicker(false);
  };

  const handleTempCountryChange = (newCountry: 'CA' | 'US') => {
    setTempCountry(newCountry);
    setTempStateProvince(''); // Reset state when country changes
  };

  const handlePlaceSelect = (data: GooglePlaceData, details: GooglePlaceDetail | null) => {
    if (!details) return;

    // Parse address components
    const addressComponents = details.address_components;
    let street = '';
    let cityName = '';
    let stateName = '';
    let postalCodeValue = '';
    let countryCode: 'CA' | 'US' = 'CA';

    // Extract street number and route
    const streetNumber =
      addressComponents.find((c) => c.types.includes('street_number'))
        ?.long_name || '';
    const route =
      addressComponents.find((c) => c.types.includes('route'))
        ?.long_name || '';
    street = `${streetNumber} ${route}`.trim();

    // Extract city
    const locality = addressComponents.find((c) =>
      c.types.includes('locality'),
    )?.long_name;
    cityName = locality || '';

    // Extract state/province
    const state = addressComponents.find((c) =>
      c.types.includes('administrative_area_level_1'),
    )?.short_name;
    stateName = state || '';

    // Extract postal code
    const postal = addressComponents.find((c) =>
      c.types.includes('postal_code'),
    )?.long_name;
    postalCodeValue = postal || '';

    // Extract country
    const countryComponent = addressComponents.find((c) =>
      c.types.includes('country'),
    )?.short_name;
    countryCode = countryComponent === 'US' ? 'US' : 'CA';

    // Update form fields
    setAddressLine1(street || data.description);
    setCity(cityName);
    setStateProvince(stateName);
    setPostalCode(postalCodeValue);
    setCountry(countryCode);
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Please enter a name for your home');
      return;
    }

    setIsLoading(true);
    try {
      const fields = {
        name: name.trim(),
        address_line1: addressLine1.trim() || undefined,
        city: city.trim() || undefined,
        state_province: stateProvince.trim() || undefined,
        postal_code: postalCode.trim() || undefined,
        country,
        unit_system: unitSystem,
      };

      // There is already a home to write into — fix it rather than making
      // another. Two different members arrive here:
      //
      //  - the address-capture path, whose home is missing its region. The gate
      //    closes on its own the moment the store carries one, which is the same
      //    act that fixes the home, so this returns without touching the wizard
      //    bookkeeping below — that member finished onboarding long ago.
      //  - the first-run member who walked back to this step. They ARE mid-
      //    wizard, so the step is recorded and the flow carries on exactly as it
      //    does after a create.
      if (boundHousehold) {
        const updated = await householdsApi.update(boundHousehold.id, fields);
        updateHouseholdInStore(boundHousehold.id, updated.household);
        setCurrentHousehold(updated.household);
        if (editingHousehold) return;

        try {
          await userApi.updateOnboardingStep('household');
        } catch {
          /* non-fatal */
        }
        navigation.navigate('SpaceSetup');
        return;
      }

      const response = await householdsApi.create(fields);

      addHousehold(response.household);
      setCurrentHousehold(response.household);
      trackEvent(AnalyticsEvent.HOUSEHOLD_CREATED, { source: 'onboarding' });

      // Bookkeeping, not a gate: the household EXISTS by this line, and
      // failing here used to roll into the catch below and tell the member
      // their home could not be created — after it had been.
      try {
        await userApi.updateOnboardingStep('household');
      } catch {
        /* non-fatal */
      }

      // Navigate to next onboarding step
      navigation.navigate('SpaceSetup');
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : editingHousehold
            ? 'Failed to save your home details'
            : 'Failed to create household';
      Alert.alert('Error', message);
    } finally {
      setIsLoading(false);
    }
  };

  /** Name + units: what a first-run member is here to decide. */
  const homeDetailsFields = (
    <>
      <TextInput
        label="Home Name"
        placeholder="e.g., 123 Main Street or Beach Property"
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
        testID="onboarding-create-home-name"
      />

      <Typography
        variant="caption1"
        color={colors.textSecondary}
        style={styles.sectionLabel}
      >
        Units
      </Typography>
      <OnboardingChoiceChips
        variant="segmented"
        options={UNIT_SYSTEMS}
        selected={unitSystem}
        onSelect={key => setUnitSystem(key as HouseUnitSystem)}
        testIDPrefix="onboarding-create-home-units"
        accessibilityLabelPrefix="Units"
      />
    </>
  );

  /** The address itself — the whole subject of the screen on the gate path. */
  const addressFields = (
    <>
      <Typography
        variant="caption1"
        color={colors.textSecondary}
        style={styles.sectionLabel}
      >
        {openedByAddressGate ? 'Address' : 'Address (Optional)'}
      </Typography>

      <View style={styles.autocompleteContainer}>
        {canAutocompleteAddress ? (
          <>
            <Typography
              variant="caption1"
              color={colors.textSecondary}
              style={styles.autocompleteLabel}
            >
              Street Address
            </Typography>
            <GooglePlacesAutocomplete
              ref={autocompleteRef}
              placeholder="123 Main Street"
              onPress={handlePlaceSelect}
              query={{
                key: ENV.GOOGLE_PLACES_API_KEY,
                language: 'en',
                components: 'country:us|country:ca',
              }}
              fetchDetails={true}
              enablePoweredByContainer={false}
              textInputProps={{
                value: addressLine1,
                onChangeText: setAddressLine1,
                autoCapitalize: 'words',
                placeholderTextColor: colors.textTertiary,
                testID: 'onboarding-create-home-address',
              }}
              styles={{
                container: {
                  flex: 0,
                },
                textInput: {
                  backgroundColor: colors.card,
                  borderWidth: 1,
                  borderColor: 'rgba(0, 0, 0, 0.1)',
                  borderRadius: 12,
                  paddingVertical: 14,
                  paddingHorizontal: 16,
                  ...scaledFont('body'),
                  color: colors.textPrimary,
                  /*
                   * The library hard-codes `height: 44` on this input. Our
                   * 14pt vertical padding leaves a 16pt content box out of
                   * that, and a Dynamic-Type-scaled body line needs more —
                   * so a typed address rendered with its descenders sliced
                   * off, worst on iPad where the scale is largest. Handing
                   * the box back to padding + line height is what every
                   * sibling field here already does via
                   * `@components/ui/TextInput`, which is why this was the
                   * only field that showed it.
                   */
                  height: 'auto',
                  minHeight: 52,
                },
                listView: {
                  backgroundColor: colors.card,
                  borderRadius: 12,
                  marginTop: 4,
                  borderWidth: 1,
                  borderColor: 'rgba(0, 0, 0, 0.1)',
                  elevation: 3,
                  shadowColor: colors.black,
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.1,
                  shadowRadius: 4,
                },
                row: {
                  paddingVertical: 12,
                  paddingHorizontal: 16,
                },
                separator: {
                  height: StyleSheet.hairlineWidth,
                  backgroundColor: 'rgba(0, 0, 0, 0.1)',
                },
              }}
            />
          </>
        ) : (
          <TextInput
            label="Street Address"
            placeholder="123 Main Street"
            value={addressLine1}
            onChangeText={setAddressLine1}
            autoCapitalize="words"
            testID="onboarding-create-home-address"
          />
        )}
      </View>

      <View style={styles.row}>
        <View style={styles.flex}>
          <TextInput
            label="City"
            placeholder="City"
            value={city}
            onChangeText={setCity}
            autoCapitalize="words"
          />
        </View>
        <View style={styles.flex}>
          <Typography
            variant="caption1"
            color={colors.textSecondary}
            style={styles.inputLabel}
          >
            State/Province
          </Typography>
          <TouchableOpacity
            style={[styles.pickerButton, { backgroundColor: colors.card }]}
            onPress={handleOpenStatePicker}
            activeOpacity={0.7}
            testID="onboarding-create-home-state"
          >
            <Typography
              variant="body"
              color={
                stateProvince ? colors.textPrimary : colors.textTertiary
              }
            >
              {stateProvince
                ? getStateProvinceName(stateProvince, country)
                : 'Select'}
            </Typography>
            <Icon name="chevron-down" size={16} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>
      </View>

      <TextInput
        label="Postal Code"
        placeholder={country === 'US' ? '12345' : 'A1A 1A1'}
        value={postalCode}
        onChangeText={setPostalCode}
        autoCapitalize="characters"
      />
    </>
  );

  return (
    <AppBackground opacity={0.5}>
      <SafeAreaView>
        {/* First-run chrome only. A member sent here by the address gate finished
            onboarding long ago, and "Step 1 of 6" tells them they are starting
            over — which is precisely the thing this screen must stop implying. */}
        {editingHousehold ? null : (
          <OnboardingStepHeader
            testID="onboarding-create-household"
            {...houseOnboardingProgress('CreateHousehold')}
            stepLabel="Create Home"
            onBack={() => navigation.goBack()}
            // Only once the step is satisfied. A home is the one thing this
            // wizard cannot proceed without, so there is nothing to skip
            // forward TO until one exists; after that the chevron is how a
            // member who came back to check a detail gets on again without
            // re-saving a form they did not change.
            onForward={
              boundHousehold
                ? () => navigation.navigate('SpaceSetup')
                : undefined
            }
            forwardDisabled={isLoading}
          />
        )}
        <AdaptiveContainer width="reading" padding={0}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.keyboardView}
          >
            <ScrollView
              {...keyboardDismissScrollProps}
              style={styles.container}
              contentContainerStyle={styles.content}
              showsVerticalScrollIndicator={false}
            >
              {/*
                The way OUT of the gate.

                On the gate path this screen is mounted as the only route in its
                stack, so the navigator draws no back button and there is nothing
                to go back TO — the member is authenticated, holds a home with no
                address, and every other route is behind the gate. Accept Invite
                answers the member who has an invite in hand; this answers the one
                who does not and simply wants out, which until now meant force
                quitting the app and meeting the same wall on the next launch.
                Signing out is the honest destination: it is the only screen that
                exists on the far side of an authenticated gate.

                Only on the gate path. The first-run wizard reaches this screen
                inside a real stack with its own steps behind it, and a sign-out
                control there would sit beside a working back button and mean
                something different.
              */}
              {editingHousehold ? (
                <TouchableOpacity
                  onPress={() =>
                    Alert.alert(
                      'Sign out?',
                      'You will return to the login screen. Your home stays on this device.',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Sign out',
                          style: 'destructive',
                          onPress: () => {
                            void useAuthStore.getState().logout();
                          },
                        },
                      ]
                    )
                  }
                  style={styles.gateBackButton}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  accessibilityRole="button"
                  accessibilityLabel="Back to sign in"
                  testID="address-capture-back"
                >
                  <Icon
                    name="chevron-back"
                    forceIonicons
                    size={IconSize.md}
                    color={colors.primary}
                  />
                  <Typography variant="body" style={{ color: colors.primary }}>
                    Sign in
                  </Typography>
                </TouchableOpacity>
              ) : null}

              <View style={styles.header}>
                <Typography
                  variant="title1"
                  weight="bold"
                  align="center"
                  color={colors.textPrimary}
                >
                  {editingHousehold ? 'Add Your Address' : 'Set Up Your Home'}
                </Typography>
                <Typography
                  variant="body"
                  color={colors.textSecondary}
                  align="center"
                  style={styles.subtitle}
                >
                  {/*
                    Why we are asking is NOT "so we can look up an assessment" —
                    that is one feature downstream of the address, not the rule.
                    The rule is that the member must have at least one property
                    set up, and a home with no address is not one yet. Naming
                    assessment here also mis-sells the block to anyone who does
                    not care about assessment or tax at all.
                  */}
                  {editingHousehold
                    ? `Add the address of ${editingHousehold.name?.trim() || 'your home'} to finish setting it up. You need at least one home before you can use the app.`
                    : 'Add your home details to get started'}
                </Typography>
              </View>

              {/*
                Address first when the address is what we asked for.

                On the gate path the header says "Add Your Address" and then the
                form opened on Home Name and Units — both already filled in from
                the home being fixed — with the address two sections down, below
                the fold and behind the keyboard. The member is looking at a
                screen whose title names a field they cannot see, which reads as
                "there is no address field here" rather than "scroll".

                First-run keeps the original order: there the home does not exist
                yet, naming it is the first decision, and the address is
                genuinely optional.
              */}
              <View style={styles.form}>
                {editingHousehold ? (
                  <>
                    {addressFields}
                    {homeDetailsFields}
                  </>
                ) : (
                  <>
                    {homeDetailsFields}
                    {addressFields}
                  </>
                )}
              </View>
            </ScrollView>

            <View
              style={[styles.footer, { paddingHorizontal: containerPadding }]}
            >
              <GradientButton
                title={
                  editingHousehold
                    ? 'Save Address'
                    : boundHousehold
                      ? 'Save & Continue'
                      : 'Create Home'
                }
                variant="teal"
                size="lg"
                onPress={handleCreate}
                disabled={
                  !name.trim() ||
                  isLoading ||
                  // See `openedByAddressGate`: letting this through without a
                  // region is what makes the gate a loop.
                  (openedByAddressGate && !stateProvince.trim())
                }
                fullWidth
                testID="onboarding-create-home-submit"
              />
              {/*
                The other way in, for someone who was INVITED to a home that
                already exists. Without it this screen is a dead end for them:
                the scanner and the code fields live on `HouseJoin`, which was
                reachable only from Settings — so the sole route to it was to
                create a home they did not want and then go and delete it.

                On BOTH paths, and on the gate path it is the only alternative
                there is. This footer used to carry "Not now" instead, which
                dismissed the gate for the session — and that was the wrong
                promise to make: a member must hold at least one home before the
                app means anything, so there is nothing on the far side of the
                dismissal to let them into. It bought a session in an app whose
                property surfaces were all shut, and the prompt returned on the
                next cold start anyway.

                An invite is the honest second answer, because it ENDS the same
                way the address does. `adoptJoinedHousehold` adds the joined
                home and activates it, the property-set watch republishes
                `currentHousehold`, and `isHouseAddressCaptureEligible` then
                answers false for a home that is awaiting enrolment — so the
                gate closes on the join, not on a dismissal, and the member
                lands in the app holding a real home.
              */}
              {/*
                Branched on `editingHousehold`, NOT on `openedByAddressGate`:
                the two disagree only in the store race where the gate is open
                and `currentHousehold` has not landed, and in that render this
                screen IS the create form — same title, same empty fields, same
                `householdsApi.create` on submit. The id has to follow the form
                the member is actually looking at, because that is the question
                the Maestro guard is asking.
              */}
              <TouchableOpacity
                onPress={() =>
                  editingHousehold
                    ? // Already onboarded — the join alone closes the gate, and
                      // `fromOnboarding` would offer to finish an onboarding
                      // that finished long ago.
                      navigation.navigate('HouseJoin', {})
                    : navigation.navigate('HouseJoin', { fromOnboarding: true })
                }
                style={styles.joinInsteadButton}
                accessibilityRole="button"
                accessibilityLabel={
                  editingHousehold
                    ? 'Accept invite — scan a code or enter it manually'
                    : 'Join Household with an invite'
                }
                // Two ids for one control, deliberately: `address-capture-*`
                // renders ONLY on the gate, and the Maestro subflows use it to
                // tell the gate apart from the first-run wizard (both carry
                // `onboarding-create-home-name`). Guessing wrong there types
                // into a prefilled field and renames a real home.
                testID={
                  editingHousehold
                    ? 'address-capture-accept-invite'
                    : 'onboarding-join-with-invite'
                }
              >
                <Icon
                  name="qr-code-outline"
                  forceIonicons
                  size={IconSize.sm}
                  color={colors.primary}
                />
                <Typography
                  variant="body"
                  style={[styles.joinInsteadLabel, { color: colors.primary }]}
                >
                  {editingHousehold
                    ? 'Accept Invite — scan or enter code'
                    : 'Invited to a home? Scan or enter code'}
                </Typography>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </AdaptiveContainer>
      </SafeAreaView>

      {/* State/Province Picker Modal */}
      <Modal
        visible={showStatePicker}
        animationType="slide"
        presentationStyle={modalPresentation}
        onRequestClose={handleCancelStatePicker}
      >
        <View
          style={[
            styles.pickerModal,
            { backgroundColor: colors.backgroundMain },
          ]}
        >
          <View
            style={[
              styles.pickerHeader,
              { borderBottomColor: colors.borderColor },
            ]}
          >
            <View
              style={[
                styles.pickerHandle,
                { backgroundColor: colors.borderColor },
              ]}
            />
            {/* The app's one sheet header — glass ✕ on the left, centred title,
                the single commit on the right — instead of a hand-rolled
                Cancel / title / Done row. */}
            <SheetHeader
              title="State/Province"
              leftVariant="close"
              onLeftPress={handleCancelStatePicker}
              leftTestID="onboarding-create-home-state-cancel"
              leftAccessibilityLabel="Cancel"
              rightLabel="Done"
              onRightPress={handleConfirmStatePicker}
              rightTestID="onboarding-create-home-state-done"
              style={styles.pickerTitleRow}
            />
          </View>

          <View style={styles.countryToggle}>
            <Typography
              variant="caption1"
              color={colors.textSecondary}
              style={styles.countryLabel}
            >
              Country
            </Typography>
            <View style={styles.countryButtons}>
              <CountryButton
                label="🇺🇸 United States"
                selected={tempCountry === 'US'}
                onPress={() => handleTempCountryChange('US')}
              />
              <CountryButton
                label="🇨🇦 Canada"
                selected={tempCountry === 'CA'}
                onPress={() => handleTempCountryChange('CA')}
              />
            </View>
          </View>

          <View style={styles.pickerContainer}>
            <Picker
              selectedValue={tempStateProvince}
              onValueChange={value => setTempStateProvince(value)}
              itemStyle={styles.pickerItem}
            >
              {stateProvinceList.map(item => (
                <Picker.Item
                  key={item.code}
                  label={item.name}
                  value={item.code}
                  color={colors.textPrimary}
                />
              ))}
            </Picker>
          </View>
        </View>
      </Modal>
    </AppBackground>
  );
}

function CountryButton({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const colors = useAppColors();
  return (
    <Card
      variant={selected ? 'filled' : 'outlined'}
      pressable
      onPress={onPress}
      style={[
        styles.countryButton,
        selected && { backgroundColor: colors.primaryDark },
        !selected && { backgroundColor: colors.card },
      ]}
    >
      <Typography
        variant="subheadline"
        weight={selected ? 'semibold' : 'regular'}
        color={selected ? colors.white : colors.textSecondary}
      >
        {label}
      </Typography>
    </Card>
  );
}

const styles = StyleSheet.create({
  keyboardView: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  content: {
    padding: 24,
    paddingBottom: 24,
  },
  gateBackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 2,
    marginBottom: 8,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  subtitle: {
    marginTop: 8,
    paddingHorizontal: 24,
  },
  form: {
    gap: 16,
  },
  sectionLabel: {
    marginTop: 8,
    marginBottom: -8,
  },
  autocompleteContainer: {
    zIndex: 1000,
    marginBottom: 16,
  },
  autocompleteLabel: {
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    gap: 16,
  },
  flex: {
    flex: 1,
  },
  inputLabel: {
    marginBottom: 8,
  },
  pickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.1)',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  countryButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  countryButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  footer: {
    paddingVertical: 24,
    gap: 16,
    backgroundColor: 'transparent',
  },
  joinInsteadLabel: {
    fontWeight: '600',
  },
  joinInsteadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  skipButton: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  // Picker modal styles
  pickerModal: {
    flex: 1,
  },
  pickerHeader: {
    // No horizontal padding of its own: `SheetHeader` brings the app's, and
    // doubling them would indent the ✕ past every other sheet's.
    paddingTop: 12,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pickerHandle: {
    width: 36,
    height: 5,
    borderRadius: 2.5,
    alignSelf: 'center',
    marginBottom: 16,
  },
  pickerTitleRow: { paddingVertical: 0 },
  countryToggle: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  countryLabel: {
    marginBottom: 12,
  },
  pickerContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  pickerItem: {
    ...scaledFont('titleSmall'),
  },
});
