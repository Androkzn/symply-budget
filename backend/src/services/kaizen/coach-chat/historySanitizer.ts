/**
 * Kaizen Coach Chat — recent-history sanitation
 *
 * Server-side session resolution + recent-history sanitation (plan: Kaizen
 * Master reference-pattern bullet). Cleans the client-supplied transcript before
 * it is fed to the provider:
 *   - drops empty / non-string content;
 *   - coerces unknown roles to 'user';
 *   - caps the transcript length (recency window);
 *   - caps per-message length to bound prompt size.
 */

import type { GenerateMessage, GenerateRole } from './providerAdapter';

export interface RawMessage {
  role?: string;
  content?: unknown;
}

const MAX_HISTORY_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 6000;

function normalizeRole(role: string | undefined): GenerateRole {
  switch (role) {
    case 'assistant':
      return 'assistant';
    case 'system':
      // System turns are owned by the server prompt builder; demote any
      // client-supplied "system" message to user text so it can't override
      // the persona/guardrails.
      return 'user';
    case 'tool':
      return 'tool';
    default:
      return 'user';
  }
}

/**
 * Sanitize a client transcript into provider-agnostic messages. Keeps only the
 * most recent MAX_HISTORY_MESSAGES, trims each message, and guarantees a
 * non-empty result is not required (caller validates "last turn is user").
 */
export function sanitizeHistory(raw: unknown): GenerateMessage[] {
  if (!Array.isArray(raw)) return [];

  const cleaned: GenerateMessage[] = [];
  for (const item of raw as RawMessage[]) {
    if (!item || typeof item !== 'object') continue;
    const content = typeof item.content === 'string' ? item.content.trim() : '';
    if (!content) continue;
    cleaned.push({
      role: normalizeRole(item.role),
      content: content.length > MAX_MESSAGE_CHARS ? content.slice(0, MAX_MESSAGE_CHARS) : content,
    });
  }

  // Recency window: keep the tail.
  return cleaned.slice(-MAX_HISTORY_MESSAGES);
}

/** The latest user message text, for memory relevance ranking. */
export function latestUserText(messages: GenerateMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user' && typeof m.content === 'string') return m.content;
  }
  return undefined;
}

/**
 * Resolve a stable session id. v1: trust the client id if present, else mint a
 * deterministic-ish id. (Post-v1: bind to a server-side session row.)
 */
export function resolveSessionId(clientSessionId: unknown): string {
  if (typeof clientSessionId === 'string' && clientSessionId.trim().length > 0) {
    return clientSessionId.trim();
  }
  return `coach-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
