/**
 * Human copy for the project activity feed.
 *
 * `home_project_activity.action` is a machine slug (`blocker_added`) written by
 * BOTH writers — the Worker's `recordActivity` and the local-first
 * `activityRow` — and the hub used to print it verbatim, so the feed read as
 * `project_published` / `blocker_added`. The slug is the wire format and must
 * not change: it is persisted, ledgered to peers and asserted on in backend and
 * local tests. So the mapping lives here, on the read side only.
 *
 * `humanizeActivityAction` is the deliberate fallback: a slug added by a newer
 * Worker than this client still reads as a sentence rather than leaking the
 * underscore again, which is exactly how the raw copy got shipped.
 */
export const ACTIVITY_LABELS: Record<string, string> = {
  project_created: 'Project created',
  project_updated: 'Project updated',
  project_published: 'Project published',
  project_unpublished: 'Project moved back to draft',
  project_access_changed: 'Access changed',
  selection_added: 'Selection added',
  selection_updated: 'Selection updated',
  selection_deleted: 'Selection removed',
  option_group_added: 'Options added',
  option_group_updated: 'Options updated',
  option_group_deleted: 'Options removed',
  option_picked: 'Option picked',
  option_unpicked: 'Option unpicked',
  blocker_added: 'Blocker added',
  blocker_updated: 'Blocker updated',
  blocker_deleted: 'Blocker removed',
  comment_added: 'Comment added',
  attachment_added: 'Attachment added',
  surface_preview_generated: 'Preview generated',
  task_linked: 'Task linked',
};

/** `blocker_added` → `Blocker added`. Used only when the slug is unmapped. */
export function humanizeActivityAction(action: string): string {
  const words = action.replace(/[_-]+/g, ' ').trim();
  if (!words) return 'Activity';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function getActivityLabel(action: string | null | undefined): string {
  if (!action) return 'Activity';
  return ACTIVITY_LABELS[action] ?? humanizeActivityAction(action);
}
