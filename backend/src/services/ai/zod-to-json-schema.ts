/**
 * Minimal zod → JSON Schema converter for Aihousekeeper tool definitions.
 *
 * Anthropic's tools API expects `input_schema` as JSON Schema. Aihousekeeper tools
 * declare `input: z.object({...})`. This converter covers the subset of zod
 * types actually used by Aihousekeeper's 14 tools — strings, numbers, booleans,
 * arrays, enums, literals, optional. Anything more exotic falls back to
 * `{ type: 'string' }` so the tool still registers.
 *
 * Third-party `zod-to-json-schema` would do this more completely, but
 * adding a dependency for ~30 lines of logic isn't worth it while Aihousekeeper's
 * schemas stay simple.
 */

import { z } from 'zod';

type JsonSchema = Record<string, unknown>;

function unwrapOptional(schema: z.ZodTypeAny): {
  inner: z.ZodTypeAny;
  isOptional: boolean;
} {
  if (schema instanceof z.ZodOptional) {
    return { inner: schema._def.innerType as z.ZodTypeAny, isOptional: true };
  }
  if (schema instanceof z.ZodDefault) {
    return {
      inner: schema._def.innerType as z.ZodTypeAny,
      isOptional: true,
    };
  }
  if (schema instanceof z.ZodNullable) {
    return {
      inner: schema._def.innerType as z.ZodTypeAny,
      isOptional: false,
    };
  }
  // `.refine()` / `.superRefine()` / `.transform()` wrap the original schema
  // in a ZodEffects. Peel it so we see the underlying object/leaf — otherwise
  // a refined tool input would fall through to the string fallback and
  // Anthropic rejects the tool with "input_schema.type should be object".
  if (schema instanceof z.ZodEffects) {
    return {
      inner: schema._def.schema as z.ZodTypeAny,
      isOptional: false,
    };
  }
  return { inner: schema, isOptional: false };
}

function zodLeafToJson(schema: z.ZodTypeAny): JsonSchema {
  // String with min/max/enum/email/url/etc.
  if (schema instanceof z.ZodString) {
    const out: JsonSchema = { type: 'string' };
    const checks = (schema._def.checks ?? []) as Array<{
      kind: string;
      value?: number;
    }>;
    for (const c of checks) {
      if (c.kind === 'min' && typeof c.value === 'number')
        out.minLength = c.value;
      if (c.kind === 'max' && typeof c.value === 'number')
        out.maxLength = c.value;
    }
    return out;
  }
  if (schema instanceof z.ZodNumber) {
    return { type: 'number' };
  }
  if (schema instanceof z.ZodBoolean) {
    return { type: 'boolean' };
  }
  if (schema instanceof z.ZodEnum) {
    return {
      type: 'string',
      enum: (schema._def.values as string[]).slice(),
    };
  }
  if (schema instanceof z.ZodNativeEnum) {
    return {
      type: 'string',
      enum: Object.values(schema._def.values as Record<string, string>),
    };
  }
  if (schema instanceof z.ZodLiteral) {
    const v = schema._def.value;
    return { const: v };
  }
  if (schema instanceof z.ZodArray) {
    const item = schema._def.type as z.ZodTypeAny;
    return { type: 'array', items: zodToJsonSchema(item) };
  }
  if (schema instanceof z.ZodObject) {
    return zodObjectToJson(schema);
  }
  if (schema instanceof z.ZodUnion) {
    // Use anyOf for simple unions. Falls back to string if branches are exotic.
    const options = schema._def.options as z.ZodTypeAny[];
    return { anyOf: options.map((o) => zodToJsonSchema(o)) };
  }
  // Fallback — unknown zod type. Accept as a string so tool still registers.
  return { type: 'string' };
}

function zodObjectToJson(schema: z.ZodObject<z.ZodRawShape>): JsonSchema {
  const shape = schema.shape as Record<string, z.ZodTypeAny>;
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const [key, fieldSchema] of Object.entries(shape)) {
    const { inner, isOptional } = unwrapOptional(fieldSchema);
    properties[key] = zodLeafToJson(inner);
    // Preserve .describe() output as the `description` on the property.
    const desc = (fieldSchema._def as { description?: string }).description;
    if (desc) properties[key].description = desc;
    if (!isOptional) required.push(key);
  }
  const out: JsonSchema = { type: 'object', properties };
  if (required.length > 0) out.required = required;
  return out;
}

/**
 * Public entry: accept any zod schema and return JSON Schema.
 */
export function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  const { inner } = unwrapOptional(schema);
  return zodLeafToJson(inner);
}
