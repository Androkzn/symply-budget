/**
 * Municipality configurations for all 21 Greater Vancouver Area municipalities
 * Includes property tax due dates, utility due dates, penalties, and portal links
 */

export interface MunicipalityConfig {
  id: string;
  municipality_name: string;
  municipality_code: string;
  property_tax_advance_due_date: string | null;
  property_tax_main_due_date: string; // Format: "July 2" or "July 3"
  utility_due_date: string | null;
  early_discount_percentage: number | null;
  penalty_structure: {
    daysAfterDue: number;
    percentage: number;
  }[];
  portal_url: string;
  contact_phone: string;
  contact_email: string | null;
}

export const MUNICIPALITY_CONFIGS: MunicipalityConfig[] = [
  {
    id: 'van',
    municipality_name: 'Vancouver',
    municipality_code: 'VAN',
    property_tax_advance_due_date: null,
    property_tax_main_due_date: 'July 3',
    utility_due_date: 'July 3', // For flat rate on property tax notice
    early_discount_percentage: null,
    penalty_structure: [{ daysAfterDue: 1, percentage: 5 }],
    portal_url: 'https://vancouver.ca/home-property-development/property-tax.aspx',
    contact_phone: '311',
    contact_email: null,
  },
  {
    id: 'bur',
    municipality_name: 'Burnaby',
    municipality_code: 'BUR',
    property_tax_advance_due_date: null,
    property_tax_main_due_date: 'July 2',
    utility_due_date: 'March 17',
    early_discount_percentage: 5,
    penalty_structure: [
      { daysAfterDue: 1, percentage: 5 },
      { daysAfterDue: 60, percentage: 5 }, // September
    ],
    portal_url: 'https://www.burnaby.ca/services-and-payments/property-taxes',
    contact_phone: '604-294-7350',
    contact_email: null,
  },
  {
    id: 'sur',
    municipality_name: 'Surrey',
    municipality_code: 'SUR',
    property_tax_advance_due_date: null,
    property_tax_main_due_date: 'July 2',
    utility_due_date: 'April 2',
    early_discount_percentage: null, // Via PAPP
    penalty_structure: [
      { daysAfterDue: 1, percentage: 5 },
      { daysAfterDue: 60, percentage: 5 },
    ],
    portal_url: 'https://www.surrey.ca/services-payments/property-taxes',
    contact_phone: '604-591-4181',
    contact_email: null,
  },
  {
    id: 'ric',
    municipality_name: 'Richmond',
    municipality_code: 'RIC',
    property_tax_advance_due_date: null,
    property_tax_main_due_date: 'July 2',
    utility_due_date: 'March 31',
    early_discount_percentage: 10,
    penalty_structure: [{ daysAfterDue: 1, percentage: 0.5 }], // Daily interest
    portal_url: 'https://www.richmond.ca/city-hall/finance/rates/howtopay.htm',
    contact_phone: '604-276-4145',
    contact_email: null,
  },
  {
    id: 'coq',
    municipality_name: 'Coquitlam',
    municipality_code: 'COQ',
    property_tax_advance_due_date: null,
    property_tax_main_due_date: 'July 2',
    utility_due_date: 'March 31',
    early_discount_percentage: null,
    penalty_structure: [
      { daysAfterDue: 1, percentage: 5 },
      { daysAfterDue: 60, percentage: 5 },
    ],
    portal_url: 'https://www.coquitlam.ca/544/Property-Taxes',
    contact_phone: '604-927-3000',
    contact_email: null,
  },
  {
    id: 'new',
    municipality_name: 'New Westminster',
    municipality_code: 'NEW',
    property_tax_advance_due_date: null,
    property_tax_main_due_date: 'July 2',
    utility_due_date: null, // Varies
    early_discount_percentage: null,
    penalty_structure: [
      { daysAfterDue: 1, percentage: 5 },
      { daysAfterDue: 60, percentage: 5 }, // September 6
    ],
    portal_url: 'https://www.newwestcity.ca/propertytaxes-utilities',
    contact_phone: '604-527-4523',
    contact_email: null,
  },
  {
    id: 'nv_city',
    municipality_name: 'North Vancouver (City)',
    municipality_code: 'NV_CITY',
    property_tax_advance_due_date: null,
    property_tax_main_due_date: 'July 2',
    utility_due_date: null, // Varies
    early_discount_percentage: null,
    penalty_structure: [{ daysAfterDue: 1, percentage: 5 }],
    portal_url: 'https://www.cnv.org/home-property/property-taxes',
    contact_phone: '604-985-7761',
    contact_email: null,
  },
  {
    id: 'nv_dist',
    municipality_name: 'North Vancouver (District)',
    municipality_code: 'NV_DIST',
    property_tax_advance_due_date: null,
    property_tax_main_due_date: 'July 2',
    utility_due_date: null, // Varies
    early_discount_percentage: null,
    penalty_structure: [{ daysAfterDue: 1, percentage: 5 }],
    portal_url: 'https://www.dnv.org/your-home-property/property-taxes',
    contact_phone: '604-990-2311',
    contact_email: null,
  },
  {
    id: 'wv',
    municipality_name: 'West Vancouver',
    municipality_code: 'WV',
    property_tax_advance_due_date: null,
    property_tax_main_due_date: 'July 2',
    utility_due_date: null, // Varies
    early_discount_percentage: null,
    penalty_structure: [
      { daysAfterDue: 1, percentage: 5 },
      { daysAfterDue: 60, percentage: 5 }, // September 2
    ],
    portal_url: 'https://westvancouver.ca/services/taxes-utility-fees',
    contact_phone: '604-925-7000',
    contact_email: null,
  },
  {
    id: 'mr',
    municipality_name: 'Maple Ridge',
    municipality_code: 'MR',
    property_tax_advance_due_date: null,
    property_tax_main_due_date: 'July 2',
    utility_due_date: null, // With property tax
    early_discount_percentage: null,
    penalty_structure: [{ daysAfterDue: 1, percentage: 5 }],
    portal_url: 'https://www.mapleridge.ca/your-government/property-taxes',
    contact_phone: '604-463-5221',
    contact_email: null,
  },
  {
    id: 'pc',
    municipality_name: 'Port Coquitlam',
    municipality_code: 'PC',
    property_tax_advance_due_date: null,
    property_tax_main_due_date: 'July 2',
    utility_due_date: null, // Varies
    early_discount_percentage: null,
    penalty_structure: [{ daysAfterDue: 1, percentage: 5 }],
    portal_url: 'https://www.portcoquitlam.ca/services/property-taxes',
    contact_phone: '604-927-5411',
    contact_email: null,
  },
  {
    id: 'pm',
    municipality_name: 'Port Moody',
    municipality_code: 'PM',
    property_tax_advance_due_date: null,
    property_tax_main_due_date: 'July 2',
    utility_due_date: null, // Varies
    early_discount_percentage: null,
    penalty_structure: [{ daysAfterDue: 1, percentage: 5 }],
    portal_url: 'https://www.portmoody.ca/',
    contact_phone: '604-469-4500',
    contact_email: null,
  },
  {
    id: 'pit',
    municipality_name: 'Pitt Meadows',
    municipality_code: 'PIT',
    property_tax_advance_due_date: null,
    property_tax_main_due_date: 'July 2',
    utility_due_date: null, // Varies
    early_discount_percentage: null,
    penalty_structure: [
      { daysAfterDue: 1, percentage: 5 },
      { daysAfterDue: 30, percentage: 5 }, // August 1
    ],
    portal_url: 'https://www.pittmeadows.ca/city-hall/property-taxes',
    contact_phone: '604-465-5454',
    contact_email: null,
  },
  {
    id: 'del',
    municipality_name: 'Delta',
    municipality_code: 'DEL',
    property_tax_advance_due_date: null,
    property_tax_main_due_date: 'July 2',
    utility_due_date: null, // Varies
    early_discount_percentage: null,
    penalty_structure: [{ daysAfterDue: 1, percentage: 5 }],
    portal_url: 'https://www.delta.ca/',
    contact_phone: '604-946-4141',
    contact_email: null,
  },
  {
    id: 'lang_city',
    municipality_name: 'Langley (City)',
    municipality_code: 'LANG_CITY',
    property_tax_advance_due_date: null,
    property_tax_main_due_date: 'July 2',
    utility_due_date: null, // Varies
    early_discount_percentage: null,
    penalty_structure: [{ daysAfterDue: 1, percentage: 5 }],
    portal_url: 'https://www.langleycity.ca/',
    contact_phone: '604-514-2800',
    contact_email: null,
  },
  {
    id: 'lang_twp',
    municipality_name: 'Langley (Township)',
    municipality_code: 'LANG_TWP',
    property_tax_advance_due_date: null,
    property_tax_main_due_date: 'July 2',
    utility_due_date: null, // Varies
    early_discount_percentage: null,
    penalty_structure: [{ daysAfterDue: 1, percentage: 5 }],
    portal_url: 'https://www.tol.ca/',
    contact_phone: '604-534-3211',
    contact_email: null,
  },
  {
    id: 'wr',
    municipality_name: 'White Rock',
    municipality_code: 'WR',
    property_tax_advance_due_date: null,
    property_tax_main_due_date: 'July 2',
    utility_due_date: null, // Varies
    early_discount_percentage: null,
    penalty_structure: [{ daysAfterDue: 1, percentage: 5 }],
    portal_url: 'https://www.whiterockcity.ca/',
    contact_phone: '604-541-2100',
    contact_email: null,
  },
  {
    id: 'anm',
    municipality_name: 'Anmore',
    municipality_code: 'ANM',
    property_tax_advance_due_date: null,
    property_tax_main_due_date: 'July 2',
    utility_due_date: null,
    early_discount_percentage: null,
    penalty_structure: [{ daysAfterDue: 1, percentage: 5 }],
    portal_url: 'https://www.anmore.com/',
    contact_phone: '604-469-9877',
    contact_email: null,
  },
  {
    id: 'bel',
    municipality_name: 'Belcarra',
    municipality_code: 'BEL',
    property_tax_advance_due_date: null,
    property_tax_main_due_date: 'July 2',
    utility_due_date: null,
    early_discount_percentage: null,
    penalty_structure: [{ daysAfterDue: 1, percentage: 5 }],
    portal_url: 'https://www.belcarra.ca/',
    contact_phone: '604-937-4100',
    contact_email: null,
  },
  {
    id: 'lb',
    municipality_name: 'Lions Bay',
    municipality_code: 'LB',
    property_tax_advance_due_date: null,
    property_tax_main_due_date: 'July 2',
    utility_due_date: null,
    early_discount_percentage: null,
    penalty_structure: [{ daysAfterDue: 1, percentage: 5 }],
    portal_url: 'https://www.lionsbay.ca/',
    contact_phone: '604-921-9333',
    contact_email: null,
  },
  {
    id: 'bi',
    municipality_name: 'Bowen Island',
    municipality_code: 'BI',
    property_tax_advance_due_date: null,
    property_tax_main_due_date: 'July 2',
    utility_due_date: null,
    early_discount_percentage: null,
    penalty_structure: [{ daysAfterDue: 1, percentage: 5 }],
    portal_url: 'https://www.bimbc.ca/',
    contact_phone: '604-947-4255',
    contact_email: null,
  },
];

/**
 * Get municipality config by name (case-insensitive, handles variations)
 */
export function getMunicipalityByName(name: string): MunicipalityConfig | null {
  const normalized = name.toLowerCase().trim();
  
  for (const config of MUNICIPALITY_CONFIGS) {
    const configName = config.municipality_name.toLowerCase();
    if (
      configName === normalized ||
      configName.includes(normalized) ||
      normalized.includes(configName.split('(')[0].trim())
    ) {
      return config;
    }
  }
  
  return null;
}

/**
 * Get municipality config by code
 */
export function getMunicipalityByCode(code: string): MunicipalityConfig | null {
  return MUNICIPALITY_CONFIGS.find((c) => c.municipality_code === code.toUpperCase()) || null;
}

/**
 * Check if a city name is in Greater Vancouver Area
 */
export function isGreaterVancouverArea(cityName: string): boolean {
  return getMunicipalityByName(cityName) !== null;
}
