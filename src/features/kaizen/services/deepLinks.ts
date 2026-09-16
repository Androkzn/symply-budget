/* eslint-disable @typescript-eslint/no-require-imports -- E2E helpers load lazily to avoid production startup dependencies. */
import { router } from 'expo-router';

import { appIntents, type KaizenAppIntent } from './appIntents';

/**
 * Maps `kaizen://…` / notification / Shortcuts-style URLs into Kaizen routes
 * and App Intent handlers. Native App Intents should call `handleKaizenDeepLink`
 * or `appIntents.handle` directly.
 */
export function handleKaizenDeepLink(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'kaizen:' && !parsed.hostname.includes('kaizen')) {
      // Also accept path-only forms like /kaizen/today
      if (!url.includes('kaizen')) return false;
    }

    const path = `${parsed.hostname}${parsed.pathname}`.replace(/^\/+/, '').replace(/^kaizen\/?/, '');
    const parts = path.split('/').filter(Boolean);
    const query = Object.fromEntries(parsed.searchParams.entries());

    switch (parts[0]) {
      case 'kaizen': {
        const sub = parts.slice(1).join('/');
        if (sub === 'question-import') {
          if (query.e2eText && __DEV__) {
            const { queueE2EQuestionImport } =

          require('@services/e2e-question-import') as typeof import('@services/e2e-question-import');
            queueE2EQuestionImport(query.e2eText);
            router.push({
              pathname: '/kaizen/question-import',
              params: { e2eText: query.e2eText },
            });
            return true;
          }
          router.push({
            pathname: '/kaizen/question-import',
            params: {
              ...(query.e2eText ? { e2eText: query.e2eText } : {}),
              ...(query.e2eSubmit ? { e2eSubmit: query.e2eSubmit } : {}),
            },
          });
          return true;
        }
        break;
      }
      case 'today':
      case undefined:
      case '':
        router.push('/');
        return true;
      case 'career':
        if (parts[1] === 'progress') router.push('/kaizen/career-progress');
        else if (parts[1] === 'import') router.push('/kaizen/question-import');
        else if (parts[1] === 'assessment') router.push('/kaizen-assess');
        else if (parts[1] === 'practice') router.push('/kaizen/practice');
        else if (parts[1] === 'dashboard') router.push('/kaizen/career-progress');
        else router.push('/kaizen-career');
        return true;
      case 'assess':
        router.push('/kaizen-assess');
        return true;
      case 'skill':
        if (parts[1]) router.push(`/kaizen/skill?skillId=${parts[1]}`);
        else router.push('/kaizen-assess');
        return true;
      case 'assessment':
        if (parts[1]) router.push(`/kaizen/skill-assessment?skillId=${parts[1]}`);
        else router.push('/kaizen-assess');
        return true;
      case 'import':
      case 'question-import':
        if (query.e2eText && __DEV__) {
          const { queueE2EQuestionImport } =

          require('@services/e2e-question-import') as typeof import('@services/e2e-question-import');
          queueE2EQuestionImport(query.e2eText);
          router.push({
            pathname: '/kaizen/question-import',
            params: { e2eText: query.e2eText },
          });
          return true;
        }
        if (query.e2eText || query.e2eSubmit) {
          router.push({
            pathname: '/kaizen/question-import',
            params: {
              ...(query.e2eText ? { e2eText: query.e2eText } : {}),
              ...(query.e2eSubmit ? { e2eSubmit: query.e2eSubmit } : {}),
            },
          });
        } else {
          router.push('/kaizen/question-import');
        }
        return true;
      case 'books':
        router.push('/kaizen/books');
        return true;
      case 'resume-review':
        router.push('/kaizen/resume-review');
        return true;
      case 'system-detail':
        router.push({
          pathname: '/kaizen/system-detail',
          params: { system: query.system ?? 'career' },
        });
        return true;
      case 'deep-work':
        router.push('/kaizen/deep-work');
        return true;
      case 'practice':
        router.push(
          query.questionId
            ? `/kaizen/practice?questionId=${query.questionId}`
            : '/kaizen/practice',
        );
        return true;
      case 'banks':
      case 'questions':
        router.push('/kaizen/banks');
        return true;
      case 'learn':
      case 'gtd':
        router.push('/kaizen-learn');
        return true;
      case 'reviews':
        router.push('/kaizen/reviews');
        return true;
      case 'coach':
        router.push('/mira');
        return true;
      case 'settings':
        router.push('/kaizen/settings');
        return true;
      case 'pipeline':
        router.push('/kaizen/pipeline');
        return true;
      case 'wake':
        void appIntents.handle({ type: 'confirm-wake' });
        router.push('/');
        return true;
      case 'log':
        if (query.actionId) {
          void appIntents.handle({ type: 'quick-log', actionId: query.actionId });
        }
        return true;
      case 'snooze':
        if (query.actionId) {
          void appIntents.handle({
            type: 'snooze',
            reminderId: query.actionId,
            durationMinutes: Number(query.minutes ?? 30),
          });
        }
        return true;
      case 'capture':
        if (query.text) {
          void appIntents.handle({ type: 'capture-gtd', text: query.text });
        }
        router.push('/kaizen-learn');
        return true;
      case 'e2e-pick': {
        const { tryQueueE2EDocumentPickFromUrl } =
          require('@services/e2e-document-pick') as typeof import('@services/e2e-document-pick');
        tryQueueE2EDocumentPickFromUrl(url);
        return true;
      }
      default:
        return false;
    }
  } catch {
    return false;
  }
  return false;
}

export function intentFromDeepLink(url: string): KaizenAppIntent | null {
  try {
    const parsed = new URL(url);
    const path = `${parsed.hostname}${parsed.pathname}`.replace(/^\/+/, '').replace(/^kaizen\/?/, '');
    const query = Object.fromEntries(parsed.searchParams.entries());
    if (path.startsWith('wake')) return { type: 'confirm-wake' };
    if (path.startsWith('log') && query.actionId) {
      return { type: 'quick-log', actionId: query.actionId };
    }
    if (path.startsWith('capture') && query.text) {
      return { type: 'capture-gtd', text: query.text };
    }
    return null;
  } catch {
    return null;
  }
}
