/**
 * aihousekeeper-chat.ts — smoke coverage for the tool-registry-wired chat endpoint.
 *
 * We stub Claude's `generate()` so the test doesn't hit the Anthropic API,
 * then assert that the route:
 *   1. Rejects unauthenticated requests (authMiddleware).
 *   2. Accepts a valid mode + messages shape and returns the canned response.
 *   3. Executes an inline tool (`remember`) when the stub emits a tool_use,
 *      then loops with the tool_result and returns the follow-up text.
 *
 * The goal is to pin the route's contract — not to test Claude's reasoning.
 */

import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import * as jose from 'jose';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { ClaudeProvider } from '../../ai/claude-provider';
import * as schema from '../../db/schema';
import {
  createAihousekeeperTables,
  createCoreTables,
  resetAllTables,
} from '../../services/aihousekeeper/__tests__/test-helpers';
import type { Env } from '../../types';
import aihousekeeperChatRouter from '../aihousekeeper-chat';


const testEnv = env as unknown as Env;
const HID = 'hh_chat_01';
const UID = 'u_chat_01';

async function mintToken(userId: string): Promise<string> {
  const secret = new TextEncoder().encode(
    testEnv.JWT_SECRET || 'test-jwt-secret-32-chars-minimum'
  );
  return new jose.SignJWT({
    sub: userId,
    email: `${userId}@example.com`,
    email_verified: true,
  } as unknown as jose.JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .setIssuer(testEnv.JWT_ISSUER || 'simple-house')
    .setAudience(testEnv.JWT_AUDIENCE || 'simple-house-app')
    .sign(secret);
}

function mkApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/households/:householdId/aihousekeeper/chat', aihousekeeperChatRouter);
  app.onError((error, c) => {
    const apiErrorNames = [
      'ApiError',
      'ValidationError',
      'UnauthorizedError',
      'ForbiddenError',
      'NotFoundError',
      'ConflictError',
      'RateLimitError',
    ];
    const errorName = (error as Error).name;
    if (apiErrorNames.includes(errorName)) {
      const apiError = error as unknown as {
        code: string;
        message: string;
        details?: unknown;
        statusCode: number;
      };
      return c.json(
        { error: { code: apiError.code, message: apiError.message } },
        apiError.statusCode as 400 | 401 | 403 | 404 | 409 | 500
      );
    }
    return c.json({ error: { code: 'internal', message: error.message } }, 500);
  });
  return app;
}

async function seed(): Promise<void> {
  await createCoreTables(testEnv.DB);
  await createAihousekeeperTables(testEnv.DB);
  await resetAllTables(testEnv.DB);
  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.users).values({
    id: UID,
    email: 'chatter@example.com',
    email_verified: true,
  });
  await db.insert(schema.households).values({
    id: HID,
    name: 'Chat Test',
    address_line1: '8135 138 st',
    city: 'Surrey',
    state_province: 'BC',
    country: 'CA',
  });
  await db.insert(schema.householdMembers).values({
    id: 'm_chat_owner',
    household_id: HID,
    user_id: UID,
    role: 'owner',
    joined_at: '2025-01-01T00:00:00Z',
  });
  await db.insert(schema.assistantIdentity).values({ household_id: HID });
  await testEnv.CONFIG_KV.put('aihousekeeper_memory_ai_redaction_enabled', 'false');
}

describe('aihousekeeper-chat route', () => {
  beforeEach(async () => {
    await seed();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('401s on missing Authorization', async () => {
    const app = mkApp();
    const res = await app.request(
      `/households/${HID}/aihousekeeper/chat`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'task_assistant', messages: [] }),
      },
      testEnv
    );
    expect(res.status).toBe(401);
  });

  it('returns the assistant text for a simple end_turn (no tool calls)', async () => {
    const spy = vi
      .spyOn(ClaudeProvider.prototype, 'generate')
      .mockResolvedValue({
        content: [{ type: 'text', text: 'Got it — nothing pressing today.' }],
        stopReason: 'end_turn',
        model: 'claude-haiku-test',
      });

    const token = await mintToken(UID);
    const app = mkApp();
    const res = await app.request(
      `/households/${HID}/aihousekeeper/chat`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: 'task_assistant',
          messages: [
            { role: 'user', content: "What's up today?" },
          ],
        }),
      },
      testEnv
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      response: { role: string; content: Array<{ type: string; text?: string }> };
      tool_results: unknown[];
      stop_reason: string;
    };
    expect(body.response.role).toBe('assistant');
    expect(body.response.content[0]?.type).toBe('text');
    expect(body.stop_reason).toBe('end_turn');
    expect(body.tool_results).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('executes an inline tool_use (remember) and loops to produce a final text response', async () => {
    // First call: model emits a tool_use for `remember`.
    // Second call: model emits a final text turn after seeing tool_result.
    const spy = vi
      .spyOn(ClaudeProvider.prototype, 'generate')
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool_use',
            id: 'tu_01',
            name: 'remember',
            input: {
              type: 'fact',
              body: 'user prefers morning reminders',
              confidence: 0.9,
            },
          },
        ],
        stopReason: 'tool_use',
        model: 'claude-haiku-test',
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: "Noted — I'll lean morning." }],
        stopReason: 'end_turn',
        model: 'claude-haiku-test',
      });

    const token = await mintToken(UID);
    const app = mkApp();
    const res = await app.request(
      `/households/${HID}/aihousekeeper/chat`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: 'task_assistant',
          messages: [
            {
              role: 'user',
              content: 'Please remember I prefer morning reminders.',
            },
          ],
        }),
      },
      testEnv
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      response: { content: Array<{ type: string; text?: string }> };
      tool_results: Array<{ tool_use_id: string; name: string; result: { ok: boolean } }>;
      stop_reason: string;
    };
    expect(body.stop_reason).toBe('end_turn');
    expect(body.tool_results).toHaveLength(1);
    expect(body.tool_results[0].name).toBe('remember');
    expect(body.tool_results[0].result.ok).toBe(true);
    expect(body.response.content[0]?.type).toBe('text');
    expect(body.response.content[0]?.text).toContain('morning');
    // The route called generate twice: initial turn + post-tool-result turn.
    expect(spy).toHaveBeenCalledTimes(2);

    // Memory row was actually written — the tool executed, not just logged.
    const db = drizzle(testEnv.DB, { schema });
    const memories = await db
      .select()
      .from(schema.assistantMemory)
      .all();
    expect(memories.length).toBe(1);
    expect(memories[0].body).toContain('morning reminders');
  });

  it('starts the garden plan flow with upload guidance after map preview removal', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const spy = vi
      .spyOn(ClaudeProvider.prototype, 'generate')
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool_use',
            id: 'tu_garden_flow',
            name: 'start_garden_plan_flow',
            input: {
              address_line: '8135 138 st Surrey BC',
            },
          },
        ],
        stopReason: 'tool_use',
        model: 'claude-haiku-test',
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: 'Upload a yard photo in Gardening or describe your garden for a concept plan.',
          },
        ],
        stopReason: 'end_turn',
        model: 'claude-haiku-test',
      });

    const token = await mintToken(UID);
    const app = mkApp();
    const res = await app.request(
      `/households/${HID}/aihousekeeper/chat`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: 'task_assistant',
          messages: [
            {
              role: 'user',
              content: 'Create a garden plan for 8135 138 st Surrey BC',
            },
          ],
        }),
      },
      testEnv
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      tool_results: Array<{
        name: string;
        result: {
          ok: boolean;
          status?: string;
          ui?: {
            type: string;
            actions: Array<{
              label: string;
              action: {
                type: string;
                screen: string;
              };
            }>;
          };
        };
      }>;
    };
    expect(body.tool_results).toHaveLength(1);
    expect(body.tool_results[0].name).toBe('start_garden_plan_flow');
    expect(body.tool_results[0].result.ok).toBe(true);
    expect(body.tool_results[0].result.status).toBe('garden_plan_map_preview_removed');
    expect(body.tool_results[0].result.ui?.type).toBe('action_row');
    expect(body.tool_results[0].result.ui?.actions[0].label).toBe('Upload yard photo');
    expect(body.tool_results[0].result.ui?.actions[0].action.screen).toBe('GardenPlanUpload');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('starts the garden plan flow from the saved home address when no address is provided', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const spy = vi
      .spyOn(ClaudeProvider.prototype, 'generate')
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool_use',
            id: 'tu_garden_saved_home',
            name: 'start_garden_plan_flow',
            input: {},
          },
        ],
        stopReason: 'tool_use',
        model: 'claude-haiku-test',
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Upload a yard photo in Gardening.' }],
        stopReason: 'end_turn',
        model: 'claude-haiku-test',
      });

    const token = await mintToken(UID);
    const app = mkApp();
    const res = await app.request(
      `/households/${HID}/aihousekeeper/chat`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: 'task_assistant',
          messages: [{ role: 'user', content: 'Create a garden plan' }],
        }),
      },
      testEnv
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      tool_results: Array<{ result: { ok: boolean; status?: string } }>;
    };
    expect(body.tool_results[0].result.ok).toBe(true);
    expect(body.tool_results[0].result.status).toBe('garden_plan_map_preview_removed');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('asks the user to pick a saved home when multiple homes have addresses', async () => {
    const db = drizzle(testEnv.DB, { schema });
    await db.insert(schema.households).values({
      id: 'hh_chat_02',
      name: 'Cabin',
      address_line1: '100 Lake Road',
      city: 'Whistler',
      state_province: 'BC',
      country: 'CA',
    });
    await db.insert(schema.householdMembers).values({
      id: 'm_chat_cabin',
      household_id: 'hh_chat_02',
      user_id: UID,
      role: 'owner',
      joined_at: '2025-01-01T00:00:00Z',
    });

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    vi.spyOn(ClaudeProvider.prototype, 'generate')
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool_use',
            id: 'tu_garden_select_home',
            name: 'start_garden_plan_flow',
            input: {},
          },
        ],
        stopReason: 'tool_use',
        model: 'claude-haiku-test',
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Which home should I use?' }],
        stopReason: 'end_turn',
        model: 'claude-haiku-test',
      });

    const token = await mintToken(UID);
    const app = mkApp();
    const res = await app.request(
      `/households/${HID}/aihousekeeper/chat`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: 'task_assistant',
          messages: [{ role: 'user', content: 'Create a garden plan' }],
        }),
      },
      testEnv
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      tool_results: Array<{
        result: {
          ok: boolean;
          status?: string;
          ui?: { actions: Array<{ label: string; action: { type: string; text?: string } }> };
        };
      }>;
    };
    expect(body.tool_results[0].result.ok).toBe(true);
    expect(body.tool_results[0].result.status).toBe('garden_plan_select_home');
    expect(body.tool_results[0].result.ui?.actions).toHaveLength(2);
    expect(body.tool_results[0].result.ui?.actions[0].action.type).toBe('send_message');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('suggests creating a house property when only non-house properties are saved', async () => {
    const db = drizzle(testEnv.DB, { schema });
    await db
      .update(schema.households)
      .set({
        name: 'Rental condo',
        address_line1: '6837 Station Hill Dr',
        city: 'Burnaby',
        state_province: 'BC',
        country: 'CA',
      })
      .where(eq(schema.households.id, HID));

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    vi.spyOn(ClaudeProvider.prototype, 'generate')
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool_use',
            id: 'tu_garden_no_house',
            name: 'start_garden_plan_flow',
            input: {},
          },
        ],
        stopReason: 'tool_use',
        model: 'claude-haiku-test',
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Create your first house property first.' }],
        stopReason: 'end_turn',
        model: 'claude-haiku-test',
      });

    const token = await mintToken(UID);
    const app = mkApp();
    const res = await app.request(
      `/households/${HID}/aihousekeeper/chat`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: 'task_assistant',
          messages: [{ role: 'user', content: 'Create a garden plan' }],
        }),
      },
      testEnv
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      tool_results: Array<{
        result: {
          ok: boolean;
          status?: string;
          ui?: { actions: Array<{ label: string; action: { screen: string } }> };
        };
      }>;
    };
    expect(body.tool_results[0].result.ok).toBe(true);
    expect(body.tool_results[0].result.status).toBe(
      'garden_plan_needs_first_property'
    );
    expect(body.tool_results[0].result.ui?.actions[0].label).toBe(
      'Create house property'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('hallucination guard: sends garden approval claims to the boundary flow', async () => {
    // Model invents an old chat-approval claim for a garden plan. Garden plan
    // approvals are no longer created from chat, so the guard should scrub the
    // misleading approval text and point to the Gardening boundary flow.
    const spy = vi.spyOn(ClaudeProvider.prototype, 'generate');
    spy.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: 'I will create a Front yard garden plan for you. It is now pending approval in Aihousekeeper approvals.',
        },
      ],
      stopReason: 'end_turn',
      model: 'claude-haiku-test',
    });

    const token = await mintToken(UID);
    const app = mkApp();
    const res = await app.request(
      `/households/${HID}/aihousekeeper/chat`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: 'family_chat',
          messages: [
            { role: 'user', content: 'Garden front yard plan create' },
          ],
        }),
      },
      testEnv
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      response: { content: Array<{ type: string; text?: string }> };
      tool_results: unknown[];
    };
    const text = body.response.content
      .map((b) => b.text ?? '')
      .join(' ');
    expect(text).not.toMatch(/pending approval/i);
    expect(text).not.toMatch(/aihousekeeper approvals/i);
    expect(text).toMatch(/Gardening -> \+ Add Yard or Garden Plan/i);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('hallucination guard: ignores benign text that does not claim a park', async () => {
    // Negative case: the assistant talks about garden plans but does NOT
    // claim a parked approval. Guard must not interfere.
    const spy = vi
      .spyOn(ClaudeProvider.prototype, 'generate')
      .mockResolvedValue({
        content: [
          {
            type: 'text',
            text: "I can help with a garden plan. Which yard area would you like — front or back?",
          },
        ],
        stopReason: 'end_turn',
        model: 'claude-haiku-test',
      });

    const token = await mintToken(UID);
    const app = mkApp();
    const res = await app.request(
      `/households/${HID}/aihousekeeper/chat`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: 'family_chat',
          messages: [
            { role: 'user', content: 'Garden plan?' },
          ],
        }),
      },
      testEnv
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      response: { content: Array<{ type: string; text?: string }> };
    };
    const text = body.response.content
      .map((b) => b.text ?? '')
      .join(' ');
    expect(text).toMatch(/which yard area/i);
    // No retry — only the original generate call.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid mode at the zod layer (400)', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const res = await app.request(
      `/households/${HID}/aihousekeeper/chat`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: 'not_a_real_mode',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      },
      testEnv
    );
    expect(res.status).toBe(400);
  });
});
