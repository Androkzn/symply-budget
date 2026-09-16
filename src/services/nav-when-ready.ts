import { InteractionManager } from 'react-native';

/**
 * Run `action` after interactions settle. If it returns false (navigator not
 * ready), retry a few times with a short delay — replaces fire-and-forget
 * setTimeout navigation hacks (MOB-6).
 */
export function runWhenNavigatorReady(
  action: () => boolean,
  options?: { maxAttempts?: number; retryDelayMs?: number }
): void {
  const maxAttempts = options?.maxAttempts ?? 8;
  const retryDelayMs = options?.retryDelayMs ?? 50;

  const attempt = (n: number) => {
    InteractionManager.runAfterInteractions(() => {
      if (action()) return;
      if (n + 1 >= maxAttempts) return;
      setTimeout(() => attempt(n + 1), retryDelayMs);
    });
  };

  attempt(0);
}

/** Fire-and-forget navigate after the current interaction/frame. */
export function navigateAfterInteractions(action: () => void): void {
  InteractionManager.runAfterInteractions(() => {
    action();
  });
}
