import React, { useMemo, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { GooglePlacesAutocomplete } from 'react-native-google-places-autocomplete';

import { OptionWheelPickerSheet, TextInput, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { ENV } from '@config/env';
import { SUPPORTED_REGION_COUNTRIES, findRegionCountry } from '@config/regions';
import { CornerRadius, IconSize, Spacing, scaledFont, useAppColors } from '@theme';

/**
 * The address block, once, for every screen that captures one.
 *
 * It exists because the House onboarding screen had the only working address
 * capture in the fleet — Google Places suggestions, the address-component
 * parsing that turns a picked place into five fields, and a province/state list
 * — and every other surface that wanted an address either went without or would
 * have copied two hundred lines to get it. A second copy of the parser is a
 * second place for "the postal code stopped filling in" to live.
 *
 * Suggestions are a courtesy, never a requirement: the fields below are plain,
 * typeable inputs whether or not Places answers, and an address that was typed
 * by hand is as complete as one that was picked.
 */

export interface AddressFieldsValue {
  addressLine1: string;
  /** Apartment / unit / suite — free text, never parsed out of a place. */
  addressLine2: string;
  city: string;
  /** Two-letter subdivision code ('BC', 'NY'), or '' when unset. */
  stateProvince: string;
  postalCode: string;
  country: 'CA' | 'US';
}

export const EMPTY_ADDRESS: AddressFieldsValue = {
  addressLine1: '',
  addressLine2: '',
  city: '',
  stateProvince: '',
  postalCode: '',
  country: 'CA',
};

/** Is any part of this address actually filled in? */
export function isAddressEmpty(value: AddressFieldsValue): boolean {
  return (
    !value.addressLine1.trim() &&
    !value.addressLine2.trim() &&
    !value.city.trim() &&
    !value.stateProvince.trim() &&
    !value.postalCode.trim()
  );
}

/** A Google Places `address_components` entry — the shape the library returns. */
interface PlaceComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

/**
 * Turn a picked place into the five fields this form holds.
 *
 * Exported and pure so the parsing can be tested without a network key, a
 * rendered autocomplete, or a tap — it is the half of address capture that has
 * historically broken silently (a place picked, the street filled, the postal
 * code left blank) and the half a unit test can actually pin down.
 *
 * `description` is the fallback street line: Places returns a description for
 * every prediction, but a place with no `street_number`/`route` (a landmark, a
 * neighbourhood) would otherwise clear the field the member just picked in.
 */
export function addressFromPlaceDetails(
  details: { address_components?: PlaceComponent[] } | null | undefined,
  description?: string,
): Partial<AddressFieldsValue> {
  const components = details?.address_components;
  if (!components) return description ? { addressLine1: description } : {};

  const pick = (type: string, form: 'long_name' | 'short_name' = 'long_name') =>
    components.find((component) => component.types.includes(type))?.[form] ?? '';

  const street = `${pick('street_number')} ${pick('route')}`.trim();
  const country = pick('country', 'short_name') === 'US' ? 'US' : 'CA';

  return {
    addressLine1: street || description || '',
    city: pick('locality') || pick('sublocality') || '',
    stateProvince: pick('administrative_area_level_1', 'short_name'),
    postalCode: pick('postal_code'),
    country,
  };
}

interface AddressFieldsProps {
  value: AddressFieldsValue;
  onChange: (next: AddressFieldsValue) => void;
  /** Prefix for every field's testID, e.g. `budget-household-address`. */
  testIDPrefix: string;
}

export function AddressFields({ value, onChange, testIDPrefix }: AddressFieldsProps) {
  const colors = useAppColors();
  const [pickingRegion, setPickingRegion] = useState(false);

  /**
   * Are Places suggestions actually available, or is this a plain field?
   *
   * `GooglePlacesAutocomplete` does not care that its key is empty: it renders
   * an ordinary-looking input and then quietly never returns a suggestion. So
   * with no `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY` in the bundle we render the same
   * `@components/ui/TextInput` every sibling field uses — a plain field that
   * looks plain is honest, a Google field that never suggests is not.
   */
  const canAutocomplete = !!ENV.GOOGLE_PLACES_API_KEY.trim();

  const patch = (next: Partial<AddressFieldsValue>) => onChange({ ...value, ...next });

  /**
   * Country and subdivision in ONE wheel.
   *
   * They are one decision — 'CA' next to a list of US states is not a state the
   * member can pick — and splitting them into two controls is how a form ends up
   * holding "Ontario, United States". The country is carried in the option key
   * (`CA:ON`) so the wheel returns both halves of the answer at once.
   */
  const regionOptions = useMemo(
    () => [
      { key: '', label: 'Not set' },
      ...SUPPORTED_REGION_COUNTRIES.flatMap((country) =>
        country.subdivisions.map((subdivision) => ({
          key: `${country.code}:${subdivision.code}`,
          label: `${subdivision.label}, ${country.code}`,
        })),
      ),
    ],
    [],
  );

  const regionKey = value.stateProvince ? `${value.country}:${value.stateProvince}` : '';
  const regionLabel =
    regionOptions.find((option) => option.key === regionKey)?.label ?? 'Select';
  const subdivisionLabel = findRegionCountry(value.country)?.subdivisionLabel ?? 'Province';

  const handleRegionConfirm = (key: string) => {
    if (!key) {
      patch({ stateProvince: '' });
      return;
    }
    const [country, subdivision] = key.split(':');
    patch({ country: country === 'US' ? 'US' : 'CA', stateProvince: subdivision });
  };

  return (
    <View>
      {canAutocomplete ? (
        <View style={styles.autocomplete}>
          <Typography variant="caption1" color={colors.textSecondary} style={styles.label}>
            Street address
          </Typography>
          <GooglePlacesAutocomplete
            placeholder="123 Main Street"
            onPress={(data, details) =>
              patch(addressFromPlaceDetails(details, data?.description))
            }
            query={{
              key: ENV.GOOGLE_PLACES_API_KEY,
              language: 'en',
              components: 'country:us|country:ca',
            }}
            fetchDetails
            enablePoweredByContainer={false}
            textInputProps={{
              value: value.addressLine1,
              onChangeText: (text: string) => patch({ addressLine1: text }),
              autoCapitalize: 'words',
              placeholderTextColor: colors.textTertiary,
              testID: `${testIDPrefix}-line1`,
            }}
            styles={{
              container: { flex: 0 },
              textInput: {
                backgroundColor: colors.card,
                borderWidth: 1,
                borderColor: colors.borderColor,
                borderRadius: CornerRadius.md,
                paddingVertical: 14,
                paddingHorizontal: 16,
                ...scaledFont('body'),
                color: colors.textPrimary,
                // The library hard-codes `height: 44`, which slices the
                // descenders off a Dynamic-Type-scaled line. Hand the box back
                // to padding, as every sibling field already does.
                height: 'auto',
                minHeight: 52,
              },
              listView: {
                backgroundColor: colors.card,
                borderRadius: CornerRadius.md,
                marginTop: 4,
                borderWidth: 1,
                borderColor: colors.borderColor,
              },
              row: { paddingVertical: 12, paddingHorizontal: 16 },
              separator: {
                height: StyleSheet.hairlineWidth,
                backgroundColor: colors.borderColor,
              },
            }}
          />
        </View>
      ) : (
        <TextInput
          label="Street address"
          placeholder="123 Main Street"
          value={value.addressLine1}
          onChangeText={(text) => patch({ addressLine1: text })}
          autoCapitalize="words"
          testID={`${testIDPrefix}-line1`}
        />
      )}

      <TextInput
        label="Apt / unit (optional)"
        placeholder="Unit 4"
        value={value.addressLine2}
        onChangeText={(text) => patch({ addressLine2: text })}
        autoCapitalize="words"
        testID={`${testIDPrefix}-line2`}
      />

      <TextInput
        label="City"
        placeholder="City"
        value={value.city}
        onChangeText={(text) => patch({ city: text })}
        autoCapitalize="words"
        testID={`${testIDPrefix}-city`}
      />

      <View style={styles.row}>
        <View style={styles.flex}>
          <Typography variant="caption1" color={colors.textSecondary} style={styles.label}>
            {subdivisionLabel}
          </Typography>
          <TouchableOpacity
            style={[
              styles.pickerButton,
              { backgroundColor: colors.card, borderColor: colors.borderColor },
            ]}
            onPress={() => setPickingRegion(true)}
            activeOpacity={0.7}
            testID={`${testIDPrefix}-region`}
          >
            <Typography
              variant="body"
              color={value.stateProvince ? colors.textPrimary : colors.textTertiary}
            >
              {value.stateProvince ? regionLabel : 'Select'}
            </Typography>
            <Icon name="chevron-down" size={IconSize.sm} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>

        <View style={styles.flex}>
          {/* One field serves both countries, so it keeps the DEFAULT keyboard.
              A US ZIP is digits, but a Canadian postal code is half letters
              ("K1A 0B1") — a numeric keypad here would make a Canadian address
              impossible to type. `characters` upper-cases it either way. */}
          <TextInput
            label="Postal code"
            placeholder={value.country === 'US' ? '12345' : 'A1A 1A1'}
            value={value.postalCode}
            onChangeText={(text) => patch({ postalCode: text })}
            autoCapitalize="characters"
            testID={`${testIDPrefix}-postal`}
          />
        </View>
      </View>

      <OptionWheelPickerSheet
        visible={pickingRegion}
        title={`${subdivisionLabel} / state`}
        options={regionOptions}
        value={regionKey}
        onConfirm={handleRegionConfirm}
        onClose={() => setPickingRegion(false)}
        testID={`${testIDPrefix}-region-picker`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  autocomplete: {
    // Room for the suggestion list to drop over whatever follows it.
    zIndex: 10,
    marginBottom: Spacing.base,
  },
  label: {
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  flex: {
    flex: 1,
  },
  pickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: CornerRadius.md,
    paddingVertical: 14,
    paddingHorizontal: 16,
    minHeight: 52,
  },
});
