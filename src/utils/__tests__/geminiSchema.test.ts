import { RECEIPT_IMPORT_SCHEMA } from '@features/budget/local/ai/prompts/receiptImport';

import { toGeminiResponseSchema } from '../geminiSchema';

/**
 * Regression guard for the 2026-08-14 Budget receipt-scan outage: the strict
 * OpenAI/Anthropic schema was posted verbatim as Gemini's `responseSchema` and
 * came back HTTP 400 before the model ever saw the photo, surfacing as
 * "Could not read that receipt."
 *
 * The two assertions that matter are the two things Gemini actually named:
 *   Unknown name "additionalProperties" … Cannot find field.
 *   Unknown name "type" … Proto field is not repeating, cannot start list.
 */
describe('toGeminiResponseSchema', () => {
  it('strips additionalProperties at every level', () => {
    const out = toGeminiResponseSchema({
      type: 'object',
      additionalProperties: false,
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {},
          },
        },
      },
    });

    expect(JSON.stringify(out)).not.toContain('additionalProperties');
  });

  it('converts a [T, null] union into type + nullable', () => {
    const out = toGeminiResponseSchema({
      type: 'object',
      properties: { vendor: { type: ['string', 'null'] } },
    });

    expect((out.properties as Record<string, unknown>).vendor).toEqual({
      type: 'string',
      nullable: true,
    });
  });

  it('leaves a scalar type untouched and keeps enum/description', () => {
    const out = toGeminiResponseSchema({
      type: 'object',
      properties: {
        amount: { type: 'integer', description: 'Pre-tax cents paid' },
        priority: { type: 'string', enum: ['high', 'low'] },
      },
    });

    const props = out.properties as Record<string, Record<string, unknown>>;
    expect(props.amount).toEqual({
      type: 'integer',
      description: 'Pre-tax cents paid',
    });
    expect(props.priority).toEqual({ type: 'string', enum: ['high', 'low'] });
  });

  it('recurses through array items', () => {
    const out = toGeminiResponseSchema({
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { category: { type: ['string', 'null'] } },
      },
    });

    const items = out.items as Record<string, unknown>;
    expect(items).not.toHaveProperty('additionalProperties');
    expect((items.properties as Record<string, unknown>).category).toEqual({
      type: 'string',
      nullable: true,
    });
  });

  it('does not mutate the input — the same constant still goes to OpenAI/Anthropic', () => {
    const before = JSON.stringify(RECEIPT_IMPORT_SCHEMA);
    toGeminiResponseSchema(RECEIPT_IMPORT_SCHEMA);
    expect(JSON.stringify(RECEIPT_IMPORT_SCHEMA)).toBe(before);
  });

  it('makes the real receipt schema Gemini-clean', () => {
    const out = toGeminiResponseSchema(RECEIPT_IMPORT_SCHEMA);
    const serialized = JSON.stringify(out);

    // Neither thing Gemini rejected may survive anywhere in the tree.
    expect(serialized).not.toContain('additionalProperties');
    expect(serialized).not.toContain('["string","null"]');

    // …and the parts Gemini needs must still be intact. These assert the
    // TRANSFORMATION, not the prompt: the receipt schema gains fields and
    // descriptions every time the scanner is tuned (vendor stopped being
    // nullable in acdf9340d), and hardcoding its literal shape here just made
    // this guard fail on prompt edits that never touched geminiSchema.
    const props = out.properties as Record<string, Record<string, unknown>>;

    // A union type collapses to the scalar + `nullable: true`.
    expect(props.purchase_date).toEqual({ type: 'string', nullable: true });
    // A plain scalar is passed through untouched — no `nullable` invented …
    expect(props.vendor).toEqual(expect.objectContaining({ type: 'string' }));
    expect(props.vendor.nullable).toBeUndefined();
    // … and Gemini-legal annotations survive the cleaning.
    expect(props.vendor.description).toBe(
      (
        RECEIPT_IMPORT_SCHEMA.properties as Record<
          string,
          Record<string, unknown>
        >
      ).vendor.description,
    );

    // `required` is carried through verbatim, whatever the prompt lists today.
    expect(out.required).toEqual(RECEIPT_IMPORT_SCHEMA.required);

    const itemProps = (
      props.items.items as Record<string, Record<string, unknown>>
    ).properties as Record<string, Record<string, unknown>>;
    expect(itemProps.name).toEqual({ type: 'string' });
    expect(itemProps.category).toEqual({ type: 'string', nullable: true });
    // Nested unions are cleaned too, not just top-level ones.
    expect(itemProps.raw_code).toEqual({ type: 'string', nullable: true });
  });
});

/**
 * The material-listing schema, run through the translator for real.
 *
 * "All AI features must work equally on all three providers" is the actual
 * requirement, and the link importer is the one that leans hardest on the
 * schema: three optional enums decide whether a tile is priced per box or per
 * square foot, and every one of them carried a `null` member.
 */
describe('the material-listing schema survives the trip to Gemini', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EXTRACT_MATERIAL_LISTING_SCHEMA } = require('@symply/contracts') as {
    EXTRACT_MATERIAL_LISTING_SCHEMA: Record<string, unknown>;
  };
  const converted = toGeminiResponseSchema(EXTRACT_MATERIAL_LISTING_SCHEMA);
  const props = (converted.properties ?? {}) as Record<
    string,
    Record<string, unknown>
  >;

  /** `Schema.enum` is `repeated string`; a null member cannot be held at all. */
  it('leaves no null inside any enum', () => {
    const nulls: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (!node || typeof node !== 'object') return;
      const obj = node as Record<string, unknown>;
      if (Array.isArray(obj.enum) && obj.enum.some(v => v === null)) {
        nulls.push(path);
      }
      for (const [key, value] of Object.entries(obj)) {
        if (value && typeof value === 'object') walk(value, `${path}.${key}`);
      }
    };
    walk(converted, 'root');
    expect(nulls).toEqual([]);
  });

  /** Dropping the member must not drop the nullability it stood for. */
  it('keeps those fields nullable through `nullable`, not through the enum', () => {
    for (const field of [
      'price_basis',
      'coverage_unit',
      'price_per_area_unit',
    ]) {
      expect(props[field]!.nullable).toBe(true);
      expect(props[field]!.enum).not.toContain(null);
      expect((props[field]!.enum as string[]).length).toBeGreaterThan(0);
    }
  });

  /** A required enum keeps every one of its members. */
  it('leaves a non-nullable enum alone', () => {
    expect(props.confidence!.enum).toEqual(['high', 'medium', 'low']);
    expect(props.confidence!.nullable).toBeUndefined();
  });

  it('strips the strict-mode keyword Gemini has no field for', () => {
    expect(converted.additionalProperties).toBeUndefined();
    expect(
      (props.specs!.items as Record<string, unknown>).additionalProperties,
    ).toBeUndefined();
  });

  /** The fields the widened extraction added must arrive intact. */
  it('carries the fields a full listing needs', () => {
    for (const field of [
      'dimensions',
      'pieces_per_unit',
      'price_per_area_amount',
      'availability',
      'coverage_per_unit',
      'image_url',
    ]) {
      expect(props[field]).toBeDefined();
    }
  });
});
