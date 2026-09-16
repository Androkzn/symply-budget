import { Hono } from 'hono';

import {
  CONTRACTOR_SEARCH_SYSTEM_PROMPT,
  getSearchPromptForSpecialty,
} from '../ai/prompts/contractor-search';
import { GarbageScheduleAIService } from '../services/garbage-schedule-ai-service';
import type { Env } from '../types';

const dev = new Hono<{ Bindings: Env }>();

// Helper to check if dev routes are allowed
function isDevEnvironment(env: Env): boolean {
  return env.ENVIRONMENT === 'development' || env.ENVIRONMENT === 'staging';
}

/**
 * POST /dev/test-garbage-detect
 * Exercise the AI garbage-schedule detector (web_search) without auth.
 * dev/staging only. TEMPORARY — used to verify web search end-to-end.
 */
dev.post('/test-garbage-detect', async (c) => {
  if (!isDevEnvironment(c.env)) {
    return c.json({ error: 'Only available in development/staging' }, 403);
  }

  const body = await c.req
    .json<{
      address_line1?: string;
      city?: string;
      state_province?: string;
      postal_code?: string;
      country?: string;
    }>()
    .catch(() => ({} as Record<string, string>));

  const address = {
    address_line1: body.address_line1 || '4949 Canada Way',
    city: body.city || 'Burnaby',
    state_province: body.state_province || 'BC',
    postal_code: body.postal_code || 'V5G 1M2',
    country: body.country || 'CA',
  };

  try {
    const { data, usage } = await new GarbageScheduleAIService(c.env).detectFromAddress(address);
    return c.json({ address, result: data, usage });
  } catch (error) {
    return c.json(
      { address, error: error instanceof Error ? error.message : String(error) },
      500
    );
  }
});

/**
 * POST /dev/test-contractor-search
 * Test contractor search AI without authentication (dev/staging only)
 */
dev.post('/test-contractor-search', async (c) => {
  if (!isDevEnvironment(c.env)) {
    return c.json({ error: 'Only available in development/staging' }, 403);
  }

  const body = await c.req.json<{
    specialty?: string;
    city?: string;
    state?: string;
    problem_title?: string;
  }>();

  const specialty = body.specialty || 'plumber';
  const city = body.city || 'Vancouver';
  const state = body.state || 'BC';
  const problemTitle = body.problem_title || 'Leaking faucet';

  const apiKey = c.env.GEMINI_API_KEY;
  if (!apiKey) {
    return c.json({ error: 'GEMINI_API_KEY not configured' }, 500);
  }

  const promptTemplate = getSearchPromptForSpecialty(specialty);
  const prompt = promptTemplate
    .replace(/{specialty}/g, specialty)
    .replace(/{city}/g, city)
    .replace(/{state}/g, state)
    .replace(/{problem_title}/g, problemTitle)
    .replace(/{problem_description}/g, problemTitle);

  const enhancedPrompt = `${CONTRACTOR_SEARCH_SYSTEM_PROMPT}

CRITICAL: Respond ONLY with valid JSON. No markdown, no explanations.

${prompt}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: enhancedPrompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 8192,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return c.json({ error: `Gemini API error: ${response.status}`, details: errorText }, 500);
    }

    const data = await response.json() as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        groundingMetadata?: { webSearchQueries?: string[] };
      }>;
      error?: { message: string };
    };

    if (data.error) {
      return c.json({ error: data.error.message }, 500);
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const groundingQueries = data.candidates?.[0]?.groundingMetadata?.webSearchQueries || [];

    // Extract JSON
    let result;
    try {
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[1].trim());
      } else {
        const objectMatch = text.match(/\{[\s\S]*\}/);
        if (objectMatch) {
          result = JSON.parse(objectMatch[0]);
        } else {
          result = { raw: text };
        }
      }
    } catch {
      result = { raw: text };
    }

    const contractors = result.contractors || [];
    const withRatings = contractors.filter((c: { rating: number }) => c.rating > 0).length;
    const withContact = contractors.filter((c: { phone?: string; email?: string; website?: string }) => 
      c.phone || c.email || c.website
    ).length;

    return c.json({
      success: true,
      search_params: { specialty, city, state, problem_title: problemTitle },
      grounding_queries: groundingQueries,
      contractors_found: contractors.length,
      with_ratings: withRatings,
      with_contact_info: withContact,
      search_summary: result.search_summary || null,
      contractors: contractors.slice(0, 5), // Return first 5 for testing
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: errorMessage }, 500);
  }
});

/**
 * POST /dev/test-pdf-upload
 * Test endpoint to upload a PDF directly to R2 storage
 */
dev.post('/test-pdf-upload', async (c) => {
  if (!isDevEnvironment(c.env)) {
    return c.json({ error: 'Only available in development/staging' }, 403);
  }

  const contentType = c.req.header('content-type') || '';

  if (!contentType.includes('multipart/form-data') && !contentType.includes('application/pdf')) {
    return c.json({ error: 'Content-Type must be multipart/form-data or application/pdf' }, 400);
  }

  let fileData: ArrayBuffer;
  let filename = 'test-report.pdf';

  if (contentType.includes('multipart/form-data')) {
    const formData = await c.req.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return c.json({ error: 'No file provided' }, 400);
    }
    fileData = await file.arrayBuffer();
    filename = file.name;
  } else {
    fileData = await c.req.arrayBuffer();
  }

  const fileKey = `dev-test/${Date.now()}-${filename}`;

  // Upload to R2
  await c.env.REPORTS_BUCKET.put(fileKey, fileData, {
    httpMetadata: {
      contentType: 'application/pdf',
    },
  });

  return c.json({
    success: true,
    file_key: fileKey,
    file_size: fileData.byteLength,
    message: 'File uploaded to R2. Use /dev/test-parse-pdf to parse it.',
  });
});

/**
 * POST /dev/test-pdf-describe
 * Simple test to see what Gemini can see in the PDF
 */
dev.post('/test-pdf-describe', async (c) => {
  if (!isDevEnvironment(c.env)) {
    return c.json({ error: 'Only available in development/staging' }, 403);
  }

  const body = await c.req.json<{ file_key?: string }>();
  const { file_key } = body;

  if (!file_key) {
    return c.json({ error: 'file_key is required' }, 400);
  }

  const object = await c.env.REPORTS_BUCKET.get(file_key);
  if (!object) {
    return c.json({ error: 'File not found in R2' }, 404);
  }

  const pdfData = await object.arrayBuffer();
  const apiKey = c.env.GEMINI_API_KEY;
  if (!apiKey) {
    return c.json({ error: 'GEMINI_API_KEY not configured' }, 500);
  }

  try {
    const displayName = file_key.split('/').pop() || 'report.pdf';
    const fileInfo = await uploadToGeminiFileApi(apiKey, pdfData, 'application/pdf', displayName);

    // Very simple prompt to see what Gemini sees
    const prompt = `Describe what you see in this document. What is on the first page? What is on the second page? How many pages are there? Is there any text you can read? Please be detailed about what you observe.`;

    const result = await callGeminiWithFileUri(apiKey, fileInfo.fileUri, 'application/pdf', prompt);

    return c.json({
      success: true,
      file_key,
      pdf_size_mb: (pdfData.byteLength / 1024 / 1024).toFixed(2),
      gemini_file: fileInfo,
      result,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: errorMessage }, 500);
  }
});

/**
 * POST /dev/test-pdf-fileapi
 * Test endpoint using Gemini File API for large PDFs (up to 100MB+)
 */
dev.post('/test-pdf-fileapi', async (c) => {
  if (!isDevEnvironment(c.env)) {
    return c.json({ error: 'Only available in development/staging' }, 403);
  }

  const body = await c.req.json<{ file_key?: string }>();
  const { file_key } = body;

  if (!file_key) {
    return c.json({ error: 'file_key is required' }, 400);
  }

  // Get file from R2
  const object = await c.env.REPORTS_BUCKET.get(file_key);
  if (!object) {
    return c.json({ error: 'File not found in R2' }, 404);
  }

  const pdfData = await object.arrayBuffer();
  console.log(`PDF size: ${pdfData.byteLength} bytes (${(pdfData.byteLength / 1024 / 1024).toFixed(2)} MB)`);

  const apiKey = c.env.GEMINI_API_KEY;
  if (!apiKey) {
    return c.json({ error: 'GEMINI_API_KEY not configured' }, 500);
  }

  try {
    // Step 1: Upload to Gemini File API
    console.log('Uploading to Gemini File API...');
    const displayName = file_key.split('/').pop() || 'report.pdf';
    const fileInfo = await uploadToGeminiFileApi(apiKey, pdfData, 'application/pdf', displayName);
    console.log('File uploaded:', fileInfo);

    // Step 2: Call Gemini with the file URI
    const prompt = `You are an expert home inspector analyst. Analyze this home inspection report PDF and extract all findings.

For each finding, provide:
1. system_category: One of [roof, foundation, electrical, plumbing, hvac, exterior, interior, safety, appliances, drainage, attic, basement, garage, insulation, windows_doors, structure, other]
2. severity: One of [critical, major, minor, informational]
   - critical: Safety hazard or requires immediate attention
   - major: Should be addressed within 1 year
   - minor: Routine maintenance or cosmetic
   - informational: FYI only, no action needed
3. title: Brief description (max 100 characters)
4. description: Detailed explanation of the issue
5. plain_language_summary: Explain like you're talking to someone with no technical knowledge
6. evidence: Page numbers and quotes from the report supporting this finding
7. confidence: Your confidence in this finding (0.0 to 1.0)

Also extract metadata:
- property_address: The property address if stated
- inspection_date: The inspection date if stated
- inspector_name: The inspector's name if stated
- page_count: Estimated page count

Respond with valid JSON matching this schema:
{
  "metadata": {
    "property_address": "string or null",
    "inspection_date": "string or null",
    "inspector_name": "string or null",
    "page_count": number or null
  },
  "findings": [
    {
      "system_category": "string",
      "severity": "string",
      "title": "string",
      "description": "string",
      "plain_language_summary": "string",
      "evidence": {
        "page_numbers": [number],
        "quotes": ["string"]
      },
      "confidence": number
    }
  ]
}`;

    console.log('Calling Gemini with file URI...');
    const result = await callGeminiWithFileUri(apiKey, fileInfo.fileUri, 'application/pdf', prompt);

    return c.json({
      success: true,
      file_key,
      pdf_size_mb: (pdfData.byteLength / 1024 / 1024).toFixed(2),
      gemini_file: fileInfo,
      result,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error:', errorMessage);
    return c.json({
      success: false,
      error: errorMessage,
      pdf_size_mb: (pdfData.byteLength / 1024 / 1024).toFixed(2),
    }, 500);
  }
});

/**
 * POST /dev/test-pdf-simple
 * Simple test to check if Gemini can read the PDF
 */
dev.post('/test-pdf-simple', async (c) => {
  if (!isDevEnvironment(c.env)) {
    return c.json({ error: 'Only available in development/staging' }, 403);
  }

  const body = await c.req.json<{ file_key?: string }>();
  const { file_key } = body;

  if (!file_key) {
    return c.json({ error: 'file_key is required' }, 400);
  }

  // Get file from R2
  const object = await c.env.REPORTS_BUCKET.get(file_key);
  if (!object) {
    return c.json({ error: 'File not found in R2' }, 404);
  }

  const pdfData = await object.arrayBuffer();
  const base64Pdf = arrayBufferToBase64(pdfData);

  console.log(`PDF size: ${pdfData.byteLength} bytes, base64 length: ${base64Pdf.length}`);

  const apiKey = c.env.GEMINI_API_KEY;
  if (!apiKey) {
    return c.json({ error: 'GEMINI_API_KEY not configured' }, 500);
  }

  // Simple test prompt
  const prompt = `What is this document about? Give me a brief summary of the first few pages. Also tell me:
1. What type of document is this?
2. What is the property address if visible?
3. What is the inspection date if visible?
4. Who is the inspector if visible?

Please respond in JSON format:
{
  "summary": "your summary here",
  "document_type": "type or null",
  "property_address": "address or null",
  "inspection_date": "date or null",
  "inspector": "name or null"
}`;

  try {
    const result = await callGeminiWithPdfNoJsonMode(apiKey, base64Pdf, prompt);
    return c.json({
      success: true,
      file_key,
      pdf_size_bytes: pdfData.byteLength,
      base64_length: base64Pdf.length,
      result,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({
      success: false,
      error: errorMessage,
      pdf_size_bytes: pdfData.byteLength,
      base64_length: base64Pdf.length,
    }, 500);
  }
});

/**
 * POST /dev/test-parse-pdf
 * Test endpoint to parse a PDF from R2 using Gemini multimodal API
 */
dev.post('/test-parse-pdf', async (c) => {
  if (!isDevEnvironment(c.env)) {
    return c.json({ error: 'Only available in development/staging' }, 403);
  }

  const body = await c.req.json<{ file_key?: string }>();
  const { file_key } = body;

  if (!file_key) {
    return c.json({ error: 'file_key is required' }, 400);
  }

  // Get file from R2
  const object = await c.env.REPORTS_BUCKET.get(file_key);
  if (!object) {
    return c.json({ error: 'File not found in R2' }, 404);
  }

  const pdfData = await object.arrayBuffer();
  const base64Pdf = arrayBufferToBase64(pdfData);

  // Call Gemini with the PDF
  const apiKey = c.env.GEMINI_API_KEY;
  if (!apiKey) {
    return c.json({ error: 'GEMINI_API_KEY not configured' }, 500);
  }

  const prompt = `You are an expert home inspector analyst. Analyze this home inspection report PDF and extract all findings.

For each finding, provide:
1. system_category: One of [roof, foundation, electrical, plumbing, hvac, exterior, interior, safety, appliances, drainage, attic, basement, garage, insulation, windows_doors, structure, other]
2. severity: One of [critical, major, minor, informational]
   - critical: Safety hazard or requires immediate attention
   - major: Should be addressed within 1 year
   - minor: Routine maintenance or cosmetic
   - informational: FYI only, no action needed
3. title: Brief description (max 100 characters)
4. description: Detailed explanation of the issue
5. plain_language_summary: Explain like you're talking to someone with no technical knowledge
6. evidence: Page numbers and quotes from the report supporting this finding
7. confidence: Your confidence in this finding (0.0 to 1.0)

Also extract metadata:
- property_address: The property address if stated
- inspection_date: The inspection date if stated
- inspector_name: The inspector's name if stated
- page_count: Estimated page count

Respond with valid JSON matching this schema:
{
  "metadata": {
    "property_address": "string or null",
    "inspection_date": "string or null",
    "inspector_name": "string or null",
    "page_count": number or null
  },
  "findings": [
    {
      "system_category": "string",
      "severity": "string",
      "title": "string",
      "description": "string",
      "plain_language_summary": "string",
      "evidence": {
        "page_numbers": [number],
        "quotes": ["string"]
      },
      "confidence": number
    }
  ]
}`;

  try {
    const result = await callGeminiWithPdf(apiKey, base64Pdf, prompt);
    return c.json({
      success: true,
      file_key,
      result,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({
      success: false,
      error: errorMessage,
    }, 500);
  }
});

/**
 * GET /dev/list-r2-files
 * List files in R2 bucket
 */
dev.get('/list-r2-files', async (c) => {
  if (!isDevEnvironment(c.env)) {
    return c.json({ error: 'Only available in development/staging' }, 403);
  }

  const prefix = c.req.query('prefix') || '';
  const listed = await c.env.REPORTS_BUCKET.list({ prefix, limit: 100 });

  return c.json({
    objects: listed.objects.map((obj) => ({
      key: obj.key,
      size: obj.size,
      uploaded: obj.uploaded.toISOString(),
    })),
    truncated: listed.truncated,
  });
});

/**
 * Helper to convert ArrayBuffer to base64
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Call Gemini API with PDF data (multimodal)
 */
async function callGeminiWithPdf(
  apiKey: string,
  base64Pdf: string,
  prompt: string
): Promise<unknown> {
  // Using gemini-2.5-flash for multimodal PDF processing (better PDF support)
  const model = 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              inline_data: {
                mime_type: 'application/pdf',
                data: base64Pdf,
              },
            },
            {
              text: prompt,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
        }>;
      };
    }>;
    error?: { message: string };
  };

  if (data.error) {
    throw new Error(`Gemini API error: ${data.error.message}`);
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('No response text from Gemini');
  }

  // Log raw response for debugging
  console.log('Gemini raw response:', text);

  // Try to parse as JSON
  try {
    return JSON.parse(text);
  } catch {
    // Return raw text if not valid JSON
    return { raw_response: text };
  }
}

/**
 * Upload file to Gemini File API (for large files up to 2GB)
 * This is required for files larger than ~20MB
 */
async function uploadToGeminiFileApi(
  apiKey: string,
  fileData: ArrayBuffer,
  mimeType: string,
  displayName: string
): Promise<{ fileUri: string; name: string }> {
  // Step 1: Start resumable upload
  const startUrl = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`;

  const startResponse = await fetch(startUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(fileData.byteLength),
      'X-Goog-Upload-Header-Content-Type': mimeType,
    },
    body: JSON.stringify({
      file: {
        display_name: displayName,
      },
    }),
  });

  if (!startResponse.ok) {
    const errorText = await startResponse.text();
    throw new Error(`Failed to start upload: ${startResponse.status} - ${errorText}`);
  }

  const uploadUrl = startResponse.headers.get('X-Goog-Upload-URL');
  if (!uploadUrl) {
    throw new Error('No upload URL returned from Gemini');
  }

  // Step 2: Upload the file data
  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Length': String(fileData.byteLength),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: fileData,
  });

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text();
    throw new Error(`Failed to upload file: ${uploadResponse.status} - ${errorText}`);
  }

  const result = await uploadResponse.json() as {
    file?: {
      uri: string;
      name: string;
      mimeType: string;
      sizeBytes: string;
      state: string;
    };
  };

  if (!result.file?.uri) {
    throw new Error('No file URI returned from upload');
  }

  // Step 3: Wait for file to be processed (state: ACTIVE)
  let fileState = result.file.state;
  let attempts = 0;
  const maxAttempts = 30; // Wait up to 30 seconds

  while (fileState !== 'ACTIVE' && attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 1000));

    const statusUrl = `https://generativelanguage.googleapis.com/v1beta/${result.file.name}?key=${apiKey}`;
    const statusResponse = await fetch(statusUrl);

    if (statusResponse.ok) {
      const statusData = await statusResponse.json() as { state: string };
      fileState = statusData.state;
    }
    attempts++;
  }

  if (fileState !== 'ACTIVE') {
    throw new Error(`File not ready after ${maxAttempts} seconds, state: ${fileState}`);
  }

  return {
    fileUri: result.file.uri,
    name: result.file.name,
  };
}

/**
 * Call Gemini API with file URI (for large files)
 */
async function callGeminiWithFileUri(
  apiKey: string,
  fileUri: string,
  mimeType: string,
  prompt: string
): Promise<unknown> {
  const model = 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              file_data: {
                mime_type: mimeType,
                file_uri: fileUri,
              },
            },
            {
              text: prompt,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 8192,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
        }>;
      };
    }>;
    error?: { message: string };
  };

  if (data.error) {
    throw new Error(`Gemini API error: ${data.error.message}`);
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('No response text from Gemini');
  }

  console.log('Gemini response with File API:', text.substring(0, 500));

  // Try to extract JSON from the response
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1].trim());
    } catch {
      // Continue to try other methods
    }
  }

  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      return JSON.parse(objectMatch[0]);
    } catch {
      // Return raw text
    }
  }

  return { raw_response: text };
}

/**
 * Call Gemini API with PDF data (without forced JSON mode - for debugging)
 */
async function callGeminiWithPdfNoJsonMode(
  apiKey: string,
  base64Pdf: string,
  prompt: string
): Promise<unknown> {
  const model = 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              inline_data: {
                mime_type: 'application/pdf',
                data: base64Pdf,
              },
            },
            {
              text: prompt,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 8192,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
        }>;
      };
    }>;
    error?: { message: string };
  };

  if (data.error) {
    throw new Error(`Gemini API error: ${data.error.message}`);
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('No response text from Gemini');
  }

  console.log('Gemini raw response (no JSON mode):', text);

  // Try to extract JSON from the response
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1].trim());
    } catch {
      // Continue to try other methods
    }
  }

  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      return JSON.parse(objectMatch[0]);
    } catch {
      // Return raw text
    }
  }

  return { raw_response: text };
}

/**
 * POST /dev/test-voice-session
 * Smoke-test the OpenAI Realtime ephemeral-token mint from the Worker
 * without requiring JWT + household membership. Dev/staging only.
 * Remove once voice mode is stable.
 */
dev.post('/test-voice-session', async (c) => {
  if (!isDevEnvironment(c.env)) {
    return c.json({ error: 'Only available in development/staging' }, 403);
  }
  if (!c.env.OPENAI_API_KEY) {
    return c.json({ error: 'OPENAI_API_KEY not configured' }, 500);
  }

  const model = c.env.AIHOUSEKEEPER_REALTIME_MODEL || 'gpt-realtime';
  const voice = c.env.AIHOUSEKEEPER_REALTIME_VOICE || 'marin';
  const sessionConfig = {
    type: 'realtime',
    model,
    instructions: 'Smoke test session — not for production use.',
    output_modalities: ['audio'],
    audio: {
      input: {
        transcription: { model: 'gpt-4o-transcribe' },
        noise_reduction: { type: 'near_field' },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500,
          create_response: true,
          interrupt_response: true,
        },
      },
      output: { voice },
    },
    tools: [
      {
        type: 'function',
        name: 'ask_aihousekeeper',
        description: 'bridge',
        parameters: {
          type: 'object',
          properties: { user_text: { type: 'string' } },
          required: ['user_text'],
          additionalProperties: false,
        },
      },
    ],
    tool_choice: 'required',
  };

  const res = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${c.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ session: sessionConfig }),
  });

  const text = await res.text();
  if (!res.ok) {
    return c.json({ ok: false, status: res.status, body: text.slice(0, 1000) }, 502);
  }
  const data = JSON.parse(text) as {
    value?: string;
    expires_at?: number;
    session?: { id?: string; model?: string };
  };
  return c.json({
    ok: true,
    model,
    voice,
    // Never return the real secret — just prove it exists.
    client_secret_prefix: data.value ? `${data.value.slice(0, 6)}…` : null,
    client_secret_length: data.value?.length ?? 0,
    expires_at: data.expires_at,
    session_id: data.session?.id ?? null,
    session_model: data.session?.model ?? null,
  });
});

export default dev;
