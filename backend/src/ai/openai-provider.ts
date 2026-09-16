/**
 * OpenAI portable chat + report-chunk provider.
 * PDF report methods use text chunks (same contract as Gemini); native PDF
 * upload is not required for Worker chunk pipelines.
 */

import type { Timeframe } from '../types';
import { scrubForLogs } from '../utils/log-scrubber';

import {
  EXTRACT_FINDINGS_PROMPT_V1,
  EXTRACT_FINDINGS_SYSTEM_PROMPT,
} from './prompts/extract-findings';
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
  GenerateImageArgs,
  GenerateImageResult,
  ImageReference,
} from './provider';

/** One block of a portable `GenerateMessage` content array. */
type GenerateMessageBlock = Exclude<GenerateMessage['content'], string>[number];

/**
 * Tell the model what each attached image is, in the order it was attached.
 *
 * `/v1/images/edits` takes an unlabelled array, so without this the model has
 * to guess which picture is the composition and which is a swatch — and it
 * guesses wrong in the expensive direction, treating a close-up of a tile as
 * the scene and inventing a room around it.
 */
function withReferenceLegend(prompt: string, references: ImageReference[]): string {
  const legend = references
    .map((reference, index) => {
      const nth = `Image ${index + 1}`;
      if (reference.role === 'layout') {
        return `- ${nth} is the scale drawing of the surface. It is authoritative for the shape, the area boundaries and the openings. Match it exactly.`;
      }
      if (reference.role === 'material') {
        return `- ${nth} is a photograph of one material. Use it ONLY for colour and texture — it says nothing about size.`;
      }
      return `- ${nth} is context for lighting and style only.`;
    })
    .join('\n');
  return `${prompt}\n\nATTACHED IMAGES:\n${legend}`;
}

/** `b64_json` → bytes, without a Buffer (Workers has no Node globals). */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

/** OpenAI chat-completions multi-part content (text + inline image data URI). */
type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export class OpenAIProvider implements AIProvider {
  readonly name = 'openai';
  private apiKey: string;
  private model: string;
  private onUsage?: AiUsageRecorder;

  constructor(apiKey: string, options?: AIProviderOptions) {
    this.apiKey = apiKey;
    this.model = options?.model || 'gpt-5.6-terra';
    this.onUsage = options?.onUsage;
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey);
  }

  async extractFindings(params: {
    chunks: ReportChunk[];
    promptVersion: string;
  }): Promise<ExtractedFinding[]> {
    const chunksText = params.chunks
      .map(
        (chunk) =>
          `[Page ${chunk.page_number || 'N/A'}${chunk.section_type ? ` - ${chunk.section_type}` : ''}]\n${chunk.content}`
      )
      .join('\n\n---\n\n');

    const userPrompt = EXTRACT_FINDINGS_PROMPT_V1.replace('{chunks}', chunksText);
    try {
      const parsed = await this.generateStructured<{ findings?: ExtractedFinding[] }>({
        systemPrompt: EXTRACT_FINDINGS_SYSTEM_PROMPT,
        userPrompt,
        schema: {
          type: 'object',
          properties: {
            findings: { type: 'array' },
          },
          required: ['findings'],
        },
        model: this.model,
        maxTokens: 8192,
      });
      return parsed.findings || [];
    } catch (error) {
      console.error('[openai-provider] extractFindings failed:', error);
      return [];
    }
  }

  async generateSummary(params: {
    findings: ExtractedFinding[];
    reportMetadata: ReportMetadata;
    promptVersion: string;
  }): Promise<ReportSummary> {
    const userPrompt = GENERATE_SUMMARY_PROMPT_V1.replace(
      '{property_address}',
      params.reportMetadata.property_address || 'Not specified'
    )
      .replace('{inspection_date}', params.reportMetadata.inspection_date || 'Not specified')
      .replace('{inspector_name}', params.reportMetadata.inspector_name || 'Not specified')
      .replace('{page_count}', String(params.reportMetadata.page_count || 'Unknown'))
      .replace('{findings_json}', JSON.stringify(params.findings, null, 2));

    try {
      return await this.generateStructured<ReportSummary>({
        systemPrompt: GENERATE_SUMMARY_SYSTEM_PROMPT,
        userPrompt,
        schema: {
          type: 'object',
          properties: {
            overall_condition: { type: 'string' },
            key_concerns: { type: 'array' },
            immediate_attention_items: { type: 'array' },
            property_highlights: { type: 'array' },
            executive_summary: { type: 'string' },
          },
          required: ['overall_condition', 'executive_summary'],
        },
        model: this.model,
        maxTokens: 4096,
      });
    } catch (error) {
      console.error('[openai-provider] generateSummary failed:', error);
      return {
        overall_condition: 'fair',
        key_concerns: [],
        immediate_attention_items: [],
        property_highlights: [],
        executive_summary: 'Unable to generate summary. Please review findings directly.',
      };
    }
  }

  async generateActionPlans(params: {
    findings: ExtractedFinding[];
    timeframes: Timeframe[];
    country: 'CA' | 'US';
    promptVersion: string;
  }): Promise<ActionPlanResult[]> {
    const userPrompt = GENERATE_ACTION_PLAN_PROMPT_V1.replace(
      '{country}',
      params.country === 'CA' ? 'Canada' : 'United States'
    )
      .replace('{findings_json}', JSON.stringify(params.findings, null, 2))
      .replace('{timeframes}', params.timeframes.join(', '));

    try {
      const parsed = await this.generateStructured<{ action_plans?: ActionPlanResult[] }>({
        systemPrompt: GENERATE_ACTION_PLAN_SYSTEM_PROMPT,
        userPrompt,
        schema: {
          type: 'object',
          properties: {
            action_plans: { type: 'array' },
          },
          required: ['action_plans'],
        },
        model: this.model,
        maxTokens: 8192,
      });
      return parsed.action_plans || [];
    } catch (error) {
      console.error('[openai-provider] generateActionPlans failed:', error);
      return [];
    }
  }

  async generate(args: GenerateArgs): Promise<GenerateResult> {
    const started = Date.now();
    const model = args.model || this.model;
    const messages: Array<{ role: string; content: string | OpenAIContentPart[] }> = [
      { role: 'system', content: args.systemPrompt },
    ];

    for (const m of args.messages) {
      if (typeof m.content === 'string') {
        messages.push({ role: m.role, content: m.content });
        continue;
      }

      // Every OpenAI entry in the model catalog advertises `image_understanding`,
      // so an image block must actually reach the API. Flattening the message to
      // its text blocks (as this did) dropped the picture silently — the model
      // then answered about a photo it never saw. Only switch to the multi-part
      // content form when there IS an image; text-only messages keep the plain
      // joined-string shape.
      const images = m.content.filter(
        (b): b is Extract<GenerateMessageBlock, { type: 'image' }> => b.type === 'image'
      );
      const text = m.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('\n');

      if (images.length === 0) {
        messages.push({ role: m.role, content: text });
        continue;
      }

      const parts: OpenAIContentPart[] = [];
      if (text) parts.push({ type: 'text', text });
      for (const img of images) {
        parts.push({
          type: 'image_url',
          image_url: { url: `data:${img.source.media_type};base64,${img.source.data}` },
        });
      }
      messages.push({ role: m.role, content: parts });
    }

    const tools =
      args.tools?.map((t) => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      })) ?? undefined;

    const body: Record<string, unknown> = {
      model,
      messages,
      max_completion_tokens: args.maxTokens ?? 4096,
    };
    if (tools?.length) {
      body.tools = tools;
      if (args.toolChoice?.type === 'any') body.tool_choice = 'required';
      else if (args.toolChoice?.type === 'tool') {
        body.tool_choice = { type: 'function', function: { name: args.toolChoice.name } };
      } else if (args.toolChoice?.type === 'auto') {
        body.tool_choice = 'auto';
      }
    }

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      // OpenAI's own 401 body quotes the key that was submitted ("Incorrect API
      // key provided: sk-…"), so echoing the upstream text verbatim wrote a live
      // credential into an Error message — and from there into logs. Scrub before
      // it is ever embedded.
      const errText = String(scrubForLogs(await res.text()));
      await this.emitUsage(model, null, Date.now() - started, 'error', `http_${res.status}`);
      throw new Error(`OpenAI HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      model?: string;
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{
            id: string;
            function: { name: string; arguments: string };
          }>;
        };
        finish_reason?: string;
      }>;
      usage?: {
        /** INCLUDES `prompt_tokens_details.cached_tokens`. */
        prompt_tokens?: number;
        /** INCLUDES `completion_tokens_details.reasoning_tokens`. */
        completion_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
        completion_tokens_details?: { reasoning_tokens?: number };
      };
    };

    const choice = json.choices?.[0];
    const content: GenerateResult['content'] = [];
    if (choice?.message?.content) {
      content.push({ type: 'text', text: choice.message.content });
    }
    for (const tc of choice?.message?.tool_calls ?? []) {
      let input: unknown = {};
      try {
        input = JSON.parse(tc.function.arguments || '{}');
      } catch {
        input = { raw: tc.function.arguments };
      }
      content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input });
    }

    const stopReason =
      choice?.finish_reason === 'tool_calls'
        ? 'tool_use'
        : choice?.finish_reason === 'length'
          ? 'max_tokens'
          : 'end_turn';

    // OpenAI reports INCLUSIVE totals: `prompt_tokens` already contains the
    // cached prefix, and `completion_tokens` already contains reasoning tokens.
    // Subtract to get the mutually-exclusive buckets `AiUsageEvent` requires —
    // otherwise cached tokens bill at the full input rate (they are 90% off)
    // and reasoning tokens get counted twice.
    const promptTokens = json.usage?.prompt_tokens ?? 0;
    const completionTokens = json.usage?.completion_tokens ?? 0;
    const cachedTokens = json.usage?.prompt_tokens_details?.cached_tokens ?? 0;
    const reasoningTokens = json.usage?.completion_tokens_details?.reasoning_tokens ?? 0;

    const usage = {
      inputTokens: Math.max(0, promptTokens - cachedTokens),
      outputTokens: Math.max(0, completionTokens - reasoningTokens),
      reasoningTokens,
      cacheReadTokens: cachedTokens,
      // Chat Completions never reports cache-WRITE tokens; caching is implicit.
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
    };
    await this.emitUsage(json.model || model, usage, Date.now() - started, 'ok');

    return {
      content,
      stopReason,
      model: json.model || model,
      usage,
    };
  }

  async generateStructured<T>(args: GenerateJSONArgs): Promise<T> {
    const toolName = 'structured_output';
    const result = await this.generate({
      model: args.model || this.model,
      systemPrompt: args.systemPrompt,
      messages: [{ role: 'user', content: args.userPrompt }],
      tools: [
        {
          name: toolName,
          description: 'Return the structured result',
          input_schema: args.schema,
        },
      ],
      toolChoice: { type: 'tool', name: toolName },
      maxTokens: args.maxTokens ?? 4096,
    });

    const block = result.content.find((b) => b.type === 'tool_use' && b.name === toolName);
    if (!block || block.type !== 'tool_use') {
      const text = result.content.find((b) => b.type === 'text');
      if (text && text.type === 'text') {
        const match = text.text.match(/\{[\s\S]*\}/);
        if (match) return JSON.parse(match[0]) as T;
      }
      throw new Error('OpenAI did not return structured tool output');
    }
    return block.input as T;
  }

  /**
   * Image generation, with optional reference images.
   *
   * Two endpoints, chosen by whether there is anything to compose against:
   *
   *  - **references present → `/v1/images/edits`**, multipart, every reference
   *    posted under `image[]`. This is the path the surface preview takes,
   *    because the scale-true drawing is the whole reason the render can be
   *    trusted — sent as a prompt-only generation it would be a picture of a
   *    tiled wall rather than a picture of *this* tiled wall.
   *  - **no references → `/v1/images/generations`**, plain JSON.
   *
   * The `role` on each reference is folded into the prompt rather than into the
   * request, because the endpoint has no field for it: the model is told, in
   * order, which image is the layout and which are materials. Silently posting
   * them as an unlabelled set is how a material photo gets treated as the
   * composition and the geometry is thrown away.
   *
   * `b64_json` is the only response shape asked for. The URL form expires in an
   * hour, and the bytes are going straight into R2 — fetching a temporary URL
   * to copy it adds a second network hop that can fail after the image has
   * already been paid for.
   */
  async generateImage(args: GenerateImageArgs): Promise<GenerateImageResult> {
    const started = Date.now();
    const model = args.model || 'gpt-image-1';
    const references = args.references ?? [];
    const prompt = references.length > 0 ? withReferenceLegend(args.prompt, references) : args.prompt;

    let res: Response;
    if (references.length > 0) {
      const form = new FormData();
      form.append('model', model);
      form.append('prompt', prompt);
      if (args.size) form.append('size', args.size);
      if (args.quality) form.append('quality', args.quality);
      for (const reference of references) {
        form.append('image[]', new Blob([reference.bytes], { type: reference.mime }), reference.filename);
      }
      res = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
      });
    } else {
      res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          prompt,
          n: 1,
          ...(args.size ? { size: args.size } : {}),
          ...(args.quality ? { quality: args.quality } : {}),
        }),
      });
    }

    if (!res.ok) {
      // Same scrub as `generate`: OpenAI's 401 body quotes the submitted key.
      const errText = String(scrubForLogs(await res.text()));
      await this.emitUsage(model, null, Date.now() - started, 'error', `http_${res.status}`);
      throw new Error(`OpenAI images HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      data?: Array<{ b64_json?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) {
      await this.emitUsage(model, null, Date.now() - started, 'error', 'empty_image');
      throw new Error('OpenAI images returned no image');
    }

    await this.emitUsage(
      model,
      {
        inputTokens: json.usage?.input_tokens ?? 0,
        outputTokens: json.usage?.output_tokens ?? 0,
        reasoningTokens: 0,
        cacheReadTokens: 0,
        cacheWrite5mTokens: 0,
        cacheWrite1hTokens: 0,
      },
      Date.now() - started,
      'ok'
    );

    return { bytes: base64ToArrayBuffer(b64), mime: 'image/png', model };
  }

  private async emitUsage(
    model: string,
    usage: GenerateResult['usage'] | null,
    latencyMs: number,
    status: 'ok' | 'error',
    errorKind?: string
  ): Promise<void> {
    if (!this.onUsage) return;
    try {
      await this.onUsage({
        provider: 'openai',
        model,
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        reasoningTokens: usage?.reasoningTokens ?? 0,
        cacheReadTokens: usage?.cacheReadTokens ?? 0,
        cacheWrite5mTokens: usage?.cacheWrite5mTokens ?? 0,
        cacheWrite1hTokens: usage?.cacheWrite1hTokens ?? 0,
        latencyMs,
        status,
        errorKind,
      });
    } catch (err) {
      console.error('[openai-provider] onUsage failed:', err);
    }
  }
}

export function createOpenAIProvider(
  apiKey: string,
  options?: AIProviderOptions
): OpenAIProvider {
  return new OpenAIProvider(apiKey, options);
}
