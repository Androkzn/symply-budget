/**
 * Kaizen — server-side snapshot renderer
 *
 * The iOS client builds the authoritative `KaizenContextSnapshot`
 * (`KaizenContextSnapshotService`) from repositories + analytics and passes it
 * to this route inside the request envelope. The server does NOT recompute it —
 * it only *renders* the provided snapshot into compact prompt text and reads
 * freshness/source metadata so Kaizen Master can cite evidence.
 *
 * This mirrors the `Simple Language` `renderLearnerSnapshot(ctx, surface)`
 * pattern, generalized for Kaizen (plan: "Dynamic Kaizen Context Snapshot").
 *
 * GUARDRAIL: nothing here computes mastery, schedules, or scores. We consume a
 * snapshot; we never derive a new source of truth.
 */

import { scrubFreeText } from './redaction';

/** Freshness states the coach can honestly report. */
export type SnapshotFreshness = 'fresh' | 'stale' | 'partial' | 'offline';

/** Privacy scope for the current operation (plan: ContextPrivacyScope). */
export type ContextPrivacyScope =
  | 'coachChat'
  | 'assessment'
  | 'progressExplain'
  | 'memoryWrite'
  | 'importReview';

/**
 * Server-side, structurally-permissive mirror of the iOS `KaizenContextSnapshot`.
 * Every field is optional because the client may send a partial snapshot
 * (freshness = 'partial') and the renderer must degrade gracefully. We keep the
 * sub-objects loose (Record / string maps) so an iOS schema bump does not break
 * the renderer; rendering reads named keys defensively.
 */
export interface KaizenContextSnapshot {
  schemaVersion?: number;
  generatedAt?: string;
  freshness?: SnapshotFreshness;
  privacyScope?: ContextPrivacyScope;

  userIdentity?: {
    targetRoles?: string[];
    careerGoals?: string[];
    selectedSkills?: string[];
    identityStatements?: string[];
    preferredLanguage?: string;
    [k: string]: unknown;
  };
  currentStatus?: {
    summary?: string;
    todayCompletion?: string;
    wakeState?: string;
    nextAction?: string;
    overdueCount?: number;
    [k: string]: unknown;
  };
  dailyRhythm?: { summary?: string; [k: string]: unknown };
  physicalState?: { summary?: string; [k: string]: unknown };
  mentalState?: { summary?: string; [k: string]: unknown };
  careerState?: {
    summary?: string;
    skillDeltas?: string[];
    pipelineStage?: string;
    [k: string]: unknown;
  };
  technicalSkillState?: Array<{
    name?: string;
    mastery0to100?: number;
    band?: string;
    nextConcept?: string;
    [k: string]: unknown;
  }>;
  habitState?: { summary?: string; [k: string]: unknown };
  progressTrends?: {
    summary?: string;
    momentum?: string;
    regressions?: string[];
    [k: string]: unknown;
  };
  interactionStyle?: {
    summary?: string;
    directness?: string;
    verbosity?: string;
    [k: string]: unknown;
  };
  recentChanges?: Array<{ description?: string; date?: string; [k: string]: unknown }>;
  knownConstraints?: string[];
  openLoops?: Array<{ description?: string; [k: string]: unknown }>;

  /** Source attribution so the coach can say "improved +8 since baseline". */
  sourceSummary?: Record<string, string>;
  lastUpdated?: Record<string, string>;

  [k: string]: unknown;
}

/** Freshness metadata passed alongside the snapshot. */
export interface SnapshotFreshnessMeta {
  freshness?: SnapshotFreshness;
  generatedAt?: string;
  /** e.g. { weight: "yesterday", career: "today" } */
  sourceSummary?: Record<string, string>;
  lastUpdated?: Record<string, string>;
}

/** Which prompt sections to include, per surface (plan: surface budgets table). */
const SURFACE_SECTIONS: Record<ContextPrivacyScope, readonly string[]> = {
  coachChat: [
    'WHO',
    'CURRENT',
    'TODAY',
    'PHYSICAL',
    'MENTAL',
    'CAREER',
    'WEAKEST',
    'NEXT',
    'STYLE',
    'OPEN_LOOPS',
    'RECENT_CHANGES',
  ],
  assessment: ['CAREER', 'WEAKEST'],
  progressExplain: ['CAREER', 'WEAKEST', 'TODAY'],
  memoryWrite: ['WHO', 'STYLE'],
  importReview: ['WHO', 'CAREER'],
};

function joinList(items: unknown, max = 5): string {
  if (!Array.isArray(items)) return '';
  return items
    .filter((x) => typeof x === 'string' && x.trim().length > 0)
    .slice(0, max)
    .join(', ');
}

function line(label: string, value: string | undefined | null): string | null {
  const v = (value ?? '').trim();
  return v ? `${label}: ${v}` : null;
}

/**
 * Render a snapshot into compact, surface-tuned prompt text. Returns null lines
 * filtered out so empty sections do not waste tokens. Output looks like the
 * "Prompt snapshot example" in the plan.
 */
export function renderKaizenSnapshot(
  snapshot: KaizenContextSnapshot | undefined,
  scope: ContextPrivacyScope = 'coachChat'
): string {
  if (!snapshot) {
    return 'CONTEXT: no snapshot provided for this turn; ask the user before assuming state.';
  }

  const sections = SURFACE_SECTIONS[scope] ?? SURFACE_SECTIONS.coachChat;
  const want = (id: string) => sections.includes(id);
  const out: Array<string | null> = [];

  if (want('WHO')) {
    const id = snapshot.userIdentity ?? {};
    const parts = [
      id.targetRoles?.length ? `target ${joinList(id.targetRoles, 3)}` : '',
      id.careerGoals?.length ? `goals: ${joinList(id.careerGoals, 3)}` : '',
      id.preferredLanguage ? `language ${id.preferredLanguage}` : '',
    ].filter(Boolean);
    out.push(line('WHO', parts.join('; ')));
  }

  if (want('CURRENT')) {
    const cs = snapshot.currentStatus ?? {};
    const parts = [
      cs.summary,
      cs.wakeState,
      typeof cs.overdueCount === 'number' && cs.overdueCount > 0
        ? `${cs.overdueCount} overdue`
        : '',
    ].filter((x): x is string => Boolean(x && (x as string).trim()));
    out.push(line('CURRENT', parts.join('; ')));
  }

  if (want('TODAY')) {
    out.push(line('TODAY', snapshot.currentStatus?.todayCompletion));
  }

  if (want('PHYSICAL')) {
    out.push(line('PHYSICAL', snapshot.physicalState?.summary));
  }

  if (want('MENTAL')) {
    // Mental state is sensitive: render only the client-provided summary, never
    // raw journal text (the client is responsible for not putting raw text here).
    out.push(line('MENTAL', snapshot.mentalState?.summary));
  }

  if (want('CAREER')) {
    const cr = snapshot.careerState ?? {};
    const parts = [cr.summary, joinList(cr.skillDeltas, 4), cr.pipelineStage]
      .filter((x): x is string => Boolean(x && (x as string).trim()));
    out.push(line('CAREER', parts.join('; ')));
  }

  if (want('WEAKEST')) {
    const weakest = (snapshot.technicalSkillState ?? [])
      .filter((s) => typeof s.mastery0to100 === 'number')
      .sort((a, b) => (a.mastery0to100 ?? 100) - (b.mastery0to100 ?? 100))
      .slice(0, 3)
      .map((s) => `${s.name ?? 'skill'} ${s.mastery0to100}${s.nextConcept ? ` (next: ${s.nextConcept})` : ''}`)
      .join('; ');
    out.push(line('WEAKEST', weakest));
  }

  if (want('NEXT')) {
    out.push(line('NEXT', snapshot.currentStatus?.nextAction));
  }

  if (want('STYLE')) {
    const st = snapshot.interactionStyle ?? {};
    const parts = [st.summary, st.directness, st.verbosity].filter(
      (x): x is string => Boolean(x && (x as string).trim())
    );
    out.push(line('STYLE', parts.join('; ')));
  }

  if (want('OPEN_LOOPS')) {
    const loops = (snapshot.openLoops ?? [])
      .map((l) => l.description)
      .filter((x): x is string => Boolean(x && x.trim()))
      .slice(0, 5)
      .join('; ');
    out.push(line('OPEN_LOOPS', loops));
  }

  if (want('RECENT_CHANGES')) {
    const changes = (snapshot.recentChanges ?? [])
      .map((ch) => ch.description)
      .filter((x): x is string => Boolean(x && x.trim()))
      .slice(0, 4)
      .join('; ');
    out.push(line('RECENT_CHANGES', changes));
  }

  const body = out.filter((x): x is string => Boolean(x)).map(scrubFreeText).join('\n');
  return body || 'CONTEXT: snapshot present but empty; ask the user before assuming state.';
}

/** Render a one-line freshness banner so the coach can disclaim its knowledge. */
export function renderFreshnessBanner(meta: SnapshotFreshnessMeta | undefined): string {
  const freshness = meta?.freshness ?? 'partial';
  const generated = meta?.generatedAt ? ` (generated ${meta.generatedAt})` : '';
  const sources = meta?.sourceSummary
    ? Object.entries(meta.sourceSummary)
        .map(([k, v]) => `${k}=${v}`)
        .slice(0, 6)
        .join(', ')
    : '';
  const sourceLine = sources ? `; sources: ${sources}` : '';
  return `FRESHNESS: ${freshness}${generated}${sourceLine}. Do not claim data more recent than this.`;
}
