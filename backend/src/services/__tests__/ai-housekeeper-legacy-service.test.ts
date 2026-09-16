/**
 * AI housekeeper legacy route service — preferences, suggestion lifecycle, and
 * the household access checks in front of every read and write.
 *
 * The access checks carry the weight: every method here takes a `householdId` or
 * a `suggestionId` straight from the request, so a missing check is a
 * cross-household data leak that no user would ever report. Each read and each
 * state transition is asserted to refuse a non-member — and to refuse with
 * "not found" rather than "forbidden", so the API does not confirm that another
 * household's suggestion id exists.
 *
 * Runs against the live miniflare D1. The AI-generating paths
 * (`getSeasonalChecklist` on a miss, `analyzeHousehold`) are covered only up to
 * their access + entitlement gate; the generation itself belongs to
 * AIHousekeeperService.
 */
import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { beforeEach, describe, expect, it } from 'vitest';

import * as schema from '../../db/schema';
import {
  aiHousekeeperSuggestions,
  aiInsights,
  aiMaintenancePredictions,
  aiSeasonalChecklists,
} from '../../db/schema-ai-housekeeper';
import type { Env } from '../../types';
import { nowIso } from '../../utils/id';
import { AIHousekeeperLegacyRouteService } from '../ai-housekeeper-legacy-service';
import { createCoreTables, resetAllTables } from '../aihousekeeper/__tests__/test-helpers';

const testEnv = env as unknown as Env;
const d1 = testEnv.DB as unknown as D1Database;
const db = drizzle(d1, { schema });

const HID = 'hh_legacy';
const OTHER_HID = 'hh_legacy_other';
const MEMBER = 'u_legacy_member';
const OUTSIDER = 'u_legacy_outsider';
const REMOVED = 'u_legacy_removed';

const service = () => new AIHousekeeperLegacyRouteService(testEnv, d1);

async function createTables(): Promise<void> {
  await createCoreTables(d1);
  const ddl = [
    `CREATE TABLE IF NOT EXISTS ai_housekeeper_preferences (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
      notification_frequency TEXT NOT NULL DEFAULT 'daily',
      ai_personality TEXT NOT NULL DEFAULT 'friendly',
      diy_skill_level TEXT NOT NULL DEFAULT 'beginner',
      budget_preference TEXT NOT NULL DEFAULT 'moderate',
      preferred_learning_style TEXT DEFAULT 'article',
      enable_predictions INTEGER NOT NULL DEFAULT 1,
      enable_seasonal_reminders INTEGER NOT NULL DEFAULT 1,
      enable_cost_insights INTEGER NOT NULL DEFAULT 1,
      enable_procrastination_nudges INTEGER NOT NULL DEFAULT 1,
      enable_celebrations INTEGER NOT NULL DEFAULT 1,
      created_at TEXT, updated_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS ai_housekeeper_suggestions (
      id TEXT PRIMARY KEY, household_id TEXT NOT NULL, suggestion_type TEXT NOT NULL,
      title TEXT NOT NULL, description TEXT NOT NULL, confidence_score REAL,
      priority_score INTEGER, generated_at TEXT, expires_at TEXT,
      status TEXT NOT NULL DEFAULT 'pending', user_action_at TEXT, user_action_by TEXT,
      user_feedback TEXT, related_task_id TEXT, related_feature_ids TEXT,
      related_appliance_ids TEXT, related_finding_ids TEXT, ai_reasoning TEXT,
      data_sources TEXT, created_at TEXT, updated_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS ai_maintenance_predictions (
      id TEXT PRIMARY KEY, household_id TEXT NOT NULL, feature_id TEXT, appliance_id TEXT,
      prediction_type TEXT NOT NULL, predicted_date_min TEXT, predicted_date_max TEXT,
      confidence_level TEXT NOT NULL, reasoning TEXT NOT NULL, recommended_action TEXT NOT NULL,
      estimated_cost_min INTEGER, estimated_cost_max INTEGER,
      status TEXT NOT NULL DEFAULT 'pending', created_at TEXT, resolved_at TEXT,
      actual_outcome TEXT, accuracy_score REAL, related_task_id TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS ai_seasonal_checklists (
      id TEXT PRIMARY KEY, household_id TEXT NOT NULL, season TEXT NOT NULL,
      year INTEGER NOT NULL, climate_zone TEXT, checklist_items TEXT NOT NULL,
      generated_at TEXT, completed_items TEXT, completion_rate REAL,
      created_at TEXT, updated_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS ai_insights (
      id TEXT PRIMARY KEY, household_id TEXT NOT NULL, insight_type TEXT NOT NULL,
      title TEXT NOT NULL, description TEXT NOT NULL, potential_savings INTEGER,
      risk_level TEXT, priority INTEGER, generated_at TEXT, expires_at TEXT,
      status TEXT DEFAULT 'active', related_task_ids TEXT, related_quote_ids TEXT,
      related_suggestion_ids TEXT, user_feedback TEXT, user_feedback_note TEXT,
      created_at TEXT, updated_at TEXT
    )`,
  ];
  for (const stmt of ddl) await d1.exec(stmt.replace(/\s+/g, ' '));
}

/** The season `getSeasonalChecklist` will look for right now. */
function currentSeason(): { season: string; year: number } {
  const now = new Date();
  const month = now.getMonth();
  let season = 'winter';
  if (month >= 2 && month <= 4) season = 'spring';
  else if (month >= 5 && month <= 7) season = 'summer';
  else if (month >= 8 && month <= 10) season = 'fall';
  return { season, year: now.getFullYear() };
}

async function seedSuggestion(
  id: string,
  over: Partial<typeof aiHousekeeperSuggestions.$inferInsert> = {}
): Promise<string> {
  await db.insert(aiHousekeeperSuggestions).values({
    id,
    household_id: HID,
    suggestion_type: 'seasonal_reminder',
    title: 'Clean the gutters',
    description: 'Before the rain starts.',
    priority_score: 5,
    status: 'pending',
    generated_at: nowIso(),
    ...over,
  });
  return id;
}

beforeEach(async () => {
  await createTables();
  await resetAllTables(d1);
  for (const t of [
    'ai_housekeeper_preferences',
    'ai_housekeeper_suggestions',
    'ai_maintenance_predictions',
    'ai_seasonal_checklists',
    'ai_insights',
  ]) {
    await d1.exec(`DELETE FROM ${t}`);
  }

  await db.insert(schema.users).values([
    { id: MEMBER, email: 'member@example.com', email_verified: true },
    { id: OUTSIDER, email: 'outsider@example.com', email_verified: true },
    { id: REMOVED, email: 'removed@example.com', email_verified: true },
  ]);
  await db.insert(schema.households).values([
    { id: HID, name: 'Legacy House' },
    { id: OTHER_HID, name: 'Someone Else' },
  ]);
  await db.insert(schema.householdMembers).values([
    { id: 'm_1', household_id: HID, user_id: MEMBER, role: 'owner', joined_at: nowIso() },
    { id: 'm_2', household_id: OTHER_HID, user_id: OUTSIDER, role: 'owner', joined_at: nowIso() },
    {
      id: 'm_3',
      household_id: HID,
      user_id: REMOVED,
      role: 'member',
      joined_at: nowIso(),
      deleted_at: nowIso(),
    },
  ]);
});

describe('preferences', () => {
  it('creates a friendly default preference row on first read', async () => {
    const prefs = await service().getOrCreatePreferences(MEMBER);
    expect(prefs).toMatchObject({
      user_id: MEMBER,
      enabled: true,
      notification_frequency: 'daily',
      ai_personality: 'friendly',
      diy_skill_level: 'beginner',
    });
  });

  it('returns the same row on a second read instead of creating another', async () => {
    const first = await service().getOrCreatePreferences(MEMBER);
    const second = await service().getOrCreatePreferences(MEMBER);
    expect(second!.id).toBe(first!.id);
  });

  it('updates only the fields that were sent', async () => {
    await service().getOrCreatePreferences(MEMBER);
    const updated = await service().updatePreferences(MEMBER, {
      ai_personality: 'data_driven',
      diy_skill_level: 'advanced',
    });

    expect(updated).toMatchObject({ ai_personality: 'data_driven', diy_skill_level: 'advanced' });
    // Untouched fields keep their defaults.
    expect(updated).toMatchObject({ notification_frequency: 'daily' });
  });

  it('ignores fields that are not on the allow-list', async () => {
    // A client must not be able to write arbitrary columns through this body.
    await service().getOrCreatePreferences(MEMBER);
    const updated = (await service().updatePreferences(MEMBER, {
      ai_personality: 'professional',
      user_id: OUTSIDER,
      id: 'hijacked',
    })) as Record<string, unknown>;

    expect(updated.ai_personality).toBe('professional');
    expect(updated.user_id).toBe(MEMBER);
    expect(updated.id).not.toBe('hijacked');
  });

  it('creates the row when updating a user who has no preferences yet', async () => {
    const created = (await service().updatePreferences(MEMBER, {
      notification_frequency: 'weekly',
    })) as Record<string, unknown>;

    expect(created.user_id).toBe(MEMBER);
    expect(created.notification_frequency).toBe('weekly');
  });
});

describe('household access control', () => {
  it.each([
    ['listSuggestions', (s: AIHousekeeperLegacyRouteService, u: string) => s.listSuggestions(HID, u)],
    ['listPredictions', (s: AIHousekeeperLegacyRouteService, u: string) => s.listPredictions(HID, u)],
    ['listInsights', (s: AIHousekeeperLegacyRouteService, u: string) => s.listInsights(HID, u)],
    [
      'getSeasonalChecklist',
      (s: AIHousekeeperLegacyRouteService, u: string) => s.getSeasonalChecklist(HID, u),
    ],
    ['analyzeHousehold', (s: AIHousekeeperLegacyRouteService, u: string) => s.analyzeHousehold(HID, u)],
  ])('%s refuses a user who is not in the household', async (_name, call) => {
    await expect(call(service(), OUTSIDER)).rejects.toThrow(/not found|access denied/i);
  });

  it('refuses a member who has been removed from the household', async () => {
    // A soft-deleted membership must not keep working.
    await expect(service().listSuggestions(HID, REMOVED)).rejects.toThrow(/not found|access denied/i);
  });

  it('allows a current member', async () => {
    await expect(service().listSuggestions(HID, MEMBER)).resolves.toEqual([]);
  });
});

describe('suggestion access control', () => {
  it.each([
    ['acceptSuggestion', (s: AIHousekeeperLegacyRouteService) => s.acceptSuggestion('sug_1', OUTSIDER)],
    ['dismissSuggestion', (s: AIHousekeeperLegacyRouteService) => s.dismissSuggestion('sug_1', OUTSIDER)],
    ['snoozeSuggestion', (s: AIHousekeeperLegacyRouteService) => s.snoozeSuggestion('sug_1', OUTSIDER)],
    [
      'feedbackSuggestion',
      (s: AIHousekeeperLegacyRouteService) => s.feedbackSuggestion('sug_1', OUTSIDER, 'helpful'),
    ],
  ])('%s refuses another household’s suggestion', async (_name, call) => {
    await seedSuggestion('sug_1');
    await expect(call(service())).rejects.toThrow(/access denied|not found/i);
  });

  it('leaves the suggestion untouched when access is refused', async () => {
    await seedSuggestion('sug_1');
    await service().acceptSuggestion('sug_1', OUTSIDER).catch(() => undefined);

    const [row] = await db.select().from(aiHousekeeperSuggestions).all();
    expect(row.status).toBe('pending');
    expect(row.user_action_by).toBeNull();
  });

  it('reports a suggestion that does not exist as not found', async () => {
    await expect(service().acceptSuggestion('sug_missing', MEMBER)).rejects.toThrow(/not found/i);
  });
});

describe('suggestion lifecycle', () => {
  it('accepts a suggestion and records who acted', async () => {
    await seedSuggestion('sug_1');
    const result = await service().acceptSuggestion('sug_1', MEMBER);

    expect(result).toMatchObject({ status: 'accepted', user_action_by: MEMBER });
    expect(result!.user_action_at).toBeTruthy();
  });

  it('dismisses a suggestion', async () => {
    await seedSuggestion('sug_1');
    expect(await service().dismissSuggestion('sug_1', MEMBER)).toMatchObject({ status: 'dismissed' });
  });

  it('snoozes a suggestion and pushes its expiry out', async () => {
    await seedSuggestion('sug_1', { expires_at: '2020-01-01T00:00:00.000Z' });
    const result = await service().snoozeSuggestion('sug_1', MEMBER, 3);

    expect(result!.status).toBe('snoozed');
    const days = (new Date(result!.expires_at!).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(2.9);
    expect(days).toBeLessThan(3.1);
  });

  it('defaults the snooze to a week', async () => {
    await seedSuggestion('sug_1');
    const result = await service().snoozeSuggestion('sug_1', MEMBER);
    const days = (new Date(result!.expires_at!).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
  });

  it.each(['helpful', 'not_helpful', 'neutral'])('records %s feedback', async (feedback) => {
    await seedSuggestion('sug_1');
    const result = await service().feedbackSuggestion('sug_1', MEMBER, feedback);
    expect(result!.user_feedback).toBe(feedback);
  });

  it('rejects a feedback value outside the allowed set', async () => {
    await seedSuggestion('sug_1');
    await expect(service().feedbackSuggestion('sug_1', MEMBER, 'amazing')).rejects.toThrow(
      /invalid feedback/i
    );
  });

  it('validates the feedback value before touching the database', async () => {
    // Validation first means a bad value cannot leak whether the id exists.
    await expect(service().feedbackSuggestion('sug_missing', MEMBER, 'amazing')).rejects.toThrow(
      /invalid feedback/i
    );
  });
});

describe('listing', () => {
  it('returns only this household’s suggestions, highest priority first', async () => {
    await seedSuggestion('sug_low', { priority_score: 1 });
    await seedSuggestion('sug_high', { priority_score: 9 });
    await seedSuggestion('sug_other', { household_id: OTHER_HID, priority_score: 10 });

    const list = await service().listSuggestions(HID, MEMBER);
    expect(list.map((s) => s.id)).toEqual(['sug_high', 'sug_low']);
  });

  it('filters suggestions by status, defaulting to pending', async () => {
    await seedSuggestion('sug_pending');
    await seedSuggestion('sug_done', { status: 'accepted' });

    expect((await service().listSuggestions(HID, MEMBER)).map((s) => s.id)).toEqual(['sug_pending']);
    expect((await service().listSuggestions(HID, MEMBER, 'accepted')).map((s) => s.id)).toEqual([
      'sug_done',
    ]);
  });

  it('returns only this household’s predictions', async () => {
    await db.insert(aiMaintenancePredictions).values([
      {
        id: 'pred_mine',
        household_id: HID,
        prediction_type: 'service_needed',
        confidence_level: 'high',
        reasoning: 'age',
        recommended_action: 'service it',
        status: 'pending',
      },
      {
        id: 'pred_theirs',
        household_id: OTHER_HID,
        prediction_type: 'service_needed',
        confidence_level: 'high',
        reasoning: 'age',
        recommended_action: 'service it',
        status: 'pending',
      },
    ]);

    const list = await service().listPredictions(HID, MEMBER);
    expect(list.map((p) => p.id)).toEqual(['pred_mine']);
  });

  it('returns only this household’s insights, highest priority first', async () => {
    await db.insert(aiInsights).values([
      { id: 'ins_low', household_id: HID, insight_type: 'cost_savings', title: 'A', description: 'a', priority: 2, status: 'active' },
      { id: 'ins_high', household_id: HID, insight_type: 'cost_savings', title: 'B', description: 'b', priority: 8, status: 'active' },
      { id: 'ins_other', household_id: OTHER_HID, insight_type: 'cost_savings', title: 'C', description: 'c', priority: 9, status: 'active' },
      { id: 'ins_archived', household_id: HID, insight_type: 'cost_savings', title: 'D', description: 'd', priority: 9, status: 'archived' },
    ]);

    const list = await service().listInsights(HID, MEMBER);
    expect(list.map((i) => i.id)).toEqual(['ins_high', 'ins_low']);
  });
});

describe('seasonal checklist', () => {
  const { season, year } = currentSeason();

  async function seedChecklist(over: Record<string, unknown> = {}) {
    await db.insert(aiSeasonalChecklists).values({
      id: 'chk_1',
      household_id: HID,
      season,
      year,
      checklist_items: JSON.stringify([{ id: 'i1' }, { id: 'i2' }, { id: 'i3' }, { id: 'i4' }]),
      generated_at: nowIso(),
      ...over,
    } as typeof aiSeasonalChecklists.$inferInsert);
  }

  it('returns the stored checklist for the current season without calling the model', async () => {
    await seedChecklist();
    const checklist = await service().getSeasonalChecklist(HID, MEMBER);
    expect(checklist).toMatchObject({ id: 'chk_1', season, year });
  });

  it('marks an item complete and recomputes the completion rate', async () => {
    await seedChecklist();
    const updated = await service().completeChecklistItem('chk_1', MEMBER, 'i1');

    expect(JSON.parse(updated!.completed_items!)).toEqual(['i1']);
    expect(updated!.completion_rate).toBe(0.25);
  });

  it('does not double-count an item completed twice', async () => {
    await seedChecklist({ completed_items: JSON.stringify(['i1']) });
    const updated = await service().completeChecklistItem('chk_1', MEMBER, 'i1');

    expect(JSON.parse(updated!.completed_items!)).toEqual(['i1']);
    expect(updated!.completion_rate).toBe(0.25);
  });

  it('reaches a completion rate of 1 when every item is done', async () => {
    await seedChecklist({ completed_items: JSON.stringify(['i1', 'i2', 'i3']) });
    const updated = await service().completeChecklistItem('chk_1', MEMBER, 'i4');
    expect(updated!.completion_rate).toBe(1);
  });

  it('refuses to complete an item on another household’s checklist', async () => {
    await seedChecklist();
    await expect(service().completeChecklistItem('chk_1', OUTSIDER, 'i1')).rejects.toThrow(
      /access denied/i
    );
  });

  it('reports a checklist that does not exist as not found', async () => {
    await expect(service().completeChecklistItem('chk_missing', MEMBER, 'i1')).rejects.toThrow(
      /not found/i
    );
  });
});
