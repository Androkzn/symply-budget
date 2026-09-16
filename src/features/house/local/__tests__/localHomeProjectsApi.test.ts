/**
 * `localHomeProjectsApi` against a real in-memory session (plan §6 DoD, H11
 * sub-wave C4 — the last one).
 *
 * Eight behaviours are load-bearing beyond the round trips:
 *
 *  - **TWO of the six windows would have been inert**, and neither the registry
 *    nor `waveBCSchemaParity` could see it. `HomeProjectBlocker` and
 *    `HomeProjectAttachment` do not declare the `created_at` their tables window
 *    on; `rowBucket` reads `row['created_at']` and falls through to
 *    always-resident on `undefined`, so both would have looked configured and
 *    done nothing. C3 met this once (§11.1.4b); C4 met it twice. Proved here at
 *    runtime, and by `tsc` on the typed seeders below.
 *  - **The cascade obligation is nil, and that is a FINDING rather than an
 *    omission.** `home_projects` is cascaded from by thirteen tables — the most
 *    in the registry — and nothing deletes a home project on either backend.
 *    Both halves of §11.1.1's audit are asserted against the sources, so the day
 *    a delete is added the second half fails loudly.
 *  - **`getHub` computes the budget**, so leaving it remote would answer
 *    `estimate_total: 0` with a 200 over a fully specified renovation. Every
 *    branch of `computeRollups` is exercised, including the two `||`-vs-`??`
 *    quirks that decide what a new project shows.
 *  - **`create` writes up to fifteen rows across five tables in ONE op**, and a
 *    peer applies all of them or none.
 *  - **The hub orders three children on a `sort_order` the DTO does not carry**,
 *    which is C3's `garden_plan_objects` divergence arriving twice more.
 *  - **A version conflict is axios-shaped**, because `isHomeProjectConflict` —
 *    an existing client helper the hub screen already branches on — tests
 *    `axios.isAxiosError`.
 *  - **A priced selection mints its budget line in the SAME op**, so the
 *    estimate can never be short by exactly one vanity.
 *  - **Thirteen gaps are throws, not silence**, in five groups — and two of
 *    those groups (a Tier-D write and an S2 join) are shapes no earlier
 *    sub-wave produced.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import { isHomeProjectConflict } from '@api/home-projects';

// The photo path crosses two native boundaries — the image manipulator and the
// H6 blob channel. Both are exercised by their own suites
// (`houseBlobStore.test.ts`); what matters here is the LEDGER consequence, so
// they are stubbed to their contracts and the assertions are all about the row.
const mockUploadHouseBlob = jest.fn();
const mockNormalize = jest.fn();

jest.mock('../blobs', () => ({
  ...jest.requireActual('../blobs'),
  uploadHouseBlob: (...args: unknown[]) => mockUploadHouseBlob(...args),
}));

jest.mock('@utils/attachmentImage', () => ({
  ...jest.requireActual('@utils/attachmentImage'),
  normalizeAttachmentImage: (...args: unknown[]) => mockNormalize(...args),
}));

import type { HouseByokPort, HouseByokRequest } from '../ai/houseByokClient';
import {
  getLocalHouseLedger,
  openLocalHouseSession,
  resetLocalHouseSession,
} from '../engine';
import {
  HouseLocalUnknownPropertyError,
  HouseLocalUnsupportedError,
} from '../errors';
import {
  HOME_PROJECT_CHILD_TABLES,
  HouseLocalHomeProjectConflictError,
  localHomeProjectsApi,
} from '../localHomeProjectsApi';
// The other half of the linked-task pair: `createTask` mints a real household
// task through this facade, exactly as `createTaskFromProject` goes through
// `TaskService`. Asserting against it is what proves the job is reachable from
// the home screen and not a project-only invention.
import { localTasksApi } from '../localTasksApi';
import {
  computeBudgetRollups,
  HOME_PROJECT_TEMPLATE_SEEDS,
} from '../logic/homeProjects';
import {
  ALWAYS_RESIDENT_BUCKET,
  applyLedgerDelta,
  captureLedgerSnapshot,
  diffLedger,
  rowBucket,
} from '../projection';
import {
  HOUSE_LEDGER_PHYSICAL_TABLES,
  HOUSE_LEDGER_TABLE_NAMES,
} from '../schema';
import type {
  LocalHomeProjectActivity,
  LocalHomeProjectAttachment,
  LocalHomeProjectBlocker,
  LocalHomeProjectMilestone,
} from '../types';

import {
  emptyHouseLedger,
  stampAt,
  TEST_HOUSEHOLD_ID,
} from './houseLedgerTestKit';

const USER = 'user-home-projects-1';
const DB_DIR = join(__dirname, '../../../../../backend/src/db');

let householdId: string;

function opCount(): number {
  return getLocalHouseLedger().ops.length;
}

/**
 * A milestone as `POST /:projectId/milestones` would have written one.
 *
 * Nothing local mints one — `homeProjectsApi` has no create-milestone method
 * even though the route does — so every test seeds directly, which is also how a
 * household that used Symply before going local-first arrives.
 *
 * The literal is TYPED, which is half of the window guard: `due_on` and
 * `created_at` are the two fields `HOUSE_WINDOWED_DATE_FIELDS` names for this
 * table, and removing either from `LocalHomeProjectMilestone` makes `tsc` reject
 * this object rather than letting the window quietly stop working. That matters
 * more here than anywhere, because this row type was written from the D1 columns
 * rather than inherited from a DTO.
 */
function seedMilestone(
  id: string,
  projectId: string,
  overrides: Partial<LocalHomeProjectMilestone> = {},
): LocalHomeProjectMilestone {
  const milestone: LocalHomeProjectMilestone = {
    id,
    household_id: householdId,
    project_id: projectId,
    phase_id: null,
    title: 'Tiles down',
    due_on: '2026-09-15',
    done_at: null,
    created_at: '2026-08-01T09:00:00.000Z',
    ...overrides,
  };
  getLocalHouseLedger().homeProjectMilestones.push(milestone);
  return milestone;
}

/**
 * An attachment as the upload flow would have written one.
 *
 * Typed for the same reason: `created_at` is NOT on `HomeProjectAttachment`, and
 * the registry windows this table on it. If the field leaves
 * `LocalHomeProjectAttachment` this literal stops compiling — which is the only
 * thing standing between the window and inertness, because the D1 column is a
 * perfectly good `text` and `waveBCSchemaParity` is happy either way.
 */
function seedAttachment(
  id: string,
  projectId: string,
  overrides: Partial<LocalHomeProjectAttachment> = {},
): LocalHomeProjectAttachment {
  const attachment: LocalHomeProjectAttachment = {
    id,
    household_id: householdId,
    project_id: projectId,
    selection_id: null,
    kind: 'photo',
    filename: 'before.jpg',
    content_type: 'image/jpeg',
    status: 'ready',
    tags: null,
    created_at: '2026-08-01T09:00:00.000Z',
    ...overrides,
  };
  getLocalHouseLedger().homeProjectAttachments.push(attachment);
  return attachment;
}

/** The other rescued window. Typed for the identical reason. */
function seedBlocker(
  id: string,
  projectId: string,
  overrides: Partial<LocalHomeProjectBlocker> = {},
): LocalHomeProjectBlocker {
  const blocker: LocalHomeProjectBlocker = {
    id,
    household_id: householdId,
    project_id: projectId,
    title: 'Permit',
    severity: 'high',
    status: 'open',
    notes: null,
    sort_order: 0,
    created_at: '2026-08-01T09:00:00.000Z',
    ...overrides,
  };
  getLocalHouseLedger().homeProjectBlockers.push(blocker);
  return blocker;
}

async function createBlankProject(title = 'Ensuite'): Promise<string> {
  const { project } = await localHomeProjectsApi.create(householdId, {
    title,
    templateKey: 'blank',
  });
  return project.id;
}

beforeEach(async () => {
  await resetLocalHouseSession();
  const ledger = await openLocalHouseSession({
    userId: USER,
    displayName: 'Home projects test home',
  });
  householdId = ledger.household.id;
});

afterEach(async () => {
  await resetLocalHouseSession();
});

// ---------------------------------------------------------------------------
// The cascade audit, both halves
// ---------------------------------------------------------------------------

describe('home projects — the cascade that cannot fire, proved rather than assumed', () => {
  /**
   * §11.1.1's FK half. The list is derived from the Drizzle sources rather than
   * hand-written for the reason B2 paid for: `localContractorsApi.delete`
   * shipped cascading three tables, four more went live underneath it, and every
   * contractor deletion stranded four kinds of orphan without anything failing.
   */
  it('names exactly the ledgered tables D1 cascades — checked against the schema', () => {
    const sources = readdirSync(DB_DIR)
      .filter(f => f.startsWith('schema') && f.endsWith('.ts'))
      .map(f => readFileSync(join(DB_DIR, f), 'utf8'))
      .join('\n');

    const blocks = sources
      .split(/export const \w+ = sqliteTable\(\s*'/)
      .slice(1);
    const cascading = new Set<string>();
    for (const block of blocks) {
      const physical = block.slice(0, block.indexOf("'"));
      if (
        /references\(\(\)\s*=>\s*homeProjects\.id,\s*\{\s*onDelete:\s*'cascade'/.test(
          block,
        )
      ) {
        cascading.add(physical);
      }
    }

    // Non-vacuity, and the headline number: FIFTEEN tables declare this foreign
    // key, more than any other row in the registry. Thirteen until migration
    // 0162 added `home_project_option_groups`, sixteen once 0166 added Smart
    // Project's `home_project_as_is` and `home_project_smart_drafts` — those two
    // cascade in D1 like every other child, but they are Tier B and never reach
    // the ledger, so they raise this count without joining
    // `HOME_PROJECT_CHILD_TABLES` below — and fifteen again from 0170, which
    // dropped `home_project_tasks` in favour of a column on the parent.
    expect(cascading.size).toBe(15);
    expect(cascading.has('home_project_geometry')).toBe(true);
    expect(cascading.has('home_project_option_groups')).toBe(true);
    // The one this count went DOWN for. A column on the parent cascades from
    // nothing, which is the whole reason the ledger can hold the link now.
    expect(cascading.has('home_project_tasks')).toBe(false);

    const live = HOUSE_LEDGER_TABLE_NAMES.filter(t =>
      cascading.has(HOUSE_LEDGER_PHYSICAL_TABLES[t]),
    );
    expect([...HOME_PROJECT_CHILD_TABLES].sort()).toEqual([...live].sort());
    // Eleven of the FIFTEEN are ledgered as of the H13 D-wave, which took
    // `home_project_geometry` out of Tier D, plus the 0162 option groups. The
    // remaining four are the two S2 joins that are left and Smart Project's two
    // Tier B tables — excluded on two different grounds, neither of which a
    // re-tier discharges.
    //
    // This equality is now load-bearing rather than descriptive: `remove` walks
    // `HOME_PROJECT_CHILD_TABLES` to clear a deleted project's children, so a
    // cascading table missing from that list would survive its parent on device
    // as an unreachable row. Deriving the list from the schema is what stops
    // that being possible.
    expect(HOME_PROJECT_CHILD_TABLES).toHaveLength(11);
  });

  /**
   * §11.1.1's local-tombstone half, which the section was corrected to say is
   * the half that matters. It asks a different question — "if a member deletes
   * this row on device, is any child left unreachable?" — and here it is answered
   * by the absence of a delete rather than by a cascade.
   */
  it('names every delete it exposes, and what each one strands', () => {
    // The facade half. Every method name is checked rather than a hand-picked
    // few, because "there is no delete" is only true while it stays true.
    const deleters = Object.keys(localHomeProjectsApi).filter(name =>
      /delete|remove|destroy|archive/i.test(name),
    );
    // Eight matches now: the seven real deletes, plus `deleteAsIs` — the only
    // one of Smart Project's seven throws (0166) whose NAME matches, and which
    // deletes nothing anywhere because that whole surface is Tier B and never
    // reaches this ledger. Each real one discharges the orphan obligation
    // differently:
    //
    //  - `archive` is a STATUS FLIP — `archiveProject` is literally
    //    `updateProject({ status: 'archived' })`, so the row survives and every
    //    child stays reachable through it.
    //  - `remove` is a real project delete, and it clears every child by walking
    //    `HOME_PROJECT_CHILD_TABLES` — which the test above proves is exactly the
    //    set of cascading tables, derived from the schema rather than listed by
    //    hand.
    //  - `deleteOptionGroup` deletes a GROUP, never a project, and deliberately
    //    un-parents its options instead of deleting them: "we are not deciding
    //    this surface here" must not throw away five researched materials. So it
    //    creates no orphan — it creates loose selections, which is the state
    //    every pre-0162 selection is already in.
    //  - `deleteBudgetLine` is a LEAF. Nothing in the registry cascades from
    //    `home_project_budget_lines`, and its `selection_id` is a plain `text`
    //    with no `references()` on either backend, so removing a line strands
    //    nothing — the selection it was derived from survives it, exactly as it
    //    does on the Worker.
    //  - `deleteSelection` is a leaf too, and the one with real side-effects.
    //    Nothing cascades from `home_project_selections` either, but TWO plain
    //    `text` pointers aim at it — `option_groups.preferred_selection_id` and
    //    `budget_lines.selection_id` — so the facade reproduces the Worker's
    //    cleanup by hand: a deleted WINNER returns its group to undecided and
    //    takes its budget line with it, in the same op. A deleted loose
    //    selection leaves its derived line exactly where the Worker leaves it.
    //  - `deletePhase` is a leaf with ONE loose pointer at it:
    //    `home_project_milestones.phase_id`, plain `text` with no
    //    `references()` on either backend. It is left dangling rather than
    //    cleaned up, which is the Worker's behaviour and is unobservable today
    //    because nothing reads `phase_id` — there is no milestone surface.
    //  - `deleteBlocker` is a pure leaf: nothing points at a blocker at all.
    expect(deleters.sort()).toEqual([
      'archive',
      'deleteAsIs',
      'deleteBlocker',
      'deleteBudgetLine',
      'deleteOptionGroup',
      'deletePhase',
      'deleteSelection',
      'remove',
    ]);

    // The server half, read out of the sources.
    //
    // This used to assert a literal two-name list, on the premise that the
    // service had no project delete at all. That premise no longer holds, so the
    // assertion now states the obligation the list was standing in for: **if the
    // service deletes a project, it must delete every ledgered child too.** A
    // literal list could only ever go stale; this cannot, because both sides are
    // derived — the children from the schema's cascade declarations, the deletes
    // from the service source.
    const service = readFileSync(
      join(
        __dirname,
        '../../../../../backend/src/services/home-projects-service.ts',
      ),
      'utf8',
    );
    const deleted = new Set(
      [...service.matchAll(/\.delete\((\w+)\)/g)].map(m => m[1]!),
    );

    if (deleted.has('homeProjects')) {
      const missed = [...HOME_PROJECT_CHILD_TABLES].filter(
        table => !deleted.has(table),
      );
      expect(missed).toEqual([]);
    } else {
      // No project delete: the cascade cannot fire, so no child can be orphaned
      // however many leaf deletes exist.
      expect(deleted.has('homeProjects')).toBe(false);
    }

    // Whatever else it deletes, a GROUP delete must not take its options with
    // it — that is the "we are not deciding this here" case, and the options are
    // research the member asked to keep.
    expect(service).toContain('.delete(homeProjectOptionGroups)');

    const routes = readFileSync(
      join(__dirname, '../../../../../backend/src/routes/home-projects.ts'),
      'utf8',
    );
    const deleteRoutes = [
      ...routes.matchAll(/homeProjects\.delete\('([^']+)'/g),
    ].map(m => m[1]!);
    expect(deleteRoutes.sort()).toEqual([
      // The project delete. Guarded above: its service method must clear every
      // ledgered child, so the route existing does not create orphans.
      '/:projectId',
      // Smart Project's as-is row (0166). A leaf, and Tier B: nothing cascades
      // from `home_project_as_is`, and it never reaches this ledger at all, so
      // deleting one on the Worker cannot strand a local row.
      '/:projectId/as-is/:asIsId',
      // A pure leaf — nothing anywhere points at a blocker.
      '/:projectId/blockers/:blockerId',
      '/:projectId/budget-lines/:lineId',
      // Deletes the surface, not the materials researched for it (0162).
      '/:projectId/option-groups/:groupId',
      // A leaf with one loose pointer at it: `home_project_milestones.phase_id`
      // is plain `text` with no `references()`, so a milestone that named this
      // phase is left naming an id that no longer resolves. Deliberate, and
      // unobservable — nothing reads `phase_id`, on either backend.
      '/:projectId/phases/:phaseId',
      '/:projectId/selections/:selectionId',
    ]);
  });

  it('archives without removing a single child row', () => {
    // The behavioural half of the same claim: the thirteen-way cascade has
    // nothing to do because the parent never leaves the ledger.
    const run = async () => {
      const projectId = await createBlankProject();
      seedMilestone('hpms_1', projectId);
      seedBlocker('hpblk_1', projectId);
      seedAttachment('hpatt_1', projectId);
      await localHomeProjectsApi.addComment(householdId, projectId, {
        body: 'Booked',
      });
      // Creation seeds no budget lines any more, so the line this claim needs is
      // one a member would have made: pricing a selection mints one.
      await localHomeProjectsApi.createSelection(householdId, projectId, {
        name: 'Vanity',
        unitPriceCents: 80_000,
      });

      const { project } = await localHomeProjectsApi.archive(
        householdId,
        projectId,
      );
      expect(project.status).toBe('archived');

      const ledger = getLocalHouseLedger();
      expect(ledger.homeProjects).toHaveLength(1);
      expect(ledger.homeProjectMilestones).toHaveLength(1);
      expect(ledger.homeProjectBlockers).toHaveLength(1);
      expect(ledger.homeProjectAttachments).toHaveLength(1);
      expect(ledger.homeProjectComments).toHaveLength(1);
      expect(ledger.homeProjectBudgetLines.length).toBeGreaterThan(0);
    };
    return run();
  });
});

// ---------------------------------------------------------------------------
// The window guard — §11.1.4b, met twice
// ---------------------------------------------------------------------------

/**
 * The form `waveBCSchemaParity` cannot see.
 *
 * That suite checks the window names a `text` column in D1, and `created_at`
 * genuinely is one on both tables. What it cannot check is whether the ROW
 * carries the field — and neither `HomeProjectBlocker` nor
 * `HomeProjectAttachment` declares it, so before C4 added it to the row types
 * both windows would have read `undefined`, yielded no `YYYY-MM` and bucketed
 * every row always-resident while looking perfectly configured.
 *
 * Both halves are proved: `tsc` rejects the typed seeders above if the field
 * leaves a row type, and the assertions below fail at runtime if a registry
 * entry leaves `HOUSE_WINDOWED_DATE_FIELDS`.
 */
describe('the six home-project windows actually bucket', () => {
  it('buckets a blocker and an attachment by the month they were written', () => {
    const row = {
      id: 'x',
      created_at: '2026-03-14T09:00:00.000Z',
    } as unknown as Record<string, unknown>;
    expect(rowBucket('homeProjectBlockers', row)).toBe('2026-03');
    expect(rowBucket('homeProjectAttachments', row)).toBe('2026-03');
    // Non-vacuity: the same row through a table with no window falls to
    // always-resident, which is exactly what a dead window would have produced.
    expect(rowBucket('homeProjectBudgetLines', row)).toBe(
      ALWAYS_RESIDENT_BUCKET,
    );
  });

  it('buckets a project by its start date and a milestone by its due date', () => {
    const project = {
      id: 'p',
      target_start_at: '2026-05-02',
      created_at: '2026-01-09T09:00:00.000Z',
    } as unknown as Record<string, unknown>;
    // The lead field wins over `created_at`, which is what makes the ORDER a
    // decision rather than decoration.
    expect(rowBucket('homeProjects', project)).toBe('2026-05');
    // …and the fallback is reached when it is null, which is the ordinary case
    // for a project captured long before it is scheduled.
    const unscheduled = { ...project, target_start_at: null };
    expect(rowBucket('homeProjects', unscheduled)).toBe('2026-01');

    const milestone = {
      id: 'm',
      due_on: '2026-09-15',
      created_at: '2026-08-01T09:00:00.000Z',
    };
    expect(
      rowBucket(
        'homeProjectMilestones',
        milestone as unknown as Record<string, unknown>,
      ),
    ).toBe('2026-09');
  });

  it('keeps the four project-definition tables always-resident', () => {
    // A dated row through each: if a window were added to any of them, this is
    // what would notice. `getHub` reads all four on the first render, so a row in
    // a colder bucket is an estimate that is silently short by a line.
    const row = {
      id: 'x',
      created_at: '2026-03-14T09:00:00.000Z',
    } as unknown as Record<string, unknown>;
    for (const table of [
      'homeProjectBudgetLines',
      'homeProjectSelections',
      'homeProjectPhases',
      'homeProjectPlanLinks',
    ] as const) {
      expect(rowBucket(table, row)).toBe(ALWAYS_RESIDENT_BUCKET);
    }
  });
});

// ---------------------------------------------------------------------------
// The catalogue and the create path
// ---------------------------------------------------------------------------

describe('templates and creation', () => {
  it('lists the whole ported catalogue in the Worker’s order', async () => {
    const { templates } = await localHomeProjectsApi.listTemplates(householdId);
    // Order is the wizard's tile order, and it is the RECORD's insertion order on
    // both backends — a household that switched would otherwise see the grid
    // rearrange itself under them.
    expect(templates.map(t => t.key)).toEqual([
      'bathroom_reno',
      'kitchen_reno',
      'basement_finish',
      'expand_space',
      'paint_refresh',
      'flooring_replace',
      'furniture_replace',
      'appliance_replace',
      'plumbing_replace',
      'electrical_upgrade',
      'hvac_replace',
      'roof_replace',
      'window_door_replace',
      'replace_fixture',
      'outdoor_refresh',
      'blank',
    ]);
    // Three fields is the whole DTO — the cost hint both backends used to carry is
    // gone (`listTemplates` in `home-projects-service.ts` says why), so there is
    // nothing here for a screen to render as an estimate.
    for (const template of templates) {
      expect(Object.keys(template).sort()).toEqual(['key', 'title', 'type']);
    }
  });

  /**
   * The catalogue is COMPILED IN on both backends rather than read from D1, so
   * nothing at runtime can notice the two drifting apart — a template added to the
   * Worker and not here creates a project with no phases on a local-first
   * household, and the member sees an empty hub with no error anywhere.
   *
   * This asserts the shape a seeded project depends on. The values themselves are
   * checked against the Worker's copy by its own suite
   * (`backend/src/services/home-projects/__tests__/templates.test.ts`), which runs
   * the same three assertions — this file cannot import across the two roots.
   */
  it('seeds no money, no contingency line, and dense sort orders', () => {
    // Collected rather than asserted per template so one run names EVERY offender
    // — jest's `expect` carries no message argument to name it with.
    const problems: string[] = [];
    const dense = (orders: number[]) => orders.every((order, i) => order === i);

    for (const [key, template] of Object.entries(HOME_PROJECT_TEMPLATE_SEEDS)) {
      if (template.key !== key) {
        problems.push(`${key} is filed under key "${template.key}"`);
      }
      for (const line of template.budgetLines) {
        // A seeded amount is a national average invented without this
        // household's city, contractor or scope, and it lands in the hub's
        // Estimate the moment the project exists.
        if ('estimateCents' in line) {
          problems.push(`${key} budget seed "${line.label}" carries money`);
        }
        // And a contingency LINE — even at zero — would peg the buffer for the
        // life of the project, because the rollup prefers a line to the rate.
        if (line.category === 'contingency') {
          problems.push(`${key} seeds a contingency line`);
        }
      }
      // And no RATE either. A per-template buffer is a smaller lie than a seeded
      // dollar figure but it compounds every real one the member types, so a
      // project priced at $5,000 announces $5,750 with no visible source.
      if (template.contingencyPct !== 0) {
        problems.push(
          `${key} seeds a contingency rate: ${template.contingencyPct}`,
        );
      }
      if (!dense(template.phases.map(phase => phase.sortOrder))) {
        problems.push(`${key} phase sort orders are not 0..n`);
      }
      // A template seeds a project's shape, never a shortlist of things to
      // buy — see the backend's `seeds no materials`. The two sets of seeds
      // are mirrors, so a shortlist reappearing on either side is a divergence.
      if ('selections' in template) {
        problems.push(`${key} seeds materials`);
      }
    }

    expect(problems).toEqual([]);
  });

  it('seeds a template’s phases, blockers and budget lines in ONE op', async () => {
    const before = opCount();
    const { project } = await localHomeProjectsApi.create(householdId, {
      templateKey: 'bathroom_reno',
    });
    // Nine rows across four tables, and a peer applies all of them or none.
    expect(opCount() - before).toBe(1);

    const hub = await localHomeProjectsApi.getHub(householdId, project.id);
    expect(hub.phases.map(p => p.title)).toEqual([
      'Demo',
      'Rough-in',
      'Surfaces',
      'Fixtures',
      'Finish',
    ]);
    // A template seeds the project's SHAPE, never a shortlist of things to
    // buy — the materials list starts empty and fills with what the member
    // actually chooses.
    expect(hub.selections).toHaveLength(0);
    expect(hub.blockers).toHaveLength(1);
    // Three rows to price — Materials, Labor, Permits — and no contingency line:
    // seeding one would peg the buffer at zero for the life of the project.
    expect(hub.budget_lines).toHaveLength(3);
    expect(hub.budget_lines.every(line => line.estimate_cents === 0)).toBe(
      true,
    );
    // The title and type come from the template when the caller sends neither.
    expect(project.title).toBe('Bathroom renovation');
    expect(project.type).toBe('renovation');
    expect(project.template_key).toBe('bathroom_reno');
    // No buffer either — contingency is opt-in and the member sets it themselves.
    expect(project.contingency_pct).toBe(0);
    // The activity trail starts here.
    expect(
      getLocalHouseLedger().homeProjectActivity.map(a => a.action),
    ).toEqual(['project_created']);
    expect(
      JSON.parse(getLocalHouseLedger().homeProjectActivity[0]!.meta_json!),
    ).toEqual({
      templateKey: 'bathroom_reno',
    });
  });

  it('gives a template-less project no budget lines at all', async () => {
    // It used to get a `contingency` line seeded at zero, and that row was the
    // bug rather than the feature: `computeBudgetRollups` prefers an explicit
    // contingency LINE to the percentage (`??`, and zero is a value), so the
    // buffer stayed pegged at zero however much the member went on to price.
    const { project } = await localHomeProjectsApi.create(householdId, {
      title: 'Deck',
    });
    const hub = await localHomeProjectsApi.getHub(householdId, project.id);
    expect(hub.budget_lines).toEqual([]);
    expect(hub.rollups.estimate_total).toBe(0);
    expect(hub.rollups.contingency_cents).toBe(0);
    expect(project.template_key).toBeNull();
    expect(project.title).toBe('Deck');

    // A priced project costs what was priced and not a cent more: the default
    // rate is 0, so nothing is added on top of the member's own figure.
    await localHomeProjectsApi.createSelection(householdId, project.id, {
      name: 'Decking',
      unitPriceCents: 200_000,
    });
    const priced = await localHomeProjectsApi.getHub(householdId, project.id);
    expect(priced.rollups.contingency_cents).toBe(0);
    expect(priced.rollups.estimate_total).toBe(200_000);

    // …and the rate is the member's to turn on. Set it and the buffer appears,
    // computed live off what they have actually priced.
    await localHomeProjectsApi.update(householdId, project.id, {
      contingencyPct: 15,
    });
    const buffered = await localHomeProjectsApi.getHub(householdId, project.id);
    expect(buffered.rollups.contingency_cents).toBe(30_000);
    expect(buffered.rollups.estimate_total).toBe(230_000);
  });

  it('falls back through the template to a default title, ignoring whitespace', async () => {
    const { project } = await localHomeProjectsApi.create(householdId, {
      title: '   ',
    });
    expect(project.title).toBe('New home project');
  });

  it('is idempotent when the caller supplies an id', async () => {
    // What lets the wizard retry a create it is not sure landed. The Worker looks
    // the id up first and RETURNS the existing project rather than erroring.
    const first = await localHomeProjectsApi.create(householdId, {
      id: 'hpj_fixed',
      title: 'Ensuite',
    });
    const before = opCount();
    const second = await localHomeProjectsApi.create(householdId, {
      id: 'hpj_fixed',
      title: 'Different name',
    });
    expect(second.project.id).toBe(first.project.id);
    expect(second.project.title).toBe('Ensuite');
    // …and it writes nothing at all the second time.
    expect(opCount()).toBe(before);
    expect(getLocalHouseLedger().homeProjects).toHaveLength(1);
  });

  it('accepts spaceIds and cannot store them, because the join table is S2', async () => {
    // The one place in this facade where a member loses something, and it is
    // forced: `home_project_spaces` has two foreign keys and nothing else, so
    // there is no field to key a ledger row on. Nothing renders `space_ids`
    // today, so the loss is invisible rather than wrong — but it is asserted
    // here so it stays a known gap rather than a surprise.
    const { project } = await localHomeProjectsApi.create(householdId, {
      title: 'Ensuite',
      spaceIds: ['sp_bath', 'sp_hall'],
    });
    const hub = await localHomeProjectsApi.getHub(householdId, project.id);
    expect(hub.space_ids).toEqual([]);
  });

  it('refuses a property this device does not hold', async () => {
    await expect(localHomeProjectsApi.list('hh_other')).rejects.toThrow(
      HouseLocalUnknownPropertyError,
    );
    await expect(
      localHomeProjectsApi.getHub('hh_other', 'hpj_1'),
    ).rejects.toThrow(HouseLocalUnknownPropertyError);
  });

  it('raises for a project that does not exist', async () => {
    await expect(
      localHomeProjectsApi.getHub(householdId, 'hpj_missing'),
    ).rejects.toThrow('Home project not found');
  });
});

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

describe('the project list — four decisions, not a table dump', () => {
  it('hides archived projects unless the status filter asks for them', async () => {
    const live = await createBlankProject('Ensuite');
    const gone = await createBlankProject('Old kitchen');
    await localHomeProjectsApi.archive(householdId, gone);

    const active = await localHomeProjectsApi.list(householdId);
    expect(active.projects.map(p => p.id)).toEqual([live]);
    // The `else` branch is what makes an archived project reachable at all, and
    // it is exactly what `useHomeProjects({ includeArchived: true })` uses.
    const archived = await localHomeProjectsApi.list(householdId, {
      status: 'archived',
    });
    expect(archived.projects.map(p => p.id)).toEqual([gone]);
  });

  it('searches the title case-insensitively, as SQLite LIKE does', async () => {
    await createBlankProject('Ensuite refit');
    await createBlankProject('Garage door');
    const found = await localHomeProjectsApi.list(householdId, {
      q: 'ENSUITE',
    });
    expect(found.projects.map(p => p.title)).toEqual(['Ensuite refit']);
  });

  it('orders by updated_at descending', async () => {
    const first = await createBlankProject('First');
    const second = await createBlankProject('Second');
    // Touching the older one moves it to the front.
    await localHomeProjectsApi.update(householdId, first, {
      summary: 'bumped',
    });
    const { projects } = await localHomeProjectsApi.list(householdId);
    expect(projects.map(p => p.id)).toEqual([first, second]);
  });
});

// ---------------------------------------------------------------------------
// The hub — the read that had to be local
// ---------------------------------------------------------------------------

describe('the hub, and the rollups that would otherwise read $0', () => {
  it('orders the three sorted children on a column the DTO does not carry', async () => {
    const projectId = await createBlankProject();
    // Seeded deliberately out of order: without the sort this returns the
    // ledger's order and would pass for the wrong reason.
    const ledger = getLocalHouseLedger();
    ledger.homeProjectPhases.push(
      {
        id: 'c',
        household_id: householdId,
        project_id: projectId,
        title: 'Third',
        status: 'pending',
        starts_on: null,
        ends_on: null,
        sort_order: 2,
      },
      {
        id: 'a',
        household_id: householdId,
        project_id: projectId,
        title: 'First',
        status: 'pending',
        starts_on: null,
        ends_on: null,
        sort_order: 0,
      },
      {
        id: 'b',
        household_id: householdId,
        project_id: projectId,
        title: 'Second',
        status: 'pending',
        starts_on: null,
        ends_on: null,
        sort_order: 1,
      },
    );

    const hub = await localHomeProjectsApi.getHub(householdId, projectId);
    expect(hub.phases.map(p => p.title)).toEqual(['First', 'Second', 'Third']);
  });

  it('estimates a new project at nothing, then tracks what the member prices', async () => {
    const { project } = await localHomeProjectsApi.create(householdId, {
      templateKey: 'bathroom_reno',
      targetBudgetCents: 1_200_000,
    });
    const fresh = await localHomeProjectsApi.getHub(householdId, project.id);
    // The template seeds the ROWS to price — Materials, Labor, Permits — and no
    // money in any of them. A project nobody has priced is worth nothing rather
    // than opening on a national average it was born holding.
    expect(fresh.budget_lines.map(line => line.label)).toEqual([
      'Materials',
      'Labor',
      'Permits',
    ]);
    expect(fresh.budget_lines.map(line => line.estimate_cents)).toEqual([
      0, 0, 0,
    ]);
    expect(fresh.rollups.estimate_total).toBe(0);
    expect(fresh.rollups.contingency_cents).toBe(0);
    expect(fresh.rollups.budget_health).toBe('ok');

    // Pricing a selection mints its own materials line, and the estimate follows.
    await localHomeProjectsApi.createSelection(householdId, project.id, {
      name: 'Vanity',
      unitPriceCents: 800_000,
    });
    const hub = await localHomeProjectsApi.getHub(householdId, project.id);
    // 800_000 priced and 800_000 total: the template sets no rate either, so the
    // project costs exactly what the member entered.
    expect(hub.rollups.contingency_cents).toBe(0);
    expect(hub.rollups.estimate_total).toBe(800_000);
    expect(hub.rollups.actual_total).toBe(0);
    expect(hub.rollups.target_budget_cents).toBe(1_200_000);
    // 800_000 is under 90% of the target, so the badge is still green.
    expect(hub.rollups.budget_health).toBe('ok');
  });

  it('reports `over` past the target and `ok` with no target at all', () => {
    // Straight against the ported function, because the boundaries are the thing
    // and seeding four projects to reach them would obscure it.
    //
    // The explicit zero contingency line is what keeps this test about the health
    // thresholds: `estimate_total` is the subtotal PLUS the contingency, so
    // without it every figure below would arrive 15% larger than it reads.
    const at = (estimate: number) => [
      { category: 'materials', estimate_cents: estimate, actual_cents: 0 },
      { category: 'contingency', estimate_cents: 0, actual_cents: 0 },
    ];
    expect(
      computeBudgetRollups(
        { contingency_pct: 15, target_budget_cents: 999 },
        at(1_000),
      ).budget_health,
    ).toBe('over');
    // Exactly ON the target is `watch`, not `over` — the comparison is strictly
    // greater, so a project that lands precisely on budget is not over it.
    expect(
      computeBudgetRollups(
        { contingency_pct: 15, target_budget_cents: 1_000 },
        at(1_000),
      ).budget_health,
    ).toBe('watch');
    // …and exactly 90% of target is still `ok`, for the same reason one boundary
    // down. Both edges are the server's and both are one character from wrong.
    expect(
      computeBudgetRollups(
        { contingency_pct: 15, target_budget_cents: 1_000 },
        at(900),
      ).budget_health,
    ).toBe('ok');
    expect(
      computeBudgetRollups(
        { contingency_pct: 15, target_budget_cents: 1_000 },
        at(901),
      ).budget_health,
    ).toBe('watch');
    expect(
      computeBudgetRollups(
        { contingency_pct: 15, target_budget_cents: null },
        at(1_000),
      ).budget_health,
    ).toBe('ok');
    // A target of zero is treated as "no target", not as "instantly over".
    expect(
      computeBudgetRollups(
        { contingency_pct: 15, target_budget_cents: 0 },
        at(1_000),
      ).budget_health,
    ).toBe('ok');
  });

  it('reproduces the two quirks that decide what a NEW project shows', () => {
    // 1. The `||` fallback: when every line sums to zero the total becomes
    //    subtotal + computed contingency, so a fresh project shows a contingency
    //    rather than a flat zero. `??` would leave it at 0 forever.
    const zeroed = computeBudgetRollups(
      { contingency_pct: 15, target_budget_cents: null },
      [{ category: 'materials', estimate_cents: 0, actual_cents: 0 }],
    );
    expect(zeroed.estimate_total).toBe(0);
    // 2. The `??` on the contingency LINE: a member who deliberately zeroes it
    //    gets zero rather than 15% of the subtotal.
    const zeroContingency = computeBudgetRollups(
      { contingency_pct: 15, target_budget_cents: null },
      [
        { category: 'materials', estimate_cents: 100_000, actual_cents: 0 },
        { category: 'contingency', estimate_cents: 0, actual_cents: 0 },
      ],
    );
    expect(zeroContingency.contingency_cents).toBe(0);
    // …and without a line at all it is derived from the percentage.
    const derived = computeBudgetRollups(
      { contingency_pct: 20, target_budget_cents: null },
      [{ category: 'materials', estimate_cents: 100_000, actual_cents: 0 }],
    );
    expect(derived.contingency_cents).toBe(20_000);
  });

  it('answers a null geometry for a project that has none', async () => {
    const projectId = await createBlankProject();
    const hub = await localHomeProjectsApi.getHub(householdId, projectId);
    expect(hub.geometry).toBeNull();
  });

  /**
   * The read half of the H13 D-wave, and it was missing for a while.
   *
   * `putManualGeometry` became a local write when the table was ledgered, but
   * `buildHub` kept its hardcoded `geometry: null` from the Tier-D days. The
   * write landed, the row synced to every peer, and the hub told everyone there
   * was no layout — so a member laid out a room, watched it save, went back and
   * was offered the empty state again. Nothing failed and nothing logged.
   */
  it('reads a stored layout back out of the hub', async () => {
    const projectId = await createBlankProject();
    await localHomeProjectsApi.putManualGeometry(householdId, projectId, {
      schema_version: 2,
      units: 'm',
      room: {
        outline: [
          [0, 0],
          [4, 0],
          [4, 3],
          [0, 3],
        ],
        wallHeight_m: 2.4,
      },
      surfaces: [],
      materials: [],
      source_meta: { captured_at: '2026-08-27T10:00:00.000Z' },
    });

    const hub = await localHomeProjectsApi.getHub(householdId, projectId);
    expect(hub.geometry).not.toBeNull();
    expect(hub.geometry?.source).toBe('manual');
    expect(hub.geometry?.status).toBe('completed');
    expect(JSON.parse(hub.geometry!.payload_json!).room.wallHeight_m).toBe(2.4);
  });

  /**
   * One row per source, and the hub shows whichever was touched last.
   *
   * The two timestamps are seeded rather than written back to back:
   * `nowIso()` has millisecond resolution, so two real writes in a row can tie
   * and the assertion would be testing the speed of the machine. The paging
   * test below seeds for the same reason.
   */
  it('prefers the most recently updated layout', async () => {
    const projectId = await createBlankProject();
    await localHomeProjectsApi.putManualGeometry(householdId, projectId, {
      marker: 'manual',
    });
    await localHomeProjectsApi.putRoomPlanGeometry(householdId, projectId, {
      marker: 'roomplan',
    });

    const ledger = getLocalHouseLedger();
    for (const row of ledger.homeProjectGeometry) {
      row.updated_at =
        row.source === 'roomplan'
          ? '2026-08-27T10:00:01.000Z'
          : '2026-08-27T10:00:00.000Z';
    }

    const newer = await localHomeProjectsApi.getHub(householdId, projectId);
    expect(newer.geometry?.source).toBe('roomplan');

    // And the other way round, so the assertion is about the ordering rather
    // than about which source happens to be written second.
    for (const row of ledger.homeProjectGeometry) {
      row.updated_at =
        row.source === 'manual'
          ? '2026-08-27T10:00:02.000Z'
          : '2026-08-27T10:00:01.000Z';
    }
    const older = await localHomeProjectsApi.getHub(householdId, projectId);
    expect(older.geometry?.source).toBe('manual');
  });

  it('stops reporting a layout once it is deleted', async () => {
    const projectId = await createBlankProject();
    await localHomeProjectsApi.putManualGeometry(householdId, projectId, {
      marker: 'manual',
    });
    const stored = await localHomeProjectsApi.getHub(householdId, projectId);
    await localHomeProjectsApi.cancelGeometry(
      householdId,
      projectId,
      stored.geometry!.id,
    );

    const after = await localHomeProjectsApi.getHub(householdId, projectId);
    expect(after.geometry).toBeNull();
  });

  it('keeps one project’s layout out of another’s hub', async () => {
    const mine = await createBlankProject('Mine');
    const other = await createBlankProject('Other');
    await localHomeProjectsApi.putManualGeometry(householdId, mine, {
      marker: 'mine',
    });

    const otherHub = await localHomeProjectsApi.getHub(householdId, other);
    expect(otherHub.geometry).toBeNull();
  });

  it('keeps another project’s children out', async () => {
    const mine = await createBlankProject('Mine');
    const other = await createBlankProject('Other');
    seedMilestone('hpms_mine', mine);
    seedMilestone('hpms_other', other);
    seedBlocker('hpblk_other', other);

    const hub = await localHomeProjectsApi.getHub(householdId, mine);
    expect(
      (hub.milestones as LocalHomeProjectMilestone[]).map(m => m.id),
    ).toEqual(['hpms_mine']);
    expect(hub.blockers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

describe('selections', () => {
  it('mints the derived budget line in the SAME op as the selection', async () => {
    const projectId = await createBlankProject();
    const before = opCount();
    const { selection } = await localHomeProjectsApi.createSelection(
      householdId,
      projectId,
      {
        name: 'Vanity',
        unitPriceCents: 80_000,
      },
    );
    // Selection + budget line + activity = one op. Splitting them would let a
    // peer hold a priced selection whose money is missing from the estimate.
    expect(opCount() - before).toBe(1);

    const hub = await localHomeProjectsApi.getHub(householdId, projectId);
    const derived = hub.budget_lines.find(l => l.label === 'Vanity');
    expect(derived).toBeDefined();
    expect(derived!.category).toBe('materials');
    expect(derived!.estimate_cents).toBe(80_000);
    // …and the rollup moved, which is the number a member actually looks at.
    // 80_000 priced and 80_000 total — no buffer unless the member sets one.
    expect(hub.rollups.contingency_cents).toBe(0);
    expect(hub.rollups.estimate_total).toBe(80_000);
    expect(selection.qty).toBe(1);
    expect(selection.version).toBe(1);
    expect(selection.status).toBe('idea');
    expect(selection.category).toBe('other');
  });

  it('mints no budget line for an unpriced or zero-priced selection', async () => {
    const projectId = await createBlankProject();
    await localHomeProjectsApi.createSelection(householdId, projectId, {
      name: 'Tile',
    });
    await localHomeProjectsApi.createSelection(householdId, projectId, {
      name: 'Freebie',
      unitPriceCents: 0,
    });
    const hub = await localHomeProjectsApi.getHub(householdId, projectId);
    // Nothing priced, so nothing in the budget — and a blank project brings no
    // lines of its own to pad the count.
    expect(hub.budget_lines).toEqual([]);
    expect(hub.selections).toHaveLength(2);
  });

  /**
   * The materials list prepends on BOTH backends, and by the same arithmetic —
   * `topSortOrder` against the Worker's `topSelectionSortOrder`. A household
   * that moved between them with different rules would see its materials
   * reshuffle for no reason it could name, which is the drift this facade's
   * whole sort_order treatment exists to prevent.
   */
  it('puts a new material on top, and keeps a stated order as stated', async () => {
    const projectId = await createBlankProject();
    const add = (name: string, sortOrder?: number) =>
      localHomeProjectsApi.createSelection(householdId, projectId, {
        name,
        ...(sortOrder == null ? {} : { sortOrder }),
      });
    const names = async () =>
      (await localHomeProjectsApi.getHub(householdId, projectId)).selections.map(
        s => s.name,
      );

    // A plan written row by row, each naming its index.
    await add('OSB panels', 0);
    await add('Screws', 1);
    await add('Primer', 2);
    expect(await names()).toEqual(['OSB panels', 'Screws', 'Primer']);

    // The member's own adds, newest first, above the whole plan.
    await add('Mold control');
    await add('Shop light');
    expect(await names()).toEqual([
      'Shop light',
      'Mold control',
      'OSB panels',
      'Screws',
      'Primer',
    ]);
  });

  it('records selection_added and selection_updated on the activity trail', async () => {
    const projectId = await createBlankProject();
    const { selection } = await localHomeProjectsApi.createSelection(
      householdId,
      projectId,
      {
        name: 'Tile',
      },
    );
    await localHomeProjectsApi.updateSelection(
      householdId,
      projectId,
      selection.id,
      {
        status: 'approved',
      },
    );
    const actions = getLocalHouseLedger().homeProjectActivity.map(
      a => a.action,
    );
    expect(actions).toEqual([
      'project_created',
      'selection_added',
      'selection_updated',
    ]);
  });

  it('bumps the version and leaves an untouched field alone', async () => {
    const projectId = await createBlankProject();
    const { selection } = await localHomeProjectsApi.createSelection(
      householdId,
      projectId,
      {
        name: 'Tile',
        notes: 'matte',
      },
    );
    const updated = await localHomeProjectsApi.updateSelection(
      householdId,
      projectId,
      selection.id,
      { status: 'ordered' },
    );
    expect(updated.selection.version).toBe(2);
    expect(updated.selection.status).toBe('ordered');
    expect(updated.selection.notes).toBe('matte');
    // An explicit null CLEARS, because the Worker's `!== undefined` check does.
    const cleared = await localHomeProjectsApi.updateSelection(
      householdId,
      projectId,
      selection.id,
      { notes: null },
    );
    expect(cleared.selection.notes).toBeNull();
    expect(cleared.selection.version).toBe(3);
  });

  it('raises a 409 the hub screen already knows how to read', async () => {
    const projectId = await createBlankProject();
    const { selection } = await localHomeProjectsApi.createSelection(
      householdId,
      projectId,
      {
        name: 'Tile',
      },
    );

    const error = await localHomeProjectsApi
      .updateSelection(householdId, projectId, selection.id, {
        version: 99,
        name: 'Other',
      })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HouseLocalHomeProjectConflictError);
    // The whole point of mimicking the transport shape: `withConflict` in
    // `HomeProjectHubScreen` branches on this exact helper, so a local conflict
    // has to satisfy it or the member gets a generic error alert instead of
    // "someone else changed this — reload?".
    expect(isHomeProjectConflict(error)).toBe(true);
    // …and the write did not land.
    const hub = await localHomeProjectsApi.getHub(householdId, projectId);
    expect(hub.selections[0]!.name).toBe('Tile');
    expect(hub.selections[0]!.version).toBe(1);
  });

  it('raises for a selection that does not exist', async () => {
    const projectId = await createBlankProject();
    await expect(
      localHomeProjectsApi.updateSelection(
        householdId,
        projectId,
        'hpsel_missing',
        {},
      ),
    ).rejects.toThrow('Selection not found');
  });
});

/**
 * The budget lines a member types themselves.
 *
 * These three writes are new: the routes have existed since the feature shipped
 * and had no client at all, so every line on a project was minted by something
 * else — a template seeding the row, a priced material, an option group's winner
 * — and a member could read the money without touching it. A labour quote had
 * nowhere to go, and a figure the app derived wrongly could not be corrected.
 */
describe('budget lines are the member’s to write', () => {
  it('adds a line, and the rollup it feeds moves with it', async () => {
    const projectId = await createBlankProject();
    const before = opCount();
    const { budget_line } = await localHomeProjectsApi.createBudgetLine(
      householdId,
      projectId,
      {
        category: 'labor',
        label: 'Tiler',
        estimateCents: 220_000,
      },
    );
    expect(opCount() - before).toBe(1);
    expect(budget_line.category).toBe('labor');
    expect(budget_line.actual_cents).toBe(0);
    expect(budget_line.version).toBe(1);

    const hub = await localHomeProjectsApi.getHub(householdId, projectId);
    expect(hub.rollups.estimate_total).toBe(220_000);
    // Nothing is added on top: the total is the member's own figure.
    expect(hub.rollups.contingency_cents).toBe(0);
  });

  /**
   * `sort_order` is a local-only column (`types.ts`) that `buildHub` sorts on. D1
   * defaults it to 0, so the Worker's hand-added lines all sort equal and land in
   * insertion order; here they would too, but only by the array's accident. Each
   * new line therefore takes the next order up, so "the one I just added is at
   * the bottom" survives a replay that reorders the rows.
   */
  it('files each new line after the ones already there', async () => {
    const projectId = await createBlankProject();
    for (const label of ['First', 'Second', 'Third']) {
      await localHomeProjectsApi.createBudgetLine(householdId, projectId, {
        category: 'other',
        label,
      });
    }
    const hub = await localHomeProjectsApi.getHub(householdId, projectId);
    expect(hub.budget_lines.map(line => line.label)).toEqual([
      'First',
      'Second',
      'Third',
    ]);
    // Read off the ledger, not the hub: `sort_order` is a local-only column the
    // DTO does not declare, which is exactly why it needs asserting here.
    expect(
      getLocalHouseLedger()
        .homeProjectBudgetLines.filter(line => line.project_id === projectId)
        .map(line => line.sort_order),
    ).toEqual([0, 1, 2]);
  });

  it('corrects a figure, bumping the version', async () => {
    const projectId = await createBlankProject();
    const { budget_line } = await localHomeProjectsApi.createBudgetLine(
      householdId,
      projectId,
      {
        category: 'permits',
        label: 'Permit',
        estimateCents: 50_000,
      },
    );

    const { budget_line: updated } =
      await localHomeProjectsApi.updateBudgetLine(
        householdId,
        projectId,
        budget_line.id,
        {
          label: 'Building permit',
          estimateCents: 62_500,
          actualCents: 62_500,
        },
      );
    expect(updated.label).toBe('Building permit');
    expect(updated.estimate_cents).toBe(62_500);
    expect(updated.actual_cents).toBe(62_500);
    expect(updated.version).toBe(2);

    const hub = await localHomeProjectsApi.getHub(householdId, projectId);
    expect(hub.rollups.estimate_total).toBe(62_500);
    expect(hub.rollups.actual_total).toBe(62_500);
  });

  /**
   * Money is the field where last-write-wins is most expensive and least visible:
   * two members pricing the same job offline both believe their number is the
   * current one. `isHomeProjectConflict` is what `withConflict` on the hub screen
   * branches on, so a local conflict has to satisfy it or the member gets a
   * generic failure instead of "someone else changed this".
   */
  it('raises a 409 the hub screen already knows how to read', async () => {
    const projectId = await createBlankProject();
    const { budget_line } = await localHomeProjectsApi.createBudgetLine(
      householdId,
      projectId,
      {
        category: 'labor',
        label: 'Tiler',
        estimateCents: 100_000,
      },
    );

    const error = await localHomeProjectsApi
      .updateBudgetLine(householdId, projectId, budget_line.id, {
        version: 99,
        estimateCents: 1,
      })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HouseLocalHomeProjectConflictError);
    expect(isHomeProjectConflict(error)).toBe(true);
    const hub = await localHomeProjectsApi.getHub(householdId, projectId);
    expect(hub.budget_lines[0]!.estimate_cents).toBe(100_000);
    expect(hub.budget_lines[0]!.version).toBe(1);
  });

  /**
   * A leaf delete. `selection_id` is plain text with no `references()`, so
   * removing the line a material was priced into leaves the material alone —
   * the same asymmetry the server has, where `deleteSelection` leaves the derived
   * line in place.
   */
  it('removes a line without touching the material it came from', async () => {
    const projectId = await createBlankProject();
    const { selection } = await localHomeProjectsApi.createSelection(
      householdId,
      projectId,
      {
        name: 'Vanity',
        unitPriceCents: 80_000,
      },
    );
    const priced = await localHomeProjectsApi.getHub(householdId, projectId);
    const derived = priced.budget_lines.find(line => line.label === 'Vanity');
    expect(derived).toBeDefined();

    await localHomeProjectsApi.deleteBudgetLine(
      householdId,
      projectId,
      derived!.id,
    );

    const after = await localHomeProjectsApi.getHub(householdId, projectId);
    expect(after.budget_lines).toEqual([]);
    expect(after.rollups.estimate_total).toBe(0);
    expect(after.selections.map(row => row.id)).toEqual([selection.id]);
  });

  it('raises for a line that does not exist', async () => {
    const projectId = await createBlankProject();
    await expect(
      localHomeProjectsApi.updateBudgetLine(
        householdId,
        projectId,
        'hpbl_missing',
        {},
      ),
    ).rejects.toThrow('Budget line not found');
    await expect(
      localHomeProjectsApi.deleteBudgetLine(
        householdId,
        projectId,
        'hpbl_missing',
      ),
    ).rejects.toThrow('Budget line not found');
  });
});

describe('phases, blockers, plan links and comments', () => {
  it('creates a phase and records NO activity, matching the server', async () => {
    // `createPhase` is the only creating method in the service with no
    // `recordActivity` call. Almost certainly an oversight there, and reproduced
    // rather than corrected: the feed is member-visible, so adding the row would
    // make a household that switched backends see a different history.
    const projectId = await createBlankProject();
    const before = getLocalHouseLedger().homeProjectActivity.length;
    const { phase } = await localHomeProjectsApi.createPhase(
      householdId,
      projectId,
      {
        title: 'Demo',
      },
    );
    expect(phase.status).toBe('pending');
    expect(phase.sort_order).toBe(0);
    expect(getLocalHouseLedger().homeProjectActivity).toHaveLength(before);
  });

  it('creates a blocker with the default severity and an activity row', async () => {
    const projectId = await createBlankProject();
    const { blocker } = await localHomeProjectsApi.createBlocker(
      householdId,
      projectId,
      {
        title: 'Load-bearing?',
      },
    );
    expect(blocker.severity).toBe('medium');
    expect(blocker.status).toBe('open');
    expect(
      getLocalHouseLedger().homeProjectActivity.map(a => a.action),
    ).toContain('blocker_added');
  });

  /**
   * The five assertions below are the Worker's `phases and blockers` route
   * suite, run against the ledger instead of D1. They are deliberately the same
   * scenarios in the same order: `local-mirror-must-match-worker-encoding` is
   * about the two halves agreeing, and a local suite that invents its own cases
   * can pass while the pair diverges.
   */
  it('appends each new phase and each new blocker, as the Worker does', async () => {
    const projectId = await createBlankProject();
    for (const title of ['Strip out', 'Insulate', 'Paint']) {
      await localHomeProjectsApi.createPhase(householdId, projectId, { title });
    }
    for (const title of ['Permits', 'Damp']) {
      await localHomeProjectsApi.createBlocker(householdId, projectId, {
        title,
      });
    }

    const hub = await localHomeProjectsApi.getHub(householdId, projectId);
    expect(hub.phases.map(p => p.title)).toEqual([
      'Strip out',
      'Insulate',
      'Paint',
    ]);
    expect(hub.phases.map(p => p.sort_order)).toEqual([0, 1, 2]);
    expect(hub.blockers.map(b => b.sort_order)).toEqual([0, 1]);
  });

  it('edits a phase without writing an activity row', async () => {
    const projectId = await createBlankProject();
    const { phase } = await localHomeProjectsApi.createPhase(
      householdId,
      projectId,
      { title: 'Insulate' },
    );
    const before = getLocalHouseLedger().homeProjectActivity.length;

    const { phase: updated } = await localHomeProjectsApi.updatePhase(
      householdId,
      projectId,
      phase.id,
      { title: 'Insulate walls and ceiling', status: 'done' },
    );

    expect(updated.title).toBe('Insulate walls and ceiling');
    expect(updated.status).toBe('done');
    // Same silence as `createPhase`, and for the same reason.
    expect(getLocalHouseLedger().homeProjectActivity).toHaveLength(before);
  });

  it('reorders phases, keeping an unnamed one at the end', async () => {
    const projectId = await createBlankProject();
    const created = [];
    for (const title of ['One', 'Two', 'Three']) {
      const { phase } = await localHomeProjectsApi.createPhase(
        householdId,
        projectId,
        { title },
      );
      created.push(phase);
    }

    // Only two of the three named — the third is a row another device added
    // between the read and the drop, and the drop must survive it.
    const before = opCount();
    const { phases } = await localHomeProjectsApi.reorderPhases(
      householdId,
      projectId,
      [created[2].id, created[1].id],
    );
    expect(phases.map(p => p.title)).toEqual(['Three', 'Two', 'One']);
    expect(phases.map(p => p.sort_order)).toEqual([0, 1, 2]);

    // ONE op for the whole list, never one per row. Three ops here would let
    // per-field LWW interleave two members' drags into an order neither chose;
    // as one, the loser's drag is overwritten whole and is a re-drag.
    expect(opCount()).toBe(before + 1);
  });

  it('refuses to reorder using an id from another project', async () => {
    const mine = await createBlankProject('Mine');
    const theirs = await createBlankProject('Theirs');
    const { phase } = await localHomeProjectsApi.createPhase(
      householdId,
      theirs,
      { title: 'Not yours' },
    );

    await expect(
      localHomeProjectsApi.reorderPhases(householdId, mine, [phase.id]),
    ).rejects.toThrow('is not part of this project');
  });

  it('resolves a blocker without writing resolved_at, and logs the edit', async () => {
    const projectId = await createBlankProject();
    const { blocker } = await localHomeProjectsApi.createBlocker(
      householdId,
      projectId,
      { title: 'Permits' },
    );

    const { blocker: updated } = await localHomeProjectsApi.updateBlocker(
      householdId,
      projectId,
      blocker.id,
      {
        severity: 'critical',
        status: 'resolved',
        notes: 'Council confirmed a permit is needed',
      },
    );

    expect(updated.severity).toBe('critical');
    expect(updated.status).toBe('resolved');
    expect(updated.notes).toBe('Council confirmed a permit is needed');
    // The row type does not carry `resolved_at` and neither backend writes it.
    expect('resolved_at' in updated).toBe(false);
    expect(
      getLocalHouseLedger().homeProjectActivity.map(a => a.action),
    ).toContain('blocker_updated');
  });

  it('deletes a phase silently and a blocker with an activity row', async () => {
    const projectId = await createBlankProject();
    const { phase } = await localHomeProjectsApi.createPhase(
      householdId,
      projectId,
      { title: 'Paint' },
    );
    const { blocker } = await localHomeProjectsApi.createBlocker(
      householdId,
      projectId,
      { title: 'Damp' },
    );

    const beforePhaseDelete =
      getLocalHouseLedger().homeProjectActivity.length;
    await localHomeProjectsApi.deletePhase(householdId, projectId, phase.id);
    expect(getLocalHouseLedger().homeProjectActivity).toHaveLength(
      beforePhaseDelete,
    );

    await localHomeProjectsApi.deleteBlocker(
      householdId,
      projectId,
      blocker.id,
    );
    expect(
      getLocalHouseLedger().homeProjectActivity.map(a => a.action),
    ).toContain('blocker_deleted');

    const hub = await localHomeProjectsApi.getHub(householdId, projectId);
    expect(hub.phases).toHaveLength(0);
    expect(hub.blockers).toHaveLength(0);
  });

  it('stores a plan link’s zone payload as the JSON STRING D1 stores', async () => {
    const projectId = await createBlankProject();
    const { plan_link } = await localHomeProjectsApi.createPlanLink(
      householdId,
      projectId,
      {
        floorPlanId: 'fp_1',
        zonePayload: { x: 1, y: 2 },
      },
    );
    // The DTO types this `string | null` and the route stringifies on the way in
    // — the opposite call to C2's `svg_data`, and the same one C3 made on
    // `garden_plans.boundary_geojson`.
    expect(typeof plan_link.zone_payload).toBe('string');
    expect(JSON.parse(plan_link.zone_payload!)).toEqual({ x: 1, y: 2 });
    // …and an absent payload is a real null rather than `"undefined"`.
    const bare = await localHomeProjectsApi.createPlanLink(
      householdId,
      projectId,
      {
        floorPlanId: 'fp_2',
      },
    );
    expect(bare.plan_link.zone_payload).toBeNull();
  });

  it('writes a comment and its activity row in one op, trimmed', async () => {
    const projectId = await createBlankProject();
    const before = opCount();
    const { comment } = await localHomeProjectsApi.addComment(
      householdId,
      projectId,
      {
        body: '  Ask about the tiles  ',
      },
    );
    expect(opCount() - before).toBe(1);
    expect(comment.body).toBe('Ask about the tiles');
    expect(comment.user_id).toBeTruthy();
    expect(
      getLocalHouseLedger().homeProjectActivity.map(a => a.action),
    ).toContain('comment_added');
    await expect(
      localHomeProjectsApi.addComment(householdId, projectId, { body: '   ' }),
    ).rejects.toThrow('Comment body required');
  });
});

describe('removing a material', () => {
  /**
   * The FIRST delete this facade exposes. Until it existed a material could be
   * added and never taken away, so a project accumulated every mistake — and
   * every guess a template had seeded — permanently.
   */
  it('takes the row out and records it, in one op', async () => {
    const projectId = await createBlankProject();
    const { selection } = await localHomeProjectsApi.createSelection(
      householdId,
      projectId,
      { name: 'Wrong tile' },
    );

    const before = opCount();
    await localHomeProjectsApi.deleteSelection(
      householdId,
      projectId,
      selection.id,
    );
    expect(opCount() - before).toBe(1);

    const hub = await localHomeProjectsApi.getHub(householdId, projectId);
    expect(hub.selections.map(s => s.id)).not.toContain(selection.id);
    expect(
      getLocalHouseLedger().homeProjectActivity.map(a => a.action),
    ).toContain('selection_deleted');
  });

  it('is a no-op for a row that is already gone', async () => {
    const projectId = await createBlankProject();
    await expect(
      localHomeProjectsApi.deleteSelection(
        householdId,
        projectId,
        'hpsel_nope',
      ),
    ).resolves.toEqual({ success: true });
  });

  it('leaves another project’s materials alone', async () => {
    const mine = await createBlankProject('Mine');
    const other = await createBlankProject('Other');
    const { selection } = await localHomeProjectsApi.createSelection(
      householdId,
      mine,
      { name: 'Mine only' },
    );

    await localHomeProjectsApi.deleteSelection(
      householdId,
      other,
      selection.id,
    );

    const hub = await localHomeProjectsApi.getHub(householdId, mine);
    expect(hub.selections.map(s => s.id)).toContain(selection.id);
  });

  /**
   * A priced selection mints a budget line in the same op it is created in.
   * Removing a LOOSE one leaves that line, exactly as the Worker does — the
   * cleanup is scoped to a group's chosen winner, because that is the only
   * pointer the estimate reads back.
   */
  it('matches the server on which money it takes with it', async () => {
    const projectId = await createBlankProject();
    const { selection } = await localHomeProjectsApi.createSelection(
      householdId,
      projectId,
      { name: 'Priced tile', unitPriceCents: 5_000 },
    );
    const before = await localHomeProjectsApi.getHub(householdId, projectId);
    expect(before.budget_lines.length).toBeGreaterThan(0);

    await localHomeProjectsApi.deleteSelection(
      householdId,
      projectId,
      selection.id,
    );

    const after = await localHomeProjectsApi.getHub(householdId, projectId);
    expect(after.budget_lines).toHaveLength(before.budget_lines.length);
  });
});

describe('the activity feed', () => {
  /**
   * Newest first, asserted as the INVARIANT rather than as a fixed pair.
   *
   * Both backends order this feed on `created_at` alone
   * (`orderBy(desc(homeProjectActivity.created_at))`, and `byCreatedAtDesc`
   * here), and `nowIso()` has millisecond resolution — so a create and the
   * selection that follows it can share a timestamp, and neither backend
   * promises which comes out first when they do. Asserting a literal
   * `['selection_added', 'project_created']` was therefore asserting the speed
   * of the machine: it held while the two writes straddled a millisecond
   * boundary and failed when they did not.
   *
   * What is actually guaranteed — and what a member sees — is that the feed is
   * non-increasing by `created_at` and holds both events. That is what is
   * checked. A tiebreak would have to be added to the Worker first; adding one
   * only here would make the two feeds disagree.
   */
  it('returns newest first with a null cursor below the page size', async () => {
    const projectId = await createBlankProject();
    await localHomeProjectsApi.createSelection(householdId, projectId, {
      name: 'Tile',
    });
    const { items, next_cursor } = await localHomeProjectsApi.listActivity(
      householdId,
      projectId,
    );
    expect(items.map(i => i.action).sort()).toEqual([
      'project_created',
      'selection_added',
    ]);
    for (let i = 1; i < items.length; i += 1) {
      expect(items[i - 1].created_at >= items[i].created_at).toBe(true);
    }
    expect(next_cursor).toBeNull();
  });

  it('pages at fifty and resumes after the cursor', async () => {
    const projectId = await createBlankProject();
    const ledger = getLocalHouseLedger();
    // 60 rows with distinct timestamps, seeded directly: driving 60 real writes
    // would be the same assertion at sixty times the cost.
    for (let i = 0; i < 60; i += 1) {
      const row: LocalHomeProjectActivity = {
        id: `hpact_${String(i).padStart(2, '0')}`,
        household_id: householdId,
        project_id: projectId,
        actor_user_id: USER,
        action: 'project_updated',
        entity_type: 'project',
        entity_id: projectId,
        meta_json: null,
        created_at: `2026-08-${String(i + 1).padStart(2, '0')}T09:00:00.000Z`,
      };
      ledger.homeProjectActivity.push(row);
    }

    const first = await localHomeProjectsApi.listActivity(
      householdId,
      projectId,
    );
    expect(first.items).toHaveLength(50);
    expect(first.next_cursor).toBe(first.items[49]!.id);

    const second = await localHomeProjectsApi.listActivity(
      householdId,
      projectId,
      first.next_cursor!,
    );
    expect(second.items.length).toBeGreaterThan(0);
    expect(second.items.map(i => i.id)).not.toContain(first.items[0]!.id);
    expect(second.next_cursor).toBeNull();
  });

  it('restarts the feed for a cursor it does not recognise, as the Worker does', async () => {
    const projectId = await createBlankProject();
    const { items } = await localHomeProjectsApi.listActivity(
      householdId,
      projectId,
      'nope',
    );
    // `findIndex` returns -1 and the service falls back to the whole list rather
    // than erroring. Reproduced, because changing it would make the two backends
    // disagree the moment a stale cursor is replayed.
    expect(items).toHaveLength(1);
  });
});

describe('the export summary', () => {
  it('composes the share text locally and answers a null PDF url', async () => {
    const { project } = await localHomeProjectsApi.create(householdId, {
      templateKey: 'paint_refresh',
      targetBudgetCents: 300_000,
    });
    const { shareText, pdfUrl } = await localHomeProjectsApi.exportSummary(
      householdId,
      project.id,
    );

    // The DTO already types `pdfUrl` nullable and `HomeProjectHubScreen` guards
    // `if (pdfUrl && …)` before falling through to a plain text share it writes
    // itself — so this is a complete feature offline, not a degraded one.
    expect(pdfUrl).toBeNull();
    expect(shareText).toContain('Home Project: Paint refresh');
    expect(shareText).toContain('Status: planning · Type: finish_refresh');
    // Cents divided by 100 and rendered with `toFixed(0)`, exactly as the server
    // does — a household that switched backends must share the same document.
    expect(shareText).toContain('Budget target: $3000');
    expect(shareText).toContain('Health: ok');
    // Nothing under Selections: a new project has chosen no materials yet, and
    // the summary says so rather than listing a template's guesses.
    expect(shareText).toContain('Selections:');
    expect(shareText).toContain('- Prep (pending)');
  });

  it('renders `n/a` for a project with no target budget', async () => {
    const projectId = await createBlankProject();
    const { shareText } = await localHomeProjectsApi.exportSummary(
      householdId,
      projectId,
    );
    expect(shareText).toContain('Budget target: n/a');
  });
});

// ---------------------------------------------------------------------------
// Convergence
// ---------------------------------------------------------------------------

/**
 * `create` proved through the MERGE rather than through the local ledger.
 *
 * The failure mode only appears on a second device: a peer that received the
 * project row but not its phases would render a renovation with no schedule —
 * invisible, because nothing on the screen says a phase list is incomplete, and
 * permanent, because the op that carried them is gone.
 */
describe('a created project converges on a peer in one delta', () => {
  const STAMP = stampAt(10, 'member-a', 'op-a');

  it('carries the project and all four child tables together', () => {
    const deviceA = emptyHouseLedger();
    const peer = emptyHouseLedger();

    const before = captureLedgerSnapshot(deviceA);
    deviceA.homeProjects.push({
      id: 'hpj_1',
      household_id: TEST_HOUSEHOLD_ID,
    } as never);
    deviceA.homeProjectPhases.push({
      id: 'hpph_1',
      project_id: 'hpj_1',
      household_id: TEST_HOUSEHOLD_ID,
    } as never);
    deviceA.homeProjectSelections.push({
      id: 'hpsel_1',
      project_id: 'hpj_1',
      household_id: TEST_HOUSEHOLD_ID,
    } as never);
    deviceA.homeProjectBudgetLines.push({
      id: 'hpbl_1',
      project_id: 'hpj_1',
      household_id: TEST_HOUSEHOLD_ID,
    } as never);
    deviceA.homeProjectActivity.push({
      id: 'hpact_1',
      project_id: 'hpj_1',
      household_id: TEST_HOUSEHOLD_ID,
    } as never);

    applyLedgerDelta(peer, diffLedger(before, deviceA)!, STAMP);

    expect(peer.homeProjects).toHaveLength(1);
    expect(peer.homeProjectPhases).toHaveLength(1);
    expect(peer.homeProjectSelections).toHaveLength(1);
    expect(peer.homeProjectBudgetLines).toHaveLength(1);
    expect(peer.homeProjectActivity).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The gaps
// ---------------------------------------------------------------------------

describe('project photos are local-first', () => {
  const DESCRIPTOR = {
    blobId: 'blob_hp_1',
    mime: 'image/jpeg',
    bytes: 481_233,
    sha256: 'a'.repeat(64),
    chunkCount: 2,
    keyEpoch: 1,
  };

  beforeEach(() => {
    mockNormalize.mockReset();
    mockUploadHouseBlob.mockReset();
    mockNormalize.mockResolvedValue({
      uri: 'file:///tmp/normalized.jpg',
      mime: 'image/jpeg',
      width: 2048,
      height: 1536,
      resized: true,
    });
    mockUploadHouseBlob.mockResolvedValue(DESCRIPTOR);
  });

  it('seals the bytes and writes a ready attachment row', async () => {
    const projectId = await createBlankProject('Ensuite');

    const attachment = await localHomeProjectsApi.uploadSelectionPhoto(
      householdId,
      projectId,
      'file:///dcim/IMG_1071.heic',
    );

    expect(attachment.status).toBe('ready');
    expect(attachment.kind).toBe('photo');
    expect(attachment.blob).toEqual(DESCRIPTOR);
    // The HEIC the picker handed over must not be what the row claims: the
    // bytes that were sealed are JPEG, and a peer reads this field to decode.
    expect(attachment.content_type).toBe('image/jpeg');
    expect(attachment.filename).toBe('IMG_1071.jpg');
    expect(getLocalHouseLedger().homeProjectAttachments).toHaveLength(1);
  });

  it('normalises before sealing, so peers never pay for the camera original', async () => {
    const projectId = await createBlankProject('Kitchen');

    await localHomeProjectsApi.uploadSelectionPhoto(
      householdId,
      projectId,
      'file:///dcim/IMG_2000.heic',
    );

    // Order is the point: the manipulator runs on the picked URI, and the blob
    // channel only ever sees the normalised one.
    expect(mockNormalize).toHaveBeenCalledWith('file:///dcim/IMG_2000.heic');
    expect(mockUploadHouseBlob).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceUri: 'file:///tmp/normalized.jpg',
        mime: 'image/jpeg',
      }),
    );
  });

  it('carries the photo and its event to a peer in one delta', async () => {
    const projectId = await createBlankProject('Bathroom');
    const before = captureLedgerSnapshot(getLocalHouseLedger());

    await localHomeProjectsApi.uploadSelectionPhoto(
      householdId,
      projectId,
      'file:///dcim/IMG_3000.jpg',
      undefined,
      ['before'],
    );

    const deviceA = getLocalHouseLedger();
    const peer = emptyHouseLedger();
    applyLedgerDelta(peer, diffLedger(before, deviceA)!, stampAt(1));

    // A member on another device gets the row AND the descriptor, which is the
    // only thing that can turn the sealed bytes back into an image for them.
    expect(peer.homeProjectAttachments).toHaveLength(1);
    expect(peer.homeProjectAttachments[0]!.blob).toEqual(DESCRIPTOR);
    // JSON, exactly as the Worker encodes it — the hub reads this with
    // JSON.parse, so a comma-joined string renders as "untagged".
    expect(peer.homeProjectAttachments[0]!.tags).toBe('["before"]');
    expect(
      peer.homeProjectActivity.some(row => row.action === 'attachment_added'),
    ).toBe(true);
  });

  it('mints a pending row first, then flips it to ready when the bytes land', async () => {
    const projectId = await createBlankProject('Deck');

    const created = await localHomeProjectsApi.createAttachmentUpload(
      householdId,
      projectId,
      {
        filename: 'permit.pdf',
        file_size: 12_000,
        content_type: 'application/pdf',
        kind: 'file',
      },
    );

    expect(created.attachment.status).toBe('pending_upload');
    // No fabricated address: on a ledger there is no object to PUT to.
    expect(created.upload_url).toBe('');
  });
});

// The three photo methods used to head this list. They are ledger operations
// now — they seal through `uploadHouseBlob` and write a `home_project_attachments`
// row — so they are covered by "project photos are local-first" above instead.
//
// The H13 D-wave took three more off it. `putManualGeometry`,
// `putRoomPlanGeometry` and `cancelGeometry` are ledger writes now that
// `home_project_geometry` is registered — a manual layout is the member drawing
// it, and RoomPlan runs on the DEVICE, so neither was ever waiting on a server
// model. `enqueueAiSchematic` stays, because that one genuinely is a queue and a
// model.
//
// `suggestAiScope` came off it by being DELETED from both backends rather than
// implemented. It wrote selections a member never typed — "Tile / flooring (AI
// suggestion)" — and the product rule is now that nothing writes a material but
// a member. A gap that no longer exists needs no copy.
//
// `generateSurfacePreview` replaced it: a photoreal render genuinely is a model,
// an entitlement and a bucket, and everything a member plans and orders with is
// computed on the device from the room document.
describe('importing a material from a shop link', () => {
  const URL =
    'https://capitaltiles.ca/products/hex-joy-9x10-matte-finish-porcelain-tile?_pos=13';

  const PAGE = `<html><head>
    <meta property="og:title" content="Hex Joy 9x10 Matte Finish Porcelain Tile">
    <meta property="og:image" content="https://capitaltiles.ca/cdn/hex.jpg">
    <meta property="product:price:amount" content="6.49">
    <script type="application/ld+json">{"@type":"Product","name":"Hex Joy","offers":{"price":"6.49"}}</script>
  </head><body>Coverage: 10.76 sq ft per box.</body></html>`;

  /**
   * A stand-in for the BYOK client. `generate` is generic on the real port, so
   * the fakes are widened once here rather than at four call sites.
   */
  const port = (
    hasKey: boolean,
    generate: (request: unknown) => Promise<unknown> = async () => ({}),
  ): HouseByokPort => ({
    hasKey: async () => hasKey,
    generate: generate as HouseByokPort['generate'],
  });

  const NO_KEY = port(false);

  /** Serve `PAGE` for any https GET, so the page rung has something to read. */
  function stubPage(html: string | null) {
    return jest
      .spyOn(global, 'fetch')
      .mockImplementation(async (input: RequestInfo | URL) => {
        if (html === null) throw new Error('network down');
        return {
          ok: true,
          status: 200,
          url: String(input),
          headers: { get: () => 'text/html; charset=utf-8' },
          text: async () => html,
        } as unknown as Response;
      });
  }

  afterEach(() => jest.restoreAllMocks());

  it('reads the page and takes the price the shop publishes', async () => {
    const projectId = await createBlankProject();
    stubPage(PAGE);

    const { selection, extraction } = await localHomeProjectsApi.createFromLink(
      householdId,
      projectId,
      URL,
      undefined,
      NO_KEY,
    );

    // The whole point of fetching: "No price · link" was the bug.
    expect(selection.unit_price_cents).toBe(649);
    expect(selection.image_url).toBe('https://capitaltiles.ca/cdn/hex.jpg');
    expect(selection.name).toBe('Hex Joy 9x10 Matte Finish Porcelain Tile');
    expect(extraction.source).toBe('link_og');
  });

  /** A priced material is a budget line — that is what the member came for. */
  it('puts the price in the budget', async () => {
    const projectId = await createBlankProject();
    stubPage(PAGE);
    await localHomeProjectsApi.createFromLink(
      householdId,
      projectId,
      URL,
      undefined,
      NO_KEY,
    );
    const hub = await localHomeProjectsApi.getHub(householdId, projectId);
    expect(hub.rollups.estimate_total).toBe(649);
  });

  it('falls back to the URL when the shop cannot be reached', async () => {
    const projectId = await createBlankProject();
    stubPage(null);

    const { selection, extraction } = await localHomeProjectsApi.createFromLink(
      householdId,
      projectId,
      URL,
      undefined,
      NO_KEY,
    );

    expect(selection.name).toBe('Hex Joy 9x10 Matte Finish Porcelain Tile');
    expect(selection.unit_price_cents).toBeNull();
    expect(extraction.source).toBe('link_url');
    expect(extraction.error).toBeDefined();
  });

  it("sends the page to the member's own provider and takes the coverage", async () => {
    const projectId = await createBlankProject();
    stubPage(PAGE);
    const generate = jest.fn(async (_request: unknown) => ({
      name: 'Hex Joy 9x10 Matte Porcelain',
      brand: 'Capital',
      vendor: 'capitaltiles.ca',
      sku: 'HJ-910',
      price_amount: 74.99,
      price_currency: 'CAD',
      price_basis: 'box',
      coverage_per_unit: 10.76,
      coverage_unit: 'sqft',
      image_url: null,
      category: 'tile',
      specs: [{ label: 'Finish', value: 'Matte' }],
      confidence: 'high',
    }));

    const { selection, extraction } = await localHomeProjectsApi.createFromLink(
      householdId,
      projectId,
      URL,
      undefined,
      port(true, generate),
    );

    expect(extraction.source).toBe('link_ai');
    expect(extraction.confidence).toBe('high');
    // Coverage is what makes two boxes comparable, and only the page states it.
    expect(selection.coverage_per_unit).toBe(10.76);
    expect(selection.coverage_unit).toBe('sqft');
    expect(selection.unit).toBe('box');
    expect(selection.unit_price_cents).toBe(7499);
    expect(selection.brand).toBe('Capital');

    // The page reaches the model; the ledger does not.
    const request = generate.mock.calls[0]![0] as HouseByokRequest;
    expect(request.userPrompt).toContain('capitaltiles.ca');
    expect(request.userPrompt).toContain('Coverage: 10.76 sq ft per box.');
    expect(request.context.rowCount).toBe(0);
    expect(request.context.tables).toEqual({});
  });

  /** A provider having a bad day costs polish, never the row or the price. */
  it('keeps the page reading when the provider fails', async () => {
    const projectId = await createBlankProject();
    stubPage(PAGE);

    const { selection, extraction } = await localHomeProjectsApi.createFromLink(
      householdId,
      projectId,
      URL,
      undefined,
      port(true, async () => {
        throw new Error('provider down');
      }),
    );

    expect(selection.unit_price_cents).toBe(649);
    expect(extraction.source).toBe('link_og');
    expect(extraction.error).toBe('provider down');
  });

  /**
   * The silence that made this look broken: a page read, a photo, a name, no
   * price, and nothing on screen saying the rung that finds prices never ran.
   * The screen offers "Add AI provider" off this flag, so it has to be set.
   */
  it('says a key is what is missing when there is no key', async () => {
    const projectId = await createBlankProject();
    stubPage(PAGE);

    const { extraction } = await localHomeProjectsApi.createFromLink(
      householdId,
      projectId,
      URL,
      undefined,
      NO_KEY,
    );

    expect(extraction.source).toBe('link_og');
    expect(extraction.needsAiProvider).toBe(true);
  });

  /** A key that IS present and simply failed is not a "connect a provider" case. */
  it('does not blame a missing key when the provider answered badly', async () => {
    const projectId = await createBlankProject();
    stubPage(PAGE);

    const { extraction } = await localHomeProjectsApi.createFromLink(
      householdId,
      projectId,
      URL,
      undefined,
      port(true, async () => {
        throw new Error('provider down');
      }),
    );

    expect(extraction.needsAiProvider).toBeUndefined();
    expect(extraction.error).toBe('provider down');
  });

  /**
   * Asking a model to describe a page it was not given is how a confident,
   * invented listing gets into a budget.
   */
  it('does not ask the model anything when there is no page to read', async () => {
    const projectId = await createBlankProject();
    stubPage(null);
    const generate = jest.fn(async (_request: unknown) => ({}));

    const { extraction } = await localHomeProjectsApi.createFromLink(
      householdId,
      projectId,
      URL,
      undefined,
      port(true, generate),
    );

    expect(generate).not.toHaveBeenCalled();
    expect(extraction.source).toBe('link_url');
  });
});

describe('the gaps are throws, not silence', () => {
  const thrown: [string, () => Promise<unknown>][] = [
    ['enqueueAiSchematic', () => localHomeProjectsApi.enqueueAiSchematic()],
    [
      'generateSurfacePreview',
      () => localHomeProjectsApi.generateSurfacePreview(),
    ],
    ['downloadExportPdf', () => localHomeProjectsApi.downloadExportPdf()],
    // `listTasks` / `linkTask` / `createTask` USED TO STAND HERE. Migration
    // 0170 moved the link onto the project row, so they are local writes now
    // and are covered in "a project holds its own jobs" below.
  ];

  it.each(thrown)(
    '%s raises rather than resolving empty',
    async (_name, call) => {
      // Resolving `{ tasks: [] }` or `{ geometry: null }` is the §6 failure the
      // Proxy exists to prevent: the screen renders empty AND correct.
      await expect(call()).rejects.toThrow(HouseLocalUnsupportedError);
    },
  );

  it('carries member-facing copy rather than the identifier', async () => {
    await localHomeProjectsApi
      .downloadExportPdf()
      .catch((error: HouseLocalUnsupportedError) => {
        expect(error.message).not.toContain('homeProjectsApi');
        expect(error.method).toBe('homeProjectsApi.downloadExportPdf');
      });
  });

  it('sends a member to a provider key only where a key is what is missing', async () => {
    // The AI schematic is genuinely turned on by a provider key, so its copy
    // says so and routes there. This assertion used to have a counterpart: the
    // three linked-task methods, which a key could never fix because the
    // blocker was a join table with no primary key. Migration 0170 removed
    // that blocker instead of writing better copy for it, which is why the
    // counterpart is gone rather than reworded.
    const geometry = await localHomeProjectsApi
      .enqueueAiSchematic()
      .catch((e: HouseLocalUnsupportedError) => e);
    expect(geometry.title.toLowerCase()).toContain('ai provider');
    expect(geometry.needsAiProvider).toBe(true);
  });
});

/**
 * The S2 refusal, closed.
 *
 * `home_project_tasks` had no primary key, so the ledger could not hold the
 * link and all three of these threw — the only place in H11 where a member lost
 * a feature to a schema decision. Migration 0170 put the link on the parent as
 * `home_projects.linked_task_ids` and these became ordinary local writes.
 */
describe('a project holds its own jobs', () => {
  const linkedIds = async (projectId: string): Promise<string[]> => {
    const { projects } = await localHomeProjectsApi.list(householdId);
    const row = projects.find(p => p.id === projectId);
    return JSON.parse(row?.linked_task_ids ?? '[]') as string[];
  };

  it('creates a job from inside the project and attaches it', async () => {
    const projectId = await createBlankProject('Shed');

    const { link } = await localHomeProjectsApi.createTask(
      householdId,
      projectId,
      { title: 'Confirm shed circuit capacity' },
    );

    expect(link.project_id).toBe(projectId);
    expect(link.title).toBe('Confirm shed circuit capacity');
    // The row is a REAL household task, reachable from the home screen — which
    // is the whole point of linking rather than inventing a project-only list.
    const { tasks } = await localTasksApi.list(householdId);
    expect(tasks.map(t => t.id)).toContain(link.task_id);
    expect(await linkedIds(projectId)).toEqual([link.task_id]);
  });

  it('names the project in the description when the caller gives none', async () => {
    // `createTaskFromProject`'s fallback, reproduced word for word: a member
    // reading the task a week later gets the same sentence on either backend.
    const projectId = await createBlankProject('Ensuite');
    const { link } = await localHomeProjectsApi.createTask(
      householdId,
      projectId,
      { title: 'Order the vanity' },
    );

    const { tasks } = await localTasksApi.list(householdId);
    const task = tasks.find(t => t.id === link.task_id);
    expect(task?.description).toBe('From home project \u201cEnsuite\u201d.');
  });

  it('lists what is attached, in the order it was attached', async () => {
    const projectId = await createBlankProject('Kitchen');
    const first = await localHomeProjectsApi.createTask(householdId, projectId, {
      title: 'Measure the run',
    });
    const second = await localHomeProjectsApi.createTask(householdId, projectId, {
      title: 'Book the plumber',
    });

    const { tasks } = await localHomeProjectsApi.listTasks(householdId, projectId);
    expect(tasks.map(t => t.title)).toEqual(['Measure the run', 'Book the plumber']);
    expect(tasks.map(t => t.task_id)).toEqual([
      first.link.task_id,
      second.link.task_id,
    ]);
  });

  it('is idempotent — linking the same job twice attaches it once', async () => {
    const projectId = await createBlankProject('Loft');
    const { task } = await localTasksApi.create(householdId, {
      title: 'Clear the loft hatch',
      frequency: 'one_time',
    });

    await localHomeProjectsApi.linkTask(householdId, projectId, task.id);
    await localHomeProjectsApi.linkTask(householdId, projectId, task.id);

    expect(await linkedIds(projectId)).toEqual([task.id]);
    const { tasks } = await localHomeProjectsApi.listTasks(householdId, projectId);
    expect(tasks).toHaveLength(1);
  });

  it('refuses a job from another household before it writes anything', async () => {
    // The Worker checks this first (`home-projects-service.ts`), and the guard
    // has to stand here too: a link made offline against an id no backend can
    // resolve would converge into the household as a dangling pointer.
    const projectId = await createBlankProject('Garage');

    await expect(
      localHomeProjectsApi.linkTask(householdId, projectId, 'task_from_nowhere'),
    ).rejects.toThrow('Task not found');
    expect(await linkedIds(projectId)).toEqual([]);
  });

  it('skips a job the member has since deleted rather than reporting a blank row', async () => {
    // The join table had no foreign key to `tasks` either, so a dangling id was
    // always the normal case on this read — reproduced rather than "fixed",
    // because the Worker still behaves this way.
    const projectId = await createBlankProject('Deck');
    const kept = await localHomeProjectsApi.createTask(householdId, projectId, {
      title: 'Order the boards',
    });
    const removed = await localHomeProjectsApi.createTask(householdId, projectId, {
      title: 'Hire the sander',
    });
    await localTasksApi.delete(householdId, removed.link.task_id);

    const { tasks } = await localHomeProjectsApi.listTasks(householdId, projectId);
    expect(tasks.map(t => t.task_id)).toEqual([kept.link.task_id]);
    // The LINK is left in place: the member deleted a task, not a decision
    // about which project it belonged to, and the Worker does not prune either.
    expect(await linkedIds(projectId)).toHaveLength(2);
  });
});

describe('a project cover is a pointer, not a copy', () => {
  const DESCRIPTOR = {
    blobId: 'blob_hp_cover',
    mime: 'image/jpeg',
    bytes: 302_118,
    sha256: 'c'.repeat(64),
    chunkCount: 2,
    keyEpoch: 1,
  };

  beforeEach(() => {
    mockNormalize.mockReset();
    mockUploadHouseBlob.mockReset();
    mockNormalize.mockResolvedValue({
      uri: 'file:///tmp/normalized.jpg',
      mime: 'image/jpeg',
      width: 2048,
      height: 1536,
      resized: true,
    });
    mockUploadHouseBlob.mockResolvedValue(DESCRIPTOR);
  });

  it('carries the sealed descriptor on list, because a URL would render nothing here', async () => {
    const projectId = await createBlankProject('Ensuite');
    const attachment = await localHomeProjectsApi.uploadSelectionPhoto(
      householdId,
      projectId,
      'file:///dcim/IMG_2000.heic',
    );
    await localHomeProjectsApi.update(householdId, projectId, {
      coverAttachmentId: attachment.id,
    });

    const { projects } = await localHomeProjectsApi.list(householdId);
    const row = projects.find(p => p.id === projectId);

    expect(row?.cover_attachment_id).toBe(attachment.id);
    expect(row?.cover_blob).toEqual(DESCRIPTOR);
    // `cover_url` is the Worker's channel and has no meaning on this backend —
    // a card that preferred it would show an empty tile over a real photo.
    expect(row?.cover_url).toBeNull();
  });

  it('clears the pointer without touching the photo it pointed at', async () => {
    const projectId = await createBlankProject('Kitchen');
    const attachment = await localHomeProjectsApi.uploadSelectionPhoto(
      householdId,
      projectId,
      'file:///dcim/IMG_2001.heic',
    );
    await localHomeProjectsApi.update(householdId, projectId, {
      coverAttachmentId: attachment.id,
    });

    await localHomeProjectsApi.update(householdId, projectId, {
      coverAttachmentId: null,
    });

    const { projects } = await localHomeProjectsApi.list(householdId);
    const row = projects.find(p => p.id === projectId);
    expect(row?.cover_attachment_id).toBeNull();
    expect(row?.cover_blob).toBeNull();
    // Removing a cover chooses a different thumbnail; it does not destroy the
    // photo, which stays in the hub's list.
    expect(getLocalHouseLedger().homeProjectAttachments).toHaveLength(1);
  });

  it("refuses another project's attachment, as the Worker does", async () => {
    const mine = await createBlankProject('Ensuite');
    const theirs = await createBlankProject('Garage');
    const attachment = await localHomeProjectsApi.uploadSelectionPhoto(
      householdId,
      theirs,
      'file:///dcim/IMG_2002.heic',
    );

    await expect(
      localHomeProjectsApi.update(householdId, mine, {
        coverAttachmentId: attachment.id,
      }),
    ).rejects.toThrow(/cover attachment not found/i);
  });

  it('leaves the cover alone when the patch does not mention it', async () => {
    const projectId = await createBlankProject('Ensuite');
    const attachment = await localHomeProjectsApi.uploadSelectionPhoto(
      householdId,
      projectId,
      'file:///dcim/IMG_2003.heic',
    );
    await localHomeProjectsApi.update(householdId, projectId, {
      coverAttachmentId: attachment.id,
    });

    await localHomeProjectsApi.update(householdId, projectId, {
      title: 'Ensuite phase 2',
    });

    const { projects } = await localHomeProjectsApi.list(householdId);
    const row = projects.find(p => p.id === projectId);
    expect(row?.title).toBe('Ensuite phase 2');
    expect(row?.cover_attachment_id).toBe(attachment.id);
  });
});

// ---------------------------------------------------------------------------
// Drafts and per-project roles (migration 0163)
//
// The stake is higher on this backend than on the Worker, and that is what
// these tests are really about. A Worker can simply not SELECT another member's
// draft; a ledger REPLICATES the household, so every peer's device physically
// holds the row. The facade's read predicate is the only thing between a private
// plan and the wrong reader, and the facade's write gate is the only thing
// between a `viewer` and an edit that would converge onto everyone.
// ---------------------------------------------------------------------------

describe('drafts are private to their creator', () => {
  /**
   * Someone else's project, written straight into the ledger.
   *
   * Seeded rather than created through the facade because `create` stamps
   * `created_by` with THIS device's member id — which is exactly the field under
   * test. A row belonging to a peer is what arrives through sync, so this is the
   * shape the predicate has to survive.
   */
  function seedPeerProject(id: string, visibility: 'draft' | 'published') {
    const now = '2026-08-20T10:00:00.000Z';
    getLocalHouseLedger().homeProjects.push({
      id,
      household_id: householdId,
      title: `Peer ${visibility}`,
      type: 'renovation',
      template_key: null,
      status: 'planning',
      visibility,
      default_role: 'owner',
      access_json: null,
      summary: null,
      goals: null,
      constraints: null,
      target_budget_cents: null,
      currency: 'USD',
      contingency_pct: 15,
      target_start_at: null,
      target_end_at: null,
      cover_attachment_id: null,
      created_by: 'user-someone-else',
      updated_by: 'user-someone-else',
      created_at: now,
      updated_at: now,
    });
  }

  it('defaults a new project to published, so nothing existing changes', async () => {
    const projectId = await createBlankProject('Ensuite');
    const { projects } = await localHomeProjectsApi.list(householdId);
    expect(projects.find(p => p.id === projectId)?.visibility).toBe(
      'published',
    );
  });

  it('creates a draft when the wizard asks for one', async () => {
    const { project } = await localHomeProjectsApi.create(householdId, {
      title: 'Quiet plan',
      templateKey: 'blank',
      visibility: 'draft',
    });
    expect(project.visibility).toBe('draft');
    // …and its own creator still sees it, which is the point of a draft.
    const { projects } = await localHomeProjectsApi.list(householdId);
    expect(projects.map(p => p.id)).toContain(project.id);
  });

  it('hides a PEER’s draft from the list while showing their published project', async () => {
    seedPeerProject('hpj-peer-draft', 'draft');
    seedPeerProject('hpj-peer-open', 'published');

    const { projects } = await localHomeProjectsApi.list(householdId);
    const ids = projects.map(p => p.id);
    expect(ids).toContain('hpj-peer-open');
    expect(ids).not.toContain('hpj-peer-draft');
  });

  it('answers "not found" — never "forbidden" — for a peer’s draft', async () => {
    // Deliberate: "you may not open this" would tell a member the project
    // exists, and a draft's whole job is not to say so. Same answer a project id
    // from another household gets, so the two are indistinguishable.
    seedPeerProject('hpj-peer-draft', 'draft');
    await expect(
      localHomeProjectsApi.getHub(householdId, 'hpj-peer-draft'),
    ).rejects.toThrow(/not found/i);
    await expect(
      localHomeProjectsApi.listActivity(householdId, 'hpj-peer-draft'),
    ).rejects.toThrow(/not found/i);
  });

  it('publishes and un-publishes, recording each as its OWN activity event', async () => {
    // Not `project_updated`: the feed is the only record a household has of when
    // a plan stopped being one person's private draft.
    const { project } = await localHomeProjectsApi.create(householdId, {
      title: 'Quiet plan',
      templateKey: 'blank',
      visibility: 'draft',
    });

    await localHomeProjectsApi.update(householdId, project.id, {
      visibility: 'published',
    });
    await localHomeProjectsApi.update(householdId, project.id, {
      visibility: 'draft',
    });

    const { items } = await localHomeProjectsApi.listActivity(
      householdId,
      project.id,
    );
    const actions = items.map(i => i.action);
    expect(actions).toContain('project_published');
    expect(actions).toContain('project_unpublished');
  });
});

describe('per-project roles gate every local write', () => {
  /** Make THIS device a `viewer` on a project it did not create. */
  function seedViewerProject(id = 'hpj-view-only') {
    const now = '2026-08-20T10:00:00.000Z';
    getLocalHouseLedger().homeProjects.push({
      id,
      household_id: householdId,
      title: 'Their kitchen',
      type: 'renovation',
      template_key: null,
      status: 'planning',
      visibility: 'published',
      default_role: 'viewer',
      access_json: null,
      summary: null,
      goals: null,
      constraints: null,
      target_budget_cents: null,
      currency: 'USD',
      contingency_pct: 15,
      target_start_at: null,
      target_end_at: null,
      cover_attachment_id: null,
      created_by: 'user-someone-else',
      updated_by: 'user-someone-else',
      created_at: now,
      updated_at: now,
    });
    return id;
  }

  it('lets a viewer READ the hub and the activity feed', async () => {
    const id = seedViewerProject();
    const hub = await localHomeProjectsApi.getHub(householdId, id);
    expect(hub.project.id).toBe(id);
    expect(hub.my_role).toBe('viewer');
    await expect(
      localHomeProjectsApi.listActivity(householdId, id),
    ).resolves.toBeTruthy();
  });

  it('refuses every write with a 403-shaped error the screens already read', async () => {
    const id = seedViewerProject();
    const before = opCount();

    await expect(
      localHomeProjectsApi.update(householdId, id, { title: 'Renamed' }),
    ).rejects.toMatchObject({ isAxiosError: true, response: { status: 403 } });
    await expect(
      localHomeProjectsApi.createSelection(householdId, id, { name: 'Tile' }),
    ).rejects.toMatchObject({ response: { status: 403 } });
    await expect(
      localHomeProjectsApi.createPhase(householdId, id, { title: 'Demo' }),
    ).rejects.toMatchObject({ response: { status: 403 } });
    await expect(
      localHomeProjectsApi.addComment(householdId, id, { body: 'Looks good' }),
    ).rejects.toMatchObject({ response: { status: 403 } });
    await expect(
      localHomeProjectsApi.remove(householdId, id),
    ).rejects.toMatchObject({
      response: { status: 403 },
    });

    // The half that actually matters: a refused write must leave NO op behind.
    // An op would sync, and there is no Worker in the path to refuse it there.
    expect(opCount()).toBe(before);
    expect(getLocalHouseLedger().homeProjects.some(p => p.id === id)).toBe(
      true,
    );
  });

  it('keeps the creator an owner against a viewer default and a viewer grant', async () => {
    const projectId = await createBlankProject('Mine');
    await localHomeProjectsApi.setAccess(householdId, projectId, {
      defaultRole: 'viewer',
      grants: [{ user_id: USER, role: 'viewer' }],
    });

    const hub = await localHomeProjectsApi.getHub(householdId, projectId);
    expect(hub.my_role).toBe('owner');
    // …and the pointless self-grant is not stored, so it cannot read on the next
    // open like a rule being ignored.
    expect(hub.project.access_json).toBeNull();
    await expect(
      localHomeProjectsApi.update(householdId, projectId, {
        title: 'Still mine',
      }),
    ).resolves.toBeTruthy();
  });

  it('stores an explicit grant and reports it back with its source', async () => {
    const projectId = await createBlankProject('Shared');
    const access = await localHomeProjectsApi.setAccess(
      householdId,
      projectId,
      {
        defaultRole: 'viewer',
        grants: [{ user_id: 'user-peer', role: 'owner' }],
      },
    );

    expect(access.default_role).toBe('viewer');
    expect(access.my_role).toBe('owner');
    const stored = getLocalHouseLedger().homeProjects.find(
      p => p.id === projectId,
    );
    expect(JSON.parse(stored!.access_json!)).toEqual([
      { user_id: 'user-peer', role: 'owner' },
    ]);
    // The roster is control-plane state; in a bare session it is this device
    // alone, and the sheet renders that rather than an empty household.
    expect(access.members.every(m => typeof m.user_id === 'string')).toBe(true);
  });

  it('records an access change on the activity feed', async () => {
    const projectId = await createBlankProject('Shared');
    await localHomeProjectsApi.setAccess(householdId, projectId, {
      defaultRole: 'viewer',
      grants: [],
    });
    const { items } = await localHomeProjectsApi.listActivity(
      householdId,
      projectId,
    );
    expect(items.map(i => i.action)).toContain('project_access_changed');
  });
});

describe('remove deletes the project and every ledgered child in ONE op', () => {
  it('leaves no orphan behind, in a single op a peer applies whole', async () => {
    // The B2 bug this list exists to prevent: an orphan syncs to every peer and
    // is never read, and a ledger has no foreign key to complain to.
    const { project } = await localHomeProjectsApi.create(householdId, {
      title: 'Bathroom',
      templateKey: 'bathroom_reno',
    });
    await localHomeProjectsApi.createSelection(householdId, project.id, {
      name: 'Vanity',
      unitPriceCents: 80_000,
    });
    await localHomeProjectsApi.createBlocker(householdId, project.id, {
      title: 'Permit',
    });
    await localHomeProjectsApi.addComment(householdId, project.id, {
      body: 'Start in May',
    });
    seedMilestone('hpm-doomed', project.id);
    seedAttachment('hpatt-doomed', project.id);

    // A survivor, to prove the delete is scoped to one project rather than to
    // the table.
    const survivor = await createBlankProject('Ensuite');
    await localHomeProjectsApi.createSelection(householdId, survivor, {
      name: 'Paint',
    });

    const before = opCount();
    await localHomeProjectsApi.remove(householdId, project.id);
    expect(opCount()).toBe(before + 1);

    const ledger = getLocalHouseLedger();
    expect(ledger.homeProjects.some(p => p.id === project.id)).toBe(false);
    for (const table of HOME_PROJECT_CHILD_TABLES) {
      const rows = ledger[table] as unknown as Array<{ project_id: string }>;
      expect(rows.filter(r => r.project_id === project.id)).toEqual([]);
    }

    // The survivor and its child are untouched.
    expect(ledger.homeProjects.some(p => p.id === survivor)).toBe(true);
    expect(
      ledger.homeProjectSelections.filter(s => s.project_id === survivor),
    ).toHaveLength(1);
  });

  it('carries the whole removal to a peer in one delta', async () => {
    // Half-applying it would leave a peer holding budget lines belonging to a
    // project that no longer exists — how a "total spent" figure outlives the
    // renovation it paid for. So the peer is first brought up to date, then
    // handed the delete as ONE delta, and has to end with nothing of it.
    const { project } = await localHomeProjectsApi.create(householdId, {
      title: 'Bathroom',
      templateKey: 'bathroom_reno',
    });

    const peer = emptyHouseLedger();
    const empty = captureLedgerSnapshot(emptyHouseLedger());
    applyLedgerDelta(
      peer,
      diffLedger(empty, getLocalHouseLedger())!,
      stampAt(10, 'member-a', 'op-seed'),
    );
    expect(peer.homeProjects.some(p => p.id === project.id)).toBe(true);
    expect(
      peer.homeProjectPhases.filter(p => p.project_id === project.id).length,
    ).toBeGreaterThan(0);

    const beforeDelete = captureLedgerSnapshot(getLocalHouseLedger());
    await localHomeProjectsApi.remove(householdId, project.id);
    applyLedgerDelta(
      peer,
      diffLedger(beforeDelete, getLocalHouseLedger())!,
      stampAt(20, 'member-a', 'op-delete'),
    );

    expect(peer.homeProjects.some(p => p.id === project.id)).toBe(false);
    expect(
      peer.homeProjectPhases.filter(p => p.project_id === project.id),
    ).toEqual([]);
    expect(
      peer.homeProjectSelections.filter(s => s.project_id === project.id),
    ).toEqual([]);
    expect(
      peer.homeProjectBudgetLines.filter(b => b.project_id === project.id),
    ).toEqual([]);
  });

  it('raises for a project that is not there', async () => {
    await expect(
      localHomeProjectsApi.remove(householdId, 'hpj-missing'),
    ).rejects.toThrow(/not found/i);
  });
});
