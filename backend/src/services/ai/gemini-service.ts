// Gemini AI Service - Backend implementation
import { geminiLegacyToolRegistry } from '../../ai/gemini-legacy-tool-registry';
import {
  createGeminiClient,
  generateText,
  getGeminiModel,
  streamLegacyChat,
} from '../../ai/gemini-sdk-client';

export interface StreamChunk {
  type: 'text' | 'function_call' | 'error' | 'done';
  content?: string;
  data?: any;
  message?: string;
}

const DEFAULT_CHAT_MODEL = 'gemini-3.5-flash';

export class GeminiService {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Stream a chat response with Server-Sent Events format
   */
  async *streamChat(
    message: string,
    history: Array<{ role: string; content: string }>,
    systemPrompt: string
  ): AsyncGenerator<StreamChunk> {
    try {
      for await (const chunk of streamLegacyChat(this.apiKey, {
        model: DEFAULT_CHAT_MODEL,
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 2048,
        },
        functionDeclarations: geminiLegacyToolRegistry,
        systemPrompt,
        history,
        message,
      })) {
        yield chunk;
      }

      yield { type: 'done' };
    } catch (error: any) {
      console.error('[GeminiService] Stream error:', error);
      yield {
        type: 'error',
        message: error.message || 'Failed to get response from AI',
      };
    }
  }

  /**
   * Generate content without streaming (for structured responses)
   * Useful for tasks like quote comparison where we need a complete JSON response
   */
  async generateContent(systemPrompt: string, userPrompt: string): Promise<string> {
    try {
      const client = createGeminiClient(this.apiKey);
      const model = getGeminiModel(client, {
        model: DEFAULT_CHAT_MODEL,
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 4096,
        },
      });

      return await generateText(model, [{ text: systemPrompt }, { text: userPrompt }]);
    } catch (error: any) {
      console.error('[GeminiService] Generation error:', error);
      throw new Error(error.message || 'Failed to generate content from AI');
    }
  }
}
