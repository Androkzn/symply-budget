/**
 * HEALTH-AI — the label + meal-photo scanners (`vision-service.ts`).
 *
 * THE MODEL IS ALWAYS MOCKED. Nothing here calls a real provider, so every case
 * below — including the timeout and the refusal — is deterministic.
 *
 * Three properties are worth the file:
 *
 *  1. **The bytes decide the media type, never the declared MIME.** A `.png`
 *     that actually holds JPEG bytes makes Anthropic answer 400 and the member
 *     read "could not read that label"; `HEALTH-AI-061` proves the sniffed type
 *     is what reaches the provider.
 *  2. **A scan without a per-100 basis is a food that can never be
 *     re-portioned** — the gap 0124 closed for the diary. The label's own
 *     per-100 column wins; only when there is none is the basis derived, and
 *     `per_100_source` says which.
 *  3. **Fail closed.** A provider that throws, a model that answers in prose,
 *     and a model that answers with an empty panel each produce a TYPED refusal
 *     — never a draft of nulls that looks like a real reading.
 */

import { describe, expect, it, vi } from 'vitest';

import type { RawNutritionLabel } from '../../../ai/prompts/health-nutrition-label';
import type { AIProvider, GenerateArgs, GenerateResult } from '../../../ai/provider';
import {
  HealthVisionService,
  labelDraftIsUsable,
  normalizeLabelDraft,
  normalizeMealDraft,
  resolveVisionImages,
} from '../vision-service';

/* ---------------- byte fixtures: real magic numbers ---------------- */

function b64(bytes: number[]): string {
  // Pad past 18 bytes so the sniffer's 24-char prefix decode is well-formed.
  const padded = [...bytes, ...Array.from({ length: 32 }, () => 0x00)];
  let bin = '';
  for (const b of padded) bin += String.fromCharCode(b);
  return btoa(bin);
}

const JPEG = b64([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const WEBP = b64([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
const PDF = b64([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
// HEIC: an ISO-BMFF box (`....ftypheic`) — the default an iPhone hands you, and
// a type the sniffer does not recognise and Anthropic does not accept.
const HEIC = b64([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
]);

/* ---------------- a scripted provider ---------------- */

interface Recorded {
  args: GenerateArgs;
}

function providerReturning(
  toolInput: unknown,
  recorded: Recorded[] = []
): AIProvider {
  return {
    name: 'mock',
    isAvailable: () => true,
    generate: vi.fn(async (args: GenerateArgs): Promise<GenerateResult> => {
      recorded.push({ args });
      return {
        content: [{ type: 'tool_use', id: 't1', name: 'output', input: toolInput }],
        stopReason: 'tool_use',
        model: 'mock-model',
      };
    }),
  } as unknown as AIProvider;
}

function providerReturningText(text: string): AIProvider {
  return {
    name: 'mock',
    isAvailable: () => true,
    generate: vi.fn(async (): Promise<GenerateResult> => ({
      content: [{ type: 'text', text }],
      stopReason: 'end_turn',
      model: 'mock-model',
    })),
  } as unknown as AIProvider;
}

function providerThrowing(err: Error): AIProvider {
  return {
    name: 'mock',
    isAvailable: () => true,
    generate: vi.fn(async () => {
      throw err;
    }),
  } as unknown as AIProvider;
}

const LABEL_OK: Partial<RawNutritionLabel> = {
  product_name: 'Greek Yoghurt',
  brand: 'Symply Dairy',
  serving_size: '3/4 cup (170g)',
  serving_size_g: 170,
  serving_size_unit: 'g',
  servings_per_container: 4,
  calories: 150,
  total_fat: 4,
  protein: 15,
  total_carbohydrates: 12,
  per_100_calories: null,
  confidence: 0.94,
};

describe('Symply Health vision — media type', () => {
  it('HEALTH-AI-060: each supported signature is recognised from its bytes', () => {
    for (const [data, expected] of [
      [JPEG, 'image/jpeg'],
      [PNG, 'image/png'],
      [WEBP, 'image/webp'],
    ] as const) {
      const out = resolveVisionImages([{ base64: data, declaredMediaType: '' }]);
      expect(out.ok).toBe(true);
      if (out.ok) expect(out.images[0].mediaType).toBe(expected);
    }
  });

  it('HEALTH-AI-061: a JPEG DECLARED as PNG is sent as image/jpeg', async () => {
    // The exact failure `ai/media-type.ts` exists for: Anthropic hard-rejects
    // the mismatch and the member sees a generic "could not read".
    const recorded: Recorded[] = [];
    const provider = providerReturning(LABEL_OK, recorded);
    const result = await new HealthVisionService().scanNutritionLabel({
      provider,
      images: [{ base64: JPEG, declaredMediaType: 'image/png' }],
    });

    expect(result.ok).toBe(true);
    const block = (recorded[0].args.messages[0].content as Array<Record<string, unknown>>).find(
      (b) => b.type === 'image'
    ) as { source: { media_type: string } };
    expect(block.source.media_type).toBe('image/jpeg');
  });

  it('HEALTH-AI-062: a PNG declared as JPEG is likewise corrected', async () => {
    const recorded: Recorded[] = [];
    await new HealthVisionService().scanNutritionLabel({
      provider: providerReturning(LABEL_OK, recorded),
      images: [{ base64: PNG, declaredMediaType: 'image/jpeg' }],
    });
    const block = (recorded[0].args.messages[0].content as Array<Record<string, unknown>>).find(
      (b) => b.type === 'image'
    ) as { source: { media_type: string } };
    expect(block.source.media_type).toBe('image/png');
  });

  it('HEALTH-AI-063: HEIC is REFUSED, not forwarded to fail at the provider', async () => {
    const provider = providerThrowing(new Error('should never be called'));
    const result = await new HealthVisionService().scanNutritionLabel({
      provider,
      images: [{ base64: HEIC, declaredMediaType: 'image/jpeg' }],
    });
    expect(result).toEqual({ ok: false, reason: 'unsupported_media' });
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('HEALTH-AI-064: a PDF is refused — it is not a photograph of food', () => {
    expect(resolveVisionImages([{ base64: PDF, declaredMediaType: 'application/pdf' }])).toEqual({
      ok: false,
      reason: 'unsupported_media',
    });
  });

  it('HEALTH-AI-065: an empty batch and an over-long batch are both refused', () => {
    expect(resolveVisionImages([])).toEqual({ ok: false, reason: 'unsupported_media' });
    const many = Array.from({ length: 5 }, () => ({ base64: JPEG, declaredMediaType: '' }));
    expect(resolveVisionImages(many)).toEqual({ ok: false, reason: 'unsupported_media' });
  });

  it('HEALTH-AI-066: ONE bad frame refuses the whole batch', () => {
    // A silent partial read would leave the person unable to tell which half of
    // their two-shot label the answer came from.
    expect(
      resolveVisionImages([
        { base64: JPEG, declaredMediaType: 'image/jpeg' },
        { base64: HEIC, declaredMediaType: 'image/jpeg' },
      ])
    ).toEqual({ ok: false, reason: 'unsupported_media' });
  });
});

describe('Symply Health vision — nutrition label', () => {
  it('HEALTH-AI-067: a clean panel derives the per-100 basis from the serving mass', () => {
    const draft = normalizeLabelDraft(LABEL_OK);
    expect(draft.per_100_source).toBe('derived');
    // 150 kcal / 170 g × 100 = 88.2
    expect(draft.base_calories_per_100).toBe(88.2);
    expect(draft.base_proteins_per_100).toBe(8.8);
    expect(draft.calories).toBe(150);
  });

  it('HEALTH-AI-068: a printed per-100 column WINS over the derivation', () => {
    // EU/UK labels always print one; copying it beats dividing a rounded
    // serving figure, and `per_100_source` lets the screen say which it was.
    const draft = normalizeLabelDraft({
      ...LABEL_OK,
      per_100_calories: 88,
      per_100_protein: 9,
      per_100_carbohydrates: 7,
      per_100_fat: 2.4,
    });
    expect(draft.per_100_source).toBe('label');
    expect(draft.base_calories_per_100).toBe(88);
    expect(draft.base_proteins_per_100).toBe(9);
  });

  it('HEALTH-AI-069: no serving mass and no per-100 column means NO basis, stated', () => {
    const draft = normalizeLabelDraft({ ...LABEL_OK, serving_size_g: null });
    expect(draft.per_100_source).toBe('none');
    expect(draft.base_calories_per_100).toBeNull();
    // Still usable: the serving figures are real, the food just cannot be
    // re-portioned. That is exactly what 0124 calls an honest null.
    expect(labelDraftIsUsable(draft)).toBe(true);
  });

  it('HEALTH-AI-070: a numeric string is coerced, junk is not', () => {
    const draft = normalizeLabelDraft({
      ...LABEL_OK,
      calories: '150' as unknown as number,
      protein: 'about fifteen' as unknown as number,
    });
    expect(draft.calories).toBe(150);
    expect(draft.proteins).toBeNull();
  });

  it('HEALTH-AI-071: an all-null reading is UNREADABLE, never an empty draft', async () => {
    // The donor's own UI rule ("The scan returned all zeros…"), enforced on the
    // server so every client gets it.
    const result = await new HealthVisionService().scanNutritionLabel({
      provider: providerReturning({ product_name: 'Mystery', calories: null }),
      images: [{ base64: JPEG, declaredMediaType: 'image/jpeg' }],
    });
    expect(result).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('HEALTH-AI-072: a model that answers in PROSE is unreadable, not parsed', () => {
    return expect(
      new HealthVisionService().scanNutritionLabel({
        provider: providerReturningText('I cannot read nutrition labels.'),
        images: [{ base64: JPEG, declaredMediaType: 'image/jpeg' }],
      })
    ).resolves.toEqual({ ok: false, reason: 'unreadable' });
  });

  it('HEALTH-AI-073: garbage in the tool block is unreadable, not a crash', async () => {
    const provider = {
      name: 'mock',
      isAvailable: () => true,
      generate: vi.fn(async (): Promise<GenerateResult> => ({
        content: [{ type: 'tool_use', id: 't', name: 'output', input: 'not an object' }],
        stopReason: 'tool_use',
        model: 'mock',
      })),
    } as unknown as AIProvider;
    await expect(
      new HealthVisionService().scanNutritionLabel({
        provider,
        images: [{ base64: JPEG, declaredMediaType: 'image/jpeg' }],
      })
    ).resolves.toEqual({ ok: false, reason: 'unreadable' });
  });

  it('HEALTH-AI-074: a provider TIMEOUT surfaces as provider_unavailable, never as text', async () => {
    const timeout = Object.assign(new Error('Request timed out after 120000ms'), {
      name: 'APIConnectionTimeoutError',
    });
    const result = await new HealthVisionService().scanNutritionLabel({
      provider: providerThrowing(timeout),
      images: [{ base64: JPEG, declaredMediaType: 'image/jpeg' }],
    });
    expect(result).toEqual({ ok: false, reason: 'provider_unavailable' });
    // The raw message must not be part of the refusal — no-raw-error-leaks.
    expect(JSON.stringify(result)).not.toContain('120000');
  });

  it('HEALTH-AI-075: a provider REFUSAL is provider-unavailable-shaped, not a draft', async () => {
    // A model that declines (safety refusal) answers with text and no tool
    // block; it must never become a draft of nulls.
    await expect(
      new HealthVisionService().scanNutritionLabel({
        provider: providerReturningText('I am not able to help with that request.'),
        images: [{ base64: JPEG, declaredMediaType: 'image/jpeg' }],
      })
    ).resolves.toEqual({ ok: false, reason: 'unreadable' });
  });

  it('HEALTH-AI-076: both frames of a two-shot label reach the model, in order', async () => {
    const recorded: Recorded[] = [];
    await new HealthVisionService().scanNutritionLabel({
      provider: providerReturning(LABEL_OK, recorded),
      images: [
        { base64: JPEG, declaredMediaType: 'image/jpeg' },
        { base64: PNG, declaredMediaType: 'image/png' },
      ],
    });
    const blocks = (recorded[0].args.messages[0].content as Array<Record<string, unknown>>).filter(
      (b) => b.type === 'image'
    ) as Array<{ source: { media_type: string } }>;
    expect(blocks.map((b) => b.source.media_type)).toEqual(['image/jpeg', 'image/png']);
  });

  it('HEALTH-AI-077: the label call forces the output tool', async () => {
    const recorded: Recorded[] = [];
    await new HealthVisionService().scanNutritionLabel({
      provider: providerReturning(LABEL_OK, recorded),
      images: [{ base64: JPEG, declaredMediaType: 'image/jpeg' }],
    });
    expect(recorded[0].args.toolChoice).toEqual({ type: 'tool', name: 'output' });
    expect(recorded[0].args.tools?.[0].name).toBe('output');
  });
});

describe('Symply Health vision — meal photo', () => {
  it('HEALTH-AI-078: rows are kept with their provenance, and the total is RECOMPUTED', () => {
    // The donor returns the model's own `total_calories`, which disagrees with
    // its own rows often enough to be noticed. Ours is always the sum.
    const draft = normalizeMealDraft({
      foods: [
        { food_name: 'Chicken breast', calories: 165, data_source: 'estimation', confidence: 0.5 },
        { food_name: 'Rice', calories: 200, data_source: 'product_database', confidence: 0.85 },
      ] as never,
      total_calories: 999,
    });
    expect(draft.total_calories).toBe(365);
    expect(draft.foods.map((f) => f.data_source)).toEqual(['estimation', 'product_database']);
  });

  it('HEALTH-AI-079: a row with an unknown energy makes the TOTAL unknown, not partial', () => {
    const draft = normalizeMealDraft({
      foods: [
        { food_name: 'Chicken breast', calories: 165 },
        { food_name: 'Mystery sauce', calories: null },
      ] as never,
    });
    expect(draft.total_calories).toBeNull();
  });

  it('HEALTH-AI-080: a nameless row is dropped rather than shown as blank', () => {
    const draft = normalizeMealDraft({
      foods: [{ food_name: '   ', calories: 100 }, { food_name: 'Toast', calories: 90 }] as never,
    });
    expect(draft.foods.map((f) => f.food_name)).toEqual(['Toast']);
  });

  it('HEALTH-AI-081: a scale reading is carried through only when it was detected', () => {
    const withScale = normalizeMealDraft({
      foods: [{ food_name: 'Oats' }] as never,
      scale_reading: { value: 62, unit: 'g', detected: true } as never,
    });
    expect(withScale.scale_reading).toEqual({ value: 62, unit: 'g', detected: true });

    const without = normalizeMealDraft({ foods: [{ food_name: 'Oats' }] as never });
    expect(without.scale_reading).toBeNull();
  });

  it('HEALTH-AI-082: "not food" is an EMPTY list, which is a legitimate answer', async () => {
    // Unlike a label, where no energy figure means the read failed: the honest
    // answer to "what food is in this photo of a wall" is "none".
    const result = await new HealthVisionService().analyzeMealPhoto({
      provider: providerReturning({ foods: [], image_quality: 'poor', notes: 'A blank wall.' }),
      images: [{ base64: JPEG, declaredMediaType: 'image/jpeg' }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.foods).toEqual([]);
      expect(result.draft.notes).toContain('wall');
    }
  });

  it('HEALTH-AI-083: a provider failure on the meal path also fails closed', async () => {
    await expect(
      new HealthVisionService().analyzeMealPhoto({
        provider: providerThrowing(new Error('502 upstream')),
        images: [{ base64: JPEG, declaredMediaType: 'image/jpeg' }],
      })
    ).resolves.toEqual({ ok: false, reason: 'provider_unavailable' });
  });

  it('HEALTH-AI-084: a `foods` that is not a LIST yields an empty meal, never a crash', () => {
    // The model is asked for an array; it occasionally answers an object, a
    // string, or omits the key. Each has to be an empty meal, not a 500.
    for (const foods of [undefined, null, 'chicken and rice', { food_name: 'Rice' }, 42]) {
      const draft = normalizeMealDraft({ foods } as never);
      expect(draft.foods).toEqual([]);
      // No rows → no energy figure to claim.
      expect(draft.total_calories).toBe(0);
    }
  });

  it('HEALTH-AI-085: a NULL element inside the list is skipped, not read as a food', () => {
    const draft = normalizeMealDraft({
      foods: [null, { food_name: 'Toast', calories: 90 }, undefined] as never,
    });
    expect(draft.foods.map((f) => f.food_name)).toEqual(['Toast']);
  });

  it('HEALTH-AI-086: a recognised meal slot is kept and an invented one is dropped', () => {
    // The slot goes straight into a CHECK-constrained column when the person
    // saves the draft, so "brunch" must never survive this far.
    expect(
      normalizeMealDraft({ foods: [{ food_name: 'Oats' }] as never, meal_type: 'breakfast' } as never)
        .meal_type
    ).toBe('breakfast');
    expect(
      normalizeMealDraft({ foods: [{ food_name: 'Oats' }] as never, meal_type: 'brunch' } as never)
        .meal_type
    ).toBeNull();
  });
});

describe('Symply Health vision — image guards the route cannot enforce', () => {
  it('HEALTH-AI-087: an EMPTY payload for a frame is refused before any provider call', () => {
    // The route's zod schema requires `min(1)`, but the service is exported and
    // called in-process; a zero-length frame must not be forwarded to fail.
    expect(
      resolveVisionImages([{ base64: '', declaredMediaType: 'image/jpeg' }])
    ).toEqual({ ok: false, reason: 'unsupported_media' });
  });
});

describe('Symply Health vision — label edge shapes', () => {
  it('HEALTH-AI-088: a DRINK label keeps millilitres as its serving unit', () => {
    // `serving_size_unit` is a closed pair; anything that is not g or ml is
    // null, and ml must not be silently rewritten to g.
    expect(normalizeLabelDraft({ ...LABEL_OK, serving_size_unit: 'ml' }).serving_size_unit).toBe(
      'ml'
    );
    expect(
      normalizeLabelDraft({ ...LABEL_OK, serving_size_unit: 'oz' as never }).serving_size_unit
    ).toBeNull();
  });

  it('HEALTH-AI-089: a macro the panel does not print stays NULL in the derived basis', () => {
    // A zero would be a claim the label never made — "0 g of protein" reads as
    // a measurement, and every portion derived from it would inherit it.
    const draft = normalizeLabelDraft({
      ...LABEL_OK,
      protein: null,
      total_carbohydrates: null,
      total_fat: null,
    });
    expect(draft.per_100_source).toBe('derived');
    expect(draft.base_calories_per_100).toBe(88.2);
    expect(draft.base_proteins_per_100).toBeNull();
    expect(draft.base_carbs_per_100).toBeNull();
    expect(draft.base_fats_per_100).toBeNull();
  });
});
