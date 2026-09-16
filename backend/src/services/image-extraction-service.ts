/**
 * Image Extraction Service
 *
 * Manages images extracted from PDF inspection reports.
 * Handles storage in R2, thumbnail generation, and linking to findings.
 *
 * Note: Actual PDF image extraction happens in Lambda (using Python libraries).
 * This service handles the storage and retrieval side.
 */

import { eq, and } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import * as schema from '../db/schema';
import type { Database, Env } from '../types';
import { generateId, now } from '../utils/id';

export interface ExtractedImage {
  id?: string;
  report_id: string;
  household_id: string;
  page_number?: number;
  image_key: string;
  thumbnail_key?: string;
  content_type?: string;
  image_type?: 'photo' | 'chart' | 'table' | 'diagram' | 'other';
  width?: number;
  height?: number;
  file_size?: number;
  caption?: string;
  ai_description?: string;
  system_category?: string;
  finding_id?: string;
  finding_ids?: string[];
  extraction_method?: 'pdf_native' | 'pdf_render' | 'ocr' | 'manual_upload';
  extraction_confidence?: number;
}

export interface ImageUploadResult {
  id: string;
  image_key: string;
  thumbnail_key?: string;
  url: string;
  thumbnail_url?: string;
}

export class ImageExtractionService {
  private db: Database;
  private env: Env;

  constructor(env: Env, d1: D1Database) {
    this.db = drizzle(d1, { schema });
    this.env = env;
  }

  /**
   * Store an extracted image from the Lambda processor
   */
  async storeExtractedImage(image: ExtractedImage): Promise<string> {
    const imageId = image.id || generateId();
    const timestamp = now();

    await this.db.insert(schema.reportImages).values({
      id: imageId,
      report_id: image.report_id,
      household_id: image.household_id,
      image_key: image.image_key,
      thumbnail_key: image.thumbnail_key,
      content_type: image.content_type || 'image/jpeg',
      image_type: image.image_type,
      width: image.width,
      height: image.height,
      file_size: image.file_size,
      page_number: image.page_number,
      caption: image.caption,
      ai_description: image.ai_description,
      system_category: image.system_category,
      finding_id: image.finding_id,
      finding_ids: image.finding_ids ? JSON.stringify(image.finding_ids) : null,
      extraction_method: image.extraction_method,
      extraction_confidence: image.extraction_confidence,
      status: 'ready',
      created_at: timestamp,
      updated_at: timestamp,
    });

    return imageId;
  }

  /**
   * Bulk store images extracted from a report
   */
  async bulkStoreImages(
    reportId: string,
    householdId: string,
    images: Array<Omit<ExtractedImage, 'report_id' | 'household_id'>>
  ): Promise<string[]> {
    const timestamp = now();
    const imageIds: string[] = [];

    for (const image of images) {
      const imageId = image.id || generateId();
      imageIds.push(imageId);

      await this.db.insert(schema.reportImages).values({
        id: imageId,
        report_id: reportId,
        household_id: householdId,
        image_key: image.image_key,
        thumbnail_key: image.thumbnail_key,
        content_type: image.content_type || 'image/jpeg',
        image_type: image.image_type,
        width: image.width,
        height: image.height,
        file_size: image.file_size,
        page_number: image.page_number,
        caption: image.caption,
        ai_description: image.ai_description,
        system_category: image.system_category,
        finding_id: image.finding_id,
        finding_ids: image.finding_ids ? JSON.stringify(image.finding_ids) : null,
        extraction_method: image.extraction_method,
        extraction_confidence: image.extraction_confidence,
        status: 'ready',
        created_at: timestamp,
        updated_at: timestamp,
      });
    }

    return imageIds;
  }

  /**
   * Upload an image to R2 storage
   */
  async uploadImage(
    reportId: string,
    householdId: string,
    imageData: ArrayBuffer,
    contentType: string,
    metadata: {
      page_number?: number;
      original_filename?: string;
      system_category?: string;
      image_type?: 'photo' | 'chart' | 'table' | 'diagram' | 'other';
    } = {}
  ): Promise<ImageUploadResult> {
    const imageId = generateId();
    const timestamp = now();
    const extension = this.getExtensionFromContentType(contentType);
    const imageKey = `reports/${reportId}/images/${imageId}.${extension}`;

    // Upload to R2
    await this.env.REPORTS_BUCKET.put(imageKey, imageData, {
      httpMetadata: {
        contentType,
      },
      customMetadata: {
        reportId,
        householdId,
        pageNumber: metadata.page_number?.toString() || '',
      },
    });

    // Generate thumbnail (simplified - in production, use an image processing service)
    // For now, we'll use the same image as thumbnail
    const thumbnailKey = `reports/${reportId}/thumbnails/${imageId}.${extension}`;
    await this.env.REPORTS_BUCKET.put(thumbnailKey, imageData, {
      httpMetadata: {
        contentType,
      },
    });

    // Store in database
    await this.db.insert(schema.reportImages).values({
      id: imageId,
      report_id: reportId,
      household_id: householdId,
      image_key: imageKey,
      thumbnail_key: thumbnailKey,
      original_filename: metadata.original_filename,
      content_type: contentType,
      file_size: imageData.byteLength,
      page_number: metadata.page_number,
      image_type: metadata.image_type,
      system_category: metadata.system_category,
      extraction_method: 'manual_upload',
      status: 'ready',
      created_at: timestamp,
      updated_at: timestamp,
    });

    return {
      id: imageId,
      image_key: imageKey,
      thumbnail_key: thumbnailKey,
      url: this.getImageUrl(imageKey),
      thumbnail_url: this.getImageUrl(thumbnailKey),
    };
  }

  /**
   * Get images for a report
   */
  async getReportImages(
    reportId: string,
    options: {
      page_number?: number;
      system_category?: string;
      limit?: number;
      offset?: number;
    } = {}
  ) {
    const images = await this.db
      .select()
      .from(schema.reportImages)
      .where(
        and(
          eq(schema.reportImages.report_id, reportId),
          eq(schema.reportImages.status, 'ready')
        )
      );

    // Apply filters
    let filtered = images;
    if (options.page_number !== undefined) {
      filtered = filtered.filter((img) => img.page_number === options.page_number);
    }
    if (options.system_category) {
      filtered = filtered.filter((img) => img.system_category === options.system_category);
    }

    // Sort by page number
    filtered.sort((a, b) => (a.page_number || 0) - (b.page_number || 0));

    // Apply pagination
    const start = options.offset || 0;
    const end = options.limit ? start + options.limit : filtered.length;
    const paginated = filtered.slice(start, end);

    // Add URLs
    return paginated.map((img) => ({
      ...img,
      url: this.getImageUrl(img.image_key),
      thumbnail_url: img.thumbnail_key ? this.getImageUrl(img.thumbnail_key) : undefined,
      finding_ids: img.finding_ids ? JSON.parse(img.finding_ids as string) : [],
    }));
  }

  /**
   * Get images linked to a specific finding
   */
  async getImagesForFinding(findingId: string) {
    const images = await this.db
      .select()
      .from(schema.reportImages)
      .where(
        and(
          eq(schema.reportImages.finding_id, findingId),
          eq(schema.reportImages.status, 'ready')
        )
      );

    return images.map((img) => ({
      ...img,
      url: this.getImageUrl(img.image_key),
      thumbnail_url: img.thumbnail_key ? this.getImageUrl(img.thumbnail_key) : undefined,
    }));
  }

  /**
   * Get images linked to multiple findings (via finding_ids JSON array)
   */
  async getImagesForFindings(findingIds: string[]) {
    const images = await this.db
      .select()
      .from(schema.reportImages)
      .where(eq(schema.reportImages.status, 'ready'));

    // Filter by finding IDs (either direct reference or in JSON array)
    const filtered = images.filter((img) => {
      // Check direct finding_id reference
      if (img.finding_id && findingIds.includes(img.finding_id)) {
        return true;
      }
      // Check JSON array
      if (img.finding_ids) {
        try {
          const ids = JSON.parse(img.finding_ids as string);
          return findingIds.some((fid) => ids.includes(fid));
        } catch {
          return false;
        }
      }
      return false;
    });

    return filtered.map((img) => ({
      ...img,
      url: this.getImageUrl(img.image_key),
      thumbnail_url: img.thumbnail_key ? this.getImageUrl(img.thumbnail_key) : undefined,
      finding_ids: img.finding_ids ? JSON.parse(img.finding_ids as string) : [],
    }));
  }

  /**
   * Get a single image by ID
   */
  async getImage(imageId: string) {
    const image = await this.db
      .select()
      .from(schema.reportImages)
      .where(eq(schema.reportImages.id, imageId))
      .get();

    if (!image) return null;

    return {
      ...image,
      url: this.getImageUrl(image.image_key),
      thumbnail_url: image.thumbnail_key ? this.getImageUrl(image.thumbnail_key) : undefined,
      finding_ids: image.finding_ids ? JSON.parse(image.finding_ids as string) : [],
    };
  }

  /**
   * Link an image to a finding
   */
  async linkImageToFinding(imageId: string, findingId: string) {
    const timestamp = now();

    const image = await this.db
      .select()
      .from(schema.reportImages)
      .where(eq(schema.reportImages.id, imageId))
      .get();

    if (!image) return false;

    // Update the finding_ids array
    const existingIds = image.finding_ids
      ? JSON.parse(image.finding_ids as string)
      : [];

    if (!existingIds.includes(findingId)) {
      existingIds.push(findingId);
      await this.db
        .update(schema.reportImages)
        .set({
          finding_ids: JSON.stringify(existingIds),
          updated_at: timestamp,
        })
        .where(eq(schema.reportImages.id, imageId));
    }

    return true;
  }

  /**
   * Update image caption/description
   */
  async updateImageMetadata(
    imageId: string,
    updates: {
      caption?: string;
      ai_description?: string;
      system_category?: string;
      image_type?: string;
    }
  ) {
    const timestamp = now();

    await this.db
      .update(schema.reportImages)
      .set({
        ...updates,
        updated_at: timestamp,
      })
      .where(eq(schema.reportImages.id, imageId));
  }

  /**
   * Delete an image
   */
  async deleteImage(imageId: string): Promise<boolean> {
    const image = await this.db
      .select()
      .from(schema.reportImages)
      .where(eq(schema.reportImages.id, imageId))
      .get();

    if (!image) return false;

    // Delete from R2
    try {
      await this.env.REPORTS_BUCKET.delete(image.image_key);
      if (image.thumbnail_key) {
        await this.env.REPORTS_BUCKET.delete(image.thumbnail_key);
      }
    } catch (error) {
      console.error(`Failed to delete image files for ${imageId}:`, error);
    }

    // Mark as deleted in database
    await this.db
      .update(schema.reportImages)
      .set({
        status: 'deleted',
        updated_at: now(),
      })
      .where(eq(schema.reportImages.id, imageId));

    return true;
  }

  /**
   * Get the raw image data from R2
   */
  async getImageData(imageKey: string): Promise<{ data: ArrayBuffer; contentType: string } | null> {
    const object = await this.env.REPORTS_BUCKET.get(imageKey);
    if (!object) return null;

    return {
      data: await object.arrayBuffer(),
      contentType: object.httpMetadata?.contentType || 'image/jpeg',
    };
  }

  /**
   * Get public URL for an image
   */
  private getImageUrl(imageKey: string): string {
    // Use the R2 public URL if configured, otherwise use the Worker URL
    const publicDomain = this.env.R2_PUBLIC_DOMAIN;
    if (publicDomain) {
      return `https://${publicDomain}/${imageKey}`;
    }
    // Fallback to serving through the API
    return `/api/images/${encodeURIComponent(imageKey)}`;
  }

  /**
   * Get file extension from content type
   */
  private getExtensionFromContentType(contentType: string): string {
    const map: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
    };
    return map[contentType] || 'jpg';
  }
}
