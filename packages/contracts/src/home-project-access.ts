/**
 * Who may see and who may change one home project.
 *
 * Two orthogonal questions, and keeping them apart is the whole design:
 *
 *  - **`visibility`** answers "does this project exist for you at all". A
 *    `draft` is the member's own scratch plan — nobody else in the household
 *    lists it, opens it, or gets a notification about it. `published` is the
 *    old behaviour and stays the default, so every project that predates this
 *    file keeps behaving exactly as it did.
 *  - **`default_role` + `access_json`** answer "may you change it". `owner` may
 *    edit the project and manage its access; `viewer` may read it and nothing
 *    else. `default_role` is what a household member with no explicit grant
 *    gets, and it defaults to `owner` for the same reason — before this file
 *    every member of the household could edit every project, and a migration
 *    must not quietly take that away from anyone.
 *
 * **This module is the single resolver for both backends.** `home-projects-
 * service.ts` (Worker/D1) and `localHomeProjectsApi.ts` (device ledger) both
 * call `effectiveHomeProjectRole` and `canViewHomeProject` rather than
 * re-deriving the rule, because a permission that differs by backend is a
 * permission that leaks: the same member would be a viewer online and an owner
 * in a basement. The UI calls them too, so the button it hides is the button
 * the server would have refused.
 */
import { z } from 'zod';

/** `home_projects.visibility`. */
export const HOME_PROJECT_VISIBILITIES = ['draft', 'published'] as const;
export type HomeProjectVisibility = (typeof HOME_PROJECT_VISIBILITIES)[number];

/** `home_projects.default_role` and every `access_json` grant. */
export const HOME_PROJECT_ROLES = ['owner', 'viewer'] as const;
export type HomeProjectRole = (typeof HOME_PROJECT_ROLES)[number];

export const homeProjectVisibilitySchema = z.enum(HOME_PROJECT_VISIBILITIES);
export const homeProjectRoleSchema = z.enum(HOME_PROJECT_ROLES);

/** One explicit per-member override, as stored inside `access_json`. */
export const homeProjectAccessGrantSchema = z.object({
  user_id: z.string().min(1).max(64),
  role: homeProjectRoleSchema,
});
export type HomeProjectAccessGrant = z.infer<typeof homeProjectAccessGrantSchema>;

/**
 * The whole `access_json` payload. Capped because it is a column, not a table:
 * a household with more than 50 people is not the shape this models, and an
 * uncapped JSON array is an unbounded write.
 */
export const homeProjectAccessGrantsSchema = z.array(homeProjectAccessGrantSchema).max(50);

/** The two access fields, as a request body (`PUT /:projectId/access`). */
export const homeProjectAccessUpdateSchema = z.object({
  defaultRole: homeProjectRoleSchema,
  grants: homeProjectAccessGrantsSchema,
});
export type HomeProjectAccessUpdate = z.infer<typeof homeProjectAccessUpdateSchema>;

/** One row of the manage-access screen. */
export const homeProjectAccessMemberSchema = z.object({
  user_id: z.string(),
  display_name: z.string().nullable(),
  email: z.string().nullable(),
  avatar_url: z.string().nullable(),
  /** What this member can actually do right now. */
  role: homeProjectRoleSchema,
  /**
   * Why they have it. `creator` cannot be changed — the person who made the
   * project keeps a way back in, or a household can lock itself out of its own
   * renovation with one tap.
   */
  source: z.enum(['creator', 'grant', 'default']),
});
export type HomeProjectAccessMember = z.infer<typeof homeProjectAccessMemberSchema>;

export const homeProjectAccessViewSchema = z.object({
  project_id: z.string(),
  visibility: homeProjectVisibilitySchema,
  default_role: homeProjectRoleSchema,
  /** The caller's own effective role, so a screen need not recompute it. */
  my_role: homeProjectRoleSchema,
  members: z.array(homeProjectAccessMemberSchema),
});
export type HomeProjectAccessView = z.infer<typeof homeProjectAccessViewSchema>;

/** The three columns every access decision reads. */
export interface HomeProjectAccessFields {
  created_by: string | null;
  visibility?: string | null;
  default_role?: string | null;
  access_json?: string | null;
}

/** An unknown or absent value falls back to the pre-migration behaviour. */
export function normalizeHomeProjectVisibility(raw: unknown): HomeProjectVisibility {
  return raw === 'draft' ? 'draft' : 'published';
}

/** Same fallback logic for a role — anything that is not `viewer` is `owner`. */
export function normalizeHomeProjectRole(raw: unknown): HomeProjectRole {
  return raw === 'viewer' ? 'viewer' : 'owner';
}

/**
 * `access_json` → grants, tolerating every shape a column can actually hold.
 *
 * Never throws. The column is nullable, was absent before migration 0163, and
 * on a ledger it is whatever the last device wrote — a parse error here would
 * turn a malformed byte into a screen that cannot open the project at all, when
 * the honest answer is "no explicit grants, use the default".
 *
 * Duplicates resolve LAST-WINS, which is what a `Map` built in array order
 * gives; both backends go through this function so neither can pick the other.
 */
export function parseHomeProjectAccessGrants(raw: unknown): HomeProjectAccessGrant[] {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) return [];
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const byUser = new Map<string, HomeProjectAccessGrant>();
  for (const entry of value) {
    const parsed = homeProjectAccessGrantSchema.safeParse(entry);
    if (parsed.success) byUser.set(parsed.data.user_id, parsed.data);
  }
  return [...byUser.values()];
}

/**
 * Grants → `access_json`. An empty list stores NULL rather than `'[]'` so the
 * column reads the same as it did before anyone opened the access sheet.
 */
export function serializeHomeProjectAccessGrants(
  grants: readonly HomeProjectAccessGrant[],
): string | null {
  const deduped = parseHomeProjectAccessGrants(grants);
  return deduped.length > 0 ? JSON.stringify(deduped) : null;
}

/**
 * What `userId` may do with this project.
 *
 * The creator is pinned to `owner` ahead of every grant, including a grant that
 * names them as a viewer. Without that pin, "set everyone to viewer" is a
 * one-tap way to make a project nobody in the household can ever edit again —
 * there is no household-admin override for a project's own access list.
 */
export function effectiveHomeProjectRole(
  project: HomeProjectAccessFields,
  userId: string | null | undefined,
): HomeProjectRole {
  if (!userId) return 'viewer';
  if (project.created_by && project.created_by === userId) return 'owner';
  const grant = parseHomeProjectAccessGrants(project.access_json).find(
    (entry) => entry.user_id === userId,
  );
  if (grant) return grant.role;
  return normalizeHomeProjectRole(project.default_role);
}

/**
 * Whether the project is listable / openable by `userId` at all.
 *
 * A draft is its creator's alone. Note this is NOT "the creator plus everyone
 * with a grant": a grant on a draft would be a project a member can open but
 * that nobody told them about, and the point of a draft is that it is not
 * shared yet. Publishing is the act that shares it.
 */
export function canViewHomeProject(
  project: HomeProjectAccessFields,
  userId: string | null | undefined,
): boolean {
  if (normalizeHomeProjectVisibility(project.visibility) !== 'draft') return true;
  return !!userId && project.created_by === userId;
}

/** `owner` is the only role that may write. Named so call sites read as intent. */
export function canEditHomeProject(
  project: HomeProjectAccessFields,
  userId: string | null | undefined,
): boolean {
  return effectiveHomeProjectRole(project, userId) === 'owner';
}
