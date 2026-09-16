import {
  canEditHomeProject,
  canViewHomeProject,
  effectiveHomeProjectRole,
  normalizeHomeProjectRole,
  normalizeHomeProjectVisibility,
  parseHomeProjectAccessGrants,
  serializeHomeProjectAccessGrants,
  parseHomeProjectLinkedTaskIds,
  serializeHomeProjectLinkedTaskIds,
  withHomeProjectLinkedTask,
  type HomeProjectAccessGrant,
  type HomeProjectAccessMember,
  type HomeProjectAccessView,
  type HomeProjectRole,
  type SurfaceScaleBrief,
  asIsElementSchema,
  asIsStateSchema,
  smartProjectRequestSchema,
  MANUAL_SOURCE,
  type SmartProjectRequest,
  type SmartProjectSpaceDimensions,
} from '@symply/contracts';
import { and, asc, desc, eq, inArray, isNull, like, ne, sql } from 'drizzle-orm';
import { drizzle, DrizzleD1Database } from 'drizzle-orm/d1';

import { generateStructuredWithFallback } from '../ai/fallback';
import {
  EXTRACT_MATERIAL_LISTING_SCHEMA,
  EXTRACT_MATERIAL_LISTING_SYSTEM_PROMPT,
  buildExtractMaterialListingUserPrompt,
  type RawMaterialListing,
} from '../ai/prompts/extract-material-listing';
import type { AIProvider } from '../ai/provider';
import {
  createProviderAdapter,
  imageCapableProviderFor,
} from '../ai/provider-factory';
import { householdMembers, users } from '../db/schema';
import {
  homeProjects,
  homeProjectSpaces,
  homeProjectBudgetLines,
  homeProjectOptionGroups,
  homeProjectSelections,
  homeProjectPhases,
  homeProjectMilestones,
  homeProjectBlockers,
  homeProjectAttachments,
  homeProjectPlanLinks,
  homeProjectGeometry,
  homeProjectComments,
  homeProjectActivity,
  homeProjectContractors,
  homeProjectAsIs,
  homeProjectSmartDrafts,
  type HomeProjectAsIs,
  type HomeProjectSmartDraft,
  type HomeProject,
  type HomeProjectSelection,
  type HomeProjectOptionGroup,
  type HomeProjectBudgetLine,
  type HomeProjectPhase,
  type HomeProjectMilestone,
  type HomeProjectBlocker,
  type HomeProjectAttachment,
  type HomeProjectPlanLink,
  type HomeProjectGeometry,
  type HomeProjectComment,
  type HomeProjectActivityRow,
} from '../db/schema-home-projects';
import type { Env } from '../types';
import { generateSurfacePreview } from './home-projects/surface-preview';
import {
  generateSmartProjectPlan,
  type SmartProjectPlan,
} from './ai/smart-project-generator';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../utils/errors';
import { generateId, nowIso } from '../utils/id';
import {
  absoluteImageUrl,
  compactRecord,
  mergeListingIntoDraft,
  parsePriceToCents,
  type SelectionDraft,
  type SmartProjectInclude,
} from '@symply/contracts';
import {
  extractReadableText,
  parseJsonLd,
  parseOpenGraph,
  safeFetchImage,
  safeFetchUrl,
} from '../utils/safe-fetch-url';
import { buildSimplePdf } from '../utils/simple-pdf';

import {
  resolveProviderApiKey,
  hasUsableProviderKey,
} from './ai-credential-resolver';
import { usageRecorderFor } from './ai-usage-service';
import { budgetEstimateCents } from './home-projects/pricing';
import {
  getTemplate,
  HOME_PROJECT_TEMPLATES,
  type TemplateKey,
} from './home-projects/templates';
import { NotificationService } from './notification-service';
import { TaskService } from './task-service';

const HUB_CHILD_CAP = 200;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

/**
 * Narrower than `ALLOWED_CONTENT_TYPES` on purpose: no PDF.
 *
 * A smart-draft photo exists only to become an image block in the provider
 * call, and `loadPhotos` in the generator can build one from these three types
 * and nothing else. Accepting a PDF here would store it, bill the upload and
 * then drop it on the floor without telling anybody.
 */
const SMART_DRAFT_PHOTO_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export type BudgetHealth = 'ok' | 'watch' | 'over';

export interface BudgetRollups {
  estimate_total: number;
  actual_total: number;
  contingency_cents: number;
  target_budget_cents: number | null;
  budget_health: BudgetHealth;
}

export interface ProjectHub {
  project: HomeProject;
  /** The CALLER's effective role on this project — `owner` may write. */
  my_role: HomeProjectRole;
  space_ids: string[];
  rollups: BudgetRollups;
  selections: HomeProjectSelection[];
  option_groups: HomeProjectOptionGroup[];
  budget_lines: HomeProjectBudgetLine[];
  phases: HomeProjectPhase[];
  milestones: HomeProjectMilestone[];
  blockers: HomeProjectBlocker[];
  attachments: HomeProjectAttachment[];
  plan_links: HomeProjectPlanLink[];
  geometry: HomeProjectGeometry | null;
}

function computeRollups(
  project: HomeProject,
  lines: HomeProjectBudgetLine[],
): BudgetRollups {
  const estimateSubtotal = lines
    .filter(l => l.category !== 'contingency')
    .reduce((s, l) => s + (l.estimate_cents || 0), 0);
  const contingencyLine = lines.find(l => l.category === 'contingency');
  // `?? 0`, never `|| 15`. The `||` treated a deliberate 0% as "unset" and put a
  // 15% buffer back on top of it, so a member who switched contingency off saw it
  // reappear on the next read. Contingency is opt-in now and 0 is its default, so
  // that fallback was also the common case.
  const contingencyCents =
    contingencyLine?.estimate_cents ??
    Math.round((estimateSubtotal * (project.contingency_pct ?? 0)) / 100);
  // Subtotal PLUS contingency, always. This used to be
  // `sum(every line) || estimateSubtotal + contingencyCents`, which agreed with
  // itself only while every template seeded an explicit contingency line. With
  // those seeds gone the `||` silently dropped the buffer out of the total the
  // moment any real figure was typed, so a project read $5,000 while its own
  // header showed $750 of contingency sitting on top of it.
  const estimateTotal = estimateSubtotal + contingencyCents;
  const actualTotal = lines.reduce((s, l) => s + (l.actual_cents || 0), 0);
  const target = project.target_budget_cents;
  let budget_health: BudgetHealth = 'ok';
  if (target != null && target > 0) {
    if (estimateTotal > target) budget_health = 'over';
    else if (estimateTotal > target * 0.9) budget_health = 'watch';
  }
  return {
    estimate_total: estimateTotal,
    actual_total: actualTotal,
    contingency_cents: contingencyCents,
    target_budget_cents: target,
    budget_health,
  };
}

/** One member-facing spec line on an option card. */
export interface MaterialSpec {
  label: string;
  value: string;
}

/** How a selection's fields were obtained, surfaced to the member on the card. */
export interface MaterialExtractionOutcome {
  source: 'manual' | 'link_og' | 'link_ai';
  confidence: string | null;
  error?: string;
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
     
  } catch {
    return null;
  }
}

/**
 * Shared with the device — see `@symply/contracts/link-extraction`. Re-exported
 * so the existing importers of this module do not have to move.
 */
export { parsePriceToCents, absoluteImageUrl };

/**
 * The link-import pipeline is shared with the device — one parser, one prompt,
 * one merge. See `@symply/contracts/material-listing-merge`.
 */
export { mergeListingIntoDraft };

export class HomeProjectsService {
  private db: DrizzleD1Database;
  private env: Env;
  private notifications: NotificationService;

  constructor(env: Env, d1: D1Database) {
    this.env = env;
    this.db = drizzle(d1);
    this.notifications = new NotificationService(env, d1);
  }

  private async checkHouseholdAccess(
    householdId: string,
    userId: string,
  ): Promise<void> {
    const member = await this.db
      .select()
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.household_id, householdId),
          eq(householdMembers.user_id, userId),
        ),
      )
      .get();
    if (!member) {
      throw new ForbiddenError('You do not have access to this household');
    }
  }

  private async getHouseholdMemberIds(householdId: string): Promise<string[]> {
    const members = await this.db
      .select({ user_id: householdMembers.user_id })
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.household_id, householdId),
          isNull(householdMembers.deleted_at),
        ),
      )
      .all();
    return members.map(m => m.user_id).filter(Boolean);
  }

  private async notifyHousehold(
    householdId: string,
    actorUserId: string,
    type: string,
    title: string,
    body: string,
    projectId: string,
    extraData?: Record<string, string>,
  ): Promise<void> {
    try {
      // A draft is private to its creator, so a push about it would announce a
      // project the recipient cannot open — and the deep link lands on a 404.
      // Checked here, once, rather than at each of the four call sites.
      const project = await this.getOwnedProject(householdId, projectId).catch(
        () => null,
      );
      if (
        project &&
        normalizeHomeProjectVisibility(project.visibility) === 'draft'
      )
        return;
      const memberIds = await this.getHouseholdMemberIds(householdId);
      await Promise.all(
        memberIds
          .filter(id => id !== actorUserId)
          .map(userId =>
            this.notifications
              .sendNotification({
                userId,
                type,
                title,
                body,
                data: {
                  type,
                  home_project_id: projectId,
                  projectId,
                  householdId,
                  screen: 'HomeProjectHub',
                  ...extraData,
                },
                referenceType: 'home_project',
                referenceId: projectId,
              })
              .catch(err => {
                console.error(`home_projects notify ${type} failed:`, err);
              }),
          ),
      );
    } catch (error) {
      console.error('home_projects notifyHousehold failed:', error);
    }
  }

  private async maybeNotifyBudgetOver(
    householdId: string,
    actorUserId: string,
    projectId: string,
  ): Promise<void> {
    const project = await this.getOwnedProject(householdId, projectId);
    const lines = await this.db
      .select()
      .from(homeProjectBudgetLines)
      .where(eq(homeProjectBudgetLines.project_id, projectId))
      .all();
    const rollups = computeRollups(project, lines);
    if (rollups.budget_health !== 'over') return;
    await this.notifyHousehold(
      householdId,
      actorUserId,
      'home_project_budget_over',
      'Home project over budget',
      `"${project.title}" estimate exceeds the target budget`,
      projectId,
    );
  }

  private async getOwnedProject(
    householdId: string,
    projectId: string,
  ): Promise<HomeProject> {
    const row = await this.db
      .select()
      .from(homeProjects)
      .where(
        and(
          eq(homeProjects.id, projectId),
          eq(homeProjects.household_id, householdId),
        ),
      )
      .get();
    if (!row) throw new NotFoundError('Home project');
    return row;
  }

  /**
   * The one gate every project-scoped method goes through (migration 0163).
   *
   * It replaces the `checkHouseholdAccess` + `getOwnedProject` pair that used to
   * open each method, and it answers three questions in the order they have to
   * be answered:
   *
   *  1. **Are you in this household at all?** Unchanged — `ForbiddenError`.
   *  2. **Does this project exist FOR YOU?** A draft belongs to its creator, and
   *     a non-creator gets `NotFoundError` rather than `ForbiddenError`. That is
   *     deliberate: "you may not open this" tells a member the project exists,
   *     which is precisely what a draft is not supposed to reveal. It is also
   *     already the answer for a project id from another household, so the two
   *     cases are indistinguishable from outside — which is the point.
   *  3. **May you change it?** `viewer` reads and nothing else, so a write is a
   *     `ForbiddenError` here. `manage` is the same check as `write` today (only
   *     an owner has either) but is a distinct argument so the access,
   *     visibility and delete paths read as what they are, and so tightening one
   *     later does not silently tighten the other.
   *
   * The role itself is resolved by `@symply/contracts`, shared verbatim with the
   * device ledger — a permission that differs by backend is a permission that
   * leaks.
   */
  private async requireProjectAccess(
    householdId: string,
    userId: string,
    projectId: string,
    need: 'read' | 'write' | 'manage',
  ): Promise<HomeProject> {
    await this.checkHouseholdAccess(householdId, userId);
    const project = await this.getOwnedProject(householdId, projectId);
    if (!canViewHomeProject(project, userId)) {
      throw new NotFoundError('Home project');
    }
    if (need !== 'read' && !canEditHomeProject(project, userId)) {
      throw new ForbiddenError(
        need === 'manage'
          ? 'Only a project owner can change who has access'
          : 'You have view-only access to this project',
      );
    }
    return project;
  }

  private async recordActivity(
    projectId: string,
    actorUserId: string,
    action: string,
    entityType?: string,
    entityId?: string,
    meta?: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<void> {
    if (idempotencyKey) {
      const existing = await this.db
        .select()
        .from(homeProjectActivity)
        .where(
          and(
            eq(homeProjectActivity.project_id, projectId),
            eq(homeProjectActivity.idempotency_key, idempotencyKey),
          ),
        )
        .get();
      if (existing) return;
    }
    await this.db.insert(homeProjectActivity).values({
      id: generateId(),
      project_id: projectId,
      actor_user_id: actorUserId,
      action,
      entity_type: entityType ?? null,
      entity_id: entityId ?? null,
      meta_json: meta ? JSON.stringify(meta) : null,
      idempotency_key: idempotencyKey ?? null,
      created_at: nowIso(),
    });
  }

  /**
   * The list card renders a cover photo, and `cover_attachment_id` alone cannot
   * feed an `<Image>` — the bytes live in `home_project_attachments.url`. Rather
   * than make the card fetch a hub per row (ten projects, ten composite queries,
   * each computing budget rollups nobody on the list looks at), the covers are
   * resolved here in ONE extra select over the ids actually present.
   *
   * `cover_url` is null whenever the id is dangling or the upload never reached
   * `ready`; the card falls back to its placeholder, which is the same thing it
   * shows for a project that never had a photo.
   */
  async listProjects(
    householdId: string,
    userId: string,
    filters?: { status?: string; type?: string; q?: string; spaceId?: string },
  ): Promise<
    Array<HomeProject & { cover_url: string | null; my_role: HomeProjectRole }>
  > {
    await this.checkHouseholdAccess(householdId, userId);
    const conditions = [eq(homeProjects.household_id, householdId)];
    if (filters?.status)
      conditions.push(eq(homeProjects.status, filters.status));
    else conditions.push(ne(homeProjects.status, 'archived'));
    if (filters?.type) conditions.push(eq(homeProjects.type, filters.type));
    if (filters?.q) conditions.push(like(homeProjects.title, `%${filters.q}%`));

    let rows = await this.db
      .select()
      .from(homeProjects)
      .where(and(...conditions))
      .orderBy(desc(homeProjects.updated_at))
      .all();

    // Drafts belong to the member who made them. Filtered in code rather than
    // in the WHERE clause because the predicate is "published OR mine", which
    // an index on `(household_id, visibility)` does not help with anyway, and
    // because the SAME expression has to run on the device ledger — one shared
    // `canViewHomeProject` is the only way those two stay identical.
    rows = rows.filter(row => canViewHomeProject(row, userId));

    if (filters?.spaceId) {
      const links = await this.db
        .select()
        .from(homeProjectSpaces)
        .where(eq(homeProjectSpaces.space_id, filters.spaceId))
        .all();
      const ids = new Set(links.map(l => l.project_id));
      rows = rows.filter(r => ids.has(r.id));
    }

    const coverIds = rows
      .map(r => r.cover_attachment_id)
      .filter((id): id is string => !!id);
    if (coverIds.length === 0) {
      return rows.map(r => ({
        ...r,
        cover_url: null,
        my_role: effectiveHomeProjectRole(r, userId),
      }));
    }
    const covers = await this.db
      .select()
      .from(homeProjectAttachments)
      .where(inArray(homeProjectAttachments.id, coverIds))
      .all();
    const urlById = new Map(
      covers.filter(a => a.status === 'ready').map(a => [a.id, a.url ?? null]),
    );
    return rows.map(r => ({
      ...r,
      cover_url: r.cover_attachment_id
        ? urlById.get(r.cover_attachment_id) ?? null
        : null,
      my_role: effectiveHomeProjectRole(r, userId),
    }));
  }

  async createProject(
    householdId: string,
    userId: string,
    input: {
      id?: string;
      title?: string;
      type?: string;
      templateKey?: string;
      summary?: string;
      goals?: string;
      constraints?: string;
      targetBudgetCents?: number;
      currency?: string;
      contingencyPct?: number;
      targetStartAt?: string;
      targetEndAt?: string;
      spaceIds?: string[];
      /** `'draft'` starts the project private to its creator. Default published. */
      visibility?: string;
    },
  ): Promise<HomeProject> {
    await this.checkHouseholdAccess(householdId, userId);
    const projectId = input.id || generateId();

    if (input.id) {
      const existing = await this.db
        .select()
        .from(homeProjects)
        .where(eq(homeProjects.id, projectId))
        .get();
      if (existing) {
        if (existing.household_id !== householdId) {
          throw new ConflictError('Project id already exists');
        }
        return existing;
      }
    }

    const template = getTemplate(input.templateKey);
    const now = nowIso();
    const title = input.title?.trim() || template?.title || 'New home project';
    const type = input.type || template?.type || 'renovation';
    // 0, not 15: a project the app has never seen priced does not get a buffer
    // invented for it. Templates all seed 0 too, so this last fallback only fires
    // for a project created with no template at all — and it must agree with them.
    const contingencyPct =
      input.contingencyPct ?? template?.contingencyPct ?? 0;

    await this.db.insert(homeProjects).values({
      id: projectId,
      household_id: householdId,
      title,
      type,
      template_key: template?.key ?? input.templateKey ?? null,
      status: 'planning',
      visibility: normalizeHomeProjectVisibility(input.visibility),
      summary: input.summary ?? null,
      goals: input.goals ?? null,
      constraints: input.constraints ?? null,
      target_budget_cents: input.targetBudgetCents ?? null,
      currency: input.currency ?? 'USD',
      contingency_pct: contingencyPct,
      target_start_at: input.targetStartAt ?? null,
      target_end_at: input.targetEndAt ?? null,
      created_by: userId,
      updated_by: userId,
      created_at: now,
      updated_at: now,
    });

    if (input.spaceIds?.length) {
      for (const spaceId of input.spaceIds) {
        await this.db.insert(homeProjectSpaces).values({
          project_id: projectId,
          space_id: spaceId,
        });
      }
    }

    if (template) {
      for (const phase of template.phases) {
        await this.db.insert(homeProjectPhases).values({
          id: generateId(),
          project_id: projectId,
          title: phase.title,
          status: 'pending',
          sort_order: phase.sortOrder,
          created_at: now,
          updated_at: now,
        });
      }
      // `sort_order` is the loop index rather than a field on the seed: unlike
      // `template.phases` the blocker seeds carry no `sortOrder`, and the order
      // the template lists them in is the order it means.
      for (const [index, blocker] of template.blockers.entries()) {
        await this.db.insert(homeProjectBlockers).values({
          id: generateId(),
          project_id: projectId,
          title: blocker.title,
          severity: blocker.severity,
          status: 'open',
          sort_order: index,
          created_at: now,
          updated_at: now,
        });
      }
      for (const line of template.budgetLines) {
        await this.db.insert(homeProjectBudgetLines).values({
          id: generateId(),
          project_id: projectId,
          category: line.category,
          label: line.label,
          // A template seeds the ROW, never the money — see `templates.ts`.
          estimate_cents: 0,
          actual_cents: 0,
          sort_order: line.sortOrder,
          created_at: now,
          updated_at: now,
        });
      }
    }
    // A project with no template seeds NOTHING. It used to get a `contingency`
    // line at zero, which `computeRollups` then preferred to `contingency_pct`
    // (`??`, and zero is a value) — pegging the buffer at zero for the life of
    // the project however much the member went on to price.

    await this.recordActivity(
      projectId,
      userId,
      'project_created',
      'project',
      projectId,
      {
        templateKey: template?.key,
      },
    );

    return this.getOwnedProject(householdId, projectId);
  }

  async getHub(
    householdId: string,
    userId: string,
    projectId: string,
  ): Promise<ProjectHub> {
    const project = await this.requireProjectAccess(
      householdId,
      userId,
      projectId,
      'read',
    );

    const [
      spaces,
      selections,
      optionGroups,
      budgetLines,
      phases,
      milestones,
      blockers,
      attachments,
      planLinks,
      geometryRows,
    ] = await Promise.all([
      this.db
        .select()
        .from(homeProjectSpaces)
        .where(eq(homeProjectSpaces.project_id, projectId))
        .all(),
      this.db
        .select()
        .from(homeProjectSelections)
        .where(eq(homeProjectSelections.project_id, projectId))
        .orderBy(asc(homeProjectSelections.sort_order))
        .all(),
      this.db
        .select()
        .from(homeProjectOptionGroups)
        .where(eq(homeProjectOptionGroups.project_id, projectId))
        .orderBy(asc(homeProjectOptionGroups.sort_order))
        .all(),
      this.db
        .select()
        .from(homeProjectBudgetLines)
        .where(eq(homeProjectBudgetLines.project_id, projectId))
        .orderBy(asc(homeProjectBudgetLines.sort_order))
        .all(),
      this.db
        .select()
        .from(homeProjectPhases)
        .where(eq(homeProjectPhases.project_id, projectId))
        .orderBy(asc(homeProjectPhases.sort_order))
        .all(),
      this.db
        .select()
        .from(homeProjectMilestones)
        .where(eq(homeProjectMilestones.project_id, projectId))
        .all(),
      this.db
        .select()
        .from(homeProjectBlockers)
        .where(eq(homeProjectBlockers.project_id, projectId))
        .orderBy(asc(homeProjectBlockers.sort_order))
        .all(),
      this.db
        .select()
        .from(homeProjectAttachments)
        .where(eq(homeProjectAttachments.project_id, projectId))
        .all(),
      this.db
        .select()
        .from(homeProjectPlanLinks)
        .where(eq(homeProjectPlanLinks.project_id, projectId))
        .all(),
      this.db
        .select()
        .from(homeProjectGeometry)
        .where(eq(homeProjectGeometry.project_id, projectId))
        .orderBy(desc(homeProjectGeometry.updated_at))
        .all(),
    ]);

    return {
      project,
      // Resolved here rather than left to the screen: the hub is the ONE read
      // every project surface already makes, and a client that had to derive its
      // own role from `access_json` would be a second implementation of the rule
      // the Worker enforces — which is how a disabled button and a 403 stop
      // agreeing.
      my_role: effectiveHomeProjectRole(project, userId),
      space_ids: spaces.map(s => s.space_id),
      rollups: computeRollups(project, budgetLines.slice(0, HUB_CHILD_CAP)),
      selections: selections.slice(0, HUB_CHILD_CAP),
      option_groups: optionGroups.slice(0, HUB_CHILD_CAP),
      budget_lines: budgetLines.slice(0, HUB_CHILD_CAP),
      phases: phases.slice(0, HUB_CHILD_CAP),
      milestones: milestones.slice(0, HUB_CHILD_CAP),
      blockers: blockers.slice(0, HUB_CHILD_CAP),
      attachments: attachments.slice(0, HUB_CHILD_CAP),
      plan_links: planLinks.slice(0, HUB_CHILD_CAP),
      geometry: geometryRows[0] ?? null,
    };
  }

  async updateProject(
    householdId: string,
    userId: string,
    projectId: string,
    patch: Partial<{
      title: string;
      type: string;
      status: string;
      summary: string | null;
      goals: string | null;
      constraints: string | null;
      targetBudgetCents: number | null;
      currency: string;
      contingencyPct: number;
      targetStartAt: string | null;
      targetEndAt: string | null;
      coverAttachmentId: string | null;
      /** `'draft' | 'published'` — see migration 0163. Owner-only. */
      visibility: string;
    }>,
  ): Promise<HomeProject> {
    // Publishing (or un-publishing) decides who in the household can see the
    // project at all, so it is an access change and takes the `manage` gate —
    // not the `write` gate the rest of this patch runs under. Today both mean
    // "owner", and stating the difference is what keeps them separable.
    await this.requireProjectAccess(
      householdId,
      userId,
      projectId,
      patch.visibility !== undefined ? 'manage' : 'write',
    );
    // `cover_attachment_id` is a bare `text` column with no `references()`, so
    // nothing but this check stops a caller naming an attachment that belongs to
    // another project — and the list query resolves whatever id it finds into a
    // URL, which would hand one household a thumbnail of another's photo.
    if (patch.coverAttachmentId) {
      const cover = await this.db
        .select()
        .from(homeProjectAttachments)
        .where(
          and(
            eq(homeProjectAttachments.id, patch.coverAttachmentId),
            eq(homeProjectAttachments.project_id, projectId),
          ),
        )
        .get();
      if (!cover) throw new NotFoundError('Cover attachment not found');
    }
    const now = nowIso();
    await this.db
      .update(homeProjects)
      .set({
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
        ...(patch.goals !== undefined ? { goals: patch.goals } : {}),
        ...(patch.constraints !== undefined
          ? { constraints: patch.constraints }
          : {}),
        ...(patch.targetBudgetCents !== undefined
          ? { target_budget_cents: patch.targetBudgetCents }
          : {}),
        ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
        ...(patch.contingencyPct !== undefined
          ? { contingency_pct: patch.contingencyPct }
          : {}),
        ...(patch.targetStartAt !== undefined
          ? { target_start_at: patch.targetStartAt }
          : {}),
        ...(patch.targetEndAt !== undefined
          ? { target_end_at: patch.targetEndAt }
          : {}),
        ...(patch.coverAttachmentId !== undefined
          ? { cover_attachment_id: patch.coverAttachmentId }
          : {}),
        ...(patch.visibility !== undefined
          ? { visibility: normalizeHomeProjectVisibility(patch.visibility) }
          : {}),
        updated_by: userId,
        updated_at: now,
      })
      .where(eq(homeProjects.id, projectId));
    // A publish is its own event, not a `project_updated`. The activity feed is
    // the only record a household has of when a plan stopped being one person's
    // scratch draft, and folding it into the generic update would erase that.
    if (patch.visibility !== undefined) {
      const visibility = normalizeHomeProjectVisibility(patch.visibility);
      await this.recordActivity(
        projectId,
        userId,
        visibility === 'published'
          ? 'project_published'
          : 'project_unpublished',
        'project',
        projectId,
        { visibility },
      );
      if (visibility === 'published') {
        const project = await this.getOwnedProject(householdId, projectId);
        await this.notifyHousehold(
          householdId,
          userId,
          'home_project_published',
          'New home project',
          `"${project.title}" was shared with the household`,
          projectId,
        );
      }
    } else {
      await this.recordActivity(
        projectId,
        userId,
        'project_updated',
        'project',
        projectId,
      );
    }
    return this.getOwnedProject(householdId, projectId);
  }

  /**
   * `DELETE /:projectId` — the project and every child row, permanently.
   *
   * `manage`, not `write`: archiving is the reversible action a project owner
   * reaches for, and this one is not reversible at all. A viewer cannot reach
   * it and neither can a member whose grant is `viewer`.
   *
   * The children are deleted EXPLICITLY even though all thirteen declare
   * `onDelete: 'cascade'`. SQLite only honours a foreign key when
   * `PRAGMA foreign_keys` is on for the connection, which is not a guarantee
   * this service makes — and the failure mode is silent: the parent goes, the
   * budget lines and photos stay, and the next project to reuse nothing at all
   * still leaves a household paying storage for rows no screen can reach.
   *
   * `home_project_attachments` rows are dropped with the rest; their R2 objects
   * are deliberately NOT deleted here. A bucket delete cannot participate in the
   * same batch, so a failure half-way would leave the D1 rows gone and no way to
   * find the orphaned keys — the same call `deleteSelection` already makes for
   * its attachments. The keys are prefixed `home-projects/{household}/{project}/`
   * and are sweepable.
   */
  async deleteProject(
    householdId: string,
    userId: string,
    projectId: string,
  ): Promise<void> {
    await this.requireProjectAccess(householdId, userId, projectId, 'manage');
    await this.db.batch([
      this.db
        .delete(homeProjectActivity)
        .where(eq(homeProjectActivity.project_id, projectId)),
      this.db
        .delete(homeProjectComments)
        .where(eq(homeProjectComments.project_id, projectId)),
      this.db
        .delete(homeProjectGeometry)
        .where(eq(homeProjectGeometry.project_id, projectId)),
      this.db
        .delete(homeProjectPlanLinks)
        .where(eq(homeProjectPlanLinks.project_id, projectId)),
      this.db
        .delete(homeProjectAttachments)
        .where(eq(homeProjectAttachments.project_id, projectId)),
      this.db
        .delete(homeProjectBlockers)
        .where(eq(homeProjectBlockers.project_id, projectId)),
      this.db
        .delete(homeProjectMilestones)
        .where(eq(homeProjectMilestones.project_id, projectId)),
      this.db
        .delete(homeProjectPhases)
        .where(eq(homeProjectPhases.project_id, projectId)),
      this.db
        .delete(homeProjectBudgetLines)
        .where(eq(homeProjectBudgetLines.project_id, projectId)),
      this.db
        .delete(homeProjectSelections)
        .where(eq(homeProjectSelections.project_id, projectId)),
      this.db
        .delete(homeProjectOptionGroups)
        .where(eq(homeProjectOptionGroups.project_id, projectId)),
      this.db
        .delete(homeProjectSpaces)
        .where(eq(homeProjectSpaces.project_id, projectId)),
      // No `home_project_tasks` delete: since migration 0170 the link is a
      // column on the project row below, so it goes when the project does.
      this.db
        .delete(homeProjectContractors)
        .where(eq(homeProjectContractors.project_id, projectId)),
      this.db.delete(homeProjects).where(eq(homeProjects.id, projectId)),
    ]);
  }

  /**
   * Who is in this household and what each of them can do with this project.
   *
   * Every member is returned, including the ones with no explicit grant, because
   * the screen this feeds is "manage permissions for household members" — a list
   * that showed only the overridden people would make the default invisible and
   * the sheet unusable. `source` is what lets the row say *why*.
   */
  async getProjectAccess(
    householdId: string,
    userId: string,
    projectId: string,
  ): Promise<HomeProjectAccessView> {
    const project = await this.requireProjectAccess(
      householdId,
      userId,
      projectId,
      'read',
    );
    const grants = parseHomeProjectAccessGrants(project.access_json);
    const grantByUser = new Map(grants.map(g => [g.user_id, g.role]));
    const defaultRole = normalizeHomeProjectRole(project.default_role);

    const rows = await this.db
      .select({
        user_id: householdMembers.user_id,
        display_name: users.display_name,
        email: users.email,
        avatar_url: users.avatar_url,
      })
      .from(householdMembers)
      .innerJoin(users, eq(householdMembers.user_id, users.id))
      .where(
        and(
          eq(householdMembers.household_id, householdId),
          isNull(householdMembers.deleted_at),
        ),
      )
      .all();

    const members: HomeProjectAccessMember[] = rows.map(row => {
      const isCreator =
        !!project.created_by && project.created_by === row.user_id;
      const granted = grantByUser.get(row.user_id);
      return {
        user_id: row.user_id,
        display_name: row.display_name ?? null,
        email: row.email ?? null,
        avatar_url: row.avatar_url ?? null,
        role: isCreator ? 'owner' : granted ?? defaultRole,
        source: isCreator ? 'creator' : granted ? 'grant' : 'default',
      };
    });

    return {
      project_id: projectId,
      visibility: normalizeHomeProjectVisibility(project.visibility),
      default_role: defaultRole,
      my_role: effectiveHomeProjectRole(project, userId),
      members,
    };
  }

  /**
   * Replace the whole access list in one write.
   *
   * A whole-list PUT rather than per-member PATCHes, because the sheet edits
   * several rows before saving and three sequential role changes are three
   * chances to leave the project in a state nobody chose. Grants naming someone
   * who is not (or is no longer) a household member are DROPPED rather than
   * rejected: a member removed from the household while the sheet was open would
   * otherwise make every subsequent save fail with an error about a person who
   * is not on screen.
   */
  async setProjectAccess(
    householdId: string,
    userId: string,
    projectId: string,
    input: { defaultRole: HomeProjectRole; grants: HomeProjectAccessGrant[] },
  ): Promise<HomeProjectAccessView> {
    const project = await this.requireProjectAccess(
      householdId,
      userId,
      projectId,
      'manage',
    );
    const memberIds = new Set(await this.getHouseholdMemberIds(householdId));
    const grants = input.grants.filter(
      // The creator's `owner` is pinned by `effectiveHomeProjectRole` and cannot
      // be overridden, so storing a grant for them is dead weight that would
      // read, on the next open, like a rule that is being ignored.
      grant =>
        memberIds.has(grant.user_id) && grant.user_id !== project.created_by,
    );
    const defaultRole = normalizeHomeProjectRole(input.defaultRole);

    await this.db
      .update(homeProjects)
      .set({
        default_role: defaultRole,
        access_json: serializeHomeProjectAccessGrants(grants),
        updated_by: userId,
        updated_at: nowIso(),
      })
      .where(eq(homeProjects.id, projectId));
    await this.recordActivity(
      projectId,
      userId,
      'project_access_changed',
      'project',
      projectId,
      {
        defaultRole,
        grants: grants.length,
      },
    );

    return this.getProjectAccess(householdId, userId, projectId);
  }

  async archiveProject(
    householdId: string,
    userId: string,
    projectId: string,
  ): Promise<HomeProject> {
    return this.updateProject(householdId, userId, projectId, {
      status: 'archived',
    });
  }

  // ---- Selections ----

  /**
   * The position a NEW material takes: ABOVE everything already on the project.
   *
   * The materials list is the one list on the hub that is not a plan. A project
   * accumulates dozens of them, and the row a member cares about is always the
   * one they just added — the shop link they pasted, the shelf tag they
   * photographed. Appending (`max + 1`, the rule phases and blockers use)
   * buried it under the whole AI-seeded list and cost a scroll to the bottom to
   * confirm the add even worked; the fault report that started this was exactly
   * that, on a project whose plan had seeded eight materials.
   *
   * Prepending is `min - 1` and not a renumbering pass on purpose: one read and
   * one write per add, whatever the list already holds, and no row the member
   * did not touch changes underneath another device. Negative positions are
   * fine — the column is a plain integer read `ORDER BY sort_order ASC`, and
   * nothing anywhere treats 0 as the floor.
   *
   * An empty project starts at 0 rather than -1 so the first material on a
   * project matches every row written before this rule existed.
   */
  private async topSelectionSortOrder(projectId: string): Promise<number> {
    const row = await this.db
      .select({ min: sql<number | null>`min(${homeProjectSelections.sort_order})` })
      .from(homeProjectSelections)
      .where(eq(homeProjectSelections.project_id, projectId))
      .get();
    return row?.min == null ? 0 : row.min - 1;
  }

  async createSelection(
    householdId: string,
    userId: string,
    projectId: string,
    input: {
      name: string;
      category?: string;
      status?: string;
      qty?: number;
      unit?: string;
      unitPriceCents?: number;
      vendor?: string;
      productUrl?: string;
      notes?: string;
      optionGroupId?: string;
      brand?: string;
      sku?: string;
      imageUrl?: string;
      coveragePerUnit?: number;
      coverageUnit?: string;
      specs?: MaterialSpec[];
      /**
       * Appearance — migration 0164. Nullable as well as optional so a caller
       * can distinguish "I have no opinion" from "the member cleared it"; the
       * insert below treats both as NULL, which is what every row that predates
       * the migration already holds.
       */
      colorHex?: string | null;
      groutColorHex?: string | null;
      unitWMm?: number | null;
      unitHMm?: number | null;
      /** The offer. Descriptive only — see the money note below. */
      listPriceCents?: number | null;
      salePriceCents?: number | null;
      discountPct?: number | null;
      saleEndsAt?: string | null;
      extractionSource?: string;
      extractionConfidence?: string;
      /**
       * Where this material sits in the list, for a caller writing a whole
       * PLAN one row at a time — pass the index and the plan's order survives.
       *
       * Left out by a member-driven add, which is every other caller, and then
       * `topSelectionSortOrder` puts the new row on top. Without this escape
       * hatch the two are the same act to this method, and a Smart Project's
       * materials would come out reversed: each one prepended above the last.
       */
      sortOrder?: number;
    },
  ): Promise<HomeProjectSelection> {
    await this.requireProjectAccess(householdId, userId, projectId, 'write');

    // A group id from the client is a claim about another row; verify it belongs
    // to THIS project before storing it, or a selection can be parented into a
    // group in someone else's renovation and show up on their card list.
    if (input.optionGroupId) {
      await this.getOwnedOptionGroup(projectId, input.optionGroupId);
    }

    const id = generateId();
    const now = nowIso();
    await this.db.insert(homeProjectSelections).values({
      id,
      project_id: projectId,
      name: input.name,
      category: input.category ?? 'other',
      status: input.status ?? 'idea',
      qty: input.qty ?? 1,
      unit: input.unit ?? null,
      unit_price_cents: input.unitPriceCents ?? null,
      vendor: input.vendor ?? null,
      product_url: input.productUrl ?? null,
      notes: input.notes ?? null,
      option_group_id: input.optionGroupId ?? null,
      brand: input.brand ?? null,
      sku: input.sku ?? null,
      image_url: input.imageUrl ?? null,
      coverage_per_unit: input.coveragePerUnit ?? null,
      coverage_unit: input.coverageUnit ?? null,
      specs_json: input.specs?.length ? JSON.stringify(input.specs) : null,
      /*
        Appearance + offer — migration 0164, and until now nothing on this
        backend wrote any of them. The model was asked for the colour, the
        repeat size and the sale; the normalisers checked them; the card knew
        how to draw them; `materialFromSelection` knew how to put them on a
        wall — and on a server-backed household every one of those was dead
        code, because the row never held the fact. Both AI paths reach this
        insert through `mergeListingIntoDraft`, so writing them here is what
        makes the shop link AND the shelf-tag photo persist what they read.
      */
      color_hex: input.colorHex ?? null,
      grout_color_hex: input.groutColorHex ?? null,
      unit_w_mm: input.unitWMm ?? null,
      unit_h_mm: input.unitHMm ?? null,
      list_price_cents: input.listPriceCents ?? null,
      sale_price_cents: input.salePriceCents ?? null,
      discount_pct: input.discountPct ?? null,
      sale_ends_at: input.saleEndsAt ?? null,
      extraction_source: input.extractionSource ?? 'manual',
      extraction_confidence: input.extractionConfidence ?? null,
      sort_order:
        input.sortOrder ?? (await this.topSelectionSortOrder(projectId)),
      created_at: now,
      updated_at: now,
    });
    await this.recordActivity(
      projectId,
      userId,
      'selection_added',
      'selection',
      id,
    );

    /*
      WHICH PRICE AN ESTIMATE USES, decided here and nowhere else:
      `unit_price_cents`. Always. Even when `sale_price_cents` is set.

      The three offer columns above are DESCRIPTIVE — they exist so the card can
      draw "$14.42 $5.98, save 59%" — and no takeoff, budget line or rollup ever
      reads them. That is not a shortcut; it is the point of the split:

        - `unit_price_cents` is defined as the price the customer pays TODAY, so
          on a live sale it already HOLDS the sale price. Both importers put
          `price_amount` there, and `price_amount` is what the page charges now.
          A member looking at a discounted floor therefore already gets an
          estimate at the discounted price, with no second code path.
        - The alternative — estimating from `sale_price_cents` — is correct
          until the sale ends and then permanently wrong, because a stored
          number nobody re-reads keeps quoting a price the shop withdrew. "You
          have $3,000 left" computed from a price the member cannot transact at
          is the failure this whole split exists to prevent, and it is worse
          than a stale estimate that is at least a real price.
        - Estimating from `list_price_cents` would be wrong in the other
          direction: over-quoting the member out of a purchase they can make.

      So a sale never overwrites, never redirects and never shadows the estimate
      price. Anything wanting to show the deal reads the offer columns; anything
      spending money reads `unit_price_cents`.

      A grouped option is a CANDIDATE, not a decision, so it buys nothing yet —
      five flooring options must not put five floors into the estimate. The
      money arrives via `setPreferredSelection`. Ungrouped selections keep the
      original behaviour exactly: price present, budget line written.
    */
    if (
      !input.optionGroupId &&
      input.unitPriceCents != null &&
      input.unitPriceCents > 0
    ) {
      const qty = input.qty ?? 1;
      await this.createBudgetLine(householdId, userId, projectId, {
        category: 'materials',
        label: input.name,
        estimateCents: input.unitPriceCents * qty,
        selectionId: id,
      });
      await this.maybeNotifyBudgetOver(householdId, userId, projectId);
    }
    const row = await this.db
      .select()
      .from(homeProjectSelections)
      .where(eq(homeProjectSelections.id, id))
      .get();
    if (!row) throw new NotFoundError('Selection');
    return row;
  }

  async updateSelection(
    householdId: string,
    userId: string,
    projectId: string,
    selectionId: string,
    patch: Partial<{
      name: string;
      category: string;
      status: string;
      qty: number;
      unit: string | null;
      unitPriceCents: number | null;
      vendor: string | null;
      productUrl: string | null;
      notes: string | null;
      optionGroupId: string | null;
      brand: string | null;
      sku: string | null;
      imageUrl: string | null;
      coveragePerUnit: number | null;
      coverageUnit: string | null;
      specs: MaterialSpec[] | null;
      /**
       * Appearance + offer — migration 0164.
       *
       * `Partial<>` is what makes clearing possible without clobbering: an
       * absent key is left alone, an explicit `null` writes NULL. The member
       * eyedropping a wrong colour off a listing needs the second, and every
       * client that patches a name without knowing these columns exist needs
       * the first.
       */
      colorHex: string | null;
      groutColorHex: string | null;
      unitWMm: number | null;
      unitHMm: number | null;
      listPriceCents: number | null;
      salePriceCents: number | null;
      discountPct: number | null;
      saleEndsAt: string | null;
      version: number;
    }>,
  ): Promise<HomeProjectSelection> {
    await this.requireProjectAccess(householdId, userId, projectId, 'write');
    const existing = await this.db
      .select()
      .from(homeProjectSelections)
      .where(
        and(
          eq(homeProjectSelections.id, selectionId),
          eq(homeProjectSelections.project_id, projectId),
        ),
      )
      .get();
    if (!existing) throw new NotFoundError('Selection');
    if (patch.version != null && patch.version !== existing.version) {
      throw new ConflictError('Selection was updated by someone else');
    }
    const now = nowIso();
    await this.db
      .update(homeProjectSelections)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.category !== undefined ? { category: patch.category } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.qty !== undefined ? { qty: patch.qty } : {}),
        ...(patch.unit !== undefined ? { unit: patch.unit } : {}),
        ...(patch.unitPriceCents !== undefined
          ? { unit_price_cents: patch.unitPriceCents }
          : {}),
        ...(patch.vendor !== undefined ? { vendor: patch.vendor } : {}),
        ...(patch.productUrl !== undefined
          ? { product_url: patch.productUrl }
          : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        ...(patch.optionGroupId !== undefined
          ? { option_group_id: patch.optionGroupId }
          : {}),
        ...(patch.brand !== undefined ? { brand: patch.brand } : {}),
        ...(patch.sku !== undefined ? { sku: patch.sku } : {}),
        ...(patch.imageUrl !== undefined ? { image_url: patch.imageUrl } : {}),
        ...(patch.coveragePerUnit !== undefined
          ? { coverage_per_unit: patch.coveragePerUnit }
          : {}),
        ...(patch.coverageUnit !== undefined
          ? { coverage_unit: patch.coverageUnit }
          : {}),
        ...(patch.specs !== undefined
          ? {
              specs_json: patch.specs?.length
                ? JSON.stringify(patch.specs)
                : null,
            }
          : {}),
        /*
          Appearance + offer — migration 0164. Each guarded on `!== undefined`
          like every column above it, so a patch that touches only `name` leaves
          the colour, the repeat size and the sale exactly as they were. A
          spread of `patch.colorHex ?? null` instead would blank a member's
          colour every time someone renamed the material.

          `unit_price_cents` is untouched by any of these: the offer columns
          describe the deal, they never become the estimate. See `createSelection`.
        */
        ...(patch.colorHex !== undefined ? { color_hex: patch.colorHex } : {}),
        ...(patch.groutColorHex !== undefined
          ? { grout_color_hex: patch.groutColorHex }
          : {}),
        ...(patch.unitWMm !== undefined ? { unit_w_mm: patch.unitWMm } : {}),
        ...(patch.unitHMm !== undefined ? { unit_h_mm: patch.unitHMm } : {}),
        ...(patch.listPriceCents !== undefined
          ? { list_price_cents: patch.listPriceCents }
          : {}),
        ...(patch.salePriceCents !== undefined
          ? { sale_price_cents: patch.salePriceCents }
          : {}),
        ...(patch.discountPct !== undefined
          ? { discount_pct: patch.discountPct }
          : {}),
        ...(patch.saleEndsAt !== undefined
          ? { sale_ends_at: patch.saleEndsAt }
          : {}),
        version: existing.version + 1,
        updated_at: now,
      })
      .where(eq(homeProjectSelections.id, selectionId));
    await this.recordActivity(
      projectId,
      userId,
      'selection_updated',
      'selection',
      selectionId,
    );
    const row = await this.db
      .select()
      .from(homeProjectSelections)
      .where(eq(homeProjectSelections.id, selectionId))
      .get();
    if (!row) throw new NotFoundError('Selection');

    // Editing the winner's price, coverage or qty changes what the project
    // costs. Re-derive its line here rather than leaving the budget showing the
    // number from before the edit.
    if (row.option_group_id) {
      const group = await this.getOwnedOptionGroup(
        projectId,
        row.option_group_id,
      );
      if (group.preferred_selection_id === selectionId) {
        await this.syncPreferredBudgetLine(
          householdId,
          userId,
          projectId,
          group,
          row,
        );
      }
    }
    return row;
  }

  async deleteSelection(
    householdId: string,
    userId: string,
    projectId: string,
    selectionId: string,
  ): Promise<void> {
    await this.requireProjectAccess(householdId, userId, projectId, 'write');

    // Read before deleting: if this row was a group's winner, the group and the
    // budget both still point at it, and neither cleans itself up. There is no
    // FK to cascade — `preferred_selection_id` and `budget_lines.selection_id`
    // are plain text by design (migration 0162).
    const existing = await this.db
      .select()
      .from(homeProjectSelections)
      .where(
        and(
          eq(homeProjectSelections.id, selectionId),
          eq(homeProjectSelections.project_id, projectId),
        ),
      )
      .get();

    await this.db
      .delete(homeProjectSelections)
      .where(
        and(
          eq(homeProjectSelections.id, selectionId),
          eq(homeProjectSelections.project_id, projectId),
        ),
      );

    if (existing?.option_group_id) {
      const group = await this.db
        .select()
        .from(homeProjectOptionGroups)
        .where(eq(homeProjectOptionGroups.id, existing.option_group_id))
        .get();
      if (group?.preferred_selection_id === selectionId) {
        await this.db
          .update(homeProjectOptionGroups)
          .set({ preferred_selection_id: null, updated_at: nowIso() })
          .where(eq(homeProjectOptionGroups.id, group.id));
        // The group is undecided again, so its money leaves the estimate with
        // it. Leaving a line for a deleted option would quote a floor the
        // project no longer has an option for.
        await this.db
          .delete(homeProjectBudgetLines)
          .where(
            and(
              eq(homeProjectBudgetLines.project_id, projectId),
              eq(homeProjectBudgetLines.selection_id, selectionId),
            ),
          );
      }
    }

    await this.recordActivity(
      projectId,
      userId,
      'selection_deleted',
      'selection',
      selectionId,
    );
  }

  // ---- Option groups (material options; migration 0162) ----

  private async getOwnedOptionGroup(
    projectId: string,
    groupId: string,
  ): Promise<HomeProjectOptionGroup> {
    const group = await this.db
      .select()
      .from(homeProjectOptionGroups)
      .where(
        and(
          eq(homeProjectOptionGroups.id, groupId),
          eq(homeProjectOptionGroups.project_id, projectId),
        ),
      )
      .get();
    if (!group) throw new NotFoundError('Option group');
    return group;
  }

  /**
   * A surface to decide — "Kitchen floor", 24 m², 10% waste.
   *
   * When the member gives no area and the project already has geometry, the
   * floor area from the plan is offered as a starting point and marked
   * `area_source: 'geometry'`, so the card can say where the number came from.
   * A plan is a measurement of a room, not a measurement of the surface being
   * renovated, and the member is the one who knows the difference.
   */
  async createOptionGroup(
    householdId: string,
    userId: string,
    projectId: string,
    input: {
      name: string;
      category?: string;
      areaValue?: number | null;
      areaUnit?: string | null;
      wasteFactorPct?: number;
    },
  ): Promise<HomeProjectOptionGroup> {
    await this.requireProjectAccess(householdId, userId, projectId, 'write');

    let areaValue = input.areaValue ?? null;
    let areaUnit = input.areaUnit ?? null;
    let areaSource = 'manual';
    if (areaValue == null) {
      const fromPlan = await this.floorAreaFromGeometry(projectId);
      if (fromPlan != null) {
        areaValue = fromPlan;
        areaUnit = 'm2';
        areaSource = 'geometry';
      }
    }

    const id = generateId();
    const now = nowIso();
    await this.db.insert(homeProjectOptionGroups).values({
      id,
      project_id: projectId,
      name: input.name,
      category: input.category ?? 'finish',
      area_value: areaValue,
      area_unit: areaUnit,
      area_source: areaSource,
      waste_factor_pct: input.wasteFactorPct ?? 10,
      created_at: now,
      updated_at: now,
    });
    await this.recordActivity(
      projectId,
      userId,
      'option_group_added',
      'option_group',
      id,
    );
    return this.getOwnedOptionGroup(projectId, id);
  }

  async updateOptionGroup(
    householdId: string,
    userId: string,
    projectId: string,
    groupId: string,
    patch: Partial<{
      name: string;
      category: string;
      areaValue: number | null;
      areaUnit: string | null;
      wasteFactorPct: number;
      version: number;
    }>,
  ): Promise<HomeProjectOptionGroup> {
    await this.requireProjectAccess(householdId, userId, projectId, 'write');
    const existing = await this.getOwnedOptionGroup(projectId, groupId);
    if (patch.version != null && patch.version !== existing.version) {
      throw new ConflictError('Option group was updated by someone else');
    }
    await this.db
      .update(homeProjectOptionGroups)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.category !== undefined ? { category: patch.category } : {}),
        // Typing over a prefilled area makes it the member's own number, and it
        // must stop claiming to come from the floor plan.
        ...(patch.areaValue !== undefined
          ? { area_value: patch.areaValue, area_source: 'manual' }
          : {}),
        ...(patch.areaUnit !== undefined ? { area_unit: patch.areaUnit } : {}),
        ...(patch.wasteFactorPct !== undefined
          ? { waste_factor_pct: patch.wasteFactorPct }
          : {}),
        version: existing.version + 1,
        updated_at: nowIso(),
      })
      .where(eq(homeProjectOptionGroups.id, groupId));

    const group = await this.getOwnedOptionGroup(projectId, groupId);
    // Area and waste are inputs to the winner's price. Changing 24 m² to 30 m²
    // has to move the budget, or the estimate silently describes the old room.
    if (group.preferred_selection_id) {
      const winner = await this.db
        .select()
        .from(homeProjectSelections)
        .where(eq(homeProjectSelections.id, group.preferred_selection_id))
        .get();
      if (winner) {
        await this.syncPreferredBudgetLine(
          householdId,
          userId,
          projectId,
          group,
          winner,
        );
      }
    }
    return group;
  }

  async deleteOptionGroup(
    householdId: string,
    userId: string,
    projectId: string,
    groupId: string,
  ): Promise<void> {
    await this.requireProjectAccess(householdId, userId, projectId, 'write');
    const group = await this.getOwnedOptionGroup(projectId, groupId);

    if (group.preferred_selection_id) {
      await this.db
        .delete(homeProjectBudgetLines)
        .where(
          and(
            eq(homeProjectBudgetLines.project_id, projectId),
            eq(
              homeProjectBudgetLines.selection_id,
              group.preferred_selection_id,
            ),
          ),
        );
    }
    // The options themselves survive as ungrouped ideas. Deleting a group is
    // "we are not deciding this here", not "throw away the five materials we
    // researched" — and the member did not ask for the second thing.
    await this.db
      .update(homeProjectSelections)
      .set({ option_group_id: null, updated_at: nowIso() })
      .where(
        and(
          eq(homeProjectSelections.project_id, projectId),
          eq(homeProjectSelections.option_group_id, groupId),
        ),
      );
    await this.db
      .delete(homeProjectOptionGroups)
      .where(eq(homeProjectOptionGroups.id, groupId));
    await this.recordActivity(
      projectId,
      userId,
      'option_group_deleted',
      'option_group',
      groupId,
    );
  }

  /**
   * Pick the option that gets built — the one action this whole feature exists for.
   *
   * Switching winners RE-POINTS the group's single budget line rather than
   * adding another. The alternative (delete + create) loses `actual_cents`, and
   * a member who has already paid a deposit against this surface would watch it
   * vanish because they compared two tiles.
   *
   * Passing `selectionId: null` un-picks, returning the group to undecided and
   * taking its money back out of the estimate.
   */
  async setPreferredSelection(
    householdId: string,
    userId: string,
    projectId: string,
    groupId: string,
    selectionId: string | null,
  ): Promise<{
    group: HomeProjectOptionGroup;
    budget_line: HomeProjectBudgetLine | null;
  }> {
    await this.requireProjectAccess(householdId, userId, projectId, 'write');
    const group = await this.getOwnedOptionGroup(projectId, groupId);

    if (selectionId == null) {
      if (group.preferred_selection_id) {
        await this.db
          .delete(homeProjectBudgetLines)
          .where(
            and(
              eq(homeProjectBudgetLines.project_id, projectId),
              eq(
                homeProjectBudgetLines.selection_id,
                group.preferred_selection_id,
              ),
            ),
          );
      }
      await this.db
        .update(homeProjectOptionGroups)
        .set({
          preferred_selection_id: null,
          version: group.version + 1,
          updated_at: nowIso(),
        })
        .where(eq(homeProjectOptionGroups.id, groupId));
      await this.recordActivity(
        projectId,
        userId,
        'option_unpicked',
        'option_group',
        groupId,
      );
      return {
        group: await this.getOwnedOptionGroup(projectId, groupId),
        budget_line: null,
      };
    }

    const winner = await this.db
      .select()
      .from(homeProjectSelections)
      .where(
        and(
          eq(homeProjectSelections.id, selectionId),
          eq(homeProjectSelections.project_id, projectId),
        ),
      )
      .get();
    if (!winner) throw new NotFoundError('Selection');
    if (winner.option_group_id !== groupId) {
      throw new ValidationError('Selection is not an option in this group');
    }

    await this.db
      .update(homeProjectOptionGroups)
      .set({
        preferred_selection_id: selectionId,
        version: group.version + 1,
        updated_at: nowIso(),
      })
      .where(eq(homeProjectOptionGroups.id, groupId));

    // Status carries the decision on the rows themselves, so a member reading a
    // card outside its group still sees which one won.
    //
    // **`approved` / `shortlisted`, not `chosen` / `considering`.** Migration
    // 0105 put a CHECK on this column admitting exactly
    // `('idea','shortlisted','approved','rejected','ordered','installed')`, and
    // 0162 — the migration this whole feature arrived in — began writing two
    // words that are not in it. D1 refuses the UPDATE, so `setPreferredSelection`
    // returned 500 for EVERY pick, against staging and production alike, from
    // the day it shipped. The unit tests missed it because their hand-written
    // schemas omit the CHECK; the constraint is mirrored into them now.
    //
    // The vocabulary already existed and means the same things, so this is a
    // code fix rather than a migration: no row anywhere holds the old values —
    // the constraint saw to that — so there is nothing to back-fill.
    await this.db
      .update(homeProjectSelections)
      .set({ status: 'shortlisted', updated_at: nowIso() })
      .where(
        and(
          eq(homeProjectSelections.option_group_id, groupId),
          eq(homeProjectSelections.status, 'approved'),
        ),
      );
    await this.db
      .update(homeProjectSelections)
      .set({ status: 'approved', updated_at: nowIso() })
      .where(eq(homeProjectSelections.id, selectionId));

    const fresh = await this.getOwnedOptionGroup(projectId, groupId);
    const line = await this.syncPreferredBudgetLine(
      householdId,
      userId,
      projectId,
      fresh,
      winner,
    );
    await this.recordActivity(
      projectId,
      userId,
      'option_picked',
      'selection',
      selectionId,
    );
    await this.maybeNotifyBudgetOver(householdId, userId, projectId);
    return { group: fresh, budget_line: line };
  }

  /**
   * Make the group's budget line say what the winner costs — re-pointing the
   * line that is already there in preference to writing a second one.
   */
  private async syncPreferredBudgetLine(
    householdId: string,
    userId: string,
    projectId: string,
    group: HomeProjectOptionGroup,
    winner: HomeProjectSelection,
  ): Promise<HomeProjectBudgetLine> {
    const estimate = budgetEstimateCents(
      {
        area_value: group.area_value,
        area_unit: group.area_unit,
        waste_factor_pct: group.waste_factor_pct,
      },
      {
        qty: winner.qty,
        unit_price_cents: winner.unit_price_cents,
        coverage_per_unit: winner.coverage_per_unit,
        coverage_unit: winner.coverage_unit,
      },
    );
    const label = `${group.name} — ${winner.name}`;

    // The group's OWN line is the one whose selection_id is any option of this
    // group, which is what makes a switch an update instead of an insert.
    const optionIds = (
      await this.db
        .select({ id: homeProjectSelections.id })
        .from(homeProjectSelections)
        .where(
          and(
            eq(homeProjectSelections.project_id, projectId),
            eq(homeProjectSelections.option_group_id, group.id),
          ),
        )
        .all()
    ).map(r => r.id);

    const existing = optionIds.length
      ? await this.db
          .select()
          .from(homeProjectBudgetLines)
          .where(
            and(
              eq(homeProjectBudgetLines.project_id, projectId),
              inArray(homeProjectBudgetLines.selection_id, optionIds),
            ),
          )
          .get()
      : undefined;

    if (existing) {
      await this.db
        .update(homeProjectBudgetLines)
        .set({
          category: 'materials',
          label,
          estimate_cents: estimate,
          selection_id: winner.id,
          version: existing.version + 1,
          updated_at: nowIso(),
        })
        .where(eq(homeProjectBudgetLines.id, existing.id));
      const row = await this.db
        .select()
        .from(homeProjectBudgetLines)
        .where(eq(homeProjectBudgetLines.id, existing.id))
        .get();
      if (!row) throw new NotFoundError('Budget line');
      return row;
    }

    return this.createBudgetLine(householdId, userId, projectId, {
      category: 'materials',
      label,
      estimateCents: estimate,
      selectionId: winner.id,
    });
  }

  // ---- Material import from a shop link ----

  private async aiFor(
    householdId: string,
    userId: string | null,
  ): Promise<AIProvider> {
    const { apiKey } = await resolveProviderApiKey(
      this.env,
      userId,
      'anthropic',
    );
    return createProviderAdapter({
      provider: 'anthropic',
      apiKey,
      options: {
        onUsage: usageRecorderFor(this.env, {
          feature: 'home_project_material_clip',
          householdId,
          userId: userId ?? null,
        }),
      },
    });
  }

  /**
   * Paste a shop link, get a comparable option card.
   *
   * The pipeline is fetch → structure → model → row, and each stage degrades
   * into the next rather than failing the request:
   *
   *   fetch fails      → a selection holding just the URL and the member's own
   *                      name for it. They pasted a link; they get a row.
   *   no AI key        → OpenGraph only. Exactly what this endpoint did before
   *                      migration 0162, so a household without AI configured
   *                      sees no regression.
   *   model fails      → OpenGraph only, and the error is logged, not raised.
   *   model succeeds   → full card, `extraction_source: 'link_ai'`.
   *
   * Every path yields a selection, because the member's alternative is typing
   * the whole thing by hand and a thrown error hands them a blank form after a
   * ten-second wait.
   *
   * The photo is copied into R2 rather than hot-linked. A vendor URL rots, and a
   * comparison board whose images 404 six weeks into a renovation is worse than
   * one that never had them. `image_url` keeps the original anyway so the card
   * can render during the copy and survive a failed one.
   */
  async importSelectionFromLink(
    householdId: string,
    userId: string,
    projectId: string,
    input: { url: string; optionGroupId?: string },
  ): Promise<{
    selection: HomeProjectSelection;
    extraction: MaterialExtractionOutcome;
  }> {
    const project = await this.requireProjectAccess(
      householdId,
      userId,
      projectId,
      'write',
    );
    if (input.optionGroupId) {
      await this.getOwnedOptionGroup(projectId, input.optionGroupId);
    }

    const fetched = await safeFetchUrl(input.url);
    if (!fetched.ok || !fetched.bodyText) {
      const selection = await this.createSelection(
        householdId,
        userId,
        projectId,
        {
          name: hostnameOf(input.url) ?? 'Saved link',
          productUrl: input.url,
          status: 'idea',
          optionGroupId: input.optionGroupId,
          extractionSource: 'manual',
          notes: 'We could not open this page — add the details by hand.',
        },
      );
      return {
        selection,
        extraction: {
          source: 'manual',
          confidence: null,
          error: fetched.error ?? 'fetch_failed',
        },
      };
    }

    const finalUrl = fetched.finalUrl || input.url;
    const og = parseOpenGraph(fetched.bodyText);
    const ogPriceCents = parsePriceToCents(og.price);

    // The OpenGraph read is computed FIRST and unconditionally: it is the floor
    // that every failure below falls back to, and it costs nothing.
    let draft: SelectionDraft = {
      name: (og.title || hostnameOf(finalUrl) || 'Saved link').slice(0, 200),
      productUrl: finalUrl,
      unitPriceCents: ogPriceCents ?? undefined,
      notes: og.description ? og.description.slice(0, 500) : undefined,
      imageUrl: absoluteImageUrl(og.image, finalUrl) ?? undefined,
      extractionSource: 'link_og',
    };
    let extraction: MaterialExtractionOutcome = {
      source: 'link_og',
      confidence: null,
    };

    if (await hasUsableProviderKey(this.env, userId, 'anthropic')) {
      try {
        const ai = await this.aiFor(householdId, userId);
        const listing =
          await generateStructuredWithFallback<RawMaterialListing>(
            ai,
            this.env.AIHOUSEKEEPER_NUDGE_MODEL || 'claude-sonnet-5',
            this.env.AIHOUSEKEEPER_FALLBACK_MODEL ||
              'claude-haiku-4-5-20251001',
            {
              systemPrompt: EXTRACT_MATERIAL_LISTING_SYSTEM_PROMPT,
              userPrompt: buildExtractMaterialListingUserPrompt({
                url: finalUrl,
                jsonLd: parseJsonLd(fetched.bodyText),
                openGraph: compactRecord({
                  title: og.title,
                  description: og.description,
                  image: og.image,
                  price: og.price,
                }),
                bodyText: extractReadableText(fetched.bodyText),
              }),
              schema: EXTRACT_MATERIAL_LISTING_SCHEMA,
              maxTokens: 2000,
            },
          );
        draft = mergeListingIntoDraft(
          draft,
          listing,
          finalUrl,
          project.currency,
        );
        extraction = {
          source: 'link_ai',
          confidence: listing.confidence ?? null,
        };
      } catch (err) {
        // A failed extraction must not cost the member the row. They still get
        // the OpenGraph card and can fill the rest in.
        console.error('material listing extraction failed', err);
        extraction = {
          source: 'link_og',
          confidence: null,
          error: err instanceof Error ? err.message : 'extraction_failed',
        };
      }
    }

    const selection = await this.createSelection(
      householdId,
      userId,
      projectId,
      {
        ...draft,
        status: 'idea',
        optionGroupId: input.optionGroupId,
        extractionConfidence: extraction.confidence ?? undefined,
      },
    );

    if (draft.imageUrl) {
      await this.copyListingImage(
        householdId,
        userId,
        projectId,
        selection.id,
        draft.imageUrl,
      );
    }

    return { selection, extraction };
  }

  /**
   * Copy the vendor's photo into the project's own storage.
   *
   * Failures are swallowed on purpose: the card already has `image_url` and
   * renders from it, so a hot-link that works today is strictly better than an
   * error that loses the whole import. The attachment is the durability
   * upgrade, not the feature.
   */
  private async copyListingImage(
    householdId: string,
    userId: string,
    projectId: string,
    selectionId: string,
    imageUrl: string,
  ): Promise<void> {
    try {
      const image = await safeFetchImage(imageUrl);
      if (!image.ok || !image.bytes || !image.contentType) return;
      const ext =
        image.contentType === 'image/png'
          ? 'png'
          : image.contentType === 'image/webp'
          ? 'webp'
          : 'jpg';
      const { attachment } = await this.createAttachmentUpload(
        householdId,
        userId,
        projectId,
        {
          filename: `material-${selectionId}.${ext}`,
          fileSize: image.bytes.byteLength,
          contentType: image.contentType,
          kind: 'product_photo',
          selectionId,
        },
      );
      await this.uploadAttachmentBytes(
        householdId,
        userId,
        projectId,
        attachment.id,
        image.bytes,
        image.contentType,
      );
    } catch (err) {
      console.error('material image copy failed', err);
    }
  }

  /** Floor area in m² from the newest completed geometry, when there is one. */
  private async floorAreaFromGeometry(
    projectId: string,
  ): Promise<number | null> {
    const row = await this.db
      .select()
      .from(homeProjectGeometry)
      .where(eq(homeProjectGeometry.project_id, projectId))
      .orderBy(desc(homeProjectGeometry.updated_at))
      .get();
    if (!row?.payload_json) return null;
    try {
      const payload = JSON.parse(row.payload_json) as {
        floor?: { area_m2?: number };
      };
      const area = payload.floor?.area_m2;
      return typeof area === 'number' && area > 0
        ? Math.round(area * 100) / 100
        : null;
    } catch {
      return null;
    }
  }

  // ---- Budget lines ----

  async createBudgetLine(
    householdId: string,
    userId: string,
    projectId: string,
    input: {
      category: string;
      label: string;
      estimateCents?: number;
      actualCents?: number;
      selectionId?: string;
    },
  ): Promise<HomeProjectBudgetLine> {
    await this.requireProjectAccess(householdId, userId, projectId, 'write');
    const id = generateId();
    const now = nowIso();
    await this.db.insert(homeProjectBudgetLines).values({
      id,
      project_id: projectId,
      category: input.category,
      label: input.label,
      estimate_cents: input.estimateCents ?? 0,
      actual_cents: input.actualCents ?? 0,
      selection_id: input.selectionId ?? null,
      created_at: now,
      updated_at: now,
    });
    const row = await this.db
      .select()
      .from(homeProjectBudgetLines)
      .where(eq(homeProjectBudgetLines.id, id))
      .get();
    if (!row) throw new NotFoundError('Budget line');
    return row;
  }

  async updateBudgetLine(
    householdId: string,
    userId: string,
    projectId: string,
    lineId: string,
    patch: Partial<{
      category: string;
      label: string;
      estimateCents: number;
      actualCents: number;
      version: number;
    }>,
  ): Promise<HomeProjectBudgetLine> {
    await this.requireProjectAccess(householdId, userId, projectId, 'write');
    const existing = await this.db
      .select()
      .from(homeProjectBudgetLines)
      .where(
        and(
          eq(homeProjectBudgetLines.id, lineId),
          eq(homeProjectBudgetLines.project_id, projectId),
        ),
      )
      .get();
    if (!existing) throw new NotFoundError('Budget line');
    if (patch.version != null && patch.version !== existing.version) {
      throw new ConflictError('Budget line was updated by someone else');
    }
    await this.db
      .update(homeProjectBudgetLines)
      .set({
        ...(patch.category !== undefined ? { category: patch.category } : {}),
        ...(patch.label !== undefined ? { label: patch.label } : {}),
        ...(patch.estimateCents !== undefined
          ? { estimate_cents: patch.estimateCents }
          : {}),
        ...(patch.actualCents !== undefined
          ? { actual_cents: patch.actualCents }
          : {}),
        version: existing.version + 1,
        updated_at: nowIso(),
      })
      .where(eq(homeProjectBudgetLines.id, lineId));
    const row = await this.db
      .select()
      .from(homeProjectBudgetLines)
      .where(eq(homeProjectBudgetLines.id, lineId))
      .get();
    if (!row) throw new NotFoundError('Budget line');
    await this.maybeNotifyBudgetOver(householdId, userId, projectId);
    return row;
  }

  async deleteBudgetLine(
    householdId: string,
    userId: string,
    projectId: string,
    lineId: string,
  ): Promise<void> {
    await this.requireProjectAccess(householdId, userId, projectId, 'write');
    await this.db
      .delete(homeProjectBudgetLines)
      .where(
        and(
          eq(homeProjectBudgetLines.id, lineId),
          eq(homeProjectBudgetLines.project_id, projectId),
        ),
      );
  }

  // ---- Phases / milestones / blockers ----

  /**
   * The next free position in a project's phase or blocker list.
   *
   * Both tables default `sort_order` to 0, which was harmless while nothing
   * could reorder them and actively wrong now: a list where every hand-added
   * row shares one key has no order at all, and `ORDER BY sort_order` is free
   * to shuffle it between reads. Appending at `max + 1` gives every new row a
   * position of its own, and puts it where the member who typed it expects —
   * at the bottom, under everything already there.
   *
   * Template- and Smart-Project-seeded rows keep working unchanged: they either
   * carry their own `sortOrder` (templates) or arrive one at a time through
   * `createPhase`, which now numbers them 1, 2, 3 … in the order the plan
   * listed them rather than leaving all of them on 0 and relying on scan order.
   */
  private async nextSortOrder(
    table: typeof homeProjectPhases | typeof homeProjectBlockers,
    projectId: string,
  ): Promise<number> {
    const row = await this.db
      .select({ max: sql<number | null>`max(${table.sort_order})` })
      .from(table)
      .where(eq(table.project_id, projectId))
      .get();
    return (row?.max ?? -1) + 1;
  }

  /**
   * Write `ids` back as positions 0..n-1, and park everything the caller did
   * not mention after them in its existing order.
   *
   * The alternative — rejecting any list that is not exactly the project's rows
   * (the rule `reorderSubtasks` uses) — turns an ordinary race into an error
   * the member sees: they start dragging, another member on another device adds
   * a phase, and the drop fails with nothing wrong on either side. Numbering the
   * known ids first and appending the rest keeps that drop, and keeps the
   * newcomer exactly where it already was: at the end.
   *
   * Ids that belong to another project are still refused — that is a bug in the
   * caller, not a race, and silently renumbering another project's rows is the
   * kind of thing that is only found months later.
   */
  private async applyOrder(
    table: typeof homeProjectPhases | typeof homeProjectBlockers,
    projectId: string,
    ids: string[],
    label: 'Phase' | 'Blocker',
  ): Promise<void> {
    const rows = await this.db
      .select({ id: table.id })
      .from(table)
      .where(eq(table.project_id, projectId))
      .orderBy(asc(table.sort_order))
      .all();
    const owned = new Set(rows.map(r => r.id));

    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const id of ids) {
      if (!owned.has(id)) {
        throw new ValidationError(`${label} ${id} is not part of this project`);
      }
      // A duplicate id would leave one row unnumbered and another numbered
      // twice; taking the first mention is the only reading that keeps the
      // result a permutation.
      if (seen.has(id)) continue;
      seen.add(id);
      ordered.push(id);
    }
    for (const row of rows) {
      if (!seen.has(row.id)) ordered.push(row.id);
    }

    const now = nowIso();
    for (let i = 0; i < ordered.length; i++) {
      await this.db
        .update(table)
        .set({ sort_order: i, updated_at: now })
        .where(eq(table.id, ordered[i]));
    }
  }

  async createPhase(
    householdId: string,
    userId: string,
    projectId: string,
    input: { title: string; startsOn?: string; endsOn?: string },
  ): Promise<HomeProjectPhase> {
    await this.requireProjectAccess(householdId, userId, projectId, 'write');
    const id = generateId();
    const now = nowIso();
    await this.db.insert(homeProjectPhases).values({
      id,
      project_id: projectId,
      title: input.title,
      starts_on: input.startsOn ?? null,
      ends_on: input.endsOn ?? null,
      sort_order: await this.nextSortOrder(homeProjectPhases, projectId),
      created_at: now,
      updated_at: now,
    });
    const row = await this.db
      .select()
      .from(homeProjectPhases)
      .where(eq(homeProjectPhases.id, id))
      .get();
    if (!row) throw new NotFoundError('Phase');
    return row;
  }

  /**
   * Correct a phase in place — its title, where it has got to, or its dates.
   *
   * No `recordActivity`, matching `createPhase`. The feed is member-visible and
   * is written by two backends; a phase edit that appears in the history of a
   * server-backed household and not a local-first one is a difference the
   * household can see, so both sides stay silent until both sides speak.
   */
  async updatePhase(
    householdId: string,
    userId: string,
    projectId: string,
    phaseId: string,
    patch: Partial<{
      title: string;
      status: string;
      startsOn: string | null;
      endsOn: string | null;
    }>,
  ): Promise<HomeProjectPhase> {
    await this.requireProjectAccess(householdId, userId, projectId, 'write');
    const existing = await this.db
      .select()
      .from(homeProjectPhases)
      .where(
        and(
          eq(homeProjectPhases.id, phaseId),
          eq(homeProjectPhases.project_id, projectId),
        ),
      )
      .get();
    if (!existing) throw new NotFoundError('Phase');

    await this.db
      .update(homeProjectPhases)
      .set({
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.startsOn !== undefined ? { starts_on: patch.startsOn } : {}),
        ...(patch.endsOn !== undefined ? { ends_on: patch.endsOn } : {}),
        updated_at: nowIso(),
      })
      .where(eq(homeProjectPhases.id, phaseId));

    const row = await this.db
      .select()
      .from(homeProjectPhases)
      .where(eq(homeProjectPhases.id, phaseId))
      .get();
    if (!row) throw new NotFoundError('Phase');
    return row;
  }

  /**
   * Drop a phase.
   *
   * `home_project_milestones.phase_id` is plain text with no `references()`, so
   * nothing cascades: a milestone that pointed at this phase is left pointing at
   * an id that no longer resolves, exactly as `deleteBudgetLine` leaves the
   * material its line came from. Nothing reads `phase_id` today — there is no
   * milestone UI — so this is recorded rather than repaired; repairing it would
   * mean deciding whether the member's milestone should vanish with the phase,
   * which is a product question and not this method's to answer.
   */
  async deletePhase(
    householdId: string,
    userId: string,
    projectId: string,
    phaseId: string,
  ): Promise<void> {
    await this.requireProjectAccess(householdId, userId, projectId, 'write');
    await this.db
      .delete(homeProjectPhases)
      .where(
        and(
          eq(homeProjectPhases.id, phaseId),
          eq(homeProjectPhases.project_id, projectId),
        ),
      );
  }

  /** Put the project's phases in `phaseIds` order. See `applyOrder`. */
  async reorderPhases(
    householdId: string,
    userId: string,
    projectId: string,
    phaseIds: string[],
  ): Promise<HomeProjectPhase[]> {
    await this.requireProjectAccess(householdId, userId, projectId, 'write');
    await this.applyOrder(homeProjectPhases, projectId, phaseIds, 'Phase');
    return this.db
      .select()
      .from(homeProjectPhases)
      .where(eq(homeProjectPhases.project_id, projectId))
      .orderBy(asc(homeProjectPhases.sort_order))
      .all();
  }

  async createMilestone(
    householdId: string,
    userId: string,
    projectId: string,
    input: { title: string; phaseId?: string; dueOn?: string },
  ): Promise<HomeProjectMilestone> {
    await this.requireProjectAccess(householdId, userId, projectId, 'write');
    const id = generateId();
    await this.db.insert(homeProjectMilestones).values({
      id,
      project_id: projectId,
      phase_id: input.phaseId ?? null,
      title: input.title,
      due_on: input.dueOn ?? null,
      created_at: nowIso(),
    });
    const row = await this.db
      .select()
      .from(homeProjectMilestones)
      .where(eq(homeProjectMilestones.id, id))
      .get();
    if (!row) throw new NotFoundError('Milestone');
    return row;
  }

  async createBlocker(
    householdId: string,
    userId: string,
    projectId: string,
    input: { title: string; severity?: string; notes?: string },
  ): Promise<HomeProjectBlocker> {
    await this.requireProjectAccess(householdId, userId, projectId, 'write');
    const id = generateId();
    const now = nowIso();
    await this.db.insert(homeProjectBlockers).values({
      id,
      project_id: projectId,
      title: input.title,
      severity: input.severity ?? 'medium',
      status: 'open',
      notes: input.notes ?? null,
      sort_order: await this.nextSortOrder(homeProjectBlockers, projectId),
      created_at: now,
      updated_at: now,
    });
    await this.recordActivity(
      projectId,
      userId,
      'blocker_added',
      'blocker',
      id,
    );
    const project = await this.getOwnedProject(householdId, projectId);
    await this.notifyHousehold(
      householdId,
      userId,
      'home_project_blocker_added',
      'Home project blocker',
      `"${input.title}" on ${project.title}`,
      projectId,
      { blockerId: id },
    );
    const row = await this.db
      .select()
      .from(homeProjectBlockers)
      .where(eq(homeProjectBlockers.id, id))
      .get();
    if (!row) throw new NotFoundError('Blocker');
    return row;
  }

  /**
   * Correct a blocker: its title, how bad it is, the note under it, or whether
   * it is still in the way.
   *
   * `resolved_at` is deliberately NOT written, even when `status` goes to
   * `'resolved'`. The column has never been written by anything, it is not
   * carried by the local-first row type, and no screen reads it — so writing it
   * on one backend would put a fact in D1 that a local-first household cannot
   * hold and nobody can see. `status` is the whole of what the member changed
   * and the whole of what the row shows.
   */
  async updateBlocker(
    householdId: string,
    userId: string,
    projectId: string,
    blockerId: string,
    patch: Partial<{
      title: string;
      severity: string;
      status: string;
      notes: string | null;
    }>,
  ): Promise<HomeProjectBlocker> {
    await this.requireProjectAccess(householdId, userId, projectId, 'write');
    const existing = await this.db
      .select()
      .from(homeProjectBlockers)
      .where(
        and(
          eq(homeProjectBlockers.id, blockerId),
          eq(homeProjectBlockers.project_id, projectId),
        ),
      )
      .get();
    if (!existing) throw new NotFoundError('Blocker');

    await this.db
      .update(homeProjectBlockers)
      .set({
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.severity !== undefined ? { severity: patch.severity } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        updated_at: nowIso(),
      })
      .where(eq(homeProjectBlockers.id, blockerId));

    await this.recordActivity(
      projectId,
      userId,
      'blocker_updated',
      'blocker',
      blockerId,
    );

    const row = await this.db
      .select()
      .from(homeProjectBlockers)
      .where(eq(homeProjectBlockers.id, blockerId))
      .get();
    if (!row) throw new NotFoundError('Blocker');
    return row;
  }

  /**
   * Drop a blocker — a leaf delete, nothing references it.
   *
   * Unlike `deletePhase` this records activity, because `createBlocker` does:
   * a household that watched "Blocker added" appear should be able to see where
   * it went. `notifyHousehold` is not repeated — an added blocker is news, a
   * removed one is not worth a push.
   */
  async deleteBlocker(
    householdId: string,
    userId: string,
    projectId: string,
    blockerId: string,
  ): Promise<void> {
    await this.requireProjectAccess(householdId, userId, projectId, 'write');
    await this.db
      .delete(homeProjectBlockers)
      .where(
        and(
          eq(homeProjectBlockers.id, blockerId),
          eq(homeProjectBlockers.project_id, projectId),
        ),
      );
    await this.recordActivity(
      projectId,
      userId,
      'blocker_deleted',
      'blocker',
      blockerId,
    );
  }

  /** Put the project's blockers in `blockerIds` order. See `applyOrder`. */
  async reorderBlockers(
    householdId: string,
    userId: string,
    projectId: string,
    blockerIds: string[],
  ): Promise<HomeProjectBlocker[]> {
    await this.requireProjectAccess(householdId, userId, projectId, 'write');
    await this.applyOrder(
      homeProjectBlockers,
      projectId,
      blockerIds,
      'Blocker',
    );
    return this.db
      .select()
      .from(homeProjectBlockers)
      .where(eq(homeProjectBlockers.project_id, projectId))
      .orderBy(asc(homeProjectBlockers.sort_order))
      .all();
  }

  // ---- Attachments ----

  async createAttachmentUpload(
    householdId: string,
    userId: string,
    projectId: string,
    input: {
      filename: string;
      fileSize: number;
      contentType: string;
      kind?: string;
      selectionId?: string;
      tags?: string[];
    },
  ): Promise<{ attachment: HomeProjectAttachment; upload_url: string }> {
    await this.requireProjectAccess(householdId, userId, projectId, 'write');
    if (input.fileSize > MAX_UPLOAD_BYTES) {
      throw new ValidationError('File exceeds 10MB limit');
    }
    if (!ALLOWED_CONTENT_TYPES.has(input.contentType)) {
      throw new ValidationError('Unsupported content type');
    }
    const tags = (input.tags || [])
      .map(t => t.trim().toLowerCase())
      .filter(t => t === 'before' || t === 'after');
    const id = generateId();
    const ext = input.filename.includes('.')
      ? input.filename.split('.').pop()!.toLowerCase()
      : 'bin';
    const r2Key = `home-projects/${householdId}/${projectId}/${id}.${ext}`;
    const now = nowIso();
    await this.db.insert(homeProjectAttachments).values({
      id,
      project_id: projectId,
      selection_id: input.selectionId ?? null,
      kind: input.kind ?? 'photo',
      r2_key: r2Key,
      filename: input.filename,
      content_type: input.contentType,
      file_size: input.fileSize,
      tags: tags.length ? JSON.stringify(tags) : null,
      status: 'pending_upload',
      created_by: userId,
      created_at: now,
      updated_at: now,
    });
    const apiUrl = this.env.API_URL || '';
    const upload_url = `${apiUrl}/households/${householdId}/home-projects/${projectId}/attachments/${id}/upload`;
    const attachment = await this.db
      .select()
      .from(homeProjectAttachments)
      .where(eq(homeProjectAttachments.id, id))
      .get();
    if (!attachment) throw new NotFoundError('Attachment');
    return { attachment, upload_url };
  }

  async uploadAttachmentBytes(
    householdId: string,
    userId: string,
    projectId: string,
    attachmentId: string,
    bytes: ArrayBuffer,
    contentType: string,
  ): Promise<HomeProjectAttachment> {
    await this.requireProjectAccess(householdId, userId, projectId, 'write');
    const row = await this.db
      .select()
      .from(homeProjectAttachments)
      .where(
        and(
          eq(homeProjectAttachments.id, attachmentId),
          eq(homeProjectAttachments.project_id, projectId),
        ),
      )
      .get();
    if (!row) throw new NotFoundError('Attachment');
    if (row.status === 'ready') return row;
    if (!row.r2_key) throw new ValidationError('Missing storage key');
    if (bytes.byteLength > MAX_UPLOAD_BYTES) {
      throw new ValidationError('File exceeds 10MB limit');
    }
    await this.env.REPORTS_BUCKET.put(row.r2_key, bytes, {
      httpMetadata: {
        contentType:
          contentType || row.content_type || 'application/octet-stream',
      },
    });
    await this.db
      .update(homeProjectAttachments)
      .set({
        status: 'ready',
        file_size: bytes.byteLength,
        content_type: contentType || row.content_type,
        updated_at: nowIso(),
      })
      .where(eq(homeProjectAttachments.id, attachmentId));
    const updated = await this.db
      .select()
      .from(homeProjectAttachments)
      .where(eq(homeProjectAttachments.id, attachmentId))
      .get();
    if (!updated) throw new NotFoundError('Attachment');
    return updated;
  }

  // ---- Plan links + geometry ----

  async createPlanLink(
    householdId: string,
    userId: string,
    projectId: string,
    input: { floorPlanId: string; zonePayload?: unknown },
  ): Promise<HomeProjectPlanLink> {
    await this.requireProjectAccess(householdId, userId, projectId, 'write');
    const id = generateId();
    await this.db.insert(homeProjectPlanLinks).values({
      id,
      project_id: projectId,
      floor_plan_id: input.floorPlanId,
      zone_payload: input.zonePayload
        ? JSON.stringify(input.zonePayload)
        : null,
      created_at: nowIso(),
    });
    const row = await this.db
      .select()
      .from(homeProjectPlanLinks)
      .where(eq(homeProjectPlanLinks.id, id))
      .get();
    if (!row) throw new NotFoundError('Plan link');
    return row;
  }

  async putManualGeometry(
    householdId: string,
    userId: string,
    projectId: string,
    payload: unknown,
  ): Promise<HomeProjectGeometry> {
    await this.requireProjectAccess(householdId, userId, projectId, 'write');
    const existing = await this.db
      .select()
      .from(homeProjectGeometry)
      .where(
        and(
          eq(homeProjectGeometry.project_id, projectId),
          eq(homeProjectGeometry.source, 'manual'),
        ),
      )
      .get();
    const now = nowIso();
    const payloadJson = JSON.stringify(payload);
    if (existing) {
      await this.db
        .update(homeProjectGeometry)
        .set({
          payload_json: payloadJson,
          status: 'completed',
          updated_at: now,
        })
        .where(eq(homeProjectGeometry.id, existing.id));
      const row = await this.db
        .select()
        .from(homeProjectGeometry)
        .where(eq(homeProjectGeometry.id, existing.id))
        .get();
      if (!row) throw new NotFoundError('Geometry');
      return row;
    }
    const id = generateId();
    await this.db.insert(homeProjectGeometry).values({
      id,
      project_id: projectId,
      source: 'manual',
      status: 'completed',
      schema_version: 1,
      payload_json: payloadJson,
      confidence: 'user_entered',
      created_at: now,
      updated_at: now,
    });
    const row = await this.db
      .select()
      .from(homeProjectGeometry)
      .where(eq(homeProjectGeometry.id, id))
      .get();
    if (!row) throw new NotFoundError('Geometry');
    return row;
  }

  async putRoomPlanGeometry(
    householdId: string,
    userId: string,
    projectId: string,
    payload: unknown,
  ): Promise<HomeProjectGeometry> {
    await this.requireProjectAccess(householdId, userId, projectId, 'write');
    const existing = await this.db
      .select()
      .from(homeProjectGeometry)
      .where(
        and(
          eq(homeProjectGeometry.project_id, projectId),
          eq(homeProjectGeometry.source, 'roomplan'),
        ),
      )
      .get();
    const now = nowIso();
    const payloadJson = JSON.stringify(payload);
    if (existing) {
      await this.db
        .update(homeProjectGeometry)
        .set({
          payload_json: payloadJson,
          status: 'completed',
          confidence: 'measured',
          disclaimer: null,
          updated_at: now,
        })
        .where(eq(homeProjectGeometry.id, existing.id));
      const row = await this.db
        .select()
        .from(homeProjectGeometry)
        .where(eq(homeProjectGeometry.id, existing.id))
        .get();
      if (!row) throw new NotFoundError('Geometry');
      return row;
    }
    const id = generateId();
    await this.db.insert(homeProjectGeometry).values({
      id,
      project_id: projectId,
      source: 'roomplan',
      status: 'completed',
      schema_version: 1,
      payload_json: payloadJson,
      confidence: 'measured',
      created_at: now,
      updated_at: now,
    });
    const row = await this.db
      .select()
      .from(homeProjectGeometry)
      .where(eq(homeProjectGeometry.id, id))
      .get();
    if (!row) throw new NotFoundError('Geometry');
    return row;
  }

  /**
   * A scan no longer invents materials.
   *
   * `suggestTakeoffFromGeometry` used to fire on every RoomPlan scan and write
   * two selections — "Flooring ~12.4 m² (from plan)" and "Paint ~4 L" — into a
   * list the member had not added anything to. They were guesses, they were
   * priced at nothing, and they arrived unasked.
   *
   * The surface planner does this properly now: `computeTakeoff` derives the
   * quantities from the stored geometry and the member's own material sizes,
   * and they reach the project only when someone taps "Add these to the
   * project's materials". Nothing writes a material but a member.
   */

  async enqueueAiSchematic(
    householdId: string,
    userId: string,
    projectId: string,
    attachmentIds?: string[],
  ): Promise<HomeProjectGeometry> {
    await this.requireProjectAccess(householdId, userId, projectId, 'write');
    if (!this.env.HOME_PROJECT_SCHEMATIC_QUEUE) {
      throw new ValidationError('Schematic queue is not configured');
    }

    const attachments = await this.db
      .select()
      .from(homeProjectAttachments)
      .where(eq(homeProjectAttachments.project_id, projectId))
      .all();
    const keys = attachments
      .filter(
        a =>
          a.status === 'ready' &&
          a.r2_key &&
          (!attachmentIds?.length || attachmentIds.includes(a.id)),
      )
      .map(a => a.r2_key!)
      .slice(0, 8);

    const existing = await this.db
      .select()
      .from(homeProjectGeometry)
      .where(
        and(
          eq(homeProjectGeometry.project_id, projectId),
          eq(homeProjectGeometry.source, 'ai_schematic'),
        ),
      )
      .get();
    const now = nowIso();
    let geometryId: string;
    if (existing) {
      if (existing.status === 'generating') {
        throw new ConflictError('Schematic generation already in progress');
      }
      geometryId = existing.id;
      await this.db
        .update(homeProjectGeometry)
        .set({
          status: 'generating',
          error_code: null,
          payload_json: null,
          disclaimer: 'Approximate — verify before buying',
          updated_at: now,
        })
        .where(eq(homeProjectGeometry.id, geometryId));
    } else {
      geometryId = generateId();
      await this.db.insert(homeProjectGeometry).values({
        id: geometryId,
        project_id: projectId,
        source: 'ai_schematic',
        status: 'generating',
        schema_version: 1,
        disclaimer: 'Approximate — verify before buying',
        created_at: now,
        updated_at: now,
      });
    }

    await this.env.HOME_PROJECT_SCHEMATIC_QUEUE.send({
      geometryId,
      projectId,
      householdId,
      userId,
      attachmentR2Keys: keys,
      enqueuedAt: Date.now(),
    });

    const row = await this.db
      .select()
      .from(homeProjectGeometry)
      .where(eq(homeProjectGeometry.id, geometryId))
      .get();
    if (!row) throw new NotFoundError('Geometry');
    return row;
  }

  async cancelGeometryJob(
    householdId: string,
    userId: string,
    projectId: string,
    geometryId: string,
  ): Promise<HomeProjectGeometry> {
    await this.requireProjectAccess(householdId, userId, projectId, 'write');
    const row = await this.db
      .select()
      .from(homeProjectGeometry)
      .where(
        and(
          eq(homeProjectGeometry.id, geometryId),
          eq(homeProjectGeometry.project_id, projectId),
        ),
      )
      .get();
    if (!row) throw new NotFoundError('Geometry');
    if (row.status !== 'generating') {
      throw new ConflictError('Geometry job is not generating');
    }
    await this.db
      .update(homeProjectGeometry)
      .set({
        status: 'failed',
        error_code: 'cancelled_by_user',
        updated_at: nowIso(),
      })
      .where(eq(homeProjectGeometry.id, geometryId));
    const updated = await this.db
      .select()
      .from(homeProjectGeometry)
      .where(eq(homeProjectGeometry.id, geometryId))
      .get();
    if (!updated) throw new NotFoundError('Geometry');
    return updated;
  }

  /**
   * Render one surface photorealistically and file it as a project attachment.
   *
   * The interesting part is in `home-projects/surface-preview.ts`; this method
   * is the wiring — access check, the three lookups that module needs, and
   * storing the bytes. It is deliberately thin, because the thing that must not
   * drift is the arithmetic, and that lives in `@symply/contracts` where the
   * app computes it from the same document.
   *
   * The attachment is `kind: 'ai_render'` rather than `'photo'`, so a generated
   * picture never appears in the hub's before/after gallery beside photographs
   * of the actual room. That distinction has to hold in the data, not in a
   * caption: an AI render filed as a photo is a picture of a room that does not
   * exist, sitting in the record of one that does.
   */
  async generateSurfacePreview(
    householdId: string,
    userId: string,
    projectId: string,
    input: { surfaceId: string; layoutPngBase64?: string },
  ): Promise<{
    attachment: HomeProjectAttachment;
    brief: SurfaceScaleBrief;
    model: string;
  }> {
    await this.requireProjectAccess(householdId, userId, projectId, 'write');

    const result = await generateSurfacePreview(
      {
        env: this.env,
        loadGeometryPayload: async id => {
          const row = await this.db
            .select()
            .from(homeProjectGeometry)
            .where(eq(homeProjectGeometry.project_id, id))
            .orderBy(desc(homeProjectGeometry.updated_at))
            .get();
          return row?.payload_json ?? null;
        },
        resolveAttachmentKey: async (id, attachmentId) => {
          const row = await this.db
            .select()
            .from(homeProjectAttachments)
            .where(
              and(
                eq(homeProjectAttachments.id, attachmentId),
                eq(homeProjectAttachments.project_id, id),
              ),
            )
            .get();
          return row
            ? { r2_key: row.r2_key, content_type: row.content_type }
            : null;
        },
        imageProvider: () =>
          imageCapableProviderFor(this.env, userId, {
            feature: 'home_project_surface_preview',
            householdId,
            userId,
          }),
      },
      {
        projectId,
        surfaceId: input.surfaceId,
        layoutPngBase64: input.layoutPngBase64,
      },
    );

    const { attachment } = await this.createAttachmentUpload(
      householdId,
      userId,
      projectId,
      {
        filename: `surface-${input.surfaceId}.png`,
        fileSize: result.bytes.byteLength,
        contentType: result.mime,
        kind: 'ai_render',
      },
    );
    const stored = await this.uploadAttachmentBytes(
      householdId,
      userId,
      projectId,
      attachment.id,
      result.bytes,
      result.mime,
    );

    // The brief is recorded on the activity feed rather than only returned,
    // because "what was this picture told" is a question a member asks later,
    // after they have decided something because of it.
    await this.recordActivity(
      projectId,
      userId,
      'surface_preview_generated',
      'attachment',
      stored.id,
      {
        surfaceId: input.surfaceId,
        surfaceLabel: result.brief.surfaceLabel,
        model: result.model,
        usedLayoutReference: result.usedLayoutReference,
        materialReferenceCount: result.materialReferenceCount,
      },
    );

    return { attachment: stored, brief: result.brief, model: result.model };
  }

  async exportProjectSummary(
    householdId: string,
    userId: string,
    projectId: string,
  ): Promise<{ shareText: string; pdfUrl: string | null }> {
    const hub = await this.getHub(householdId, userId, projectId);
    const lines = [
      `Home Project: ${hub.project.title}`,
      `Status: ${hub.project.status} · Type: ${hub.project.type}`,
      `Budget target: ${
        hub.rollups.target_budget_cents != null
          ? `$${(hub.rollups.target_budget_cents / 100).toFixed(0)}`
          : 'n/a'
      }`,
      `Estimate: $${(hub.rollups.estimate_total / 100).toFixed(
        0,
      )} · Actual: $${(hub.rollups.actual_total / 100).toFixed(0)}`,
      `Health: ${hub.rollups.budget_health}`,
      '',
      'Selections:',
      ...hub.selections.map(
        s =>
          `- ${s.name}${
            s.unit_price_cents != null
              ? ` ($${(s.unit_price_cents / 100).toFixed(0)})`
              : ''
          }`,
      ),
      '',
      'Phases:',
      ...hub.phases.map(p => `- ${p.title} (${p.status})`),
    ];
    const shareText = lines.join('\n');
    const exportId = generateId();
    const txtKey = `home-projects/${householdId}/${projectId}/export-${exportId}.txt`;
    const pdfKey = `home-projects/${householdId}/${projectId}/export-${exportId}.pdf`;
    await this.env.REPORTS_BUCKET.put(txtKey, shareText, {
      httpMetadata: { contentType: 'text/plain; charset=utf-8' },
    });
    const pdfBytes = buildSimplePdf(hub.project.title, lines.slice(1));
    await this.env.REPORTS_BUCKET.put(pdfKey, pdfBytes, {
      httpMetadata: { contentType: 'application/pdf' },
    });
    const apiUrl = (this.env.API_URL || '').replace(/\/$/, '');
    const pdfUrl = `${apiUrl}/households/${householdId}/home-projects/${projectId}/exports/${exportId}/pdf`;
    return { shareText, pdfUrl };
  }

  async getExportPdf(
    householdId: string,
    userId: string,
    projectId: string,
    exportId: string,
  ): Promise<{ body: ArrayBuffer; contentType: string; filename: string }> {
    await this.requireProjectAccess(householdId, userId, projectId, 'read');
    const key = `home-projects/${householdId}/${projectId}/export-${exportId}.pdf`;
    const obj = await this.env.REPORTS_BUCKET.get(key);
    if (!obj) throw new NotFoundError('Export');
    return {
      body: await obj.arrayBuffer(),
      contentType: 'application/pdf',
      filename: `home-project-${projectId}.pdf`,
    };
  }

  // ---- Comments / activity (P1) ----

  async addComment(
    householdId: string,
    userId: string,
    projectId: string,
    input: { body: string; selectionId?: string },
  ): Promise<HomeProjectComment> {
    await this.requireProjectAccess(householdId, userId, projectId, 'write');
    if (!input.body.trim()) throw new ValidationError('Comment body required');
    const id = generateId();
    await this.db.insert(homeProjectComments).values({
      id,
      project_id: projectId,
      selection_id: input.selectionId ?? null,
      user_id: userId,
      body: input.body.trim(),
      created_at: nowIso(),
    });
    await this.recordActivity(
      projectId,
      userId,
      'comment_added',
      'comment',
      id,
    );
    const mentionIds = [...input.body.matchAll(/@([a-zA-Z0-9_-]{6,})/g)].map(
      m => m[1],
    );
    if (mentionIds.length > 0) {
      const members = new Set(await this.getHouseholdMemberIds(householdId));
      const project = await this.getOwnedProject(householdId, projectId);
      await Promise.all(
        mentionIds
          .filter(uid => members.has(uid) && uid !== userId)
          .map(mentionUserId =>
            this.notifications
              .sendNotification({
                userId: mentionUserId,
                type: 'home_project_mentioned',
                title: 'Mentioned on a home project',
                body: `You were mentioned on "${project.title}"`,
                data: {
                  type: 'home_project_mentioned',
                  home_project_id: projectId,
                  projectId,
                  householdId,
                  screen: 'HomeProjectHub',
                },
                referenceType: 'home_project',
                referenceId: projectId,
              })
              .catch(() => undefined),
          ),
      );
    }
    const row = await this.db
      .select()
      .from(homeProjectComments)
      .where(eq(homeProjectComments.id, id))
      .get();
    if (!row) throw new NotFoundError('Comment');
    return row;
  }

  async listActivity(
    householdId: string,
    userId: string,
    projectId: string,
    cursor?: string,
    limit = 50,
  ): Promise<{ items: HomeProjectActivityRow[]; next_cursor: string | null }> {
    await this.requireProjectAccess(householdId, userId, projectId, 'read');
    const rows = await this.db
      .select()
      .from(homeProjectActivity)
      .where(eq(homeProjectActivity.project_id, projectId))
      .orderBy(desc(homeProjectActivity.created_at))
      .all();
    let filtered = rows;
    if (cursor) {
      const idx = rows.findIndex(r => r.id === cursor);
      filtered = idx >= 0 ? rows.slice(idx + 1) : rows;
    }
    const page = filtered.slice(0, limit);
    const next =
      filtered.length > limit ? page[page.length - 1]?.id ?? null : null;
    return { items: page, next_cursor: next };
  }

  /**
   * Attach an existing household task to this project.
   *
   * The link is `home_projects.linked_task_ids` since migration 0170, not a row
   * in a join table — see `@symply/contracts/home-project-linked-tasks` for why.
   * Idempotent: `withHomeProjectLinkedTask` returns the array it was given when
   * the id is already there, so a re-link writes nothing and records no second
   * activity entry, exactly as the join table's existence check did.
   *
   * **`updated_at` now moves where it did not before**, because the write lands
   * on the project row rather than in a side table, and `listProjects` orders by
   * `updated_at desc` — so linking a task lifts the project up the list. That is
   * the intended reading (something changed on this project) and it is the same
   * behaviour `setProjectAccess` already has for the other list-on-the-parent.
   * It also matters mechanically: the hub's Tasks tab re-reads on
   * `project.updated_at`, so a link made elsewhere shows up without a manual
   * refresh.
   */
  async linkTask(
    householdId: string,
    userId: string,
    projectId: string,
    taskId: string,
  ): Promise<{ project_id: string; task_id: string }> {
    const project = await this.requireProjectAccess(
      householdId,
      userId,
      projectId,
      'write',
    );
    // Validate task belongs to household when tasks table is available
    const taskRow = await this.env.DB.prepare(
      `SELECT id FROM tasks WHERE id = ? AND household_id = ? LIMIT 1`,
    )
      .bind(taskId, householdId)
      .first<{ id: string }>();
    if (!taskRow) throw new NotFoundError('Task');

    const current = parseHomeProjectLinkedTaskIds(project.linked_task_ids);
    const next = withHomeProjectLinkedTask(current, taskId);
    if (next !== current) {
      await this.db
        .update(homeProjects)
        .set({
          linked_task_ids: serializeHomeProjectLinkedTaskIds(next),
          updated_by: userId,
          updated_at: nowIso(),
        })
        .where(eq(homeProjects.id, projectId));
      await this.recordActivity(
        projectId,
        userId,
        'task_linked',
        'task',
        taskId,
      );
    }
    return { project_id: projectId, task_id: taskId };
  }

  async createTaskFromProject(
    householdId: string,
    userId: string,
    projectId: string,
    input: { title: string; description?: string },
  ): Promise<{ project_id: string; task_id: string; title: string }> {
    const project = await this.requireProjectAccess(
      householdId,
      userId,
      projectId,
      'write',
    );
    const title = input.title.trim();
    if (!title) throw new ValidationError('Task title required');
    const taskService = new TaskService(this.env, this.env.DB);
    const task = await taskService.createTask(householdId, userId, {
      title,
      description:
        input.description?.trim() || `From home project “${project.title}”.`,
      frequency: 'one_time',
      priority_severity: 'medium',
    });
    await this.linkTask(householdId, userId, projectId, task.id);
    return { project_id: projectId, task_id: task.id, title: task.title };
  }

  async listLinkedTasks(
    householdId: string,
    userId: string,
    projectId: string,
  ): Promise<
    Array<{
      task_id: string;
      title: string | null;
      next_due_date: string | null;
    }>
  > {
    const project = await this.requireProjectAccess(
      householdId,
      userId,
      projectId,
      'read',
    );
    const linkedIds = parseHomeProjectLinkedTaskIds(project.linked_task_ids);
    const out: Array<{
      task_id: string;
      title: string | null;
      next_due_date: string | null;
    }> = [];
    // A task deleted from the board is skipped rather than reported, exactly as
    // it was under the join table: `tasks` is hard-deleted and the join had no
    // foreign key to cascade, so a dangling id was always the normal case here.
    for (const taskId of linkedIds) {
      const row = await this.env.DB.prepare(
        `SELECT id, title, next_due_date FROM tasks WHERE id = ? AND household_id = ? LIMIT 1`,
      )
        .bind(taskId, householdId)
        .first<{
          id: string;
          title: string | null;
          next_due_date: string | null;
        }>();
      if (row) {
        out.push({
          task_id: row.id,
          title: row.title,
          next_due_date: row.next_due_date,
        });
      }
    }
    return out;
  }

  async linkContractor(
    householdId: string,
    userId: string,
    projectId: string,
    contractorId: string,
    quoteId?: string,
  ): Promise<{ project_id: string; contractor_id: string }> {
    await this.requireProjectAccess(householdId, userId, projectId, 'write');
    const contractor = await this.env.DB.prepare(
      `SELECT id FROM contractors WHERE id = ? AND household_id = ? LIMIT 1`,
    )
      .bind(contractorId, householdId)
      .first<{ id: string }>();
    if (!contractor) throw new NotFoundError('Contractor');
    if (quoteId) {
      const quote = await this.env.DB.prepare(
        `SELECT id FROM quotes WHERE id = ? AND household_id = ? LIMIT 1`,
      )
        .bind(quoteId, householdId)
        .first<{ id: string }>();
      if (!quote) throw new NotFoundError('Quote');
    }
    const existing = await this.db
      .select()
      .from(homeProjectContractors)
      .where(
        and(
          eq(homeProjectContractors.project_id, projectId),
          eq(homeProjectContractors.contractor_id, contractorId),
        ),
      )
      .get();
    if (!existing) {
      await this.db.insert(homeProjectContractors).values({
        project_id: projectId,
        contractor_id: contractorId,
        quote_id: quoteId ?? null,
        created_at: nowIso(),
      });
    }
    return { project_id: projectId, contractor_id: contractorId };
  }

  /**
   * The cost hint this used to carry (`costHintCents` / `costHintLabel`, a
   * national average captioned "varies by location") is gone. It was a guess
   * made without this household's city, contractor or scope, and shown at the
   * moment a member picks a template — which anchors whatever they budget next.
   * The member sets the budget themselves; the template supplies structure.
   */
  // =========================================================================
  // Smart Project — describe-to-draft (migration 0166)
  // =========================================================================

  /**
   * Start a describe-to-draft generation.
   *
   * Creates the project **as a draft** and returns immediately; the queue does
   * the work. `visibility: 'draft'` is the whole safety model — from this
   * moment the project exists, but only for its creator: no other member lists
   * it, opens it, or is notified about it, and a peer asking for it by id gets
   * `NotFound` rather than `Forbidden`. That is what makes it safe to have a
   * language model write real rows.
   */
  async enqueueSmartDraft(
    householdId: string,
    userId: string,
    input: SmartProjectRequest,
  ): Promise<{ project: HomeProject; draft: HomeProjectSmartDraft }> {
    await this.checkHouseholdAccess(householdId, userId);

    const parsed = smartProjectRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? 'Invalid smart project request',
      );
    }
    const request = parsed.data;

    if (!this.env.HOME_PROJECT_SMART_DRAFT_QUEUE) {
      throw new ValidationError('Smart project queue is not configured');
    }

    // The title is a placeholder until the model returns one. "New home
    // project" rather than an excerpt of the description: a half-sentence
    // truncated mid-word reads as a bug while the job runs.
    const project = await this.createProject(householdId, userId, {
      title: 'Drafting…',
      summary: request.description,
      visibility: 'draft',
      spaceIds: request.space_id ? [request.space_id] : undefined,
    });

    const now = nowIso();
    const draftId = generateId();
    await this.db.insert(homeProjectSmartDrafts).values({
      id: draftId,
      project_id: project.id,
      status: 'generating',
      description: request.description,
      spaces_json: request.spaces?.length ? JSON.stringify(request.spaces) : null,
      attachment_ids_json: request.attachment_ids?.length
        ? JSON.stringify(request.attachment_ids)
        : null,
      created_by: userId,
      created_at: now,
      updated_at: now,
    });

    const attachmentR2Keys = await this.resolveAttachmentKeys(
      project.id,
      request.attachment_ids,
    );

    await this.env.HOME_PROJECT_SMART_DRAFT_QUEUE.send({
      draftId,
      projectId: project.id,
      householdId,
      userId,
      attachmentR2Keys,
      knownSpaceNames: await this.householdSpaceNames(householdId),
      templateKeys: Object.keys(HOME_PROJECT_TEMPLATES),
      enqueuedAt: Date.now(),
    });

    const draft = await this.db
      .select()
      .from(homeProjectSmartDrafts)
      .where(eq(homeProjectSmartDrafts.id, draftId))
      .get();

    return { project, draft: draft! };
  }

  /**
   * Draft a project and RETURN it — no rows, no project, no draft record.
   *
   * The client saves the result through `homeProjectsApi`, which routes to the
   * device ledger on a local-first household and to D1 on a server-backed one.
   * That is what lets Smart Project ship on House at all: the older path wrote
   * the project into D1, where a local-first member's own phone could never
   * read it. See BRD §12 Q4.
   *
   * Returns `null` on a malformed generation so the route can answer 422 —
   * retrying the same prompt against the same model reproduces it, so it is not
   * a transient failure to be retried behind the member's back.
   */
  /**
   * Where a photo lives while the project it describes does not exist yet.
   *
   * `home_project_attachments.project_id` is NOT NULL behind a cascade FK, so a
   * draft photo cannot be a row in that table: the project it would have to
   * point at is precisely what the member is asking the model to invent. That
   * is why `attachment_ids` was unreachable from the wizard — the id had no way
   * to come into existence. Draft photos are therefore plain R2 objects,
   * referenced by key.
   *
   * The household id is IN the key, and every read re-checks it, so a key
   * guessed or replayed from another household resolves to nothing.
   */
  private smartDraftPhotoPrefix(householdId: string): string {
    return `home-projects/${householdId}/smart-drafts/`;
  }

  /**
   * Store one photo for a plan that has no project yet; return its key.
   *
   * Single round trip rather than the create-row-then-PUT dance the project
   * attachments use, because there is no row to create — the two-step exists to
   * hand out an id, and here the key IS the id.
   */
  async uploadSmartDraftPhoto(
    householdId: string,
    userId: string,
    bytes: ArrayBuffer,
    contentType: string,
  ): Promise<{ key: string; content_type: string; size: number }> {
    await this.checkHouseholdAccess(householdId, userId);
    if (bytes.byteLength === 0) {
      throw new ValidationError('Empty file');
    }
    if (bytes.byteLength > MAX_UPLOAD_BYTES) {
      throw new ValidationError('File exceeds 10MB limit');
    }
    // The generator can only send image blocks to the provider; a PDF here
    // would be uploaded, charged for and silently ignored.
    const type = (contentType || '').split(';')[0]!.trim().toLowerCase();
    if (!SMART_DRAFT_PHOTO_TYPES.has(type)) {
      throw new ValidationError('Unsupported content type');
    }
    const ext =
      type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
    const key = `${this.smartDraftPhotoPrefix(householdId)}${generateId()}.${ext}`;
    await this.env.REPORTS_BUCKET.put(key, bytes, {
      httpMetadata: { contentType: type },
    });
    return { key, content_type: type, size: bytes.byteLength };
  }

  /**
   * Drop draft photos once they have been read.
   *
   * A generation input is not a household document. Keeping it would leave a
   * member's photos of their own home sitting in R2 attached to nothing, with
   * no screen that lists them and no delete that reaches them — and on a
   * local-first household, R2 is not where those photos are meant to live at
   * all. Best-effort: a failed delete must not fail a good draft.
   */
  private async purgeSmartDraftPhotos(keys: string[]): Promise<void> {
    await Promise.all(
      keys.map(async key => {
        try {
          await this.env.REPORTS_BUCKET.delete(key);
        } catch (err) {
          console.error('[smart-draft] photo purge failed', { key, err });
        }
      }),
    );
  }

  async generateSmartProjectPlan(
    householdId: string,
    userId: string,
    input: {
      description: string;
      spaces: SmartProjectSpaceDimensions[];
      attachmentIds: string[];
      photoKeys?: string[];
      /**
       * The project being re-planned, as the CLIENT sees it.
       *
       * Not loaded here: on a local-first household these phases live in the
       * device ledger and this Worker cannot read them. Trusting the client for
       * context it can only use to constrain its own result is safe — the worst
       * a bad `existing` can do is suppress phases the member then adds by hand.
       */
      existing?: {
        title: string;
        targetUse?: string | null;
        phases: Array<{ title: string; status: string }>;
      };
      /**
       * Which sections the member ticked in the wizard. Passed straight
       * through — the generator both instructs the model and enforces it on the
       * way back, so nothing here has to decide what an absent flag means.
       */
      include?: SmartProjectInclude;
    },
  ): Promise<SmartProjectPlan | null> {
    await this.checkHouseholdAccess(householdId, userId);

    // Attachments are resolved by household, not by project: there is no
    // project yet, and on a local-first household there never will be one here.
    const attachmentKeys = await this.resolveHouseholdAttachmentKeys(
      householdId,
      input.attachmentIds,
    );

    // Draft photos are trusted only by their prefix, which the server wrote and
    // which carries this household's id. A key from another household — or a
    // path traversal dressed as one — never reaches R2.
    const prefix = this.smartDraftPhotoPrefix(householdId);
    const draftKeys = (input.photoKeys ?? [])
      .filter(k => k.startsWith(prefix) && !k.includes('..'))
      .slice(0, 8);

    const keys = [...attachmentKeys, ...draftKeys].slice(0, 8);

    try {
      return await generateSmartProjectPlan(this.env, {
        householdId,
        userId,
        description: input.description,
        spaces: input.spaces,
        attachmentR2Keys: keys,
        knownSpaceNames: await this.householdSpaceNames(householdId),
        templateKeys: Object.keys(HOME_PROJECT_TEMPLATES),
        existing: input.existing,
        include: input.include,
      });
    } finally {
      // `finally`, not the success path: a malformed generation has still read
      // the photos, and a member who retries uploads again.
      if (draftKeys.length) await this.purgeSmartDraftPhotos(draftKeys);
    }
  }

  /**
   * Photo keys for attachments the member uploaded, scoped to their household.
   *
   * The project-scoped resolver cannot be used: a plan is drafted before any
   * project exists.
   */
  private async resolveHouseholdAttachmentKeys(
    householdId: string,
    attachmentIds: string[],
  ): Promise<string[]> {
    if (!attachmentIds.length) return [];
    const rows = await this.db
      .select()
      .from(homeProjectAttachments)
      .where(inArray(homeProjectAttachments.id, attachmentIds.slice(0, 8)))
      .all();
    // Belt and braces: only ready uploads, and only ones whose key is namespaced
    // to this household, so an id from another household cannot pull its photo.
    return rows
      .filter(
        a =>
          a.status === 'ready' &&
          a.r2_key &&
          a.r2_key.includes(householdId),
      )
      .map(a => a.r2_key!)
      .slice(0, 8);
  }

  /** Ready-to-read photo keys for the attachments the member picked. */
  private async resolveAttachmentKeys(
    projectId: string,
    attachmentIds?: string[],
  ): Promise<string[]> {
    if (!attachmentIds?.length) return [];
    const rows = await this.db
      .select()
      .from(homeProjectAttachments)
      .where(eq(homeProjectAttachments.project_id, projectId))
      .all();
    return rows
      .filter(
        a => a.status === 'ready' && a.r2_key && attachmentIds.includes(a.id),
      )
      .map(a => a.r2_key!)
      .slice(0, 8);
  }

  private async householdSpaceNames(householdId: string): Promise<string[]> {
    try {
      const rows = await this.db.all<{ name: string }>(
        sql`SELECT name FROM household_spaces WHERE household_id = ${householdId} LIMIT 40`,
      );
      return rows.map(r => r.name).filter(Boolean);
    } catch {
      // A brand whose D1 has no household_spaces table still gets a draft.
      return [];
    }
  }

  async getSmartDraft(
    householdId: string,
    userId: string,
    projectId: string,
  ): Promise<HomeProjectSmartDraft | null> {
    await this.requireProjectAccess(householdId, userId, projectId, 'read');
    const row = await this.db
      .select()
      .from(homeProjectSmartDrafts)
      .where(eq(homeProjectSmartDrafts.project_id, projectId))
      .orderBy(desc(homeProjectSmartDrafts.created_at))
      .get();
    return row ?? null;
  }

  /**
   * Stop a generation the member no longer wants.
   *
   * Marks the row `cancelled` rather than deleting it: the queue message is
   * already in flight and cannot be recalled, and the handler's first act is to
   * check that the row still says `generating`. A deleted row would make the
   * handler retry a missing id instead of stopping cleanly.
   */
  async cancelSmartDraft(
    householdId: string,
    userId: string,
    projectId: string,
    draftId: string,
  ): Promise<HomeProjectSmartDraft> {
    await this.requireProjectAccess(householdId, userId, projectId, 'write');
    const row = await this.db
      .select()
      .from(homeProjectSmartDrafts)
      .where(eq(homeProjectSmartDrafts.id, draftId))
      .get();
    if (!row || row.project_id !== projectId) {
      throw new NotFoundError('Smart draft not found');
    }
    if (row.status !== 'generating') return row;

    await this.db
      .update(homeProjectSmartDrafts)
      .set({ status: 'cancelled', updated_at: nowIso() })
      .where(eq(homeProjectSmartDrafts.id, draftId));

    return (await this.db
      .select()
      .from(homeProjectSmartDrafts)
      .where(eq(homeProjectSmartDrafts.id, draftId))
      .get())!;
  }

  /**
   * Publish a reviewed draft to the household.
   *
   * This is the act the whole feature is built around: until it runs, nothing
   * the model produced has reached anybody. It does three things, in this
   * order, and the order matters —
   *
   *  1. materialise the generated tasks as real House tasks (they were held on
   *     the draft row precisely so they would not exist before now),
   *  2. flip `visibility` to `published`,
   *  3. notify the household.
   *
   * Notifying before flipping visibility would send members to a project that
   * still answers `NotFound`.
   */
  async publishSmartDraft(
    householdId: string,
    userId: string,
    projectId: string,
  ): Promise<HomeProject> {
    const project = await this.requireProjectAccess(
      householdId,
      userId,
      projectId,
      'manage',
    );

    if (normalizeHomeProjectVisibility(project.visibility) === 'published') {
      return project;
    }

    const draft = await this.db
      .select()
      .from(homeProjectSmartDrafts)
      .where(eq(homeProjectSmartDrafts.project_id, projectId))
      .orderBy(desc(homeProjectSmartDrafts.created_at))
      .get();

    // A draft still generating must not be published: half its rows do not
    // exist yet, and the member would be sharing an incomplete plan.
    if (draft?.status === 'generating') {
      throw new ConflictError('Draft is still generating');
    }

    if (draft?.tasks_json) {
      let tasks: Array<{ title?: unknown; rationale?: unknown }> = [];
      try {
        const raw: unknown = JSON.parse(draft.tasks_json);
        if (Array.isArray(raw)) tasks = raw;
      } catch {
        tasks = [];
      }
      for (const task of tasks) {
        const title = typeof task.title === 'string' ? task.title.trim() : '';
        if (!title) continue;
        try {
          await this.createTaskFromProject(householdId, userId, projectId, {
            title,
            description:
              typeof task.rationale === 'string' ? task.rationale : undefined,
          });
        } catch (err) {
          // One bad task must not block the publish the member asked for.
          console.error('[smart-draft] task creation failed', err);
        }
      }
      await this.db
        .update(homeProjectSmartDrafts)
        .set({ tasks_json: null, updated_at: nowIso() })
        .where(eq(homeProjectSmartDrafts.id, draft.id));
    }

    await this.db
      .update(homeProjects)
      .set({
        visibility: 'published',
        updated_by: userId,
        updated_at: nowIso(),
      })
      .where(eq(homeProjects.id, projectId));

    const published = (await this.db
      .select()
      .from(homeProjects)
      .where(eq(homeProjects.id, projectId))
      .get())!;

    await this.notifyHousehold(
      householdId,
      userId,
      projectId,
      'home_project_published',
      'New home project',
      `${published.title} was shared with the household`,
    );

    return published;
  }

  // ---- as-is state --------------------------------------------------------

  async listAsIs(
    householdId: string,
    userId: string,
    projectId: string,
  ): Promise<HomeProjectAsIs[]> {
    await this.requireProjectAccess(householdId, userId, projectId, 'read');
    return this.db
      .select()
      .from(homeProjectAsIs)
      .where(eq(homeProjectAsIs.project_id, projectId))
      .all();
  }

  /**
   * Record or correct what already exists.
   *
   * A member's answer is always `source: 'manual'`, even when they are merely
   * confirming what the model said. Once they have looked at it and let it
   * stand, it is their answer, and continuing to badge it as AI output would
   * misattribute their decision back to the machine.
   */
  async upsertAsIs(
    householdId: string,
    userId: string,
    projectId: string,
    input: { element: string; state: string; evidence?: string | null },
  ): Promise<HomeProjectAsIs> {
    await this.requireProjectAccess(householdId, userId, projectId, 'write');

    const element = asIsElementSchema.safeParse(input.element);
    if (!element.success) throw new ValidationError('Unknown as-is element');
    const state = asIsStateSchema.safeParse(input.state);
    if (!state.success) throw new ValidationError('Unknown as-is state');

    const now = nowIso();
    const existing = await this.db
      .select()
      .from(homeProjectAsIs)
      .where(
        and(
          eq(homeProjectAsIs.project_id, projectId),
          eq(homeProjectAsIs.element, element.data),
        ),
      )
      .get();

    if (existing) {
      await this.db
        .update(homeProjectAsIs)
        .set({
          state: state.data,
          evidence: input.evidence ?? existing.evidence,
          source: MANUAL_SOURCE,
          updated_at: now,
        })
        .where(eq(homeProjectAsIs.id, existing.id));
      return (await this.db
        .select()
        .from(homeProjectAsIs)
        .where(eq(homeProjectAsIs.id, existing.id))
        .get())!;
    }

    const id = generateId();
    await this.db.insert(homeProjectAsIs).values({
      id,
      project_id: projectId,
      element: element.data,
      state: state.data,
      evidence: input.evidence ?? null,
      source: MANUAL_SOURCE,
      created_at: now,
      updated_at: now,
    });
    return (await this.db
      .select()
      .from(homeProjectAsIs)
      .where(eq(homeProjectAsIs.id, id))
      .get())!;
  }

  async deleteAsIs(
    householdId: string,
    userId: string,
    projectId: string,
    asIsId: string,
  ): Promise<{ deleted: boolean }> {
    await this.requireProjectAccess(householdId, userId, projectId, 'write');
    await this.db
      .delete(homeProjectAsIs)
      .where(
        and(
          eq(homeProjectAsIs.id, asIsId),
          eq(homeProjectAsIs.project_id, projectId),
        ),
      );
    return { deleted: true };
  }

  listTemplates(): Array<{
    key: TemplateKey;
    title: string;
    type: string;
  }> {
    return Object.values(HOME_PROJECT_TEMPLATES).map(t => ({
      key: t.key,
      title: t.title,
      type: t.type,
    }));
  }
}
