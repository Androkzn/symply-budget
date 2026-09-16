/**
 * Symply Health — NOTIFICATIONS / REMINDERS **posture guard**.
 *
 * ============================ WHY THIS EXISTS ============================
 * The Health notification domain is two different things behind one word, and
 * confusing them is how a member ends up muting the wrong thing:
 *
 *   A. ACTIVITY notifications — `activity_notification_preferences` (0120): ten
 *      `notify_*` / `receive_*` booleans on
 *      `GET|PUT /health/activity-preferences`. These are about OTHER PEOPLE's
 *      activity (a relative shared a recipe, a photo, a milestone) plus two
 *      delivery-channel switches.
 *
 *   B. REMINDER schedule — `health_reminder_preferences` (0134) on
 *      `GET|PUT|DELETE /health/reminders/preferences`, materialised onto the
 *      platform `scheduled_notifications` queue by two cron passes in
 *      `backend/src/services/health-reminders-service.ts`. These are about the
 *      member's OWN logging: meals, water, weigh-in, habits.
 *
 * NINE of A's ten flags are INERT. Nothing anywhere reads them, because the
 * donor features that would produce those events (family sharing, the buddy
 * community) were not ported. Only `receive_push_notifications` is load-bearing:
 * B's delivery gate refuses to materialise a nudge when it is off.
 *
 * That asymmetry is the posture this file guards, and it is invisible to every
 * other test in the repo. A settings screen that lets a member switch off
 * "Progress photos" is honest only while it also SAYS nothing sends those yet.
 * The day a producer lands, the copy becomes a lie unless somebody updates it —
 * so the guard fails and points at the copy.
 *
 * ==================== WHY IT READS THE BACKEND, NOT THE APP ====================
 * Deliberate. The RN client for this domain was under active construction while
 * this suite was written (an api module, a storage module and a screen appeared
 * within minutes of each other), so any assertion about which FE files exist
 * would be stale before it was committed. The Worker contract is the stable
 * half, it is what the client is written against, and it is where the posture
 * actually lives. FE behaviour belongs in screen/storage tests, not here.
 *
 * ============================ WHEN TO DELETE ============================
 * These guards SHOULD go red when the port advances. A red guard is never fixed
 * by deleting the assertion:
 *
 *   1. `nine flags are inert` → when a producer for the sharing/community events
 *      lands, delete this and replace it with producer tests (one per flag: does
 *      turning it off actually suppress that send?) AND update the `disclosure`
 *      strings the member reads.
 *   2. `the reminder engine is brand-gated` → never delete. Child apps were
 *      cloned from House during the split; an ungated cron materialises health
 *      nudges on the Budget Worker. This has been a shipped bug once already.
 *   3. `the routes still ship` → if these fail, the surface this file guards was
 *      removed, and the whole file is obsolete rather than merely stale.
 *
 * Contract coverage of the flags themselves lives in
 * `backend/src/routes/__tests__/health-notify-flags.test.ts`; of the reminder
 * schedule, in `backend/src/routes/__tests__/health-reminders.test.ts`.
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../../../..');
const BACKEND_SRC = path.join(ROOT, 'backend/src');
const BODY_EXTRAS_ROUTE = path.join(BACKEND_SRC, 'routes/health-body-extras.ts');
const REMINDERS_ROUTE = path.join(BACKEND_SRC, 'routes/health-reminders.ts');

/**
 * The ten activity flags, written out rather than imported from `@api/health`:
 * this file is the guard, so it must fail when the Worker's list and this list
 * disagree — importing the app's own copy would make that check circular.
 */
const NOTIFY_FLAGS = [
  'notify_recipe_created',
  'notify_recipe_updated',
  'notify_custom_food_created',
  'notify_workout_video_shared',
  'notify_photo_shared',
  'notify_milestone_achieved',
  'notify_community_recipe_created',
  'notify_community_achievement',
  'receive_push_notifications',
  'receive_inapp_notifications',
] as const;

/** The ONE flag of the ten that gates anything today. */
const LIVE_FLAG = 'receive_push_notifications';

/**
 * The modules that legitimately name a flag because they STORE or SERVE it.
 * Anything else naming one is a consumer, and a consumer changes the posture.
 */
const STORAGE_AND_ROUTE_FILES = [
  'backend/src/db/schema-health-p2.ts',
  'backend/src/routes/health-body-extras.ts',
  'backend/src/services/health-body-extras-service.ts',
];

/* ------------------------------------------------------------------ */
/* Scanners                                                            */
/* ------------------------------------------------------------------ */

const SOURCE_EXT = new Set(['.ts', '.tsx']);
const SKIP_DIRS = new Set(['node_modules', '__tests__', '__mocks__', 'test-utils']);

/** Every non-test source file under `dir`, as repo-relative paths. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full);
        continue;
      }
      if (!SOURCE_EXT.has(path.extname(entry.name))) continue;
      if (/\.(test|spec)\.tsx?$/.test(entry.name)) continue;
      if (/\.d\.ts$/.test(entry.name)) continue;
      out.push(path.relative(ROOT, full));
    }
  };
  walk(dir);
  return out;
}

const read = (relOrAbs: string): string =>
  fs.readFileSync(path.isAbsolute(relOrAbs) ? relOrAbs : path.join(ROOT, relOrAbs), 'utf8');

/** Files under `dir` whose source text contains `needle`. */
function filesContaining(dir: string, needle: string): string[] {
  return sourceFiles(dir).filter((rel) => read(rel).includes(needle));
}

describe('Health notifications posture — the two routes that ship', () => {
  it('still registers GET and PUT /activity-preferences', () => {
    const verbs = new Set(
      [
        ...read(BODY_EXTRAS_ROUTE).matchAll(
          /healthBodyExtras\.(get|put)\(\s*\n?\s*'\/activity-preferences'/g,
        ),
      ].map((m) => m[1]),
    );
    expect([...verbs].sort()).toEqual(['get', 'put']);
  });

  it('still registers GET, PUT and DELETE /reminders/preferences', () => {
    const verbs = new Set(
      [
        ...read(REMINDERS_ROUTE).matchAll(
          /healthReminders\.(get|put|delete)\(\s*\n?\s*'\/reminders\/preferences'/g,
        ),
      ].map((m) => m[1]),
    );
    expect([...verbs].sort()).toEqual(['delete', 'get', 'put']);
  });

  it('the activity route still declares exactly the ten flags this guard knows', () => {
    // The list is duplicated in the route's zod schema, the drizzle table, the
    // FE api module and this file. An eleventh flag must not appear in one of
    // them alone — the settings screen renders one row per flag, and the ninth
    // inert flag below is counted from this list.
    const block = read(BODY_EXTRAS_ROUTE).match(/const preferenceFlags = \{([\s\S]*?)\n\};/);
    expect(block).not.toBeNull();
    const declared = [...(block?.[1] ?? '').matchAll(/^\s{2}([a-z_]+):\s*z\.boolean\(\)/gm)].map(
      (m) => m[1],
    );
    expect(declared.sort()).toEqual([...NOTIFY_FLAGS].sort());
  });

  it('the two tables are not confused for one another', () => {
    // `activity_notification_preferences` (0120) and `health_reminder_preferences`
    // (0134) answer different questions — "may we push it" and "should a nudge
    // exist". Each router touches exactly its own, so a future merge of the two
    // has to be deliberate.
    expect(read(REMINDERS_ROUTE)).not.toContain('activity_notification_preferences');
    expect(read(BODY_EXTRAS_ROUTE)).not.toContain('health_reminder_preferences');
  });
});

describe('Health notifications posture — nine of the ten activity flags are inert', () => {
  /**
   * The scanner's positive control. `receive_push_notifications` IS read outside
   * its storage modules — by the reminder engine's delivery gate. If this stops
   * finding that reader, the scanner is broken and the "nothing reads the other
   * nine" assertion below proves nothing.
   */
  it('only the reminder delivery gate reads receive_push_notifications', () => {
    const consumers = filesContaining(BACKEND_SRC, LIVE_FLAG).filter(
      (file) => !STORAGE_AND_ROUTE_FILES.includes(file),
    );
    expect(consumers).toEqual(['backend/src/services/health-reminders-service.ts']);
  });

  it('nothing on the Worker reads the other nine flags', () => {
    const inert = NOTIFY_FLAGS.filter((flag) => flag !== LIVE_FLAG);
    expect(inert).toHaveLength(9);
    const consumers: string[] = [];
    for (const flag of inert) {
      for (const file of filesContaining(BACKEND_SRC, flag)) {
        if (!STORAGE_AND_ROUTE_FILES.includes(file)) consumers.push(`${file} → ${flag}`);
      }
    }
    // If this fires: a producer landed. Update the member-facing `disclosure`
    // copy in the same change — the screen currently promises that nothing
    // sends these events yet.
    expect(consumers).toEqual([]);
  });

  it('the reminder engine ignores the eight sharing/community flags', () => {
    // Stated as its own assertion because it is a PRODUCT decision, documented
    // in `resolveDeliveryGate`: a member who does not want to hear that a
    // relative posted a recipe has said nothing about whether they want to be
    // reminded to drink water. Collapsing the eight into the delivery gate
    // would silently mute somebody's own reminders.
    const engine = read('backend/src/services/health-reminders-service.ts');
    for (const flag of NOTIFY_FLAGS) {
      if (flag === LIVE_FLAG) continue;
      expect([flag, engine.includes(flag)]).toEqual([flag, false]);
    }
  });
});

describe('Health notifications posture — the reminder engine is brand-gated', () => {
  it('the cron drives the health passes only on a Health Worker', () => {
    // Child apps' D1s were cloned from House during the split, so a cron that
    // ran everywhere would materialise health nudges on the Budget Worker.
    // Asserted at the CALL SITE, not only inside the service.
    const cron = read('backend/src/cron/scheduled.ts');
    expect(cron).toContain('scheduleHealthRemindersForAllUsers');
    expect(cron).toContain('sweepSatisfiedHealthReminders');
    expect(cron).toMatch(/isHealthApiEnabled/);
  });

  it('both health routers sit behind requireHealthApi() before auth', () => {
    // Order matters: a 401 on the wrong brand would confirm the endpoint
    // exists there. Pinned as source order because the runtime behaviour is
    // covered by the two backend suites, and this is the thing a reviewer of a
    // NEW health router needs to copy.
    for (const routeFile of [BODY_EXTRAS_ROUTE, REMINDERS_ROUTE]) {
      const source = read(routeFile);
      const gateAt = source.indexOf("requireHealthApi()");
      const authAt = source.indexOf("authMiddleware()");
      expect(gateAt).toBeGreaterThan(-1);
      expect(authAt).toBeGreaterThan(-1);
      expect(gateAt).toBeLessThan(authAt);
    }
  });
});
