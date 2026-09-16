import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { authMiddleware } from '../middleware/auth';
import { BCAssessmentExtractionService } from '../services/bc-assessment-extraction-service';
import { BillExtractionService } from '../services/bill-extraction-service';
import { assertCanUseAI } from '../services/entitlement-service';
import { PropertyTaxExtractionService } from '../services/property-tax-extraction-service';
import { UtilityService } from '../services/utility-service';
import type { Env } from '../types';
import { ConflictError } from '../utils/errors';
import {
  resolveHouseholdPropertyJurisdiction,
  describePropertyJurisdiction,
} from '../utils/property-jurisdictions';

const utilities = new Hono<{ Bindings: Env }>();

/**
 * HTTP status for a thrown error, preserving this file's FLAT error body.
 *
 * Every handler here used to end `return c.json({ error: msg }, 500)`, so a
 * non-member got 500 instead of 403, a missing row got 500 instead of 404, and
 * a duplicate tax year surfaced as a 500 carrying a raw SQLite string. Clients
 * could not tell "you may not do this" from "the Worker fell over", and
 * retry/refresh logic treated every one of them as a transient server fault.
 *
 * `app.onError` already maps ApiError subclasses correctly, but it wraps the
 * body as `{ error: { code, message } }`. The mobile client reads this route's
 * errors FLAT — `getDuplicateBill` checks `response.data.code` and
 * `response.data.existingBill` directly — so rethrowing here would fix the
 * status and break the payload. This keeps the body and fixes only the status.
 */
function errorStatus(error: unknown): 400 | 401 | 403 | 404 | 409 | 410 | 422 | 429 | 500 | 503 {
  const status = (error as { statusCode?: unknown })?.statusCode;
  return typeof status === 'number' ? (status as 500) : 500;
}

// All routes require authentication
utilities.use('/*', authMiddleware());

// Helper to get userId from context
function getUserId(c: { get: (key: string) => string | undefined }): string {
  const userId = c.get('userId');
  if (!userId) throw new Error('User ID is required');
  return userId;
}

// Helper to get householdId from route param
function getHouseholdId(c: { req: { param: (key: string) => string | undefined } }): string {
  const householdId = c.req.param('householdId');
  if (!householdId) throw new Error('Household ID is required');
  return householdId;
}

// Validation schemas
const createUtilityAccountSchema = z.object({
  providerId: z.string().min(1),
  accountNumber: z.string().min(1),
  serviceType: z.enum(['electricity', 'gas', 'water', 'sewer', 'garbage', 'other']),
  startDate: z.string().optional(),
  billingCyclePreference: z.enum(['monthly', 'bimonthly', 'quarterly', 'annual']).optional(),
});

const updateUtilityAccountSchema = z.object({
  accountNumber: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  billingCyclePreference: z.enum(['monthly', 'bimonthly', 'quarterly', 'annual']).optional(),
});

const createUtilityBillSchema = z.object({
  accountId: z.string().uuid().optional(),
  billType: z.enum(['electricity', 'gas', 'water', 'sewer', 'garbage', 'other']),
  provider: z.string().optional(),
  accountNumber: z.string().optional(),
  billingPeriodStart: z.string(),
  billingPeriodEnd: z.string(),
  amount: z.number().int().min(0),
  dueDate: z.string(),
  paidDate: z.string().optional(),
  paidAmount: z.number().int().min(0).optional(),
  usageQuantity: z.number().optional(),
  usageUnit: z.string().optional(),
  documentUrl: z.string().optional(),
  aiExtractedData: z.record(z.any()).optional(),
  confidenceScore: z.number().min(0).max(1).optional(),
  // When true, skip month-based duplicate detection (user confirmed "add anyway").
  allowDuplicate: z.boolean().optional(),
  // When true, don't spawn the "Pay bill" task now — the ConfirmBillPayments
  // step creates it for whichever imported bills are left unpaid. Prevents the
  // "task per imported bill" double-count during batch import.
  deferPayTask: z.boolean().optional(),
});

const updateUtilityBillSchema = z.object({
  // Core fields — editable so users can correct a mis-scanned bill or fix a
  // manual entry without deleting and re-adding it.
  billType: z.enum(['electricity', 'gas', 'water', 'sewer', 'garbage', 'other']).optional(),
  provider: z.string().optional(),
  accountNumber: z.string().optional(),
  billingPeriodStart: z.string().optional(),
  billingPeriodEnd: z.string().optional(),
  amount: z.number().int().min(0).optional(),
  dueDate: z.string().optional(),
  paidDate: z.string().optional(),
  paidAmount: z.number().int().min(0).optional(),
  usageQuantity: z.number().optional(),
  usageUnit: z.string().optional(),
});

// Bulk paid/unpaid confirmation for the import-review screen.
const setBillsPaidStatusSchema = z.object({
  updates: z
    .array(
      z.object({
        billId: z.string().min(1),
        paid: z.boolean(),
      })
    )
    .min(1)
    .max(200),
});

const createPropertyTaxSchema = z.object({
  taxYear: z.number().int().min(2020).max(2100),
  assessedValue: z.number().int().min(0),
  taxAmount: z.number().int().min(0),
  advancePaymentAmount: z.number().int().min(0).optional(),
  advancePaymentDueDate: z.string().optional(),
  mainPaymentAmount: z.number().int().min(0),
  mainPaymentDueDate: z.string(),
  homeownerGrantEligible: z.boolean().optional(),
  homeownerGrantAmount: z.number().int().min(0).optional(),
  // When true, the grant is claimed now: deducted from the amount owed, the
  // record is marked applied, and the "Claim grant" reminder task is skipped.
  homeownerGrantApplied: z.boolean().optional(),
  documentUrl: z.string().optional(),
  // When set, the tax is recorded as already paid (no reminder tasks created).
  mainPaymentPaidDate: z.string().optional(),
  // Municipality name from the scanned notice — used in the pay-task title.
  municipalityName: z.string().optional(),
});

const updatePropertyTaxSchema = z.object({
  assessedValue: z.number().int().min(0).optional(),
  taxAmount: z.number().int().min(0).optional(),
  advancePaymentPaidDate: z.string().optional(),
  mainPaymentPaidDate: z.string().optional(),
  homeownerGrantAppliedDate: z.string().optional(),
  homeownerGrantStatus: z.enum(['pending', 'approved', 'rejected']).optional(),
});

const createBCAssessmentSchema = z.object({
  assessmentYear: z.number().int().min(2020).max(2100),
  propertyClass: z.string().optional(),
  assessedValue: z.number().int().min(0),
  landValue: z.number().int().min(0).optional(),
  improvementValue: z.number().int().min(0).optional(),
  previousYearValue: z.number().int().min(0).optional(),
  changePercent: z.number().optional(),
  assessmentPdfKey: z.string().optional(),
  appealDeadline: z.string().optional(),
});

const updateBCAssessmentSchema = z.object({
  propertyClass: z.string().optional(),
  assessedValue: z.number().int().min(0).optional(),
  landValue: z.number().int().min(0).optional(),
  improvementValue: z.number().int().min(0).optional(),
  previousYearValue: z.number().int().min(0).optional(),
  changePercent: z.number().optional(),
  appealDeadline: z.string().optional(),
  appealFiled: z.boolean().optional(),
});

// ============ MUNICIPALITY ============

utilities.get('/municipality', async (c) => {
  const service = new UtilityService(c.env, c.env.DB);
  const householdId = getHouseholdId(c);
  const userId = getUserId(c);

  try {
    const municipality = await service.detectMunicipalityForHousehold(householdId, userId);
    return c.json({ municipality });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Unknown error' }, errorStatus(error));
  }
});

// ============ UTILITY ACCOUNTS ============

utilities.post(
  '/accounts',
  zValidator('json', createUtilityAccountSchema),
  async (c) => {
    const service = new UtilityService(c.env, c.env.DB);
    const householdId = getHouseholdId(c);
    const userId = getUserId(c);
    const input = c.req.valid('json');

    try {
      const account = await service.createUtilityAccount(householdId, userId, input);
      return c.json(account, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Unknown error' }, errorStatus(error));
    }
  }
);

utilities.get('/accounts', async (c) => {
  const service = new UtilityService(c.env, c.env.DB);
  const householdId = getHouseholdId(c);
  const userId = getUserId(c);

  try {
    const accounts = await service.getUtilityAccounts(householdId, userId);
    return c.json(accounts);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Unknown error' }, errorStatus(error));
  }
});

utilities.patch(
  '/accounts/:accountId',
  zValidator('json', updateUtilityAccountSchema),
  async (c) => {
    const service = new UtilityService(c.env, c.env.DB);
    const householdId = getHouseholdId(c);
    const accountId = c.req.param('accountId');
    const userId = getUserId(c);
    const updates = c.req.valid('json');

    try {
      const account = await service.updateUtilityAccount(householdId, accountId, userId, updates);
      return c.json(account);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Unknown error' }, errorStatus(error));
    }
  }
);

utilities.delete('/accounts/:accountId', async (c) => {
  const service = new UtilityService(c.env, c.env.DB);
  const householdId = getHouseholdId(c);
  const accountId = c.req.param('accountId');
  const userId = getUserId(c);

  try {
    await service.deleteUtilityAccount(householdId, accountId, userId);
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Unknown error' }, errorStatus(error));
  }
});

// ============ UTILITY BILLS ============

utilities.post(
  '/bills',
  zValidator('json', createUtilityBillSchema),
  async (c) => {
    const service = new UtilityService(c.env, c.env.DB);
    const householdId = getHouseholdId(c);
    const userId = getUserId(c);
    const { allowDuplicate, deferPayTask, ...input } = c.req.valid('json');

    try {
      const bill = await service.createUtilityBill(householdId, userId, input, {
        allowDuplicate,
        deferPayTask,
      });
      return c.json(bill, 201);
    } catch (error) {
      if (error instanceof ConflictError) {
        // Month-based duplicate — hand the existing bill back so the client can
        // offer "add anyway" (re-POST with allowDuplicate: true).
        return c.json(
          {
            error: error.message,
            code: 'DUPLICATE_BILL',
            existingBill: (error as ConflictError & { existingBill?: unknown }).existingBill,
          },
          409
        );
      }
      return c.json({ error: error instanceof Error ? error.message : 'Unknown error' }, errorStatus(error));
    }
  }
);

utilities.get('/bills', async (c) => {
  const service = new UtilityService(c.env, c.env.DB);
  const householdId = getHouseholdId(c);
  const userId = getUserId(c);

  const billType = c.req.query('billType');
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const paid = c.req.query('paid');
  const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined;

  try {
    const bills = await service.getUtilityBills(householdId, userId, {
      billType: billType || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      paid: paid === 'true' ? true : paid === 'false' ? false : undefined,
      limit,
    });
    return c.json(bills);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Unknown error' }, errorStatus(error));
  }
});

// Bulk-confirm paid status for freshly-imported bills (multi-select review).
// Registered before `/bills/:billId` so "paid-status" isn't read as a billId.
utilities.patch(
  '/bills/paid-status',
  zValidator('json', setBillsPaidStatusSchema),
  async (c) => {
    const service = new UtilityService(c.env, c.env.DB);
    const householdId = getHouseholdId(c);
    const userId = getUserId(c);
    const { updates } = c.req.valid('json');

    try {
      const bills = await service.setBillsPaidStatus(householdId, userId, updates);
      return c.json(bills);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Unknown error' }, errorStatus(error));
    }
  }
);

utilities.patch(
  '/bills/:billId',
  zValidator('json', updateUtilityBillSchema),
  async (c) => {
    const service = new UtilityService(c.env, c.env.DB);
    const householdId = getHouseholdId(c);
    const billId = c.req.param('billId');
    const userId = getUserId(c);
    const updates = c.req.valid('json');

    try {
      const bill = await service.updateUtilityBill(householdId, billId, userId, updates);
      return c.json(bill);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Unknown error' }, errorStatus(error));
    }
  }
);

utilities.delete('/bills/:billId', async (c) => {
  const service = new UtilityService(c.env, c.env.DB);
  const householdId = getHouseholdId(c);
  const billId = c.req.param('billId');
  const userId = getUserId(c);

  try {
    await service.deleteUtilityBill(householdId, billId, userId);
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Unknown error' }, errorStatus(error));
  }
});

// ============ PROPERTY TAXES ============

utilities.post(
  '/property-taxes',
  zValidator('json', createPropertyTaxSchema),
  async (c) => {
    const service = new UtilityService(c.env, c.env.DB);
    const householdId = getHouseholdId(c);
    const userId = getUserId(c);
    const input = c.req.valid('json');

    try {
      const tax = await service.createPropertyTax(householdId, userId, input);

      // Soft one-property grant rule: if the grant was applied here but another
      // of the user's properties already claimed it this year, warn (don't block).
      let grantWarning: string | undefined;
      if (input.homeownerGrantApplied) {
        const other = await service.checkGrantAppliedElsewhere(householdId, userId, input.taxYear);
        if (other.conflict) {
          const where = other.householdName ? ` to ${other.householdName}` : ' to another property';
          grantWarning = `You've already applied the ${input.taxYear} Home Owner Grant${where}. It can only be claimed on one property per year.`;
        }
      }

      return c.json(grantWarning ? { ...tax, grantWarning } : tax, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Unknown error' }, errorStatus(error));
    }
  }
);

utilities.get('/property-taxes', async (c) => {
  const service = new UtilityService(c.env, c.env.DB);
  const householdId = getHouseholdId(c);
  const userId = getUserId(c);

  try {
    const taxes = await service.getPropertyTaxes(householdId, userId);
    return c.json(taxes);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Unknown error' }, errorStatus(error));
  }
});

utilities.get('/property-taxes/:year', async (c) => {
  const service = new UtilityService(c.env, c.env.DB);
  const householdId = getHouseholdId(c);
  const userId = getUserId(c);
  const taxYear = parseInt(c.req.param('year'));

  try {
    const tax = await service.getPropertyTaxByYear(householdId, userId, taxYear);
    if (!tax) {
      return c.json({ error: 'Property tax not found' }, 404);
    }
    return c.json(tax);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Unknown error' }, errorStatus(error));
  }
});

utilities.patch(
  '/property-taxes/:taxId',
  zValidator('json', updatePropertyTaxSchema),
  async (c) => {
    const service = new UtilityService(c.env, c.env.DB);
    const householdId = getHouseholdId(c);
    const taxId = c.req.param('taxId');
    const userId = getUserId(c);
    const updates = c.req.valid('json');

    try {
      const tax = await service.updatePropertyTax(householdId, taxId, userId, updates);
      return c.json(tax);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Unknown error' }, errorStatus(error));
    }
  }
);

// ============ BC ASSESSMENT ============

utilities.post(
  '/bc-assessment',
  zValidator('json', createBCAssessmentSchema),
  async (c) => {
    const service = new UtilityService(c.env, c.env.DB);
    const householdId = getHouseholdId(c);
    const userId = getUserId(c);
    const input = c.req.valid('json');

    try {
      const assessment = await service.createBCAssessment(householdId, userId, input);
      return c.json(assessment, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Unknown error' }, errorStatus(error));
    }
  }
);

utilities.get('/bc-assessment', async (c) => {
  const service = new UtilityService(c.env, c.env.DB);
  const householdId = getHouseholdId(c);
  const userId = getUserId(c);

  try {
    const assessments = await service.getBCAssessments(householdId, userId);
    return c.json(assessments);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Unknown error' }, errorStatus(error));
  }
});

utilities.patch(
  '/bc-assessment/:assessmentId',
  zValidator('json', updateBCAssessmentSchema),
  async (c) => {
    const service = new UtilityService(c.env, c.env.DB);
    const householdId = getHouseholdId(c);
    const assessmentId = c.req.param('assessmentId');
    const userId = getUserId(c);
    const updates = c.req.valid('json');

    try {
      const assessment = await service.updateBCAssessment(
        householdId,
        assessmentId,
        userId,
        updates
      );
      return c.json(assessment);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Unknown error' }, errorStatus(error));
    }
  }
);

// Upload a BC Assessment notice (PDF/image), store it in R2, and extract its
// structured data with AI. Returns the suggested record for the user to review
// before saving (mirrors /property-taxes/upload). Flags when a notice for the
// extracted year already exists so the client can update instead of create.
utilities.post('/bc-assessment/upload', async (c) => {
  const userId = getUserId(c);
  await assertCanUseAI(userId, c.env);
  const householdId = getHouseholdId(c);

  try {
    const formData = await c.req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return c.json({ error: 'File is required' }, 400);
    }

    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    const fileType = file.type || 'application/pdf';
    if (!allowedTypes.includes(fileType)) {
      return c.json(
        { error: `Unsupported file type: ${fileType}. Allowed: PDF, JPEG, PNG, WebP` },
        400
      );
    }

    const maxSize = 32 * 1024 * 1024;
    if (file.size > maxSize) {
      return c.json({ error: 'File size exceeds 32MB limit' }, 400);
    }

    const fileKey = `utilities/${householdId}/bc-assessment/${crypto.randomUUID()}-${file.name}`;
    const arrayBuffer = await file.arrayBuffer();
    await c.env.REPORTS_BUCKET.put(fileKey, arrayBuffer, {
      httpMetadata: { contentType: fileType },
    });

    console.log(`[BC-ASSESSMENT-UPLOAD] File uploaded to R2: ${fileKey}`);

    // Extraction is jurisdiction-aware: the household's country + province pick
    // the province's own vocabulary, document types and appeal body for the
    // prompt. An unknown or unsupported region resolves to null, which yields a
    // generic Canadian prompt — never British Columbia's rules by default.
    const jurisdiction = await resolveHouseholdPropertyJurisdiction(
      c.env.DB,
      householdId,
      userId
    );

    const extractionService = new BCAssessmentExtractionService(c.env, userId, jurisdiction);
    const { data: extractedData, usage } = await extractionService.extractFromR2(fileKey);

    const utilityService = new UtilityService(c.env, c.env.DB);
    const suggestedAssessment = extractionService.toCreateBCAssessmentInput(extractedData);

    // One record per assessment year (unique index on household+year). Flag when
    // a notice for this year already exists so the client can update it.
    const existingAssessment = extractedData.assessmentYear
      ? await utilityService.getBCAssessmentByYear(householdId, userId, extractedData.assessmentYear)
      : null;

    // A single notice lists several prior years — persist them all now so the
    // history/chart is complete immediately, instead of requiring one upload per
    // year. The current roll year is excluded here; it flows through the review
    // sheet so the user can confirm/edit it and attach the PDF + appeal deadline.
    let historyBackfill = { created: 0, enriched: 0 };
    try {
      const historyInputs = extractionService.toBackfillHistoryInputs(extractedData);
      if (historyInputs.length > 0) {
        historyBackfill = await utilityService.backfillBCAssessmentHistory(
          householdId,
          userId,
          historyInputs
        );
      }
    } catch (backfillError) {
      console.error('[BC-ASSESSMENT-UPLOAD] History backfill failed:', backfillError);
    }

    console.log(`[BC-ASSESSMENT-UPLOAD] Extraction complete:`, {
      assessmentYear: extractedData.assessmentYear,
      totalValue: extractedData.values.totalValue,
      historyYears: extractedData.valueHistory.length,
      historyBackfill,
      jurisdiction: jurisdiction ? `${jurisdiction.countryCode}-${jurisdiction.regionCode}` : null,
      confidence: extractedData.confidence.overall,
      duplicate: !!existingAssessment,
    });

    // The notice's most recent sale (highest date) is the best candidate for the
    // owner's real purchase price — offer it so the client can one-tap prefill.
    const suggestedPurchase = extractedData.salesHistory
      .filter((s) => s.date != null && s.price != null)
      .sort((a, b) => (a.date! < b.date! ? 1 : -1))[0] ?? null;

    return c.json({
      success: true,
      duplicate: !!existingAssessment,
      existingAssessment: existingAssessment || undefined,
      extractedData,
      suggestedAssessment,
      suggestedPurchase,
      historyBackfill,
      // Additive: lets the review sheet label values with the vocabulary the
      // homeowner's own notice uses. Null when the region is unknown.
      jurisdiction: describePropertyJurisdiction(jurisdiction),
      documentUrl: fileKey,
      confidence: extractedData.confidence,
      tokensUsed: usage.input_tokens + usage.output_tokens,
    });
  } catch (error) {
    console.error('[BC-ASSESSMENT-UPLOAD] Error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Unknown error' }, errorStatus(error));
  }
});

// ============ PROPERTY INSIGHTS ============

// Combined, server-computed insights for the Property detail screen: stat
// tiles, chart series, and insight cards derived from BC Assessment +
// property-tax history. Thin frontend — the client only renders.
utilities.get('/property-overview', async (c) => {
  const service = new UtilityService(c.env, c.env.DB);
  const householdId = getHouseholdId(c);
  const userId = getUserId(c);

  try {
    const overview = await service.getPropertyInsights(householdId, userId);
    return c.json(overview);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Unknown error' }, errorStatus(error));
  }
});

// ============ DASHBOARD ============

utilities.get('/dashboard', async (c) => {
  const service = new UtilityService(c.env, c.env.DB);
  const householdId = getHouseholdId(c);
  const userId = getUserId(c);

  try {
    const overview = await service.getDashboardOverview(householdId, userId);
    return c.json(overview);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Unknown error' }, errorStatus(error));
  }
});

// ============ ANALYTICS ============

utilities.get('/analytics', async (c) => {
  const service = new UtilityService(c.env, c.env.DB);
  const householdId = getHouseholdId(c);
  const userId = getUserId(c);

  // `parseInt('abc')` is NaN, and the analytics layer defaults with `??`, which
  // does NOT replace NaN — so `?startYear=abc` sailed through and every
  // comparison against it was false, returning a fully-populated household an
  // all-zero payload with no error. Reject the garbage instead of silently
  // reporting "you have no bills".
  // Returns `null` for invalid input so the handler can answer with this
  // file's FLAT `{ error }` body; throwing would land in app.onError and come
  // back wrapped as `{ error: { code, message } }`, which no caller here reads.
  const parseYear = (raw: string | undefined): number | undefined | null => {
    if (raw === undefined || raw === '') return undefined;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1900 || value > 2200) return null;
    return value;
  };

  const startYear = parseYear(c.req.query('startYear'));
  const endYear = parseYear(c.req.query('endYear'));
  if (startYear === null || endYear === null) {
    return c.json({ error: 'startYear and endYear must be 4-digit years' }, 400);
  }

  const utilityType = c.req.query('utilityType') || undefined;

  const providerKey = c.req.query('providerKey') || undefined;

  try {
    const analytics = await service.getAnalytics(householdId, userId, {
      startYear,
      endYear,
      utilityType,
      providerKey,
    });
    return c.json(analytics);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Unknown error' }, errorStatus(error));
  }
});

utilities.post('/analytics/calculate-trends', async (c) => {
  const service = new UtilityService(c.env, c.env.DB);
  const householdId = getHouseholdId(c);
  const userId = getUserId(c);

  const year = c.req.query('year') ? parseInt(c.req.query('year')!) : new Date().getFullYear();
  const month = c.req.query('month') ? parseInt(c.req.query('month')!) : undefined;

  try {
    await service.calculateTrends(householdId, userId, year, month);
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Unknown error' }, errorStatus(error));
  }
});

// ============ REMINDERS ============

utilities.post('/bills/:billId/reminders', async (c) => {
  const service = new UtilityService(c.env, c.env.DB);
  const householdId = getHouseholdId(c);
  const billId = c.req.param('billId');
  const userId = getUserId(c);

  const body = await c.req.json().catch(() => ({}));
  const dueDate = body.dueDate;

  if (!dueDate) {
    return c.json({ error: 'dueDate is required' }, 400);
  }

  // `reminderDays` used to be passed straight through, unvalidated and
  // uncapped: `{"reminderDays":[1,2,...,5000]}` issued 5000 sequential inserts
  // in one request, and a non-array or non-numeric entry produced garbage rows.
  const reminderDaysSchema = z.array(z.number().int().min(0).max(365)).min(1).max(10);
  const parsedDays = reminderDaysSchema.safeParse(body.reminderDays ?? [14, 7, 3, 1]);
  if (!parsedDays.success) {
    return c.json(
      { error: 'reminderDays must be 1-10 whole numbers between 0 and 365' },
      400
    );
  }
  const reminderDays = parsedDays.data;

  try {
    const reminders = await service.scheduleBillReminders(householdId, userId, billId, dueDate, reminderDays);
    return c.json(reminders, 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Unknown error' }, errorStatus(error));
  }
});

utilities.delete('/bills/:billId/reminders', async (c) => {
  const service = new UtilityService(c.env, c.env.DB);
  const householdId = getHouseholdId(c);
  const billId = c.req.param('billId');
  const userId = getUserId(c);

  try {
    await service.cancelBillReminders(householdId, billId, userId);
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Unknown error' }, errorStatus(error));
  }
});

utilities.get('/reminders', async (c) => {
  const service = new UtilityService(c.env, c.env.DB);
  const householdId = getHouseholdId(c);
  const userId = getUserId(c);

  const sent = c.req.query('sent');
  const type = c.req.query('type');

  try {
    const reminders = await service.getReminders(householdId, userId, {
      sent: sent === 'true' ? true : sent === 'false' ? false : undefined,
      type: type || undefined,
    });
    return c.json(reminders);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Unknown error' }, errorStatus(error));
  }
});

// ============ DOCUMENT UPLOAD & SCANNING ============

/**
 * Upload and extract bill data using AI
 * Supports PDF and image files (JPEG, PNG, WebP)
 */
utilities.post('/bills/upload', async (c) => {
  const userId = getUserId(c);
  await assertCanUseAI(userId, c.env);
  const householdId = getHouseholdId(c);

  try {
    const formData = await c.req.formData();
    const file = formData.get('file') as File | null;
    const autoCreate = formData.get('autoCreate') === 'true';

    if (!file) {
      return c.json({ error: 'File is required' }, 400);
    }

    // Validate file type
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    const fileType = file.type || 'application/pdf';
    if (!allowedTypes.includes(fileType)) {
      return c.json(
        { error: `Unsupported file type: ${fileType}. Allowed: PDF, JPEG, PNG, WebP` },
        400
      );
    }

    // Check file size (max 32MB for Claude)
    const maxSize = 32 * 1024 * 1024;
    if (file.size > maxSize) {
      return c.json({ error: 'File size exceeds 32MB limit' }, 400);
    }

    // Upload to R2
    const fileKey = `utilities/${householdId}/bills/${crypto.randomUUID()}-${file.name}`;
    const arrayBuffer = await file.arrayBuffer();
    await c.env.REPORTS_BUCKET.put(fileKey, arrayBuffer, {
      httpMetadata: {
        contentType: fileType,
      },
    });

    console.log(`[BILL-UPLOAD] File uploaded to R2: ${fileKey}`);

    // Extract bill data using AI
    const extractionService = new BillExtractionService(c.env, userId);
    const { data: extractedData, usage } = await extractionService.extractFromR2(fileKey);

    console.log(`[BILL-UPLOAD] Extraction complete:`, {
      provider: extractedData.provider.name,
      amount: extractedData.financial.amountDue,
      confidence: extractedData.confidence.overall,
      tokensUsed: usage.input_tokens + usage.output_tokens,
    });

    const utilityService = new UtilityService(c.env, c.env.DB);
    const billInput = extractionService.toCreateBillInput(extractedData);

    // Month-based duplicate check — drives both autoCreate-skip (batch import)
    // and the "already imported" warning on the manual review response.
    const duplicateBill = await utilityService.findDuplicateBill(householdId, userId, billInput);

    const suggestedBill = {
      billType: extractedData.provider.type,
      provider: extractedData.provider.name,
      accountNumber: extractedData.account.number,
      billingPeriodStart: extractedData.billing.periodStart,
      billingPeriodEnd: extractedData.billing.periodEnd,
      amount: extractedData.financial.amountDue
        ? Math.round(extractedData.financial.amountDue * 100)
        : null,
      dueDate: extractedData.billing.dueDate,
      usageQuantity: extractedData.usage.quantity,
      usageUnit: extractedData.usage.unit,
    };

    // If autoCreate is true and confidence is high enough, create the bill
    // automatically — unless it's a duplicate, in which case we skip and report it.
    if (autoCreate && extractedData.confidence.overall >= 0.8) {
      if (duplicateBill) {
        return c.json({
          success: true,
          autoCreated: false,
          duplicate: true,
          existingBill: duplicateBill,
          extractedData,
          documentUrl: fileKey,
          confidence: extractedData.confidence,
          tokensUsed: usage.input_tokens + usage.output_tokens,
          suggestedBill,
        });
      }
      try {
        // Batch auto-create: defer the "Pay bill" task to the ConfirmBillPayments
        // step so we don't create one per imported bill before the user has said
        // which are already paid.
        const bill = await utilityService.createUtilityBill(
          householdId,
          userId,
          { ...billInput, documentUrl: fileKey },
          { deferPayTask: true }
        );

        return c.json({
          success: true,
          autoCreated: true,
          bill,
          extractedData,
          documentUrl: fileKey,
          confidence: extractedData.confidence,
          tokensUsed: usage.input_tokens + usage.output_tokens,
        });
      } catch (createError) {
        console.error('[BILL-UPLOAD] Auto-create failed:', createError);
        // Fall through to return extracted data for manual review
      }
    }

    // Return extracted data for user review/confirmation (flag likely duplicates).
    return c.json({
      success: true,
      autoCreated: false,
      duplicate: !!duplicateBill,
      existingBill: duplicateBill || undefined,
      extractedData,
      documentUrl: fileKey,
      confidence: extractedData.confidence,
      tokensUsed: usage.input_tokens + usage.output_tokens,
      suggestedBill,
    });
  } catch (error) {
    console.error('[BILL-UPLOAD] Error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Unknown error' }, errorStatus(error));
  }
});

/**
 * Re-extract bill data from an already uploaded file
 */
utilities.post('/bills/extract', async (c) => {
  const householdId = getHouseholdId(c);
  const userId = getUserId(c);
  await assertCanUseAI(userId, c.env);

  try {
    const body = await c.req.json();
    const { documentUrl } = body;

    if (!documentUrl) {
      return c.json({ error: 'documentUrl is required' }, 400);
    }

    // Verify file belongs to this household
    if (!documentUrl.startsWith(`utilities/${householdId}/`)) {
      return c.json({ error: 'Invalid document URL' }, 403);
    }

    // Extract bill data using AI
    const extractionService = new BillExtractionService(c.env, userId);
    const { data: extractedData, usage } = await extractionService.extractFromR2(documentUrl);

    return c.json({
      success: true,
      extractedData,
      confidence: extractedData.confidence,
      tokensUsed: usage.input_tokens + usage.output_tokens,
      suggestedBill: {
        billType: extractedData.provider.type,
        provider: extractedData.provider.name,
        accountNumber: extractedData.account.number,
        billingPeriodStart: extractedData.billing.periodStart,
        billingPeriodEnd: extractedData.billing.periodEnd,
        amount: extractedData.financial.amountDue
          ? Math.round(extractedData.financial.amountDue * 100)
          : null,
        dueDate: extractedData.billing.dueDate,
        usageQuantity: extractedData.usage.quantity,
        usageUnit: extractedData.usage.unit,
      },
    });
  } catch (error) {
    console.error('[BILL-EXTRACT] Error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Unknown error' }, errorStatus(error));
  }
});

/**
 * Upload and extract a property tax notice using AI.
 * Uploads the PDF/image to R2, runs Claude extraction, checks for an existing
 * record for that tax year, and returns the parsed data for the client to
 * review (paid/unpaid + grant) before creating the record. Supports PDF and
 * image files (JPEG, PNG, WebP).
 */
utilities.post('/property-taxes/upload', async (c) => {
  const userId = getUserId(c);
  await assertCanUseAI(userId, c.env);
  const householdId = getHouseholdId(c);

  try {
    const formData = await c.req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return c.json({ error: 'File is required' }, 400);
    }

    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    const fileType = file.type || 'application/pdf';
    if (!allowedTypes.includes(fileType)) {
      return c.json(
        { error: `Unsupported file type: ${fileType}. Allowed: PDF, JPEG, PNG, WebP` },
        400
      );
    }

    const maxSize = 32 * 1024 * 1024;
    if (file.size > maxSize) {
      return c.json({ error: 'File size exceeds 32MB limit' }, 400);
    }

    // Upload to R2
    const fileKey = `utilities/${householdId}/property-taxes/${crypto.randomUUID()}-${file.name}`;
    const arrayBuffer = await file.arrayBuffer();
    await c.env.REPORTS_BUCKET.put(fileKey, arrayBuffer, {
      httpMetadata: { contentType: fileType },
    });

    console.log(`[PROPERTY-TAX-UPLOAD] File uploaded to R2: ${fileKey}`);

    // Extraction is jurisdiction-aware: the household's country + province pick
    // the bill layout the prompt describes (BC's three grant columns, Alberta's
    // municipal + provincial-education split, Manitoba's netted-off credit,
    // Ontario's interim vs final bill, Québec's French «compte de taxes»). An
    // unknown region resolves to null and yields a generic Canadian prompt.
    const jurisdiction = await resolveHouseholdPropertyJurisdiction(
      c.env.DB,
      householdId,
      userId
    );

    // Extract property tax data using AI
    const extractionService = new PropertyTaxExtractionService(c.env, userId, jurisdiction);
    const { data: extractedData, usage } = await extractionService.extractFromR2(fileKey);

    const utilityService = new UtilityService(c.env, c.env.DB);
    const suggestedTax = extractionService.toCreatePropertyTaxInput(extractedData);

    // One record per tax year (unique index on household+year). Flag when a
    // notice for this year already exists so the client can warn the user.
    const existingTax = extractedData.taxYear
      ? await utilityService.getPropertyTaxByYear(householdId, userId, extractedData.taxYear)
      : null;

    console.log(`[PROPERTY-TAX-UPLOAD] Extraction complete:`, {
      municipality: extractedData.municipality.name,
      taxYear: extractedData.taxYear,
      amount: extractedData.financial.totalTaxAmount,
      taxLevied: extractedData.financial.taxLevied,
      amountOwing: extractedData.financial.amountOwing,
      jurisdiction: jurisdiction ? `${jurisdiction.countryCode}-${jurisdiction.regionCode}` : null,
      confidence: extractedData.confidence.overall,
      duplicate: !!existingTax,
    });

    return c.json({
      success: true,
      duplicate: !!existingTax,
      existingTax: existingTax || undefined,
      extractedData,
      suggestedTax,
      // Additive: lets the review sheet label values with the vocabulary the
      // homeowner's own bill uses. Null when the region is unknown.
      jurisdiction: describePropertyJurisdiction(jurisdiction),
      documentUrl: fileKey,
      confidence: extractedData.confidence,
      tokensUsed: usage.input_tokens + usage.output_tokens,
    });
  } catch (error) {
    console.error('[PROPERTY-TAX-UPLOAD] Error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Unknown error' }, errorStatus(error));
  }
});

// ============ UTILITY PROVIDERS ============

utilities.get('/providers', async (c) => {
  const service = new UtilityService(c.env, c.env.DB);
  const type = c.req.query('type') || undefined;

  try {
    const providers = await service.getUtilityProviders(type);
    return c.json(providers);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Unknown error' }, errorStatus(error));
  }
});

// ============ HOME OWNER GRANT CALCULATION ============

utilities.post('/calculate-homeowner-grant', async (c) => {
  const service = new UtilityService(c.env, c.env.DB);
  // `.catch` matters: this sat outside the try block, so a POST with no body
  // (or malformed JSON) rejected here and fell through to app.onError as an
  // unhandled 500 instead of a 400.
  const body = await c.req.json().catch(() => ({}));

  // `!assessedValue` rejected a legitimate assessedValue of 0 — which is under
  // every threshold and should return the full grant, not a validation error.
  // Zod gives us the type check the truthiness test was standing in for.
  const grantInputSchema = z.object({
    assessedValue: z.number().int().min(0),
    isSenior: z.boolean().optional(),
    isVeteran: z.boolean().optional(),
    isDisabled: z.boolean().optional(),
    isRural: z.boolean().optional(),
  });

  const parsed = grantInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'assessedValue is required (whole cents, 0 or more)' }, 400);
  }

  const assessedValue = parsed.data.assessedValue; // in cents
  const isSenior = parsed.data.isSenior ?? false;
  const isVeteran = parsed.data.isVeteran ?? false;
  const isDisabled = parsed.data.isDisabled ?? false;
  const isRural = parsed.data.isRural ?? false;

  try {
    const result = service.calculateHomeOwnerGrant(assessedValue, isSenior, isVeteran, isDisabled, isRural);
    return c.json(result);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Unknown error' }, errorStatus(error));
  }
});

// ============ PENALTY CALCULATION ============

utilities.post('/property-taxes/:taxId/calculate-penalties', async (c) => {
  const service = new UtilityService(c.env, c.env.DB);
  const householdId = getHouseholdId(c);
  const taxId = c.req.param('taxId');
  const userId = getUserId(c);

  const body = await c.req.json().catch(() => ({}));
  const paymentDate = body.paymentDate;

  try {
    const tax = await service.getPropertyTaxById(householdId, taxId, userId);

    if (!tax) {
      return c.json({ error: 'Property tax not found' }, 404);
    }

    const municipality = await service.detectMunicipalityForHousehold(householdId, userId);
    const penalties = service.calculatePropertyTaxPenalties(tax, municipality, paymentDate);

    return c.json({ penalties, totalPenalty: penalties.reduce((sum, p) => sum + p.amount, 0) });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Unknown error' }, errorStatus(error));
  }
});

// ============ PROPERTY TAX DUE DATE CALCULATION ============

utilities.post('/property-taxes/calculate-due-date', async (c) => {
  const service = new UtilityService(c.env, c.env.DB);
  const householdId = getHouseholdId(c);
  const userId = getUserId(c);

  // Same unguarded `json()` as the grant route had: every field this handler
  // reads is optional with a default, so an empty POST body is perfectly valid
  // input — yet it threw and surfaced as a 500.
  const body = await c.req.json().catch(() => ({}));
  const taxYear = body.taxYear || new Date().getFullYear();
  const paymentType = body.paymentType || 'main'; // 'advance' or 'main'

  try {
    const municipality = await service.detectMunicipalityForHousehold(householdId, userId);
    const dueDate = service.calculatePropertyTaxDueDate(taxYear, municipality, paymentType);

    return c.json({ dueDate, municipality: municipality?.municipality_name || null });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Unknown error' }, errorStatus(error));
  }
});

// ============ SEEDING (DEV/ADMIN ONLY) ============

utilities.post('/seed/providers', async (c) => {
  // Admin check: Only allow in development/staging environments
  if (c.env.ENVIRONMENT === 'production') {
    return c.json({ error: 'This endpoint is not available in production' }, 403);
  }

  const service = new UtilityService(c.env, c.env.DB);

  try {
    await service.seedUtilityProviders();
    return c.json({ success: true, message: 'Utility providers seeded' });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Unknown error' }, errorStatus(error));
  }
});

utilities.post('/seed/municipalities', async (c) => {
  // Admin check: Only allow in development/staging environments
  if (c.env.ENVIRONMENT === 'production') {
    return c.json({ error: 'This endpoint is not available in production' }, 403);
  }

  const service = new UtilityService(c.env, c.env.DB);

  try {
    await service.seedMunicipalityConfigs();
    return c.json({ success: true, message: 'Municipality configs seeded' });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Unknown error' }, errorStatus(error));
  }
});

export default utilities;
