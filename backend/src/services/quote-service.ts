import { eq, and, desc } from 'drizzle-orm';
import { drizzle, DrizzleD1Database } from 'drizzle-orm/d1';
import { v4 as uuidv4 } from 'uuid';

import { householdMembers } from '../db/schema';
import { contractors, SPECIALTY_INFO, type ContractorSpecialty } from '../db/schema-contractors';
import {
  quotes,
  projects,
  type Quote,
  type QuoteStatus,
  type Project,
} from '../db/schema-labor-hub';
import type { Env } from '../types';
import { NotFoundError, ForbiddenError, ValidationError } from '../utils/errors';
import { nowIso } from '../utils/id';

import { GeminiService } from './ai/gemini-service';
import { resolveProviderApiKey } from './ai-credential-resolver';

// Types for API responses
export interface QuoteWithDetails extends Quote {
  contractor: {
    id: string;
    name: string;
    company_name: string | null;
    specialty: string;
    rating: number | null;
    specialtyInfo: { label: string; icon: string; color: string };
  };
  isExpiringSoon: boolean;
  isExpired: boolean;
}

export interface QuoteComparison {
  quotes: QuoteWithDetails[];
  summary: {
    lowestPrice: { quoteId: string; amount: number } | null;
    highestPrice: { quoteId: string; amount: number } | null;
    fastestTimeline: { quoteId: string; duration: string } | null;
    bestWarranty: { quoteId: string; terms: string } | null;
    highestRatedContractor: { quoteId: string; rating: number } | null;
  };
}

export interface AIQuoteAnalysis {
  recommendedQuoteId: string;
  reasoning: string;
  comparisonMatrix: {
    quoteId: string;
    contractorName: string;
    priceScore: number;      // 1-10
    qualityScore: number;     // 1-10
    timelineScore: number;    // 1-10
    warrantyScore: number;    // 1-10
    overallScore: number;     // 1-10
    pros: string[];
    cons: string[];
  }[];
  redFlags: { quoteId: string; contractorName: string; flag: string }[];
  negotiationTips: string[];
  confidence: number; // 0-1
}

export interface AIQuoteComparison {
  comparison: QuoteComparison; // Existing rule-based data
  aiAnalysis: AIQuoteAnalysis | null;
}

export class QuoteService {
  private db: DrizzleD1Database;
  private env: Env;

  constructor(env: Env, d1: D1Database) {
    this.env = env;
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

  // ============ HELPER METHODS ============

  private isExpiringSoon(validUntil: string | null): boolean {
    if (!validUntil) return false;
    const expiryDate = new Date(validUntil);
    const now = new Date();
    const daysUntilExpiry = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return daysUntilExpiry > 0 && daysUntilExpiry <= 7;
  }

  private isExpired(validUntil: string | null): boolean {
    if (!validUntil) return false;
    return new Date(validUntil) < new Date();
  }

  private async enrichQuote(quote: Quote): Promise<QuoteWithDetails> {
    const contractor = await this.db
      .select()
      .from(contractors)
      .where(eq(contractors.id, quote.contractor_id))
      .get();

    if (!contractor) {
      throw new NotFoundError('Contractor not found');
    }

    return {
      ...quote,
      contractor: {
        id: contractor.id,
        name: contractor.name,
        company_name: contractor.company_name,
        specialty: contractor.specialty,
        rating: contractor.rating,
        specialtyInfo: SPECIALTY_INFO[contractor.specialty as ContractorSpecialty] || SPECIALTY_INFO.other,
      },
      isExpiringSoon: this.isExpiringSoon(quote.valid_until),
      isExpired: this.isExpired(quote.valid_until),
    };
  }

  // ============ QUOTES ============

  async getQuotes(
    householdId: string,
    userId: string,
    filters?: {
      contractorId?: string;
      status?: string;
      expiringSoon?: boolean;
    }
  ): Promise<QuoteWithDetails[]> {
    await this.checkHouseholdAccess(householdId, userId);

    let quoteList = await this.db
      .select()
      .from(quotes)
      .where(eq(quotes.household_id, householdId))
      .orderBy(desc(quotes.created_at))
      .all();

    // Apply filters
    if (filters?.contractorId) {
      quoteList = quoteList.filter((q) => q.contractor_id === filters.contractorId);
    }
    if (filters?.status) {
      quoteList = quoteList.filter((q) => q.status === filters.status);
    }
    if (filters?.expiringSoon) {
      quoteList = quoteList.filter((q) => this.isExpiringSoon(q.valid_until));
    }

    // Enrich with contractor details
    return Promise.all(quoteList.map((q) => this.enrichQuote(q)));
  }

  async getPendingQuotes(householdId: string, userId: string): Promise<QuoteWithDetails[]> {
    return this.getQuotes(householdId, userId, { status: 'requested' });
  }

  async getQuote(householdId: string, quoteId: string, userId: string): Promise<QuoteWithDetails> {
    await this.checkHouseholdAccess(householdId, userId);

    const quote = await this.db
      .select()
      .from(quotes)
      .where(and(eq(quotes.id, quoteId), eq(quotes.household_id, householdId)))
      .get();

    if (!quote) {
      throw new NotFoundError('Quote not found');
    }

    return this.enrichQuote(quote);
  }

  async createQuote(
    householdId: string,
    userId: string,
    input: {
      contractorId: string;
      title: string;
      description?: string;
      amountCents?: number;
      amountRangeLowCents?: number;
      amountRangeHighCents?: number;
      validUntil?: string;
      estimatedDuration?: string;
      warrantyTerms?: string;
      notes?: string;
      appointmentId?: string;
      linkedReportId?: string;
      linkedTaskId?: string;
      linkedMaintenanceTaskId?: string;
    }
  ): Promise<QuoteWithDetails> {
    await this.checkHouseholdAccess(householdId, userId);

    // Verify contractor exists and belongs to household
    const contractor = await this.db
      .select()
      .from(contractors)
      .where(and(eq(contractors.id, input.contractorId), eq(contractors.household_id, householdId)))
      .get();

    if (!contractor) {
      throw new NotFoundError('Contractor not found');
    }

    const id = uuidv4();
    const now = nowIso();

    await this.db.insert(quotes).values({
      id,
      household_id: householdId,
      contractor_id: input.contractorId,
      title: input.title,
      description: input.description || null,
      amount_cents: input.amountCents || null,
      amount_range_low_cents: input.amountRangeLowCents || null,
      amount_range_high_cents: input.amountRangeHighCents || null,
      valid_until: input.validUntil || null,
      estimated_duration: input.estimatedDuration || null,
      warranty_terms: input.warrantyTerms || null,
      status: 'requested',
      notes: input.notes || null,
      appointment_id: input.appointmentId || null,
      linked_report_id: input.linkedReportId || null,
      linked_task_id: input.linkedTaskId || input.linkedMaintenanceTaskId || null,
      created_at: now,
      updated_at: now,
    });

    return this.getQuote(householdId, id, userId);
  }

  async requestQuotes(
    householdId: string,
    userId: string,
    input: {
      contractorIds: string[];
      title: string;
      description: string;
      linkedReportId?: string;
      linkedTaskId?: string;
    }
  ): Promise<QuoteWithDetails[]> {
    await this.checkHouseholdAccess(householdId, userId);

    const createdQuotes: QuoteWithDetails[] = [];

    for (const contractorId of input.contractorIds) {
      try {
        const quote = await this.createQuote(householdId, userId, {
          contractorId,
          title: input.title,
          description: input.description,
          linkedReportId: input.linkedReportId,
          linkedTaskId: input.linkedTaskId,
        });
        createdQuotes.push(quote);
      } catch (error) {
        // Log error but continue with other contractors
        console.error(`Failed to create quote for contractor ${contractorId}:`, error);
      }
    }

    if (createdQuotes.length === 0) {
      throw new ValidationError('Failed to create any quotes');
    }

    return createdQuotes;
  }

  async compareQuotes(householdId: string, userId: string, quoteIds: string[]): Promise<QuoteComparison> {
    await this.checkHouseholdAccess(householdId, userId);

    const quoteList = await Promise.all(quoteIds.map((id) => this.getQuote(householdId, id, userId)));

    // Build comparison summary
    const quotesWithAmount = quoteList.filter((q) => q.amount_cents !== null);
    const quotesWithDuration = quoteList.filter((q) => q.estimated_duration !== null);
    const quotesWithWarranty = quoteList.filter((q) => q.warranty_terms !== null);
    const quotesWithRating = quoteList.filter((q) => q.contractor.rating !== null);

    const summary: QuoteComparison['summary'] = {
      lowestPrice: null,
      highestPrice: null,
      fastestTimeline: null,
      bestWarranty: null,
      highestRatedContractor: null,
    };

    if (quotesWithAmount.length > 0) {
      const sorted = [...quotesWithAmount].sort((a, b) => (a.amount_cents || 0) - (b.amount_cents || 0));
      summary.lowestPrice = { quoteId: sorted[0].id, amount: sorted[0].amount_cents! };
      summary.highestPrice = { quoteId: sorted[sorted.length - 1].id, amount: sorted[sorted.length - 1].amount_cents! };
    }

    if (quotesWithDuration.length > 0) {
      // Simple heuristic: shorter duration string = faster (this is a simplification)
      const sorted = [...quotesWithDuration].sort(
        (a, b) => (a.estimated_duration || '').length - (b.estimated_duration || '').length
      );
      summary.fastestTimeline = { quoteId: sorted[0].id, duration: sorted[0].estimated_duration! };
    }

    if (quotesWithWarranty.length > 0) {
      // Simple heuristic: longer warranty terms = better
      const sorted = [...quotesWithWarranty].sort(
        (a, b) => (b.warranty_terms || '').length - (a.warranty_terms || '').length
      );
      summary.bestWarranty = { quoteId: sorted[0].id, terms: sorted[0].warranty_terms! };
    }

    if (quotesWithRating.length > 0) {
      const sorted = [...quotesWithRating].sort((a, b) => (b.contractor.rating || 0) - (a.contractor.rating || 0));
      summary.highestRatedContractor = { quoteId: sorted[0].id, rating: sorted[0].contractor.rating! };
    }

    return { quotes: quoteList, summary };
  }

  async updateQuote(
    householdId: string,
    quoteId: string,
    userId: string,
    input: {
      title?: string;
      description?: string;
      amountCents?: number;
      amountRangeLowCents?: number;
      amountRangeHighCents?: number;
      validUntil?: string;
      estimatedDuration?: string;
      warrantyTerms?: string;
      status?: QuoteStatus;
      documentKey?: string;
      notes?: string;
    }
  ): Promise<QuoteWithDetails> {
    await this.checkHouseholdAccess(householdId, userId);

    const existing = await this.db
      .select()
      .from(quotes)
      .where(and(eq(quotes.id, quoteId), eq(quotes.household_id, householdId)))
      .get();

    if (!existing) {
      throw new NotFoundError('Quote not found');
    }

    const updateData: Partial<Quote> = {
      updated_at: nowIso(),
    };

    if (input.title !== undefined) updateData.title = input.title;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.amountCents !== undefined) updateData.amount_cents = input.amountCents;
    if (input.amountRangeLowCents !== undefined) updateData.amount_range_low_cents = input.amountRangeLowCents;
    if (input.amountRangeHighCents !== undefined) updateData.amount_range_high_cents = input.amountRangeHighCents;
    if (input.validUntil !== undefined) updateData.valid_until = input.validUntil;
    if (input.estimatedDuration !== undefined) updateData.estimated_duration = input.estimatedDuration;
    if (input.warrantyTerms !== undefined) updateData.warranty_terms = input.warrantyTerms;
    if (input.status !== undefined) updateData.status = input.status;
    if (input.documentKey !== undefined) updateData.document_key = input.documentKey;
    if (input.notes !== undefined) updateData.notes = input.notes;

    await this.db.update(quotes).set(updateData).where(eq(quotes.id, quoteId));

    return this.getQuote(householdId, quoteId, userId);
  }

  async deleteQuote(householdId: string, quoteId: string, userId: string): Promise<void> {
    await this.checkHouseholdAccess(householdId, userId);

    const existing = await this.db
      .select()
      .from(quotes)
      .where(and(eq(quotes.id, quoteId), eq(quotes.household_id, householdId)))
      .get();

    if (!existing) {
      throw new NotFoundError('Quote not found');
    }

    await this.db.delete(quotes).where(eq(quotes.id, quoteId));
  }

  // ============ STATUS TRANSITIONS ============

  async acceptQuote(
    householdId: string,
    quoteId: string,
    userId: string,
    createProject?: boolean
  ): Promise<{ quote: QuoteWithDetails; project?: Project }> {
    await this.checkHouseholdAccess(householdId, userId);

    const existing = await this.getQuote(householdId, quoteId, userId);

    if (!['received', 'reviewing'].includes(existing.status)) {
      throw new ValidationError('Can only accept received or reviewing quotes');
    }

    if (existing.isExpired) {
      throw new ValidationError('Cannot accept an expired quote');
    }

    const now = nowIso();

    await this.db
      .update(quotes)
      .set({
        status: 'accepted',
        accepted_at: now,
        updated_at: now,
      })
      .where(eq(quotes.id, quoteId));

    const updatedQuote = await this.getQuote(householdId, quoteId, userId);

    // Optionally create a project from the accepted quote
    let project: Project | undefined;
    if (createProject) {
      const projectId = uuidv4();
      await this.db.insert(projects).values({
        id: projectId,
        household_id: householdId,
        contractor_id: existing.contractor_id,
        quote_id: quoteId,
        title: existing.title,
        description: existing.description,
        status: 'planning',
        total_budget_cents: existing.amount_cents || existing.amount_range_high_cents || null,
        linked_report_id: existing.linked_report_id,
        linked_task_ids: existing.linked_task_id ? JSON.stringify([existing.linked_task_id]) : null,
        created_at: now,
        updated_at: now,
      });

      project = await this.db.select().from(projects).where(eq(projects.id, projectId)).get();
    }

    return { quote: updatedQuote, project };
  }

  async declineQuote(
    householdId: string,
    quoteId: string,
    userId: string,
    reason?: string
  ): Promise<QuoteWithDetails> {
    await this.checkHouseholdAccess(householdId, userId);

    const existing = await this.getQuote(householdId, quoteId, userId);

    if (['accepted', 'declined'].includes(existing.status)) {
      throw new ValidationError('Quote has already been accepted or declined');
    }

    const now = nowIso();
    const notes = reason ? `${existing.notes || ''}\nDeclined: ${reason}`.trim() : existing.notes;

    await this.db
      .update(quotes)
      .set({
        status: 'declined',
        declined_at: now,
        notes,
        updated_at: now,
      })
      .where(eq(quotes.id, quoteId));

    return this.getQuote(householdId, quoteId, userId);
  }

  async markQuoteReceived(
    householdId: string,
    quoteId: string,
    userId: string,
    details: {
      amountCents?: number;
      amountRangeLowCents?: number;
      amountRangeHighCents?: number;
      validUntil?: string;
      estimatedDuration?: string;
      warrantyTerms?: string;
      documentKey?: string;
    }
  ): Promise<QuoteWithDetails> {
    await this.checkHouseholdAccess(householdId, userId);

    const existing = await this.getQuote(householdId, quoteId, userId);

    if (existing.status !== 'requested') {
      throw new ValidationError('Can only mark requested quotes as received');
    }

    return this.updateQuote(householdId, quoteId, userId, {
      status: 'received',
      amountCents: details.amountCents,
      amountRangeLowCents: details.amountRangeLowCents,
      amountRangeHighCents: details.amountRangeHighCents,
      validUntil: details.validUntil,
      estimatedDuration: details.estimatedDuration,
      warrantyTerms: details.warrantyTerms,
      documentKey: details.documentKey,
    });
  }

  // ============ AI-ENHANCED QUOTE COMPARISON ============

  async compareQuotesWithAI(
    householdId: string,
    userId: string,
    quoteIds: string[],
    taskContext?: { title: string; description?: string; category?: string }
  ): Promise<AIQuoteComparison> {
    await this.checkHouseholdAccess(householdId, userId);

    if (quoteIds.length < 2 || quoteIds.length > 5) {
      throw new ValidationError('Must compare between 2 and 5 quotes');
    }

    // Get base comparison data
    const baseComparison = await this.compareQuotes(householdId, userId, quoteIds);

    // Run inference on the acting user's own Gemini key when connected (BYOK);
    // otherwise the SimpleHouse-managed key. No key of EITHER kind → the
    // side-by-side comparison still returns, just without the AI read on top.
    const { apiKey } = await resolveProviderApiKey(this.env, userId, 'gemini');
    if (!apiKey) {
      console.warn('[QuoteService] no usable AI key for this user, skipping AI analysis');
      return {
        comparison: baseComparison,
        aiAnalysis: null,
      };
    }

    try {
      const gemini = new GeminiService(apiKey);

      // Format currency for display
      const formatCurrency = (cents: number | null): string => {
        if (cents === null || cents === undefined) return 'Not specified';
        return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      };

      // Build AI prompt
      const systemPrompt = `You are a home maintenance cost advisor helping homeowners make informed decisions about contractor quotes.
Your role is to analyze quotes objectively, considering price, contractor reputation, warranty terms, timeline, and completeness of scope.
Identify any red flags, concerns, or missing information. Provide actionable negotiation tips.

IMPORTANT: Respond ONLY with valid JSON matching this structure:
{
  "recommendedQuoteId": "string (UUID of recommended quote)",
  "reasoning": "string (2-3 sentences explaining why this is the best choice)",
  "comparisonMatrix": [
    {
      "quoteId": "string",
      "contractorName": "string",
      "priceScore": number (1-10, higher is better value),
      "qualityScore": number (1-10, based on contractor rating and reputation),
      "timelineScore": number (1-10, faster is better if reasonable),
      "warrantyScore": number (1-10, better terms = higher score),
      "overallScore": number (1-10, weighted average),
      "pros": ["string", "string"],
      "cons": ["string", "string"]
    }
  ],
  "redFlags": [
    {
      "quoteId": "string",
      "contractorName": "string",
      "flag": "string (specific concern)"
    }
  ],
  "negotiationTips": ["string", "string", "string"],
  "confidence": number (0.0-1.0, how confident you are in this recommendation)
}`;

      const taskInfo = taskContext
        ? `Task: ${taskContext.title}
Category: ${taskContext.category || 'General'}
Description: ${taskContext.description || 'No description provided'}\n\n`
        : '';

      const quotesInfo = baseComparison.quotes
        .map(
          (q, idx) => `
Quote ${idx + 1} (ID: ${q.id})
Contractor: ${q.contractor.name}${q.contractor.company_name ? ` (${q.contractor.company_name})` : ''}
Specialty: ${q.contractor.specialty}
Price: ${formatCurrency(q.amount_cents)}${
            q.amount_range_low_cents && q.amount_range_high_cents
              ? ` (Range: ${formatCurrency(q.amount_range_low_cents)} - ${formatCurrency(q.amount_range_high_cents)})`
              : ''
          }
Timeline: ${q.estimated_duration || 'Not specified'}
Warranty: ${q.warranty_terms || 'Not specified'}
Contractor Rating: ${q.contractor.rating ? `${q.contractor.rating}/5` : 'No rating'}
Status: ${q.status}
${q.isExpired ? '⚠️ EXPIRED' : q.isExpiringSoon ? '⚠️ Expiring soon' : ''}
Notes: ${q.notes || 'None'}
`
        )
        .join('\n---\n');

      const userPrompt = `${taskInfo}Quotes to compare:
${quotesInfo}

Analyze these quotes and provide your recommendation in JSON format as specified.
Consider:
- Best value for money (not just lowest price)
- Contractor reputation and reliability
- Warranty coverage and duration
- Realistic timeline estimates
- Any missing information or red flags
- Professional presentation of quote`;

      // Get AI response
      const aiResponse = await gemini.generateContent(systemPrompt, userPrompt);

      // Parse JSON response (remove markdown code blocks if present)
      const jsonMatch = aiResponse.match(/```json\s*([\s\S]*?)\s*```/) || aiResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('AI response is not valid JSON');
      }

      const jsonText = jsonMatch[1] || jsonMatch[0];
      const aiAnalysis: AIQuoteAnalysis = JSON.parse(jsonText);

      // Validate that recommended quote exists
      if (!quoteIds.includes(aiAnalysis.recommendedQuoteId)) {
        console.warn('[QuoteService] AI recommended non-existent quote, using first quote');
        aiAnalysis.recommendedQuoteId = quoteIds[0];
      }

      return {
        comparison: baseComparison,
        aiAnalysis,
      };
    } catch (error: any) {
      console.error('[QuoteService] AI analysis failed:', error);
      // Return base comparison if AI fails
      return {
        comparison: baseComparison,
        aiAnalysis: null,
      };
    }
  }
}
