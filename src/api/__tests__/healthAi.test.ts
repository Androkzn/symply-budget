/**
 * `healthAiApi` — the AI coach + scanner + body-insight client.
 *
 * `healthEnvelope.test.ts` already pins, at the SOURCE level, that this module
 * calls `apiClient` directly and never the `api.*` helper (the envelope-shape
 * bug the header documents). This file is the runtime half: every exported
 * method really does hit the URL/verb the Worker route table expects, the two
 * long-running calls (a vision scan, a coach turn) carry `AI_TIMEOUT_MS`
 * rather than the 30s axios default, and the response is unwrapped from the
 * ONE axios `.data` layer — never a second one.
 */

jest.mock('../client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
  },
}));

import { apiClient } from '../client';
import { AI_TIMEOUT_MS, healthAiApi, HEALTH_FLOW_LEVEL_LABELS } from '../healthAi';

const mockGet = apiClient.get as jest.Mock;
const mockPost = apiClient.post as jest.Mock;
const mockPut = apiClient.put as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AI_TIMEOUT_MS', () => {
  it('is 2 minutes — far past the 30s axios default a vision call routinely outruns', () => {
    expect(AI_TIMEOUT_MS).toBe(120000);
  });
});

describe('coach consent', () => {
  it('getCoachConsent GETs /health/ai/coach/consent and unwraps the ONE axios .data layer', async () => {
    const consent = { granted: true, version: 'v1', granted_at: null, revoked_at: null, required_version: 'v1' };
    mockGet.mockResolvedValue({ data: { consent } });
    const result = await healthAiApi.getCoachConsent();
    expect(mockGet).toHaveBeenCalledWith('/health/ai/coach/consent');
    expect(result).toEqual({ consent });
  });

  it('setCoachConsent PUTs the granted flag as the whole body', async () => {
    mockPut.mockResolvedValue({ data: { consent: {} } });
    await healthAiApi.setCoachConsent(true);
    expect(mockPut).toHaveBeenCalledWith('/health/ai/coach/consent', { granted: true });

    await healthAiApi.setCoachConsent(false);
    expect(mockPut).toHaveBeenCalledWith('/health/ai/coach/consent', { granted: false });
  });
});

describe('coachTurn', () => {
  it('POSTs the payload verbatim, with the AI timeout — never sends any local health figures', async () => {
    mockPost.mockResolvedValue({ data: { turn: { kind: 'reply' } } });
    const payload = { message: 'How am I doing?', today: '2026-07-26', history: [{ role: 'user' as const, text: 'hi' }] };

    await healthAiApi.coachTurn(payload);

    expect(mockPost).toHaveBeenCalledWith('/health/ai/coach/turn', payload, { timeout: AI_TIMEOUT_MS });
  });

  it('unwraps { turn } from the bare server response', async () => {
    const turn = { kind: 'proposal', reply: null };
    mockPost.mockResolvedValue({ data: { turn } });
    const result = await healthAiApi.coachTurn({ message: 'x', today: '2026-07-26' });
    expect(result.turn).toEqual(turn);
  });
});

describe('commitProposal', () => {
  it('sends the proposal, the hash lifted from THAT SAME proposal, and today — never a client-recomputed hash', async () => {
    mockPost.mockResolvedValue({
      data: { status: 'committed', target_type: 'water', target_id: 'e1' },
    });
    const proposal = {
      operation_id: 'op1',
      operation_type: 'create' as const,
      target_type: 'water' as const,
      original_text: 'log 500ml',
      normalized_payload: { kind: 'water' as const, amount_ml: 500 },
      payload_hash: 'abc123',
      expires_at: '2026-07-26T09:00:00.000Z',
      commit_status: 'proposed' as const,
    };

    const result = await healthAiApi.commitProposal({ proposal, today: '2026-07-26' });

    expect(mockPost).toHaveBeenCalledWith('/health/ai/coach/commit', {
      proposal,
      confirmed_payload_hash: 'abc123',
      today: '2026-07-26',
    });
    expect(result.status).toBe('committed');
  });
});

describe('listCoachOperations / getCoachOperation', () => {
  it('listCoachOperations omits params when no limit is given, and sends it when one is', async () => {
    mockGet.mockResolvedValue({ data: { operations: [] } });
    await healthAiApi.listCoachOperations();
    expect(mockGet).toHaveBeenCalledWith('/health/ai/coach/operations', { params: undefined });

    await healthAiApi.listCoachOperations(10);
    expect(mockGet).toHaveBeenCalledWith('/health/ai/coach/operations', { params: { limit: 10 } });
  });

  it('getCoachOperation URL-encodes the operation id', async () => {
    mockGet.mockResolvedValue({ data: { operation: {} } });
    await healthAiApi.getCoachOperation('op with spaces/slash');
    expect(mockGet).toHaveBeenCalledWith(
      `/health/ai/coach/operations/${encodeURIComponent('op with spaces/slash')}`
    );
  });
});

describe('scanners', () => {
  it('scanNutritionLabel POSTs the images array with the AI timeout, persists nothing else', async () => {
    mockPost.mockResolvedValue({ data: { draft: {} } });
    const images = [{ data: 'base64==', media_type: 'image/jpeg' }];
    await healthAiApi.scanNutritionLabel(images);
    expect(mockPost).toHaveBeenCalledWith('/health/ai/nutrition-label', { images }, { timeout: AI_TIMEOUT_MS });
  });

  it('analyzeMealPhoto POSTs to /health/ai/meal-photo with the AI timeout', async () => {
    mockPost.mockResolvedValue({ data: { draft: {} } });
    const images = [{ data: 'base64==' }];
    await healthAiApi.analyzeMealPhoto(images);
    expect(mockPost).toHaveBeenCalledWith('/health/ai/meal-photo', { images }, { timeout: AI_TIMEOUT_MS });
  });
});

describe('generateBodyInsight', () => {
  it('POSTs the caller-supplied date with the AI timeout and returns the bare result (no { insight } re-wrap)', async () => {
    const body = { insight: {}, facts: {}, ai_status: 'ok' as const, dropped_ungrounded: 0 };
    mockPost.mockResolvedValue({ data: body });
    const result = await healthAiApi.generateBodyInsight('2026-07-20');
    expect(mockPost).toHaveBeenCalledWith(
      '/health/ai/body-insights/generate',
      { date: '2026-07-20' },
      { timeout: AI_TIMEOUT_MS }
    );
    expect(result).toEqual(body);
  });
});

describe('HEALTH_FLOW_LEVEL_LABELS', () => {
  it('labels the donor 1-5 scale in words, never a bare level', () => {
    expect(HEALTH_FLOW_LEVEL_LABELS[1]).toBe('Spotting');
    expect(HEALTH_FLOW_LEVEL_LABELS[5]).toBe('Very heavy');
  });
});
