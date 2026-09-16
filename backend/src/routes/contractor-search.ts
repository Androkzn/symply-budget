import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { authMiddleware } from '../middleware/auth';
import { requireAIEntitlement } from '../middleware/require-ai-entitlement';
import { hasUsableProviderKey } from '../services/ai-credential-resolver';
import { ContractorSearchService } from '../services/contractor-search-service';
import type { Env } from '../types';

const contractorSearchRouter = new Hono<{ Bindings: Env }>();

// All routes require authentication.
contractorSearchRouter.use('/*', authMiddleware());
// `/search` and `/generate-email` are inference (Gemini with Google Search
// grounding) and are gated on entitlement — a member with neither a
// subscription nor their own key must not reach a managed provider. `/send-email`
// is NOT gated: actually contacting a contractor is a core action that must keep
// working with AI switched off entirely, as does entering a contractor by hand.
contractorSearchRouter.use('/search', requireAIEntitlement());
contractorSearchRouter.use('/generate-email', requireAIEntitlement());

// Helper to get householdId from parent route param
function getHouseholdId(c: { req: { param: (key: string) => string | undefined } }): string {
  const householdId = c.req.param('householdId');
  if (!householdId) throw new Error('Household ID is required');
  return householdId;
}

// ============ VALIDATION SCHEMAS ============

const searchContractorsSchema = z.object({
  problem_title: z.string().min(1).max(500),
  problem_description: z.string().min(1).max(5000),
  system_category: z.string().min(1).max(100),
  location: z.object({
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    city: z.string().min(1).max(200),
    state: z.string().min(1).max(100),
    address: z.string().optional(), // Full property address
  }),
  source_type: z.enum(['action_item', 'maintenance_task', 'task_draft']),
  source_id: z.string().uuid(),
  // Enhanced metadata
  contractor_category: z.string().min(1).max(100).optional(), // e.g., 'electrician', 'plumber', 'government', 'municipal'
  subtasks: z.array(z.string().min(1).max(500)).max(20).optional(), // Max 20 subtasks, each max 500 chars
  severity: z.enum(['critical', 'major', 'minor', 'informational']).optional(),
  urgency_score: z.number().int().min(1).max(10).optional(),
  source_page_numbers: z.array(z.number().int().positive()).max(100).optional(), // Max 100 page numbers
  source_quotes: z.array(z.string().min(1).max(2000)).max(10).optional(), // Max 10 quotes, each max 2000 chars
});

const generateEmailSchema = z.object({
  contractor: z.object({
    name: z.string().min(1),
    company_name: z.string().nullable(),
    specialty: z.string(),
    rating: z.number(),
    review_count: z.number(),
    address: z.string(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    website: z.string().nullable(),
    google_maps_url: z.string(),
    highlights: z.array(z.string()),
    reddit_mentions: z.string().nullable(),
    ai_confidence: z.number(),
  }),
  problem_title: z.string().min(1).max(500),
  problem_description: z.string().min(1).max(5000),
  email_type: z.enum(['quote_request', 'question', 'availability_check']),
  user_name: z.string().max(200).optional(),
  property_address: z.string().max(500).optional(),
});

const sendEmailSchema = z.object({
  to_email: z.string().email(),
  subject: z.string().min(1).max(500),
  body: z.string().min(1).max(10000),
  from_name: z.string().min(1).max(200),
  reply_to: z.string().email().optional(),
});

// ============ ROUTES ============

/**
 * POST /households/:householdId/contractors/search
 * Search for contractors using AI with Google Search grounding
 */
contractorSearchRouter.post('/search', zValidator('json', searchContractorsSchema), async (c) => {
  try {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const input = c.req.valid('json');

    // A usable key means theirs or the managed one — a BYOK member must not be
    // turned away because the platform holds no managed Gemini key.
    if (!(await hasUsableProviderKey(c.env, userId, 'gemini'))) {
      console.error('[ContractorSearch] no usable Gemini key for this user');
      return c.json(
        {
          error: {
            code: 'service_unavailable',
            message: 'Contractor search is temporarily unavailable. Please try again later.',
          },
        },
        503
      );
    }

    const service = new ContractorSearchService(c.env, c.env.DB);

    const result = await service.searchContractors(householdId, userId, {
      problem_title: input.problem_title,
      problem_description: input.problem_description,
      system_category: input.system_category,
      location: input.location,
      source_type: input.source_type,
      source_id: input.source_id,
      // Pass enhanced metadata to service layer
      contractor_category: input.contractor_category,
      subtasks: input.subtasks,
      severity: input.severity,
      urgency_score: input.urgency_score,
      source_page_numbers: input.source_page_numbers,
      source_quotes: input.source_quotes,
    });

    return c.json(result);
  } catch (error: any) {
    console.error('[ContractorSearch] Search error:', error);

    // Check for specific API errors
    if (error.message?.includes('Gemini API error')) {
      return c.json(
        {
          error: {
            code: 'ai_service_error',
            message: 'Unable to search for contractors at this time. Please try again later.',
          },
        },
        503
      );
    }

    // Generic error fallback
    return c.json(
      {
        error: {
          code: 'search_failed',
          message: 'Failed to search for contractors. Please check your connection and try again.',
        },
      },
      500
    );
  }
});

/**
 * POST /households/:householdId/contractors/generate-email
 * Generate an email template for a contractor
 */
contractorSearchRouter.post('/generate-email', zValidator('json', generateEmailSchema), async (c) => {
  try {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const input = c.req.valid('json');

    if (!(await hasUsableProviderKey(c.env, userId, 'gemini'))) {
      console.error('[ContractorSearch] no usable Gemini key for this user');
      return c.json(
        {
          error: {
            code: 'service_unavailable',
            message: 'Email generation is temporarily unavailable.',
          },
        },
        503
      );
    }

    const service = new ContractorSearchService(c.env, c.env.DB);

    const email = await service.generateEmail(householdId, userId, {
      contractor: input.contractor,
      problem_title: input.problem_title,
      problem_description: input.problem_description,
      email_type: input.email_type,
      user_name: input.user_name,
      property_address: input.property_address,
    });

    return c.json(email);
  } catch (error: any) {
    console.error('[ContractorSearch] Email generation error:', error);
    return c.json(
      {
        error: {
          code: 'email_generation_failed',
          message: 'Failed to generate email. Please try again.',
        },
      },
      500
    );
  }
});

/**
 * POST /households/:householdId/contractors/send-email
 * Send an email to a contractor via Resend
 */
contractorSearchRouter.post('/send-email', zValidator('json', sendEmailSchema), async (c) => {
  try {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const input = c.req.valid('json');
    const service = new ContractorSearchService(c.env, c.env.DB);

    const result = await service.sendEmail(householdId, userId, {
      to_email: input.to_email,
      subject: input.subject,
      body: input.body,
      from_name: input.from_name,
      reply_to: input.reply_to,
    });

    if (!result.success) {
      return c.json(
        {
          error: {
            code: 'email_send_failed',
            message: result.message,
          },
        },
        400
      );
    }

    return c.json(result);
  } catch (error: any) {
    console.error('[ContractorSearch] Email send error:', error);
    return c.json(
      {
        error: {
          code: 'email_send_failed',
          message: 'Failed to send email. Please try again.',
        },
      },
      500
    );
  }
});

export default contractorSearchRouter;
