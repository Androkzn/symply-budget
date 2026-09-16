import { Hono } from 'hono';

import { authMiddleware } from '../middleware/auth';
import { AIHousekeeperLegacyRouteService } from '../services/ai-housekeeper-legacy-service';
import type { Env } from '../types';

const app = new Hono<{ Bindings: Env }>();

app.use('*', authMiddleware());

function service(c: { env: Env }) {
  return new AIHousekeeperLegacyRouteService(c.env, c.env.DB);
}

app.get('/preferences', async (c) => {
  const prefs = await service(c).getOrCreatePreferences(c.get('userId'));
  return c.json(prefs);
});

app.put('/preferences', async (c) => {
  const body = await c.req.json();
  const prefs = await service(c).updatePreferences(c.get('userId'), body);
  return c.json(prefs);
});

app.get('/households/:householdId/suggestions', async (c) => {
  const suggestions = await service(c).listSuggestions(
    c.req.param('householdId')!,
    c.get('userId'),
    c.req.query('status') || 'pending'
  );
  return c.json(suggestions);
});

app.post('/suggestions/:suggestionId/accept', async (c) => {
  const updated = await service(c).acceptSuggestion(c.req.param('suggestionId')!, c.get('userId'));
  return c.json(updated);
});

app.post('/suggestions/:suggestionId/dismiss', async (c) => {
  const updated = await service(c).dismissSuggestion(c.req.param('suggestionId')!, c.get('userId'));
  return c.json(updated);
});

app.post('/suggestions/:suggestionId/snooze', async (c) => {
  const body = await c.req.json();
  const updated = await service(c).snoozeSuggestion(
    c.req.param('suggestionId')!,
    c.get('userId'),
    body.days ?? 7
  );
  return c.json(updated);
});

app.post('/suggestions/:suggestionId/feedback', async (c) => {
  const body = await c.req.json();
  const updated = await service(c).feedbackSuggestion(
    c.req.param('suggestionId')!,
    c.get('userId'),
    body.feedback
  );
  return c.json(updated);
});

app.get('/households/:householdId/predictions', async (c) => {
  const predictions = await service(c).listPredictions(
    c.req.param('householdId')!,
    c.get('userId'),
    c.req.query('status') || 'pending'
  );
  return c.json(predictions);
});

app.get('/households/:householdId/seasonal-checklist', async (c) => {
  const checklist = await service(c).getSeasonalChecklist(
    c.req.param('householdId')!,
    c.get('userId')
  );
  return c.json(checklist);
});

app.post('/seasonal-checklist/:checklistId/complete-item', async (c) => {
  const body = await c.req.json();
  const updated = await service(c).completeChecklistItem(
    c.req.param('checklistId')!,
    c.get('userId'),
    body.itemId
  );
  return c.json(updated);
});

app.get('/households/:householdId/insights', async (c) => {
  const insights = await service(c).listInsights(
    c.req.param('householdId')!,
    c.get('userId'),
    c.req.query('status') || 'active'
  );
  return c.json(insights);
});

app.post('/households/:householdId/analyze', async (c) => {
  const results = await service(c).analyzeHousehold(c.req.param('householdId')!, c.get('userId'));
  return c.json(results);
});

export default app;
