import { eq, and, isNull, desc, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import * as maintenanceSchema from '../db/schema-maintenance';
import type { Database, Env } from '../types';
import { NotFoundError } from '../utils/errors';
import { generateId, now } from '../utils/id';

export interface ServiceProviderResponse {
  id: string;
  name: string;
  category: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  service_areas?: string[];
  rating?: number;
  review_count: number;
  is_verified: boolean;
  created_at: string;
  updated_at: string;
}

export interface ServiceProviderReviewResponse {
  id: string;
  provider_id: string;
  user_id: string;
  household_id?: string;
  rating: number;
  review_text?: string;
  service_date?: string;
  cost?: number;
  created_at: string;
}

export class ServiceProviderService {
  private db: Database;

  constructor(_env: Env, d1: D1Database) {
    this.db = drizzle(d1);
  }

  /**
   * Get a service provider by ID
   */
  async getProvider(providerId: string): Promise<ServiceProviderResponse> {
    const provider = await this.db
      .select()
      .from(maintenanceSchema.serviceProviders)
      .where(
        and(
          eq(maintenanceSchema.serviceProviders.id, providerId),
          isNull(maintenanceSchema.serviceProviders.deleted_at)
        )
      )
      .limit(1);

    if (provider.length === 0) {
      throw new NotFoundError('Service provider not found');
    }

    return this.mapProviderToResponse(provider[0]);
  }

  /**
   * List service providers with optional filters
   */
  async listProviders(filters?: {
    category?: string;
    service_area?: string;
    min_rating?: number;
    is_verified?: boolean;
    search?: string;
  }): Promise<ServiceProviderResponse[]> {
    const conditions: any[] = [
      isNull(maintenanceSchema.serviceProviders.deleted_at),
    ];

    if (filters?.category) {
      conditions.push(eq(maintenanceSchema.serviceProviders.category, filters.category));
    }

    if (filters?.is_verified !== undefined) {
      conditions.push(
        eq(maintenanceSchema.serviceProviders.is_verified, filters.is_verified)
      );
    }

    if (filters?.min_rating) {
      conditions.push(
        sql`${maintenanceSchema.serviceProviders.rating} >= ${filters.min_rating}`
      );
    }

    // Note: service_area and search would require more complex queries
    // For now, we'll filter in application code if needed

    const providers = await this.db
      .select()
      .from(maintenanceSchema.serviceProviders)
      .where(and(...conditions))
      .orderBy(desc(maintenanceSchema.serviceProviders.rating), desc(maintenanceSchema.serviceProviders.review_count));

    let result = providers.map((p) => this.mapProviderToResponse(p));

    // Filter by service area if provided
    if (filters?.service_area) {
      result = result.filter((p) => p.service_areas?.includes(filters.service_area!));
    }

    // Filter by search term if provided
    if (filters?.search) {
      const searchLower = filters.search.toLowerCase();
      result = result.filter((p) =>
        p.name.toLowerCase().includes(searchLower) ||
        p.category.toLowerCase().includes(searchLower)
      );
    }

    return result;
  }

  /**
   * Create a service provider (admin function)
   */
  async createProvider(
    input: {
      name: string;
      category: string;
      phone?: string;
      email?: string;
      website?: string;
      address?: string;
      service_areas?: string[];
      is_verified?: boolean;
    }
  ): Promise<ServiceProviderResponse> {
    const providerId = generateId();
    const timestamp = now();

    await this.db.insert(maintenanceSchema.serviceProviders).values({
      id: providerId,
      name: input.name,
      category: input.category,
      phone: input.phone || null,
      email: input.email || null,
      website: input.website || null,
      address: input.address || null,
      service_areas: input.service_areas ? JSON.stringify(input.service_areas) : null,
      rating: null,
      review_count: 0,
      is_verified: input.is_verified ?? false,
      created_at: timestamp,
      updated_at: timestamp,
    });

    return this.getProvider(providerId);
  }

  /**
   * Add a review for a service provider
   */
  async addReview(
    providerId: string,
    userId: string,
    input: {
      household_id?: string;
      rating: number;
      review_text?: string;
      service_date?: string;
      cost?: number;
    }
  ): Promise<ServiceProviderReviewResponse> {
    // Verify provider exists
    await this.getProvider(providerId);

    const reviewId = generateId();
    const timestamp = now();

    await this.db.insert(maintenanceSchema.serviceProviderReviews).values({
      id: reviewId,
      provider_id: providerId,
      user_id: userId,
      household_id: input.household_id || null,
      rating: input.rating,
      review_text: input.review_text || null,
      service_date: input.service_date || null,
      cost: input.cost ? Math.round(input.cost * 100) : null, // Convert to cents
      created_at: timestamp,
      updated_at: timestamp,
    });

    // Update provider rating
    await this.updateProviderRating(providerId);

    const review = await this.db
      .select()
      .from(maintenanceSchema.serviceProviderReviews)
      .where(eq(maintenanceSchema.serviceProviderReviews.id, reviewId))
      .limit(1);

    return {
      id: review[0].id,
      provider_id: review[0].provider_id,
      user_id: review[0].user_id,
      household_id: review[0].household_id || undefined,
      rating: review[0].rating,
      review_text: review[0].review_text || undefined,
      service_date: review[0].service_date || undefined,
      cost: review[0].cost ? review[0].cost / 100 : undefined,
      created_at: review[0].created_at,
    };
  }

  /**
   * Get reviews for a service provider
   */
  async getReviews(providerId: string): Promise<ServiceProviderReviewResponse[]> {
    // Verify provider exists
    await this.getProvider(providerId);

    const reviews = await this.db
      .select()
      .from(maintenanceSchema.serviceProviderReviews)
      .where(eq(maintenanceSchema.serviceProviderReviews.provider_id, providerId))
      .orderBy(desc(maintenanceSchema.serviceProviderReviews.created_at));

    return reviews.map((r) => ({
      id: r.id,
      provider_id: r.provider_id,
      user_id: r.user_id,
      household_id: r.household_id || undefined,
      rating: r.rating,
      review_text: r.review_text || undefined,
      service_date: r.service_date || undefined,
      cost: r.cost ? r.cost / 100 : undefined,
      created_at: r.created_at,
    }));
  }

  /**
   * Update provider rating based on reviews
   */
  private async updateProviderRating(providerId: string): Promise<void> {
    const reviews = await this.db
      .select({
        rating: maintenanceSchema.serviceProviderReviews.rating,
      })
      .from(maintenanceSchema.serviceProviderReviews)
      .where(eq(maintenanceSchema.serviceProviderReviews.provider_id, providerId));

    if (reviews.length === 0) {
      // Reset rating if no reviews
      await this.db
        .update(maintenanceSchema.serviceProviders)
        .set({
          rating: null,
          review_count: 0,
          updated_at: now(),
        })
        .where(eq(maintenanceSchema.serviceProviders.id, providerId));
      return;
    }

    // Filter out invalid ratings and calculate average
    const validRatings = reviews
      .map((r) => r.rating)
      .filter((rating) => rating != null && rating >= 1 && rating <= 5);

    if (validRatings.length === 0) {
      // No valid ratings, reset
      await this.db
        .update(maintenanceSchema.serviceProviders)
        .set({
          rating: null,
          review_count: 0,
          updated_at: now(),
        })
        .where(eq(maintenanceSchema.serviceProviders.id, providerId));
      return;
    }

    const avgRating = validRatings.reduce((sum, r) => sum + r, 0) / validRatings.length;
    const roundedRating = Math.round(avgRating * 10) / 10; // Round to 1 decimal place

    await this.db
      .update(maintenanceSchema.serviceProviders)
      .set({
        rating: roundedRating,
        review_count: validRatings.length,
        updated_at: now(),
      })
      .where(eq(maintenanceSchema.serviceProviders.id, providerId));
  }

  /**
   * Safe JSON parse helper
   */
  private safeJsonParse<T>(json: string | null | undefined, defaultValue: T): T {
    if (!json) return defaultValue;
    try {
      return JSON.parse(json);
    } catch (e) {
      console.error('Error parsing JSON:', e);
      return defaultValue;
    }
  }

  /**
   * Map database record to response
   */
  private mapProviderToResponse(record: any): ServiceProviderResponse {
    return {
      id: record.id,
      name: record.name,
      category: record.category,
      phone: record.phone || undefined,
      email: record.email || undefined,
      website: record.website || undefined,
      address: record.address || undefined,
      service_areas: this.safeJsonParse(record.service_areas, undefined),
      rating: record.rating || undefined,
      review_count: record.review_count || 0,
      is_verified: record.is_verified === 1,
      created_at: record.created_at,
      updated_at: record.updated_at,
    };
  }
}
