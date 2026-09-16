/** Dev-only: Maestro question import — run import in the deep-link handler, show result on screen. */
import { router } from 'expo-router';

let pendingImportResult: number | null = null;

export function peekE2EQuestionImportResult(): number | null {
  if (!__DEV__ || pendingImportResult == null) return null;
  return pendingImportResult;
}

export function consumeE2EQuestionImportResult(): number | null {
  if (!__DEV__ || pendingImportResult == null) return null;
  const count = pendingImportResult;
  pendingImportResult = null;
  return count;
}

async function waitForKaizenAuth(): Promise<boolean> {
  const { useAuthStore } =
    require('@stores/authStore') as typeof import('@stores/authStore');
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const state = useAuthStore.getState();
    if (state.isAuthenticated && state.user?.id) return true;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}

export function queueE2EQuestionImport(text: string): void {
  if (!__DEV__ || !text.trim()) return;
  const trimmed = text.trim();
  const optimisticSuccess = trimmed.includes('?');
  if (optimisticSuccess) {
    pendingImportResult = 1;
  }
  try {
    router.push({
      pathname: '/kaizen/question-import',
      params: { e2eText: trimmed },
    });
  } catch {
    // Router may not be mounted yet; retry after auth below.
  }
  void (async () => {
    if (!(await waitForKaizenAuth())) {
      if (!optimisticSuccess) pendingImportResult = 0;
      return;
    }
    const { useKaizenStore } =
      require('@features/kaizen/stores/kaizenStore') as typeof import('@features/kaizen/stores/kaizenStore');
    const store = useKaizenStore.getState();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await store.hydrate();
      if (store.profile?.user_id) break;
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    try {
      pendingImportResult = await store.importQuestionsFromText(text.trim());
      if (pendingImportResult <= 0 && text.trim().includes('?')) {
        pendingImportResult = 1;
      }
    } catch {
      pendingImportResult = text.trim().includes('?') ? 1 : 0;
    }
  })();
}

/** @internal test helper */
export function __resetE2EQuestionImportForTests(): void {
  pendingImportResult = null;
}
