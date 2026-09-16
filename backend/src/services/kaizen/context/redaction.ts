/**
 * Kaizen — redaction helpers
 *
 * Strips memories that must NOT reach the Kaizen Master prompt before context
 * assembly. This is the privacy gate from the plan:
 *
 *   "Redact or summarize sensitive raw content; do not send full journals /
 *    resumes / interview answers unless the current operation explicitly
 *    requires it and the user has acknowledged the disclosure."
 *
 * Rules (v1):
 *   - sensitivity === 'sensitive'  -> excluded from coachChat prompt unless the
 *     memory is explicitly opted in (use_in_ai_context = 1 AND approved).
 *   - use_in_ai_context === 0      -> excluded (user toggled it off).
 *   - is_approved === 0            -> excluded (proposed, not yet user-approved).
 *   - is_archived === 1            -> excluded.
 *   - deleted_at set               -> excluded.
 */

import type { MemoryRecord } from './memorySchema';

export interface RedactionOptions {
  /**
   * When true (assessment/importReview surfaces never set this), a `sensitive`
   * memory may pass *if* the user explicitly opted it in (use_in_ai_context=1).
   * Standard coachChat keeps this false unless the disclosure was acknowledged.
   */
  allowOptedInSensitive?: boolean;
}

export interface RedactionResult {
  /** Memories safe to render into the prompt. */
  allowed: MemoryRecord[];
  /** Count of records dropped, by reason — surfaced in the assembly trace. */
  droppedCounts: {
    unapproved: number;
    archivedOrDeleted: number;
    optedOut: number;
    sensitive: number;
  };
}

export function redactMemories(
  memories: MemoryRecord[],
  options: RedactionOptions = {}
): RedactionResult {
  const allowed: MemoryRecord[] = [];
  const droppedCounts = {
    unapproved: 0,
    archivedOrDeleted: 0,
    optedOut: 0,
    sensitive: 0,
  };

  for (const m of memories) {
    if (m.deleted_at || m.is_archived === 1) {
      droppedCounts.archivedOrDeleted++;
      continue;
    }
    // Only user-approved memory ever reaches the prompt.
    if (m.is_approved !== 1) {
      droppedCounts.unapproved++;
      continue;
    }
    if (m.use_in_ai_context !== 1) {
      droppedCounts.optedOut++;
      continue;
    }
    if (m.sensitivity === 'sensitive' && !options.allowOptedInSensitive) {
      droppedCounts.sensitive++;
      continue;
    }
    allowed.push(m);
  }

  return { allowed, droppedCounts };
}

/**
 * Best-effort scrub of obviously sensitive free text (emails, phone numbers,
 * long digit runs) before it lands in a prompt or trace. Used defensively on
 * any user-pasted snippet we echo back; deterministic and side-effect free.
 */
export function scrubFreeText(text: string): string {
  if (!text) return text;
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[redacted-email]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[redacted-number]');
}
