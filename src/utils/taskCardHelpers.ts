import type { TaskSummary } from '@/types/aihousekeeperUiBlocks';
import type { Task, TaskPrioritySeverity } from '@api/tasks';
import type { TaskCategory } from '@components/home';
import type { StatusBadgeVariant } from '@components/ui';

/**
 * Map a backend system_category (46 values) to the card's visual TaskCategory
 * (8 color buckets). This drives only the tint/color of the leading icon and the
 * category chip — the card shows the REAL category name + icon via
 * `getSystemCategoryLabel` / `getSystemCategoryIcon`, so nothing is mislabeled.
 *
 * Every backend value is routed here; only genuinely non-home categories
 * (finance, errands, pets, …, other) fall through to the neutral 'general' tint.
 * Previously ~18 valid values (appliances, interior, errands, …) collapsed to
 * 'general', which is why every card looked like "General".
 */
export function mapSystemCategory(systemCategory?: string | null): TaskCategory {
  switch ((systemCategory ?? '').trim().toLowerCase()) {
    case 'hvac':
    case 'gas':
    case 'insulation':
      return 'hvac';
    case 'plumbing':
    case 'drainage':
    case 'septic':
    case 'pool_spa':
      return 'plumbing';
    case 'electrical':
    case 'solar':
    case 'smart_home':
    case 'phone_internet':
    case 'appliances':
      return 'electrical';
    case 'landscaping':
    case 'irrigation':
    case 'snow_removal':
      return 'garden';
    case 'safety':
    case 'security':
    case 'pest_control':
    case 'inspection':
      return 'safety';
    case 'cleaning':
      return 'cleaning';
    case 'roof':
    case 'foundation':
    case 'exterior':
    case 'interior':
    case 'siding':
    case 'gutters':
    case 'fencing':
    case 'deck_patio':
    case 'chimney':
    case 'structure':
    case 'painting':
    case 'windows_doors':
    case 'flooring':
    case 'garage_door':
    case 'garage':
    case 'attic':
    case 'basement':
      return 'exterior';
    default:
      return 'general';
  }
}

/** Right-side status badge (overdue / today / soon / complete) for a task. */
export function getStatusBadge(task: Task): { status?: StatusBadgeVariant; count?: number } {
  if (!task.is_active) return { status: 'complete' };
  if (!task.next_due_date) return {};

  const diffDays = Math.ceil(
    (new Date(task.next_due_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  );

  if (diffDays < 0) return { status: 'overdue', count: Math.abs(diffDays) };
  if (diffDays === 0) return { status: 'today' };
  if (diffDays <= 7) return { status: 'soon' };
  return {};
}

/**
 * Countdown label for a task card, plus an `urgent` flag. Tasks due in under a
 * day (or already overdue) are urgent — the card pulses them in red. Everything
 * else is a quiet day count. No due date → empty label so the card hides it.
 */
export function formatDueDate(task: Task): { label: string; urgent: boolean } {
  if (!task.next_due_date) return { label: '', urgent: false };

  const DAY = 1000 * 60 * 60 * 24;
  const ms = new Date(task.next_due_date).getTime() - Date.now();

  // Under a day out (or overdue) → urgent, pulsing red.
  if (ms < DAY) {
    if (ms < 0) {
      const overdue = Math.floor(Math.abs(ms) / DAY);
      return {
        label: overdue >= 1 ? `${overdue} day${overdue === 1 ? '' : 's'} overdue` : 'Overdue',
        urgent: true,
      };
    }
    return { label: 'Due today', urgent: true };
  }

  const days = Math.round(ms / DAY);
  return { label: `${days} day${days === 1 ? '' : 's'} left`, urgent: false };
}

/** Adapt a lightweight task summary (e.g. from Mira chat UI blocks) for TaskCardItem. */
export function toTaskCardModel(summary: TaskSummary): Task {
  return {
    id: summary.id,
    system_category: summary.system_category,
    title: summary.title,
    description: summary.description,
    frequency: summary.frequency as Task['frequency'],
    custom_interval_days: summary.custom_interval_days,
    next_due_date: summary.next_due_date,
    last_completed_at: null,
    assigned_to: summary.assigned_to,
    is_active: summary.is_active,
    source: 'manual',
    priority_severity: summary.priority_severity as TaskPrioritySeverity | undefined,
    // Summary payloads omit reminder/timestamp fields; supply inert defaults so
    // this satisfies the full Task shape used only for card rendering.
    reminder_enabled: false,
    reminder_days_before: 1,
    reminder_time: '09:00',
    reminder_repeat: false,
    created_at: '',
    updated_at: '',
  };
}
