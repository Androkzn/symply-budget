import type { AIProviderId } from '../services/ai-entitlement-types';
import type { SystemCategory, Severity, Timeframe, Priority } from '../types';

/**
 * Extracted finding from AI analysis
 */
export interface ExtractedFinding {
  system_category: SystemCategory;
  severity: Severity;
  title: string;
  description: string;
  plain_language_summary: string;
  evidence: {
    page_numbers: number[];
    quotes: string[];
  };
  confidence: number;
}

/**
 * Report chunk for AI processing
 */
export interface ReportChunk {
  chunk_index: number;
  page_number: number | null;
  section_type: string | null;
  content: string;
}

/**
 * Report metadata for context
 */
export interface ReportMetadata {
  filename: string;
  page_count: number | null;
  property_address: string | null;
  inspection_date: string | null;
  inspector_name: string | null;
}

/**
 * Generated report summary
 */
export interface ReportSummary {
  overall_condition: 'excellent' | 'good' | 'fair' | 'poor';
  key_concerns: string[];
  immediate_attention_items: string[];
  property_highlights: string[];
  executive_summary: string;
}

/**
 * Generated action item
 */
export interface GeneratedActionItem {
  finding_reference: string | null;
  priority: Priority;
  title: string;
  description: string;
  estimated_cost_min: number | null;
  estimated_cost_max: number | null;
  cost_confidence: 'low' | 'medium' | 'high' | null;
  cost_disclaimer: string | null;
}

/**
 * Action plan result
 */
export interface ActionPlanResult {
  timeframe: Timeframe;
  items: GeneratedActionItem[];
}

/**
 * Generic message for the `generate` API (Aihousekeeper §B10-ext).
 */
export interface GenerateMessage {
  role: 'user' | 'assistant';
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'tool_use'; id: string; name: string; input: unknown }
        | { type: 'tool_result'; tool_use_id: string; content: string }
        | {
            type: 'image';
            source: {
              type: 'base64';
              media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
              data: string;
            };
          }
      >;
}

/**
 * JSON-Schema-shaped tool definition for the `generate` API.
 */
export interface GenerateToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>; // JSON Schema
}

/**
 * Token counts + cost metadata for a single AI request. Emitted by every
 * provider via the `onUsage` hook so `ai-usage-service` can persist one
 * `ai_usage_events` row per call. Token counts come straight from the model
 * APIs (Claude `response.usage`, OpenAI `usage`, Gemini `usageMetadata`) —
 * never estimated.
 *
 * ## Buckets are mutually exclusive
 *
 * Every field below counts tokens no other field counts. The wire formats do
 * NOT agree on this and each adapter normalises before emitting:
 *
 * - Anthropic already excludes cache reads and cache writes from `input_tokens`.
 * - OpenAI's `prompt_tokens` INCLUDES `prompt_tokens_details.cached_tokens`,
 *   and `completion_tokens` INCLUDES `completion_tokens_details.reasoning_tokens`.
 * - Gemini's `promptTokenCount` INCLUDES `cachedContentTokenCount`, while
 *   `thoughtsTokenCount` sits OUTSIDE `candidatesTokenCount`.
 *
 * Emitting an inclusive count charges the same token twice (once at the input
 * rate, once at the cache rate), which is the exact defect this shape exists to
 * make unrepresentable.
 */
export interface AiUsageEvent {
  /**
   * Narrowed to the entitlement provider ids on purpose. This used to be a bare
   * `string` and Claude emitted `'claude'` while every reader filtered on
   * `'anthropic'` — so the entire Anthropic slice read as zero. A union makes
   * that class of mismatch a compile error.
   */
  provider: AIProviderId;
  /** The model the provider says it SERVED, not the one we asked for. */
  model: string;
  /** Uncached input tokens only. */
  inputTokens: number;
  /** Visible output tokens, excluding `reasoningTokens`. */
  outputTokens: number;
  /**
   * Reasoning / thinking tokens. Billed at the OUTPUT rate by all three
   * vendors, and tracked separately because it is usually the single largest
   * unexplained line in an AI bill.
   */
  reasoningTokens: number;
  /** Cache-read (cache-hit) input tokens. Billed at ~0.1x input. */
  cacheReadTokens: number;
  /** Cache-write tokens at the short TTL (Anthropic 5m). Billed at 1.25x input. */
  cacheWrite5mTokens: number;
  /** Cache-write tokens at the 1-hour TTL (Anthropic only). Billed at 2x input. */
  cacheWrite1hTokens: number;
  latencyMs: number;
  status: 'ok' | 'error';
  /**
   * Coarse failure class when `status === 'error'` (e.g. `http_429`,
   * `http_500`, `network`). Never the provider's message body — those quote
   * submitted credentials back at us.
   */
  errorKind?: string;
}

/**
 * Sink for `AiUsageEvent`s. The wiring layer (`ai-usage-service`) supplies a
 * recorder bound to `env` + a per-construction context (feature / household /
 * user). Awaited by the provider, so it must never throw — swallow errors
 * internally rather than break the AI call.
 */
export type AiUsageRecorder = (event: AiUsageEvent) => void | Promise<void>;

/** Common constructor options shared by all AI providers. */
export interface AIProviderOptions {
  model?: string;
  onUsage?: AiUsageRecorder;
}

/**
 * Structured result from the `generate` API. `content` preserves the provider
 * ordering of text + tool_use blocks.
 */
export interface GenerateResult {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: unknown }
  >;
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
  model: string;
  // Token counts for this call, when the provider surfaced them. Callers that
  // want to display cost inline can read this; persistence happens separately
  // via the `onUsage` hook. Same exclusive-bucket rule as `AiUsageEvent`.
  usage?: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cacheReadTokens: number;
    cacheWrite5mTokens: number;
    cacheWrite1hTokens: number;
  };
}

export interface GenerateArgs {
  model: string;
  systemPrompt: string;
  messages: GenerateMessage[];
  tools?: GenerateToolDef[];
  toolChoice?: { type: 'any' } | { type: 'auto' } | { type: 'tool'; name: string };
  maxTokens?: number;
  cacheControl?: {
    onSystem?: { type: 'ephemeral'; ttl?: '1h' | '5m' };
    onLastToolDef?: boolean;
  };
  /**
   * Opt into a STREAMED transport and observe the tool-call JSON as the model
   * writes it — called on every `input_json_delta` with the accumulated (still
   * incomplete) JSON string for that tool block.
   *
   * `generate` returns the same assembled {@link GenerateResult} either way, so
   * this only changes HOW the answer arrives, never its shape. It exists so a
   * long extraction can report honest progress to a waiting user (receipt scan
   * counts `"raw_name"` occurrences to show "12 items read"). Providers that
   * cannot stream ignore it and answer non-streamed.
   */
  onToolJsonDelta?: (accumulatedJson: string) => void;
}

export interface GenerateJSONArgs {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  schema: Record<string, unknown>; // JSON Schema for the expected output
  maxTokens?: number;
}

/** One image handed to the model as context, not as the thing to return. */
export interface ImageReference {
  bytes: ArrayBuffer;
  mime: string;
  /** Only for the multipart form; providers vary in whether they use it. */
  filename: string;
  /**
   * What this picture is FOR, in the model's words. The distinction is
   * load-bearing for the surface preview: the scale-true drawing is
   * authoritative for shape and layout, while a material photo says only what
   * the material looks like. A provider that flattens both into "here are some
   * images" produces a render at the wrong scale.
   */
  role: 'layout' | 'material' | 'context';
}

export interface GenerateImageArgs {
  model: string;
  prompt: string;
  /**
   * Reference images to compose against. A provider that cannot accept
   * references must ignore them rather than fail — the prompt alone still
   * carries the measurements.
   */
  references?: ImageReference[];
  /** Pixel size. Providers snap to their nearest supported shape. */
  size?: '1024x1024' | '1536x1024' | '1024x1536';
  quality?: 'low' | 'medium' | 'high';
}

export interface GenerateImageResult {
  bytes: ArrayBuffer;
  mime: string;
  model: string;
}

/**
 * AI Provider interface for multiple backend support
 */
export interface AIProvider {
  readonly name: string;

  /**
   * Extract findings from report chunks
   */
  extractFindings(params: {
    chunks: ReportChunk[];
    promptVersion: string;
  }): Promise<ExtractedFinding[]>;

  /**
   * Generate a summary of the report
   */
  generateSummary(params: {
    findings: ExtractedFinding[];
    reportMetadata: ReportMetadata;
    promptVersion: string;
  }): Promise<ReportSummary>;

  /**
   * Generate action plans for specified timeframes
   */
  generateActionPlans(params: {
    findings: ExtractedFinding[];
    timeframes: Timeframe[];
    country: 'CA' | 'US';
    promptVersion: string;
  }): Promise<ActionPlanResult[]>;

  /**
   * Check if the provider is available and configured
   */
  isAvailable(): boolean;

  // ---------- Aihousekeeper additions (§B10-ext) ----------

  /**
   * Generic generation with optional tool use + prompt caching.
   * Aihousekeeper services (briefing composer, followup runner) invoke this directly.
   */
  generate(args: GenerateArgs): Promise<GenerateResult>;

  /**
   * Convenience wrapper around `generate` that forces a single tool_use
   * matching `schema` and returns the parsed input block as `T`.
   *
   * Named `generateStructured` (not `generateJSON`) to avoid colliding with
   * ClaudeProvider's pre-existing `generateJSON({ systemPrompt, userPrompt })`
   * method used by contractor search / task drafts / visit checklists.
   */
  generateStructured<T>(args: GenerateJSONArgs): Promise<T>;

  /**
   * Produce an image. **Optional** — a provider that has no image model simply
   * omits it, and a caller checks before reaching for it.
   *
   * Optional rather than required because the three providers in this Worker do
   * not have this capability in common, and widening the interface would force
   * two of them to ship a method whose only body is a throw. `MODEL_DEFAULTS`
   * (`model-catalog.ts`) already records which vendors have an image model;
   * `imageCapableProviderFor` in `provider-factory.ts` is the one place that
   * resolves the pair, so a call site never guesses.
   */
  generateImage?(args: GenerateImageArgs): Promise<GenerateImageResult>;
}

/**
 * Provider factory type
 */
export type AIProviderFactory = (apiKey: string, options?: Record<string, unknown>) => AIProvider;
