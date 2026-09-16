import fs from 'fs';
import path from 'path';

import {
  ACTIVITY_LABELS,
  getActivityLabel,
  humanizeActivityAction,
} from '@utils/homeProjectActivityLabel';

/** Both writers of `home_project_activity.action`, relative to this test. */
const WRITERS = [
  '../../features/house/local/localHomeProjectsApi.ts',
  '../../../backend/src/services/home-projects-service.ts',
];

/**
 * Action slugs all end in a past-tense verb (`selection_added`), which is what
 * separates them from the entity types (`selection`) sitting in the very next
 * argument. `home_project_*` is the notification namespace, not this one.
 */
const ACTION_RE =
  /'([a-z][a-z_]*_(?:added|updated|deleted|created|picked|unpicked|published|unpublished|changed|linked|generated|removed|resolved))'/g;

function recordedActions(): Set<string> {
  const found = new Set<string>();
  for (const rel of WRITERS) {
    const source = fs.readFileSync(path.join(__dirname, rel), 'utf8');
    for (const match of source.matchAll(ACTION_RE)) {
      if (!match[1].startsWith('home_project_')) found.add(match[1]);
    }
  }
  return found;
}

describe('getActivityLabel', () => {
  it('reads as a sentence, never as the raw slug', () => {
    expect(getActivityLabel('project_published')).toBe('Project published');
    expect(getActivityLabel('blocker_added')).toBe('Blocker added');
    expect(getActivityLabel('option_group_deleted')).toBe('Options removed');
  });

  it('falls back to a humanized slug for an action this client has no copy for', () => {
    // A newer Worker can ship an action an older client has never heard of; the
    // feed must not leak the underscore again when that happens.
    expect(getActivityLabel('milestone_reached')).toBe('Milestone reached');
    expect(humanizeActivityAction('a_b-c')).toBe('A b c');
  });

  it('never renders an empty row', () => {
    expect(getActivityLabel(null)).toBe('Activity');
    expect(getActivityLabel('')).toBe('Activity');
    expect(getActivityLabel('___')).toBe('Activity');
  });

  it('has copy for every action either writer records', () => {
    // The fallback is a safety net, not the intended copy: an action added to
    // the Worker or to the local API without a label here should fail loudly.
    const actions = recordedActions();
    expect(actions.size).toBeGreaterThan(0);
    const unlabelled = [...actions].filter(a => !(a in ACTIVITY_LABELS)).sort();
    expect(unlabelled).toEqual([]);
  });
});
