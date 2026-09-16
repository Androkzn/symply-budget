import { apiClient } from '@api/client';
import { putUploadViaXhr } from '@api/e2ePutUpload';
import { useAuthStore } from '@stores/authStore';

export interface PhotoUploadResult {
  photo_key: string;
  original_uri: string;
}

/**
 * Upload photos to R2 storage for maintenance tasks
 */
export async function uploadTaskPhotos(
  householdId: string,
  photoUris: string[],
  onProgress?: (progress: number) => void
): Promise<PhotoUploadResult[]> {
  if (!photoUris || photoUris.length === 0) {
    return [];
  }

  const results: PhotoUploadResult[] = [];
  const totalPhotos = photoUris.length;

  for (let i = 0; i < photoUris.length; i++) {
    const uri = photoUris[i];

    try {
      // Get the file info
      const filename = uri.split('/').pop() || `photo-${Date.now()}.jpg`;
      const contentType = getContentTypeFromUri(uri);

      // Step 1: Get upload URL
      const uploadUrlRes = await apiClient.post<{
        photo_id: string;
        photo_key: string;
        upload_url: string;
        expires_at: string;
      }>(`/households/${householdId}/tasks/photos/upload-url`, {
        filename,
        content_type: contentType,
      });

      const { photo_key, upload_url } = uploadUrlRes.data;

      // Step 2: Read the file
      const fileBlob = await uriToBlob(uri);

      // Step 3: Upload to R2
      const token = useAuthStore.getState().token;
      await uploadFile(upload_url, fileBlob, contentType, token);

      results.push({
        photo_key,
        original_uri: uri,
      });

      // Update progress
      if (onProgress) {
        const progress = ((i + 1) / totalPhotos) * 100;
        onProgress(Math.round(progress));
      }
    } catch (error) {
      console.error(`Failed to upload photo ${uri}:`, error);
      throw new Error(`Failed to upload photo: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  return results;
}

/**
 * Convert URI to Blob for upload
 */
async function uriToBlob(uri: string): Promise<Blob> {
  const response = await fetch(uri);
  const blob = await response.blob();
  return blob;
}

/**
 * Get content type from URI
 */
function getContentTypeFromUri(uri: string): string {
  const extension = uri.split('.').pop()?.toLowerCase();

  switch (extension) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'heic':
      return 'image/heic';
    default:
      return 'image/jpeg'; // default
  }
}

/**
 * Upload file to pre-signed URL
 */
async function uploadFile(
  uploadUrl: string,
  file: Blob,
  contentType: string,
  token?: string | null
): Promise<void> {
  return putUploadViaXhr({
    uploadUrl,
    body: file,
    contentType,
    authorization: token,
    label: 'task-photo',
  });
}
