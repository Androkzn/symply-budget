import { eq, and } from 'drizzle-orm';
import { drizzle, DrizzleD1Database } from 'drizzle-orm/d1';
import { v4 as uuidv4 } from 'uuid';

import { householdMembers } from '../db/schema';
import { contractors } from '../db/schema-contractors';
import { contractorRepresentatives, type ContractorRepresentative } from '../db/schema-labor-hub';
import type { Env } from '../types';
import { NotFoundError, ForbiddenError } from '../utils/errors';
import { nowIso } from '../utils/id';

export class RepresentativeService {
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

  // ============ REPRESENTATIVES ============

  async getRepresentatives(
    householdId: string,
    contractorId: string,
    userId: string
  ): Promise<ContractorRepresentative[]> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.checkContractorAccess(householdId, contractorId);

    const reps = await this.db
      .select()
      .from(contractorRepresentatives)
      .where(eq(contractorRepresentatives.contractor_id, contractorId))
      .all();

    // Sort: primary first, then by name
    return reps.sort((a, b) => {
      if (a.is_primary && !b.is_primary) return -1;
      if (!a.is_primary && b.is_primary) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  async getRepresentative(
    householdId: string,
    contractorId: string,
    representativeId: string,
    userId: string
  ): Promise<ContractorRepresentative> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.checkContractorAccess(householdId, contractorId);

    const rep = await this.db
      .select()
      .from(contractorRepresentatives)
      .where(and(eq(contractorRepresentatives.id, representativeId), eq(contractorRepresentatives.contractor_id, contractorId)))
      .get();

    if (!rep) {
      throw new NotFoundError('Representative not found');
    }

    return rep;
  }

  async createRepresentative(
    householdId: string,
    contractorId: string,
    userId: string,
    input: {
      name: string;
      role?: string;
      phone?: string;
      email?: string;
      isPrimary?: boolean;
      notes?: string;
      photoUrl?: string;
    }
  ): Promise<ContractorRepresentative> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.checkContractorAccess(householdId, contractorId);

    const id = uuidv4();
    const now = nowIso();

    // If this is marked as primary, unset any existing primary
    if (input.isPrimary) {
      await this.db
        .update(contractorRepresentatives)
        .set({ is_primary: false, updated_at: now })
        .where(eq(contractorRepresentatives.contractor_id, contractorId));
    }

    // Check if this is the first representative - make it primary by default
    const existingReps = await this.db
      .select()
      .from(contractorRepresentatives)
      .where(eq(contractorRepresentatives.contractor_id, contractorId))
      .all();

    const isPrimary = input.isPrimary ?? existingReps.length === 0;

    await this.db.insert(contractorRepresentatives).values({
      id,
      contractor_id: contractorId,
      name: input.name,
      role: input.role || null,
      phone: input.phone || null,
      email: input.email || null,
      is_primary: isPrimary,
      notes: input.notes || null,
      photo_url: input.photoUrl || null,
      created_at: now,
      updated_at: now,
    });

    return this.getRepresentative(householdId, contractorId, id, userId);
  }

  async updateRepresentative(
    householdId: string,
    contractorId: string,
    representativeId: string,
    userId: string,
    input: {
      name?: string;
      role?: string;
      phone?: string;
      email?: string;
      isPrimary?: boolean;
      notes?: string;
      photoUrl?: string;
    }
  ): Promise<ContractorRepresentative> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.checkContractorAccess(householdId, contractorId);

    const existing = await this.getRepresentative(householdId, contractorId, representativeId, userId);
    const now = nowIso();

    // If setting as primary, unset any existing primary
    if (input.isPrimary && !existing.is_primary) {
      await this.db
        .update(contractorRepresentatives)
        .set({ is_primary: false, updated_at: now })
        .where(eq(contractorRepresentatives.contractor_id, contractorId));
    }

    const updateData: Partial<ContractorRepresentative> = {
      updated_at: now,
    };

    if (input.name !== undefined) updateData.name = input.name;
    if (input.role !== undefined) updateData.role = input.role;
    if (input.phone !== undefined) updateData.phone = input.phone;
    if (input.email !== undefined) updateData.email = input.email;
    if (input.isPrimary !== undefined) updateData.is_primary = input.isPrimary;
    if (input.notes !== undefined) updateData.notes = input.notes;
    if (input.photoUrl !== undefined) updateData.photo_url = input.photoUrl;

    await this.db.update(contractorRepresentatives).set(updateData).where(eq(contractorRepresentatives.id, representativeId));

    return this.getRepresentative(householdId, contractorId, representativeId, userId);
  }

  async deleteRepresentative(
    householdId: string,
    contractorId: string,
    representativeId: string,
    userId: string
  ): Promise<void> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.checkContractorAccess(householdId, contractorId);

    const existing = await this.getRepresentative(householdId, contractorId, representativeId, userId);

    await this.db.delete(contractorRepresentatives).where(eq(contractorRepresentatives.id, representativeId));

    // If deleted rep was primary, make the first remaining rep primary
    if (existing.is_primary) {
      const remainingReps = await this.db
        .select()
        .from(contractorRepresentatives)
        .where(eq(contractorRepresentatives.contractor_id, contractorId))
        .all();

      if (remainingReps.length > 0) {
        await this.db
          .update(contractorRepresentatives)
          .set({ is_primary: true, updated_at: nowIso() })
          .where(eq(contractorRepresentatives.id, remainingReps[0].id));
      }
    }
  }

  async setPrimaryRepresentative(
    householdId: string,
    contractorId: string,
    representativeId: string,
    userId: string
  ): Promise<ContractorRepresentative> {
    return this.updateRepresentative(householdId, contractorId, representativeId, userId, { isPrimary: true });
  }
}
