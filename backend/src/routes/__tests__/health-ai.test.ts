/**
 * Symply Health P3 AI routes (`src/routes/health-ai.ts`) — the coach, the label
 * and meal scanners, and the body-insight producer, driven through the real Hono
 * router against a live miniflare D1.
 *
 * THE MODEL IS ALWAYS MOCKED. `ai/provider-factory` is replaced wholesale, so no
 * case in this file can reach a real provider — including the ones that assert
 * what happens on a timeout or a refusal.
 *
 * Same three load-bearing layers as the other Health suites:
 *   1. BRAND GATE — `requireHealthApi()` 404s every path on House/Budget/Kaizen,
 *      BEFORE the token check.
 *   2. AUTH — every path is 401 without a valid bearer.
 *   3. USER SCOPING — health data is PERSONAL: user B must never read user A's
 *      consent, ledger receipt or insight.
 *
 * On top of that this suite owns the rules that make an AI surface dangerous to
 * get wrong:
 *   - ESCALATION runs FIRST, before consent, before entitlement, before any
 *     model call. The donor's own LLM path skips its matcher entirely, so this
 *     is scored as a hard negative on the provider mock.
 *   - CONSENT is deny-by-default and is checked before a single health row is
 *     read, let alone sent anywhere. The donor auto-grants five scopes.
 *   - FAIL CLOSED — no entitlement, no credential, a thrown provider, an empty
 *     turn: none of them may produce a reply. `reply` comes back null every
 *     time, and no member-facing string ever carries a provider error.
 *   - The COACH NEVER WRITES. A proposal only becomes a row when the person
 *     echoes back the hash they were shown.
 */

import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import * as jose from 'jose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GenerateArgs, GenerateResult } from '../../ai/provider';
// The REAL hash function, used the way a hostile client would use it: it is a
// public checksum, not a signature, so a forged proposal can always carry a
// matching one. See coach-proposals.ts.
import { payloadHash } from '../../services/health-ai/coach-proposals';
import { COACH_CONSENT_VERSION } from '../../services/health-ai/coach-service';
import type { Env } from '../../types';
import healthAiRoutes from '../health-ai';

import {
  createBodyExtrasTables,
  createHealthAiTables,
  createHealthTables,
  resetBodyExtrasTables,
  resetHealthAiTables,
  resetHealthTables,
  seedHealthUsers,
} from './health-test-helpers';

/* ------------------------- provider + entitlement mocks ------------------ */

/** Scripted model turns; each `generate()` shifts the next one off. */
let genQueue: Array<GenerateResult | Error> = [];
const genCalls: GenerateArgs[] = [];
/**
 * Scripted `generateStructured()` results — the body-insight producer's path.
 * Left null so the default is a bland, grounded, number-free sentence.
 */
let structuredQueue: Array<unknown | Error> = [];
/** false → "no credential configured", the fail-closed path. */
let providerAvailable = true;
/**
 * Set → `createAnthropicAdapterForUser` THROWS. A BYOK lease that cannot be
 * read, or a malformed stored key, gets here; the router must fall back to
 * "no provider" rather than let the throw escape as a 500.
 */
let providerConstructionError: Error | null = null;

vi.mock('../../ai/provider-factory', () => ({
  createAnthropicAdapterForUser: async () => {
    if (providerConstructionError) throw providerConstructionError;
    return {
      name: 'mock',
      isAvailable: () => providerAvailable,
      generate: async (args: GenerateArgs): Promise<GenerateResult> => {
        genCalls.push(args);
        const next = genQueue.shift();
        if (next instanceof Error) throw next;
        return (
          next ?? { content: [{ type: 'text', text: 'ok' }], stopReason: 'end_turn', model: 'mock' }
        );
      },
      generateStructured: async <T,>(): Promise<T> => {
        const next = structuredQueue.shift();
        if (next instanceof Error) throw next;
        return (next ??
          ({ observations: ['Your log covers a few dates.'], what_to_log_next: [] })) as T;
      },
    };
  },
}));

/** Thrown by `assertCanUseAI` when a case wants the denial path. */
let entitlementError: Error | null = null;
vi.mock('../../services/entitlement-service', () => ({
  assertCanUseAI: async () => {
    if (entitlementError) throw entitlementError;
    return { allowed: true, source: 'simplehouse', provider: 'anthropic' };
  },
}));

/* ------------------------------- harness -------------------------------- */

const testEnv = env as unknown as Env;
const HEALTH_ENV = { ...testEnv, APP_BRAND: 'symply-health' } as Env;
const HOUSE_ENV = { ...testEnv, APP_BRAND: 'symply-house' } as Env;
const BUDGET_ENV = { ...testEnv, APP_BRAND: 'symply-budget' } as Env;
const KAIZEN_ENV = { ...testEnv, APP_BRAND: 'symply-kaizen' } as Env;

const UID_A = 'u_ai_alice';
const UID_B = 'u_ai_bob';
const TODAY = '2026-07-25';

async function mintToken(userId: string): Promise<string> {
  const secret = new TextEncoder().encode(
    testEnv.JWT_SECRET ?? 'test-jwt-secret-32-chars-minimum'
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

function appFor(bindings: Env) {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/health', healthAiRoutes);
  return (path: string, init?: RequestInit) =>
    app.request(`http://local/health${path}`, init, bindings);
}

let tokenA = '';
let tokenB = '';

async function call(
  path: string,
  init: RequestInit = {},
  opts: { token?: string | null; bindings?: Env } = {}
) {
  const token = opts.token === undefined ? tokenA : opts.token;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return appFor(opts.bindings ?? HEALTH_ENV)(path, { ...init, headers });
}

function post(path: string, body: unknown, opts?: { token?: string | null; bindings?: Env }) {
  return call(path, { method: 'POST', body: JSON.stringify(body) }, opts);
}

/** Grant the coach consent for a user. */
async function grantConsent(token: string) {
  const res = await call(
    '/ai/coach/consent',
    { method: 'PUT', body: JSON.stringify({ granted: true }) },
    { token }
  );
  expect(res.status).toBe(200);
}

/** A real JPEG signature, padded past the sniffer's 24-char prefix decode. */
const JPEG_B64 = (() => {
  const bytes = [0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 32 }, () => 0)];
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
})();

const HEIC_B64 = (() => {
  const bytes = [
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
    ...Array.from({ length: 32 }, () => 0),
  ];
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
})();

function toolTurn(name: string, input: unknown, text = ''): GenerateResult {
  return {
    content: [
      ...(text ? [{ type: 'text' as const, text }] : []),
      { type: 'tool_use' as const, id: 'tu1', name, input },
    ],
    stopReason: 'tool_use',
    model: 'mock',
  };
}

function textTurn(text: string): GenerateResult {
  return { content: [{ type: 'text', text }], stopReason: 'end_turn', model: 'mock' };
}

beforeEach(async () => {
  await createHealthTables(testEnv.DB);
  await createBodyExtrasTables(testEnv.DB);
  await createHealthAiTables(testEnv.DB);
  await resetHealthAiTables(testEnv.DB);
  await resetBodyExtrasTables(testEnv.DB);
  await resetHealthTables(testEnv.DB);
  await seedHealthUsers(testEnv.DB, [UID_A, UID_B]);
  tokenA = await mintToken(UID_A);
  tokenB = await mintToken(UID_B);
  genQueue = [];
  structuredQueue = [];
  genCalls.length = 0;
  providerAvailable = true;
  entitlementError = null;
  providerConstructionError = null;
});

/* ============================== BRAND + AUTH ============================= */

describe('Symply Health AI — brand gate and auth', () => {
  const PATHS: Array<[string, string]> = [
    ['GET', '/ai/coach/consent'],
    ['PUT', '/ai/coach/consent'],
    ['POST', '/ai/coach/turn'],
    ['POST', '/ai/coach/commit'],
    ['GET', '/ai/coach/operations'],
    ['POST', '/ai/nutrition-label'],
    ['POST', '/ai/meal-photo'],
    ['POST', '/ai/body-insights/generate'],
  ];

  /** GET/HEAD cannot carry a body — `new Request` throws before Hono is reached. */
  function sweep(method: string, path: string, opts: { token?: string | null; bindings?: Env }) {
    return call(path, method === 'GET' ? { method } : { method, body: '{}' }, opts);
  }

  it.each([
    ['House', HOUSE_ENV],
    ['Budget', BUDGET_ENV],
    ['Kaizen', KAIZEN_ENV],
  ])('HEALTH-AI-100: 404s every AI route on %s', async (_name, bindings) => {
    for (const [method, path] of PATHS) {
      const res = await sweep(method, path, { bindings });
      expect(res.status, `${method} ${path}`).toBe(404);
    }
  });

  it('HEALTH-AI-101: the gate fires BEFORE auth — a tokenless wrong-brand call 404s, never 401s', async () => {
    // A 401 would confirm to anyone who asked that the path exists. This is the
    // exact leak the P4 social router shipped with.
    const res = await post('/ai/coach/turn', {}, { token: null, bindings: BUDGET_ENV });
    expect(res.status).toBe(404);
  });

  it('HEALTH-AI-102: every AI route is 401 without a bearer', async () => {
    for (const [method, path] of PATHS) {
      const res = await sweep(method, path, { token: null });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });
});

/* ================================= CONSENT =============================== */

describe('Symply Health AI — coach consent', () => {
  it('HEALTH-AI-110: an account that never answered reads granted:false', async () => {
    const res = await call('/ai/coach/consent');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { consent: Record<string, unknown> };
    expect(body.consent.granted).toBe(false);
    // Asserted against the CONSTANT, not a literal. This line hard-coded
    // `'health-coach-1'` and went red the moment the disclosure was rewritten
    // for the three added logging verbs — a bump that is supposed to be routine
    // and is supposed to invalidate every stored receipt. What matters is that
    // the route reports the version the app must currently ask against, which
    // is exactly what the constant is.
    expect(body.consent.required_version).toBe(COACH_CONSENT_VERSION);
    expect(COACH_CONSENT_VERSION).toMatch(/^health-coach-\d+$/);
  });

  it('HEALTH-AI-111: granting stamps granted_at; revoking stamps revoked_at and keeps the row', async () => {
    await grantConsent(tokenA);
    let body = (await (await call('/ai/coach/consent')).json()) as {
      consent: Record<string, unknown>;
    };
    expect(body.consent.granted).toBe(true);
    expect(body.consent.granted_at).toBeTruthy();

    const revoked = await call('/ai/coach/consent', {
      method: 'PUT',
      body: JSON.stringify({ granted: false }),
    });
    expect(revoked.status).toBe(200);
    body = (await (await call('/ai/coach/consent')).json()) as {
      consent: Record<string, unknown>;
    };
    expect(body.consent.granted).toBe(false);
    // The donor can only flip a flag; keeping the WHEN is what an audit needs.
    expect(body.consent.revoked_at).toBeTruthy();
  });

  it('HEALTH-AI-112: consent is per USER — B does not inherit A', async () => {
    await grantConsent(tokenA);
    const res = await call('/ai/coach/consent', {}, { token: tokenB });
    const body = (await res.json()) as { consent: { granted: boolean } };
    expect(body.consent.granted).toBe(false);
  });

  it('HEALTH-AI-113: a turn WITHOUT consent is 403 and reads NO health data', async () => {
    const res = await post('/ai/coach/turn', { message: 'how am I doing', today: TODAY });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('coach_consent_required');
    expect(genCalls).toHaveLength(0);
  });
});

/* ================================ ESCALATION ============================= */

describe('Symply Health AI — medical escalation', () => {
  it('HEALTH-AI-120: an emergency turn answers WITHOUT consent, entitlement or a model call', async () => {
    // No consent granted, entitlement rigged to deny, provider unavailable —
    // and it still answers. The donor's LLM path never runs its matcher at all.
    entitlementError = Object.assign(new Error('denied'), { name: 'AIAccessError' });
    providerAvailable = false;

    const res = await post('/ai/coach/turn', {
      message: 'I have chest pain and I feel sick',
      today: TODAY,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { turn: Record<string, unknown> };
    expect(body.turn.kind).toBe('escalation');
    expect(String(body.turn.reply)).toMatch(/emergency medical care/i);
    expect(genCalls).toHaveLength(0);
  });

  it('HEALTH-AI-121: the escalation never claims help was contacted', async () => {
    const res = await post('/ai/coach/turn', { message: "I can't breathe", today: TODAY });
    const body = (await res.json()) as {
      turn: { escalation: { claims_help_contacted: boolean }; reply: string };
    };
    expect(body.turn.escalation.claims_help_contacted).toBe(false);
    expect(body.turn.reply).toMatch(/I cannot call them for you/i);
  });
});

/* ============================== ENTITLEMENT ============================== */

describe('Symply Health AI — entitlement and fail-closed', () => {
  it('HEALTH-AI-130: AI disabled by entitlement denies the turn with the shared code', async () => {
    await grantConsent(tokenA);
    entitlementError = Object.assign(new Error('AI features are currently disabled'), {
      name: 'AIAccessError',
      statusCode: 403,
      code: 'ai_features_disabled',
    });

    const res = await post('/ai/coach/turn', { message: 'how am I doing', today: TODAY });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('ai_features_disabled');
    expect(genCalls).toHaveLength(0);
  });

  it('HEALTH-AI-131: NO CREDENTIAL configured returns insights and a plain notice, never a reply', async () => {
    await grantConsent(tokenA);
    providerAvailable = false;

    const res = await post('/ai/coach/turn', { message: 'how am I doing', today: TODAY });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      turn: { reply: string | null; ai_status: string; notice: string; insights: unknown[] };
    };
    expect(body.turn.reply).toBeNull();
    expect(body.turn.ai_status).toBe('unavailable');
    expect(body.turn.notice).toMatch(/could not be reached/i);
    // The person's own figures still render — that is not a fabricated result.
    expect(body.turn.insights.length).toBeGreaterThan(0);
  });

  it('HEALTH-AI-132: a provider TIMEOUT never yields a fabricated reply or a raw error', async () => {
    await grantConsent(tokenA);
    genQueue = [
      Object.assign(new Error('Request timed out after 120000ms'), {
        name: 'APIConnectionTimeoutError',
      }),
    ];

    const res = await post('/ai/coach/turn', { message: 'how am I doing', today: TODAY });
    expect(res.status).toBe(200);
    const raw = await res.text();
    const body = JSON.parse(raw) as { turn: { reply: string | null; ai_status: string } };
    expect(body.turn.reply).toBeNull();
    expect(body.turn.ai_status).toBe('unavailable');
    expect(raw).not.toContain('120000');
    expect(raw).not.toContain('APIConnectionTimeoutError');
  });

  it('HEALTH-AI-135: a provider that cannot even be CONSTRUCTED fails closed, not 500', async () => {
    // A BYOK lease that cannot be read, or a stored key that no longer decrypts,
    // throws out of `createAnthropicAdapterForUser`. "No credential" is a
    // fail-closed state the screen renders as copy — not an error.
    await grantConsent(tokenA);
    providerConstructionError = new Error('KV lease read failed for sk-ant-api03-XXXX');

    const res = await post('/ai/coach/turn', { message: 'how am I doing', today: TODAY });
    expect(res.status).toBe(200);
    const raw = await res.text();
    const body = JSON.parse(raw) as {
      turn: { reply: string | null; ai_status: string; notice: string };
    };
    expect(body.turn.reply).toBeNull();
    expect(body.turn.ai_status).toBe('unavailable');
    expect(body.turn.notice).toMatch(/could not be reached/i);
    // Nothing about the credential reaches the member.
    expect(raw).not.toContain('sk-ant');
    expect(raw).not.toContain('KV lease');
  });

  it('HEALTH-AI-136: a NON-entitlement failure on the turn is re-thrown, not disguised as a denial', async () => {
    await grantConsent(tokenA);
    entitlementError = new Error('D1_ERROR: no such table: subscriptions');

    const app = new Hono<{ Bindings: Env }>();
    let caught: unknown = null;
    app.onError((err, c) => {
      caught = err;
      return c.json({ error: { code: 'internal', message: 'Something went wrong' } }, 500);
    });
    app.route('/health', healthAiRoutes);
    const res = await app.request(
      'http://local/health/ai/coach/turn',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
        body: JSON.stringify({ message: 'how am I doing', today: TODAY }),
      },
      HEALTH_ENV
    );
    expect(res.status).toBe(500);
    expect((caught as Error)?.message).toContain('D1_ERROR');
    expect(await res.text()).not.toContain('D1_ERROR');
    // The turn never reached a model.
    expect(genCalls).toHaveLength(0);
  });

  it('HEALTH-AI-133: an EMPTY model turn is reported as unavailable, not shipped as ""', async () => {
    await grantConsent(tokenA);
    genQueue = [textTurn('   ')];

    const res = await post('/ai/coach/turn', { message: 'how am I doing', today: TODAY });
    const body = (await res.json()) as { turn: { reply: string | null; ai_status: string } };
    expect(body.turn.reply).toBeNull();
    expect(body.turn.ai_status).toBe('unavailable');
  });

  it('HEALTH-AI-134: a model that calls an UNKNOWN tool gets told so and never writes', async () => {
    await grantConsent(tokenA);
    genQueue = [toolTurn('delete_all_entries', { confirm: true }), textTurn('Sorry, I cannot.')];

    const res = await post('/ai/coach/turn', { message: 'wipe my diary', today: TODAY });
    const body = (await res.json()) as { turn: { proposal: unknown; reply: string } };
    expect(body.turn.proposal).toBeNull();
    expect(body.turn.reply).toContain('cannot');
  });
});

/* ================================= A TURN =============================== */

describe('Symply Health AI — coach turn', () => {
  it('HEALTH-AI-140: a good turn returns the reply and the grounded insights', async () => {
    await grantConsent(tokenA);
    genQueue = [textTurn('You have not logged anything yet today.')];

    const res = await post('/ai/coach/turn', { message: 'how am I doing', today: TODAY });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      turn: { kind: string; reply: string; ai_status: string; insights: Array<{ kind: string }> };
    };
    expect(body.turn.kind).toBe('reply');
    expect(body.turn.ai_status).toBe('ok');
    expect(body.turn.insights[0].kind).toBe('unknown_data');
  });

  it('HEALTH-AI-141: the prompt carries the SERVER-read context, not anything the client sent', async () => {
    await grantConsent(tokenA);
    genQueue = [textTurn('ok')];
    await post('/ai/coach/turn', {
      message: 'I definitely ate 5000 calories today, tell me about it',
      today: TODAY,
    });

    const system = genCalls[0].systemPrompt;
    expect(system).toContain('CONTEXT');
    // The user's claim is in the message, never in the grounded context block.
    expect(system).toContain('Calories logged today: not logged (unknown, NOT zero)');
    expect(system).not.toContain('5000');
  });

  it('HEALTH-AI-142: history is capped at six turns', async () => {
    await grantConsent(tokenA);
    genQueue = [textTurn('ok')];
    const history = Array.from({ length: 20 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      text: `turn ${i}`,
    }));
    await post('/ai/coach/turn', { message: 'and now', today: TODAY, history: history.slice(0, 12) });

    // 6 history turns + the current user message.
    expect(genCalls[0].messages).toHaveLength(7);
  });

  it('HEALTH-AI-143: a tool call becomes a PROPOSAL and writes nothing', async () => {
    await grantConsent(tokenA);
    genQueue = [
      toolTurn('prepare_log_water', { amount_ml: 500 }),
      textTurn('I have prepared 500 ml of water for you to confirm.'),
    ];

    const res = await post('/ai/coach/turn', { message: 'I drank a big glass', today: TODAY });
    const body = (await res.json()) as {
      turn: { kind: string; proposal: { payload_hash: string; normalized_payload: unknown } };
    };
    expect(body.turn.kind).toBe('proposal');
    expect(body.turn.proposal.normalized_payload).toEqual({ kind: 'water', amount_ml: 500 });

    // Nothing landed in the domain, and nothing landed in the ledger.
    const water = await testEnv.DB.prepare('SELECT COUNT(*) AS n FROM water_entries').first<{
      n: number;
    }>();
    expect(water?.n).toBe(0);
    const ops = await testEnv.DB.prepare(
      'SELECT COUNT(*) AS n FROM health_coach_operations'
    ).first<{ n: number }>();
    expect(ops?.n).toBe(0);
  });

  it('HEALTH-AI-144: only the FIRST prepare_log_* becomes a proposal', async () => {
    await grantConsent(tokenA);
    genQueue = [
      {
        content: [
          { type: 'tool_use', id: 'a', name: 'prepare_log_water', input: { amount_ml: 500 } },
          { type: 'tool_use', id: 'b', name: 'prepare_log_weight', input: { weight: 82, unit: 'kg' } },
        ],
        stopReason: 'tool_use',
        model: 'mock',
      },
      textTurn('Water first.'),
    ];

    const res = await post('/ai/coach/turn', { message: 'water and weight', today: TODAY });
    const body = (await res.json()) as { turn: { proposal: { target_type: string } } };
    expect(body.turn.proposal.target_type).toBe('water');
  });

  it('HEALTH-AI-145: an out-of-range tool call yields NO proposal', async () => {
    await grantConsent(tokenA);
    genQueue = [
      toolTurn('prepare_log_water', { amount_ml: 999999 }),
      textTurn('That is more than I can record — how much was it?'),
    ];

    const res = await post('/ai/coach/turn', { message: 'I drank a bathtub', today: TODAY });
    const body = (await res.json()) as { turn: { proposal: unknown; kind: string } };
    expect(body.turn.proposal).toBeNull();
    expect(body.turn.kind).toBe('reply');
  });

  it('HEALTH-AI-146: a blank or over-long message is rejected by validation, not sent', async () => {
    await grantConsent(tokenA);
    expect((await post('/ai/coach/turn', { message: '   ', today: TODAY })).status).toBe(400);
    expect(
      (await post('/ai/coach/turn', { message: 'x'.repeat(2001), today: TODAY })).status
    ).toBe(400);
    expect((await post('/ai/coach/turn', { message: 'hi', today: '25/07/2026' })).status).toBe(400);
    expect(genCalls).toHaveLength(0);
  });
});

/* ================================= COMMIT ================================ */

describe('Symply Health AI — commit', () => {
  async function proposeWater(): Promise<{ proposal: Record<string, unknown>; hash: string }> {
    genQueue = [toolTurn('prepare_log_water', { amount_ml: 500 }), textTurn('Ready to confirm.')];
    const res = await post('/ai/coach/turn', { message: 'I drank a big glass', today: TODAY });
    const body = (await res.json()) as {
      turn: { proposal: Record<string, unknown> & { payload_hash: string } };
    };
    return { proposal: body.turn.proposal, hash: body.turn.proposal.payload_hash };
  }

  it('HEALTH-AI-150: confirming writes ONE row through the ordinary service path', async () => {
    await grantConsent(tokenA);
    const { proposal, hash } = await proposeWater();

    const res = await post('/ai/coach/commit', {
      proposal,
      confirmed_payload_hash: hash,
      today: TODAY,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; target_type: string; target_id: string };
    expect(body.status).toBe('committed');
    expect(body.target_type).toBe('water');

    const row = await testEnv.DB.prepare(
      'SELECT user_id, amount_ml, date FROM water_entries WHERE id = ?'
    )
      .bind(body.target_id)
      .first<{ user_id: string; amount_ml: number; date: string }>();
    expect(row).toMatchObject({ user_id: UID_A, amount_ml: 500, date: TODAY });
  });

  it('HEALTH-AI-151: a REPLAY is idempotent — one row, not two', async () => {
    await grantConsent(tokenA);
    const { proposal, hash } = await proposeWater();
    const body = { proposal, confirmed_payload_hash: hash, today: TODAY };

    const first = (await (await post('/ai/coach/commit', body)).json()) as { status: string };
    const second = (await (await post('/ai/coach/commit', body)).json()) as { status: string };
    expect(first.status).toBe('committed');
    expect(second.status).toBe('idempotent_replay');

    const count = await testEnv.DB.prepare('SELECT COUNT(*) AS n FROM water_entries').first<{
      n: number;
    }>();
    expect(count?.n).toBe(1);
  });

  it('HEALTH-AI-152: TAMPERED numbers are refused with 409 and write nothing', async () => {
    await grantConsent(tokenA);
    const { proposal, hash } = await proposeWater();
    const tampered = { ...proposal, normalized_payload: { kind: 'water', amount_ml: 5000 } };

    const res = await post('/ai/coach/commit', {
      proposal: tampered,
      confirmed_payload_hash: hash,
      today: TODAY,
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('payload_hash_mismatch');
    expect(body.error.message).toMatch(/Those numbers changed/);

    const count = await testEnv.DB.prepare('SELECT COUNT(*) AS n FROM water_entries').first<{
      n: number;
    }>();
    expect(count?.n).toBe(0);
  });

  it('HEALTH-AI-153: an EXPIRED proposal is refused with 409', async () => {
    await grantConsent(tokenA);
    const { proposal, hash } = await proposeWater();
    const stale = { ...proposal, expires_at: '2020-01-01T00:00:00.000Z' };

    const res = await post('/ai/coach/commit', {
      proposal: stale,
      confirmed_payload_hash: hash,
      today: TODAY,
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    // The hash still matches — only the clock moved — so this must NOT read as
    // tampering.
    expect(body.error.code).toBe('proposal_expired');
  });

  it('HEALTH-AI-154: commit is refused after consent is revoked mid-flow', async () => {
    await grantConsent(tokenA);
    const { proposal, hash } = await proposeWater();
    await call('/ai/coach/consent', { method: 'PUT', body: JSON.stringify({ granted: false }) });

    const res = await post('/ai/coach/commit', {
      proposal,
      confirmed_payload_hash: hash,
      today: TODAY,
    });
    expect(res.status).toBe(403);
  });

  it('HEALTH-AI-155: a meal proposal writes one diary row per item', async () => {
    await grantConsent(tokenA);
    genQueue = [
      toolTurn('prepare_log_meal', {
        meal_type: 'lunch',
        items: [
          { food_name: 'Chicken breast', grams: 150, calories: 248, protein_g: 46 },
          { food_name: 'Rice', grams: 120, calories: 156 },
        ],
      }),
      textTurn('Two items ready.'),
    ];
    const turn = (await (
      await post('/ai/coach/turn', { message: 'chicken and rice for lunch', today: TODAY })
    ).json()) as { turn: { proposal: Record<string, unknown> & { payload_hash: string } } };

    const res = await post('/ai/coach/commit', {
      proposal: turn.turn.proposal,
      confirmed_payload_hash: turn.turn.proposal.payload_hash,
      today: TODAY,
    });
    expect(res.status).toBe(200);

    const rows = await testEnv.DB.prepare(
      'SELECT food_name, meal_type, calories FROM nutrition_entries WHERE user_id = ? ORDER BY food_name'
    )
      .bind(UID_A)
      .all<{ food_name: string; meal_type: string; calories: number }>();
    expect(rows.results.map((r) => r.food_name)).toEqual(['Chicken breast', 'Rice']);
    expect(rows.results[0].meal_type).toBe('lunch');
  });

  it('HEALTH-AI-156: a ledger receipt is user-scoped — B gets 404, never 403', async () => {
    await grantConsent(tokenA);
    const { proposal, hash } = await proposeWater();
    const committed = (await (
      await post('/ai/coach/commit', { proposal, confirmed_payload_hash: hash, today: TODAY })
    ).json()) as { target_id: string };
    expect(committed.target_id).toBeTruthy();

    const opId = proposal.operation_id as string;
    const mine = await call(`/ai/coach/operations/${opId}`);
    expect(mine.status).toBe(200);

    // 404, never 403 — a 403 would confirm the id exists on another account.
    const theirs = await call(`/ai/coach/operations/${opId}`, {}, { token: tokenB });
    expect(theirs.status).toBe(404);

    const list = (await (await call('/ai/coach/operations', {}, { token: tokenB })).json()) as {
      operations: unknown[];
    };
    expect(list.operations).toEqual([]);
  });

  it('HEALTH-AI-410: the ledger list clamps ?limit to 1..100 and ignores junk', async () => {
    await grantConsent(tokenA);
    // Three receipts, newest last — the list answers newest first.
    for (const ml of [100, 200, 300]) {
      genQueue = [toolTurn('prepare_log_water', { amount_ml: ml }), textTurn('Ready.')];
      const turn = await post('/ai/coach/turn', { message: `I drank ${ml}`, today: TODAY });
      const { turn: t } = (await turn.json()) as {
        turn: { proposal: Record<string, unknown> & { payload_hash: string } };
      };
      await post('/ai/coach/commit', {
        proposal: t.proposal,
        confirmed_payload_hash: t.proposal.payload_hash,
        today: TODAY,
      });
    }

    const read = async (query: string) =>
      (
        (await (await call(`/ai/coach/operations${query}`)).json()) as {
          operations: unknown[];
        }
      ).operations.length;

    // A junk limit falls back to the default rather than answering nothing.
    expect(await read('?limit=abc')).toBe(3);
    // Below the floor is raised to one, not treated as "none".
    expect(await read('?limit=0')).toBe(1);
    expect(await read('?limit=-5')).toBe(1);
    // Above the ceiling is capped, not honoured — but still answers.
    expect(await read('?limit=100000')).toBe(3);
    expect(await read('?limit=2')).toBe(2);
  });

  it('HEALTH-AI-157: a SELF-HASHED proposal cannot smuggle a figure past the route caps', async () => {
    await grantConsent(tokenA);
    const { proposal } = await proposeWater();

    // `payload_hash` is FNV-1a over a public encoding (see coach-proposals.ts),
    // so a client can mint one for whatever it likes. Everything downstream of
    // the hash therefore has to be re-derived: this payload was never proposed,
    // and 1e12 ml is 100 000 000× what `POST /health/water/entries` accepts.
    const payload = { kind: 'water', amount_ml: 1e12 };
    const forgedHash = payloadHash(payload);
    const forged = { ...proposal, normalized_payload: payload, payload_hash: forgedHash };

    const res = await post('/ai/coach/commit', {
      proposal: forged,
      confirmed_payload_hash: forgedHash,
      today: TODAY,
    });
    // 400 — the request is malformed, not in conflict with what was confirmed.
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('invalid_proposal');

    const count = await testEnv.DB.prepare('SELECT COUNT(*) AS n FROM water_entries').first<{
      n: number;
    }>();
    expect(count?.n).toBe(0);
  });

  it('HEALTH-AI-158: a self-hashed unit no column accepts is refused, never a constraint 500', async () => {
    await grantConsent(tokenA);
    const { proposal } = await proposeWater();
    const payload = { kind: 'weight', weight: 80, unit: 'stone' };
    const forgedHash = payloadHash(payload);
    const forged = {
      ...proposal,
      target_type: 'weight',
      normalized_payload: payload,
      payload_hash: forgedHash,
    };

    const res = await post('/ai/coach/commit', {
      proposal: forged,
      confirmed_payload_hash: forgedHash,
      today: TODAY,
    });
    // `weight_entries.unit` is CHECK-constrained; reaching the insert would be
    // a 5xx on user input.
    expect(res.status).toBe(400);
    const count = await testEnv.DB.prepare('SELECT COUNT(*) AS n FROM weight_entries').first<{
      n: number;
    }>();
    expect(count?.n).toBe(0);
  });

  it('HEALTH-AI-159: the ledger receipt is CLAIMED before the diary is written', async () => {
    // Ordering is what makes the retry safe. With the diary written first, any
    // failure of the ledger write left an entry that nothing recorded, so the
    // client retry — seeing no receipt — logged the meal a second time.
    await grantConsent(tokenA);
    const { proposal, hash } = await proposeWater();
    const opId = proposal.operation_id as string;

    // Nothing yet.
    expect(
      (
        await testEnv.DB.prepare(
          'SELECT COUNT(*) AS n FROM health_coach_operations WHERE operation_id = ?'
        )
          .bind(opId)
          .first<{ n: number }>()
      )?.n
    ).toBe(0);

    const res = await post('/ai/coach/commit', {
      proposal,
      confirmed_payload_hash: hash,
      today: TODAY,
    });
    expect(res.status).toBe(200);

    const receipt = await testEnv.DB.prepare(
      'SELECT commit_status, target_id, result_json FROM health_coach_operations WHERE operation_id = ?'
    )
      .bind(opId)
      .first<{ commit_status: string; target_id: string; result_json: string }>();
    // Claimed, then confirmed — the finished receipt names the row it produced.
    expect(receipt?.commit_status).toBe('committed');
    expect(receipt?.target_id).toBeTruthy();
    expect(JSON.parse(receipt?.result_json ?? '{}')).toEqual({ ids: [receipt?.target_id] });
  });

  it('HEALTH-AI-411: a PENDING receipt is finished by the retry, not reported as already done', async () => {
    // The crash this models: the operation was claimed and the process died
    // before the diary write. Answering "idempotent_replay" would strand the
    // person's confirmation with nothing saved and a receipt pointing at ''.
    await grantConsent(tokenA);
    const { proposal, hash } = await proposeWater();
    const opId = proposal.operation_id as string;

    await testEnv.DB.prepare(
      `INSERT INTO health_coach_operations
         (operation_id, user_id, target_type, target_id, payload_hash, commit_status,
          expected_target_version, result_json, created_at, updated_at, deleted_at)
       VALUES (?, ?, 'water', '', ?, 'pending', NULL, NULL, ?, ?, NULL)`
    )
      .bind(opId, UID_A, hash, '2026-07-25T09:00:00.000Z', '2026-07-25T09:00:00.000Z')
      .run();

    const res = await post('/ai/coach/commit', {
      proposal,
      confirmed_payload_hash: hash,
      today: TODAY,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; target_id: string };
    expect(body.status).toBe('committed');
    expect(body.target_id).toBeTruthy();

    // Exactly one diary row, and the claimed receipt now points at it.
    const count = await testEnv.DB.prepare('SELECT COUNT(*) AS n FROM water_entries').first<{
      n: number;
    }>();
    expect(count?.n).toBe(1);
    const receipt = await testEnv.DB.prepare(
      'SELECT commit_status, target_id FROM health_coach_operations WHERE operation_id = ?'
    )
      .bind(opId)
      .first<{ commit_status: string; target_id: string }>();
    expect(receipt).toEqual({ commit_status: 'committed', target_id: body.target_id });
  });
});

/* ====================== COMMIT — the three added verbs ==================== */

/**
 * `workout`, `period` and `habit` were added to `ProposalTargetType` after the
 * first release and are live in `HEALTH_COACH_TOOLS`, in `COMMITTABLE_TARGETS`
 * and in `writeDomain` — and NOTHING drove them end to end through the router.
 * `coach-proposals.test.ts` proves the pure normalisation and
 * `coach-service.test.ts` proves `writeDomain` for weight and meals only, so the
 * three newest verbs reached a real table for the first time here.
 *
 * The habit verb is the one that carries a hazard the other five do not: it is
 * the only proposal whose target is a row the member ALREADY OWNS rather than a
 * new one, so it can point at a row that is not theirs, has been deleted, or has
 * been renamed since the card was drawn — and `toggleHabit` FLIPS, so a careless
 * commit on an already-ticked habit would silently UNDO the person's completion
 * through a card that said "log my meditation".
 */
describe('Symply Health AI — commit: workout, period and habit', () => {
  /** Drive one tool call through the turn route and hand back its proposal. */
  async function propose(
    tool: string,
    input: unknown,
    message: string
  ): Promise<{ proposal: Record<string, unknown>; hash: string }> {
    genQueue = [toolTurn(tool, input), textTurn('Ready to confirm.')];
    const res = await post('/ai/coach/turn', { message, today: TODAY });
    const body = (await res.json()) as {
      turn: { proposal: (Record<string, unknown> & { payload_hash: string }) | null };
    };
    expect(body.turn.proposal, `${tool} produced no proposal`).not.toBeNull();
    const proposal = body.turn.proposal as Record<string, unknown> & { payload_hash: string };
    return { proposal, hash: proposal.payload_hash };
  }

  function commit(proposal: Record<string, unknown>, hash: string, token?: string) {
    return post(
      '/ai/coach/commit',
      { proposal, confirmed_payload_hash: hash, today: TODAY },
      token ? { token } : undefined
    );
  }

  /** A habit the member owns, written the way `createHabit` writes one. */
  async function seedHabit(
    userId: string,
    id: string,
    name: string,
    opts: { archived?: boolean } = {}
  ): Promise<void> {
    const ts = '2026-07-01T00:00:00.000Z';
    await testEnv.DB.prepare(
      `INSERT INTO user_habits
         (id, user_id, template_id, name, icon, category, time_of_day, frequency,
          custom_days, reminder_time, reminder_enabled, target_duration, sort_order,
          is_archived, created_at, updated_at, deleted_at)
       VALUES (?, ?, NULL, ?, 'goals', 'custom', 'anytime', 'daily',
               NULL, NULL, 0, NULL, 0, ?, ?, ?, NULL)`
    )
      .bind(id, userId, name, opts.archived ? 1 : 0, ts, ts)
      .run();
  }

  async function habitDays(habitId: string): Promise<string[]> {
    const { results } = await testEnv.DB.prepare(
      'SELECT date FROM habit_logs WHERE habit_id = ? AND deleted_at IS NULL'
    )
      .bind(habitId)
      .all<{ date: string }>();
    return (results ?? []).map((r) => r.date);
  }

  it('HEALTH-AI-548: a WORKOUT proposal lands on the same row the typed path writes', async () => {
    await grantConsent(tokenA);
    const { proposal, hash } = await propose(
      'prepare_log_workout',
      { workout_type: 'Running', minutes: 32, calories: 310, intensity: 'steady', note: 'river loop' },
      'I ran for half an hour'
    );

    const res = await commit(proposal, hash);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; target_type: string; target_id: string };
    expect(body).toMatchObject({ status: 'committed', target_type: 'workout' });

    const row = await testEnv.DB.prepare(
      'SELECT user_id, entry_type, date, data, intensity FROM health_entries WHERE id = ?'
    )
      .bind(body.target_id)
      .first<{
        user_id: string;
        entry_type: string;
        date: string;
        data: string;
        intensity: string | null;
      }>();
    expect(row).toMatchObject({ user_id: UID_A, entry_type: 'workout', date: TODAY });
    // `intensity` is its own COLUMN (0124), not a member of the JSON blob — an
    // edit on the Activity screen reads it from there and would show "not set"
    // for a coach row that buried it in `data`.
    expect(row?.intensity).toBe('steady');
    expect(JSON.parse(row?.data ?? '{}')).toMatchObject({
      workout_type: 'Running',
      minutes: 32,
      calories: 310,
      note: 'river loop',
    });
  });

  it('HEALTH-AI-549: an unstated burn and an unstated note land as the route DEFAULTS, not as null', async () => {
    // `POST /health/entries/workouts` defaults both, and a coach row that stored
    // null instead would render differently on the very same card.
    await grantConsent(tokenA);
    const { proposal, hash } = await propose(
      'prepare_log_workout',
      { workout_type: 'Yoga', minutes: 45 },
      'yoga for 45 minutes'
    );
    // Nothing was said about effort either, and `intensity` stays NULL rather
    // than becoming "easy" — an unstated effort is not a light one.
    expect((proposal.normalized_payload as Record<string, unknown>).intensity).toBeNull();

    const body = (await (await commit(proposal, hash)).json()) as { target_id: string };
    const row = await testEnv.DB.prepare(
      'SELECT data, intensity FROM health_entries WHERE id = ?'
    )
      .bind(body.target_id)
      .first<{ data: string; intensity: string | null }>();
    expect(row?.intensity).toBeNull();
    expect(JSON.parse(row?.data ?? '{}')).toMatchObject({
      workout_type: 'Yoga',
      minutes: 45,
      calories: 0,
      note: '',
    });
  });

  it('HEALTH-AI-550: a PERIOD proposal upserts the DAY and reports the day as its target', async () => {
    await grantConsent(tokenA);
    const { proposal, hash } = await propose(
      'prepare_log_period_day',
      { flow_level: 2, notes: 'light' },
      'my period started, light today'
    );

    const res = await commit(proposal, hash);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; target_type: string; target_id: string };
    expect(body).toMatchObject({ status: 'committed', target_type: 'period' });
    // `logPeriodDay` upserts on (user, date) and returns the whole list rather
    // than a row, so the DAY is the stable identifier the ledger records.
    expect(body.target_id).toBe(TODAY);

    const row = await testEnv.DB.prepare(
      'SELECT user_id, date, flow_level, notes FROM period_entries WHERE user_id = ? AND date = ?'
    )
      .bind(UID_A, TODAY)
      .first<{ user_id: string; date: string; flow_level: number; notes: string | null }>();
    expect(row).toMatchObject({ user_id: UID_A, date: TODAY, flow_level: 2, notes: 'light' });
  });

  it('HEALTH-AI-551: a HABIT proposal ticks the habit the card NAMED', async () => {
    await grantConsent(tokenA);
    await seedHabit(UID_A, 'habit_med', 'Meditate');
    const { proposal, hash } = await propose(
      'prepare_log_habit',
      { habit_id: 'habit_med', habit_name: 'Meditate' },
      'I meditated this morning'
    );

    const res = await commit(proposal, hash);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; target_type: string; target_id: string };
    expect(body).toMatchObject({
      status: 'committed',
      target_type: 'habit',
      target_id: 'habit_med',
    });
    expect(await habitDays('habit_med')).toEqual([TODAY]);
  });

  it('HEALTH-AI-552: a habit that is ALREADY done today is a no-op, never an untick', async () => {
    // `toggleHabit` FLIPS. Calling it blindly would delete the completion and
    // break the streak, through a card that said "log my meditation" — a
    // destructive write arriving from an affordance that promised the opposite.
    await grantConsent(tokenA);
    await seedHabit(UID_A, 'habit_med', 'Meditate');
    await testEnv.DB.prepare(
      `INSERT INTO habit_logs
         (id, user_id, habit_id, date, time_of_day, completed_at, duration, notes,
          created_at, updated_at, deleted_at)
       VALUES ('hl_seed', ?, 'habit_med', ?, 'anytime', ?, NULL, NULL, ?, ?, NULL)`
    )
      .bind(UID_A, TODAY, '2026-07-25T07:00:00.000Z', '2026-07-25T07:00:00.000Z', '2026-07-25T07:00:00.000Z')
      .run();

    const { proposal, hash } = await propose(
      'prepare_log_habit',
      { habit_id: 'habit_med', habit_name: 'Meditate' },
      'I meditated this morning'
    );
    const res = await commit(proposal, hash);

    expect(res.status).toBe(200);
    // Still done, and still ONE log — already-done is success, and idempotent.
    expect(await habitDays('habit_med')).toEqual([TODAY]);
    const count = await testEnv.DB.prepare(
      'SELECT COUNT(*) AS n FROM habit_logs WHERE habit_id = ? AND deleted_at IS NULL'
    )
      .bind('habit_med')
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it('HEALTH-AI-553: a habit id that is NOT the caller\'s is 409 target_unavailable and ticks nothing', async () => {
    // The one ownership fact `validateCommit` cannot check: it is pure and has
    // no database. A self-hashed proposal naming someone else's habit id is a
    // perfectly valid proposal, and it must still not reach their row.
    await grantConsent(tokenA);
    await seedHabit(UID_B, 'habit_bob', 'Stretch');
    const { proposal, hash } = await propose(
      'prepare_log_habit',
      { habit_id: 'habit_bob', habit_name: 'Stretch' },
      'I stretched'
    );

    const res = await commit(proposal, hash);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('target_unavailable');
    // The copy must not say WHICH check failed: "that habit is not yours" would
    // confirm the id exists on another account.
    expect(body.error.message).toMatch(/no longer one of your habits/);
    expect(body.error.message).not.toMatch(/habit_bob|not yours|another/i);

    expect(await habitDays('habit_bob')).toEqual([]);
  });

  it('HEALTH-AI-554: a habit whose NAME disagrees with the row is refused', async () => {
    // The hash covers id AND name equally, so a proposal pairing name A with id
    // B hashes perfectly and would DISPLAY habit A while ticking habit B. This
    // is the only check that can catch it.
    await grantConsent(tokenA);
    await seedHabit(UID_A, 'habit_med', 'Meditate');
    await seedHabit(UID_A, 'habit_run', 'Run');
    const { proposal, hash } = await propose(
      'prepare_log_habit',
      { habit_id: 'habit_run', habit_name: 'Meditate' },
      'tick my meditation'
    );

    const res = await commit(proposal, hash);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'target_unavailable'
    );
    expect(await habitDays('habit_run')).toEqual([]);
    expect(await habitDays('habit_med')).toEqual([]);
  });

  it('HEALTH-AI-555: a refused target leaves the receipt PENDING — the confirmation is not erased', async () => {
    // The person confirmed something. Marking the receipt committed would claim
    // a write that did not happen; deleting it would erase the audit of their
    // confirmation. `pending` is the honest third answer, and it is the state a
    // retry is designed to finish.
    await grantConsent(tokenA);
    await seedHabit(UID_B, 'habit_bob', 'Stretch');
    const { proposal, hash } = await propose(
      'prepare_log_habit',
      { habit_id: 'habit_bob', habit_name: 'Stretch' },
      'I stretched'
    );
    await commit(proposal, hash);

    const receipt = await testEnv.DB.prepare(
      'SELECT commit_status, target_id, target_type FROM health_coach_operations WHERE operation_id = ?'
    )
      .bind(proposal.operation_id as string)
      .first<{ commit_status: string; target_id: string; target_type: string }>();
    expect(receipt).toEqual({ commit_status: 'pending', target_id: '', target_type: 'habit' });

    // And the ledger SHOWS it — a member asking "what has the coach done" is
    // entitled to see the one that did not finish.
    const list = (await (await call('/ai/coach/operations')).json()) as {
      operations: Array<{ operation_id: string; commit_status: string }>;
    };
    expect(list.operations).toHaveLength(1);
    expect(list.operations[0].commit_status).toBe('pending');
  });

  it('HEALTH-AI-556: a retry FINISHES a refused habit commit once the target is back', async () => {
    await grantConsent(tokenA);
    await seedHabit(UID_A, 'habit_med', 'Meditate', { archived: true });
    const { proposal, hash } = await propose(
      'prepare_log_habit',
      { habit_id: 'habit_med', habit_name: 'Meditate' },
      'I meditated'
    );
    // Archived habits are not in `listHabits`, so the target is unavailable.
    expect((await commit(proposal, hash)).status).toBe(409);

    await testEnv.DB.prepare('UPDATE user_habits SET is_archived = 0 WHERE id = ?')
      .bind('habit_med')
      .run();

    const retry = await commit(proposal, hash);
    expect(retry.status).toBe(200);
    expect(((await retry.json()) as { status: string }).status).toBe('committed');
    expect(await habitDays('habit_med')).toEqual([TODAY]);

    // Still ONE receipt — the retry finished the claim rather than making a
    // second one.
    const count = await testEnv.DB.prepare(
      'SELECT COUNT(*) AS n FROM health_coach_operations WHERE user_id = ?'
    )
      .bind(UID_A)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it.each([
    ['workout', 'prepare_log_workout', { workout_type: 'Rowing', minutes: 20 }, 'I rowed'],
    ['period', 'prepare_log_period_day', { flow_level: 3 }, 'period today'],
  ])(
    'HEALTH-AI-557: a replayed %s commit reports idempotent_replay and writes nothing more',
    async (kind, tool, input, message) => {
      await grantConsent(tokenA);
      const { proposal, hash } = await propose(tool, input, message);

      const first = (await (await commit(proposal, hash)).json()) as { status: string };
      const second = (await (await commit(proposal, hash)).json()) as {
        status: string;
        target_type: string;
      };
      expect(first.status).toBe('committed');
      expect(second.status).toBe('idempotent_replay');
      expect(second.target_type).toBe(kind);

      const table = kind === 'workout' ? 'health_entries' : 'period_entries';
      const count = await testEnv.DB.prepare(
        `SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`
      )
        .bind(UID_A)
        .first<{ n: number }>();
      expect(count?.n).toBe(1);
    }
  );

  it('HEALTH-AI-558: a replayed HABIT commit does not re-toggle the tick', async () => {
    // The dangerous replay: a second `toggleHabit` would UNTICK. The ledger
    // short-circuit is what makes the retry safe, so it is asserted on the row
    // rather than only on the response.
    await grantConsent(tokenA);
    await seedHabit(UID_A, 'habit_med', 'Meditate');
    const { proposal, hash } = await propose(
      'prepare_log_habit',
      { habit_id: 'habit_med', habit_name: 'Meditate' },
      'I meditated'
    );

    expect(((await (await commit(proposal, hash)).json()) as { status: string }).status).toBe(
      'committed'
    );
    expect(((await (await commit(proposal, hash)).json()) as { status: string }).status).toBe(
      'idempotent_replay'
    );
    expect(await habitDays('habit_med')).toEqual([TODAY]);
  });

  it('HEALTH-AI-559: every added verb is refused OUTRIGHT when the figures are out of range', async () => {
    // The bounds mirror the zod caps on the ordinary routes that write the same
    // rows, so a proposal can never offer to store a figure the hand-typed path
    // would have refused. `buildProposal` returns null and the turn carries NO
    // proposal — the person is never shown a card the server would reject.
    await grantConsent(tokenA);
    const outOfRange: Array<[string, unknown]> = [
      ['prepare_log_workout', { workout_type: 'Running', minutes: 100000 }],
      ['prepare_log_workout', { workout_type: 'Running', minutes: 30, calories: 99999 }],
      ['prepare_log_workout', { workout_type: '   ', minutes: 30 }],
      ['prepare_log_period_day', { flow_level: 9 }],
      ['prepare_log_period_day', {}],
      ['prepare_log_habit', { habit_id: 'habit_med', habit_name: '' }],
      ['prepare_log_habit', { habit_name: 'Meditate' }],
    ];

    for (const [tool, input] of outOfRange) {
      genQueue = [toolTurn(tool, input), textTurn('I could not prepare that.')];
      const res = await post('/ai/coach/turn', { message: 'log it', today: TODAY });
      const body = (await res.json()) as { turn: { proposal: unknown; kind: string } };
      expect(body.turn.proposal, `${tool} ${JSON.stringify(input)}`).toBeNull();
      expect(body.turn.kind).toBe('reply');
    }
  });

  it('HEALTH-AI-560: a self-hashed WORKOUT cannot smuggle a figure past the route caps', async () => {
    // `payload_hash` is a public checksum, not a signature, so a hostile client
    // can always mint a matching one. The re-derivation in `validateCommit` is
    // what stops 100 000 minutes reaching `health_entries` as a 500 rather than
    // a 400 — and the three added verbs go through the SAME re-derivation, which
    // is the hole a chain of `!==` comparisons would have left open.
    await grantConsent(tokenA);
    const payload = {
      kind: 'workout',
      workout_type: 'Running',
      minutes: 100000,
      calories: null,
      note: null,
      intensity: null,
    };
    const forged = {
      operation_id: 'hop_forged',
      operation_type: 'create',
      target_type: 'workout',
      original_text: 'I ran',
      normalized_payload: payload,
      payload_hash: payloadHash(payload),
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      commit_status: 'proposed',
    };

    const res = await commit(forged, forged.payload_hash);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'invalid_proposal'
    );

    const count = await testEnv.DB.prepare(
      'SELECT COUNT(*) AS n FROM health_entries WHERE user_id = ?'
    )
      .bind(UID_A)
      .first<{ n: number }>();
    expect(count?.n).toBe(0);
  });

  it('HEALTH-AI-561: a ledger receipt for an added verb is user-scoped — B gets 404', async () => {
    await grantConsent(tokenA);
    await grantConsent(tokenB);
    const { proposal, hash } = await propose(
      'prepare_log_period_day',
      { flow_level: 3 },
      'period today'
    );
    await commit(proposal, hash);
    const opId = proposal.operation_id as string;

    const mine = await call(`/ai/coach/operations/${opId}`);
    expect(mine.status).toBe(200);

    // 404 rather than 403: confirming that an id exists on someone else's
    // account is the leak this domain avoids everywhere.
    const theirs = await call(`/ai/coach/operations/${opId}`, {}, { token: tokenB });
    expect(theirs.status).toBe(404);
  });
});

/* ================================ SCANNERS =============================== */

describe('Symply Health AI — label and meal scanners', () => {
  const LABEL_OK = {
    product_name: 'Greek Yoghurt',
    brand: 'Symply Dairy',
    serving_size: '3/4 cup (170g)',
    serving_size_g: 170,
    serving_size_unit: 'g',
    calories: 150,
    protein: 15,
    total_carbohydrates: 12,
    total_fat: 4,
    confidence: 0.94,
  };

  it('HEALTH-AI-160: a clean label returns a draft with a per-100 basis and persists NOTHING', async () => {
    genQueue = [toolTurn('output', LABEL_OK)];
    const res = await post('/ai/nutrition-label', {
      images: [{ data: JPEG_B64, media_type: 'image/jpeg' }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      draft: { product_name: string; base_calories_per_100: number; per_100_source: string };
    };
    expect(body.draft.product_name).toBe('Greek Yoghurt');
    expect(body.draft.per_100_source).toBe('derived');
    expect(body.draft.base_calories_per_100).toBe(88.2);

    const foods = await testEnv.DB.prepare('SELECT COUNT(*) AS n FROM custom_foods').first<{
      n: number;
    }>();
    expect(foods?.n).toBe(0);
  });

  it('HEALTH-AI-161: entitlement denial blocks the scanner before any model call', async () => {
    entitlementError = Object.assign(new Error('AI access required'), {
      name: 'AIAccessError',
      statusCode: 403,
      code: 'ai_access_required',
    });
    const res = await post('/ai/nutrition-label', {
      images: [{ data: JPEG_B64, media_type: 'image/jpeg' }],
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('ai_access_required');
    expect(genCalls).toHaveLength(0);
  });

  it('HEALTH-AI-162: a HEIC upload is 415 with plain-words copy, not a provider error', async () => {
    const res = await post('/ai/nutrition-label', {
      images: [{ data: HEIC_B64, media_type: 'image/jpeg' }],
    });
    expect(res.status).toBe(415);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('unsupported_media');
    expect(body.error.message).toMatch(/JPEG or PNG/);
    expect(body.error.message).not.toMatch(/error|Error|undefined|null/);
  });

  it('HEALTH-AI-163: an unreadable panel is 422 and never a draft of nulls', async () => {
    genQueue = [toolTurn('output', { product_name: 'Mystery', calories: null })];
    const res = await post('/ai/nutrition-label', {
      images: [{ data: JPEG_B64, media_type: 'image/jpeg' }],
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('unreadable');
  });

  it('HEALTH-AI-164: a provider failure is 503 with no raw string', async () => {
    genQueue = [Object.assign(new Error('529 overloaded_error from api.anthropic.com'), {})];
    const res = await post('/ai/nutrition-label', {
      images: [{ data: JPEG_B64, media_type: 'image/jpeg' }],
    });
    expect(res.status).toBe(503);
    const raw = await res.text();
    expect(raw).not.toContain('anthropic');
    expect(raw).not.toContain('529');
  });

  it('HEALTH-AI-165: no credential configured is 503, not a silent empty draft', async () => {
    providerAvailable = false;
    const res = await post('/ai/nutrition-label', {
      images: [{ data: JPEG_B64, media_type: 'image/jpeg' }],
    });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'provider_unavailable'
    );
  });

  it('HEALTH-AI-166: the meal scanner returns rows with provenance and a recomputed total', async () => {
    genQueue = [
      toolTurn('output', {
        foods: [
          { food_name: 'Chicken breast', calories: 165, data_source: 'estimation', confidence: 0.5 },
          { food_name: 'Rice', calories: 200, data_source: 'product_database', confidence: 0.85 },
        ],
        total_calories: 999,
      }),
    ];
    const res = await post('/ai/meal-photo', {
      images: [{ data: JPEG_B64, media_type: 'image/jpeg' }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      draft: { total_calories: number; foods: Array<{ data_source: string }> };
    };
    expect(body.draft.total_calories).toBe(365);
    expect(body.draft.foods[0].data_source).toBe('estimation');
  });

  it('HEALTH-AI-167: more than four images is rejected by validation', async () => {
    const images = Array.from({ length: 5 }, () => ({ data: JPEG_B64, media_type: 'image/jpeg' }));
    expect((await post('/ai/nutrition-label', { images })).status).toBe(400);
  });

  /* ------- the MEAL scanner gets the same refusals as the label one ------- */

  it('HEALTH-AI-168: the meal scanner fails closed on every provider outcome', async () => {
    // Each of the label scanner's refusals, on the OTHER surface — the two share
    // `visionFailureResponse`, and a per-route copy would drift.
    const heic = await post('/ai/meal-photo', {
      images: [{ data: HEIC_B64, media_type: 'image/jpeg' }],
    });
    expect(heic.status).toBe(415);
    expect(((await heic.json()) as { error: { code: string } }).error.code).toBe(
      'unsupported_media'
    );

    genQueue = [textTurn('That looks like a lovely dinner.')];
    const prose = await post('/ai/meal-photo', {
      images: [{ data: JPEG_B64, media_type: 'image/jpeg' }],
    });
    // The model answered, but not with an extraction — never an empty draft.
    expect(prose.status).toBe(422);
    const proseBody = (await prose.json()) as { error: { code: string; message: string } };
    expect(proseBody.error.code).toBe('unreadable');
    expect(proseBody.error.message).toMatch(/No food could be identified/);

    genQueue = [new Error('529 overloaded_error from api.anthropic.com')];
    const down = await post('/ai/meal-photo', {
      images: [{ data: JPEG_B64, media_type: 'image/jpeg' }],
    });
    expect(down.status).toBe(503);
    const raw = await down.text();
    expect(raw).not.toContain('anthropic');
    expect(raw).not.toContain('529');
  });

  it('HEALTH-AI-169: the meal scanner is 503 with no credential and 403 with no entitlement', async () => {
    providerAvailable = false;
    const noKey = await post('/ai/meal-photo', {
      images: [{ data: JPEG_B64, media_type: 'image/jpeg' }],
    });
    expect(noKey.status).toBe(503);
    expect(((await noKey.json()) as { error: { code: string } }).error.code).toBe(
      'provider_unavailable'
    );
    providerAvailable = true;

    entitlementError = Object.assign(new Error('AI access required'), {
      name: 'AIAccessError',
      statusCode: 403,
      code: 'ai_access_required',
    });
    const denied = await post('/ai/meal-photo', {
      images: [{ data: JPEG_B64, media_type: 'image/jpeg' }],
    });
    expect(denied.status).toBe(403);
    // Denied BEFORE the model, so nothing was spent.
    expect(genCalls).toHaveLength(0);
  });

  it('HEALTH-AI-180: an entitlement error with no status or code still denies, never 500s', async () => {
    // `AIAccessError` carries both today, but the denial mapper has to keep
    // working if a caller throws a bare one — a missing status must not become
    // an unhandled 500 that leaks a stack.
    entitlementError = Object.assign(new Error('AI is unavailable on this plan'), {
      name: 'AIAccessError',
    });
    const res = await post('/ai/nutrition-label', {
      images: [{ data: JPEG_B64, media_type: 'image/jpeg' }],
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('ai_access_denied');
  });

  it.each([
    ['/ai/nutrition-label', 'the label scanner'],
    ['/ai/meal-photo', 'the meal scanner'],
  ])(
    'HEALTH-AI-181: %s re-throws a NON-entitlement error instead of mapping it to 403',
    async (path) => {
      // Swallowing every failure into the denial shape would tell a member to
      // buy AI they already have, and would hide a real outage from the logs.
      entitlementError = new Error('D1_ERROR: no such table: subscriptions');
      const app = new Hono<{ Bindings: Env }>();
      let caught: unknown = null;
      app.onError((err, c) => {
        caught = err;
        return c.json({ error: { code: 'internal', message: 'Something went wrong' } }, 500);
      });
      app.route('/health', healthAiRoutes);

      const res = await app.request(
        `http://local/health${path}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
          body: JSON.stringify({ images: [{ data: JPEG_B64, media_type: 'image/jpeg' }] }),
        },
        HEALTH_ENV
      );
      expect(res.status).toBe(500);
      expect((caught as Error)?.message).toContain('D1_ERROR');
      // …and the member still never sees the raw string.
      expect(await res.text()).not.toContain('D1_ERROR');
    }
  );

  it('HEALTH-AI-182: an image with NO declared media type still scans — the bytes decide', async () => {
    // `media_type` is advisory and optional. A client that omits it entirely
    // must be handled exactly like one that lies about it: sniff and proceed.
    genQueue = [toolTurn('output', LABEL_OK)];
    const label = await post('/ai/nutrition-label', { images: [{ data: JPEG_B64 }] });
    expect(label.status).toBe(200);
    expect(
      ((await label.json()) as { draft: { product_name: string } }).draft.product_name
    ).toBe('Greek Yoghurt');

    genQueue = [toolTurn('output', { foods: [{ food_name: 'Toast', calories: 90 }] })];
    const meal = await post('/ai/meal-photo', { images: [{ data: JPEG_B64 }] });
    expect(meal.status).toBe(200);
    expect(((await meal.json()) as { draft: { total_calories: number } }).draft.total_calories).toBe(
      90
    );
  });
});

/* ============================ BODY-INSIGHT PRODUCER ====================== */

describe('Symply Health AI — body-insight producer', () => {
  async function seedMeasurement(date: string, waist: number, chest: number) {
    await testEnv.DB.prepare(
      `INSERT INTO body_measurements (id, user_id, date, waist, chest, unit, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'cm', ?, ?)`
    )
      .bind(`bm_${date}`, UID_A, date, waist, chest, `${date}T08:00:00Z`, `${date}T08:00:00Z`)
      .run();
  }

  it('HEALTH-AI-170: no measurements is 422 with a plain instruction, not an empty insight', async () => {
    await grantConsent(tokenA);
    const res = await post('/ai/body-insights/generate', { date: TODAY });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('no_measurements');
    expect(body.error.message).toMatch(/Log some body measurements/);
  });

  it('HEALTH-AI-171: without consent it is 403 before any measurement is read', async () => {
    await seedMeasurement('2026-06-01', 88, 100);
    const res = await post('/ai/body-insights/generate', { date: TODAY });
    expect(res.status).toBe(403);
  });

  it('HEALTH-AI-172: every SCORE and ESTIMATE stays null — no photo, no posture, no body fat', async () => {
    await grantConsent(tokenA);
    await seedMeasurement('2026-06-01', 88, 100);
    await seedMeasurement('2026-07-01', 86.6, 101);

    const res = await post('/ai/body-insights/generate', { date: TODAY });
    expect(res.status).toBe(200);

    const row = await testEnv.DB.prepare(
      `SELECT overall_posture_score, overall_symmetry_score, muscle_balance_score,
              body_fat_estimate_lower, body_fat_estimate_upper, body_fat_category,
              lean_mass_estimate, front_photo_id, back_photo_id,
              left_side_photo_id, right_side_photo_id, processing_notes
         FROM body_comprehensive_insights WHERE user_id = ?`
    )
      .bind(UID_A)
      .first<Record<string, unknown>>();

    // A tape measure cannot produce a posture score, and a body-fat percentage
    // presented by a health app reads as a measurement. Both stay absent.
    for (const col of [
      'overall_posture_score',
      'overall_symmetry_score',
      'muscle_balance_score',
      'body_fat_estimate_lower',
      'body_fat_estimate_upper',
      'body_fat_category',
      'lean_mass_estimate',
      'front_photo_id',
      'back_photo_id',
      'left_side_photo_id',
      'right_side_photo_id',
    ]) {
      expect(row?.[col], col).toBeNull();
    }
    expect(String(row?.processing_notes)).toMatch(/No photograph was used/);
  });

  it('HEALTH-AI-177: a model sentence with an UNGROUNDED number is dropped, not shown', async () => {
    await grantConsent(tokenA);
    await seedMeasurement('2026-06-01', 88, 100);
    await seedMeasurement('2026-07-01', 86.6, 101);
    // "1.6 % per month" is the classic derived-and-invented figure. Nothing in
    // the computed facts holds 1.6 or 12, so both sentences must be discarded
    // and the deterministic set shown instead.
    structuredQueue = [
      {
        observations: [
          'Your waist is down 1.6 percent per month.',
          'You are on track to reach 12 cm of change.',
        ],
        what_to_log_next: [],
      },
    ];

    const res = await post('/ai/body-insights/generate', { date: TODAY });
    const body = (await res.json()) as { ai_status: string; dropped_ungrounded: number };
    expect(body.dropped_ungrounded).toBe(2);
    // Every sentence was ungrounded, so the deterministic set stands and the
    // card does not claim to be AI-written.
    expect(body.ai_status).toBe('unavailable');

    const row = await testEnv.DB.prepare(
      'SELECT strengths, analysis_provider FROM body_comprehensive_insights WHERE user_id = ?'
    )
      .bind(UID_A)
      .first<{ strengths: string; analysis_provider: string }>();
    expect(row?.analysis_provider).toBe('deterministic');
    expect(row?.strengths).not.toContain('1.6 percent');
    expect(row?.strengths).toContain('waist');
  });

  it('HEALTH-AI-178: a GROUNDED model sentence is kept and tagged as AI-written', async () => {
    await grantConsent(tokenA);
    await seedMeasurement('2026-06-01', 88, 100);
    await seedMeasurement('2026-07-01', 86.6, 101);
    structuredQueue = [
      {
        observations: ['Your waist moved from 88 to 86.6 cm across 2 readings.'],
        what_to_log_next: ['Log your hips as well so it has a trend too.'],
      },
    ];

    const res = await post('/ai/body-insights/generate', { date: TODAY });
    const body = (await res.json()) as { ai_status: string; dropped_ungrounded: number };
    expect(body.ai_status).toBe('ok');
    expect(body.dropped_ungrounded).toBe(0);

    const row = await testEnv.DB.prepare(
      'SELECT strengths, analysis_provider FROM body_comprehensive_insights WHERE user_id = ?'
    )
      .bind(UID_A)
      .first<{ strengths: string; analysis_provider: string }>();
    expect(row?.analysis_provider).toBe('symply-health-coach');
    expect(row?.strengths).toContain('86.6');
  });

  it('HEALTH-AI-412: a malformed observation list is skipped, never rendered as "null"', async () => {
    // Models do return a blank string, a bare number, or a null in an array of
    // strings. Any of those reaching the card would print as an empty bullet or
    // the word "null" under a heading about the person's body.
    await grantConsent(tokenA);
    await seedMeasurement('2026-06-01', 88, 100);
    await seedMeasurement('2026-07-01', 86.6, 101);
    structuredQueue = [
      {
        observations: [
          '   ',
          null,
          42,
          'Your waist moved from 88 to 86.6 cm across 2 readings.',
        ],
        what_to_log_next: ['', null, 'Log your hips as well so it has a trend too.'],
      },
    ];

    const res = await post('/ai/body-insights/generate', { date: TODAY });
    const body = (await res.json()) as { ai_status: string; dropped_ungrounded: number };
    expect(body.ai_status).toBe('ok');
    // A junk ENTRY is skipped, not counted as an ungrounded sentence — the two
    // are different faults and `dropped_ungrounded` reports only the second.
    expect(body.dropped_ungrounded).toBe(0);

    const row = await testEnv.DB.prepare(
      'SELECT strengths, areas_of_improvement FROM body_comprehensive_insights WHERE user_id = ?'
    )
      .bind(UID_A)
      .first<{ strengths: string; areas_of_improvement: string }>();
    expect(JSON.parse(row?.strengths ?? '[]')).toEqual([
      'Your waist moved from 88 to 86.6 cm across 2 readings.',
    ]);
    expect(JSON.parse(row?.areas_of_improvement ?? '[]')).toEqual([
      'Log your hips as well so it has a trend too.',
    ]);
  });

  it('HEALTH-AI-413: an UNGROUNDED "what to log next" line is dropped and counted', async () => {
    // The suggestion list goes through the same grounding guard as the
    // observations — it is the easiest place for a model to smuggle in a target.
    await grantConsent(tokenA);
    await seedMeasurement('2026-06-01', 88, 100);
    await seedMeasurement('2026-07-01', 86.6, 101);
    structuredQueue = [
      {
        observations: ['Your waist moved from 88 to 86.6 cm across 2 readings.'],
        what_to_log_next: ['Aim for another 5 cm off the waist next month.'],
      },
    ];

    const res = await post('/ai/body-insights/generate', { date: TODAY });
    const body = (await res.json()) as { ai_status: string; dropped_ungrounded: number };
    expect(body.ai_status).toBe('ok');
    expect(body.dropped_ungrounded).toBe(1);

    const row = await testEnv.DB.prepare(
      'SELECT areas_of_improvement, analysis_confidence FROM body_comprehensive_insights WHERE user_id = ?'
    )
      .bind(UID_A)
      .first<{ areas_of_improvement: string; analysis_confidence: number }>();
    expect(JSON.parse(row?.areas_of_improvement ?? '[]')).toEqual([]);
    // 1 kept of 2 written — the reader can see how much survived grounding.
    expect(row?.analysis_confidence).toBe(0.5);
  });

  it('HEALTH-AI-414: a provider that THROWS still produces the deterministic row', async () => {
    await grantConsent(tokenA);
    await seedMeasurement('2026-06-01', 88, 100);
    await seedMeasurement('2026-07-01', 86.6, 101);
    const providerError = '529 overloaded_error from api.anthropic.com';
    structuredQueue = [new Error(providerError)];

    const res = await post('/ai/body-insights/generate', { date: TODAY });
    expect(res.status).toBe(200);
    const raw = await res.text();
    const body = JSON.parse(raw) as { ai_status: string; dropped_ungrounded: number };
    expect(body.ai_status).toBe('unavailable');
    expect(body.dropped_ungrounded).toBe(0);
    // No raw provider string anywhere in the answer. Asserted on the DISTINCTIVE
    // tokens rather than the bare "529": that three-digit run occurs by chance in
    // the row's generated uuid, and did — `bci_7a140ea4-…-8d4af9a05529` failed
    // this test while nothing had leaked. A status code alone is not a fingerprint.
    expect(raw).not.toContain('anthropic');
    expect(raw).not.toContain('overloaded_error');
    expect(raw).not.toContain(providerError);

    const row = await testEnv.DB.prepare(
      'SELECT analysis_provider, analysis_confidence, strengths FROM body_comprehensive_insights WHERE user_id = ?'
    )
      .bind(UID_A)
      .first<{ analysis_provider: string; analysis_confidence: number | null; strengths: string }>();
    expect(row?.analysis_provider).toBe('deterministic');
    expect(row?.analysis_confidence).toBeNull();
    expect(row?.strengths).toContain('waist');
  });

  it('HEALTH-AI-173: the deltas are the ones the rows actually show', async () => {
    await grantConsent(tokenA);
    await seedMeasurement('2026-06-01', 88, 100);
    await seedMeasurement('2026-07-01', 86.6, 101);

    const res = await post('/ai/body-insights/generate', { date: TODAY });
    const body = (await res.json()) as {
      facts: { changes: Array<{ site: string; delta: number; first: number; latest: number }> };
    };
    const waist = body.facts.changes.find((c) => c.site === 'waist')!;
    expect(waist).toMatchObject({ first: 88, latest: 86.6, delta: -1.4 });
    // Biggest movement first.
    expect(body.facts.changes[0].site).toBe('waist');
  });

  it('HEALTH-AI-174: with AI unavailable the row is still produced, tagged deterministic', async () => {
    await grantConsent(tokenA);
    await seedMeasurement('2026-06-01', 88, 100);
    await seedMeasurement('2026-07-01', 86.6, 101);
    providerAvailable = false;

    const res = await post('/ai/body-insights/generate', { date: TODAY });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ai_status: string };
    expect(body.ai_status).toBe('unavailable');

    const row = await testEnv.DB.prepare(
      'SELECT analysis_provider FROM body_comprehensive_insights WHERE user_id = ?'
    )
      .bind(UID_A)
      .first<{ analysis_provider: string }>();
    expect(row?.analysis_provider).toBe('deterministic');
  });

  it('HEALTH-AI-415: an ENTITLEMENT denial still produces the row — the arithmetic is the person own', async () => {
    // Deliberate divergence from the coach turn: the deterministic summary is
    // the member's own readings added up, and a lapsed subscription is not a
    // reason to withhold it. Only the prose is behind the model.
    await grantConsent(tokenA);
    await seedMeasurement('2026-06-01', 88, 100);
    await seedMeasurement('2026-07-01', 86.6, 101);
    entitlementError = Object.assign(new Error('AI features are disabled'), {
      name: 'AIAccessError',
      statusCode: 403,
      code: 'ai_features_disabled',
    });

    const res = await post('/ai/body-insights/generate', { date: TODAY });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ai_status: string; facts: { changes: unknown[] } };
    expect(body.ai_status).toBe('unavailable');
    expect(body.facts.changes.length).toBeGreaterThan(0);

    const row = await testEnv.DB.prepare(
      'SELECT analysis_provider FROM body_comprehensive_insights WHERE user_id = ?'
    )
      .bind(UID_A)
      .first<{ analysis_provider: string }>();
    expect(row?.analysis_provider).toBe('deterministic');
  });

  it('HEALTH-AI-416: a NON-entitlement failure is re-thrown rather than downgraded to "no AI"', async () => {
    // Treating every throw as "AI unavailable" would hide a broken entitlement
    // lookup behind a card that looks like it worked.
    await grantConsent(tokenA);
    await seedMeasurement('2026-06-01', 88, 100);
    entitlementError = new Error('D1_ERROR: no such table: subscriptions');

    const app = new Hono<{ Bindings: Env }>();
    let caught: unknown = null;
    app.onError((err, c) => {
      caught = err;
      return c.json({ error: { code: 'internal', message: 'Something went wrong' } }, 500);
    });
    app.route('/health', healthAiRoutes);
    const res = await app.request(
      'http://local/health/ai/body-insights/generate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
        body: JSON.stringify({ date: TODAY }),
      },
      HEALTH_ENV
    );
    expect(res.status).toBe(500);
    expect((caught as Error)?.message).toContain('D1_ERROR');
    // No half-written insight left behind.
    const count = await testEnv.DB.prepare(
      'SELECT COUNT(*) AS n FROM body_comprehensive_insights'
    ).first<{ n: number }>();
    expect(count?.n).toBe(0);
  });

  it('HEALTH-AI-175: regenerating REPLACES the day rather than accumulating', async () => {
    await grantConsent(tokenA);
    await seedMeasurement('2026-06-01', 88, 100);
    await seedMeasurement('2026-07-01', 86.6, 101);

    await post('/ai/body-insights/generate', { date: TODAY });
    await post('/ai/body-insights/generate', { date: TODAY });

    const count = await testEnv.DB.prepare(
      'SELECT COUNT(*) AS n FROM body_comprehensive_insights WHERE user_id = ? AND date = ?'
    )
      .bind(UID_A, TODAY)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it('HEALTH-AI-176: mixed units refuse to report a delta and say why', async () => {
    await grantConsent(tokenA);
    await seedMeasurement('2026-06-01', 88, 100);
    await testEnv.DB.prepare(
      `INSERT INTO body_measurements (id, user_id, date, waist, chest, unit, created_at, updated_at)
       VALUES ('bm_in', ?, '2026-07-01', 34, 40, 'in', '2026-07-01T08:00:00Z', '2026-07-01T08:00:00Z')`
    )
      .bind(UID_A)
      .run();

    const res = await post('/ai/body-insights/generate', { date: TODAY });
    const body = (await res.json()) as {
      facts: { mixed_units: boolean; changes: unknown[] };
    };
    expect(body.facts.mixed_units).toBe(true);
    expect(body.facts.changes).toEqual([]);
  });
});
