/**
 * BC Utility Provider configurations
 * BC Hydro, FortisBC, and other provincial utilities
 */

export interface UtilityProviderData {
  id: string;
  name: string;
  type: 'electricity' | 'gas' | 'garbage' | 'water' | 'sewer';
  service_area: string; // 'provincial' or specific city
  website_url: string;
  portal_url: string;
  billing_cycle: 'monthly' | 'bimonthly' | 'quarterly' | 'annual';
  contact_phone: string;
  contact_email: string | null;
}

export const BC_UTILITY_PROVIDERS: UtilityProviderData[] = [
  {
    id: 'bchydro',
    name: 'BC Hydro',
    type: 'electricity',
    service_area: 'provincial',
    website_url: 'https://www.bchydro.com',
    portal_url: 'https://app.bchydro.com',
    billing_cycle: 'bimonthly',
    contact_phone: '1-800-224-9376',
    contact_email: null,
  },
  {
    id: 'fortisbc',
    name: 'FortisBC',
    type: 'gas',
    service_area: 'provincial',
    website_url: 'https://www.fortisbc.com',
    portal_url: 'https://www.fortisbc.com',
    billing_cycle: 'monthly', // Customer can choose monthly or bimonthly
    contact_phone: '1-888-224-2710',
    contact_email: null,
  },
];

/**
 * Get provider by ID
 */
export function getProviderById(id: string): UtilityProviderData | null {
  return BC_UTILITY_PROVIDERS.find((p) => p.id === id) || null;
}

/**
 * Get providers by type
 */
export function getProvidersByType(type: UtilityProviderData['type']): UtilityProviderData[] {
  return BC_UTILITY_PROVIDERS.filter((p) => p.type === type);
}
