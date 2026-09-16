import type { AIAccessError } from '@/errors/AIAccessError';

type AIAccessDeniedListener = (error: AIAccessError) => void;

let listener: AIAccessDeniedListener | null = null;

/** UI layer registers navigation (or other UX) for AI entitlement denials. */
export function setAIAccessDeniedListener(next: AIAccessDeniedListener | null): void {
  listener = next;
}

/** Invoked by the API client when the server denies AI access. */
export function notifyAIAccessDenied(error: AIAccessError): void {
  listener?.(error);
}
