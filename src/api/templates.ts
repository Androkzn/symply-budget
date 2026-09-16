import { apiClient } from './client';

// Types
export interface MaintenanceTemplate {
  id: string;
  category: string;
  category_label: string;
  name: string;
  description?: string;
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom';
  custom_interval_days?: number;
  preferred_months?: number[];
  seasonal_only?: 'spring' | 'summer' | 'fall' | 'winter';
  difficulty?: 'easy' | 'moderate' | 'hard' | 'professional';
  estimated_duration?: number;
  estimated_cost?: { diy: number; professional: number };
  tools_required?: string[];
  tutorial_url?: string;
  gva_specific?: boolean;
  climate_zone?: string;
}

export interface TemplateCategory {
  id: string;
  label: string;
  count: number;
}

// Response types
interface TemplatesListResponse {
  templates: MaintenanceTemplate[];
  total: number;
}

interface CategoriesResponse {
  categories: TemplateCategory[];
}

interface TemplateResponse {
  template: MaintenanceTemplate;
}

export const templatesApi = {
  list: (filters?: { category?: string; gva_only?: boolean; search?: string }) =>
    apiClient
      .get<TemplatesListResponse>('/maintenance-templates', { params: filters })
      .then((res) => res.data),

  getCategories: () =>
    apiClient
      .get<CategoriesResponse>('/maintenance-templates/categories')
      .then((res) => res.data),

  get: (templateId: string) =>
    apiClient
      .get<TemplateResponse>(`/maintenance-templates/${templateId}`)
      .then((res) => res.data),
};
