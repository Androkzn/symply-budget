/**
 * The vision reader's two contracts: what it refuses, and what it repairs.
 *
 * This service's input is a language model's answer, so "structurally silly" is
 * the normal case rather than the edge case. Everything here asserts that a bad
 * answer degrades to a SMALLER draft or an honest refusal — never to a
 * fabricated plan, and never to `NaN` coordinates, which reach the client as
 * geometry that renders as nothing at all with no error anywhere.
 *
 * The refusal path matters as much as the parse. A half-invented yard is worse
 * than "we could not read that": the member would have to notice the invention
 * before they could stop trusting the rest of the plan.
 */
import { describe, expect, it, vi } from 'vitest';

import type { AIProvider } from '../../../ai/provider';
import { GardenPlanVisionService, normalizeVisionDraft } from '../garden-plan-vision-service';

const VOCABULARY = ['shed', 'pool', 'tree', 'driveway'];

/** A 1x1 PNG. Real magic bytes, because the service sniffs them. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function providerReturning(input: unknown): AIProvider {
  return {
    name: 'test',
    isAvailable: () => true,
    generate: vi.fn().mockResolvedValue({
      content: [{ type: 'tool_use', id: 't1', name: 'output', input }],
      stopReason: 'tool_use',
      model: 'test',
    }),
  } as unknown as AIProvider;
}

describe('GardenPlanVisionService.analyze — refusals', () => {
  it('refuses a PDF, because the provider interface has no document block', () => {
    // Recognised bytes, but there is no way to hand a PDF to a provider through
    // `GenerateMessage`. Refusing here produces copy that tells the member what
    // to do; forwarding it would earn a provider 400 they read as "broken".
    const pdfBase64 = Buffer.from('%PDF-1.7\n%âãÏÓ\n', 'latin1').toString('base64');
    return expect(
      new GardenPlanVisionService().analyze({
        provider: providerReturning({ readable: true }),
        image: { base64: pdfBase64, declaredMediaType: 'application/pdf' },
        elementVocabulary: VOCABULARY,
      })
    ).resolves.toEqual({ ok: false, reason: 'unsupported_media' });
  });

  it('refuses bytes it cannot recognise — HEIC, a truncated upload, not an image', async () => {
    const result = await new GardenPlanVisionService().analyze({
      provider: providerReturning({ readable: true }),
      image: { base64: Buffer.from('not an image at all').toString('base64') },
      elementVocabulary: VOCABULARY,
    });
    expect(result).toEqual({ ok: false, reason: 'unsupported_media' });
  });

  it('ignores a LYING declared media type and trusts the bytes', async () => {
    // A PNG announced as a JPEG must still be read. Pickers rename freely.
    const provider = providerReturning({
      readable: true,
      lot_polygon: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
    });
    const result = await new GardenPlanVisionService().analyze({
      provider,
      image: { base64: PNG_BASE64, declaredMediaType: 'image/jpeg' },
      elementVocabulary: VOCABULARY,
    });
    expect(result.ok).toBe(true);

    const call = (provider.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const imageBlock = call.messages[0].content.find(
      (b: { type: string }) => b.type === 'image'
    );
    expect(imageBlock.source.media_type).toBe('image/png');
  });

  it('reports readable=false as unreadable rather than as an empty plan', async () => {
    const result = await new GardenPlanVisionService().analyze({
      provider: providerReturning({ readable: false }),
      image: { base64: PNG_BASE64 },
      elementVocabulary: VOCABULARY,
    });
    expect(result).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('treats a "readable" answer with NO geometry as unreadable', async () => {
    // Opening an editor on an empty yard would leave the member wondering what
    // they did wrong.
    const result = await new GardenPlanVisionService().analyze({
      provider: providerReturning({ readable: true, zones: [], elements: [] }),
      image: { base64: PNG_BASE64 },
      elementVocabulary: VOCABULARY,
    });
    expect(result).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('treats a non-tool answer as unreadable', async () => {
    const provider = {
      name: 'test',
      isAvailable: () => true,
      generate: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'I think this is a garden.' }],
        stopReason: 'end_turn',
        model: 'test',
      }),
    } as unknown as AIProvider;

    const result = await new GardenPlanVisionService().analyze({
      provider,
      image: { base64: PNG_BASE64 },
      elementVocabulary: VOCABULARY,
    });
    expect(result).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('never leaks a provider error to the caller', async () => {
    const provider = {
      name: 'test',
      isAvailable: () => true,
      generate: vi.fn().mockRejectedValue(new Error('sk-ant-secret-key rejected')),
    } as unknown as AIProvider;

    const result = await new GardenPlanVisionService().analyze({
      provider,
      image: { base64: PNG_BASE64 },
      elementVocabulary: VOCABULARY,
    });
    expect(result).toEqual({ ok: false, reason: 'provider_unavailable' });
  });

  it('refuses when the caller declares no vocabulary', async () => {
    const result = await new GardenPlanVisionService().analyze({
      provider: providerReturning({ readable: true }),
      image: { base64: PNG_BASE64 },
      elementVocabulary: [],
    });
    expect(result).toEqual({ ok: false, reason: 'unsupported_media' });
  });
});

describe('normalizeVisionDraft', () => {
  it('drops a preset outside the vocabulary the caller declared', () => {
    const draft = normalizeVisionDraft(
      {
        elements: [
          { preset: 'helipad', x: 0.5, y: 0.5, width: 0.1, height: 0.1 },
          { preset: 'shed', x: 0.5, y: 0.5, width: 0.1, height: 0.1 },
        ],
      },
      VOCABULARY
    );
    expect(draft.elements.map((e) => e.preset)).toEqual(['shed']);
  });

  it('drops a polygon with fewer than three usable corners', () => {
    const draft = normalizeVisionDraft(
      {
        zones: [
          { kind: 'house', polygon: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }] },
          {
            kind: 'house',
            polygon: [
              { x: 0.1, y: 0.1 },
              { x: 0.5, y: 0.1 },
              { x: 0.5, y: 0.5 },
            ],
          },
        ],
      },
      VOCABULARY
    );
    expect(draft.zones).toHaveLength(1);
  });

  it('skips an unparseable CORNER rather than defaulting it to zero', () => {
    // A zone with three good corners and one silently-zeroed one is a zone with
    // a corner in the sea.
    const draft = normalizeVisionDraft(
      {
        zones: [
          {
            kind: 'garden',
            polygon: [
              { x: 0.1, y: 0.1 },
              { x: 'nonsense', y: 0.1 },
              { x: 0.5, y: 0.5 },
              { x: 0.1, y: 0.5 },
            ],
          },
        ],
      },
      VOCABULARY
    );
    expect(draft.zones[0].polygon).toHaveLength(3);
    expect(draft.zones[0].polygon).not.toContainEqual({ x: 0, y: 0.1 });
  });

  it('clamps a slightly out-of-range coordinate instead of dropping the corner', () => {
    // `1.02` means "the very edge"; losing the corner deforms the shape more
    // than moving it two percent does.
    const draft = normalizeVisionDraft(
      {
        zones: [
          {
            kind: 'garden',
            polygon: [
              { x: -0.05, y: 0.1 },
              { x: 1.02, y: 0.1 },
              { x: 0.5, y: 0.5 },
            ],
          },
        ],
      },
      VOCABULARY
    );
    expect(draft.zones[0].polygon[0].x).toBe(0);
    expect(draft.zones[0].polygon[1].x).toBe(1);
  });

  it('maps an unknown zone kind onto "other" and keeps the shape', () => {
    const draft = normalizeVisionDraft(
      {
        zones: [
          {
            kind: 'orchard',
            polygon: [
              { x: 0.1, y: 0.1 },
              { x: 0.5, y: 0.1 },
              { x: 0.5, y: 0.5 },
            ],
          },
        ],
      },
      VOCABULARY
    );
    expect(draft.zones[0].kind).toBe('other');
  });

  it('coerces a numeric string, as models do answer "0.5"', () => {
    const draft = normalizeVisionDraft(
      { elements: [{ preset: 'pool', x: '0.5', y: '0.25', width: '0.2', height: '0.1' }] },
      VOCABULARY
    );
    expect(draft.elements[0].x).toBe(0.5);
    expect(draft.elements[0].y).toBe(0.25);
  });

  it('drops a zero-sized element rather than storing an invisible one', () => {
    const draft = normalizeVisionDraft(
      { elements: [{ preset: 'tree', x: 0.5, y: 0.5, width: 0, height: 0.1 }] },
      VOCABULARY
    );
    expect(draft.elements).toHaveLength(0);
  });

  it('normalises rotation into [0, 360)', () => {
    const draft = normalizeVisionDraft(
      {
        elements: [
          { preset: 'shed', x: 0.5, y: 0.5, width: 0.1, height: 0.1, rotation: -90 },
          { preset: 'shed', x: 0.5, y: 0.5, width: 0.1, height: 0.1, rotation: 450 },
        ],
      },
      VOCABULARY
    );
    expect(draft.elements[0].rotation).toBe(270);
    expect(draft.elements[1].rotation).toBe(90);
  });

  it('survives every field being absent', () => {
    const draft = normalizeVisionDraft({}, VOCABULARY);
    expect(draft).toEqual({
      plan_kind: null,
      lot_polygon: null,
      zones: [],
      elements: [],
      north_heading_degrees: null,
      notes: null,
    });
  });

  it('survives arrays arriving as objects', () => {
    const draft = normalizeVisionDraft(
      { zones: {} as never, elements: 'nope' as never },
      VOCABULARY
    );
    expect(draft.zones).toEqual([]);
    expect(draft.elements).toEqual([]);
  });
});
