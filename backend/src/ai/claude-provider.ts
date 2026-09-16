import Anthropic from '@anthropic-ai/sdk';

import type { Timeframe } from '../types';

import { resolveMediaType, type SupportedMediaType } from './media-type';
import {
  EXTRACT_FINDINGS_PROMPT_V1,
  EXTRACT_FINDINGS_SYSTEM_PROMPT,
} from './prompts/extract-findings';
import {
  HOME_FEATURES_SYSTEM_PROMPT,
  HOME_FEATURES_USER_PROMPT,
} from './prompts/extract-home-features';
import {
  GENERATE_ACTION_PLAN_PROMPT_V1,
  GENERATE_ACTION_PLAN_SYSTEM_PROMPT,
} from './prompts/generate-action-plan';
import {
  GENERATE_SUMMARY_PROMPT_V1,
  GENERATE_SUMMARY_SYSTEM_PROMPT,
} from './prompts/generate-summary';
import type {
  AIProvider,
  AIProviderOptions,
  AiUsageRecorder,
  ExtractedFinding,
  ReportChunk,
  ReportMetadata,
  ReportSummary,
  ActionPlanResult,
  GenerateArgs,
  GenerateMessage,
  GenerateResult,
  GenerateJSONArgs,
} from './provider';

/**
 * The model's text answer, from wherever in `content` it actually sits.
 *
 * Reading `content[0]` directly (as this used to) is wrong in two ways that both
 * surface as "couldn't read that document":
 *  - `content` can be EMPTY — a refusal, or `max_tokens` reached before any
 *    block was emitted — and `content[0].type` then throws a raw TypeError;
 *  - with extended thinking the first block is `thinking`, so the real answer in
 *    a later text block was silently discarded and the caller parsed ''.
 *
 * Joining every text block matches what `generateWithWebSearch` already does.
 */
function firstTextBlock(response: Anthropic.Messages.Message): string {
  return (response.content ?? [])
    .filter((block): block is Anthropic.Messages.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

/**
 * Correct every base64 media block in a message to the type its BYTES say it is.
 *
 * `generateFromMediaContent` has sniffed since the "media type image/png, but
 * the image appears to be a image/jpeg image" 400s, but the `generate` message
 * path did not — and two surfaces build image blocks there and hand through a
 * CLIENT-DECLARED mime (savings import passes the upload's `mime_type`). A file
 * saved with a lying extension therefore still failed on those paths. Sniffing
 * here makes the correction unconditional: no caller can send a declared type
 * that disagrees with the bytes, whichever entry point it uses.
 *
 * The block KIND is re-routed with the type, exactly as `generateFromMediaContent`
 * does: a `document` block only ever carries a PDF, and PDF bytes only ever ride
 * in a `document` block. Correcting the media type without the kind would just
 * trade one 400 for another.
 *
 * Unrecognised bytes keep the declared type (see `resolveMediaType`), so this
 * only ever changes a block whose bytes provably disagree with its declaration.
 */
function correctDeclaredMediaTypes(
  content: Exclude<GenerateMessage['content'], string>
): Exclude<GenerateMessage['content'], string> {
  return content.map((block) => {
    const kind = (block as { type?: string }).type;
    if (kind !== 'image' && kind !== 'document') return block;

    const source = (block as { source?: { type?: string; media_type?: string; data?: string } })
      .source;
    if (!source || source.type !== 'base64' || !source.data || !source.media_type) return block;

    const resolved = resolveMediaType(source.data, source.media_type as SupportedMediaType);
    const resolvedKind = resolved === 'application/pdf' ? 'document' : 'image';
    if (resolved === source.media_type && resolvedKind === kind) return block;

    return { ...block, type: resolvedKind, source: { ...source, media_type: resolved } };
  }) as Exclude<GenerateMessage['content'], string>;
}

/**
 * Zero-token fallback for a stream that ended without ever reporting usage
 * (only reachable if the API sends no `message_start`). Keeps the assembled
 * `Message` structurally valid; `emitUsage` skips a null usage rather than
 * writing a bogus zero-token row.
 */
const EMPTY_USAGE = {
  input_tokens: 0,
  output_tokens: 0,
} as unknown as Anthropic.Messages.Usage;

/**
 * Prompt-cache token counts. The Anthropic API returns
 * `cache_read_input_tokens` / `cache_creation_input_tokens` on `usage`, but the
 * installed SDK's `Usage` type may not declare them — read them defensively.
 */
function readCacheTokens(
  usage: Anthropic.Messages.Usage
): { read: number; write5m: number; write1h: number } {
  const u = usage as unknown as {
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_creation?: {
      ephemeral_5m_input_tokens?: number;
      ephemeral_1h_input_tokens?: number;
    };
  };

  const read = u.cache_read_input_tokens ?? 0;
  const total = u.cache_creation_input_tokens ?? 0;

  // The two TTLs bill differently — 5m writes are 1.25x the input rate, 1h
  // writes are 2x — so folding them together (as this did) undercharges every
  // 1h breakpoint by 60%. We do use `ttl: '1h'` (see `GenerateArgs.cacheControl`).
  const split = u.cache_creation;
  if (split) {
    const write5m = split.ephemeral_5m_input_tokens ?? 0;
    const write1h = split.ephemeral_1h_input_tokens ?? 0;
    // Trust the breakdown, but never lose tokens if it under-sums the total.
    const accounted = write5m + write1h;
    return {
      read,
      write5m: write5m + Math.max(0, total - accounted),
      write1h,
    };
  }

  // No breakdown on this SDK/response: 5m is the API default, so attribute
  // there. Under-charges a 1h write rather than inventing a TTL we can't see.
  return { read, write5m: total, write1h: 0 };
}

/** Coarse, credential-safe failure class for a usage row. */
export function classifyProviderError(err: unknown): string {
  const status = (err as { status?: number; statusCode?: number } | null)?.status
    ?? (err as { statusCode?: number } | null)?.statusCode;
  if (typeof status === 'number') return `http_${status}`;
  const name = (err as { name?: string } | null)?.name;
  return name ? `error_${name}` : 'error_unknown';
}

/**
 * Claude 3.5 Sonnet Provider with Native PDF Support and Prompt Caching
 *
 * Features:
 * - Direct PDF processing (up to 32MB, 100 pages with vision)
 * - Prompt caching for 90% cost reduction
 * - Multimodal understanding (text + images + tables)
 * - 200K token context window
 */
export class ClaudeProvider implements AIProvider {
  readonly name = 'claude';
  private client: Anthropic;
  private model: string;
  private onUsage?: AiUsageRecorder;

  constructor(apiKey: string, options?: AIProviderOptions) {
    this.client = new Anthropic({ apiKey });
    this.model = options?.model || 'claude-sonnet-5';
    this.onUsage = options?.onUsage;
  }

  isAvailable(): boolean {
    return Boolean(this.client);
  }

  /**
   * Single chokepoint for every Anthropic `messages.create` call in this
   * provider. Times the call and emits token usage via `onUsage` (awaited, so
   * the usage row is written before we return — a few ms next to a multi-second
   * model call). All internal methods route through this instead of calling
   * `this.client.messages.create` directly, so no feature can silently skip
   * usage tracking.
   */
  private async createMessage(
    params: Anthropic.Messages.MessageCreateParamsNonStreaming,
    requestOptions?: { headers?: Record<string, string> }
  ): Promise<Anthropic.Messages.Message> {
    const started = Date.now();
    try {
      const response = await this.client.messages.create(params, requestOptions);
      await this.emitUsage(response.model || params.model, response.usage, Date.now() - started);
      return response;
    } catch (err) {
      // A failed call still consumed wall-clock and (past the 4xx boundary)
      // often real input tokens. Logging only successes made the error rate
      // read as a flat 0% and hid retry storms entirely.
      await this.emitError(params.model, Date.now() - started, err);
      throw err;
    }
  }

  /**
   * Streaming twin of {@link createMessage} — same usage-tracking contract, same
   * assembled `Message` on the way out, so callers cannot tell the transports
   * apart. Used only when a caller passes `onToolJsonDelta` and wants to watch
   * the tool JSON being written (progress for a slow extraction).
   *
   * Anthropic streams a tool call as `input_json_delta` fragments that are only
   * valid JSON once complete. We accumulate per content-block index and parse at
   * `content_block_stop`. A truncated block (the model ran out of `max_tokens`
   * mid-object) does NOT throw here: we drop that block and let the assembled
   * message carry `stop_reason: 'max_tokens'`, which is exactly the signal the
   * non-streaming callers already retry on with a bigger budget.
   */
  private async createMessageStream(
    params: Anthropic.Messages.MessageCreateParamsNonStreaming,
    requestOptions: { headers?: Record<string, string> } | undefined,
    onToolJsonDelta: (accumulatedJson: string) => void
  ): Promise<Anthropic.Messages.Message> {
    const started = Date.now();
    try {
      // Typed as Streaming so the SDK's overload resolves to the event stream
      // rather than the `Message | Stream<…>` union a widened `stream` yields.
      const streamParams: Anthropic.Messages.MessageCreateParamsStreaming = {
        ...params,
        stream: true,
      };
      const stream = await this.client.messages.create(streamParams, requestOptions);

      let model = params.model;
      let stopReason: Anthropic.Messages.Message['stop_reason'] = null;
      let stopSequence: string | null = null;
      let messageId = '';
      // `message_start` carries the input/cache counts, `message_delta` the
      // final output count — kept apart so neither overwrites the other.
      let startUsage: Anthropic.Messages.Usage | null = null;
      let finalOutputTokens: number | null = null;
      // Content blocks arrive interleaved by index, each built from deltas.
      const partials = new Map<
        number,
        { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; json: string }
      >();
      const content: Anthropic.Messages.ContentBlock[] = [];

      const finishBlock = (index: number): void => {
        const partial = partials.get(index);
        if (!partial) return;
        partials.delete(index);
        if (partial.type === 'text') {
          content.push({ type: 'text', text: partial.text } as Anthropic.Messages.ContentBlock);
          return;
        }
        try {
          content.push({
            type: 'tool_use',
            id: partial.id,
            name: partial.name,
            // An empty-argument tool call streams zero deltas, not "{}".
            input: partial.json.trim() ? JSON.parse(partial.json) : {},
          } as Anthropic.Messages.ContentBlock);
        } catch {
          // Truncated JSON — see the doc comment. Surfaced via stop_reason.
          console.warn(
            `[claude-provider] dropped unparseable streamed tool JSON (${partial.json.length} chars)`
          );
        }
      };

      for await (const event of stream) {
        switch (event.type) {
          case 'message_start':
            messageId = event.message.id;
            model = event.message.model || model;
            startUsage = event.message.usage;
            break;
          case 'content_block_start':
            if (event.content_block.type === 'text') {
              partials.set(event.index, { type: 'text', text: event.content_block.text ?? '' });
            } else if (event.content_block.type === 'tool_use') {
              partials.set(event.index, {
                type: 'tool_use',
                id: event.content_block.id,
                name: event.content_block.name,
                json: '',
              });
            }
            break;
          case 'content_block_delta': {
            const partial = partials.get(event.index);
            if (!partial) break;
            if (event.delta.type === 'text_delta' && partial.type === 'text') {
              partial.text += event.delta.text;
            } else if (event.delta.type === 'input_json_delta' && partial.type === 'tool_use') {
              partial.json += event.delta.partial_json;
              onToolJsonDelta(partial.json);
            }
            break;
          }
          case 'content_block_stop':
            finishBlock(event.index);
            break;
          case 'message_delta':
            stopReason = event.delta.stop_reason ?? stopReason;
            stopSequence = event.delta.stop_sequence ?? stopSequence;
            finalOutputTokens = event.usage.output_tokens;
            break;
          default:
            break;
        }
      }
      // A stream cut short mid-block still has whatever arrived — keep it.
      for (const index of [...partials.keys()].sort((a, b) => a - b)) finishBlock(index);

      const usage: Anthropic.Messages.Usage | null = startUsage
        ? { ...startUsage, output_tokens: finalOutputTokens ?? startUsage.output_tokens }
        : null;
      await this.emitUsage(model, usage, Date.now() - started);

      return {
        id: messageId,
        type: 'message',
        role: 'assistant',
        model,
        content,
        stop_reason: stopReason,
        stop_sequence: stopSequence,
        usage: usage ?? EMPTY_USAGE,
      } as Anthropic.Messages.Message;
    } catch (err) {
      await this.emitError(params.model, Date.now() - started, err);
      throw err;
    }
  }

  private async emitUsage(
    model: string,
    usage: Anthropic.Messages.Usage | undefined | null,
    latencyMs: number
  ): Promise<void> {
    if (!this.onUsage || !usage) return;
    const cache = readCacheTokens(usage);
    try {
      await this.onUsage({
        provider: 'anthropic',
        model,
        inputTokens: usage.input_tokens ?? 0,
        // Anthropic folds thinking tokens INTO `output_tokens` — unlike Gemini,
        // which reports them separately. Emitting a non-zero `reasoningTokens`
        // here would bill the same tokens twice.
        outputTokens: usage.output_tokens ?? 0,
        reasoningTokens: 0,
        cacheReadTokens: cache.read,
        cacheWrite5mTokens: cache.write5m,
        cacheWrite1hTokens: cache.write1h,
        latencyMs,
        status: 'ok',
      });
    } catch (err) {
      // Usage recording must never break the AI call.
      console.error('[claude-provider] onUsage failed:', err);
    }
  }

  private async emitError(model: string, latencyMs: number, cause: unknown): Promise<void> {
    if (!this.onUsage) return;
    try {
      await this.onUsage({
        provider: 'anthropic',
        model,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cacheReadTokens: 0,
        cacheWrite5mTokens: 0,
        cacheWrite1hTokens: 0,
        latencyMs,
        status: 'error',
        errorKind: classifyProviderError(cause),
      });
    } catch (err) {
      console.error('[claude-provider] onUsage (error path) failed:', err);
    }
  }

  /**
   * Process PDF directly with Claude (native PDF support)
   * No extraction step needed - Claude handles text, images, tables automatically
   */
  async processPDFDirect(params: {
    pdfBase64: string;
    promptVersion: string;
    reportMetadata?: Partial<ReportMetadata>;
  }): Promise<{
    findings: ExtractedFinding[];
    usage: Anthropic.Messages.Usage;
  }> {
    const { pdfBase64, promptVersion } = params;

    // Build system prompt with caching
    const systemPrompt = this.buildCachedSystemPrompt(
      EXTRACT_FINDINGS_SYSTEM_PROMPT,
      promptVersion
    );

    // Note: TypeScript definitions for @anthropic-ai/sdk may not include 'document' type yet
    // but the API supports it. Using type assertion as workaround.
    const response = await this.createMessage({
      model: this.model,
      max_tokens: 8192,
      system: systemPrompt as any,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: pdfBase64,
              },
            } as any,
            {
              type: 'text',
              text: EXTRACT_FINDINGS_PROMPT_V1,
            },
          ],
        },
      ],
    });

    const resultText = firstTextBlock(response);
    const parsed = JSON.parse(this.extractJsonFromResponse(resultText));

    return {
      findings: parsed.findings || [],
      usage: response.usage,
    };
  }

  /** Supported base64 document/image types for multimodal extraction. */
  static readonly MEDIA_TYPES = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
  ] as const;

  /**
   * Text extraction from a PDF or image attachment. Routes through
   * `createMessage` so usage is tracked when `onUsage` is configured.
   */
  async generateFromMediaContent(params: {
    systemPrompt: string;
    userText: string;
    media: {
      base64: string;
      mediaType: (typeof ClaudeProvider.MEDIA_TYPES)[number];
    };
    maxTokens?: number;
    model?: string;
    cacheSystem?: boolean;
  }): Promise<{ text: string; usage: Anthropic.Messages.Usage }> {
    const { systemPrompt, userText, media, maxTokens = 4096, model, cacheSystem } = params;
    // The client-declared media type (from a file extension via `inferMime`, or
    // an unreliable picker) can lie — a `.png` that actually holds JPEG bytes,
    // etc. Anthropic HARD-REJECTS the mismatch (400 invalid_request), which
    // surfaced to members as a generic "couldn't read" failure. Sniff the real
    // type from the magic bytes and trust that; it also fixes document↔image
    // routing when the declared extension was wrong.
    const mediaType = resolveMediaType(media.base64, media.mediaType);
    const documentContent =
      mediaType === 'application/pdf'
        ? ({
            type: 'document',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: media.base64,
            },
          } as const)
        : ({
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: media.base64,
            },
          } as const);

    const system = cacheSystem
      ? ([
          {
            type: 'text',
            text: systemPrompt,
            cache_control: { type: 'ephemeral' },
          },
        ] as const)
      : systemPrompt;

    const response = await this.createMessage({
      model: model || this.model,
      max_tokens: maxTokens,
      system: system as Anthropic.Messages.MessageCreateParamsNonStreaming['system'],
      messages: [
        {
          role: 'user',
          content: [documentContent as any, { type: 'text', text: userText }],
        },
      ],
    });

    const text = firstTextBlock(response);
    return { text, usage: response.usage };
  }

  /**
   * Run a prompt with Anthropic's server-side `web_search` tool. Handles the
   * `pause_turn` sampling loop until the model finishes or `maxIterations`.
   * Routes every iteration through `createMessage` for usage tracking.
   */
  async generateWithWebSearch(params: {
    systemPrompt: string;
    userPrompt: string;
    maxTokens?: number;
    maxIterations?: number;
    model?: string;
    maxWebSearchUses?: number;
    cacheSystem?: boolean;
  }): Promise<{ text: string; usage: Anthropic.Messages.Usage; stopReason: string | null }> {
    const {
      systemPrompt,
      userPrompt,
      maxTokens = 4096,
      maxIterations = 5,
      model,
      maxWebSearchUses = 6,
      cacheSystem = true,
    } = params;

    // SDK 0.32 types predate the web_search server tool — cast at the boundary.
    const webSearchTool = {
      type: 'web_search_20250305',
      name: 'web_search',
      max_uses: maxWebSearchUses,
    } as unknown as Anthropic.Messages.Tool;

    const system = cacheSystem
      ? ([
          {
            type: 'text',
            text: systemPrompt,
            cache_control: { type: 'ephemeral' },
          },
        ] as const)
      : systemPrompt;

    const messages: Anthropic.Messages.MessageParam[] = [
      { role: 'user', content: userPrompt },
    ];

    let response: Anthropic.Messages.Message | null = null;

    for (let i = 0; i < maxIterations; i++) {
      response = await this.createMessage({
        model: model || this.model,
        max_tokens: maxTokens,
        system: system as Anthropic.Messages.MessageCreateParamsNonStreaming['system'],
        messages,
        tools: [webSearchTool],
      });

      // SDK stop_reason union predates `pause_turn` — compare via string.
      if ((response.stop_reason as string) === 'pause_turn') {
        messages.push({ role: 'assistant', content: response.content as any });
        continue;
      }
      break;
    }

    if (!response) {
      throw new Error('No response from model');
    }

    const text = response.content
      .filter((block): block is Anthropic.Messages.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();

    return {
      text,
      usage: response.usage,
      stopReason: response.stop_reason,
    };
  }

  /**
   * Structured tool output from a PDF document. Used by receipt scanning and
   * similar document→JSON flows that require native PDF support.
   */
  async generateToolFromDocument<T = unknown>(params: {
    systemPrompt: string;
    userText: string;
    documentBase64: string;
    tool: { name: string; description: string; input_schema: Record<string, unknown> };
    maxTokens?: number;
    model?: string;
    /** See `GenerateArgs.onToolJsonDelta` — opts into the streamed transport. */
    onToolJsonDelta?: (accumulatedJson: string) => void;
  }): Promise<T> {
    const {
      systemPrompt,
      userText,
      documentBase64,
      tool,
      maxTokens = 4096,
      model,
      onToolJsonDelta,
    } = params;

    const createParams: Anthropic.Messages.MessageCreateParamsNonStreaming = {
      model: model || this.model,
      max_tokens: maxTokens,
      system: systemPrompt,
      tools: [
        {
          name: tool.name,
          description: tool.description,
          input_schema: tool.input_schema as Anthropic.Messages.Tool['input_schema'],
        },
      ],
      tool_choice: { type: 'tool', name: tool.name },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: documentBase64,
              },
            } as any,
            { type: 'text', text: userText },
          ],
        },
      ],
    };

    const response = onToolJsonDelta
      ? await this.createMessageStream(createParams, undefined, onToolJsonDelta)
      : await this.createMessage(createParams);

    const toolBlock = response.content.find((b) => b.type === 'tool_use');
    if (!toolBlock || toolBlock.type !== 'tool_use') {
      throw new Error('Expected tool_use block from document extraction');
    }
    return toolBlock.input as T;
  }

  /**
   * Extract findings from pre-processed chunks (fallback for >32MB files)
   */
  async extractFindings(params: {
    chunks: ReportChunk[];
    promptVersion: string;
  }): Promise<ExtractedFinding[]> {
    const { chunks, promptVersion } = params;

    // Format chunks for the prompt
    const chunksText = chunks
      .map(
        (chunk) =>
          `[Page ${chunk.page_number || 'N/A'}${chunk.section_type ? ` - ${chunk.section_type}` : ''}]\n${chunk.content}`
      )
      .join('\n\n---\n\n');

    const prompt = this.getPrompt('extract_findings', promptVersion).replace(
      '{chunks}',
      chunksText
    );

    // Build system prompt with caching
    const systemPrompt = this.buildCachedSystemPrompt(
      EXTRACT_FINDINGS_SYSTEM_PROMPT,
      promptVersion
    );

    const response = await this.createMessage({
      model: this.model,
      max_tokens: 8192,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    try {
      const resultText = firstTextBlock(response);
      const parsed = JSON.parse(this.extractJsonFromResponse(resultText));
      return parsed.findings || [];
    } catch (error) {
      console.error('Failed to parse Claude response:', error);
      return [];
    }
  }

  /**
   * Generate persona-specific summary (novice/diy/technical)
   */
  async generatePersonaSummary(params: {
    findings: ExtractedFinding[];
    reportMetadata: ReportMetadata;
    personaType: 'novice' | 'diy' | 'technical' | 'executive';
    promptVersion: string;
  }): Promise<{
    summary: ReportSummary;
    usage: Anthropic.Messages.Usage;
  }> {
    const { findings, reportMetadata, personaType, promptVersion } = params;

    const personaPrompts = {
      novice: this.getNoviceHomeownerPrompt(),
      diy: this.getDIYEnthusiastPrompt(),
      technical: this.getTechnicalPrompt(),
      executive: this.getExecutiveSummaryPrompt(),
    };

    const prompt = personaPrompts[personaType]
      .replace('{property_address}', reportMetadata.property_address || 'Not specified')
      .replace('{inspection_date}', reportMetadata.inspection_date || 'Not specified')
      .replace('{findings_json}', JSON.stringify(findings, null, 2));

    // Build system prompt with caching
    const systemPrompt = this.buildCachedSystemPrompt(
      GENERATE_SUMMARY_SYSTEM_PROMPT,
      promptVersion
    );

    const response = await this.createMessage({
      model: this.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    try {
      const resultText = firstTextBlock(response);
      const parsed = JSON.parse(this.extractJsonFromResponse(resultText));
      return {
        summary: parsed,
        usage: response.usage,
      };
    } catch (error) {
      console.error('Failed to parse summary response:', error);
      return {
        summary: {
          overall_condition: 'fair',
          key_concerns: [],
          immediate_attention_items: [],
          property_highlights: [],
          executive_summary: 'Unable to generate summary. Please review findings directly.',
        },
        usage: response.usage,
      };
    }
  }

  async generateSummary(params: {
    findings: ExtractedFinding[];
    reportMetadata: ReportMetadata;
    promptVersion: string;
  }): Promise<ReportSummary> {
    const result = await this.generatePersonaSummary({
      ...params,
      personaType: 'executive',
    });
    return result.summary;
  }

  async generateActionPlans(params: {
    findings: ExtractedFinding[];
    timeframes: Timeframe[];
    country: 'CA' | 'US';
    promptVersion: string;
  }): Promise<ActionPlanResult[]> {
    const { findings, timeframes, country, promptVersion } = params;

    const prompt = this.getPrompt('generate_action_plan', promptVersion)
      .replace('{country}', country === 'CA' ? 'Canada' : 'United States')
      .replace('{findings_json}', JSON.stringify(findings, null, 2))
      .replace('{timeframes}', timeframes.join(', '));

    // Build system prompt with caching
    const systemPrompt = this.buildCachedSystemPrompt(
      GENERATE_ACTION_PLAN_SYSTEM_PROMPT,
      promptVersion
    );

    const response = await this.createMessage({
      model: this.model,
      max_tokens: 8192,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    try {
      const resultText = firstTextBlock(response);
      const parsed = JSON.parse(this.extractJsonFromResponse(resultText));
      return parsed.action_plans || [];
    } catch (error) {
      console.error('Failed to parse action plan response:', error);
      return [];
    }
  }

  /**
   * Extract home features from report content for maintenance suggestions
   */
  async extractHomeFeatures(params: {
    content: string;
    promptVersion: string;
  }): Promise<{
    home_features: Array<{
      feature_type: string;
      feature_subtype: string | null;
      quantity: number;
      location: string | null;
      brand: string | null;
      model: string | null;
      age_years: number | null;
      condition: 'excellent' | 'good' | 'fair' | 'poor' | 'unknown';
      notes: string | null;
      extraction_confidence: number;
    }>;
    extraction_summary: {
      total_features: number;
      high_confidence_features: number;
      features_by_category: Record<string, number>;
      notes: string | null;
    };
  }> {
    const { content, promptVersion } = params;

    const userPrompt = HOME_FEATURES_USER_PROMPT.replace('{content}', content);
    const systemPrompt = this.buildCachedSystemPrompt(HOME_FEATURES_SYSTEM_PROMPT, promptVersion);

    const response = await this.createMessage({
      model: this.model,
      max_tokens: 4096,
      system: systemPrompt as any,
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
    });

    try {
      const resultText = firstTextBlock(response);
      const parsed = JSON.parse(this.extractJsonFromResponse(resultText));
      return {
        home_features: parsed.home_features || [],
        extraction_summary: parsed.extraction_summary || {
          total_features: 0,
          high_confidence_features: 0,
          features_by_category: {},
          notes: null,
        },
      };
    } catch (error) {
      console.error('Failed to parse home features response:', error);
      return {
        home_features: [],
        extraction_summary: {
          total_features: 0,
          high_confidence_features: 0,
          features_by_category: {},
          notes: 'Failed to extract features',
        },
      };
    }
  }

  /**
   * Build system prompt with prompt caching enabled
   * This provides 90% cost reduction on subsequent calls
   * Note: TypeScript definitions may not include cache_control yet, using 'as any'
   */
  private buildCachedSystemPrompt(
    basePrompt: string,
    _version: string // Prefix with underscore to indicate intentionally unused
  ): Anthropic.Messages.MessageCreateParams['system'] {
    return [
      {
        type: 'text',
        text: basePrompt,
        cache_control: { type: 'ephemeral' },
      } as any,
    ] as any;
  }

  /**
   * Extract JSON from response (handles markdown code blocks)
   */
  private extractJsonFromResponse(response: string): string {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      return jsonMatch[1].trim();
    }

    // Try to find JSON object directly
    const objectMatch = response.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      return objectMatch[0];
    }

    return response;
  }

  /**
   * Attempt to repair malformed JSON from Claude responses
   */
  private repairJson(jsonStr: string): string {
    let repaired = jsonStr;

    // Remove trailing commas before closing brackets
    repaired = repaired.replace(/,(\s*[}\]])/g, '$1');

    // Remove duplicate commas
    repaired = repaired.replace(/,\s*,/g, ',');

    // Fix missing commas between array elements (common Claude issue)
    // Look for } followed by { without a comma (with optional whitespace/newlines)
    repaired = repaired.replace(/\}(\s*)\{/g, '},$1{');

    // Fix missing commas after array closings followed by objects
    repaired = repaired.replace(/\](\s*)\{/g, '],$1{');

    // Fix missing commas after string values followed by quotes (new property)
    // e.g., "value1"\n    "key2" should be "value1",\n    "key2"
    repaired = repaired.replace(/"(\s*\n\s*)"([a-zA-Z_])/g, '",$1"$2');

    // Fix missing commas after numbers followed by quotes
    repaired = repaired.replace(/(\d)(\s*\n\s*)"([a-zA-Z_])/g, '$1,$2"$3');

    // Fix missing commas after true/false/null followed by quotes
    repaired = repaired.replace(/(true|false|null)(\s*\n\s*)"([a-zA-Z_])/g, '$1,$2"$3');

    // Fix missing commas between array elements on same line
    repaired = repaired.replace(/\}(\s+)\{/g, '},$1{');

    return repaired;
  }

  /**
   * Parse JSON with repair attempts on failure
   */
  private parseJsonWithRepair<T>(jsonStr: string): T {
    try {
      return JSON.parse(jsonStr) as T;
    } catch (firstError) {
      console.log('[Claude] First JSON parse failed, attempting repair...');

      // Try to repair the JSON
      const repaired = this.repairJson(jsonStr);

      try {
        return JSON.parse(repaired) as T;
      } catch (secondError) {
        // Log both errors for debugging
        console.error('[Claude] JSON repair failed. Original error:', firstError);
        console.error('[Claude] JSON repair attempt error:', secondError);
        console.error('[Claude] Response preview (first 500 chars):', jsonStr.substring(0, 500));
        throw firstError;
      }
    }
  }

  private getPrompt(type: string, version: string): string {
    const prompts: Record<string, Record<string, string>> = {
      extract_findings: {
        v1: EXTRACT_FINDINGS_PROMPT_V1,
      },
      generate_summary: {
        v1: GENERATE_SUMMARY_PROMPT_V1,
      },
      generate_action_plan: {
        v1: GENERATE_ACTION_PLAN_PROMPT_V1,
      },
    };

    return prompts[type]?.[version] || prompts[type]?.v1 || '';
  }

  /**
   * Persona-specific prompt templates
   */
  private getNoviceHomeownerPrompt(): string {
    return `Create a summary for someone who just bought their first home and knows little about home maintenance.

PROPERTY: {property_address}
INSPECTION DATE: {inspection_date}

Use simple language, explain WHY things matter, avoid jargon.
Focus on: Safety, cost priorities, what to do first.

FINDINGS:
{findings_json}

IMPORTANT: Calculate the total estimated cost by summing ALL repair/replacement costs from all findings, especially major items like electrical panel replacements ($2000-5000), HVAC replacements ($3000-8000), roof repairs ($500-10000+), etc.

Return JSON with this structure:
{
  "overall_condition": "excellent" | "good" | "fair" | "poor",
  "key_concerns": ["concern 1", "concern 2", ...],
  "immediate_attention_items": [
    {
      "title": "Clear title",
      "why_it_matters": "Plain explanation",
      "what_to_do": "Simple action",
      "cost_range": "$X-Y",
      "cost_min": 0,
      "cost_max": 0
    }
  ],
  "budget_for_later": [
    {
      "title": "Item",
      "timeframe": "Next 3-6 months",
      "cost_range": "$X-Y",
      "cost_min": 0,
      "cost_max": 0
    }
  ],
  "good_news": ["positive aspect 1", ...],
  "total_estimated_cost_min": 0,
  "total_estimated_cost_max": 0,
  "executive_summary": "2-3 sentence plain-language overview"
}

NOTE: total_estimated_cost_min and total_estimated_cost_max MUST be numeric values (no $ or commas) representing the sum of ALL repairs needed. For example, if electrical panel replacement is $2000-5000 and smoke detectors are $50-100, the total should be $2050-5100.`;
  }

  private getDIYEnthusiastPrompt(): string {
    return `Create a summary for an experienced DIY homeowner who wants to know what they can tackle themselves vs. when to hire professionals.

PROPERTY: {property_address}
INSPECTION DATE: {inspection_date}

Include technical details, material specifications, difficulty ratings.

IMPORTANT: Calculate the total estimated cost by summing ALL repair/replacement costs from all findings, including major items like electrical panel replacements, HVAC work, roofing, plumbing, etc.

FINDINGS:
{findings_json}

Return JSON with this structure:
{
  "overall_condition": "excellent" | "good" | "fair" | "poor",
  "key_concerns": ["main issue 1", "main issue 2"],
  "immediate_attention_items": ["urgent item 1", "urgent item 2"],
  "critical_issues_hire_pros": [
    {
      "title": "Issue",
      "why_pro_required": "Explanation",
      "estimated_cost": "$X-Y",
      "cost_min": 0,
      "cost_max": 0
    }
  ],
  "diy_possible": [
    {
      "title": "Task",
      "difficulty": "easy" | "moderate" | "difficult",
      "time_estimate": "X hours",
      "tools_needed": ["tool1", "tool2"],
      "materials_cost": "$X-Y",
      "cost_min": 0,
      "cost_max": 0,
      "instructions_summary": "Brief steps"
    }
  ],
  "cost_breakdown": {
    "must_hire_min": 0,
    "must_hire_max": 0,
    "diy_possible_min": 0,
    "diy_possible_max": 0
  },
  "total_estimated_cost_min": 0,
  "total_estimated_cost_max": 0,
  "executive_summary": "Technical overview"
}

NOTE: All cost fields ending in _min or _max MUST be numeric values (no $ or commas). Calculate total by summing all individual item costs.`;
  }

  private getTechnicalPrompt(): string {
    return `Create a detailed technical summary for a professional or very experienced homeowner.

PROPERTY: {property_address}
INSPECTION DATE: {inspection_date}

Include all technical specifications, code references, material details.

IMPORTANT: Calculate the total estimated cost by summing ALL repair/replacement costs from all findings.

FINDINGS:
{findings_json}

Return JSON:
{
  "overall_condition": "excellent" | "good" | "fair" | "poor",
  "key_concerns": ["technical concern 1", "concern 2"],
  "immediate_attention_items": ["critical item 1", "item 2"],
  "deficiencies": [
    {
      "system": "Electrical/Plumbing/HVAC/etc",
      "issue": "Technical description",
      "code_reference": "Relevant code if applicable",
      "cost_min": 0,
      "cost_max": 0,
      "priority": "critical" | "major" | "minor"
    }
  ],
  "total_estimated_cost_min": 0,
  "total_estimated_cost_max": 0,
  "executive_summary": "Technical overview paragraph"
}

NOTE: All cost fields with _min/_max MUST be numeric values (no $ symbols or commas). Calculate total by summing all individual repairs.`;
  }

  /**
   * Generate JSON response from custom prompts
   * Useful for custom extraction/generation tasks
   */
  async generateJSON<T = unknown>(params: {
    systemPrompt: string;
    userPrompt: string;
    model?: string;
    maxTokens?: number;
  }): Promise<T> {
    const { systemPrompt, userPrompt, model, maxTokens = 4096 } = params;

    const response = await this.createMessage({
      model: model || this.model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
    });

    const resultText = firstTextBlock(response);
    const jsonStr = this.extractJsonFromResponse(resultText);
    return this.parseJsonWithRepair<T>(jsonStr);
  }

  // ---------- Aihousekeeper §B10-ext: generic generate + generateStructured ----------

  /**
   * Generic generation with optional tool_use + prompt caching.
   * Used by Aihousekeeper's BriefingComposer, FollowupRunner, DigestComposer.
   *
   * - When `cacheControl.onSystem` is set, the system prompt is wrapped in a
   *   cached block. When `ttl === '1h'`, the extended-cache-ttl beta header
   *   is attached (verify header name against Anthropic docs at coding time).
   * - When `cacheControl.onLastToolDef === true`, the LAST tool gets a
   *   `cache_control: { type: 'ephemeral' }` breakpoint.
   */
  async generate(args: GenerateArgs): Promise<GenerateResult> {
    const headers: Record<string, string> = {};
    if (args.cacheControl?.onSystem?.ttl === '1h') {
      // Anthropic extended-cache-ttl beta — verify current header string in docs.
      headers['anthropic-beta'] = 'extended-cache-ttl-2025-04-11';
    }

    // Build system with optional cache_control block.
    // Anthropic SDK accepts either string or array of blocks; we always
    // use array form when cacheControl is requested so we can attach
    // cache_control to the last block.
    const systemBlock = args.cacheControl?.onSystem
      ? ([
          {
            type: 'text',
            text: args.systemPrompt,
            cache_control: {
              type: 'ephemeral',
              ...(args.cacheControl.onSystem.ttl
                ? { ttl: args.cacheControl.onSystem.ttl }
                : {}),
            },
          },
          // Anthropic SDK types may not yet model `ttl` on cache_control.
          // Cast below widens once at the boundary.
        ] as unknown as Anthropic.Messages.MessageCreateParams['system'])
      : args.systemPrompt;

    // Build tools with optional cache_control on the LAST tool.
    let tools: Anthropic.Messages.Tool[] | undefined;
    if (args.tools && args.tools.length > 0) {
      tools = args.tools.map((t, idx) => {
        const base: Anthropic.Messages.Tool = {
          name: t.name,
          description: t.description,
          // Anthropic's Tool.input_schema is typed specifically; our Record
          // matches its shape. Cast once at the boundary.
          input_schema:
            t.input_schema as unknown as Anthropic.Messages.Tool['input_schema'],
        };
        if (args.cacheControl?.onLastToolDef && idx === args.tools!.length - 1) {
          // cache_control lives on the tool object. SDK typing lags; cast.
          return {
            ...base,
            cache_control: { type: 'ephemeral' },
          } as unknown as Anthropic.Messages.Tool;
        }
        return base;
      });
    }

    // Map messages. Anthropic SDK accepts the same block shape we defined.
    const messages: Anthropic.Messages.MessageParam[] = args.messages.map((m) => {
      if (typeof m.content === 'string') {
        return { role: m.role, content: m.content };
      }
      return {
        role: m.role,
        // Our GenerateMessage content union (text | tool_use | tool_result)
        // is structurally a subset of Anthropic's MessageParam content. SDK
        // typing uses nominal block classes; cast once at the boundary.
        content: correctDeclaredMediaTypes(
          m.content
        ) as unknown as Anthropic.Messages.MessageParam['content'],
      };
    });

    const createParams: Anthropic.Messages.MessageCreateParamsNonStreaming = {
      model: args.model,
      max_tokens: args.maxTokens ?? 4096,
      system: systemBlock,
      messages,
    };
    if (tools) {
      createParams.tools = tools;
    }
    if (args.toolChoice) {
      // ToolChoice discriminated union is structurally identical to the SDK's
      // tool_choice shape; cast once at the boundary rather than duplicating
      // the SDK's branded union definition in provider.ts.
      createParams.tool_choice =
        args.toolChoice as unknown as Anthropic.Messages.MessageCreateParams['tool_choice'];
    }

    const requestOptions = {
      headers: Object.keys(headers).length > 0 ? headers : undefined,
    };
    // Streaming is opt-in per call (`onToolJsonDelta`) and changes only the
    // transport — both branches return the same assembled message below.
    const response = args.onToolJsonDelta
      ? await this.createMessageStream(createParams, requestOptions, args.onToolJsonDelta)
      : await this.createMessage(createParams, requestOptions);

    // Narrow the returned content to the Aihousekeeper union shape.
    const content: GenerateResult['content'] = [];
    for (const block of response.content) {
      if (block.type === 'text') {
        content.push({ type: 'text', text: block.text });
      } else if (block.type === 'tool_use') {
        content.push({
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input,
        });
      }
      // Other block types (thinking, server_tool_use, etc.) are not expected
      // in Aihousekeeper's prompts; drop them silently.
    }

    return {
      content,
      stopReason: response.stop_reason as GenerateResult['stopReason'],
      model: response.model,
      usage: {
        inputTokens: response.usage.input_tokens ?? 0,
        // Thinking tokens are already inside `output_tokens` on Anthropic.
        outputTokens: response.usage.output_tokens ?? 0,
        reasoningTokens: 0,
        cacheReadTokens: readCacheTokens(response.usage).read,
        cacheWrite5mTokens: readCacheTokens(response.usage).write5m,
        cacheWrite1hTokens: readCacheTokens(response.usage).write1h,
      },
    };
  }

  /**
   * Force a single-tool JSON output via tool_use. Throws
   * MalformedGenerateJSONError if the model fails to invoke the tool.
   */
  async generateStructured<T>(args: GenerateJSONArgs): Promise<T> {
    const result = await this.generate({
      model: args.model,
      systemPrompt: args.systemPrompt,
      messages: [{ role: 'user', content: args.userPrompt }],
      tools: [
        {
          name: 'output',
          description: 'Return structured output matching the provided JSON schema.',
          input_schema: args.schema,
        },
      ],
      toolChoice: { type: 'tool', name: 'output' },
      maxTokens: args.maxTokens ?? 4096,
    });

    const toolBlock = result.content.find((b) => b.type === 'tool_use');
    if (!toolBlock || toolBlock.type !== 'tool_use') {
      // Import at call site to avoid a cycle with fallback.ts.
      const { MalformedGenerateJSONError } = await import('./fallback');
      throw new MalformedGenerateJSONError(
        'Claude response did not include a tool_use block for generateStructured'
      );
    }
    return toolBlock.input as T;
  }

  private getExecutiveSummaryPrompt(): string {
    return `Create a concise executive summary for quick decision-making.

PROPERTY: {property_address}
INSPECTION DATE: {inspection_date}

IMPORTANT: Calculate the total estimated cost by summing ALL repair/replacement costs from all findings. Include major items like:
- Electrical panel replacements: $2000-5000+
- HVAC repairs/replacements: $500-8000+
- Roofing repairs: $500-15000+
- Plumbing issues: $200-5000+
- Structural repairs: $1000-20000+
Be thorough - don't underestimate!

FINDINGS:
{findings_json}

Return JSON:
{
  "overall_condition": "excellent" | "good" | "fair" | "poor",
  "key_concerns": ["concern 1", "concern 2"],
  "immediate_attention_items": ["item 1", "item 2"],
  "property_highlights": ["positive 1", "positive 2"],
  "total_estimated_cost_min": 0,
  "total_estimated_cost_max": 0,
  "executive_summary": "One paragraph overview"
}

CRITICAL: total_estimated_cost_min and total_estimated_cost_max MUST be numeric values (no $ or commas) representing the TOTAL sum of ALL repairs. For example, electrical panel ($2500-4500) + smoke detectors ($50-100) + minor repairs ($200-500) = total_estimated_cost_min: 2750, total_estimated_cost_max: 5100`;
  }
}

/**
 * Create a Claude provider instance
 */
export function createClaudeProvider(
  apiKey: string,
  options?: AIProviderOptions
): AIProvider {
  return new ClaudeProvider(apiKey, options);
}
