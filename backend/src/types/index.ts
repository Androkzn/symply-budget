import type { DrizzleD1Database } from 'drizzle-orm/d1';

import type * as schema from '../db/schema';

// Environment bindings
export interface Env {
  // D1 Database
  DB: D1Database;

  // R2 Bucket
  REPORTS_BUCKET: R2Bucket;

  // KV Namespace
  CONFIG_KV: KVNamespace;

  // Queues
  PDF_PROCESSING_QUEUE: Queue<PdfProcessingMessage>;
  REPORT_PROCESSING_QUEUE: Queue<ReportProcessingMessage>;
  // Aihousekeeper (Proactive Layer) queues — see wrangler.toml [[queues.*]] and plan §F2.
  AIHOUSEKEEPER_OUTBOUND_QUEUE: Queue<AihousekeeperOutboundMessage>;
  AIHOUSEKEEPER_OUTBOUND_DLQ: Queue<AihousekeeperOutboundMessage>;
  // Garden-plan AI image generation. Decoupled from the user-facing approve
  // request so OpenAI latency (12–60s) doesn't kill the Worker request.
  GARDEN_PLAN_QUEUE: Queue<GardenPlanGenerationMessage>;
  GARDEN_PLAN_DLQ: Queue<GardenPlanGenerationMessage>;
  // Smart Task Assistant: async AI enrichment of quick-captured tasks. The
  // create request returns instantly; this queue's consumer fills
  // risk/priority/complexity/time + subtasks. See task-enrichment-handler.ts.
  TASK_ENRICHMENT_QUEUE: Queue<TaskEnrichmentMessage>;
  TASK_ENRICHMENT_DLQ: Queue<TaskEnrichmentMessage>;
  // Home Projects AI schematic (vision / estimate). Message = IDs + R2 keys only.
  HOME_PROJECT_SCHEMATIC_QUEUE?: Queue<HomeProjectSchematicMessage>;
  HOME_PROJECT_SCHEMATIC_DLQ?: Queue<HomeProjectSchematicMessage>;
  // Smart Project describe-to-draft. Message = IDs only; the description lives
  // in the draft row, never in a message that gets retried and dead-lettered.
  HOME_PROJECT_SMART_DRAFT_QUEUE?: Queue<HomeProjectSmartDraftMessage>;
  HOME_PROJECT_SMART_DRAFT_DLQ?: Queue<HomeProjectSmartDraftMessage>;

  // Durable Objects
  RATE_LIMITER: DurableObjectNamespace;
  // Household chat — one instance per room, fans messages out over WebSockets.
  CHAT_ROOM: DurableObjectNamespace;
  /** Local-first per-household security authority (House + Budget Workers). */
  HOUSEHOLD_COORDINATOR?: DurableObjectNamespace;

  /** Optional Cloudflare Realtime TURN credentials (Budget V2 WebRTC). */
  CF_REALTIME_TURN_KEY_ID?: string;
  CF_REALTIME_TURN_API_TOKEN?: string;

  // Analytics Engine — Aihousekeeper metrics (plan §I1). Optional: Worker continues to
  // run with a console.log fallback when the binding isn't configured in the
  // current environment (local dev without the dataset provisioned).
  ANALYTICS_ENGINE?: AnalyticsEngineDataset;

  // Environment variables
  ENVIRONMENT: string;
  // Sentry crash / error monitoring for the Worker. Publishable DSN (safe as a
  // plain var, not a secret). Optional: when unset the Worker runs with Sentry
  // disabled (no-op) — see the withSentry() wrapper in src/index.ts.
  SENTRY_DSN?: string;
  // When "false", House Worker rejects budget/savings/wishes APIs and skips
  // budget cron. Budget Worker leaves this unset (enabled). Symply Budget owns
  // the money product after the House→Budget split.
  BUDGET_API_ENABLED?: string;
  /** When "false", `/v2` local-first routes 404 even if `localFirstApi` capability is on. */
  LOCAL_FIRST_API_ENABLED?: string;
  // Which ecosystem app this Worker serves, e.g. 'symply-house' | 'symply-budget'
  // | 'symply-kaizen' | 'symply-health'. Required — missing/unknown → 503.
  APP_BRAND?: string;

  // Data Bridge (ES256 platform JWT + inter-Worker). House holds private JWK;
  // joined Workers hold public JWKS JSON. Absent = pre-cutover HS256 path.
  PLATFORM_JWT_PRIVATE_JWK?: string;
  PLATFORM_JWT_PUBLIC_KEYS?: string;
  TRANSFER_ENVELOPE_PRIVATE_JWK?: string;
  TRANSFER_ENVELOPE_PUBLIC_KEYS?: string;
  PLATFORM_DELETION_TOMBSTONE_PEPPERS?: string;
  TRANSFER_METADATA_PEPPERS?: string;
  PLATFORM_SERVICE_TOKEN_LAMBDA_TO_HOUSE?: string;
  PLATFORM_SERVICE_TOKEN_BUDGET_TO_HOUSE?: string;
  PLATFORM_SERVICE_TOKEN_KAIZEN_TO_HOUSE?: string;
  PLATFORM_SERVICE_TOKEN_HEALTH_TO_HOUSE?: string;
  PLATFORM_SERVICE_TOKEN_LANGUAGE_TO_HOUSE?: string;
  PLATFORM_SERVICE_TOKEN_HOUSE_TO_BUDGET?: string;
  PLATFORM_SERVICE_TOKEN_HOUSE_TO_KAIZEN?: string;
  PLATFORM_SERVICE_TOKEN_HOUSE_TO_HEALTH?: string;
  PLATFORM_SERVICE_TOKEN_HOUSE_TO_LANGUAGE?: string;
  HOUSE_API_FALLBACK_URL?: string;
  BUDGET_API_FALLBACK_URL?: string;
  KAIZEN_API_FALLBACK_URL?: string;
  /** Service bindings (RPC entrypoint PlatformBridgeApi). */
  HOUSE_SERVICE?: unknown;
  /** House default fetch handler (no entrypoint) — auth proxy; avoids CF 1042. */
  HOUSE_HTTP?: Fetcher;
  BUDGET_SERVICE?: unknown;
  KAIZEN_SERVICE?: unknown;
  // Force-enable verbose budget/AI debug logging (grep prefix [BUDGET-E2E]).
  BUDGET_DEBUG_LOGS?: string;
  JWT_SECRET: string;
  JWT_ISSUER: string;
  JWT_AUDIENCE: string;
  ACCESS_TOKEN_EXPIRY: string;
  REFRESH_TOKEN_EXPIRY: string;
  APP_URL: string;
  /** Explicit browser origins allowed to access this product API. */
  WEB_APP_ORIGINS?: string;
  API_URL: string;

  // Shared secret gating the admin PUT /features route (feature flags). Optional:
  // when unset, the write route is denied. Set via `wrangler secret put`.
  FEATURE_FLAGS_ADMIN_SECRET?: string;

  // External API keys (secrets)
  GEMINI_API_KEY: string;
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  // ADMIN keys — a different credential from the inference keys above, used
  // only by the nightly cost reconciler to read org-level billed spend
  // (`/v1/organizations/cost_report`, `/v1/organization/costs`). Optional: with
  // neither set, reconciliation is skipped and usage figures stay
  // estimate-only. Google has no equivalent API, so there is no Gemini row.
  ANTHROPIC_ADMIN_API_KEY?: string;
  OPENAI_ADMIN_API_KEY?: string;
  RESEND_API_KEY: string;
  APPLE_TEAM_ID?: string;
  APPLE_SERVICES_ID?: string;
  APPLE_KEY_ID?: string;
  APPLE_PRIVATE_KEY?: string;
  // WeatherKit (House briefing weather). Optional — feature is off if unset.
  WEATHERKIT_KEY_ID?: string;
  WEATHERKIT_PRIVATE_KEY?: string; // the WeatherKit .p8 PEM
  WEATHERKIT_SERVICE_ID?: string; // com.symply.house
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  // Google Calendar OAuth (Aihousekeeper) — CLIENT_ID is a var; CLIENT_SECRET
  // is set via `wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET`.
  GOOGLE_OAUTH_CLIENT_ID: string;
  GOOGLE_OAUTH_CLIENT_SECRET: string;
  // Comma-separated allow-list of OAuth client IDs (iOS, Android, Web) used for
  // "Sign in with Google" — the audience(s) accepted when verifying ID tokens.
  GOOGLE_SIGNIN_CLIENT_IDS?: string;

  // Aihousekeeper model IDs (non-secret; populated from [vars] in wrangler.toml).
  AIHOUSEKEEPER_BRIEFING_MODEL: string;
  AIHOUSEKEEPER_NUDGE_MODEL: string;
  AIHOUSEKEEPER_FALLBACK_MODEL: string;
  AIHOUSEKEEPER_MIN_APP_VERSION: string;
  // OpenAI Realtime voice bridge (Option B). Non-secret model + voice id.
  // OPENAI_API_KEY above is the secret used to mint ephemeral tokens.
  AIHOUSEKEEPER_REALTIME_MODEL?: string;
  AIHOUSEKEEPER_REALTIME_VOICE?: string;

  // SendGrid — API_KEY is a secret; TEMPLATE_ID / FROM_EMAIL are non-secret vars.
  SENDGRID_API_KEY: string;
  SENDGRID_DIGEST_TEMPLATE_ID: string;
  SENDGRID_FROM_EMAIL: string;

  // AWS Lambda configuration (for large PDF processing)
  AWS_LAMBDA_ARN?: string;
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  AWS_REGION?: string;

  // R2 bucket name string (matches REPORTS_BUCKET binding; passed to Lambda payload).
  REPORTS_BUCKET_NAME: string;
  /** @deprecated Use REPORTS_BUCKET_NAME — kept for legacy Lambda env parity */
  R2_BUCKET_NAME?: string;

  // Floor-plan literal trace pipeline (Cloudflare Container, see PR 4).
  // Optional: when unset, only the AI semantic SVG layer is produced and the
  // FloorPlanVectorizationService.traceFloorPlan call throws a clear error.
  VECTORIZER_TRACE_URL?: string;
  VECTORIZER_TRACE_TOKEN?: string;

  // R2 Public domain (for serving images)
  R2_PUBLIC_DOMAIN?: string;

  // Lambda callback authentication
  LAMBDA_CALLBACK_API_KEY?: string;

  // RevenueCat (AI Access Migration) — set via wrangler secret per env
  REVENUECAT_SECRET_API_KEY?: string;
  REVENUECAT_WEBHOOK_AUTH?: string;
  REVENUECAT_PROJECT_ID?: string;
  // Comma-separated RevenueCat app_ids that belong to THIS brand (iOS,Android).
  // All brands share one RevenueCat project + one webhook secret, so every Worker
  // receives every brand's webhook events; this scopes each Worker to its own apps.
  // Non-secret — set in wrangler.toml [vars]. Unset ⇒ process all (back-compat).
  REVENUECAT_APP_IDS?: string;
  // RevenueCat entitlement id (entl…) of the shared "pro" entitlement. The V2
  // active_entitlements API exposes only entitlement_id, so this maps it back to
  // the `pro` lookup key the sync logic expects. Non-secret — wrangler.toml [vars].
  REVENUECAT_PRO_ENTITLEMENT_ID?: string;

  // BYOK credential encryption — base64 32-byte AES key
  AI_CREDENTIAL_KEK_V1?: string;
  AI_CREDENTIAL_LEASE_SECRET?: string;
  /** Session-lease TTL in seconds (hybrid Keychain storage). Defaults to 7 days. */
  AI_SESSION_LEASE_TTL_SECONDS?: string;

  /** Optional Expo access token for push delivery (wrangler secret). */
  EXPO_ACCESS_TOKEN?: string;

  /**
   * Symply Health external food database (FatSecret) — OAuth 2.0
   * client-credentials pair, set per env with `wrangler secret put … -c
   * wrangler.health.toml`. BOTH optional: when either is absent the Health
   * Worker reports the provider as `not_configured` and `/health/foods/search`
   * answers from the user's own library alone. Never sent to a device; the only
   * reader is `services/health-food-provider.ts`.
   */
  FATSECRET_CLIENT_ID?: string;
  FATSECRET_CLIENT_SECRET?: string;

}

// Database type with schema
export type Database = DrizzleD1Database<typeof schema>;

// Queue message types
export interface PdfProcessingMessage {
  reportId: string;
  jobType: 'extraction' | 'summary' | 'action_plan';
  attempt: number;
}

export interface ReportProcessingMessage {
  reportId: string;
  householdId: string;
  userId: string;
  timestamp: string;
}

/**
 * Aihousekeeper outbound queue message (forward-declared per plan §F2).
 * The consumer fans out per-household outbound work; payload is intentionally
 * minimal — anything else is looked up from D1 at consume-time so queue
 * messages stay small and never carry stale snapshots.
 */
export interface AihousekeeperOutboundMessage {
  householdId: string;
  enqueuedAt: number;
}

/**
 * Garden-plan image generation queue message. The producer (approve route)
 * pre-creates a `garden_plans` row with status='generating' and an
 * `ai_tool_pending` row in status='approved'; the consumer calls OpenAI,
 * uploads to R2, flips both rows to their terminal state, and pushes a
 * notification. All identifiers are persisted in D1 so the message can stay
 * small and idempotent re-deliveries can re-derive everything they need.
 */
export interface GardenPlanGenerationMessage {
  approvalId?: string;
  gardenPlanId: string;
  householdId: string;
  userId: string;
  diagramPrompt: string;
  planType: string;
  areaLabel: string;
  enqueuedAt: number;
  boundaryDraftId?: string;
  /**
   * Optional R2 key for a reference image the consumer should pass into
   * gpt-image-1's edits endpoint. Sourced from a user attachment when present.
   * When absent the consumer falls back to text-only generation and the
   * mobile UI labels the plan as a "concept" rather than "AI-traced from
   * your lot".
   */
  referenceImageR2Key?: string;
  /**
   * Audit trail of which source produced `referenceImageR2Key`. Persisted
   * to the garden_plans row so the UI can surface the right caption
   * ("AI-traced from your lot" vs "Stylized concept") and ops can spot
   * regressions in the reference-image path.
   */
  referenceImageSource?:
    | 'user_attachment'
    | 'mapbox_satellite'
    | 'confirmed_boundary'
    | 'none';
}

/**
 * Smart Task Assistant enrichment queue message. The producer (quick-create
 * route / chat commit tool) inserts a `maintenance_tasks` row with
 * enrichment_status='pending' then enqueues this. The consumer
 * (task-enrichment-handler.ts) is idempotent on the row's enrichment_status,
 * so re-deliveries re-derive everything from D1 and the message stays small.
 */
export interface TaskEnrichmentMessage {
  taskId: string;
  householdId: string;
  userId: string;
  /** Raw voice/typed text the AI enriches from. Also persisted on the row. */
  rawText: string;
  enqueuedAt: number;
}

/** Home Projects AI schematic queue — IDs + R2 keys only (never photo bytes). */
export interface HomeProjectSchematicMessage {
  geometryId: string;
  projectId: string;
  householdId: string;
  userId: string;
  attachmentR2Keys: string[];
  enqueuedAt: number;
}

/**
 * Smart Project describe-to-draft queue.
 *
 * IDs only. The member's description lives in the `home_project_smart_drafts`
 * row and is read there by the handler — a queue message is retried, logged and
 * dead-lettered, and none of those are places for someone's description of
 * their home.
 */
export interface HomeProjectSmartDraftMessage {
  draftId: string;
  projectId: string;
  householdId: string;
  userId: string;
  attachmentR2Keys: string[];
  /** Household space names, so the model can align to rooms that already exist. */
  knownSpaceNames?: string[];
  templateKeys?: string[];
  enqueuedAt: number;
}

// JWT Payload types
export interface AccessTokenPayload {
  sub: string;
  email: string;
  email_verified: boolean;
  iat: number;
  exp: number;
  /** Platform ES256 session id (at+jwt). */
  sid?: string;
  ent_ver?: number;
  scope?: string;
  jti?: string;
  client_id?: string;
}

export interface RefreshTokenData {
  userId: string;
  tokenHash: string;
  deviceInfo?: DeviceInfo;
  expiresAt: Date;
}

export interface DeviceInfo {
  platform?: string;
  os_version?: string;
  app_version?: string;
}

// API Response types
export interface ApiResponse<T> {
  data?: T;
  error?: ApiError;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, string[]>;
}

// Auth types
export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/**
 * Platform role — distinct from `HouseholdRole`. 'admin' unlocks staff-only
 * switchboards (Symply Health's per-feature toggles); 'user' is everyone else.
 */
export type UserRole = 'user' | 'admin';

export interface UserResponse {
  id: string;
  email: string;
  email_verified: boolean;
  display_name: string | null;
  avatar_url: string | null;
  has_password: boolean;
  has_apple: boolean;
  has_google: boolean;
  role: UserRole;
  terms_accepted_at: string | null;
  has_completed_onboarding: boolean;
  onboarding_household_created: boolean;
  onboarding_report_added: boolean;
  onboarding_garbage_setup: boolean;
  onboarding_floor_plan_added: boolean;
  created_at: string;
  updated_at: string;
}

// Household types
export type HouseholdRole = 'owner' | 'member';

export interface HouseholdResponse {
  id: string;
  name: string;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state_province: string | null;
  postal_code: string | null;
  country: 'CA' | 'US' | null;
  /** The ONE global "Imperial vs Metric" preference (0142) for this property's room/space sizes, null if unset. */
  unit_system: 'metric' | 'imperial' | null;
  photo_key: string | null;
  photo_url: string | null;
  /** Owner's real purchase price in cents (what they paid), null if unset. */
  purchase_price: number | null;
  /** Purchase date, ISO 'YYYY-MM-DD', null if unset. */
  purchase_date: string | null;
  created_at: string;
  updated_at: string;
  member_count: number;
  my_role: HouseholdRole;
  floor_plan_count?: number;
}

export interface HouseholdMemberResponse {
  id: string;
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  email: string;
  role: HouseholdRole;
  joined_at: string;
}

// Report types
export type ReportStatus =
  | 'pending_upload'
  | 'uploaded'
  | 'processing'
  | 'completed'
  | 'failed';

export interface ReportResponse {
  id: string;
  household_id: string;
  filename: string;
  file_size: number;
  status: ReportStatus;
  error_message: string | null;
  page_count: number | null;
  inspection_date: string | null;
  inspector_name: string | null;
  property_address: string | null;
  uploaded_by: { id: string | null; display_name: string | null };
  created_at: string;
  updated_at: string;
  processing_progress?: number | null;
  processing_stage?: string | null;
  total_findings_count?: number | null;
  critical_findings_count?: number | null;
}

// Finding types
export type Severity = 'critical' | 'major' | 'minor' | 'informational';

export const SYSTEM_CATEGORIES = [
  // Core Systems
  'hvac',
  'plumbing',
  'electrical',
  'gas',
  'appliances',
  // Structure
  'roof',
  'foundation',
  'exterior',
  'interior',
  'windows_doors',
  'flooring',
  'painting',
  'siding',
  'gutters',
  'fencing',
  'deck_patio',
  'garage_door',
  'chimney',
  'attic',
  'basement',
  'garage',
  'insulation',
  'structure',
  // Water & Drainage
  'drainage',
  'septic',
  'pool_spa',
  'irrigation',
  // Outdoor
  'landscaping',
  'snow_removal',
  // Services
  'safety',
  'security',
  'pest_control',
  'cleaning',
  'inspection',
  // Utilities & Tech
  'phone_internet',
  'solar',
  'smart_home',
  // Home & Life (beyond maintenance)
  'finance',
  'vehicle',
  'pets',
  'health',
  'family',
  'errands',
  'documents',
  'moving',
  'events',
  // Other
  'other',
] as const;

export type SystemCategory = (typeof SYSTEM_CATEGORIES)[number];

export interface FindingResponse {
  id: string;
  system_category: SystemCategory;
  severity: Severity;
  title: string;
  description: string;
  plain_language_summary: string | null;
  ai_confidence: number | null;
  evidence_page_numbers: number[];
  created_at: string;
}

// Action Plan types
export type Timeframe =
  | '0-30_days'
  | '3-6_months'
  | '1_year'
  | '2-5_years'
  | '5-10_years';

export type Priority = 'critical' | 'recommended' | 'cosmetic';
export type ActionItemStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';

export interface ActionItemResponse {
  id: string;
  priority: Priority;
  title: string;
  description: string;
  estimated_cost_min: number | null;
  estimated_cost_max: number | null;
  cost_confidence: 'low' | 'medium' | 'high' | null;
  cost_disclaimer: string | null;
  due_date: string | null;
  status: ActionItemStatus;
  completed_at: string | null;
  finding: FindingResponse | null;
  created_at: string;
  updated_at: string;
}

// Maintenance types
export type MaintenanceFrequency =
  | 'one_time'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'quarterly'
  | 'yearly'
  | 'custom';

export type MaintenanceSource = 'manual' | 'ai_generated' | 'template';

/** Task priority/severity: nice_to_have (default) through critical */
export type TaskPrioritySeverity =
  | 'nice_to_have'
  | 'low'
  | 'medium'
  | 'high'
  | 'urgent'
  | 'critical';

export const TASK_PRIORITY_SEVERITIES: TaskPrioritySeverity[] = [
  'nice_to_have',
  'low',
  'medium',
  'high',
  'urgent',
  'critical',
];

export interface TaskPhotoResponse {
  id: string;
  photo_key: string;
  photo_url: string;
  sort_order: number;
}

/**
 * Server-computed, ready-to-render "add to planned spending" suggestion. All
 * the decision + formatting logic lives on the backend so the client just
 * renders these strings. Null when there is nothing to show (not a purchase,
 * dismissed, etc.).
 */
export interface TaskPurchaseSuggestion {
  /** 'actionable' → show the add chip; 'added' → show the confirmation. */
  state: 'actionable' | 'added';
  /** Primary line, e.g. "Looks like a purchase" / "Added to planned spending". */
  title: string;
  /** Secondary line, e.g. "Add to planned spending · ~$450–$900". Null when none. */
  subtitle: string | null;
  /** Pre-formatted cost, e.g. "$450–$900", or null when unknown. */
  amount_label: string | null;
  /** Label for the accept button (meaningful only when state='actionable'). */
  action_label: string;
}

export interface TaskResponse {
  id: string;
  system_category: SystemCategory | null;
  title: string;
  description: string | null;
  frequency: MaintenanceFrequency;
  custom_interval_days: number | null;
  next_due_date: string | null;
  last_completed_at: string | null;
  assigned_to: { id: string; display_name: string | null } | null;
  /** Room/area this task belongs to (FK householdSpaces). Drives the board's "by area" grouping/filter. */
  space_id: string | null;
  is_active: boolean;
  source: MaintenanceSource;
  // Priority/severity (default: nice_to_have)
  priority_severity: TaskPrioritySeverity;
  // Smart Task Assistant: AI-assessed fields + async enrichment lifecycle.
  // Null/undefined on manually-created tasks that were never enriched.
  risk_level?: 'low' | 'medium' | 'high' | 'critical' | null;
  complexity?: 'trivial' | 'simple' | 'moderate' | 'involved' | 'expert' | null;
  /** Coarse "how long will this take" tier — replaces the old estimated_minutes. */
  time_effort?: 'quick' | 'short' | 'medium' | 'half_day' | 'all_day' | null;
  ai_rationale?: string | null;
  enrichment_status?:
    | 'pending'
    | 'enriching'
    | 'enriched'
    | 'needs_clarification'
    | 'failed'
    | null;
  /** Set when enrichment_status='needs_clarification' — what to ask the user. */
  clarification_question?: string | null;
  /**
   * Server-computed "add to planned spending" suggestion for purchase tasks.
   * Null when nothing should be shown. The client renders it verbatim — all
   * the decision + formatting logic lives in the backend.
   */
  purchase_suggestion?: TaskPurchaseSuggestion | null;
  // Blockers (household sharing): a member flagged this task as blocked.
  blocked?: boolean;
  blocker_reason?: string | null;
  blocked_at?: string | null;
  blocked_by?: { id: string; display_name: string | null } | null;
  // Reminder settings
  reminder_enabled: boolean;
  reminder_days_before: number;
  reminder_time: string;
  reminder_repeat: boolean;
  snooze_until?: string;
  // Contractor and quote management fields
  needs_contractor?: boolean;
  contractor_category?: string;
  workflow_stage?: string;
  scheduled_work_date?: string;
  scheduled_work_time_start?: string;
  scheduled_work_time_end?: string;
  selected_quote_id?: string;
  linked_project_id?: string;
  /** True when this task is private to the user who created it. */
  is_personal: boolean;
  /** ID of the user who created this task (null for tasks created before this feature). */
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** Attachment photos (loaded on detail; omitted on list). */
  photos?: TaskPhotoResponse[];
  /** Cover image for task cards. */
  cover_photo_id?: string | null;
  cover_photo_url?: string | null;
  // Subtasks (if loaded)
  subtasks?: MaintenanceSubtask[];
  subtask_progress?: SubtaskProgress;
}

// ========== MAINTENANCE SUBTASK TYPES ==========

export interface MaintenanceSubtask {
  id: string;
  task_id: string;
  title: string;
  description: string | null;
  sort_order: number;
  is_completed: boolean;
  completed_at: string | null;
  completed_by: { id: string; display_name: string | null } | null;
  reminder_enabled: boolean;
  reminder_days_before: number;
  reminder_time: string;
  reminder_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubtaskProgress {
  completed: number;
  total: number;
  percentage: number; // 0-100
}

export interface CreateSubtaskRequest {
  title: string; // Required, non-empty
  description?: string;
  sort_order?: number; // Defaults to end of list if not provided
  reminder_enabled?: boolean; // Defaults to false
  reminder_days_before?: number; // Defaults to 1 (if reminder enabled)
  reminder_time?: string; // HH:MM format, defaults to 09:00
}

export interface UpdateSubtaskRequest {
  title?: string;
  description?: string;
  reminder_enabled?: boolean;
  reminder_days_before?: number;
  reminder_time?: string; // HH:MM format
}

export interface ReorderSubtasksRequest {
  subtask_ids: string[]; // Ordered array of subtask IDs
}

export interface CompleteSubtaskResponse {
  subtask: MaintenanceSubtask;
  task: TaskResponse; // Return updated parent task with progress
}

// Processing Job types
export type JobStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'retrying';

export interface ProcessingJobResponse {
  id: string;
  report_id: string;
  job_type: string;
  status: JobStatus;
  attempts: number;
  progress_percent: number | null;
  current_step: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
}

// Pagination — shared contract (@symply/contracts)
export type { PaginatedResponse } from '@symply/contracts';

// Permission types
export interface Permission {
  action: 'read' | 'write' | 'delete' | 'manage';
  resource: string;
}
