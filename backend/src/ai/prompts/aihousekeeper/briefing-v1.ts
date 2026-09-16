/**
 * Aihousekeeper morning briefing prompt — v1.
 *
 * Emits either a warm, brief composed briefing or a flag-empty response when
 * there's nothing actionable today. The composer calls Claude with
 * `tool_choice: { type: 'any' }` over these two tools so the model never
 * falls into prose / JSON-mode unreliability.
 */

import type { GenerateToolDef } from '../../provider';

export const BRIEFING_PROMPT_VERSION = 'aihousekeeper-briefing-v1';

export const BRIEFING_SYSTEM_PROMPT = `You are Aihousekeeper, a warm but brief household assistant.

You will receive today's household context (overdue tasks, appointments, weather, open questions, recent history). Compose a morning briefing in Aihousekeeper's warm_brief tone:
- One short paragraph (2-3 sentences) greeting and orienting the household.
- 3-5 bullets of concrete asks or reminders.
- No hedging, no filler ("Today, here are some things..."), no rhetorical questions.

If there is nothing genuinely actionable today (no overdue tasks, no appointments, no urgent weather, no open questions), call \`empty_briefing\` with a short reason string instead of inventing content.

Always return via exactly one of the two tools: \`compose_briefing\` or \`empty_briefing\`.`;

export const BRIEFING_TOOLS: GenerateToolDef[] = [
  {
    name: 'compose_briefing',
    description: 'Emit the composed morning briefing for today.',
    input_schema: {
      type: 'object',
      required: ['paragraph', 'bullets', 'source_signals'],
      properties: {
        paragraph: {
          type: 'string',
          description: 'One short paragraph (2-3 sentences) orienting the household.',
        },
        bullets: {
          type: 'array',
          minItems: 3,
          maxItems: 5,
          items: { type: 'string' },
          description: 'Concrete asks or reminders for today.',
        },
        source_signals: {
          type: 'array',
          description:
            'Array of signal objects the briefing drew from, for trust-ledger attribution.',
          items: {
            type: 'object',
            required: ['kind', 'ref'],
            properties: {
              kind: {
                type: 'string',
                enum: [
                  'overdue_task',
                  'appointment',
                  'weather',
                  'maintenance_suggestion',
                  'open_question',
                  'history',
                ],
              },
              ref: { type: 'string', description: 'Opaque reference (id or short descriptor).' },
            },
          },
        },
      },
    },
  },
  {
    name: 'empty_briefing',
    description:
      'Indicate the household has no briefable activity today. Use sparingly — prefer compose_briefing if any meaningful signal exists.',
    input_schema: {
      type: 'object',
      required: ['reason', 'source_signals'],
      properties: {
        reason: {
          type: 'string',
          description: 'Short internal reason (not shown to user), e.g. "no_signals" or "quiet_weekend".',
        },
        source_signals: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              kind: { type: 'string' },
              ref: { type: 'string' },
            },
          },
        },
      },
    },
  },
];
