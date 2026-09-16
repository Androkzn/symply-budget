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
  GenerateResult,
  GenerateJSONArgs,
} from './provider';

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
    finishReason?: string;
  }>;
  // Token accounting returned by the Generative Language API on every response.
  /** The model that actually served the request — may differ from the alias we asked for. */
  modelVersion?: string;
  usageMetadata?: {
    /** INCLUDES `cachedContentTokenCount`. Subtract before billing at the input rate. */
    promptTokenCount?: number;
    /** Visible output. Does NOT include `thoughtsTokenCount`. */
    candidatesTokenCount?: number;
    cachedContentTokenCount?: number;
    /**
     * Thinking tokens. Billed at the OUTPUT rate and reported OUTSIDE
     * `candidatesTokenCount` — Google's own total is
     * prompt + candidates + toolUsePrompt + thoughts. Every Gemini model in our
     * catalog thinks by default, so omitting this undercounts output badly.
     */
    thoughtsTokenCount?: number;
    /** Tokens from tool-use prompts, billed as input. */
    toolUsePromptTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: {
    message: string;
    code: number;
  };
}

export class GeminiProvider implements AIProvider {
  readonly name = 'gemini';
  private apiKey: string;
  private model: string;
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
  private onUsage?: AiUsageRecorder;

  constructor(apiKey: string, options?: AIProviderOptions) {
    this.apiKey = apiKey;
    this.model = options?.model || 'gemini-3.5-flash';
    this.onUsage = options?.onUsage;
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey);
  }

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

    const response = await this.callGemini(
      EXTRACT_FINDINGS_SYSTEM_PROMPT,
      prompt
    );

    try {
      const parsed = JSON.parse(this.extractJsonFromResponse(response));
      return parsed.findings || [];
    } catch (error) {
      console.error('Failed to parse Gemini response:', error, response);
      return [];
    }
  }

  async generateSummary(params: {
    findings: ExtractedFinding[];
    reportMetadata: ReportMetadata;
    promptVersion: string;
  }): Promise<ReportSummary> {
    const { findings, reportMetadata, promptVersion } = params;

    const prompt = this.getPrompt('generate_summary', promptVersion)
      .replace('{property_address}', reportMetadata.property_address || 'Not specified')
      .replace('{inspection_date}', reportMetadata.inspection_date || 'Not specified')
      .replace('{inspector_name}', reportMetadata.inspector_name || 'Not specified')
      .replace('{page_count}', String(reportMetadata.page_count || 'Unknown'))
      .replace('{findings_json}', JSON.stringify(findings, null, 2));

    const response = await this.callGemini(
      GENERATE_SUMMARY_SYSTEM_PROMPT,
      prompt
    );

    try {
      return JSON.parse(this.extractJsonFromResponse(response));
    } catch (error) {
      console.error('Failed to parse summary response:', error, response);
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
    const { findings, timeframes, country, promptVersion } = params;

    const prompt = this.getPrompt('generate_action_plan', promptVersion)
      .replace('{country}', country === 'CA' ? 'Canada' : 'United States')
      .replace('{findings_json}', JSON.stringify(findings, null, 2))
      .replace('{timeframes}', timeframes.join(', '));

    const response = await this.callGemini(
      GENERATE_ACTION_PLAN_SYSTEM_PROMPT,
      prompt
    );

    try {
      const parsed = JSON.parse(this.extractJsonFromResponse(response));
      return parsed.action_plans || [];
    } catch (error) {
      console.error('Failed to parse action plan response:', error, response);
      return [];
    }
  }

  private async callGemini(systemPrompt: string, userPrompt: string): Promise<string> {
    // Key in header — never query string (plan §7.1 / Phase 7).
    const url = `${this.baseUrl}/models/${this.model}:generateContent`;
    const started = Date.now();

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 8192,
        },
        safetySettings: [
          {
            category: 'HARM_CATEGORY_HARASSMENT',
            threshold: 'BLOCK_NONE',
          },
          {
            category: 'HARM_CATEGORY_HATE_SPEECH',
            threshold: 'BLOCK_NONE',
          },
          {
            category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
            threshold: 'BLOCK_NONE',
          },
          {
            category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
            threshold: 'BLOCK_NONE',
          },
        ],
      }),
    });

    if (!response.ok) {
      // Never embed an upstream body verbatim — provider error payloads can quote
      // the submitted credential back at us (see the OpenAI 401 shape), and this
      // message travels into logs.
      const errorText = String(scrubForLogs(await response.text()));
      await this.emitError(Date.now() - started, `http_${response.status}`);
      throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as GeminiResponse;

    if (data.error) {
      await this.emitError(Date.now() - started, `api_${data.error.code ?? 'unknown'}`);
      throw new Error(`Gemini API error: ${data.error.message}`);
    }

    await this.emitUsage(data.usageMetadata, data.modelVersion, Date.now() - started);

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      // Usage above is already recorded: the tokens were spent even though the
      // candidate came back empty (a safety block or a pure-thinking response).
      throw new Error('No response text from Gemini');
    }

    return text;
  }

  private async emitUsage(
    usage: GeminiResponse['usageMetadata'],
    servedModel: string | undefined,
    latencyMs: number
  ): Promise<void> {
    if (!this.onUsage || !usage) return;

    const prompt = usage.promptTokenCount ?? 0;
    const cached = usage.cachedContentTokenCount ?? 0;
    try {
      await this.onUsage({
        provider: 'gemini',
        // `modelVersion` is what actually served the call. Reporting the alias
        // we asked for mislabels the per-model breakdown whenever a `-preview`
        // id resolves to a dated build.
        model: servedModel || this.model,
        // Gemini's `promptTokenCount` INCLUDES cached tokens. Billing the raw
        // value charged every cached token twice — once at the full input rate
        // here, once again at the cache rate downstream.
        inputTokens: Math.max(0, prompt - cached) + (usage.toolUsePromptTokenCount ?? 0),
        outputTokens: usage.candidatesTokenCount ?? 0,
        // Thinking tokens sit outside `candidatesTokenCount` and bill as output.
        reasoningTokens: usage.thoughtsTokenCount ?? 0,
        cacheReadTokens: cached,
        // Gemini bills context-cache STORAGE per token-hour, not per write, and
        // there is no per-request field for it — see `model-pricing.ts`.
        cacheWrite5mTokens: 0,
        cacheWrite1hTokens: 0,
        latencyMs,
        status: 'ok',
      });
    } catch (err) {
      console.error('[gemini-provider] onUsage failed:', err);
    }
  }

  private async emitError(latencyMs: number, errorKind: string): Promise<void> {
    if (!this.onUsage) return;
    try {
      await this.onUsage({
        provider: 'gemini',
        model: this.model,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cacheReadTokens: 0,
        cacheWrite5mTokens: 0,
        cacheWrite1hTokens: 0,
        latencyMs,
        status: 'error',
        errorKind,
      });
    } catch (err) {
      console.error('[gemini-provider] onUsage (error path) failed:', err);
    }
  }

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

  // ---------- Aihousekeeper §B10-ext: stubbed; Aihousekeeper runs on Claude ----------

  // Aihousekeeper primarily uses Claude. Gemini support for Aihousekeeper-style generate /
  // generateStructured is out of scope for Stream B; when a second provider
  // is ever needed, wire Gemini's function-calling API here. For now, throw
  // so the factory surfaces the mismatch fast.
  async generate(_args: GenerateArgs): Promise<GenerateResult> {
    throw new Error(
      'GeminiProvider.generate is not implemented for Aihousekeeper. Use ClaudeProvider.'
    );
  }

  async generateStructured<T>(_args: GenerateJSONArgs): Promise<T> {
    throw new Error(
      'GeminiProvider.generateStructured is not implemented for Aihousekeeper. Use ClaudeProvider.'
    );
  }

  private getPrompt(type: string, version: string): string {
    // In production, these would be fetched from KV storage
    // For now, return the hardcoded prompts
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
}

/**
 * Create a Gemini provider instance
 */
export function createGeminiProvider(
  apiKey: string,
  options?: AIProviderOptions
): AIProvider {
  return new GeminiProvider(apiKey, options);
}
