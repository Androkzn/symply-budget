/**
 * The three-tab partition on the Home Projects list.
 *
 * The tabs replaced a "Show archived" toggle, and the invariant they buy is that
 * every project is in exactly ONE of them: the counts on the tabs add up to the
 * whole list, so nothing can go missing between Active, Drafts and Archive. A
 * project that fell through every branch would simply never render, and no type
 * error or lint rule would say so — hence this suite.
 *
 * A draft is `visibility === 'draft'` on BOTH backends since migration 0163 —
 * the ledger row carries the column too. The partition used to accept
 * `status === 'idea'` as a second route into Drafts, because local-first rows
 * had no visibility to read; that stand-in is gone and its absence is asserted
 * below, because the two are different questions. `idea` is where the WORK is;
 * `draft` is who can SEE it, and a published idea sitting under a tab that
 * promises privacy is the one mistake this feature must not make.
 */
import type { HomeProject } from '@api/home-projects';

import { bucketOf, type ProjectTabId } from '../HomeProjectsListScreen';

function project(overrides: Partial<HomeProject> = {}): HomeProject {
  return {
    id: 'p1',
    household_id: 'h1',
    title: 'Upstairs bathroom',
    type: 'renovation',
    template_key: 'bathroom_reno',
    status: 'planning',
    summary: null,
    goals: null,
    constraints: null,
    target_budget_cents: null,
    currency: 'USD',
    contingency_pct: 15,
    target_start_at: null,
    target_end_at: null,
    cover_attachment_id: null,
    created_by: null,
    updated_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Every `home_projects.status` the hub can set (`patchProjectSchema`). */
const ALL_STATUSES = [
  'idea',
  'planning',
  'ready',
  'in_progress',
  'on_hold',
  'done',
  'archived',
] as const;

describe('the Home Projects tab partition', () => {
  it('puts work in flight under Active', () => {
    for (const status of ['planning', 'ready', 'in_progress', 'on_hold', 'done']) {
      expect(bucketOf(project({ status }))).toBe('active');
    }
  });

  it('treats a draft as a draft whatever its status says', () => {
    expect(bucketOf(project({ status: 'in_progress', visibility: 'draft' }))).toBe('drafts');
    expect(bucketOf(project({ status: 'idea', visibility: 'draft' }))).toBe('drafts');
  });

  it('leaves a published project out of Drafts', () => {
    expect(bucketOf(project({ status: 'planning', visibility: 'published' }))).toBe('active');
  });

  /**
   * The `status === 'idea'` stand-in, deliberately gone.
   *
   * A project at the idea stage that the household can see is not private, and
   * Drafts now promises exactly that — nobody else can see this. Filing a shared
   * idea there would tell its owner their plan is hidden when it is not, which
   * is the one direction this feature must never be wrong in.
   */
  it('keeps a PUBLISHED idea in Active, because a draft is about visibility', () => {
    expect(bucketOf(project({ status: 'idea', visibility: 'published' }))).toBe('active');
    // A row written before 0163 has no visibility at all, and reads as published.
    expect(bucketOf(project({ status: 'idea' }))).toBe('active');
  });

  /**
   * Archiving is this feature's "delete" — a status flip, never a row removal —
   * so it has to win over the draft test above, or an archived draft would sit
   * in Drafts forever with no way to reach it.
   */
  it('sends archived projects to Archive even when they are drafts', () => {
    expect(bucketOf(project({ status: 'archived' }))).toBe('archive');
    expect(bucketOf(project({ status: 'archived', visibility: 'draft' }))).toBe('archive');
  });

  it('files every known status in exactly one tab, and reaches all three', () => {
    // `status` alone can only reach two of the tabs now — Drafts is a visibility
    // question — so the sweep varies both, which is also the real product space.
    const seen = new Set<ProjectTabId>();
    for (const status of ALL_STATUSES) {
      for (const visibility of [undefined, 'published', 'draft'] as const) {
        seen.add(bucketOf(project({ status, visibility })));
      }
    }
    expect([...seen].sort()).toEqual(['active', 'archive', 'drafts']);
  });

  /**
   * A status the client has never heard of (a newer Worker, a hand-edited row)
   * must still land somewhere visible rather than vanishing from all three tabs.
   */
  it('shows an unknown status rather than hiding it', () => {
    expect(bucketOf(project({ status: 'permitting' }))).toBe('active');
  });
});
