import { router } from 'expo-router';

import { useKaizenStore } from '../stores/kaizenStore';

import { buildCareerProgressSnapshot } from './careerAnalytics';
import { handleKaizenDeepLink } from './deepLinks';

export type CoachToolResult = {
  tool: string;
  result?: string;
  opened_route?: string;
  ok?: boolean;
  clientMustResolve?: boolean;
  data?: Record<string, unknown>;
};

/**
 * Resolves coach tools marked `clientMustResolve` using local Kaizen state —
 * same contract as Simple Health's client-side tool fulfillment.
 */
export async function resolveCoachToolResults(
  toolResults: CoachToolResult[] | undefined,
): Promise<CoachToolResult[]> {
  if (!toolResults?.length) return [];
  const store = useKaizenStore.getState();
  const resolved: CoachToolResult[] = [];

  for (const item of toolResults) {
    const data = (item.data ?? {}) as Record<string, unknown>;
    const needsResolve = item.clientMustResolve !== false && !item.opened_route;

    switch (item.tool) {
      case 'get_progress_snapshot':
      case 'explain_progress': {
        const period =
          data.period === 'today' || data.period === 'week' || data.period === 'month'
            ? data.period
            : 'week';
        const snapshot = buildCareerProgressSnapshot(
          store.questions,
          store.attempts,
          store.skills,
          period === 'month' ? 'month' : period === 'today' ? 'today' : 'week',
        );
        const summary = `${snapshot.repsCompleted} reps · ${snapshot.dueRepsCompleted}/${snapshot.dueRepsTotal} due done · avg ${snapshot.averageScore?.toFixed(1) ?? '—'}`;
        resolved.push({
          ...item,
          clientMustResolve: false,
          result: summary,
          data: { ...data, snapshot, summary },
        });
        break;
      }
      case 'recommend_next_rep': {
        const kind = data.kind === 'technical' || data.kind === 'behavioral' ? data.kind : null;
        const due = store.questions
          .filter(q => q.import_review_status === 'approved')
          .filter(q => q.due_at && new Date(q.due_at) <= new Date())
          .filter(q => (kind ? q.question_bank === kind : true))
          .sort((a, b) => String(a.due_at).localeCompare(String(b.due_at)));
        const next = due[0];
        const route = next
          ? `/kaizen/practice?questionId=${next.id}`
          : '/kaizen/banks';
        resolved.push({
          ...item,
          clientMustResolve: false,
          opened_route: route,
          result: next
            ? `Next due: ${next.prompt.slice(0, 80)}`
            : 'No due questions — open banks to practice.',
          data: {
            ...data,
            questionId: next?.id ?? null,
            questionBank: next?.question_bank ?? null,
            dueCount: due.length,
            reason: next ? 'Earliest due FSRS card' : 'Queue empty',
          },
        });
        break;
      }
      case 'start_assessment': {
        const skillId = typeof data.skillId === 'string' ? data.skillId : store.skills[0]?.id;
        const route = skillId
          ? `/kaizen/skill-assessment?skillId=${skillId}`
          : '/kaizen-assess';
        resolved.push({ ...item, clientMustResolve: false, opened_route: route, result: 'Open skill assessment' });
        break;
      }
      case 'import_questions':
        resolved.push({
          ...item,
          clientMustResolve: false,
          opened_route: '/kaizen/question-import',
          result: 'Open question import',
        });
        break;
      case 'start_practice_session': {
        const due = store.questions.find(
          q => q.import_review_status === 'approved' && q.due_at && new Date(q.due_at) <= new Date(),
        );
        resolved.push({
          ...item,
          clientMustResolve: false,
          opened_route: due
            ? `/kaizen/practice?questionId=${due.id}`
            : '/kaizen/practice',
          result: due ? `Practice: ${due.prompt.slice(0, 60)}` : 'Open practice',
          data: { ...data, estimatedCount: store.questions.filter(q => q.due_at && new Date(q.due_at) <= new Date()).length },
        });
        break;
      }
      case 'log_kaizen_action': {
        const actionId = typeof data.actionId === 'string' ? data.actionId : null;
        if (actionId) await store.completeDailyAction(actionId);
        resolved.push({
          ...item,
          clientMustResolve: false,
          opened_route: '/',
          result: actionId ? 'Logged daily action' : 'Missing actionId',
          data: { ...data, accepted: Boolean(actionId) },
        });
        break;
      }
      case 'open_route': {
        const route = typeof data.route === 'string' ? data.route : '';
        if (route.startsWith('kaizen://') || route.startsWith('/')) {
          if (route.startsWith('kaizen://')) handleKaizenDeepLink(route);
          else router.push(route as never);
        }
        resolved.push({
          ...item,
          clientMustResolve: false,
          opened_route: route.startsWith('/') ? route : undefined,
          result: `Opened ${route || 'route'}`,
        });
        break;
      }
      default:
        if (needsResolve && typeof data.route === 'string') {
          const route = data.route;
          if (route.startsWith('kaizen://')) handleKaizenDeepLink(route);
          resolved.push({ ...item, clientMustResolve: false, opened_route: route.startsWith('/') ? route : item.opened_route });
        } else {
          resolved.push(item);
        }
    }
  }

  return resolved;
}

export function openCoachToolRoute(result: CoachToolResult): void {
  if (result.opened_route) {
    if (result.opened_route.startsWith('kaizen://')) handleKaizenDeepLink(result.opened_route);
    else router.push(result.opened_route as never);
  }
}
