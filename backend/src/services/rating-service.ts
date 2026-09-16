import { eq, and, desc } from 'drizzle-orm';
import { drizzle, DrizzleD1Database } from 'drizzle-orm/d1';
import { v4 as uuidv4 } from 'uuid';

import { householdMembers } from '../db/schema';
import { contractors } from '../db/schema-contractors';
import { contractorJobRatings, type ContractorJobRating } from '../db/schema-labor-hub';
import type { Env } from '../types';
import { NotFoundError, ForbiddenError, ValidationError } from '../utils/errors';
import { nowIso } from '../utils/id';

export interface RatingWithDetails extends ContractorJobRating {
  contractor: {
    id: string;
    name: string;
    company_name: string | null;
  };
  reviewPhotos: string[];
}

export interface ContractorRatingSummary {
  contractorId: string;
  overallRating: number;
  totalReviews: number;
  qualityRating: number | null;
  punctualityRating: number | null;
  communicationRating: number | null;
  cleanlinessRating: number | null;
  valueRating: number | null;
  wouldHireAgainPercentage: number;
  recentTrend: 'up' | 'down' | 'stable';
}

export class RatingService {
  private db: DrizzleD1Database;

  constructor(_env: Env, d1: D1Database) {
    this.db = drizzle(d1);
  }

  // ============ ACCESS CHECK ============

  private async checkHouseholdAccess(householdId: string, userId: string): Promise<void> {
    const member = await this.db
      .select()
      .from(householdMembers)
      .where(and(eq(householdMembers.household_id, householdId), eq(householdMembers.user_id, userId)))
      .get();

    if (!member) {
      throw new ForbiddenError('You do not have access to this household');
    }
  }

  private async checkContractorAccess(householdId: string, contractorId: string): Promise<void> {
    const contractor = await this.db
      .select()
      .from(contractors)
      .where(and(eq(contractors.id, contractorId), eq(contractors.household_id, householdId)))
      .get();

    if (!contractor) {
      throw new NotFoundError('Contractor not found');
    }
  }

  // ============ RATINGS ============

  async getRatingsForContractor(
    householdId: string,
    contractorId: string,
    userId: string
  ): Promise<RatingWithDetails[]> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.checkContractorAccess(householdId, contractorId);

    const ratings = await this.db
      .select()
      .from(contractorJobRatings)
      .where(
        and(
          eq(contractorJobRatings.contractor_id, contractorId),
          eq(contractorJobRatings.household_id, householdId)
        )
      )
      .orderBy(desc(contractorJobRatings.created_at))
      .all();

    return Promise.all(ratings.map((r) => this.enrichRating(r)));
  }

  async getRating(householdId: string, ratingId: string, userId: string): Promise<RatingWithDetails> {
    await this.checkHouseholdAccess(householdId, userId);

    const rating = await this.db
      .select()
      .from(contractorJobRatings)
      .where(and(eq(contractorJobRatings.id, ratingId), eq(contractorJobRatings.household_id, householdId)))
      .get();

    if (!rating) {
      throw new NotFoundError('Rating not found');
    }

    return this.enrichRating(rating);
  }

  async createRating(
    householdId: string,
    contractorId: string,
    userId: string,
    input: {
      visitId: string;
      overallRating: number;
      qualityRating?: number;
      punctualityRating?: number;
      communicationRating?: number;
      cleanlinessRating?: number;
      valueRating?: number;
      wouldHireAgain?: boolean;
      reviewText?: string;
      reviewPhotos?: string[];
      isPrivate?: boolean;
    }
  ): Promise<RatingWithDetails> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.checkContractorAccess(householdId, contractorId);

    // Validate rating values
    if (input.overallRating < 1 || input.overallRating > 5) {
      throw new ValidationError('Overall rating must be between 1 and 5');
    }

    const validateOptionalRating = (value: number | undefined, name: string) => {
      if (value !== undefined && (value < 1 || value > 5)) {
        throw new ValidationError(`${name} must be between 1 and 5`);
      }
    };

    validateOptionalRating(input.qualityRating, 'Quality rating');
    validateOptionalRating(input.punctualityRating, 'Punctuality rating');
    validateOptionalRating(input.communicationRating, 'Communication rating');
    validateOptionalRating(input.cleanlinessRating, 'Cleanliness rating');
    validateOptionalRating(input.valueRating, 'Value rating');

    // Check if rating already exists for this visit
    const existing = await this.db
      .select()
      .from(contractorJobRatings)
      .where(
        and(
          eq(contractorJobRatings.visit_id, input.visitId),
          eq(contractorJobRatings.household_id, householdId)
        )
      )
      .get();

    if (existing) {
      throw new ValidationError('A rating already exists for this visit');
    }

    const id = uuidv4();
    const now = nowIso();

    await this.db.insert(contractorJobRatings).values({
      id,
      contractor_id: contractorId,
      visit_id: input.visitId,
      household_id: householdId,
      overall_rating: input.overallRating,
      quality_rating: input.qualityRating ?? null,
      punctuality_rating: input.punctualityRating ?? null,
      communication_rating: input.communicationRating ?? null,
      cleanliness_rating: input.cleanlinessRating ?? null,
      value_rating: input.valueRating ?? null,
      would_hire_again: input.wouldHireAgain ?? null,
      review_text: input.reviewText ?? null,
      review_photos: input.reviewPhotos ? JSON.stringify(input.reviewPhotos) : null,
      is_private: input.isPrivate ?? true,
      created_at: now,
    });

    // Update contractor's aggregate rating
    await this.updateContractorAggregateRating(contractorId);

    return this.getRating(householdId, id, userId);
  }

  async updateRating(
    householdId: string,
    ratingId: string,
    userId: string,
    input: {
      overallRating?: number;
      qualityRating?: number;
      punctualityRating?: number;
      communicationRating?: number;
      cleanlinessRating?: number;
      valueRating?: number;
      wouldHireAgain?: boolean;
      reviewText?: string;
      reviewPhotos?: string[];
      isPrivate?: boolean;
    }
  ): Promise<RatingWithDetails> {
    await this.checkHouseholdAccess(householdId, userId);

    const existing = await this.getRating(householdId, ratingId, userId);

    const updateData: Partial<ContractorJobRating> = {};

    if (input.overallRating !== undefined) {
      if (input.overallRating < 1 || input.overallRating > 5) {
        throw new ValidationError('Overall rating must be between 1 and 5');
      }
      updateData.overall_rating = input.overallRating;
    }

    const validateAndSet = (
      value: number | undefined,
      field: keyof ContractorJobRating,
      name: string
    ) => {
      if (value !== undefined) {
        if (value < 1 || value > 5) {
          throw new ValidationError(`${name} must be between 1 and 5`);
        }
        (updateData as Record<string, unknown>)[field] = value;
      }
    };

    validateAndSet(input.qualityRating, 'quality_rating', 'Quality rating');
    validateAndSet(input.punctualityRating, 'punctuality_rating', 'Punctuality rating');
    validateAndSet(input.communicationRating, 'communication_rating', 'Communication rating');
    validateAndSet(input.cleanlinessRating, 'cleanliness_rating', 'Cleanliness rating');
    validateAndSet(input.valueRating, 'value_rating', 'Value rating');

    if (input.wouldHireAgain !== undefined) updateData.would_hire_again = input.wouldHireAgain;
    if (input.reviewText !== undefined) updateData.review_text = input.reviewText;
    if (input.reviewPhotos !== undefined) updateData.review_photos = JSON.stringify(input.reviewPhotos);
    if (input.isPrivate !== undefined) updateData.is_private = input.isPrivate;

    await this.db.update(contractorJobRatings).set(updateData).where(eq(contractorJobRatings.id, ratingId));

    // Update contractor's aggregate rating
    await this.updateContractorAggregateRating(existing.contractor.id);

    return this.getRating(householdId, ratingId, userId);
  }

  async deleteRating(householdId: string, ratingId: string, userId: string): Promise<void> {
    await this.checkHouseholdAccess(householdId, userId);

    const existing = await this.getRating(householdId, ratingId, userId);

    await this.db.delete(contractorJobRatings).where(eq(contractorJobRatings.id, ratingId));

    // Update contractor's aggregate rating
    await this.updateContractorAggregateRating(existing.contractor.id);
  }

  async getContractorRatingSummary(
    householdId: string,
    contractorId: string,
    userId: string
  ): Promise<ContractorRatingSummary> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.checkContractorAccess(householdId, contractorId);

    const ratings = await this.db
      .select()
      .from(contractorJobRatings)
      .where(
        and(
          eq(contractorJobRatings.contractor_id, contractorId),
          eq(contractorJobRatings.household_id, householdId)
        )
      )
      .orderBy(desc(contractorJobRatings.created_at))
      .all();

    if (ratings.length === 0) {
      return {
        contractorId,
        overallRating: 0,
        totalReviews: 0,
        qualityRating: null,
        punctualityRating: null,
        communicationRating: null,
        cleanlinessRating: null,
        valueRating: null,
        wouldHireAgainPercentage: 0,
        recentTrend: 'stable',
      };
    }

    const avg = (arr: (number | null)[]) => {
      const valid = arr.filter((v): v is number => v !== null);
      return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
    };

    const overallRating = avg(ratings.map((r) => r.overall_rating)) || 0;
    const qualityRating = avg(ratings.map((r) => r.quality_rating));
    const punctualityRating = avg(ratings.map((r) => r.punctuality_rating));
    const communicationRating = avg(ratings.map((r) => r.communication_rating));
    const cleanlinessRating = avg(ratings.map((r) => r.cleanliness_rating));
    const valueRating = avg(ratings.map((r) => r.value_rating));

    const wouldHireAgainResponses = ratings.filter((r) => r.would_hire_again !== null);
    const wouldHireAgainYes = wouldHireAgainResponses.filter((r) => r.would_hire_again === true).length;
    const wouldHireAgainPercentage =
      wouldHireAgainResponses.length > 0
        ? Math.round((wouldHireAgainYes / wouldHireAgainResponses.length) * 100)
        : 0;

    // Calculate trend (compare last 3 to previous 3)
    let recentTrend: 'up' | 'down' | 'stable' = 'stable';
    if (ratings.length >= 6) {
      const recent3Avg = avg(ratings.slice(0, 3).map((r) => r.overall_rating)) || 0;
      const previous3Avg = avg(ratings.slice(3, 6).map((r) => r.overall_rating)) || 0;
      if (recent3Avg - previous3Avg > 0.3) recentTrend = 'up';
      else if (previous3Avg - recent3Avg > 0.3) recentTrend = 'down';
    }

    return {
      contractorId,
      overallRating: Math.round(overallRating * 10) / 10,
      totalReviews: ratings.length,
      qualityRating: qualityRating ? Math.round(qualityRating * 10) / 10 : null,
      punctualityRating: punctualityRating ? Math.round(punctualityRating * 10) / 10 : null,
      communicationRating: communicationRating ? Math.round(communicationRating * 10) / 10 : null,
      cleanlinessRating: cleanlinessRating ? Math.round(cleanlinessRating * 10) / 10 : null,
      valueRating: valueRating ? Math.round(valueRating * 10) / 10 : null,
      wouldHireAgainPercentage,
      recentTrend,
    };
  }

  private async enrichRating(rating: ContractorJobRating): Promise<RatingWithDetails> {
    const contractor = await this.db
      .select()
      .from(contractors)
      .where(eq(contractors.id, rating.contractor_id))
      .get();

    if (!contractor) {
      throw new NotFoundError('Contractor not found');
    }

    return {
      ...rating,
      contractor: {
        id: contractor.id,
        name: contractor.name,
        company_name: contractor.company_name,
      },
      reviewPhotos: rating.review_photos ? JSON.parse(rating.review_photos) : [],
    };
  }

  private async updateContractorAggregateRating(contractorId: string): Promise<void> {
    const ratings = await this.db
      .select()
      .from(contractorJobRatings)
      .where(eq(contractorJobRatings.contractor_id, contractorId))
      .all();

    if (ratings.length === 0) {
      await this.db
        .update(contractors)
        .set({ rating: null })
        .where(eq(contractors.id, contractorId));
      return;
    }

    const avgRating =
      ratings.reduce((sum, r) => sum + r.overall_rating, 0) / ratings.length;

    await this.db
      .update(contractors)
      .set({ rating: Math.round(avgRating * 10) / 10 })
      .where(eq(contractors.id, contractorId));
  }
}
