import { apiClient } from './client';

export interface WasteRegulation {
  title: string;
  url: string;
}

export interface MunicipalityData {
  id: string;
  name: string;
  code: string;
  garbage_provider?: string;
  garbage_schedule_lookup_url?: string;
  waste_regulations?: {
    garbage: WasteRegulation[];
    recycling: WasteRegulation[];
    organics: WasteRegulation[];
  };
  noise_bylaws?: {
    quietHours?: {
      weekday: { start: string; end: string };
      weekend: { start: string; end: string };
    };
  };
  property_maintenance_bylaws?: {
    lawnHeightMax?: number;
  };
  contacts?: {
    bylawEnforcement?: string;
    wasteCollection?: string;
    general?: string;
  };
}

export interface WasteRegulationsResponse {
  regulations: {
    garbage: WasteRegulation[];
    recycling: WasteRegulation[];
    organics: WasteRegulation[];
  };
}

class MunicipalitiesApi {
  /**
   * Get all available municipalities
   */
  async list(): Promise<{ municipalities: MunicipalityData[] }> {
    return apiClient.get('/municipalities');
  }

  /**
   * Get municipality by name
   */
  async getByName(name: string): Promise<{ municipality: MunicipalityData }> {
    return apiClient.get(`/municipalities/${encodeURIComponent(name)}`);
  }

  /**
   * Get waste regulations for a municipality
   */
  async getWasteRegulations(name: string): Promise<WasteRegulationsResponse> {
    return apiClient.get(`/municipalities/${encodeURIComponent(name)}/waste-regulations`);
  }
}

export const municipalitiesApi = new MunicipalitiesApi();
