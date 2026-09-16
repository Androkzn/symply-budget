/**
 * JSON Schema → Gemini `responseSchema`.
 *
 * Gemini's structured-output schema is a proto-backed subset of OpenAPI 3.0, not
 * JSON Schema. Two things our OpenAI/Anthropic schemas use are hard errors there:
 *
 *   additionalProperties: false   → "Unknown name \"additionalProperties\" at
 *                                    'generation_config.response_schema':
 *                                    Cannot find field."
 *   type: ['string', 'null']      → "Proto field is not repeating, cannot start
 *                                    list." (Schema.type is a single enum)
 *   enum: ['box', …, null]        → `Schema.enum` is `repeated string`; a null
 *                                    member cannot be represented at all
 *
 * Both are silent design mismatches rather than bugs in the schema — OpenAI
 * strict mode REQUIRES `additionalProperties: false`, and a `[T, 'null']` union
 * is the standard way to say nullable. So the schemas stay as they are and this
 * translates on the way out, per provider.
 *
 * Observed for real 2026-08-14: every Budget receipt scan on a Gemini BYOK key
 * failed with HTTP 400 before the model ever saw the photo, surfacing to the
 * member as "Could not read that receipt."
 */

/** JSON Schema keywords Gemini's proto schema has no field for. */
const UNSUPPORTED_KEYWORDS = new Set([
  'additionalProperties',
  '$schema',
  '$defs',
  'definitions',
  'patternProperties',
  'const',
  'default',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Convert one node. `type: ['string', 'null']` becomes `type: 'string'` plus
 * `nullable: true`; a union of two NON-null types cannot be expressed and is
 * left to Gemini to reject loudly rather than silently narrowed here.
 */
function convertNode(node: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(node)) {
    if (UNSUPPORTED_KEYWORDS.has(key)) continue;

    if (key === 'enum' && Array.isArray(value)) {
      /*
        `null` is not an enum member here.

        Gemini's `Schema.enum` is `repeated string` in the proto, so a null
        element cannot be represented — the field is either dropped or the whole
        request is rejected, and either way an extraction that OpenAI and
        Anthropic answer fine comes back empty on Gemini. Nullability is already
        carried by `nullable: true` from the `type` union beside it, which is
        the OpenAPI way of saying the same thing, so dropping the member loses
        nothing.

        This bites every optional enum we have — `price_basis`, `coverage_unit`,
        `price_per_area_unit` — which is most of what decides whether a material
        is priced per box or per square foot.
      */
      out.enum = value.filter(entry => entry !== null);
      continue;
    }

    if (key === 'type' && Array.isArray(value)) {
      const types = value.filter((t) => t !== 'null');
      if (value.includes('null')) out.nullable = true;
      if (types.length === 1) {
        out.type = types[0];
      } else if (types.length > 0) {
        // Genuinely ambiguous (e.g. ['string','number']) — pass through so the
        // 400 names the offending field instead of us guessing wrong.
        out.type = types;
      }
      continue;
    }

    if (key === 'properties' && isPlainObject(value)) {
      const properties: Record<string, unknown> = {};
      for (const [propName, propSchema] of Object.entries(value)) {
        properties[propName] = isPlainObject(propSchema) ? convertNode(propSchema) : propSchema;
      }
      out.properties = properties;
      continue;
    }

    if (key === 'items' && isPlainObject(value)) {
      out.items = convertNode(value);
      continue;
    }

    if ((key === 'anyOf' || key === 'oneOf' || key === 'allOf') && Array.isArray(value)) {
      // Gemini supports anyOf only; the others collapse to it.
      out.anyOf = value.map((v) => (isPlainObject(v) ? convertNode(v) : v));
      continue;
    }

    out[key] = value;
  }

  return out;
}

/**
 * Translate a JSON Schema into the shape Gemini's `generationConfig.responseSchema`
 * accepts. Pure — the input schema is never mutated, so the same constant can
 * still be handed verbatim to OpenAI and Anthropic.
 */
export function toGeminiResponseSchema(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  return convertNode(schema);
}
