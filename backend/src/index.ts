import * as Sentry from '@sentry/cloudflare';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { requestId } from 'hono/request-id';

import {
  ensureRequiredSecrets,
  MisconfiguredSecretsError,
} from './config/required-secrets';
import { handleScheduled } from './cron/scheduled';
import { ChatRoomDO } from './durable-objects/chat-room';
import { HouseholdCoordinatorDO } from './durable-objects/household-coordinator';
import { RateLimiterDO } from './durable-objects/rate-limiter';
import { requireBrandCapability, requireBudgetApi, requireLocalFirstApi, gateHomeApiPaths } from './middleware/brand-gate';
import {
  rejectFinancialWritesForLocalFirst,
  rejectFinancialWritesForLocalFirstEarly,
} from './middleware/budget-local-first-gate';
import { corsMiddleware } from './middleware/cors';
import { errorHandler } from './middleware/error-handler';
import { rejectHealthWritesForLocalFirstEarly } from './middleware/health-local-first-gate';
import {
  rejectHomeWritesForLocalFirstEarly,
} from './middleware/house-local-first-gate';
import { noStoreAuthResponses } from './middleware/no-store-auth';
import { rateLimitDO } from './middleware/rate-limit';

// Import routes
import authRoutes from './routes/auth';
import authPlatformRoutes from './routes/auth-platform';
import companionRoutes from './routes/companion';
import smartEngineRoutes from './routes/smart-engine';
import userRoutes from './routes/users';
import householdRoutes, { householdPhotoProxy } from './routes/households';
import householdSpaceRoutes, { spaceImageProxy } from './routes/household-spaces';
import invitationRoutes from './routes/invitations';
import inviteLinkRoutes from './routes/invite-links';
import reportRoutes from './routes/reports';
import taskRoutes from './routes/tasks';
import garbageCollectionRoutes, { municipalityRoutes } from './routes/garbage-collection';
import templateRoutes from './routes/templates';
import applianceRoutes from './routes/appliances';
import seasonalChecklistRoutes from './routes/seasonal-checklists';
import serviceProviderRoutes from './routes/service-providers';
import jobRoutes from './routes/jobs';
import subscriptionRoutes from './routes/subscriptions';
import aiAccessRoutes from './routes/ai-access';
import aiCredentialsRoutes from './routes/ai-credentials';
import internalAiLeasesRoutes from './routes/internal-ai-leases';
import chatRoutes from './routes/chat';
import chatRoomsRoutes, { chatWsRoutes } from './routes/chat-rooms';
import budgetChatRoomsRoutes, { budgetChatWsRoutes } from './routes/budget-chat-rooms';
import notificationRoutes from './routes/notifications';
import budgetRoutes from './routes/budget';
import localFirstV2Routes from './routes/local-first-v2';
import localFirstSignalingWsRoutes from './routes/local-first-signaling-ws';
import homeBudgetRoutes from './routes/home-budget';
import savingsRoutes from './routes/savings';
import healthRoutes from './routes/health';
import healthFoodRoutes from './routes/health-food';
import healthBodyExtrasRoutes from './routes/health-body-extras';
import healthAssetsRoutes from './routes/health-assets';
import healthAiRoutes from './routes/health-ai';
import healthExerciseRoutes from './routes/health-exercises';
import healthRemindersRoutes from './routes/health-reminders';
import healthSocialRoutes, { requireHealthSocialFlag } from './routes/health-social';
import mortgageRoutes from './routes/mortgage';
import recurringReminderRoutes from './routes/recurring-reminders';
import utilitiesRoutes from './routes/utilities';
import visitChecklistRoutes from './routes/visit-checklists';
import visitNotesRouter, { householdNotesRouter } from './routes/visit-notes';
import wishesRoutes from './routes/wishes';
import checklistRoutes from './routes/checklists';
import contractorRoutes from './routes/contractors';
import contractorSearchRoutes from './routes/contractor-search';
import appointmentRoutes from './routes/appointments';
import quoteRoutes from './routes/quotes';
import representativeRoutes from './routes/representatives';
import projectRoutes from './routes/projects';
import messagesRouter from './routes/messages';
import ratingsRouter from './routes/ratings';
import webhookRoutes from './routes/webhooks';
import devRoutes from './routes/dev';
import aiUsageRoutes from './routes/ai-usage';
import taskDraftsRoutes from './routes/task-drafts';
import homeFeaturesRoutes, { maintenanceSuggestions } from './routes/home-features';
import imageRoutes, { imageServing } from './routes/images';
import settingsRouter from './routes/settings';
import featuresRouter from './routes/features';
import aiRoutes from './routes/ai';
import aiHousekeeperRoutes from './routes/ai-housekeeper';
import floorPlansRoutes from './routes/floor-plans';
import gardenPlansRoutes from './routes/garden-plans';
import homeProjectsRoutes from './routes/home-projects';
import neighbourRoutes from './routes/neighbours';
import calendarRoutes from './routes/calendar';
// Aihousekeeper (Proactive Layer) route mounts — Streams E + F per plan §6/§7.
import aihousekeeperRoutes from './routes/aihousekeeper';
import aihousekeeperChatRoutes from './routes/aihousekeeper-chat';
import aihousekeeperVoiceRoutes from './routes/aihousekeeper-voice';
import aihousekeeperAttachmentsRoutes from './routes/aihousekeeper-attachments';
import publicBriefingRoutes from './routes/public-briefing';
import oauthGoogleRoutes from './routes/oauth-google';
// Kaizen (Kaizen-only) — ported 1:1 from the donor kaizen backend, brand-gated below.
import kaizenSyncRoutes from './routes/sync';
import kaizenAiRoutes from './routes/kaizenAi';
import kaizenCoachChatRoutes from './routes/kaizenCoachChat';
import kaizenBooksRoutes from './routes/kaizenBooks';
// Import Durable Objects
import type { Env } from './types';
import { safeErrorLog } from './utils/log-scrubber';

// Cron + queue handlers and web landing pages (extracted for slimmer wiring).
import { handleQueue } from './queues/consumers';
import avatarRoutes from './web/avatars';
import inviteLandingRoutes from './web/invite-landing';

// Create app
const app = new Hono<{ Bindings: Env }>();

// Global middleware
app.use('*', requestId());
app.use('*', prettyJSON());
app.use('*', corsMiddleware());
app.use('*', noStoreAuthResponses());
app.use('*', errorHandler());

// Logger only in development
app.use('*', async (c, next) => {
  if (c.env.ENVIRONMENT === 'development') {
    return logger()(c, next);
  }
  await next();
});

// Serve .well-known files for Universal Links (iOS) and App Links (Android).
// Brand-aware: the ecosystem's 5 apps share the same Apple Team + invite paths, so
// we advertise every app's App ID on every Worker (an app only ever consults the
// AASA of a domain it's entitled to via Associated Domains, so listing all is safe).
const APPLE_TEAM_ID = "B2ZY5M2YW2";
const UNIVERSAL_LINK_PATHS = [
  "/join/*", "/j/*", "/invite/*", "/login", "/register",
  "/forgot-password", "/reset-password/*", "/verify-email/*",
];
const IOS_APP_IDS = [
  `${APPLE_TEAM_ID}.com.symply.house`,
  `${APPLE_TEAM_ID}.com.symply.budget`,
  `${APPLE_TEAM_ID}.com.symply.kaizen`,
  `${APPLE_TEAM_ID}.com.symply.language`,
  `${APPLE_TEAM_ID}.com.symply.health`,
];
// Android SHA-256 fingerprints. Debug keystore is shared across brands; the House
// release keystore is EAS credential set "Build Credentials 0Rvi-5i7GN".
const ANDROID_DEBUG_SHA256 = "FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C";
const HOUSE_RELEASE_SHA256 = "06:53:79:44:BE:72:E2:4F:50:4F:13:0B:BA:47:A5:AD:E8:E3:19:69:85:E2:47:B4:8A:FE:A2:12:90:80:DF:47";
// package_name → SHA-256 fingerprints. Per-app com.symply.* release keystores are
// added here as each app's first EAS build mints its keystore (`eas credentials`).
const ANDROID_APP_LINKS: Array<{ pkg: string; sha256: string[] }> = [
  { pkg: "com.symply.house", sha256: [ANDROID_DEBUG_SHA256, HOUSE_RELEASE_SHA256] },
  // TODO: com.symply.budget / kaizen / language / health — add release SHA-256 per
  // app once their EAS keystores exist.
];

app.get('/.well-known/apple-app-site-association', async (c) => {
  return c.json({
    applinks: {
      apps: [],
      details: IOS_APP_IDS.map((appID) => ({ appID, paths: UNIVERSAL_LINK_PATHS })),
    },
    webcredentials: {
      apps: IOS_APP_IDS,
    },
  });
});

app.get('/.well-known/assetlinks.json', async (c) => {
  return c.json(
    ANDROID_APP_LINKS.map(({ pkg, sha256 }) => ({
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: pkg,
        sha256_cert_fingerprints: sha256,
      },
    }))
  );
});

// Invite/Join web landing pages — see backend/src/web/invite-landing.ts.
app.route('/', inviteLandingRoutes);

// Health check
app.get('/', (c) => {
  return c.json({
    name: 'Simple House API',
    version: '1.0.0',
    status: 'healthy',
    environment: c.env.ENVIRONMENT,
  });
});

// Platform-wide monitoring contract — every Worker answers 200 {status:'ok'}.
//
// ORDERING MATTERS: the Symply Health tracking domain is mounted at `/health`
// further down. Hono matches this EXACT-path handler before the router mount,
// so the healthcheck keeps working — but only while this line stays ABOVE it.
// `health-healthcheck-precedence.test.ts` pins that, and the live-API suite
// asserts 200 on every deployed Worker.
app.get('/health', (c) => {
  return c.json({ status: 'ok' });
});

// Dev routes (must be before routes with wildcard auth)
app.route('/dev', devRoutes);

// Household chat WebSocket upgrade — MUST be mounted before `/households`
// (whose broad authMiddleware would reject the header-less WS upgrade). It
// authenticates via the `?token=` query param inside its handler and only
// owns `/:roomId/ws`; all other chat-rooms paths fall through to the
// authenticated REST router mounted below.
app.route('/households/:householdId/chat-rooms', chatWsRoutes);

// Budget household chat WebSocket upgrade — a 100%-independent fork of the House
// chat, owned by the Symply Budget app. Same header-less-upgrade ordering
// requirement as the House chat WS above (must precede `/households`).
app.route('/households/:householdId/budget-chat-rooms', budgetChatWsRoutes);

// Budget V2 local-first signaling WS — before `/households` auth (token query).
app.route('/v2', localFirstSignalingWsRoutes);

// Mount routes
app.route('/auth', authRoutes);

// Platform authority + companion + Soft Transfer — never on Health (Data Bridge §2.10).
app.use('/auth/platform/*', requireBrandCapability('platformAuthority'));
app.use('/shared-user/*', requireBrandCapability('platformAuthority'));
app.route('/auth/platform', authPlatformRoutes);
app.route('/shared-user', authPlatformRoutes);
app.use('/companion/*', requireBrandCapability('platformAuthority'));
app.route('/companion', companionRoutes);
app.use('/smart-engine/*', requireBrandCapability('smartEngine'));
app.route('/smart-engine', smartEngineRoutes);

app.route('/users', userRoutes);
// Symply Health tracking domain (parity P1) — gated to the Health Worker by
// requireHealthApi(); 404s everywhere else. Personal data, user-scoped.
// P4 social kill switch, registered BEFORE any `/health` mount.
//
// Hono applies a mounted router's `use('/*')` middleware to every path under
// the shared prefix, so `routes/health.ts`'s auth middleware would otherwise run
// before the social router's own flag check — turning an unauthenticated probe
// of a DISABLED surface into a 401 that confirms the path exists. Registering
// the gate here makes deny-by-default the genuinely first decision.
app.use('/health/social/*', requireHealthSocialFlag());
app.use('/health/social', requireHealthSocialFlag());

// P3 AI surfaces (`/health/ai/*`) — coach turn/commit, the label + meal
// scanners, and the body-insight producer. The rate limiter is registered HERE,
// not inside routes/health-ai.ts, for exactly the reason the social flag above
// had to move: `routes/health.ts` mounts first at the shared `/health` prefix
// and its `use('/*', authMiddleware())` applies to every path under it, so
// anything declared inside a later router runs AFTER it. Every path under this
// prefix costs model tokens, so the ceiling has to be the first thing that
// happens. Pinned by health-ai-precedence.test.ts.
app.use('/health/ai/*', rateLimitDO('health:ai'));

// Health V2 local-first 410 gate — a REJECT-LIST over the eight Wave A prefixes
// (`/health/weight|water|nutrition|entries|measurements|habits|goals|sync`) plus
// the legacy sync contract. Everything else under `/health` falls through
// untouched: Tier B (`/health/ai/*`), Wave C (`/health/cycle/*`,
// `/health/mens-health/*`, `/health/foods/*`, …) and Tier D
// (`/health/challenges*`) stay server-authoritative for all of Wave A.
//
// ORDERING MATTERS, TWICE:
// - It must be ABOVE the eight `/health` mounts (`:266, 269, 270, 271, 274, 280,
//   285, 290`). The existing `rejectHomeWritesForLocalFirstEarly()` slot further
//   down sits AFTER them, so a gate registered there would never fire.
// - It must stay BELOW the platform healthcheck `app.get('/health', …)` at
//   `:207`, and it is scoped to `/health/*` so it can never see bare `/health`.
//
// Unarmed until a client sends `X-Health-Local-First: 1`. See plan §2 item 3.
app.use('/health/*', rejectHealthWritesForLocalFirstEarly());

app.route('/health', healthRoutes);
// P2 groups. Mounted at the same prefix; each router owns disjoint sub-paths
// (food / body-extras / assets) so ordering between them does not matter.
app.route('/health', healthFoodRoutes);
app.route('/health', healthBodyExtrasRoutes);
app.route('/health', healthAssetsRoutes);
// Workout library (`/health/exercises*`) — global catalogue + per-user
// favourites + injury gate. Owns its own sub-path like the P2 groups above.
app.route('/health', healthExerciseRoutes);
// Reminder schedule (`/health/reminders/*`) — meal / water / weigh-in / habit
// nudges. Owns its own sub-path like the P2 groups, so ordering against them
// does not matter. Storage only: the routes never send, the nightly cron pass in
// `services/health-reminders-service.ts` materialises and the platform's
// existing `processScheduledNotifications` sweep delivers.
app.route('/health', healthRemindersRoutes);
// P3 AI group (`/health/ai/*`) — coach, scanners, body-insight producer. Owns
// its own sub-path like the P2 groups, so ordering against them does not matter;
// what DOES matter is the rate-limit registration above, which must precede the
// `routes/health.ts` mount.
app.route('/health', healthAiRoutes);
// P4 social group (`/health/social/*`). SHIPS DISABLED: on top of the brand
// gate it 404s unless CONFIG_KV `health_social_enabled` === the literal 'true'
// — the INVERSE of the savings_enabled convention, because health sharing is
// deny-by-default. See routes/health-social.ts.
app.route('/health', healthSocialRoutes);
// Budget V2: reject financial D1 CRUD for local-first clients BEFORE the
// `/households` auth middleware (which would otherwise 401 first).
app.use('*', rejectFinancialWritesForLocalFirstEarly());
// House V2: reject Tier-A home-domain CRUD for local-first clients (same slot).
app.use('*', rejectHomeWritesForLocalFirstEarly());
app.route('/households', householdRoutes);
app.route('/invitations', invitationRoutes);
app.route('/invite-links', inviteLinkRoutes);

// House-domain nested routes — 404 on Budget/Kaizen/Health (mirrors kaizenApi gating).
gateHomeApiPaths(app, [
  '/households/:householdId/reports',
  '/households/:householdId/tasks',
  '/households/:householdId/garbage-collection',
  '/municipalities',
  '/maintenance-templates',
  '/households/:householdId/maintenance-templates',
  '/households/:householdId/appliances',
  '/households/:householdId/seasonal-checklists',
  '/service-providers',
  '/households/:householdId/service-providers',
  '/households/:householdId/chat',
  '/households/:householdId/chat-rooms',
  '/households/:householdId/home-budget',
  '/households/:householdId/checklists',
  '/households/:householdId/contractors',
  '/households/:householdId/appointments',
  '/households/:householdId/quotes',
  '/households/:householdId/projects',
  '/households/:householdId/visit-checklists',
  '/households/:householdId/visits',
  '/households/:householdId/notes',
  '/households/:householdId/messages',
  '/households/:householdId/utilities',
  '/households/:householdId/task-drafts',
  '/households/:householdId/home-features',
  '/households/:householdId/maintenance-suggestions',
  '/households/:householdId/floor-plans',
  '/households/:householdId/garden-plans',
  '/households/:householdId/home-projects',
  // Neighbours is a property feature — who lives around THIS house. A Budget or
  // Health household has no such thing, so the router 404s there rather than
  // serving an empty list that looks like a feature nobody has used yet.
  '/households/:householdId/neighbours',
  '/households/:householdId/aihousekeeper',
  '/api/ai-housekeeper',
]);

// Nested routes under households
app.route('/households', householdSpaceRoutes);
app.route('/households/:householdId/reports', reportRoutes);
app.route('/households/:householdId/tasks', taskRoutes);
app.route('/households/:householdId/garbage-collection', garbageCollectionRoutes);
app.route('/households/:householdId/appliances', applianceRoutes);
app.route('/households/:householdId/seasonal-checklists', seasonalChecklistRoutes);
app.route('/municipalities', municipalityRoutes);
app.route('/maintenance-templates', templateRoutes);
app.route('/households/:householdId/maintenance-templates', templateRoutes);
app.route('/service-providers', serviceProviderRoutes);
app.route('/households/:householdId/service-providers', serviceProviderRoutes);
app.route('/households/:householdId/chat', chatRoutes);
// Household group chat — multi-room messaging + AI assistant (distinct from the
// stateless /chat AI Q&A route above).
app.route('/households/:householdId/chat-rooms', chatRoomsRoutes);
// Budget household group chat — a 100%-independent fork owned by the Symply
// Budget app (separate budget_chat_* tables + budget_chat_* notifications).
// Reuses the shared, stateless ChatRoomDO purely for WebSocket fan-out.
app.route('/households/:householdId/budget-chat-rooms', budgetChatRoomsRoutes);
// Recurring reminders — brand-agnostic (mirrors chat-rooms above), even though
// the only registered type today (mortgage statement upload) is Budget-only;
// a future House/Kaizen/Health type needs no change here, just a registry entry.
app.route('/households/:householdId/recurring-reminders', recurringReminderRoutes);

// Money product: block on House Worker before nested routers (BUDGET_API_ENABLED=false).
app.use('/households/:householdId/budget', requireBudgetApi());
app.use('/households/:householdId/budget/*', requireBudgetApi());
app.use('/households/:householdId/budget', rejectFinancialWritesForLocalFirst());
app.use('/households/:householdId/budget/*', rejectFinancialWritesForLocalFirst());
app.use('/households/:householdId/savings', requireBudgetApi());
app.use('/households/:householdId/savings/*', requireBudgetApi());
app.use('/households/:householdId/mortgage', requireBudgetApi());
app.use('/households/:householdId/mortgage/*', requireBudgetApi());
app.use('/households/:householdId/wishes', requireBudgetApi());
app.use('/households/:householdId/wishes/*', requireBudgetApi());
// Budget V2 local-first control plane (metadata + ZK mailbox + TURN stub).
app.use('/v2', requireLocalFirstApi());
app.use('/v2/*', requireLocalFirstApi());
// `/v2` rate limits (Health V2 plan §2 He0 item 9). `/v2` carried auth +
// membership checks but NO ceiling; `RATE_LIMITER` was already bound on all
// four Workers. Registered AFTER the brand gate above (so a Kaizen 404 costs no
// DO round trip) and BEFORE the mount, which means `userId` is not set yet —
// see the identifier note on the buckets in middleware/rate-limit.ts.
app.use('/v2/*', rateLimitDO('local-first:v2'));
// Tighter bucket for the one `/v2` write that persists ~500 KB per call.
// Method-scoped via app.put so the checkpoint GETs keep the wide bucket only.
app.put('/v2/households/:householdId/checkpoints', rateLimitDO('local-first:v2:checkpoint'));
app.route('/v2', localFirstV2Routes);
app.route('/households/:householdId/budget', budgetRoutes);
app.route('/households/:householdId/savings', savingsRoutes);
app.route('/households/:householdId/mortgage', mortgageRoutes);
app.route('/households/:householdId/wishes', wishesRoutes);

// House lightweight money glance (always mounted). Full /budget|/savings|/wishes
// are gated by BUDGET_API_ENABLED (false on House Worker, true on Budget Worker).
app.route('/households/:householdId/home-budget', homeBudgetRoutes);

app.route('/households/:householdId/checklists', checklistRoutes);
app.route('/households/:householdId/contractors', contractorRoutes);
app.route('/households/:householdId/contractors', contractorSearchRoutes);
app.route('/households/:householdId/appointments', appointmentRoutes);
app.route('/households/:householdId/quotes', quoteRoutes);
app.route('/households/:householdId/contractors/:contractorId/representatives', representativeRoutes);
app.route('/households/:householdId/projects', projectRoutes);
app.route('/households/:householdId/visit-checklists', visitChecklistRoutes);
app.route('/households/:householdId/visits/:visitId/notes', visitNotesRouter);
app.route('/households/:householdId/notes', householdNotesRouter);
app.route('/households/:householdId/messages', messagesRouter);
app.route('/households/:householdId/contractors/:contractorId/ratings', ratingsRouter);
app.route('/households/:householdId/utilities', utilitiesRoutes);
app.route('/households/:householdId/neighbours', neighbourRoutes);
app.route('/households/:householdId/ai-usage', aiUsageRoutes);
app.route('/households/:householdId/task-drafts', taskDraftsRoutes);
app.route('/households/:householdId/home-features', homeFeaturesRoutes);
app.route('/households/:householdId/maintenance-suggestions', maintenanceSuggestions);
app.route('/households/:householdId/floor-plans', floorPlansRoutes);
app.route('/households/:householdId/garden-plans', gardenPlansRoutes);
app.route('/households/:householdId/home-projects', homeProjectsRoutes);
app.route('/households/:householdId', imageRoutes);

// Image serving endpoint (public API)
app.route('/api/images', imageServing);

// File serving endpoint (alias for floor plans and other files)
app.route('/files', imageServing);

// Space image proxy (public API endpoint)
app.route('/api', spaceImageProxy);

// Household photo proxy (public API endpoint)
app.route('/api', householdPhotoProxy);

// Avatar serving endpoint (public) — see backend/src/web/avatars.ts.
app.route('/avatars', avatarRoutes);

// Job status routes
app.route('/jobs', jobRoutes);

// Subscription routes
app.route('/subscriptions', subscriptionRoutes);

// AI access / model catalog / preferences (AI Access Migration)
app.route('/', aiAccessRoutes);
app.route('/', aiCredentialsRoutes);

// Internal Lambda lease consume — integration secret auth only (not JWT)
app.route('/internal', internalAiLeasesRoutes);


// Notification routes
app.route('/notifications', notificationRoutes);

// Calendar routes (iCal export, subscribe URLs)
app.route('/calendar', calendarRoutes);

// AI Assistant routes
app.route('/ai', aiRoutes);

// AI Housekeeper routes
app.route('/api/ai-housekeeper', aiHousekeeperRoutes);

// Settings routes
app.route('/api/settings', settingsRouter);

// Feature flag routes (GET is public; PUT is admin-gated)
app.route('/features', featuresRouter);

// Webhook routes (for Lambda callbacks, etc.)
app.route('/webhooks', webhookRoutes);

// Google Calendar OAuth callback (Aihousekeeper integrations §G3).
app.route('/oauth/google', oauthGoogleRoutes);

// =====================================================================
// Kaizen (Symply Kaizen only) — ported 1:1 from the donor kaizen backend.
// Every path 404s on non-Kaizen brands (mirrors the isHomeApiEnabled gating
// pattern) so the shared backend is unchanged for House/Budget/Health/etc.
//   POST /api/v1/sync                        — sync of the 16 kaizen_* tables
//   POST /api/v1/ai/*                        — Kaizen / career AI endpoints
//   POST /api/v1/kaizen/coach-chat/messages — Kaizen Master coach chat
// =====================================================================
app.use('/api/v1/sync', requireBrandCapability('kaizenApi'));
app.use('/api/v1/sync/*', requireBrandCapability('kaizenApi'));
app.use('/api/v1/ai/*', requireBrandCapability('kaizenApi'));
app.use('/api/v1/kaizen/coach-chat/*', requireBrandCapability('kaizenApi'));
app.route('/api/v1/sync', kaizenSyncRoutes);
app.route('/api/v1/ai/books', kaizenBooksRoutes);
app.route('/api/v1/ai', kaizenAiRoutes);
app.route('/api/v1/kaizen/coach-chat', kaizenCoachChatRoutes);

// =====================================================================
// Aihousekeeper (Proactive Layer) routes — plan §6 / §7.
// =====================================================================

// Public briefing — explicitly OUTSIDE any authMiddleware. The HMAC-signed
// path token is the gate (see backend/src/routes/public-briefing.ts).
app.route('/b', publicBriefingRoutes);

// Aihousekeeper API surface (household-scoped, auth-gated).
app.route('/households/:householdId/aihousekeeper', aihousekeeperRoutes);
// Aihousekeeper chat — routes a natural-language user turn through the tool registry
// and returns the assistant's response + any executed tool calls / parked
// approvals. See plan §C6 and backend/src/routes/aihousekeeper-chat.ts.
app.route('/households/:householdId/aihousekeeper/chat', aihousekeeperChatRoutes);
// Aihousekeeper voice session — mints an OpenAI Realtime ephemeral token so the
// mobile client can open a WebRTC peer connection. OpenAI is strictly a
// voice transport; the bridge forces every user turn through Claude.
// See backend/src/routes/aihousekeeper-voice.ts.
app.route(
  '/households/:householdId/aihousekeeper/voice-session',
  aihousekeeperVoiceRoutes
);
// Aihousekeeper attachments — user-uploaded images/documents inside the chat flow.
// See backend/src/routes/aihousekeeper-attachments.ts.
app.route(
  '/households/:householdId/aihousekeeper/attachments',
  aihousekeeperAttachmentsRoutes
);

// 404 handler
app.notFound((c) => {
  return c.json(
    {
      error: {
        code: 'not_found',
        message: 'The requested endpoint does not exist',
      },
    },
    404
  );
});

// Global error handler (backup for any uncaught errors)
app.onError((error, c) => {
  if ((error as Error).name === 'UnknownAppBrandError') {
    return c.json(
      {
        error: {
          code: 'misconfigured_app_brand',
          message: 'APP_BRAND is missing or unknown',
        },
      },
      503
    );
  }

  if (
    error instanceof MisconfiguredSecretsError ||
    (error as Error).name === 'MisconfiguredSecretsError'
  ) {
    const missing = error instanceof MisconfiguredSecretsError ? error.missing : [];
    return c.json(
      {
        error: {
          code: 'misconfigured_secrets',
          message: 'Required Worker secrets are missing',
          details: missing.length > 0 ? { missing } : undefined,
        },
      },
      503
    );
  }

  // Check for API errors by name. Must stay in sync with the errorHandler
  // middleware's list (src/middleware/error-handler.ts) — routes mounted before
  // that middleware surface their errors here instead, and a name missing from
  // this list falls through to a generic 500 (e.g. a BadRequestError like "The
  // AI assistant chat can't be deleted." would otherwise 500 instead of 400).
  const apiErrorNames = [
    'ApiError',
    'ValidationError',
    'UnauthorizedError',
    'ForbiddenError',
    'NotFoundError',
    'BadRequestError',
    'ConflictError',
    'GoneError',
    'RateLimitError',
    'ServiceUnavailableError',
    'AIAccessError',
    'PersonalHouseholdViolationError',
  ];
  const errorName = (error as Error).name;

  if (apiErrorNames.includes(errorName)) {
    const apiError = error as any;
    return c.json(
      {
        error: {
          code: apiError.code,
          message: apiError.message,
          details: apiError.details,
        },
      },
      apiError.statusCode as 400 | 401 | 403 | 404 | 409 | 410 | 422 | 429 | 500 | 503
    );
  }

  // Default error response — scrub before console (B7)
  const isDev = c.env.ENVIRONMENT === 'development' || c.env.ENVIRONMENT === 'staging';
  safeErrorLog('Unhandled error in onError:', error);
  // Report genuine (non-API) 500s to Sentry. No-op when SENTRY_DSN is unset;
  // runs inside withSentry's request context so scope/tags are attached.
  Sentry.captureException(error);
  return c.json(
    {
      error: {
        code: 'internal_error',
        message: isDev ? error.message : 'An unexpected error occurred',
        ...(isDev && { debug: { name: errorName } }),
      },
    },
    500
  );
});

// Cloudflare Workers handler — fetch + scheduled + queue. Wrapped by
// Sentry.withSentry() below so unhandled errors in any of the three entry points
// are reported to the Worker's Sentry project (no-op when SENTRY_DSN is unset).
// B6: assert LAMBDA_CALLBACK_API_KEY once per isolate on staging/production.
function misconfiguredSecretsResponse(error: unknown): Response {
  const missing =
    error instanceof MisconfiguredSecretsError ? error.missing : ['LAMBDA_CALLBACK_API_KEY'];
  safeErrorLog('[B6] Required secrets missing:', missing);
  return Response.json(
    {
      error: {
        code: 'misconfigured_secrets',
        message: 'Required Worker secrets are missing',
        details: { missing },
      },
    },
    { status: 503 }
  );
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      ensureRequiredSecrets(env);
    } catch (error) {
      if (
        error instanceof MisconfiguredSecretsError ||
        (error as Error).name === 'MisconfiguredSecretsError'
      ) {
        return misconfiguredSecretsResponse(error);
      }
      throw error;
    }
    return app.fetch(request, env, ctx);
  },
  async scheduled(
    event: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    ensureRequiredSecrets(env);
    return handleScheduled(event, env, ctx);
  },
  async queue(batch: MessageBatch, env: Env): Promise<void> {
    ensureRequiredSecrets(env);
    return handleQueue(batch, env);
  },
};

// Export for Cloudflare Workers, instrumented by Sentry. `withSentry` reports
// unhandled errors from fetch/scheduled/queue to Sentry and flushes before the
// Worker terminates. Disabled (pass-through) when SENTRY_DSN is unset, so local
// dev and un-provisioned envs behave exactly as before.
export default Sentry.withSentry(
  (env: Env) => ({
    dsn: env.SENTRY_DSN,
    enabled: Boolean(env.SENTRY_DSN),
    environment: env.ENVIRONMENT,
    // Per-brand tag so House / Budget / Kaizen / Health errors are distinguishable
    // in the shared Sentry project (JWT_ISSUER is set per wrangler config).
    initialScope: { tags: { brand: env.JWT_ISSUER ?? 'unknown' } },
    // Errors only for now — no performance tracing — to stay within quota.
    tracesSampleRate: 0,
    sendDefaultPii: false,
  }),
  worker,
);

// Export Durable Objects + platform RPC entrypoint
export { RateLimiterDO, ChatRoomDO, HouseholdCoordinatorDO };
export { PlatformBridgeApi } from './platform-bridge-api';
