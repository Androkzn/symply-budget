/**
 * The photos reach the model.
 *
 * They were plumbed end to end from the first version — uploaded by the client,
 * resolved to R2 keys by the route, carried on the queue message — and then the
 * job told the model only how MANY there were. The pictures are what settle
 * as-is state, which is the whole reason the feature exists, so "wired but
 * never read" was the gap worth closing and is the one worth guarding.
 *
 * These assert the REQUEST, not the answer: what matters is that image blocks
 * are attached, that a missing object degrades instead of failing, and that the
 * model is told the number it can actually see.
 */
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { createHomeProjectTables } from '../../../routes/__tests__/home-projects-test-schema';
import type { Env, HomeProjectSmartDraftMessage } from '../../../types';
import {
  createCoreTables,
  resetAllTables,
} from '../../aihousekeeper/__tests__/test-helpers';

/** Every request the provider received, so the tests can inspect what was sent. */
let calls: Array<Record<string, unknown>> = [];
/** R2 keys this bucket will answer for; anything else returns null. */
let presentKeys = new Set<string>();

const GENERATION = {
  title: 'Shed interior finish',
  as_is: [{ element: 'roof', state: 'present', evidence: 'plank deck visible' }],
  phases: [{ title: 'Insulation', sort_order: 0 }],
};

vi.mock('../../entitlement-service', () => ({
  assertCanUseAI: async (..._args: unknown[]) => {},
}));
vi.mock('../../ai-credential-resolver', () => ({
  resolveProviderApiKey: async () => ({ apiKey: 'k', provider: 'anthropic' }),
  hasUsableProviderKey: async () => true,
}));
vi.mock('../../ai-usage-service', () => ({ usageRecorderFor: () => () => {} }));
vi.mock('../../../ai/provider-factory', () => ({
  createProviderAdapter: () => ({
    provider: 'anthropic',
    generate: async (req: Record<string, unknown>) => {
      calls.push(req);
      return {
        content: [{ type: 'tool_use', name: 'output', input: GENERATION }],
        stopReason: 'tool_use',
        model: 'test',
      };
    },
  }),
}));
vi.mock('../../notification-service', () => ({
  NotificationService: class {
    async sendNotification(): Promise<void> {}
  },
}));

const { handleHomeProjectSmartDraftJob } = await import(
  '../home-project-smart-draft-job-handler'
);

const base = env as unknown as Env;
const HID = 'hh_photos';
const UID = 'u_photos';
const PROJECT_ID = 'p_photos';
const DRAFT_ID = 'd_photos';

/** One-pixel JPEG, enough to be real bytes without being a real photo. */
const PIXEL = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0xff, 0xd9]);

const testEnv = {
  ...base,
  REPORTS_BUCKET: {
    get: async (key: string) =>
      presentKeys.has(key)
        ? {
            arrayBuffer: async () => PIXEL.buffer.slice(0),
            httpMetadata: { contentType: key.endsWith('.png') ? 'image/png' : 'image/jpeg' },
          }
        : null,
  },
} as unknown as Env;

function message(keys: string[]): HomeProjectSmartDraftMessage {
  return {
    draftId: DRAFT_ID,
    projectId: PROJECT_ID,
    householdId: HID,
    userId: UID,
    attachmentR2Keys: keys,
    enqueuedAt: 0,
  };
}

function imagesIn(call: Record<string, unknown>): Array<Record<string, unknown>> {
  const messages = call.messages as Array<{ content: Array<Record<string, unknown>> }>;
  return messages[0].content.filter(b => b.type === 'image');
}

function textIn(call: Record<string, unknown>): string {
  const messages = call.messages as Array<{ content: Array<Record<string, unknown>> }>;
  return messages[0].content
    .filter(b => b.type === 'text')
    .map(b => b.text as string)
    .join('\n');
}

beforeEach(async () => {
  calls = [];
  presentKeys = new Set();
  await createCoreTables(base.DB);
  await createHomeProjectTables(base.DB);
  await resetAllTables(base.DB);
  for (const t of [
    'home_project_as_is', 'home_project_smart_drafts', 'home_project_phases',
    'home_project_option_groups', 'home_project_selections', 'home_project_blockers',
    'home_project_budget_lines', 'home_project_geometry', 'home_projects',
  ]) {
    await base.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await base.DB.prepare(
    `INSERT INTO home_projects (id, household_id, title, type, status, visibility, created_by, created_at, updated_at)
     VALUES (?, ?, 'Drafting…', 'renovation', 'planning', 'draft', ?, datetime('now'), datetime('now'))`
  ).bind(PROJECT_ID, HID, UID).run();
  await base.DB.prepare(
    `INSERT INTO home_project_smart_drafts (id, project_id, status, description, created_by, created_at, updated_at)
     VALUES (?, ?, 'generating', 'A shed with a roof and a concrete floor to finish inside.', ?, datetime('now'), datetime('now'))`
  ).bind(DRAFT_ID, PROJECT_ID, UID).run();
});

const opts = { attempt: 1, maxAttempts: 3 };

describe('photos reach the model', () => {
  it('attaches an image block per photo, not just a count', async () => {
    presentKeys = new Set(['r2/a.jpg', 'r2/b.jpg', 'r2/c.jpg']);
    const outcome = await handleHomeProjectSmartDraftJob(
      testEnv, message(['r2/a.jpg', 'r2/b.jpg', 'r2/c.jpg']), opts
    );
    expect(outcome.kind).toBe('completed');

    const images = imagesIn(calls[0]);
    expect(images).toHaveLength(3);
    for (const img of images) {
      const source = img.source as Record<string, string>;
      expect(source.type).toBe('base64');
      expect(source.data.length).toBeGreaterThan(0);
    }
  });

  it('sends no image blocks when there are no photos', async () => {
    await handleHomeProjectSmartDraftJob(testEnv, message([]), opts);
    expect(imagesIn(calls[0])).toHaveLength(0);
  });

  /**
   * The member cannot fix an R2 miss, and four photos still beat none.
   */
  it('skips a photo that will not load rather than failing the draft', async () => {
    presentKeys = new Set(['r2/a.jpg']); // 'r2/gone.jpg' is absent
    const outcome = await handleHomeProjectSmartDraftJob(
      testEnv, message(['r2/a.jpg', 'r2/gone.jpg']), opts
    );
    expect(outcome.kind).toBe('completed');
    expect(imagesIn(calls[0])).toHaveLength(1);
  });

  /**
   * Telling the model about a picture it cannot see invites it to describe one.
   */
  it('tells the model the number it can actually see, not the number requested', async () => {
    presentKeys = new Set(['r2/a.jpg']);
    await handleHomeProjectSmartDraftJob(
      testEnv, message(['r2/a.jpg', 'r2/gone.jpg', 'r2/also-gone.jpg']), opts
    );
    expect(textIn(calls[0])).toContain('1 photo');
  });

  it('carries the declared media type through', async () => {
    presentKeys = new Set(['r2/shot.png']);
    await handleHomeProjectSmartDraftJob(testEnv, message(['r2/shot.png']), opts);
    const source = imagesIn(calls[0])[0].source as Record<string, string>;
    expect(source.media_type).toBe('image/png');
  });

  it('caps at eight, however many were sent', async () => {
    const keys = Array.from({ length: 12 }, (_, i) => `r2/${i}.jpg`);
    presentKeys = new Set(keys);
    await handleHomeProjectSmartDraftJob(testEnv, message(keys), opts);
    expect(imagesIn(calls[0]).length).toBeLessThanOrEqual(8);
  });

  /**
   * A forced tool, not free-form prose — the parser must not have to guess.
   */
  it('forces the output tool so the answer is structured', async () => {
    presentKeys = new Set(['r2/a.jpg']);
    await handleHomeProjectSmartDraftJob(testEnv, message(['r2/a.jpg']), opts);
    expect(calls[0].toolChoice).toEqual({ type: 'tool', name: 'output' });
    const tools = calls[0].tools as Array<{ name: string }>;
    expect(tools[0].name).toBe('output');
  });

  it('still records what the photos established as as-is state', async () => {
    presentKeys = new Set(['r2/a.jpg']);
    await handleHomeProjectSmartDraftJob(testEnv, message(['r2/a.jpg']), opts);
    const row = await base.DB.prepare(
      "SELECT state, evidence FROM home_project_as_is WHERE project_id = ? AND element = 'roof'"
    ).bind(PROJECT_ID).first<{ state: string; evidence: string }>();
    expect(row).toMatchObject({ state: 'present', evidence: 'plank deck visible' });
  });
});
