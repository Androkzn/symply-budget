import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { VISIT_NOTE_TYPES } from '../db/schema-labor-hub';
import { authMiddleware } from '../middleware/auth';
import { VisitNotesService } from '../services/visit-notes-service';
import type { Env } from '../types';

const visitNotesRouter = new Hono<{ Bindings: Env }>();

// All routes require authentication
visitNotesRouter.use('/*', authMiddleware());

// Helper to get householdId from parent route param
function getHouseholdId(c: { req: { param: (key: string) => string | undefined } }): string {
  const householdId = c.req.param('householdId');
  if (!householdId) throw new Error('Household ID is required');
  return householdId;
}

// Helper to get visitId from parent route param
function getVisitId(c: { req: { param: (key: string) => string | undefined } }): string {
  const visitId = c.req.param('visitId');
  if (!visitId) throw new Error('Visit ID is required');
  return visitId;
}

// ============ VALIDATION SCHEMAS ============

const createNoteSchema = z.object({
  type: z.enum(VISIT_NOTE_TYPES),
  content: z.string().max(10000).optional(),
  transcription: z.string().max(10000).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
});

const createTextNoteSchema = z.object({
  content: z.string().min(1).max(10000),
  tags: z.array(z.string().max(50)).max(20).optional(),
});

const createPhotoNoteSchema = z.object({
  photo_key: z.string().min(1),
  tags: z.array(z.string().max(50)).max(20).optional(),
});

const createVoiceNoteSchema = z.object({
  audio_key: z.string().min(1),
  transcription: z.string().max(10000).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
});

const updateNoteSchema = z.object({
  content: z.string().max(10000).optional(),
  transcription: z.string().max(10000).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
});

const addTranscriptionSchema = z.object({
  transcription: z.string().min(1).max(10000),
});

const tagsSchema = z.object({
  tags: z.array(z.string().max(50)).min(1).max(20),
});

const searchSchema = z.object({
  query: z.string().min(1).max(200),
});

const filterSchema = z.object({
  type: z.enum(VISIT_NOTE_TYPES).optional(),
  tag: z.string().max(50).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

// ============ VISIT NOTES ROUTES ============

/**
 * GET /households/:householdId/visits/:visitId/notes
 * Get all notes for a visit
 */
visitNotesRouter.get('/', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const visitId = getVisitId(c);
  const service = new VisitNotesService(c.env, c.env.DB);

  const notes = await service.getNotesForVisit(householdId, visitId, userId);

  return c.json({ notes });
});

/**
 * GET /households/:householdId/visits/:visitId/notes/grouped
 * Get notes grouped by type
 */
visitNotesRouter.get('/grouped', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const visitId = getVisitId(c);
  const service = new VisitNotesService(c.env, c.env.DB);

  const grouped = await service.getNotesGroupedByType(householdId, visitId, userId);

  return c.json({ grouped });
});

/**
 * GET /households/:householdId/visits/:visitId/notes/timeline
 * Get notes as a timeline
 */
visitNotesRouter.get('/timeline', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const visitId = getVisitId(c);
  const service = new VisitNotesService(c.env, c.env.DB);

  const timeline = await service.getNotesTimeline(householdId, visitId, userId);

  return c.json({ timeline });
});

/**
 * GET /households/:householdId/visits/:visitId/notes/:noteId
 * Get single note
 */
visitNotesRouter.get('/:noteId', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const noteId = c.req.param('noteId');
  const service = new VisitNotesService(c.env, c.env.DB);

  const note = await service.getNote(householdId, noteId!, userId);

  return c.json({ note });
});

/**
 * POST /households/:householdId/visits/:visitId/notes
 * Create a generic note
 */
visitNotesRouter.post('/', zValidator('json', createNoteSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const visitId = getVisitId(c);
  const input = c.req.valid('json');
  const service = new VisitNotesService(c.env, c.env.DB);

  const note = await service.createNote(householdId, visitId, userId, {
    type: input.type,
    content: input.content,
    transcription: input.transcription,
    tags: input.tags,
  });

  return c.json({ note }, 201);
});

/**
 * POST /households/:householdId/visits/:visitId/notes/text
 * Create text note (convenience endpoint)
 */
visitNotesRouter.post('/text', zValidator('json', createTextNoteSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const visitId = getVisitId(c);
  const input = c.req.valid('json');
  const service = new VisitNotesService(c.env, c.env.DB);

  const note = await service.createTextNote(householdId, visitId, userId, input.content, input.tags);

  return c.json({ note }, 201);
});

/**
 * POST /households/:householdId/visits/:visitId/notes/photo
 * Create photo note (convenience endpoint)
 */
visitNotesRouter.post('/photo', zValidator('json', createPhotoNoteSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const visitId = getVisitId(c);
  const input = c.req.valid('json');
  const service = new VisitNotesService(c.env, c.env.DB);

  const note = await service.createPhotoNote(householdId, visitId, userId, input.photo_key, input.tags);

  return c.json({ note }, 201);
});

/**
 * POST /households/:householdId/visits/:visitId/notes/voice
 * Create voice note (convenience endpoint)
 */
visitNotesRouter.post('/voice', zValidator('json', createVoiceNoteSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const visitId = getVisitId(c);
  const input = c.req.valid('json');
  const service = new VisitNotesService(c.env, c.env.DB);

  const note = await service.createVoiceNote(
    householdId,
    visitId,
    userId,
    input.audio_key,
    input.transcription,
    input.tags
  );

  return c.json({ note }, 201);
});

/**
 * PATCH /households/:householdId/visits/:visitId/notes/:noteId
 * Update note
 */
visitNotesRouter.patch('/:noteId', zValidator('json', updateNoteSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const noteId = c.req.param('noteId');
  const input = c.req.valid('json');
  const service = new VisitNotesService(c.env, c.env.DB);

  const note = await service.updateNote(householdId, noteId!, userId, {
    content: input.content,
    transcription: input.transcription,
    tags: input.tags,
  });

  return c.json({ note });
});

/**
 * POST /households/:householdId/visits/:visitId/notes/:noteId/transcription
 * Add transcription to voice note
 */
visitNotesRouter.post('/:noteId/transcription', zValidator('json', addTranscriptionSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const noteId = c.req.param('noteId');
  const input = c.req.valid('json');
  const service = new VisitNotesService(c.env, c.env.DB);

  const note = await service.addTranscription(householdId, noteId!, userId, input.transcription);

  return c.json({ note });
});

/**
 * POST /households/:householdId/visits/:visitId/notes/:noteId/tags
 * Add tags to note
 */
visitNotesRouter.post('/:noteId/tags', zValidator('json', tagsSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const noteId = c.req.param('noteId');
  const input = c.req.valid('json');
  const service = new VisitNotesService(c.env, c.env.DB);

  const note = await service.addTags(householdId, noteId!, userId, input.tags);

  return c.json({ note });
});

/**
 * DELETE /households/:householdId/visits/:visitId/notes/:noteId/tags
 * Remove tags from note
 */
visitNotesRouter.delete('/:noteId/tags', zValidator('json', tagsSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const noteId = c.req.param('noteId');
  const input = c.req.valid('json');
  const service = new VisitNotesService(c.env, c.env.DB);

  const note = await service.removeTags(householdId, noteId!, userId, input.tags);

  return c.json({ note });
});

/**
 * DELETE /households/:householdId/visits/:visitId/notes/:noteId
 * Delete note
 */
visitNotesRouter.delete('/:noteId', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const noteId = c.req.param('noteId');
  const service = new VisitNotesService(c.env, c.env.DB);

  await service.deleteNote(householdId, noteId!, userId);

  return c.body(null, 204);
});

export default visitNotesRouter;

// ============ HOUSEHOLD-LEVEL NOTES ROUTER ============
// This router is for household-wide note operations

export const householdNotesRouter = new Hono<{ Bindings: Env }>();

householdNotesRouter.use('/*', authMiddleware());

/**
 * GET /households/:householdId/notes
 * Get all notes for household with optional filters
 */
householdNotesRouter.get('/', zValidator('query', filterSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = c.req.param('householdId');
  if (!householdId) throw new Error('Household ID is required');

  const filters = c.req.valid('query');
  const service = new VisitNotesService(c.env, c.env.DB);

  const notes = await service.getNotesForHousehold(householdId, userId, {
    type: filters.type,
    tag: filters.tag,
    limit: filters.limit,
  });

  return c.json({ notes });
});

/**
 * GET /households/:householdId/notes/search
 * Search notes
 */
householdNotesRouter.get('/search', zValidator('query', searchSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = c.req.param('householdId');
  if (!householdId) throw new Error('Household ID is required');

  const { query } = c.req.valid('query');
  const service = new VisitNotesService(c.env, c.env.DB);

  const notes = await service.searchNotes(householdId, userId, query);

  return c.json({ notes });
});
