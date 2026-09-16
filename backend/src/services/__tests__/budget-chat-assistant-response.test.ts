/**
 * BUDGET-BCHAT-ASSISTANT-RESPONSE — response-quality coverage for the dedicated
 * AI assistant chat room (the shared {@link ChatRoomServiceCore} assistant
 * reply pipeline).
 *
 * These tests drive the WHOLE reply loop with a scripted AI provider (the model
 * is mocked, so we control exactly what it "returns") to prove the assistant
 * produces the RIGHT SHAPE of reply for each case:
 *   - a plain member message in the assistant room is answered with NO @assistant
 *     mention (the defining behavior of the dedicated room);
 *   - the tool-use loop runs the app's tool and attaches its UI block(s)
 *     (stats / chart cards) to the AI message's `metadata.ui`;
 *   - a budget-mutating tool sets `metadata.budgetMutated` so the client refetches;
 *   - live per-turn context (buildContext) and the system prompt are fed to the model;
 *   - an empty model turn degrades to a friendly notice instead of silence;
 *   - the AI reply is billed to the household's own key via provider 'anthropic';
 *   - a NON-assistant room stays mention-gated (control): a plain message there is
 *     NOT auto-answered.
 *
 * We instantiate the core directly with a synthetic config so the tools/runTool
 * outputs are deterministic — the real Budget toolset is covered separately in
 * budget-assistant-tools tests. Runs against miniflare D1 (project convention).
 */
import { env } from 'cloudflare:test';
import { desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GenerateResult } from '../../ai/provider';
import * as schema from '../../db/schema';
import type { Env } from '../../types';
import { AIAccessError } from '../../utils/errors';
import { createCoreTables, resetAllTables } from '../aihousekeeper/__tests__/test-helpers';
import {
  ChatRoomServiceCore,
  type ChatAssistantToolContext,
  type ChatAssistantToolReturn,
  type ChatBackendConfig,
  type ChatTables,
} from '../chat/chat-room-service-core';

// ---- AI + entitlement mocks (the model is scripted per test) ----------------
const mockAssertCanUseAI = vi.fn();
const mockResolveProviderApiKey = vi.fn();
// Each provider.generate() call shifts the next scripted result off this queue.
let genQueue: GenerateResult[] = [];
// Records the args of every generate() call so we can assert prompt wiring.
const genCalls: Array<Record<string, unknown>> = [];

vi.mock('../entitlement-service', () => ({
  assertCanUseAI: (...args: unknown[]) => mockAssertCanUseAI(...args),
}));
vi.mock('../ai-credential-resolver', () => ({
  resolveProviderApiKey: (...args: unknown[]) => mockResolveProviderApiKey(...args),
  hasUsableProviderKey: async (...args: unknown[]) => {
    const { apiKey } = await mockResolveProviderApiKey(...args);
    return apiKey.length > 0;
  },
}));
vi.mock('../ai-usage-service', () => ({
  usageRecorderFor: () => () => {},
}));
// NOTE: the core imports createProviderAdapter from ai/provider-factory (not
// ai/provider) — mock the factory or the real Anthropic client is hit.
vi.mock('../../ai/provider-factory', () => ({
  createProviderAdapter: (cfg: { provider: string }) => ({
    provider: cfg.provider,
    generate: vi.fn(async (req: Record<string, unknown>) => {
      genCalls.push(req);
      const next = genQueue.shift();
      return (
        next ?? { content: [{ type: 'text', text: 'ok' }], stopReason: 'end_turn', model: 'test' }
      );
    }),
  }),
}));

const testEnv = env as unknown as Env;
const HID = 'hh_assistant_resp';
const OWNER = 'u_owner';

// ---- Synthetic assistant capability with deterministic tools ----------------
const STATS_TOOL = 'show_stats';
const CHART_TOOL = 'show_chart';
const ADD_EXPENSE_TOOL = 'add_expense';

// Track tool invocations so we can assert the loop actually dispatched them.
const toolCalls: Array<{ name: string; input: Record<string, unknown> }> = [];

const runTool = vi.fn(
  async (
    _ctx: ChatAssistantToolContext,
    call: { name: string; input: Record<string, unknown> }
  ): Promise<ChatAssistantToolReturn> => {
    toolCalls.push(call);
    switch (call.name) {
      case STATS_TOOL:
        return {
          result: 'Here are your stats.',
          ui: [{ kind: 'stats', stats: [{ label: 'Spent', value: '$210', tone: 'neutral' }] }],
        };
      case CHART_TOOL:
        return {
          result: 'Chart ready.',
          ui: [
            {
              kind: 'chart',
              chart: {
                type: 'pie',
                title: 'By category',
                valueFormat: 'currency',
                data: [{ label: 'Groceries', value: 210 }],
              },
            },
          ],
        };
      case ADD_EXPENSE_TOOL:
        return { result: 'Added $12.00 to Groceries.', budgetMutated: true };
      default:
        return 'ok';
    }
  }
);

const buildContext = vi.fn(async () => 'Live budget: $600 planned, $210 spent this month.');

function assistantConfig(): ChatBackendConfig {
  const budgetTables = {
    rooms: schema.budgetChatRooms,
    messages: schema.budgetChatMessages,
    participants: schema.budgetChatRoomParticipants,
    reads: schema.budgetChatRoomReads,
  } as unknown as ChatTables;
  const tool = (name: string) => ({
    name,
    description: `test ${name}`,
    input_schema: { type: 'object', properties: {} },
  });
  return {
    tables: budgetTables,
    notif: {
      messageType: 'budget_chat_message',
      mentionType: 'budget_chat_mention',
      referenceType: 'budget_chat_room',
      screen: 'BudgetChatRoom',
    },
    r2Prefix: 'budget-chat-images',
    usageFeature: 'budget_chat_assistant',
    assistantPrompt: 'You are the Budget assistant. TEST_SYSTEM_PROMPT.',
    logTag: 'budget-chat',
    dedicatedAssistantRoom: { name: 'AI Budget Assistant' },
    assistant: {
      triggerOnImageAttachment: true,
      tools: [tool(STATS_TOOL), tool(CHART_TOOL), tool(ADD_EXPENSE_TOOL)],
      buildContext,
      runTool,
    },
  };
}

function service(): ChatRoomServiceCore {
  return new ChatRoomServiceCore(testEnv, testEnv.DB, assistantConfig());
}

function collector() {
  const pending: Promise<unknown>[] = [];
  return { waitUntil: (p: Promise<unknown>) => pending.push(p), flush: () => Promise.all(pending) };
}

async function createBudgetChatTables(): Promise<void> {
  await testEnv.DB.exec(
    `CREATE TABLE IF NOT EXISTS budget_chat_rooms (id TEXT PRIMARY KEY, household_id TEXT NOT NULL, name TEXT NOT NULL, created_by TEXT NOT NULL, ai_enabled INTEGER NOT NULL DEFAULT 1, is_default INTEGER NOT NULL DEFAULT 0, is_assistant INTEGER NOT NULL DEFAULT 0, subject_type TEXT, subject_id TEXT, subject_parent_id TEXT, subject_label TEXT, subject_parent_label TEXT, subject_context_json TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), archived_at TEXT)`
  );
  await testEnv.DB.exec(
    `CREATE TABLE IF NOT EXISTS budget_chat_messages (id TEXT PRIMARY KEY, room_id TEXT NOT NULL, household_id TEXT NOT NULL, sender_type TEXT NOT NULL, sender_user_id TEXT, body TEXT NOT NULL, metadata_json TEXT, attachments_json TEXT, edited_at TEXT, deleted_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`
  );
  await testEnv.DB.exec(
    `CREATE TABLE IF NOT EXISTS budget_chat_room_participants (room_id TEXT NOT NULL, user_id TEXT NOT NULL, added_by TEXT, added_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (room_id, user_id))`
  );
  await testEnv.DB.exec(
    `CREATE TABLE IF NOT EXISTS budget_chat_room_reads (room_id TEXT NOT NULL, user_id TEXT NOT NULL, last_read_message_id TEXT, last_read_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (room_id, user_id))`
  );
}

async function seed(): Promise<void> {
  const ts = new Date().toISOString();
  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.users).values({
    id: OWNER,
    email: 'owner@example.com',
    display_name: 'Owner',
    created_at: ts,
    updated_at: ts,
  } as never);
  await db.insert(schema.households).values({
    id: HID,
    name: 'Chat House',
    created_at: ts,
    updated_at: ts,
  } as never);
  await db.insert(schema.householdMembers).values({
    id: 'm_o',
    household_id: HID,
    user_id: OWNER,
    role: 'owner',
    joined_at: ts,
  } as never);
}

const db = drizzle(testEnv.DB, { schema });

/** The AI messages persisted in a room, newest first. */
async function aiMessages(roomId: string) {
  return db
    .select()
    .from(schema.budgetChatMessages)
    .where(eq(schema.budgetChatMessages.room_id, roomId))
    .orderBy(desc(schema.budgetChatMessages.created_at))
    .all()
    .then((rows) => rows.filter((r) => r.sender_type === 'ai'));
}

async function assistantRoomId(): Promise<string> {
  const rooms = await service().listRooms(HID, OWNER);
  return rooms.find((r) => r.is_assistant)!.id;
}

/** Post a member message to the assistant room and run the scheduled reply. */
async function ask(roomId: string, body: string) {
  const c = collector();
  await service().postMessage(HID, OWNER, roomId, { body }, c.waitUntil);
  await c.flush();
}

describe('dedicated assistant room — response quality', () => {
  beforeEach(async () => {
    await resetAllTables(testEnv.DB);
    await createCoreTables(testEnv.DB);
    await createBudgetChatTables();
    // miniflare D1 persists rows across tests; clear the chat tables so counts
    // start clean each case.
    await testEnv.DB.exec('DELETE FROM budget_chat_messages');
    await testEnv.DB.exec('DELETE FROM budget_chat_rooms');
    await testEnv.DB.exec('DELETE FROM budget_chat_room_participants');
    await testEnv.DB.exec('DELETE FROM budget_chat_room_reads');
    await seed();
    vi.clearAllMocks();
    genQueue = [];
    genCalls.length = 0;
    toolCalls.length = 0;
    mockAssertCanUseAI.mockResolvedValue(undefined);
    mockResolveProviderApiKey.mockResolvedValue({ apiKey: 'sk-test' });
    testEnv.ANTHROPIC_API_KEY = 'platform-key';
  });

  it('answers a plain message with NO @assistant mention', async () => {
    genQueue = [
      { content: [{ type: 'text', text: 'You spent $210 this month.' }], stopReason: 'end_turn', model: 'test' },
    ];
    const roomId = await assistantRoomId();

    await ask(roomId, 'how much did I spend?'); // note: no @assistant

    const ai = await aiMessages(roomId);
    expect(ai).toHaveLength(1);
    expect(ai[0].body).toBe('You spent $210 this month.');
    // The reply carries the model tag in metadata and NO mention flag.
    const meta = JSON.parse(ai[0].metadata_json ?? '{}');
    expect(meta.model).toBeTruthy();
    expect(meta.mentionsAssistant).toBeUndefined();
  });

  it('feeds the system prompt + live per-turn context to the model', async () => {
    genQueue = [{ content: [{ type: 'text', text: 'ok' }], stopReason: 'end_turn', model: 'test' }];
    const roomId = await assistantRoomId();

    await ask(roomId, 'status?');

    expect(buildContext).toHaveBeenCalled();
    expect(genCalls[0].systemPrompt).toContain('TEST_SYSTEM_PROMPT');
    // The first user message embeds the transcript + the injected context block.
    const firstUserText = JSON.stringify(genCalls[0].messages);
    expect(firstUserText).toContain('Live budget: $600 planned');
  });

  it('runs the tool-use loop and attaches the tool UI block (stats card)', async () => {
    genQueue = [
      // Turn 1: the model asks for the stats tool.
      {
        content: [{ type: 'tool_use', id: 't1', name: STATS_TOOL, input: {} }],
        stopReason: 'tool_use',
        model: 'test',
      },
      // Turn 2: after the tool_result, the model writes its final prose.
      { content: [{ type: 'text', text: 'Here is your spending.' }], stopReason: 'end_turn', model: 'test' },
    ];
    const roomId = await assistantRoomId();

    await ask(roomId, 'show me my stats');

    expect(toolCalls.map((t) => t.name)).toContain(STATS_TOOL);
    const ai = await aiMessages(roomId);
    expect(ai).toHaveLength(1);
    expect(ai[0].body).toBe('Here is your spending.');
    const meta = JSON.parse(ai[0].metadata_json ?? '{}');
    expect(meta.ui).toEqual([
      { kind: 'stats', stats: [{ label: 'Spent', value: '$210', tone: 'neutral' }] },
    ]);
  });

  it('renders a chart UI block returned by a tool', async () => {
    genQueue = [
      { content: [{ type: 'tool_use', id: 'c1', name: CHART_TOOL, input: {} }], stopReason: 'tool_use', model: 'test' },
      { content: [{ type: 'text', text: 'Your category breakdown:' }], stopReason: 'end_turn', model: 'test' },
    ];
    const roomId = await assistantRoomId();

    await ask(roomId, 'break down my spending');

    const meta = JSON.parse((await aiMessages(roomId))[0].metadata_json ?? '{}');
    expect(meta.ui?.[0]?.kind).toBe('chart');
    expect(meta.ui?.[0]?.chart?.type).toBe('pie');
    expect(meta.ui?.[0]?.chart?.data?.[0]).toEqual({ label: 'Groceries', value: 210 });
  });

  it('flags budgetMutated when a mutating tool runs (client refetch signal)', async () => {
    genQueue = [
      { content: [{ type: 'tool_use', id: 'a1', name: ADD_EXPENSE_TOOL, input: { amount: 12 } }], stopReason: 'tool_use', model: 'test' },
      { content: [{ type: 'text', text: 'Logged $12 for groceries.' }], stopReason: 'end_turn', model: 'test' },
    ];
    const roomId = await assistantRoomId();

    await ask(roomId, 'add $12 groceries');

    const meta = JSON.parse((await aiMessages(roomId))[0].metadata_json ?? '{}');
    expect(meta.budgetMutated).toBe(true);
  });

  it('renders a UI-only reply (chart, no prose) rather than dropping it', async () => {
    genQueue = [
      { content: [{ type: 'tool_use', id: 'c1', name: CHART_TOOL, input: {} }], stopReason: 'tool_use', model: 'test' },
      // Model returns NO text on its final turn — the chart card is the answer.
      { content: [], stopReason: 'end_turn', model: 'test' },
    ];
    const roomId = await assistantRoomId();

    await ask(roomId, 'just show the chart');

    const ai = await aiMessages(roomId);
    expect(ai).toHaveLength(1);
    const meta = JSON.parse(ai[0].metadata_json ?? '{}');
    expect(meta.ui?.[0]?.kind).toBe('chart');
  });

  it('degrades a fully-empty model turn to a friendly notice, never silence', async () => {
    genQueue = [{ content: [], stopReason: 'end_turn', model: 'test' }];
    const roomId = await assistantRoomId();

    await ask(roomId, 'hello?');

    const ai = await aiMessages(roomId);
    expect(ai).toHaveLength(1);
    expect(ai[0].body).toMatch(/wasn.t able to produce a reply/i);
    const meta = JSON.parse(ai[0].metadata_json ?? '{}');
    expect(meta.notice).toBe(true);
  });

  it('bills the reply through provider "anthropic" via the resolved key', async () => {
    genQueue = [{ content: [{ type: 'text', text: 'ok' }], stopReason: 'end_turn', model: 'test' }];
    const roomId = await assistantRoomId();

    await ask(roomId, 'hi');

    expect(mockResolveProviderApiKey).toHaveBeenCalledWith(testEnv, OWNER, 'anthropic');
  });

  it('answers EVERY message in the room (a follow-up also gets a reply)', async () => {
    genQueue = [
      { content: [{ type: 'text', text: 'first reply' }], stopReason: 'end_turn', model: 'test' },
      { content: [{ type: 'text', text: 'second reply' }], stopReason: 'end_turn', model: 'test' },
    ];
    const roomId = await assistantRoomId();

    await ask(roomId, 'question one');
    await ask(roomId, 'question two');

    const ai = await aiMessages(roomId);
    expect(ai).toHaveLength(2);
    expect(ai.map((m) => m.body).sort()).toEqual(['first reply', 'second reply']);
  });

  it('CONTROL: a plain message in a NON-assistant room is NOT auto-answered', async () => {
    genQueue = [{ content: [{ type: 'text', text: 'should not appear' }], stopReason: 'end_turn', model: 'test' }];
    // A normal room the user creates — mention-gated, not the dedicated room.
    const room = await service().createRoom(HID, OWNER, { name: 'Bills', ai_enabled: true });

    await ask(room.id, 'how much did I spend?'); // no @assistant → no reply

    expect(await aiMessages(room.id)).toHaveLength(0);
  });

  it('surfaces an entitlement gate as a notice instead of silence', async () => {
    mockAssertCanUseAI.mockRejectedValue(AIAccessError.fromReason('AI_ACCESS_REQUIRED'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const roomId = await assistantRoomId();

    await ask(roomId, 'help me budget');

    const ai = await aiMessages(roomId);
    expect(ai).toHaveLength(1);
    expect(ai[0].body).toMatch(/AI access isn.t available/i);
    // The model was never called — the gate short-circuits before generate().
    expect(mockResolveProviderApiKey).not.toHaveBeenCalled();
  });
});
