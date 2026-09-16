/**
 * AssistantUIBlock — renders generative UI payloads Aihousekeeper's tools emit.
 *
 * Tools return `{ ok: true, ui: {...} }`. The chat screen extracts the
 * `ui` field from `tool_results` and passes it here. Each block type has
 * its own compact renderer tuned for in-bubble display.
 *
 * To add a new block type:
 *   1. Add the variant to `src/types/aihousekeeperUiBlocks.ts` (and the backend
 *      mirror in `ui-blocks.ts`).
 *   2. Add a `case` to the switch in `AssistantUIBlock` below.
 *
 * Tap behavior:
 *   - Tapping a task card navigates to TaskDetail (via navigation ref so
 *     the cross-stack dispatch works from the Aihousekeeper tab).
 *   - Action-item cards are not tappable yet — no dedicated detail
 *     screen exists; tools can attach an `actions` row with a
 *     `send_message` action to re-ask Aihousekeeper for detail instead.
 *   - Tapping an action button dispatches the action: navigate screens,
 *     open a deep link, or post a follow-up message as the user.
 */
import { useRouter } from 'expo-router';
import { Linking, StyleSheet, View } from 'react-native';
// gesture-handler's Pressable plays well with Fabric + nested ScrollView (FlatList)
// — RN's RN-core Pressable/TouchableOpacity sometimes drops taps inside the chat
// list. The root has <GestureHandlerRootView> in App.tsx so this is safe.
import { TouchableOpacity } from 'react-native-gesture-handler';

import type {
  AssistantUIBlock as AssistantUIBlockType,
  UIAction,
  UIActionButton,
} from '@/types/aihousekeeperUiBlocks';
import { TaskCardItem } from '@components/tasks';
import { Typography } from '@components/ui';
import { navigateToBudget } from '@services/navigation';
import { useGardeningNavigationStore } from '@stores/gardeningNavigationStore';
import { useTaskStore } from '@stores/taskStore';
import {
  ButtonMetrics,
  Chat,
  CornerRadius,
  Shadow,
  Spacing,
  useAppColors,
} from '@theme';
import { toTaskCardModel } from '@utils/taskCardHelpers';

interface Props {
  block: AssistantUIBlockType;
  /** Called when an action of type `send_message` is triggered. */
  onSendMessage?: (text: string) => void;
}

/** Param value type accepted by `expo-router`'s `router.push(...)`. */
type RouteParamValue = string | number | (string | number)[] | null | undefined;
type RouterTarget = string | { pathname: string; params: Record<string, RouteParamValue> };

function navigateBudgetDeepLink(url: string) {
  const [, query] = url.split('?');
  const params = new URLSearchParams(query ?? '');
  const screen = params.get('screen') === 'BudgetSettings' ? 'BudgetSettings' : 'BudgetMain';
  const activeView = params.get('activeView');
  const subTab = params.get('subTab') ?? undefined;
  const extra =
    activeView === 'savings'
      ? {
          activeView: 'savings' as const,
          ...(subTab ? { subTab } : {}),
        }
      : subTab
        ? { subTab }
        : undefined;
  navigateToBudget(screen, extra);
}

/**
 * Map legacy React-Navigation screen names (the AI tool may still
 * emit these in `navigate` actions) to expo-router paths. Mirrors the
 * names declared in `src/navigation/RootNavigator.tsx` and the routes
 * in `app/`. Update both sides when adding a new top-level screen.
 *
 * Returns `null` when the name is unknown — caller should warn rather
 * than navigate to the wrong place.
 */
function screenNameToRoute(
  screen: string,
  params?: Record<string, unknown>
): RouterTarget | null {
  switch (screen) {
    case 'AihousekeeperApprovals':
      return '/aihousekeeper-approvals';
    case 'AihousekeeperChat':
    case 'MeetAihousekeeper':
      return '/aihousekeeper-chat';
    case 'AihousekeeperBriefings':
    case 'BriefingHistory':
      return '/aihousekeeper-briefings';
    case 'TrustLedger':
    case 'AihousekeeperTrustLedger':
      return '/aihousekeeper-trust-ledger';
    case 'AihousekeeperSettings':
      return '/aihousekeeper-settings';
    case 'Briefing': {
      const date = params && typeof params.date === 'string' ? params.date : null;
      return date ? `/briefing/${date}` : '/aihousekeeper-briefings';
    }
    case 'Home':
      return '/';
    case 'Tasks':
    case 'TasksMain':
      return '/tasks';
    case 'TaskDetail': {
      // TaskDetail lives inside the Tasks stack — the navigator's
      // NavigationHandler turns these URL params back into a
      // `navigation.navigate('TaskDetail', …)` call.
      const taskId = params && typeof params.taskId === 'string' ? params.taskId : null;
      return taskId
        ? { pathname: '/tasks', params: { screen: 'TaskDetail', taskId } }
        : '/tasks';
    }
    case 'TaskDrafts': {
      const reportId = params && typeof params.reportId === 'string' ? params.reportId : null;
      const reportName =
        params && typeof params.reportName === 'string' ? params.reportName : null;
      const p: Record<string, string> = { screen: 'TaskDrafts' };
      if (reportId) p.reportId = reportId;
      if (reportName) p.reportName = reportName;
      return { pathname: '/tasks', params: p };
    }
    case 'TaskDraftDetail': {
      const draftId =
        params && typeof params.draftId === 'string' ? params.draftId : null;
      return draftId
        ? { pathname: '/tasks', params: { screen: 'TaskDraftDetail', draftId } }
        : '/tasks';
    }
    case 'Reports':
    case 'ReportsMain':
      return '/reports';
    case 'ReportDetail': {
      const reportId =
        params && typeof params.reportId === 'string' ? params.reportId : null;
      const householdId =
        params && typeof params.householdId === 'string' ? params.householdId : null;
      return reportId && householdId
        ? {
            pathname: '/reports',
            params: { screen: 'ReportDetail', reportId, householdId },
          }
        : '/reports';
    }
    case 'Settings':
    case 'SettingsMain':
      return '/settings';
    case 'Notifications':
      return '/notifications';
    case 'Gardening':
      return '/gardening';
    case 'GardenPlanAddress': {
      const initialAddressLine1 =
        params && typeof params.initialAddressLine1 === 'string'
          ? params.initialAddressLine1
          : null;
      return initialAddressLine1
        ? {
            pathname: '/gardening',
            params: { screen: 'GardenPlanAddress', initialAddressLine1 },
          }
        : { pathname: '/gardening', params: { screen: 'GardenPlanAddress' } };
    }
    case 'GardenPlanBoundaryConfirm': {
      const draftId = params && typeof params.draftId === 'string' ? params.draftId : null;
      return draftId
        ? {
            pathname: '/gardening',
            params: { screen: 'GardenPlanBoundaryConfirm', draftId },
          }
        : '/gardening';
    }
    case 'Contractors':
      return '/contractors';
    default:
      return null;
  }
}

export function AssistantUIBlock({ block, onSendMessage }: Props) {
  const colors = useAppColors();
  const router = useRouter();

  const dispatchAction = (action: UIAction) => {
    if (action.type === 'navigate') {
      if (action.screen === 'GardenPlanBoundaryConfirm') {
        const draftId =
          action.params && typeof action.params.draftId === 'string'
            ? action.params.draftId
            : null;
        if (draftId) {
          useGardeningNavigationStore
            .getState()
            .setPendingNavigation({ screen: 'GardenPlanBoundaryConfirm', draftId });
        }
        router.push('/gardening');
        return;
      }
      if (action.screen === 'GardenPlanAddress') {
        const initialAddressLine1 =
          action.params && typeof action.params.initialAddressLine1 === 'string'
            ? action.params.initialAddressLine1
            : undefined;
        useGardeningNavigationStore.getState().setPendingNavigation({
          screen: 'GardenPlanAddress',
          initialAddressLine1,
        });
        router.push('/gardening');
        return;
      }
      // The AI tool emits legacy React-Navigation screen names. Map
      // each to its expo-router path (or {pathname, params} object for
      // nested-stack targets). Unknown names are logged rather than
      // navigated — better a missed deep-link than a wrong screen.
      const target = screenNameToRoute(action.screen, action.params);
      if (target === null) {
        console.warn(
          '[AssistantUIBlock] no expo-router mapping for screen:',
          action.screen,
          action.params
        );
        return;
      }
      router.push(target);
    } else if (action.type === 'deep_link') {
      if (action.url === '/budget' || action.url.startsWith('/budget?')) {
        navigateBudgetDeepLink(action.url);
        return;
      }
      if (action.url.startsWith('/')) {
        router.push(action.url);
      } else {
        void Linking.openURL(action.url);
      }
    } else if (action.type === 'send_message') {
      onSendMessage?.(action.text);
    }
  };

  const openTask = (taskId: string) => {
    // The app is mounted via expo-router (`package.json#main =
    // expo-router/entry`), so `navigationRef` from `@services/navigation`
    // is never attached and `navigateToTask()` silently no-ops. The
    // working cross-stack pattern (used by HomeScreen task cards) is to
    // park the taskId in `useTaskStore.pendingTaskNavigation`, then push
    // to `/tasks` — TasksScreen has a `useEffect` that picks up the
    // pending id and calls `navigation.navigate('TaskDetail', ...)` from
    // inside the React Navigation stack.
    if (__DEV__) {
      console.log('[AssistantUIBlock] openTask tapped, taskId=', taskId);
    }
    useTaskStore.getState().setPendingTaskNavigation(taskId);
    router.push('/tasks');
  };

  if (block.type === 'task_list') {
    if (block.tasks.length === 0) {
      return (
        <View
          style={[
            styles.empty,
            { backgroundColor: colors.cardSubtle },
          ]}
        >
          <Typography variant="caption1" color={colors.textSecondary}>
            No tasks here yet.
          </Typography>
          {block.actions && block.actions.length > 0 ? (
            <ActionButtons
              actions={block.actions}
              onPress={dispatchAction}
            />
          ) : null}
        </View>
      );
    }
    return (
      <View style={styles.container}>
        {block.title ? (
          <Typography
            variant="caption1"
            weight="semibold"
            color={colors.textSecondary}
            style={styles.listTitle}
          >
            {block.title}
            {typeof block.total === 'number' && block.total > block.tasks.length
              ? ` · ${block.tasks.length} of ${block.total}`
              : ''}
          </Typography>
        ) : null}
        {block.tasks.map((t) => (
          <TaskCardItem
            key={t.id}
            task={toTaskCardModel(t)}
            onPress={() => openTask(t.id)}
          />
        ))}
        {block.actions && block.actions.length > 0 ? (
          <ActionButtons actions={block.actions} onPress={dispatchAction} />
        ) : null}
      </View>
    );
  }

  if (block.type === 'task_card') {
    return (
      <View style={styles.container}>
        {block.caption ? (
          <Typography
            variant="caption1"
            weight="semibold"
            color={colors.textSecondary}
          >
            {block.caption}
          </Typography>
        ) : null}
        <TaskCardItem
          task={toTaskCardModel(block.task)}
          onPress={() => openTask(block.task.id)}
        />
        {block.actions && block.actions.length > 0 ? (
          <ActionButtons actions={block.actions} onPress={dispatchAction} />
        ) : null}
      </View>
    );
  }

  if (block.type === 'action_row') {
    return (
      <View style={styles.container}>
        <ActionButtons actions={block.actions} onPress={dispatchAction} />
      </View>
    );
  }

  // Unknown block type — tool protocol newer than this build. Degrade
  // silently rather than crash; the text reply still shows above.
  return null;
}

function ActionButtons({
  actions,
  onPress,
}: {
  actions: UIActionButton[];
  onPress: (action: UIAction) => void;
}) {
  const colors = useAppColors();
  return (
    <View style={styles.actionsRow}>
      {actions.map((btn, i) => {
        const isDestructive = btn.variant === 'destructive';
        const isPrimary = btn.variant === 'primary';
        // Map semantic variant → token. The backend never sends colors —
        // see UI_Rules_For_Chat_Generated_UI.md §17 (LLM payload contract).
        const bg = isDestructive
          ? colors.destructiveSubtle
          : isPrimary
          ? colors.primary
          : colors.cardBackground;
        const fg = isDestructive
          ? colors.error
          : isPrimary
          ? colors.black
          : colors.textPrimary;
        return (
          <TouchableOpacity
            key={`${btn.label}_${i}`}
            onPress={() => onPress(btn.action)}
            activeOpacity={ButtonMetrics.pressOpacityCard}
            hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
            accessibilityRole="button"
            accessibilityLabel={btn.label}
            style={[
              styles.actionBtn,
              {
                backgroundColor: bg,
                shadowColor: colors.black,
              },
            ]}
          >
            <Typography variant="footnote" weight="semibold" color={fg}>
              {btn.label}
            </Typography>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// Modern card design: no hairline border (looks dated), slight elevation
// + token shadows. Bigger icon tile (44pt) + bolder title (callout = 16pt).
// All numeric values come from `@theme` tokens — no raw literals.
const styles = StyleSheet.create({
  container: {
    marginTop: Spacing.sm,
    gap: Chat.compactGap,
  },
  listTitle: {
    marginBottom: Chat.metaSpacingTight,
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Chat.compactGap,
    marginTop: Spacing.sm,
  },
  actionBtn: {
    paddingVertical: Spacing.sm + Spacing.xxs, // 10pt
    paddingHorizontal: Spacing.base,
    borderRadius: CornerRadius.full, // pill
    minHeight: ButtonMetrics.minTapTarget,
    alignItems: 'center',
    justifyContent: 'center',
    // Soft elevation matches cards
    shadowOffset: { width: Shadow.light.offsetX, height: Shadow.light.offsetY },
    shadowOpacity: Shadow.light.opacityLight,
    shadowRadius: Shadow.light.radius,
    elevation: 1,
  },
  empty: {
    padding: Spacing.base,
    borderRadius: CornerRadius.lg,
    gap: Spacing.sm,
  },
});
