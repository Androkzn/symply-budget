import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AIProvider } from '../ai/provider';
import { createAnthropicAdapterForUser } from '../ai/provider-factory';
import { authMiddleware } from '../middleware/auth';
import { requireHealthApi } from '../middleware/brand-gate';
import { assertCanUseAI } from '../services/entitlement-service';
import { HealthCoachService } from '../services/health-ai/coach-service';
import { MeasurementInsightService } from '../services/health-ai/measurement-insight-service';
import {
  HealthVisionService,
  MAX_VISION_IMAGES,
  type VisionFailure,
} from '../services/health-ai/vision-service';
import type { Env } from '../types';
import { AIAccessError } from '../utils/errors';

/**
 * Symply Health — parity phase P3, the AI surfaces.
 *
 * Mounted at `/health` alongside `routes/health.ts` and the P2 routers, with the
 * same contract: `requireHealthApi()` 404s the whole surface on every non-Health
 * Worker, and every row is scoped to the authenticated USER — health data is
 * personal and has no household read path by design (BRD §7).
 *
 * Three donor surfaces land here:
 *   - the AI COACH        (donor `routes/healthCoach.ts` — turn + commit + ledger)
 *   - the LABEL / MEAL scanners (donor `/ai/scan-nutrition-label`, `/ai/analyze-food`,
 *     `/ai/analyze-food-scale`)
 *   - the BODY-INSIGHT PRODUCER that `routes/health-body-extras.ts` has been
 *     waiting for since P2 ("the producer lands in P3 and calls the service
 *     in-process")
 *
 * ── GATE ORDER, AND WHY IT IS WRITTEN OUT HERE ───────────────────────────────
 *
 *   brand → auth → escalation → consent → entitlement → model
 *
 * The escalation check sits AHEAD of consent and entitlement on purpose: a
 * person describing chest pain gets the notice whether or not they have agreed
 * to anything or pay for anything, and that path calls no model at all.
 *
 * `AIAccessError` is caught and mapped INSIDE this router rather than left to
 * `app.onError`. The Health suites mount routers STANDALONE, where the app's
 * error handler does not exist — the same isolation that hid the P4 mount-order
 * leak until it was probed on the deployed Worker. Mapping here makes the
 * denial identical composed or standalone, and the test proves the real thing.
 *
 * ── RATE LIMITING IS REGISTERED ON THE APP, NOT HERE ─────────────────────────
 *
 * `src/index.ts` registers `rateLimitDO('health:ai')` for `/health/ai/*` BEFORE
 * any `/health` mount, for the same reason the P4 social flag had to move there:
 * `routes/health.ts` mounts first at the shared prefix and its `use('/*', …)`
 * would otherwise run ahead of anything declared in this file.
 * `health-ai-precedence.test.ts` pins that ordering at source level.
 */
const healthAi = new Hono<{ Bindings: Env; Variables: { userId: string } }>();

healthAi.use('/ai/*', requireHealthApi());
healthAi.use('/ai/*', authMiddleware());

function uid(c: { get: (k: 'userId') => string }): string {
  return c.get('userId');
}

/** YYYY-MM-DD — the client always sends its own LOCAL day, never a UTC stamp. */
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

/**
 * Member-facing copy for every denial. No provider string, no error name, no
 * status code — the repo-wide no-raw-error-leaks rule.
 */
const COPY = {
  consent_required:
    'Turn on coach insights first so it can read the health data you have logged.',
  unsupported_media:
    'That image could not be read. Take the photo again as a JPEG or PNG, or pick a different one.',
  unreadable:
    'No nutrition information could be read from that. Try again in better light with the whole panel in frame, or enter the values yourself.',
  meal_unreadable:
    'No food could be identified in that photo. Try again in better light, or add the items yourself.',
  provider_unavailable:
    'The scanner could not be reached just now. Please try again in a moment.',
  no_measurements:
    'Log some body measurements first — there is nothing to summarise yet.',
} as const;

function visionFailureResponse(failure: VisionFailure, unreadableCopy: string) {
  switch (failure.reason) {
    case 'unsupported_media':
      return { status: 415 as const, body: { error: { code: failure.reason, message: COPY.unsupported_media } } };
    case 'unreadable':
      return { status: 422 as const, body: { error: { code: failure.reason, message: unreadableCopy } } };
    case 'provider_unavailable':
      return {
        status: 503 as const,
        body: { error: { code: failure.reason, message: COPY.provider_unavailable } },
      };
  }
}

/**
 * Resolve the acting user's provider, honouring BYOK.
 *
 * Returns null — never throws — when no key is configured for them, because
 * "no credential" is a FAIL-CLOSED state the coach renders as a plain notice,
 * not an error. Entitlement denial is different and is raised separately by
 * `assertCanUseAI`, which is what produces the Unlock AI path in the app.
 */
async function providerFor(
  env: Env,
  userId: string,
  feature: string
): Promise<AIProvider | null> {
  try {
    const adapter = await createAnthropicAdapterForUser(
      env,
      userId,
      { feature, userId },
      HealthVisionService.MODEL
    );
    return adapter.isAvailable() ? adapter : null;
  } catch (err) {
    console.error('[health-ai] provider construction failed:', String(err).slice(0, 200));
    return null;
  }
}

/** Map `AIAccessError` to the shared denial shape; rethrow anything else. */
function denial(err: unknown) {
  if (err instanceof AIAccessError || (err as Error)?.name === 'AIAccessError') {
    const e = err as AIAccessError & { statusCode?: number; code?: string; message: string };
    return {
      status: (e.statusCode ?? 403) as 403 | 409 | 422 | 503,
      body: { error: { code: e.code ?? 'ai_access_denied', message: e.message } },
    };
  }
  return null;
}

/* ============================== COACH CONSENT ============================= */

/**
 * Deny-by-default: an account that has never answered reads
 * `granted: false`, and so does one whose stored receipt predates the current
 * disclosure text. The donor auto-grants five scopes on first use instead.
 */
healthAi.get('/ai/coach/consent', async (c) => {
  const service = new HealthCoachService(c.env.DB);
  return c.json({ consent: await service.getConsent(uid(c)) });
});

healthAi.put(
  '/ai/coach/consent',
  zValidator('json', z.object({ granted: z.boolean() })),
  async (c) => {
    const service = new HealthCoachService(c.env.DB);
    const consent = await service.setConsent(uid(c), c.req.valid('json').granted);
    return c.json({ consent });
  }
);

/* ================================ COACH TURN ============================== */

const turnSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  today: dateSchema,
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        text: z.string().max(4000),
      })
    )
    .max(20)
    .optional(),
});

healthAi.post('/ai/coach/turn', zValidator('json', turnSchema), async (c) => {
  const userId = uid(c);
  const input = c.req.valid('json');
  const service = new HealthCoachService(c.env.DB);

  // GATE 1 — deterministic escalation, ahead of everything. No consent, no
  // entitlement, no model, no token, no health row read.
  const escalation = service.checkEscalation(input.message);
  if (escalation) {
    return c.json({
      turn: {
        kind: 'escalation' as const,
        reply: escalation.message,
        proposal: null,
        escalation,
        insights: [],
        ai_status: 'skipped' as const,
        notice: null,
        model: null,
      },
    });
  }

  // GATE 2 — consent, before any health data is read.
  const consent = await service.getConsent(userId);
  if (!consent.granted) {
    return c.json(
      { error: { code: 'coach_consent_required', message: COPY.consent_required }, consent },
      403
    );
  }

  // GATE 3 — the platform's canonical AI entitlement.
  try {
    await assertCanUseAI(userId, c.env);
  } catch (err) {
    const mapped = denial(err);
    if (mapped) return c.json(mapped.body, mapped.status);
    throw err;
  }

  const provider = await providerFor(c.env, userId, 'health_coach');
  const turn = await service.runTurn(
    { userId, message: input.message, history: input.history, today: input.today },
    provider,
    { model: HealthVisionService.MODEL }
  );
  return c.json({ turn });
});

/* =============================== COACH COMMIT ============================= */

/**
 * Commit a proposal the person confirmed.
 *
 * NOT gated by `assertCanUseAI`: the AI's part is over. This writes a row the
 * person read and accepted, through the same service methods the ordinary
 * screens use, and refusing it because an entitlement lapsed between the
 * proposal and the tap would strand data the person believes they saved.
 * Consent still applies — see the gate below — because a person who revoked
 * mid-flow has withdrawn the whole feature.
 */
healthAi.post(
  '/ai/coach/commit',
  zValidator(
    'json',
    z.object({
      proposal: z.unknown(),
      confirmed_payload_hash: z.string().min(1),
      today: dateSchema,
    })
  ),
  async (c) => {
    const userId = uid(c);
    const body = c.req.valid('json');
    const service = new HealthCoachService(c.env.DB);

    const consent = await service.getConsent(userId);
    if (!consent.granted) {
      return c.json(
        { error: { code: 'coach_consent_required', message: COPY.consent_required } },
        403
      );
    }

    const result = await service.commit({
      userId,
      proposal: body.proposal,
      confirmedHash: body.confirmed_payload_hash,
      today: body.today,
    });

    if (!result.ok) {
      const message =
        result.reason === 'proposal_expired'
          ? 'That suggestion has expired. Ask the coach again and confirm the new one.'
          : result.reason === 'payload_hash_mismatch'
            ? 'Those numbers changed since the coach suggested them. Ask again and confirm the new suggestion.'
            : result.reason === 'target_unavailable'
              ? // Deliberately does not say WHICH check failed. "That habit is not
                // yours" and "that habit was renamed" are both true statements the
                // member cannot act on differently, and the first would confirm
                // whether an id exists on another account.
                'That is no longer one of your habits, so nothing was saved. Ask the coach again.'
              : 'That suggestion could not be saved. Ask the coach again.';
      // 409 for the tampered, the stale and the moved-target case — the request
      // was well-formed and the CONFLICT is with what the person confirmed.
      const status = result.reason === 'invalid_proposal' ? 400 : 409;
      return c.json({ error: { code: result.reason, message } }, status);
    }

    return c.json({
      status: result.status,
      target_type: result.target_type,
      target_id: result.target_id,
    });
  }
);

/** Recent ledger receipts — what the coach has actually written for this person. */
healthAi.get('/ai/coach/operations', async (c) => {
  const service = new HealthCoachService(c.env.DB);
  const limit = Number(c.req.query('limit') ?? 20);
  const operations = await service.listOperations(
    uid(c),
    Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 20
  );
  return c.json({ operations });
});

healthAi.get('/ai/coach/operations/:operationId', async (c) => {
  const service = new HealthCoachService(c.env.DB);
  const operation = await service.getOperation(uid(c), c.req.param('operationId'));
  // 404, never 403 — confirming that an id exists on someone else's account is
  // the leak this repo avoids everywhere else in the Health domain.
  if (!operation) {
    return c.json({ error: { code: 'not_found', message: 'Operation not found' } }, 404);
  }
  return c.json({ operation });
});

/* ================================= SCANNERS =============================== */

const imagesSchema = z.object({
  images: z
    .array(
      z.object({
        /** Raw base64, no data-URI prefix. */
        data: z.string().min(1),
        /** Advisory only — the bytes decide. See `resolveVisionImages`. */
        media_type: z.string().max(60).optional(),
      })
    )
    .min(1)
    .max(MAX_VISION_IMAGES),
});

/**
 * Nutrition label → reviewable draft. Nothing is persisted; the app saves via
 * `POST /health/custom-foods` with `source_type: 'scanned'`.
 */
healthAi.post('/ai/nutrition-label', zValidator('json', imagesSchema), async (c) => {
  const userId = uid(c);
  try {
    await assertCanUseAI(userId, c.env);
  } catch (err) {
    const mapped = denial(err);
    if (mapped) return c.json(mapped.body, mapped.status);
    throw err;
  }

  const provider = await providerFor(c.env, userId, 'health_label_scan');
  if (!provider) {
    return c.json(
      { error: { code: 'provider_unavailable', message: COPY.provider_unavailable } },
      503
    );
  }

  const result = await new HealthVisionService().scanNutritionLabel({
    provider,
    images: c.req.valid('json').images.map((i) => ({
      base64: i.data,
      declaredMediaType: i.media_type ?? '',
    })),
  });

  if (!result.ok) {
    const mapped = visionFailureResponse(result, COPY.unreadable);
    return c.json(mapped.body, mapped.status);
  }
  return c.json({ draft: result.draft });
});

/**
 * Meal photo → reviewable draft. Also reads a kitchen-scale display when one is
 * in frame (the donor's separate `/analyze-food-scale`).
 */
healthAi.post('/ai/meal-photo', zValidator('json', imagesSchema), async (c) => {
  const userId = uid(c);
  try {
    await assertCanUseAI(userId, c.env);
  } catch (err) {
    const mapped = denial(err);
    if (mapped) return c.json(mapped.body, mapped.status);
    throw err;
  }

  const provider = await providerFor(c.env, userId, 'health_meal_photo');
  if (!provider) {
    return c.json(
      { error: { code: 'provider_unavailable', message: COPY.provider_unavailable } },
      503
    );
  }

  const result = await new HealthVisionService().analyzeMealPhoto({
    provider,
    images: c.req.valid('json').images.map((i) => ({
      base64: i.data,
      declaredMediaType: i.media_type ?? '',
    })),
  });

  if (!result.ok) {
    const mapped = visionFailureResponse(result, COPY.meal_unreadable);
    return c.json(mapped.body, mapped.status);
  }
  return c.json({ draft: result.draft });
});

/* ============================ BODY-INSIGHT PRODUCER ======================= */

/**
 * Produce (and persist) one body insight from the person's own LOGGED
 * MEASUREMENTS. Photos are out of scope by product decision, so every score and
 * estimate on the row stays null — see `measurement-insight-service.ts`.
 *
 * This is the only write path to `body_comprehensive_insights`, and it is still
 * not a client-authored one: the client asks for a generation, the Worker reads
 * the rows and decides what the row says.
 */
healthAi.post(
  '/ai/body-insights/generate',
  zValidator('json', z.object({ date: dateSchema })),
  async (c) => {
    const userId = uid(c);
    const service = new HealthCoachService(c.env.DB);

    const consent = await service.getConsent(userId);
    if (!consent.granted) {
      return c.json(
        { error: { code: 'coach_consent_required', message: COPY.consent_required }, consent },
        403
      );
    }

    // An entitlement denial does NOT block this one: the deterministic summary
    // is arithmetic over the person's own readings and is theirs to see. The
    // model only ever rewrites it into prose. `ai_status` in the response says
    // which happened, and the screen prints it.
    let provider: AIProvider | null = null;
    try {
      await assertCanUseAI(userId, c.env);
      provider = await providerFor(c.env, userId, 'health_body_insight');
    } catch (err) {
      if (!denial(err)) throw err;
      provider = null;
    }

    const result = await new MeasurementInsightService(c.env.DB).generate({
      userId,
      date: c.req.valid('json').date,
      provider,
    });

    if ('refusal' in result) {
      return c.json(
        { error: { code: result.refusal, message: COPY.no_measurements } },
        422
      );
    }

    return c.json({
      insight: result.insight,
      facts: result.facts,
      ai_status: result.ai_status,
      dropped_ungrounded: result.dropped_ungrounded,
    });
  }
);

export default healthAi;
