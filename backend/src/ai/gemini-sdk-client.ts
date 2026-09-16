/**
 * @google/generative-ai SDK boundary (CA-2 / Track A1).
 *
 * Sole import site for the Google Generative AI SDK under `backend/src/ai/**`.
 * Service modules must use these helpers instead of importing the SDK directly.
 */
import {
  GoogleGenerativeAI,
  type FunctionDeclaration,
  type GenerationConfig,
  type GenerativeModel,
  type Part,
} from '@google/generative-ai';

export type { FunctionDeclaration, GenerationConfig, Part, GenerativeModel };

/** Stable multimodal Flash model used by Books comprehension flows. */
export const BOOKS_GEMINI_MODEL = 'gemini-flash-latest';

export function createGeminiClient(apiKey: string): GoogleGenerativeAI {
  return new GoogleGenerativeAI(apiKey);
}

export interface GeminiModelConfig {
  model: string;
  generationConfig?: GenerationConfig;
  tools?: Array<{ functionDeclarations: FunctionDeclaration[] }>;
}

export function getGeminiModel(
  client: GoogleGenerativeAI,
  config: GeminiModelConfig,
): GenerativeModel {
  return client.getGenerativeModel(config);
}

/** Default Books structured-output generation config (thinking disabled, JSON MIME). */
export function booksStructuredGenerationConfig(thinkingBudget = 0): GenerationConfig {
  return {
    thinkingConfig: { thinkingBudget },
    responseMimeType: 'application/json',
    maxOutputTokens: 65536,
  } as unknown as GenerationConfig;
}

/** Accumulate streamed text chunks; falls back to result.response.text(). */
export async function accumulateStreamText(
  model: GenerativeModel,
  request: string | Part[] | Array<string | Part>,
): Promise<string> {
  const result = await model.generateContentStream(request);
  let text = '';
  for await (const chunk of result.stream) {
    try {
      text += chunk.text();
    } catch {
      // Non-text chunk (safety/usage metadata) — keep streaming.
    }
  }
  if (!text) text = (await result.response).text();
  return text;
}

/** Single-shot generateContent returning text. */
export async function generateText(
  model: GenerativeModel,
  request: string | Part[] | Array<string | Part>,
): Promise<string> {
  const result = await model.generateContent(request);
  return result.response.text();
}

export interface LegacyChatStreamChunk {
  type: 'text' | 'function_call';
  content?: string;
  data?: { name: string; args: unknown };
}

/**
 * Legacy Smart Home /chat SSE: streaming chat with Gemini-native function declarations.
 */
export async function* streamLegacyChat(
  apiKey: string,
  args: {
    model: string;
    generationConfig: GenerationConfig;
    functionDeclarations: FunctionDeclaration[];
    systemPrompt: string;
    history: Array<{ role: string; content: string }>;
    message: string;
    modelAck?: string;
  },
): AsyncGenerator<LegacyChatStreamChunk> {
  const client = createGeminiClient(apiKey);
  const model = getGeminiModel(client, {
    model: args.model,
    generationConfig: args.generationConfig,
    tools: [{ functionDeclarations: args.functionDeclarations }],
  });

  const chatHistory = [
    { role: 'user', parts: [{ text: args.systemPrompt }] },
    {
      role: 'model',
      parts: [
        {
          text:
            args.modelAck ??
            "Understood. I'm your Smart Home assistant, ready to help you manage your home maintenance tasks, complete onboarding, and handle daily tasks. How can I help you today?",
        },
      ],
    },
    ...args.history.map((msg) => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }],
    })),
  ];

  const chat = model.startChat({ history: chatHistory });
  const result = await chat.sendMessageStream(args.message);

  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) {
      yield { type: 'text', content: text };
    }

    const functionCalls = chunk.functionCalls();
    if (functionCalls?.length) {
      for (const call of functionCalls) {
        yield {
          type: 'function_call',
          data: { name: call.name, args: call.args },
        };
      }
    }
  }
}
