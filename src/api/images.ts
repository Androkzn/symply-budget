import { api, ensureData } from './client';

// Types
export type ImageType = 'photo' | 'chart' | 'table' | 'diagram' | 'other';

export interface ReportImage {
  id: string;
  report_id: string;
  household_id: string;
  page_number: number | null;
  storage_key: string;
  original_filename: string | null;
  content_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  caption: string | null;
  ai_description: string | null;
  system_category: string | null;
  image_type: ImageType | null;
  linked_finding_id: string | null;
  extraction_source: 'pdf' | 'upload' | 'camera';
  created_at: string;
  updated_at: string;
}

export interface GetImagesFilters {
  page_number?: number;
  system_category?: string;
  limit?: number;
  offset?: number;
}

export interface UploadImageOptions {
  page_number?: number;
  system_category?: string;
  image_type?: ImageType;
}

export interface UpdateImageRequest {
  caption?: string;
  ai_description?: string;
  system_category?: string;
  image_type?: ImageType;
}

export interface LinkImageRequest {
  finding_id: string;
}

// Image type labels for UI
export const IMAGE_TYPES = [
  { value: 'photo', label: 'Photo' },
  { value: 'chart', label: 'Chart' },
  { value: 'table', label: 'Table' },
  { value: 'diagram', label: 'Diagram' },
  { value: 'other', label: 'Other' },
] as const;

// API functions
export const imagesApi = {
  /**
   * Get all images for a report
   */
  async getReportImages(
    householdId: string,
    reportId: string,
    filters?: GetImagesFilters
  ): Promise<ReportImage[]> {
    const params = new URLSearchParams();
    if (filters?.page_number !== undefined) {
      params.append('page_number', filters.page_number.toString());
    }
    if (filters?.system_category) {
      params.append('system_category', filters.system_category);
    }
    if (filters?.limit !== undefined) {
      params.append('limit', filters.limit.toString());
    }
    if (filters?.offset !== undefined) {
      params.append('offset', filters.offset.toString());
    }

    const queryString = params.toString();
    const url = `/households/${householdId}/reports/${reportId}/images${queryString ? `?${queryString}` : ''}`;

    const response = await api.get<{ images: ReportImage[] }>(url);
    return ensureData(response, 'Failed to get report images').images;
  },

  /**
   * Get a single image by ID
   */
  async getImage(householdId: string, imageId: string): Promise<ReportImage> {
    const response = await api.get<{ image: ReportImage }>(
      `/households/${householdId}/images/${imageId}`
    );
    return ensureData(response, 'Failed to get image').image;
  },

  /**
   * Get images linked to a finding
   */
  async getFindingImages(
    householdId: string,
    findingId: string
  ): Promise<ReportImage[]> {
    const response = await api.get<{ images: ReportImage[] }>(
      `/households/${householdId}/findings/${findingId}/images`
    );
    return ensureData(response, 'Failed to get finding images').images;
  },

  /**
   * Upload an image for a report
   */
  async uploadImage(
    householdId: string,
    reportId: string,
    file: {
      uri: string;
      type: string;
      name: string;
    },
    options?: UploadImageOptions
  ): Promise<ReportImage> {
    const formData = new FormData();

    // Append file
    formData.append('file', {
      uri: file.uri,
      type: file.type,
      name: file.name,
    } as unknown as Blob);

    // Append optional metadata
    if (options?.page_number !== undefined) {
      formData.append('page_number', options.page_number.toString());
    }
    if (options?.system_category) {
      formData.append('system_category', options.system_category);
    }
    if (options?.image_type) {
      formData.append('image_type', options.image_type);
    }

    const response = await api.upload<{ image: ReportImage }>(
      `/households/${householdId}/reports/${reportId}/images`,
      formData
    );
    if (!response?.image) {
      throw new Error('Failed to upload image: no image data returned');
    }
    return response.image;
  },

  /**
   * Update image metadata
   */
  async updateImage(
    householdId: string,
    imageId: string,
    data: UpdateImageRequest
  ): Promise<ReportImage> {
    const response = await api.patch<{ image: ReportImage }>(
      `/households/${householdId}/images/${imageId}`,
      data
    );
    return ensureData(response, 'Failed to update image').image;
  },

  /**
   * Link an image to a finding
   */
  async linkImageToFinding(
    householdId: string,
    imageId: string,
    findingId: string
  ): Promise<void> {
    await api.post(`/households/${householdId}/images/${imageId}/link`, {
      finding_id: findingId,
    });
  },

  /**
   * Delete an image
   */
  async deleteImage(householdId: string, imageId: string): Promise<void> {
    await api.delete(`/households/${householdId}/images/${imageId}`);
  },

  /**
   * Get the URL for displaying an image
   * Uses the public image serving endpoint
   */
  getImageUrl(storageKey: string, baseUrl: string): string {
    return `${baseUrl}/api/images/${encodeURIComponent(storageKey)}`;
  },
};
