/**
 * The Google Places → form-fields parser.
 *
 * This is the half of address autocomplete that fails silently: a member picks a
 * place, the street line fills in, and the city or the postal code quietly does
 * not — because the component name a place uses varies (`locality` vs
 * `sublocality`) and because there is no error anywhere when a lookup returns
 * a shape the parser did not expect. It is pure, so it can be pinned down here
 * without a key, a network call, or a rendered autocomplete.
 */

jest.mock('react-native-google-places-autocomplete', () => ({
  __esModule: true,
  GooglePlacesAutocomplete: () => null,
}));

import { addressFromPlaceDetails, isAddressEmpty, EMPTY_ADDRESS } from '../AddressFields';

function component(types: string[], long: string, short = long) {
  return { types, long_name: long, short_name: short };
}

describe('addressFromPlaceDetails', () => {
  it('splits a Canadian place into the five fields', () => {
    const result = addressFromPlaceDetails({
      address_components: [
        component(['street_number'], '742'),
        component(['route'], 'Evergreen Terrace'),
        component(['locality'], 'Vancouver'),
        component(['administrative_area_level_1'], 'British Columbia', 'BC'),
        component(['postal_code'], 'V6B 1A1'),
        component(['country'], 'Canada', 'CA'),
      ],
    });

    expect(result).toEqual({
      addressLine1: '742 Evergreen Terrace',
      city: 'Vancouver',
      // The SHORT name, because that is the code the household record stores and
      // the code the region list is keyed by.
      stateProvince: 'BC',
      postalCode: 'V6B 1A1',
      country: 'CA',
    });
  });

  it('reads a US place as US', () => {
    const result = addressFromPlaceDetails({
      address_components: [
        component(['street_number'], '1600'),
        component(['route'], 'Pennsylvania Avenue NW'),
        component(['locality'], 'Washington'),
        component(['administrative_area_level_1'], 'District of Columbia', 'DC'),
        component(['country'], 'United States', 'US'),
      ],
    });
    expect(result.country).toBe('US');
    expect(result.stateProvince).toBe('DC');
    // Absent in the response, so absent here — never the previous value.
    expect(result.postalCode).toBe('');
  });

  it('falls back to sublocality when a place has no locality', () => {
    const result = addressFromPlaceDetails({
      address_components: [
        component(['route'], 'Baker Street'),
        component(['sublocality'], 'Marylebone'),
      ],
    });
    expect(result.city).toBe('Marylebone');
  });

  it('keeps the description as the street line for a place with no street', () => {
    // A landmark or a neighbourhood: no `street_number`/`route`, so an empty
    // street line would CLEAR the field the member just picked into.
    const result = addressFromPlaceDetails(
      { address_components: [component(['locality'], 'Banff')] },
      'Banff National Park, AB, Canada',
    );
    expect(result.addressLine1).toBe('Banff National Park, AB, Canada');
  });

  it('returns the description alone when details never arrived', () => {
    // `fetchDetails` can come back null — the prediction is still all the member
    // gave us, and it is better than nothing in the field.
    expect(addressFromPlaceDetails(null, '10 Downing Street')).toEqual({
      addressLine1: '10 Downing Street',
    });
    expect(addressFromPlaceDetails(undefined)).toEqual({});
  });
});

describe('isAddressEmpty', () => {
  it('treats a country-only address as empty', () => {
    // `country` defaults to 'CA' whether or not anyone typed an address, so
    // counting it would make every household look like it had one.
    expect(isAddressEmpty(EMPTY_ADDRESS)).toBe(true);
    expect(isAddressEmpty({ ...EMPTY_ADDRESS, country: 'US' })).toBe(true);
  });

  it('treats whitespace as empty', () => {
    expect(isAddressEmpty({ ...EMPTY_ADDRESS, city: '   ' })).toBe(true);
  });

  it('is not empty once any field is filled', () => {
    expect(isAddressEmpty({ ...EMPTY_ADDRESS, postalCode: 'V6B 1A1' })).toBe(false);
    expect(isAddressEmpty({ ...EMPTY_ADDRESS, stateProvince: 'ON' })).toBe(false);
  });
});
