import { getMunicipalityByName, type MunicipalityConfig } from './municipality-configs';

/**
 * Detect Greater Vancouver Area municipality from household address
 * Parses city name and postal code to identify the municipality
 */
export interface AddressComponents {
  street?: string;
  city?: string;
  state_province?: string;
  postal_code?: string;
  country?: string;
}

export interface DetectedMunicipality {
  config: MunicipalityConfig;
  confidence: 'high' | 'medium' | 'low';
  matchedField: 'city' | 'postal_code' | 'both';
}

/**
 * Parse postal code to identify municipality (first 3 characters)
 * Note: This is approximate - postal codes can span multiple municipalities
 */
function getMunicipalityFromPostalCode(postalCode: string): MunicipalityConfig | null {
  if (!postalCode || postalCode.length < 3) return null;
  
  const fsa = postalCode.substring(0, 3).toUpperCase();
  
  // Postal code prefixes for Greater Vancouver Area
  // Note: Some FSAs (Forward Sortation Areas) span multiple municipalities.
  // For overlapping areas, we assign based on the municipality with larger coverage.
  // The city name match takes precedence over postal code for more accurate detection.
  const postalCodeMap: Record<string, string> = {
    // Vancouver - Core areas
    'V5E': 'VAN',
    'V5G': 'VAN',
    'V5H': 'VAN',
    'V5J': 'VAN',
    'V5K': 'VAN',
    'V5L': 'VAN',
    'V5M': 'VAN',
    'V5N': 'VAN',
    'V5P': 'VAN',
    'V5R': 'VAN',
    'V5S': 'VAN',
    'V5T': 'VAN',
    'V5V': 'VAN',
    'V5W': 'VAN',
    'V5X': 'VAN',
    'V5Y': 'VAN',
    'V5Z': 'VAN',
    'V6A': 'VAN',
    'V6B': 'VAN',
    'V6C': 'VAN',
    'V6E': 'VAN',
    'V6G': 'VAN',
    'V6H': 'VAN',
    'V6J': 'VAN',
    'V6K': 'VAN',
    'V6M': 'VAN',
    'V6N': 'VAN',
    'V6P': 'VAN',
    'V6R': 'VAN',
    'V6S': 'VAN',
    'V6T': 'VAN',
    'V6Z': 'VAN',
    // North Vancouver / West Vancouver areas
    'V7G': 'VAN',
    'V7H': 'VAN',
    'V7J': 'VAN',
    'V7K': 'VAN',
    'V7L': 'VAN',
    'V7M': 'VAN',
    'V7N': 'VAN',
    'V7P': 'VAN',
    'V7R': 'VAN',
    'V7S': 'VAN',
    'V7T': 'VAN',
    'V7V': 'VAN',
    'V7W': 'VAN',
    'V7X': 'VAN',
    'V7Y': 'VAN',
    'V7Z': 'VAN',
    // Burnaby (V5A, V5B, V5C overlap with Vancouver - assigning to Burnaby)
    'V5A': 'BUR',
    'V5B': 'BUR',
    'V5C': 'BUR',
    'V3N': 'BUR',
    // Surrey
    'V3R': 'SUR',
    'V3S': 'SUR',
    'V3T': 'SUR',
    'V3V': 'SUR',
    'V3W': 'SUR',
    'V3X': 'SUR',
    'V4A': 'SUR',
    'V4B': 'SUR',
    'V4C': 'SUR',
    'V4N': 'SUR',
    'V4P': 'SUR',
    // Richmond (V7A, V7B, V7C, V7E overlap with Vancouver - assigning to Richmond)
    'V6V': 'RIC',
    'V6W': 'RIC',
    'V6X': 'RIC',
    'V6Y': 'RIC',
    'V7A': 'RIC',
    'V7B': 'RIC',
    'V7C': 'RIC',
    'V7E': 'RIC',
    // Coquitlam (V3J overlaps with Burnaby - assigning to Coquitlam)
    'V3B': 'COQ',
    'V3C': 'COQ',
    'V3E': 'COQ',
    'V3H': 'COQ',
    'V3J': 'COQ',
    'V3K': 'COQ',
  };
  
  const code = postalCodeMap[fsa];
  if (!code) return null;
  
  // Lazy require here to avoid a circular dependency at module init.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getMunicipalityByCode } = require('./municipality-configs');
  return getMunicipalityByCode(code);
}

/**
 * Detect municipality from address components
 */
export function detectMunicipality(address: AddressComponents): DetectedMunicipality | null {
  if (!address.city && !address.postal_code) {
    return null;
  }
  
  let cityMatch: MunicipalityConfig | null = null;
  let postalMatch: MunicipalityConfig | null = null;
  
  // Try to match by city name
  if (address.city) {
    cityMatch = getMunicipalityByName(address.city);
  }
  
  // Try to match by postal code
  if (address.postal_code) {
    postalMatch = getMunicipalityFromPostalCode(address.postal_code);
  }
  
  // Determine confidence and matched field
  if (cityMatch && postalMatch) {
    // Both match - check if they match the same municipality
    if (cityMatch.municipality_code === postalMatch.municipality_code) {
      return {
        config: cityMatch,
        confidence: 'high',
        matchedField: 'both',
      };
    }
    // They don't match - prefer city name (more reliable)
    return {
      config: cityMatch,
      confidence: 'medium',
      matchedField: 'city',
    };
  }
  
  if (cityMatch) {
    return {
      config: cityMatch,
      confidence: 'high',
      matchedField: 'city',
    };
  }
  
  if (postalMatch) {
    return {
      config: postalMatch,
      confidence: 'medium',
      matchedField: 'postal_code',
    };
  }
  
  return null;
}

/**
 * Check if address is in Greater Vancouver Area
 */
export function isInGreaterVancouverArea(address: AddressComponents): boolean {
  // Must be in Canada
  if (address.country && address.country.toUpperCase() !== 'CA' && address.country.toUpperCase() !== 'CANADA') {
    return false;
  }
  
  const detected = detectMunicipality(address);
  return detected !== null;
}
