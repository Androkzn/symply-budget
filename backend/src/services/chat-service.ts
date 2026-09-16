import { eq, and, isNull, desc } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import * as schema from '../db/schema';
import type { Database, Env, SystemCategory, Severity } from '../types';

import { resolveProviderApiKey } from './ai-credential-resolver';
import { HouseholdService } from './household-service';

interface ChatContext {
  reportId?: string;
  householdId: string;
  findings: Array<{
    system_category: SystemCategory;
    severity: Severity;
    title: string;
    description: string;
    plain_language_summary: string | null;
  }>;
  reportMetadata?: {
    filename: string;
    property_address: string | null;
    inspection_date: string | null;
  };
}

const CHAT_SYSTEM_PROMPT = `You are a helpful home inspection assistant for the Simple House app. Your role is to:
1. Answer questions about home inspection findings clearly and simply
2. Explain technical terms in plain language
3. Provide guidance on maintenance and repairs
4. Help prioritize issues based on urgency and safety
5. Give estimated cost ranges when asked (with disclaimers that these are estimates)

Important guidelines:
- Always be helpful and reassuring while being honest about issues
- If you don't have specific information from the inspection report, say so
- Never make up findings that aren't in the provided context
- For safety-critical issues, always recommend professional consultation
- Costs are rough estimates for the US/Canada market and can vary significantly

Context from the home inspection will be provided. Base your answers on this context.`;

export class ChatService {
  private db: Database;
  private env: Env;
  private householdService: HouseholdService;

  constructor(env: Env, d1: D1Database) {
    this.db = drizzle(d1, { schema });
    this.env = env;
    this.householdService = new HouseholdService(env, d1);
  }

  /**
   * Send a message and get AI response
   */
  async chat(
    householdId: string,
    userId: string,
    message: string,
    reportId?: string
  ): Promise<{ response: string; context_used: boolean }> {
    // Verify user has access to household
    await this.householdService.getHousehold(householdId, userId);

    // Gather context
    const context = await this.gatherContext(householdId, reportId);

    // Build the prompt with context
    const contextPrompt = this.buildContextPrompt(context);

    // Call Gemini API — billed to the acting user's own key when connected (BYOK).
    const response = await this.callGemini(contextPrompt, message, userId);

    return {
      response,
      context_used: context.findings.length > 0,
    };
  }

  /**
   * Get chat suggestions based on findings
   */
  async getSuggestions(
    householdId: string,
    userId: string,
    reportId?: string
  ): Promise<string[]> {
    // Verify access
    await this.householdService.getHousehold(householdId, userId);

    const suggestions: string[] = [];

    // Get findings to generate relevant suggestions
    if (reportId) {
      const findings = await this.db
        .select()
        .from(schema.findings)
        .where(eq(schema.findings.report_id, reportId))
        .orderBy(desc(schema.findings.severity))
        .limit(5)
        .all();

      // Generate suggestions based on critical findings
      const criticalFindings = findings.filter((f) => f.severity === 'critical');
      if (criticalFindings.length > 0) {
        suggestions.push('What are the most urgent issues I need to address?');
        suggestions.push('How much will it cost to fix the critical problems?');
      }

      // Add system-specific suggestions
      const systems = [...new Set(findings.map((f) => f.system_category))];
      if (systems.includes('roof')) {
        suggestions.push('Tell me more about the roof condition');
      }
      if (systems.includes('electrical')) {
        suggestions.push('Is the electrical system safe?');
      }
      if (systems.includes('plumbing')) {
        suggestions.push('What plumbing issues should I be aware of?');
      }
    }

    // Add general suggestions
    if (suggestions.length < 4) {
      suggestions.push('What should I do first after buying this home?');
      suggestions.push('What maintenance tasks should I plan for?');
      suggestions.push('Explain the inspection findings in simple terms');
    }

    return suggestions.slice(0, 4);
  }

  /**
   * Gather context for RAG
   */
  private async gatherContext(householdId: string, reportId?: string): Promise<ChatContext> {
    const context: ChatContext = {
      householdId,
      findings: [],
    };

    // If specific report requested, get its findings
    if (reportId) {
      const report = await this.db
        .select()
        .from(schema.reports)
        .where(
          and(
            eq(schema.reports.id, reportId),
            eq(schema.reports.household_id, householdId),
            isNull(schema.reports.deleted_at)
          )
        )
        .get();

      if (report) {
        context.reportId = reportId;
        context.reportMetadata = {
          filename: report.filename,
          property_address: report.property_address,
          inspection_date: report.inspection_date,
        };

        const findings = await this.db
          .select()
          .from(schema.findings)
          .where(eq(schema.findings.report_id, reportId))
          .all();

        context.findings = findings.map((f) => ({
          system_category: f.system_category as SystemCategory,
          severity: f.severity as Severity,
          title: f.title,
          description: f.description,
          plain_language_summary: f.plain_language_summary,
        }));
      }
    } else {
      // Get findings from all reports in household
      const reports = await this.db
        .select()
        .from(schema.reports)
        .where(
          and(
            eq(schema.reports.household_id, householdId),
            eq(schema.reports.status, 'completed'),
            isNull(schema.reports.deleted_at)
          )
        )
        .orderBy(desc(schema.reports.created_at))
        .limit(3)
        .all();

      for (const report of reports) {
        const findings = await this.db
          .select()
          .from(schema.findings)
          .where(eq(schema.findings.report_id, report.id))
          .all();

        context.findings.push(
          ...findings.map((f) => ({
            system_category: f.system_category as SystemCategory,
            severity: f.severity as Severity,
            title: f.title,
            description: f.description,
            plain_language_summary: f.plain_language_summary,
          }))
        );
      }
    }

    return context;
  }

  /**
   * Build context prompt for RAG
   */
  private buildContextPrompt(context: ChatContext): string {
    let prompt = CHAT_SYSTEM_PROMPT + '\n\n';

    if (context.reportMetadata) {
      prompt += '## Report Information\n';
      prompt += `- File: ${context.reportMetadata.filename}\n`;
      if (context.reportMetadata.property_address) {
        prompt += `- Property: ${context.reportMetadata.property_address}\n`;
      }
      if (context.reportMetadata.inspection_date) {
        prompt += `- Inspection Date: ${context.reportMetadata.inspection_date}\n`;
      }
      prompt += '\n';
    }

    if (context.findings.length > 0) {
      prompt += '## Inspection Findings\n\n';

      // Group by severity
      const critical = context.findings.filter((f) => f.severity === 'critical');
      const major = context.findings.filter((f) => f.severity === 'major');
      const minor = context.findings.filter((f) => f.severity === 'minor');
      const informational = context.findings.filter((f) => f.severity === 'informational');

      if (critical.length > 0) {
        prompt += '### Critical Issues (Immediate Attention Required)\n';
        for (const f of critical) {
          prompt += `- **${f.title}** (${f.system_category}): ${f.plain_language_summary || f.description}\n`;
        }
        prompt += '\n';
      }

      if (major.length > 0) {
        prompt += '### Major Issues (Should Be Addressed Soon)\n';
        for (const f of major) {
          prompt += `- **${f.title}** (${f.system_category}): ${f.plain_language_summary || f.description}\n`;
        }
        prompt += '\n';
      }

      if (minor.length > 0) {
        prompt += '### Minor Issues\n';
        for (const f of minor) {
          prompt += `- **${f.title}** (${f.system_category}): ${f.plain_language_summary || f.description}\n`;
        }
        prompt += '\n';
      }

      if (informational.length > 0) {
        prompt += '### Informational Notes\n';
        for (const f of informational) {
          prompt += `- **${f.title}** (${f.system_category}): ${f.plain_language_summary || f.description}\n`;
        }
        prompt += '\n';
      }
    } else {
      prompt += 'No inspection findings are currently available for this household.\n\n';
    }

    return prompt;
  }

  /**
   * Call Gemini API for chat response
   */
  private async callGemini(
    systemPrompt: string,
    userMessage: string,
    userId: string | null
  ): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent`;

    const { apiKey } = await resolveProviderApiKey(this.env, userId, 'gemini');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: `${systemPrompt}\n\nUser Question: ${userMessage}` }],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 2048,
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini API error:', errorText);
      return 'I apologize, but I encountered an error processing your question. Please try again.';
    }

    const data = await response.json() as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return 'I apologize, but I could not generate a response. Please try rephrasing your question.';
    }

    return text;
  }
}
