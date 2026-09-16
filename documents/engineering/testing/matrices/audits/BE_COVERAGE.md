# Backend Route Coverage Audit — Fleet Acceptance Matrices

> **Generated:** 2026-07-18 · **Read-only measurement.** No matrix file was modified by this audit.
> Regenerating: the resolver/differ scripts used are described in §1; they are not checked in.

---

## 1. Method

The naive approach (grepping `.get(` / `.post(` across `backend/src` and `backend-language/src`) is
**invalid** for coverage work: Hono sub-routers register paths *relative to their mount point*, so a
handler `'/:id/accept'` inside `invitations.ts` is really `POST /invitations/:id/accept`. Relative
paths cannot be diffed against the absolute paths the matrices cite. A previous naive diff produced a
meaningless "544 uncovered" artifact.

This audit resolves the **actual mount graph** instead:

1. **Entry points.** Two Workers are in scope, and only two:
   - `backend/src/index.ts` — the **fleet** Worker. `wrangler.toml`, `wrangler.budget.toml`,
     `wrangler.kaizen.toml` and `wrangler.health.toml` all declare `main = "src/index.ts"`, i.e.
     House / Budget / Kaizen / **Health (`symply-health-api`)** are the *same code* deployed four
     times with different bindings + brand gates. They therefore contribute **one** route surface,
     not four.
   - `backend-language/src/index.ts` — the **language** Worker (separate deployment, own routes).
2. **Mount table.** Every `app.route('<mount>', <ident>)` call is parsed, the identifier is traced
   back through the file's `import` statements to a module, and the module's `export default` /
   named export is resolved to the concrete Hono variable inside that file.
   - fleet: **79** `app.route()` mounts · language: **21** mounts.
3. **Nested mounts.** Router-inside-router mounts are followed recursively. Exactly one exists in the
   codebase: `serviceProviders.route('/households/:householdId', authenticatedProviders)` in
   `backend/src/routes/service-providers.ts`.
4. **Multiple mounts of one router are counted once per mount**, because they are genuinely distinct
   served paths. E.g. `templates.ts` is mounted at both `/maintenance-templates` and
   `/households/:householdId/maintenance-templates`; `service-providers.ts` and
   `auth-platform.ts` (`/auth/platform` + `/shared-user`) likewise.
5. **`app.use(...)` is never counted** — it is middleware, not a route. Brand gates
   (`requireBrandCapability`, `requireBudgetApi`, `gateHomeApiPaths`) are `app.use` and so do not
   inflate the count.
6. **Absolute path composition** = mount prefix + relative path, with slash collapsing and trailing-slash
   normalisation.
7. **Param canonicalisation.** `:householdId`, `{householdId}`, `{id}`, `:id` all normalise to
   `:P` on **both** sides of the diff, so citation style never affects the match.
8. **Matrix citations** are extracted from column 6 (`BE / persistence`) **and** column 7
   (`Console verify`) of every scored row in `platform.md`, `house.md`, `budget.md`,
   `kaizen.md`, `language.md`, `health.md`. Column 7 is included deliberately: a row that asserts
   `GET /households 200` in Console-verify is exercising that route just as much as one that names it
   in column 6.

### Matching rule (and why it is deliberately generous)

The matrices very frequently cite a route **mount-relative** — e.g. `POST /aihousekeeper/memory`
rather than `POST /households/{id}/aihousekeeper/memory`. Scoring those as misses would understate
coverage badly. So two match modes are reported:

- **EXACT** — the citation equals the full absolute served path.
- **EXACT + SUFFIX** — the citation is also accepted when it is a **segment-aligned suffix** of the
  served path. This is the headline number.

Method must agree, except that a citation with no explicit HTTP verb is treated as `ANY` and matches
any verb on that path. Citation paths ending in `/*` are treated as prefix wildcards.

---

## 2. Headline numbers

| Metric | Value |
|--------|-------|
| **Absolute routes served (worker-scoped)** | **898** — fleet **709** + language **189** |
| Distinct `METHOD + path` across both Workers (union) | 880 |
| Distinct route citations extracted from the 6 matrices | 849 (from 2,166 raw instances) |
| **Covered — EXACT match** | **420 / 898 = 46.8%** |
| **Covered — EXACT + suffix match (headline)** | **619 / 898 = 68.9%** |
| **Uncovered (zero citation)** | **279** routes across 57 route modules |
| Citations matching no served route | 46 (15 genuine + 31 extraction artifacts) |

> **The true fleet BE route coverage is ~69%**, not the ~21% a naive absolute-vs-relative diff
> implied. The naive "544 uncovered" figure was ~2× the real gap.

Note on the 898 vs 880: 18 `METHOD + path` pairs are served by *both* Workers (e.g. `GET /`,
`GET /health`, `/smart-engine/*`, the platform AI-access surface). They are two separately deployed
routes and are counted separately; the 880 union figure is given only for reference.

---

## 3. Uncovered routes — zero matrix citation

279 served routes are named by no row in any of the six matrices. Grouped by route
module, largest gap first. Each group is a candidate work item.

### `language:kaizenInterview` — 59 uncovered

- `DELETE /api/v1/kaizen-interview/companies/:id`
- `DELETE /api/v1/kaizen-interview/documents/:id`
- `DELETE /api/v1/kaizen-interview/interviews/:id`
- `DELETE /api/v1/kaizen-interview/positions/:id`
- `DELETE /api/v1/kaizen-interview/positions/:id/questions/:questionId`
- `GET /api/v1/kaizen-interview/behavioral-questions`
- `GET /api/v1/kaizen-interview/companies`
- `GET /api/v1/kaizen-interview/documents`
- `GET /api/v1/kaizen-interview/drills`
- `GET /api/v1/kaizen-interview/evidence-items`
- `GET /api/v1/kaizen-interview/general-questions`
- `GET /api/v1/kaizen-interview/interviews`
- `GET /api/v1/kaizen-interview/interviews/:id`
- `GET /api/v1/kaizen-interview/interviews/:id/question-gap-analysis`
- `GET /api/v1/kaizen-interview/interviews/:id/questions`
- `GET /api/v1/kaizen-interview/interviews/:id/report`
- `GET /api/v1/kaizen-interview/kaizen-plans/active`
- `GET /api/v1/kaizen-interview/mistake-patterns`
- `GET /api/v1/kaizen-interview/mistakes`
- `GET /api/v1/kaizen-interview/persona`
- `GET /api/v1/kaizen-interview/positions`
- `GET /api/v1/kaizen-interview/positions/:id/predicted-questions`
- `GET /api/v1/kaizen-interview/positions/:id/question-gap-history`
- `GET /api/v1/kaizen-interview/positions/:id/questions`
- `GET /api/v1/kaizen-interview/practice-loops/:id`
- `GET /api/v1/kaizen-interview/questions/:id`
- `GET /api/v1/kaizen-interview/questions/:id/answer-versions`
- `GET /api/v1/kaizen-interview/readiness`
- `GET /api/v1/kaizen-interview/tags`
- `GET /api/v1/kaizen-interview/technical-questions`
- `PATCH /api/v1/kaizen-interview/companies/:id`
- `PATCH /api/v1/kaizen-interview/evidence-items/:id`
- `PATCH /api/v1/kaizen-interview/kaizen-plans/:id`
- `PATCH /api/v1/kaizen-interview/mistakes/:id`
- `PATCH /api/v1/kaizen-interview/persona/facts/:id`
- `PATCH /api/v1/kaizen-interview/positions/:id`
- `PATCH /api/v1/kaizen-interview/positions/:id/questions/:questionId`
- `PATCH /api/v1/kaizen-interview/questions/:id/tags`
- `POST /api/v1/kaizen-interview/companies`
- `POST /api/v1/kaizen-interview/documents`
- `POST /api/v1/kaizen-interview/documents/:id/ingest`
- `POST /api/v1/kaizen-interview/drills/:id/attempt`
- `POST /api/v1/kaizen-interview/evidence-items`
- `POST /api/v1/kaizen-interview/interviews`
- `POST /api/v1/kaizen-interview/interviews/:id/question-gap-analysis`
- `POST /api/v1/kaizen-interview/interviews/:id/reanalyze`
- `POST /api/v1/kaizen-interview/interviews/:id/retry`
- `POST /api/v1/kaizen-interview/interviews/:id/upload-complete`
- `POST /api/v1/kaizen-interview/interviews/upload-intent`
- `POST /api/v1/kaizen-interview/kaizen-plans`
- `POST /api/v1/kaizen-interview/mistakes/:id/drill`
- `POST /api/v1/kaizen-interview/persona/rebuild`
- `POST /api/v1/kaizen-interview/positions`
- `POST /api/v1/kaizen-interview/positions/:id/predict-questions`
- `POST /api/v1/kaizen-interview/positions/:id/questions`
- `POST /api/v1/kaizen-interview/practice-loops`
- `POST /api/v1/kaizen-interview/questions/:id/answer-versions`
- `POST /api/v1/kaizen-interview/questions/:id/improve`
- `PUT /api/v1/kaizen-interview/interviews/:id/audio`

### `fleet:home-projects` — 18 uncovered

- `DELETE /households/:householdId/home-projects/:projectId/budget-lines/:lineId`
- `DELETE /households/:householdId/home-projects/:projectId/selections/:selectionId`
- `GET /households/:householdId/home-projects/:projectId/activity`
- `GET /households/:householdId/home-projects/:projectId/exports/:exportId/pdf`
- `GET /households/:householdId/home-projects/:projectId/geometry`
- `PATCH /households/:householdId/home-projects/:projectId/budget-lines/:lineId`
- `PATCH /households/:householdId/home-projects/:projectId/selections/:selectionId`
- `POST /households/:householdId/home-projects/:projectId/ai/scope`
- `POST /households/:householdId/home-projects/:projectId/blockers`
- `POST /households/:householdId/home-projects/:projectId/budget-lines`
- `POST /households/:householdId/home-projects/:projectId/comments`
- `POST /households/:householdId/home-projects/:projectId/export.pdf`
- `POST /households/:householdId/home-projects/:projectId/geometry/ai-schematic`
- `POST /households/:householdId/home-projects/:projectId/geometry/roomplan`
- `POST /households/:householdId/home-projects/:projectId/plan-links`
- `POST /households/:householdId/home-projects/:projectId/selections`
- `POST /households/:householdId/home-projects/:projectId/selections/from-link`
- `PUT /households/:householdId/home-projects/:projectId/geometry/manual`

### `fleet:floor-plans` — 15 uncovered

- `DELETE /households/:householdId/floor-plans/annotations/:annotationId`
- `GET /households/:householdId/floor-plans/:id/analysis`
- `GET /households/:householdId/floor-plans/:id/annotations`
- `GET /households/:householdId/floor-plans/:id/markers`
- `GET /households/:householdId/floor-plans/:id/regions`
- `GET /households/:householdId/floor-plans/:id/vector`
- `GET /households/:householdId/floor-plans/markers-for-entity`
- `PATCH /households/:householdId/floor-plans/:id/analysis`
- `POST /households/:householdId/floor-plans/:id/analyze`
- `POST /households/:householdId/floor-plans/:id/annotations`
- `POST /households/:householdId/floor-plans/:id/calibrate-scale`
- `POST /households/:householdId/floor-plans/:id/markers`
- `POST /households/:householdId/floor-plans/:id/regions/:regionId/retry`
- `POST /households/:householdId/floor-plans/:id/regions/process-pending`
- `POST /households/:householdId/floor-plans/:id/vectorize`

### `fleet:visit-notes` — 10 uncovered

- `DELETE /households/:householdId/visits/:visitId/notes/:noteId`
- `DELETE /households/:householdId/visits/:visitId/notes/:noteId/tags`
- `GET /households/:householdId/notes/search`
- `GET /households/:householdId/visits/:visitId/notes/:noteId`
- `GET /households/:householdId/visits/:visitId/notes/grouped`
- `PATCH /households/:householdId/visits/:visitId/notes/:noteId`
- `POST /households/:householdId/visits/:visitId/notes/:noteId/tags`
- `POST /households/:householdId/visits/:visitId/notes/:noteId/transcription`
- `POST /households/:householdId/visits/:visitId/notes/text`
- `POST /households/:householdId/visits/:visitId/notes/voice`

### `fleet:dev` — 9 uncovered

- `GET /dev/list-r2-files`
- `POST /dev/test-contractor-search`
- `POST /dev/test-garbage-detect`
- `POST /dev/test-parse-pdf`
- `POST /dev/test-pdf-describe`
- `POST /dev/test-pdf-fileapi`
- `POST /dev/test-pdf-simple`
- `POST /dev/test-pdf-upload`
- `POST /dev/test-voice-session`

### `fleet:garden-plans` — 9 uncovered

- `GET /households/:householdId/garden-plans/:id/markers`
- `GET /households/:householdId/garden-plans/:id/objects`
- `GET /households/:householdId/garden-plans/markers/for-entity/:entityType/:entityId`
- `PATCH /households/:householdId/garden-plans/:id/boundary`
- `PATCH /households/:householdId/garden-plans/boundary-drafts/:draftId/boundary`
- `POST /households/:householdId/garden-plans/:id/markers`
- `POST /households/:householdId/garden-plans/:id/retry`
- `POST /households/:householdId/garden-plans/boundary-drafts/:draftId/generate`
- `PUT /households/:householdId/garden-plans/:id/objects`

### `language:learner` — 9 uncovered

- `GET /api/v1/learner/gamification/summary`
- `GET /api/v1/learner/memory`
- `GET /api/v1/learner/skills`
- `POST /api/v1/learner/gamification/freeze`
- `POST /api/v1/learner/gamification/xp`
- `POST /api/v1/learner/memory`
- `POST /api/v1/learner/onboarding/turn`
- `POST /api/v1/learner/skills/update`
- `POST /api/v1/learner/translate`

### `fleet:service-providers` — 8 uncovered

- `GET /households/:householdId/service-providers`
- `GET /households/:householdId/service-providers/:id`
- `GET /households/:householdId/service-providers/:id/reviews`
- `GET /service-providers`
- `GET /service-providers/:id`
- `GET /service-providers/:id/reviews`
- `POST /households/:householdId/service-providers/households/:householdId/:id/reviews`
- `POST /service-providers/households/:householdId/:id/reviews`

### `fleet:visit-checklists` — 8 uncovered

- `DELETE /households/:householdId/visit-checklists/:id`
- `GET /households/:householdId/visit-checklists/:id`
- `GET /households/:householdId/visit-checklists/templates/:templateId`
- `GET /households/:householdId/visit-checklists/templates/category/:category`
- `PATCH /households/:householdId/visit-checklists/:id`
- `POST /households/:householdId/visit-checklists/:id/generate-ai-suggestions`
- `POST /households/:householdId/visit-checklists/:id/items/:itemId/voice-note`
- `POST /households/:householdId/visit-checklists/ai/conversation/:conversationId/message`

### `language:user` — 8 uncovered

- `DELETE /api/v1/user/account`
- `DELETE /api/v1/user/avatar`
- `GET /api/v1/user/avatar/:userId/:file`
- `GET /api/v1/user/timezone`
- `POST /api/v1/user/avatar`
- `POST /api/v1/user/cleanup`
- `PUT /api/v1/user/profile`
- `PUT /api/v1/user/timezone`

### `fleet:images` — 7 uncovered

- `DELETE /households/:householdId/images/:imageId`
- `GET /api/images/:imageKey{.*}`
- `GET /files/:imageKey{.*}`
- `GET /households/:householdId/findings/:findingId/images`
- `GET /households/:householdId/images/:imageId`
- `PATCH /households/:householdId/images/:imageId`
- `POST /households/:householdId/images/:imageId/link`

### `language:assessment` — 7 uncovered

- `DELETE /api/v1/assessment/:sessionId`
- `GET /api/v1/assessment/audio/:assessmentId`
- `GET /api/v1/assessment/history`
- `GET /api/v1/assessment/report/:sessionId`
- `GET /api/v1/assessment/topics`
- `POST /api/v1/assessment/pronunciation/check`
- `POST /api/v1/assessment/submit`

### `language:drive` — 7 uncovered

- `DELETE /api/v1/drive/disconnect`
- `GET /api/v1/drive/files`
- `GET /api/v1/drive/files/:id`
- `GET /api/v1/drive/files/:id/content`
- `GET /api/v1/drive/files/:id/text`
- `POST /api/v1/drive/connect`
- `POST /api/v1/drive/files`

### `fleet:representatives` — 6 uncovered

- `DELETE /households/:householdId/contractors/:contractorId/representatives/:id`
- `GET /households/:householdId/contractors/:contractorId/representatives`
- `GET /households/:householdId/contractors/:contractorId/representatives/:id`
- `PATCH /households/:householdId/contractors/:contractorId/representatives/:id`
- `POST /households/:householdId/contractors/:contractorId/representatives`
- `POST /households/:householdId/contractors/:contractorId/representatives/:id/set-primary`

### `language:learningPlan` — 6 uncovered

- `DELETE /api/v1/plan/:planId`
- `GET /api/v1/plan/:planId`
- `GET /api/v1/plan/all`
- `POST /api/v1/plan/:planId/progress`
- `POST /api/v1/plan/adjust-from-latest-assessment`
- `POST /api/v1/plan/generate-with-schedule`

### `language:teachers` — 6 uncovered

- `DELETE /api/v1/teachers/:id`
- `GET /api/v1/teachers`
- `GET /api/v1/teachers/:id`
- `GET /api/v1/teachers/predefined`
- `POST /api/v1/teachers`
- `PUT /api/v1/teachers/:id`

### `fleet:contractors` — 5 uncovered

- `GET /households/:householdId/contractors/:contractorId/documents`
- `GET /households/:householdId/contractors/documents/:documentId/download`
- `GET /households/:householdId/contractors/test`
- `POST /households/:householdId/contractors/visits/:visitId/receipt-reminder-task`
- `POST /households/:householdId/contractors/visits/:visitId/request-receipt`

### `language:cards` — 5 uncovered

- `DELETE /api/v1/cards/:id`
- `GET /api/v1/cards`
- `POST /api/v1/cards`
- `POST /api/v1/cards/bulk-import`
- `PUT /api/v1/cards/:id`

### `language:practice` — 5 uncovered

- `GET /api/v1/practice/backlog`
- `GET /api/v1/practice/mistakes`
- `GET /api/v1/practice/mistakes/:id`
- `GET /api/v1/practice/stats`
- `POST /api/v1/practice/mistakes/:id/attempt`

### `fleet:ai-housekeeper` — 4 uncovered

- `GET /api/ai-housekeeper/households/:householdId/predictions`
- `GET /api/ai-housekeeper/households/:householdId/seasonal-checklist`
- `POST /api/ai-housekeeper/households/:householdId/analyze`
- `POST /api/ai-housekeeper/suggestions/:suggestionId/feedback`

### `fleet:savings` — 4 uncovered

- `DELETE /households/:householdId/savings/income-templates/:id`
- `DELETE /households/:householdId/savings/spending/:id`
- `PATCH /households/:householdId/savings/income-templates/:id`
- `PATCH /households/:householdId/savings/spending/:id`

### `fleet:task-drafts` — 4 uncovered

- `GET /households/:householdId/task-drafts/summary`
- `POST /households/:householdId/task-drafts/:id/convert`
- `POST /households/:householdId/task-drafts/bulk-convert`
- `POST /households/:householdId/task-drafts/generate`

### `fleet:auth-platform` — 4 uncovered

- `POST /shared-user/companion`
- `POST /shared-user/deletion`
- `POST /shared-user/deletion-status`
- `POST /shared-user/revoke-session`

### `fleet:index.ts (inline)` — 3 uncovered

- `GET /`
- `GET /.well-known/apple-app-site-association`
- `GET /.well-known/assetlinks.json`

### `fleet:aihousekeeper-attachments` — 3 uncovered

- `DELETE /households/:householdId/aihousekeeper/attachments/:id`
- `GET /households/:householdId/aihousekeeper/attachments`
- `GET /households/:householdId/aihousekeeper/attachments/:id`

### `fleet:garbage-collection` — 3 uncovered

- `GET /households/:householdId/garbage-collection/:id/next-collections`
- `GET /municipalities/:name`
- `PATCH /households/:householdId/garbage-collection/:id/reminders`

### `fleet:tasks` — 3 uncovered

- `GET /households/:householdId/tasks/report`
- `GET /households/:householdId/tasks/watch`
- `POST /households/:householdId/tasks/:id/clear-snooze`

### `fleet:invite-landing` — 3 uncovered

- `GET /invite/:token`
- `GET /j/:code`
- `GET /join/:token`

### `fleet:webhooks` — 3 uncovered

- `POST /webhooks/lambda/report-processed`
- `POST /webhooks/lambda/report-progress`
- `POST /webhooks/revenuecat`

### `fleet:calendar` — 2 uncovered

- `GET /calendar/export/ical`
- `GET /calendar/ical/:token`

### `fleet:features` — 2 uncovered

- `GET /features`
- `PUT /features`

### `fleet:appliances` — 2 uncovered

- `GET /households/:householdId/appliances/:id/service-history`
- `POST /households/:householdId/appliances/:id/service-history`

### `fleet:contractor-search` — 2 uncovered

- `POST /households/:householdId/contractors/generate-email`
- `POST /households/:householdId/contractors/search`

### `fleet:home-features` — 2 uncovered

- `GET /households/:householdId/maintenance-suggestions`
- `POST /households/:householdId/maintenance-suggestions/generate`

### `fleet:reports` — 2 uncovered

- `GET /households/:householdId/reports/:id/pdf`
- `POST /households/:householdId/reports/:id/process-sync`

### `fleet:utilities` — 2 uncovered

- `POST /households/:householdId/utilities/seed/municipalities`
- `POST /households/:householdId/utilities/seed/providers`

### `fleet:oauth-google` — 2 uncovered

- `DELETE /oauth/google`
- `GET /oauth/google/callback`

### `language:push` — 2 uncovered

- `DELETE /api/v1/push/unregister`
- `POST /api/v1/push/register`

### `language:voiceStream` — 2 uncovered

- `GET /api/v1/voice/speaking-habits`
- `POST /api/v1/voice/stream`

### `fleet:ai` — 1 uncovered

- `POST /ai/chat/stream`

### `fleet:household-spaces` — 1 uncovered

- `GET /api/space-images/:imageKey`

### `fleet:avatars` — 1 uncovered

- `GET /avatars/:filename`

### `fleet:public-briefing` — 1 uncovered

- `GET /b/:signed_token`

### `fleet:aihousekeeper` — 1 uncovered

- `POST /households/:householdId/aihousekeeper/trust-ledger/:id/undo`

### `fleet:aihousekeeper-voice` — 1 uncovered

- `POST /households/:householdId/aihousekeeper/voice-session`

### `fleet:chat-rooms` — 1 uncovered

- `GET /households/:householdId/chat-rooms/:roomId/ws`

### `fleet:messages` — 1 uncovered

- `GET /households/:householdId/messages/templates/:templateId`

### `fleet:projects` — 1 uncovered

- `PATCH /households/:householdId/projects/:projectId/payments/:paymentId`

### `fleet:quotes` — 1 uncovered

- `GET /households/:householdId/quotes/:id/document`

### `fleet:seasonal-checklists` — 1 uncovered

- `GET /households/:householdId/seasonal-checklists/:id`

### `fleet:internal-ai-leases` — 1 uncovered

- `POST /internal/ai-credential-leases/consume`

### `language:index.ts (inline)` — 1 uncovered

- `GET /`

### `language:admin` — 1 uncovered

- `POST /api/v1/admin/run-scheduled`

### `language:games` — 1 uncovered

- `POST /api/v1/games/vocabulary`

### `language:progress` — 1 uncovered

- `POST /api/v1/progress/track`

### `language:teachingChat` — 1 uncovered

- `POST /api/v1/teaching-chat/sessions/:sessionId/summary`

### `language:platformAiAccess` — 1 uncovered

- `GET /features`

---

## 4. Citations that match no served route

These are matrix rows pointing at endpoints the backend does not serve. Each one is a **false test
expectation** — a row that can never pass a real console/network assertion.

### 4a. Genuine false citations (15) — action required

| Cited | Reality in source | Example matrix rows |
|-------|-------------------|---------------------|
| `DELETE /households/:P/home-features/:P` | no DELETE verb on home-features | house.md:HOUSE-MYHOME-008 |
| `DELETE /households/:P/utilities/property-taxes/:P` | no DELETE verb on property-taxes | house.md:HOUSE-UTIL-018 |
| `GET /households/:P/budget/goals` | served path requires `/:year/:month` | budget.md:BUDGET-SETT-006 |
| `GET /households/:P/tasks/:P/budget-item` | served verb is POST, not GET | house.md:HOUSE-TASK-034 |
| `GET /jobs` | only `GET /jobs/:id` | house.md:HOUSE-RPT-024 |
| `POST /households/:P/floor-plans` | no bare POST on the collection | platform.md:PLAT-ONB-011 |
| `POST /households/:P/invitations` | collection is GET + DELETE only; invites are created via `/invite-links` or `POST /invitations/validate`+`/accept` | budget.md:BUDGET-HH-008 |
| `POST /households/:P/reports` | no bare POST; use the upload-url / confirm-upload pair | platform.md:PLAT-ONB-013 |
| `POST /households/:P/tasks/plan` | `/tasks/plan` is GET-only | house.md:HOUSE-TASK-032 |
| `POST /households/:P/utilities/bills/paid-status` | served verb is PATCH, not POST | house.md:HOUSE-UTIL-013 |
| `POST /invitations` | only `POST /invitations/accept`, `/validate`, `/:id/accept-in-app`, `/:id/decline-in-app` | house.md:HOUSE-AUTH-012 |
| `POST /invitations/:P/accept` | served path is `/invitations/:id/accept-in-app` | platform.md:PLAT-HH-031 |
| `POST /notifications` | no bare POST; see `/notifications/overrides`, `/:id/read`, `/delete-all` | house.md:HOUSE-NOTIF-004 |
| `POST /users/me/onboarding` | served path is `POST /users/me/onboarding/:step` | house.md:HOUSE-ONB-023, house.md:HOUSE-ONB-032, house.md:HOUSE-PROF-019 |
| `PUT /api/settings` | only `PUT /api/settings/:key` and `PUT /api/settings/bulk` | house.md:HOUSE-SMOKE-003, house.md:HOUSE-UTIL-029, house.md:HOUSE-SETT-005, house.md:HOUSE-SETT-006 (+7) |

### 4b. Extraction artifacts (31) — not real defects

These did not match because of how they are written in the matrix (literal `...` elisions,
mount-relative fragments with no anchor, prose file paths), not because the endpoint is missing.
They are listed for completeness and should be ignored for remediation.

- `ANY /ai-credentials/.../validate`
- `ANY /ai-credentials/anthropic`
- `ANY /api/v1`
- `ANY /budget`
- `ANY /comparison`
- `ANY /config/env.shared.ts`
- `ANY /for-task`
- `ANY /from-template`
- `ANY /geocode`
- `ANY /home-budget/*`
- `ANY /household-photos`
- `ANY /households/.../invitations`
- `ANY /households/.../invite`
- `ANY /households/.../leave`
- `ANY /households/.../reports`
- `ANY /households/.../spaces`
- `ANY /invitations/.../accept`
- `ANY /invitations/.../accept-in-app`
- `ANY /invitations/.../decline-in-app`
- `ANY /live`
- `ANY /marker`
- `ANY /members`
- `ANY /messages/conversation`
- `ANY /notifications`
- `ANY /notifications/join-request`
- `ANY /notifications/overrides/category`
- `ANY /notifications/overrides/space`
- `ANY /overrides/space`
- `ANY /technical-terms`
- `ANY /times`
- `ANY /users/me/onboarding/spaces`

---

## 5. Self-verification — 5 routes checked against source

Seven routes were sampled from the resolved absolute list at fixed strides and verified by reading
the registration and its mount:

| # | Resolved absolute route | Mount (index.ts) | Relative registration | Verdict |
|---|-------------------------|------------------|-----------------------|---------|
| 1 | `POST /ai-credentials/:provider/validate` | `app.route('/', aiCredentialsRoutes)` (index.ts:333) | `credentials.post('/ai-credentials/:provider/validate')` (ai-credentials.ts:51) | correct |
| 2 | `GET /households/:householdId/garden-plans/:id/objects` | `app.route('/households/:householdId/garden-plans', gardenPlansRoutes)` (index.ts:306) | `gardenPlans.get('/:id/objects')` (garden-plans.ts:414) | correct |
| 3 | `DELETE /households/:householdId/savings/recurring-payments/:id` | `app.route('/households/:householdId/savings', savingsRoutes)` (index.ts:281) | `savings.delete('/recurring-payments/:id')` (savings.ts:999) | correct |
| 4 | `POST /households/:householdId/wishes/:id/image` | `app.route('/households/:householdId/wishes', wishesRoutes)` (index.ts:282) | `wishes.post('/:id/image')` (wishes.ts:150) | correct |
| 5 | `POST /api/v1/games/vocabulary` | `app.route('/api/v1/games', games)` (backend-language/src/index.ts:139) | `games.post('/vocabulary')` (games.ts:22) | correct |
| 6 | `POST /api/v1/plan/adjust-from-latest-assessment` | `app.route('/api/v1/plan', learningPlan)` (backend-language/src/index.ts:136) | `learningPlan.post('/adjust-from-latest-assessment')` (learningPlan.ts:1087) | correct |
| 7 | `GET /households/:householdId/appointments/:id` | `app.route('/households/:householdId/appointments', appointmentRoutes)` (index.ts:291) | `appointmentsRouter.get('/:id')` | correct |

**7 / 7 correct.** No mount-resolution defects found in the sample.

An **orphan sweep** was also run: every `.ts` file under `backend/src` and `backend-language/src`
containing a handler-shaped call was checked for whether at least one of its routes made it into the
resolved list. Every file under `routes/` and `web/` resolved. The only zero-attribution files were
middleware, services, durable objects and utils whose hits are `c.get(...)` / `headers.get(...)`
false positives, i.e. correctly excluded.

---

## 6. Caveats — where this number is soft

1. **Suffix matching is generous by design.** A matrix citation of `GET /members` will satisfy
   *any* served route ending in `/members`. This can credit a route the matrix did not intend.
   The EXACT figure (**46.8%**) is the pessimistic bound; the true value sits between
   46.8% and 68.9%. Tightening the matrices to cite absolute paths would collapse the
   two numbers together and make this measurement exact.
2. **"Cited" ≠ "asserted".** This audit measures whether a route is *named* by a matrix row. It does
   not verify that the row's assertion actually exercises that route at runtime, nor that the row is
   automated. A route counted as covered may still be covered only by a manual row.
3. **Brand gating is not modelled.** `/api/v1/sync`, `/api/v1/ai/*` and `/api/v1/kaizen/*` 404 on
   non-Kaizen brands; `gateHomeApiPaths` and `requireBudgetApi` similarly narrow the surface per
   deployment. The 709 fleet routes are the *union* over all four fleet brands, so no single deployed
   Worker actually serves all 709. Per-brand served counts would be lower and per-brand coverage
   correspondingly different.
4. **Static analysis only.** Routes registered dynamically (from a loop or a variable path) would be
   missed. A scan found none, but this is not a proof.
5. **Durable Object internal fetch handlers** (`ChatRoomDO`, `RateLimiterDO`) are not HTTP routes on
   the Worker's router and are excluded.
6. **The language Worker's route surface is largely uncited** — `kaizenInterview.ts` alone accounts
   for 59 of the 279 uncovered routes, 21% of the entire gap.
