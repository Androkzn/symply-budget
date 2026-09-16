/**
 * Kaizen Coach Chat — provider-agnostic message adapter
 *
 * Mirrors the `Simple Language` teaching-chat envelope: `GenerateMessage`,
 * `GenerateContentBlock`, `GenerateToolDef`, `GenerateResult`. Provider-specific
 * adaptation (OpenAI here; Gemini/etc. are pluggable) is hidden behind
 * `KaizenChatProvider`. The bounded tool loop in the route talks ONLY to this
 * envelope and never to a provider SDK directly.
 *
 * v1 ships an OpenAI adapter because the existing `ai.ts` routes already use
 * `OPENAI_API_KEY` and OpenAI's `tool_calls` JSON-schema function calling, which
 * maps cleanly onto the bounded tool loop.
 */

import type { Env } from '../../../types';
import { resolveProviderApiKey } from '../../ai-credential-resolver';

/** Roles in the provider-agnostic transcript. */
export type GenerateRole = 'system' | 'user' | 'assistant' | 'tool';

/** Provider-agnostic content block. */
export type GenerateContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string };

/** Provider-agnostic message. */
export interface GenerateMessage {
  role: GenerateRole;
  /** Either a plain string or structured blocks. */
  content: string | GenerateContentBlock[];
}

/** Provider-agnostic tool definition (JSON schema). */
export interface GenerateToolDef {
  name: string;
  description: string;
  /** JSON Schema object for the tool's input. */
  parameters: Record<string, unknown>;
}

/** A tool-use request emitted by the model. */
export interface GenerateToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** Provider-agnostic generation result. */
export interface GenerateResult {
  /** Assistant text (may be empty when the model only requested tools). */
  text: string;
  /** Tool calls the model wants executed; empty when the turn is final. */
  toolUses: GenerateToolUse[];
  /** 'stop' when final, 'tool_use' when tools were requested. */
  stopReason: 'stop' | 'tool_use' | 'length' | 'error';
  usage: Record<string, number> | null;
  model: string;
}

export interface GenerateRequest {
  system: string;
  messages: GenerateMessage[];
  tools: GenerateToolDef[];
  maxTokens?: number;
  temperature?: number;
}

/** Provider interface every backend the coach can call must implement. */
export interface KaizenChatProvider {
  readonly providerName: string;
  readonly model: string;
  generate(req: GenerateRequest): Promise<GenerateResult>;
}

// ---------------------------------------------------------------------------
// OpenAI adapter
// ---------------------------------------------------------------------------

type OpenAIMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    }
  | { role: 'tool'; tool_call_id: string; content: string };

/** Convert the agnostic transcript into OpenAI chat-completions messages. */
function toOpenAIMessages(system: string, messages: GenerateMessage[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = [{ role: 'system', content: system }];

  for (const m of messages) {
    if (typeof m.content === 'string') {
      if (m.role === 'tool') {
        // A bare-string tool message is malformed for OpenAI; skip defensively.
        continue;
      }
      out.push({ role: m.role as 'user' | 'assistant', content: m.content });
      continue;
    }

    // Structured blocks.
    const toolUses = m.content.filter(
      (b): b is Extract<GenerateContentBlock, { type: 'tool_use' }> => b.type === 'tool_use'
    );
    const toolResults = m.content.filter(
      (b): b is Extract<GenerateContentBlock, { type: 'tool_result' }> =>
        b.type === 'tool_result'
    );
    const text = m.content
      .filter((b): b is Extract<GenerateContentBlock, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('\n');

    if (m.role === 'assistant' && toolUses.length > 0) {
      out.push({
        role: 'assistant',
        content: text || null,
        tool_calls: toolUses.map((t) => ({
          id: t.id,
          type: 'function',
          function: { name: t.name, arguments: JSON.stringify(t.input ?? {}) },
        })),
      });
    } else if (toolResults.length > 0) {
      // Each tool result becomes its own role:'tool' message.
      for (const tr of toolResults) {
        out.push({ role: 'tool', tool_call_id: tr.toolUseId, content: tr.content });
      }
    } else if (text) {
      out.push({ role: m.role as 'user' | 'assistant', content: text });
    }
  }

  return out;
}

export class OpenAIChatProvider implements KaizenChatProvider {
  readonly providerName = 'openai';
  readonly model: string;

  constructor(
    private readonly apiKey: string,
    model = 'gpt-4o-mini'
  ) {
    this.model = model;
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const body = {
      model: this.model,
      messages: toOpenAIMessages(req.system, req.messages),
      max_tokens: req.maxTokens ?? 1200,
      temperature: req.temperature ?? 0.4,
      tools: req.tools.map((t) => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      })),
      tool_choice: 'auto' as const,
    };

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`OpenAI request failed (${response.status}): ${errText.slice(0, 300)}`);
    }

    const json: any = await response.json();
    const choice = json.choices?.[0];
    const msg = choice?.message ?? {};
    const finish = choice?.finish_reason as string | undefined;

    const toolUses: GenerateToolUse[] = Array.isArray(msg.tool_calls)
      ? msg.tool_calls
          .filter((tc: any) => tc?.type === 'function' && tc.function?.name)
          .map((tc: any) => {
            let input: Record<string, unknown> = {};
            try {
              input = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
            } catch {
              input = { _raw: String(tc.function.arguments ?? '') };
            }
            return { id: tc.id, name: tc.function.name, input };
          })
      : [];

    const stopReason: GenerateResult['stopReason'] =
      toolUses.length > 0
        ? 'tool_use'
        : finish === 'length'
          ? 'length'
          : 'stop';

    return {
      text: typeof msg.content === 'string' ? msg.content : '',
      toolUses,
      stopReason,
      usage: json.usage
        ? {
            prompt_tokens: json.usage.prompt_tokens ?? 0,
            completion_tokens: json.usage.completion_tokens ?? 0,
            total_tokens: json.usage.total_tokens ?? 0,
          }
        : null,
      model: json.model ?? this.model,
    };
  }
}

/**
 * Resolve a provider for the acting user. v1: OpenAI only (matches existing
 * `ai.ts` usage). Runs on the user's own connected BYOK OpenAI key when present,
 * otherwise the SimpleHouse-managed key. Returns null when no key is available
 * so the route can return a clean 503.
 */
export async function resolveChatProvider(
  env: Env,
  userId: string | null | undefined
): Promise<KaizenChatProvider | null> {
  const { apiKey } = await resolveProviderApiKey(env, userId, 'openai');
  if (apiKey) {
    return new OpenAIChatProvider(apiKey);
  }
  return null;
}
