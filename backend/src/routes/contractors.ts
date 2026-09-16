import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import type { ClaudeProvider } from '../ai/claude-provider';
import { createProviderAdapter } from '../ai/provider-factory';
import { CONTRACTOR_SPECIALTIES, VISIT_STATUSES, DOCUMENT_TYPES } from '../db/schema-contractors';
import { authMiddleware } from '../middleware/auth';
import { resolveProviderApiKey } from '../services/ai-credential-resolver';
import { usageRecorderFor } from '../services/ai-usage-service';
import { ContractorService } from '../services/contractor-service';
import { assertCanUseAI } from '../services/entitlement-service';
import type { Env } from '../types';
import { nowIso } from '../utils/id';

const contractorsRouter = new Hono<{ Bindings: Env }>();

// All routes require authentication
contractorsRouter.use('/*', authMiddleware());

// Helper to get householdId from parent route param
function getHouseholdId(c: { req: { param: (key: string) => string | undefined } }): string {
  const householdId = c.req.param('householdId');
  if (!householdId) throw new Error('Household ID is required');
  return householdId;
}

// ============ VALIDATION SCHEMAS ============

// Helper to handle optional string fields that may come as empty strings
const optionalString = (maxLen: number) =>
  z.string().max(maxLen).optional().transform((val) => (val === '' ? undefined : val));

const optionalEmail = () =>
  z
    .string()
    .max(200)
    .optional()
    .transform((val) => (val === '' ? undefined : val))
    .refine((val) => !val || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val), {
      message: 'Invalid email format',
    });

const optionalUrl = () =>
  z
    .string()
    .max(500)
    .optional()
    .transform((val) => (val === '' ? undefined : val))
    .refine((val) => !val || /^https?:\/\/.+/.test(val), {
      message: 'Invalid URL format',
    });

z.object({
  name: z.string().min(1).max(200),
  company_name: optionalString(200),
  specialty: z.enum(CONTRACTOR_SPECIALTIES),
  phone: optionalString(50),
  email: optionalEmail(),
  website: optionalUrl(),
  address: optionalString(500),
  notes: optionalString(2000),
  rating: z.number().int().min(1).max(5).optional().nullable(),
  is_favorite: z.boolean().optional(),
});

const updateContractorSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  company_name: optionalString(200),
  specialty: z.enum(CONTRACTOR_SPECIALTIES).optional(),
  phone: optionalString(50),
  email: optionalEmail(),
  website: optionalUrl(),
  address: optionalString(500),
  notes: optionalString(2000),
  rating: z.number().int().min(1).max(5).optional().nullable(),
  is_favorite: z.boolean().optional(),
});

const contractorFiltersSchema = z.object({
  specialty: z.enum(CONTRACTOR_SPECIALTIES).optional(),
  is_favorite: z.coerce.boolean().optional(),
  search: z.string().max(100).optional(),
});

const createVisitSchema = z.object({
  visit_date: z.string(),
  description: z.string().max(2000).optional(),
  cost: z.number().int().min(0).optional(),
  status: z.enum(VISIT_STATUSES),
  notes: z.string().max(2000).optional(),
  rating: z.number().int().min(1).max(5).optional(),
  linked_task_id: z.string().uuid().optional(),
  linked_budget_item_id: z.string().uuid().optional(),
});

const updateVisitSchema = z.object({
  visit_date: z.string().optional(),
  description: z.string().max(2000).optional(),
  cost: z.number().int().min(0).optional(),
  status: z.enum(VISIT_STATUSES).optional(),
  notes: z.string().max(2000).optional(),
  rating: z.number().int().min(1).max(5).optional(),
  linked_task_id: z.string().uuid().optional(),
  linked_budget_item_id: z.string().uuid().optional(),
  receipt_received: z.boolean().optional(),
});

const requestReceiptSchema = z.object({
  method: z.enum(['email', 'sms']),
  contractor_email: z.string().email().optional(),
  contractor_phone: z.string().optional(),
  property_address: z.string().min(1),
  custom_message: z.string().max(1000).optional(),
});

const visitFiltersSchema = z.object({
  contractor_id: z.string().uuid().optional(),
  status: z.enum(VISIT_STATUSES).optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
});

const createDocumentSchema = z.object({
  contractor_id: z.string().uuid(),
  visit_id: z.string().uuid().optional(),
  type: z.enum(DOCUMENT_TYPES),
  title: z.string().min(1).max(200),
  file_key: z.string().min(1),
  file_name: z.string().min(1).max(500),
  file_size: z.number().int().min(0).optional(),
  mime_type: z.string().max(100).optional(),
  amount: z.number().int().min(0).optional(),
  document_date: z.string().optional(),
  notes: z.string().max(2000).optional(),
});

const documentFiltersSchema = z.object({
  contractor_id: z.string().uuid().optional(),
  visit_id: z.string().uuid().optional(),
  type: z.enum(DOCUMENT_TYPES).optional(),
});

const uploadUrlSchema = z.object({
  file_name: z.string().min(1).max(500),
  content_type: z.string().min(1).max(100),
});

const aiLookupSchema = z.object({
  company_name: z.string().min(1).max(500),
});

const startVisitModeSchema = z.object({
  contractor_rep_name: z.string().max(200).optional(),
  start_time: z.string().optional(),
});

const completeVisitSchema = z.object({
  rating: z.number().int().min(1).max(5).optional(),
  notes: z.string().max(2000).optional(),
  completed_at: z.string().optional(),
  voice_recording_key: z.string().optional(),
  voice_recording_transcription: z.string().optional(),
  voice_recording_duration_seconds: z.number().int().min(0).optional(),
});

// ============ CONTRACTOR ROUTES ============

/**
 * GET /households/:householdId/contractors/test
 * Test endpoint
 */
contractorsRouter.get('/test', async (c) => {
  console.log('[Contractors] Test endpoint hit');
  return c.json({ success: true, message: 'Contractors route working' });
});

/**
 * GET /households/:householdId/contractors
 * List all contractors
 */
contractorsRouter.get('/', zValidator('query', contractorFiltersSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const filters = c.req.valid('query');
  const service = new ContractorService(c.env, c.env.DB);

  const contractors = await service.getContractors(householdId, userId, {
    specialty: filters.specialty,
    isFavorite: filters.is_favorite,
    search: filters.search,
  });

  return c.json({ contractors });
});

/**
 * GET /households/:householdId/contractors/:id
 * Get contractor detail
 */
contractorsRouter.get('/:id', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const contractorId = c.req.param('id');
  const service = new ContractorService(c.env, c.env.DB);

  const contractor = await service.getContractor(householdId, contractorId!, userId);

  return c.json({ contractor });
});

/**
 * POST /households/:householdId/contractors
 * Create contractor
 */
contractorsRouter.post('/', async (c) => {
  try {
    console.log('[Contractors] POST / handler started');
    
    const userId = c.get('userId');
    if (!userId) {
      console.log('[Contractors] No userId');
      return c.json({ error: { code: 'no_user', message: 'No user ID' } }, 401);
    }
    console.log('[Contractors] userId:', userId);
    
    const householdId = c.req.param('householdId');
    if (!householdId) {
      console.log('[Contractors] No householdId');
      return c.json({ error: { code: 'no_household', message: 'No household ID' } }, 400);
    }
    console.log('[Contractors] householdId:', householdId);
    
    let body: any;
    try {
      body = await c.req.json();
    } catch (e) {
      console.log('[Contractors] Failed to parse body:', e);
      return c.json({ error: { code: 'invalid_body', message: 'Invalid JSON body' } }, 400);
    }
    console.log('[Contractors] Body:', JSON.stringify(body));
    
    // Basic validation
    if (!body.name || !body.specialty) {
      return c.json({ error: { code: 'validation', message: 'Name and specialty required' } }, 400);
    }
    
    const service = new ContractorService(c.env, c.env.DB);
    console.log('[Contractors] Service created');
    
    const contractor = await service.createContractor(householdId, userId, {
      name: body.name,
      companyName: body.company_name,
      specialty: body.specialty,
      phone: body.phone,
      email: body.email,
      website: body.website,
      address: body.address,
      notes: body.notes,
      rating: body.rating ?? undefined,
      isFavorite: body.is_favorite,
    });
    
    console.log('[Contractors] Contractor created:', contractor.id);
    return c.json({ contractor }, 201);
  } catch (error: any) {
    console.error('[Contractors] Unhandled error:', error?.message || error);
    console.error('[Contractors] Stack:', error?.stack);
    return c.json({ 
      error: { 
        code: 'internal_error', 
        message: error?.message || 'Unknown error',
        stack: error?.stack
      } 
    }, 500);
  }
});

/**
 * PATCH /households/:householdId/contractors/:id
 * Update contractor
 */
contractorsRouter.patch('/:id', zValidator('json', updateContractorSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const contractorId = c.req.param('id');
  const input = c.req.valid('json');
  const service = new ContractorService(c.env, c.env.DB);

  const contractor = await service.updateContractor(householdId, contractorId!, userId, {
    name: input.name,
    companyName: input.company_name,
    specialty: input.specialty,
    phone: input.phone,
    email: input.email,
    website: input.website,
    address: input.address,
    notes: input.notes,
    rating: input.rating ?? undefined,
    isFavorite: input.is_favorite,
  });

  return c.json({ contractor });
});

/**
 * DELETE /households/:householdId/contractors/:id
 * Delete contractor
 */
contractorsRouter.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const contractorId = c.req.param('id');
  const service = new ContractorService(c.env, c.env.DB);

  await service.deleteContractor(householdId, contractorId!, userId);

  return c.body(null, 204);
});

// ============ VISIT ROUTES ============

/**
 * GET /households/:householdId/contractors/visits
 * List all visits
 */
contractorsRouter.get('/visits', zValidator('query', visitFiltersSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const filters = c.req.valid('query');
  const service = new ContractorService(c.env, c.env.DB);

  const visits = await service.getVisits(householdId, userId, {
    contractorId: filters.contractor_id,
    status: filters.status,
    startDate: filters.start_date,
    endDate: filters.end_date,
  });

  return c.json({ visits });
});

/**
 * GET /households/:householdId/contractors/:contractorId/visits
 * List visits for contractor
 */
contractorsRouter.get('/:contractorId/visits', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const contractorId = c.req.param('contractorId');
  const service = new ContractorService(c.env, c.env.DB);

  const visits = await service.getVisits(householdId, userId, {
    contractorId: contractorId!,
  });

  return c.json({ visits });
});

/**
 * POST /households/:householdId/contractors/:contractorId/visits
 * Create visit
 */
contractorsRouter.post('/:contractorId/visits', zValidator('json', createVisitSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const contractorId = c.req.param('contractorId');
  const input = c.req.valid('json');
  const service = new ContractorService(c.env, c.env.DB);

  const visit = await service.createVisit(householdId, contractorId!, userId, {
    visitDate: input.visit_date,
    description: input.description,
    cost: input.cost,
    status: input.status,
    notes: input.notes,
    rating: input.rating,
    linkedTaskId: input.linked_task_id,
    linkedBudgetItemId: input.linked_budget_item_id,
  });

  return c.json({ visit }, 201);
});

/**
 * PATCH /households/:householdId/contractors/visits/:visitId
 * Update visit
 */
contractorsRouter.patch('/visits/:visitId', zValidator('json', updateVisitSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const visitId = c.req.param('visitId');
  const input = c.req.valid('json');
  const service = new ContractorService(c.env, c.env.DB);

  const visit = await service.updateVisit(householdId, visitId!, userId, {
    visitDate: input.visit_date,
    description: input.description,
    cost: input.cost,
    status: input.status,
    notes: input.notes,
    rating: input.rating,
    linkedTaskId: input.linked_task_id,
    linkedBudgetItemId: input.linked_budget_item_id,
    receiptReceived: input.receipt_received,
  });

  return c.json({ visit });
});

/**
 * DELETE /households/:householdId/contractors/visits/:visitId
 * Delete visit
 */
contractorsRouter.delete('/visits/:visitId', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const visitId = c.req.param('visitId');
  const service = new ContractorService(c.env, c.env.DB);

  await service.deleteVisit(householdId, visitId!, userId);

  return c.body(null, 204);
});

/**
 * POST /households/:householdId/contractors/visits/:visitId/request-receipt
 * Send a receipt request to the contractor
 */
contractorsRouter.post(
  '/visits/:visitId/request-receipt',
  zValidator('json', requestReceiptSchema),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const visitId = c.req.param('visitId');
    const input = c.req.valid('json');
    const service = new ContractorService(c.env, c.env.DB);

    const result = await service.requestReceipt(householdId, visitId!, userId, {
      method: input.method,
      contractorEmail: input.contractor_email,
      contractorPhone: input.contractor_phone,
      propertyAddress: input.property_address,
      customMessage: input.custom_message,
    });

    return c.json(result);
  }
);

/**
 * POST /households/:householdId/contractors/visits/:visitId/receipt-reminder-task
 * Create a daily reminder task for missing receipt
 */
contractorsRouter.post('/visits/:visitId/receipt-reminder-task', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const visitId = c.req.param('visitId');
  const service = new ContractorService(c.env, c.env.DB);

  const result = await service.createReceiptReminderTask(householdId, visitId!, userId);

  return c.json(result);
});

// ============ DOCUMENT ROUTES ============

/**
 * GET /households/:householdId/contractors/documents
 * List all documents
 */
contractorsRouter.get('/documents', zValidator('query', documentFiltersSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const filters = c.req.valid('query');
  const service = new ContractorService(c.env, c.env.DB);

  const documents = await service.getDocuments(householdId, userId, {
    contractorId: filters.contractor_id,
    visitId: filters.visit_id,
    type: filters.type,
  });

  return c.json({ documents });
});

/**
 * GET /households/:householdId/contractors/:contractorId/documents
 * List documents for contractor
 */
contractorsRouter.get('/:contractorId/documents', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const contractorId = c.req.param('contractorId');
  const service = new ContractorService(c.env, c.env.DB);

  const documents = await service.getDocuments(householdId, userId, {
    contractorId: contractorId!,
  });

  return c.json({ documents });
});

/**
 * POST /households/:householdId/contractors/documents/upload
 * Upload a document file directly
 */
contractorsRouter.post('/documents/upload', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const service = new ContractorService(c.env, c.env.DB);

  try {
    const formData = await c.req.formData();
    const file = formData.get('file') as File | null;
    
    if (!file) {
      return c.json({ error: { code: 'no_file', message: 'No file provided' } }, 400);
    }

    // Validate file size (max 32MB)
    if (file.size > 32 * 1024 * 1024) {
      return c.json({ error: { code: 'file_too_large', message: 'File size exceeds 32MB limit' } }, 400);
    }

    // Allow common document types
    const allowedTypes = [
      // Images
      'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
      // Documents
      'application/pdf',
      'application/msword', // .doc
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
      'application/vnd.ms-excel', // .xls
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'text/plain', // .txt
      'text/csv', // .csv
    ];
    
    // Also allow if type starts with image/ or is empty (unknown type)
    const isAllowed = allowedTypes.includes(file.type) || 
                      file.type.startsWith('image/') || 
                      !file.type;
    
    if (!isAllowed) {
      console.log('[Contractors] Rejected file type:', file.type);
      return c.json({ error: { code: 'invalid_type', message: `File type ${file.type} is not supported` } }, 400);
    }

    // Generate file key
    const { fileKey } = await service.generateFileKey(householdId, userId, {
      fileName: file.name,
      contentType: file.type,
    });

    // Upload to R2
    const arrayBuffer = await file.arrayBuffer();
    await service.uploadDocument(householdId, userId, fileKey, arrayBuffer, file.type);

    return c.json({
      success: true,
      fileKey,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
    });
  } catch (error: any) {
    console.error('[Contractors] Upload error:', error);
    return c.json({ 
      error: { code: 'upload_failed', message: error?.message || 'Upload failed' } 
    }, 500);
  }
});

/**
 * POST /households/:householdId/contractors/documents/upload-url
 * Get file key for upload (legacy endpoint - now returns key only)
 */
contractorsRouter.post('/documents/upload-url', zValidator('json', uploadUrlSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const input = c.req.valid('json');
  const service = new ContractorService(c.env, c.env.DB);

  const { fileKey } = await service.generateFileKey(householdId, userId, {
    fileName: input.file_name,
    contentType: input.content_type,
  });

  // Return the upload endpoint URL for direct upload
  return c.json({ 
    uploadUrl: `/households/${householdId}/contractors/documents/upload`,
    fileKey,
  });
});

/**
 * POST /households/:householdId/contractors/documents
 * Create document record
 */
contractorsRouter.post('/documents', zValidator('json', createDocumentSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const input = c.req.valid('json');
  const service = new ContractorService(c.env, c.env.DB);

  const document = await service.createDocument(householdId, userId, {
    contractorId: input.contractor_id,
    visitId: input.visit_id,
    type: input.type,
    title: input.title,
    fileKey: input.file_key,
    fileName: input.file_name,
    fileSize: input.file_size,
    mimeType: input.mime_type,
    amount: input.amount,
    documentDate: input.document_date,
    notes: input.notes,
  });

  return c.json({ document }, 201);
});

/**
 * GET /households/:householdId/contractors/documents/:documentId/download
 * Download/serve a document file
 */
contractorsRouter.get('/documents/:documentId/download', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const documentId = c.req.param('documentId');
  const service = new ContractorService(c.env, c.env.DB);

  // Get document record to find file key
  const documents = await service.getDocuments(householdId, userId, {});
  const document = documents.find(d => d.id === documentId);
  
  if (!document) {
    return c.json({ error: { code: 'not_found', message: 'Document not found' } }, 404);
  }

  const file = await service.getDocumentFile(document.file_key);
  
  if (!file) {
    return c.json({ error: { code: 'file_not_found', message: 'File not found in storage' } }, 404);
  }

  const headers = new Headers();
  headers.set('Content-Type', document.mime_type || 'application/octet-stream');
  headers.set('Content-Disposition', `inline; filename="${document.file_name}"`);
  
  return new Response(file.body, { headers });
});

/**
 * DELETE /households/:householdId/contractors/documents/:documentId
 * Delete document
 */
contractorsRouter.delete('/documents/:documentId', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const documentId = c.req.param('documentId');
  const service = new ContractorService(c.env, c.env.DB);

  const fileKey = await service.deleteDocument(householdId, documentId!, userId);

  // Delete from R2
  await service.deleteDocumentFile(fileKey);

  return c.body(null, 204);
});

// ============ AI LOOKUP ROUTES ============

/**
 * POST /households/:householdId/contractors/ai-lookup
 * Use AI to find contractor information based on company name
 */
contractorsRouter.post('/ai-lookup', zValidator('json', aiLookupSchema), async (c) => {
  const userId = c.get('userId');
  const companyName = c.req.valid('json').company_name;
  await assertCanUseAI(userId, c.env);

  // Their own connected key or the managed one — either makes AI lookup runnable.
  const { apiKey: anthropicKey } = await resolveProviderApiKey(c.env, userId, 'anthropic');
  if (!anthropicKey) {
    return c.json(
      {
        success: false,
        error: 'AI service not configured',
        contractor: null,
      },
      503
    );
  }

  try {
    const claude = createProviderAdapter({
      provider: 'anthropic',
      apiKey: anthropicKey,
      options: {
      onUsage: usageRecorderFor(c.env, {
        feature: 'contractor_ai_lookup',
        householdId: c.req.param('householdId') ?? null,
        userId: userId ?? null,
      }),
    },
    }) as ClaudeProvider;

    const result = await claude.generateJSON<{
      found: boolean;
      contractor: {
        name?: string;
        company_name?: string;
        specialty?: string;
        phone?: string;
        email?: string;
        website?: string;
        address?: string;
        notes?: string;
        business_type?: string;
        license_number?: string;
        years_in_business?: number;
        service_area?: string;
        business_hours?: string;
      } | null;
      confidence: number;
      message: string;
    }>({
      systemPrompt: `You are an expert at finding contractor and business information.
Your task is to search your knowledge base for information about the given company/contractor.
Return structured JSON with any information you can find.
All fields are optional - return only what you know.
If you cannot find any information, set found to false.
Partial information is acceptable and encouraged.

Valid specialty values: plumber, electrician, hvac, roofer, general, landscaper, painter, carpenter, appliance, pest_control, cleaning, other

Return ONLY valid JSON, no explanation or markdown.`,
      userPrompt: `Find information about this contractor/company: "${companyName}"

Return JSON in this exact format:
{
  "found": true or false,
  "contractor": {
    "name": "Contact person name if known",
    "company_name": "Official company name",
    "specialty": "One of: plumber, electrician, hvac, roofer, general, landscaper, painter, carpenter, appliance, pest_control, cleaning, other",
    "phone": "Phone number if known",
    "email": "Email if known",
    "website": "Website URL if known",
    "address": "Business address if known",
    "notes": "Any additional relevant information about the company",
    "business_type": "LLC, Corporation, Sole Proprietor, etc.",
    "license_number": "Contractor license number if known",
    "years_in_business": number or null,
    "service_area": "Geographic area they serve",
    "business_hours": "Operating hours if known"
  },
  "confidence": 0.0 to 1.0 (how confident you are in the information),
  "message": "Brief message about the search result"
}

If you cannot find any information about this company, return:
{
  "found": false,
  "contractor": null,
  "confidence": 0,
  "message": "Cannot find information about this company"
}`,
      maxTokens: 1000,
    });

    if (!result.found || !result.contractor) {
      return c.json({
        success: false,
        error: result.message || 'Cannot find information about this company',
        contractor: null,
        confidence: 0,
      });
    }

    return c.json({
      success: true,
      contractor: result.contractor,
      confidence: result.confidence,
      message: result.message,
    });
  } catch (error) {
    console.error('AI lookup error:', error);
    return c.json(
      {
        success: false,
        error: 'Failed to lookup contractor information',
        contractor: null,
      },
      500
    );
  }
});

// ============ VISIT MODE ENDPOINTS ============

/**
 * POST /households/:householdId/contractors/visits/:visitId/start
 * Start visit mode
 */
contractorsRouter.post('/visits/:visitId/start', zValidator('json', startVisitModeSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const visitId = c.req.param('visitId');
  const input = c.req.valid('json');
  const service = new ContractorService(c.env, c.env.DB);

  const timestamp = nowIso();

  const visit = await service.updateVisit(householdId, visitId!, userId, {
    status: 'in_progress',
    visit_mode_started_at: input.start_time || timestamp,
    contractor_rep_name: input.contractor_rep_name,
  });

  return c.json({ visit });
});

/**
 * POST /households/:householdId/contractors/visits/:visitId/complete
 * Complete visit and save data
 */
contractorsRouter.post('/visits/:visitId/complete', zValidator('json', completeVisitSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const visitId = c.req.param('visitId');
  const input = c.req.valid('json');
  const service = new ContractorService(c.env, c.env.DB);

  const timestamp = nowIso();

  const visit = await service.updateVisit(householdId, visitId!, userId, {
    status: 'completed',
    visit_mode_ended_at: input.completed_at || timestamp,
    rating: input.rating,
    notes: input.notes,
    voice_recording_key: input.voice_recording_key,
    voice_recording_transcription: input.voice_recording_transcription,
    voice_recording_duration_seconds: input.voice_recording_duration_seconds,
  });

  return c.json({ visit });
});

export default contractorsRouter;
