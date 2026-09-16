# Symply Ecosystem — Icon Generation Manifest

> **Manifest version:** `1.0.0` · **Last updated:** 2026-07-14
> **Purpose:** single source of truth for **AI-driven icon generation** across all 5 brands.
> A model reads this file to know *what glyphs to draw*, *in which brand palette*, *in what states*,
> *at what size/grid*, *named how*, and *where the output goes*. One app section = one self-contained job.

Companion docs: per-app style guide `documents/apps/<id>/brand/ICON_SYSTEM_GUIDE.md` ·
brandbooks `documents/apps/<id>/brand/*BRANDBOOK.md` · pipeline memory `brand-icon-kit-pipeline`.

---

## 1. Version table

| App | Brand id | Domain | Accent | Set version | Shipping | Planned (next) |
|-----|----------|--------|--------|-------------|---------:|---------------:|
| Symply House | `symply-house` | Home / property management | `#4ECDC4` teal | `1.1.0` | 77 | +12 → `1.2.0` |
| Symply Budget | `symply-budget` | Personal finance / budgeting | `#2BB673` green | `1.1.0` | 57 | +12 → `1.2.0` |
| Symply Language | `symply-language` | Language learning | `#E07A3D` orange | `1.1.0` | 82 | +12 → `1.2.0` |
| Symply Health | `symply-health` | Health / fitness | `#E5484D` red | `1.1.0` | 103 | +12 → `1.2.0` |
| Symply Kaizen | `symply-kaizen` | Kaizen / self-improvement | `#5B7CFF` periwinkle | `1.1.0` | 75 | +47 → `1.2.0` |

> **Versioning rule.** Bump an app's **Set version** whenever its icon list changes:
> `patch` = redraw/fix an existing glyph, `minor` = add/remove glyphs (planned → shipping),
> `major` = restyle the whole set (new grid/stroke/style). Bump the **Manifest version** on any
> structural change to this contract. Record the change in §7 Changelog.

---

## 2. Generation contract (applies to every app)

**States — generate all three per glyph** (into the repo, normalized names):

| State | Color treatment | Used for |
|-------|-----------------|----------|
| `selected` | full brand gradient (see per-app stops) | active / focused / primary |
| `unselected-light` | monochrome neutral for light bg (`#0A1325` @ ~70%) | inactive on light |
| `unselected-dark` | monochrome neutral for dark bg (`#F7FAFF` @ ~70%) | inactive on dark |
| `filled-accent` *(optional)* | solid brand primary fill | emphasis chips / badges (House/Language/Health kits use it) |

**Canvas & style** (matches shipped kits — do not deviate without a `major` bump):
- **Grid:** 24 × 24. Live area 22–26 pt. Keep 1–2 pt padding; no glyph touches the edge.
- **Stroke:** 1.8 pt, **rounded** caps + joins. Optical-adjust only per platform.
- **No background:** never draw a circle, tile, ring, or badge behind the glyph.
- **Gradient:** apply the brand gradient **only** to `selected`. Direction `start {0,0} → end {1,1}`, stops at `0 / 0.5 / 1`. Ink baseline `#0A1325` (shared across all brands).
- **Consistency:** one visual family per app — same weight, corner radius, and metaphor language across the whole set.

**Export:**
- PNG at **@1x/@2x/@3x** (24 / 48 / 72 px), transparent background, trimmed to the 24-grid.
- Also keep an SVG source (vendored RN components live in `brands/<id>/src/assets/icons/react-native/`).

**Naming:** lowercase **kebab-case**, matching the slug in this manifest exactly (`heart-rate`, `next-action`). The slug is the filename stem and the `<Icon name="…">` key.

**Output location (per app):**
```
brands/<id>/src/assets/icons/png/selected/<slug>.png
brands/<id>/src/assets/icons/png/unselected-light/<slug>.png
brands/<id>/src/assets/icons/png/unselected-dark/<slug>.png
```

**Wire-up after generating:**
```sh
node scripts/import-brand-icon-pngs.mjs <id> "<generated png dir>"   # copy + normalize
APP_BRAND=<id> npm run icons:build                                  # regenerate icons.generated.ts
```

**Do NOT generate** (neutral chrome — stays Ionicons by design): chevrons, close/x, back, plain
checkmarks, arrows, generic ellipsis. These are tinted at runtime and never need a brand PNG.

---

## 3. Symply House — `symply-house` · set `1.1.0`

**Palette:** primary `#4ECDC4` · dark `#3DBDB5` · light `#7EDDD6` · gradient `#4ECDC4 → #3DBDB5 → #2D9D96` · ink `#0A1325`

### Shipping (v1.1.0 — 77)
- **Tabs / nav:** home · more · profile · settings
- **Home systems:** plumbing · electrical · hvac · roof · foundation · flooring · painting · gutters · windows-doors · garage · deck · exterior · interior · appliances · smart-home · pest · water · gas · electricity · utilities
- **Spaces & layout:** spaces · floor-plan · garden-plan · landscaping
- **Tasks & work:** tasks · subtask · maintenance · labor-hub · contractors · quotes · visits · inspection · appointments · reminders · garbage
- **Members & trust:** members · trust-ledger · connected-accounts · approval · safety · security
- **Finance glance:** budget-glance · property-tax
- **Inventory & docs:** inventory · notes · photos · reports
- **AI & briefing:** ai-housekeeper · chat · briefing
- **Companions (glance):** widget-glance · watch-glance
- **Actions:** add · edit · delete · filter · sort · search · share · sync · draft
- **Status & priority:** open · in-progress · done · overdue · blocked · critical · urgent · high · medium · low
- **Auth / biometrics:** face-id · fingerprint

### Planned additions (v1.2.0 — 12)
warranty · insurance · mortgage · renovation · cleaning · moving · calendar · notifications · energy-usage · key-access · weather · home-services

---

## 4. Symply Budget — `symply-budget` · set `1.1.0`

**Palette:** primary `#2BB673` · dark `#239A61` · light `#5FD49A` · gradient `#2BB673 → #239A61 → #1B7A4C` · ink `#0A1325`

### Shipping (v1.1.0 — 57)
- **Tabs / nav:** budget · home · ai-coach · more · profile · settings
- **Budgets:** budget · budget-health · categories · planned · remaining · forecast · goal
- **Income:** income · income-category · registered-account
- **Spending categories:** spendings · expense · food · housing · transport · utilities · shopping · subscriptions · bills · maintenance-fund · other
- **Bills & recurring:** bills · recurring · due · paid
- **Debt & savings:** debt · savings
- **Transfers:** transfer · soft-transfer
- **Insights:** insights · trends
- **Data:** import · export · document-scan · sync · share
- **Status:** complete · in-progress · pending · overdue · overdue-status · skipped · review-draft
- **Notifications:** notifications
- **Auth / biometrics:** face-id · fingerprint

### Planned additions (v1.2.0 — 12)
net-worth · investments · cash · credit-card · receipt · calendar · tax · budget-alert · split-bill · emergency-fund · currency · cashflow

---

## 5. Symply Language — `symply-language` · set `1.1.0`

**Palette:** primary `#E07A3D` · dark `#C9662E` · light `#F0A06E` · gradient `#E07A3D → #C9662E → #A85222` · ink `#0A1325`

### Shipping (v1.1.0 — 82)
- **Tabs / nav:** learn · teaching-chat · more · profile · settings · preferences
- **Skills:** vocabulary · grammar · pronunciation · listening-skill · listening-audio · speaking · reading · writing · conversation
- **Practice & drills:** practice · daily-practice · drill · hint · correction · placement · assessment · level
- **Spaced repetition & memory:** spaced-repetition · memory · save-word · review-due · due-today · overdue-review · needs-retry · retry · mastered · weak · confidence
- **Session:** session-history · resume-session · results-report · processing
- **Audio / mic:** mic-ready · recording · playback · mute
- **Progress:** progress · streak · insights · trends · goals
- **Languages:** native-language · target-language
- **Topics & culture:** culture · daily-life · food · travel · numbers · people · time · work
- **AI:** ai-coach · chat-coach · ai-off
- **Data & privacy:** import · export · sync · share · privacy-data · delete-memory · permission-needed
- **Status:** complete · in-progress · pending · skipped · next-action
- **Actions:** add · edit · delete · filter · sort · search
- **Notifications:** notifications
- **Auth / biometrics:** face-id · fingerprint

### Planned additions (v1.2.0 — 12)
dictionary · translate · conjugation · phrases · alphabet · flashcards · xp-points · badge · offline-download · favorites · quiz · leaderboard

---

## 6. Symply Health — `symply-health` · set `1.1.0`

**Palette:** primary `#E5484D` · dark `#D1383C` · light `#F07A7E` · gradient `#E5484D → #D1383C → #B02A2E` · ink `#0A1325`

### Shipping (v1.1.0 — 103)
- **Tabs / nav:** health-home · activity-tab · nutrition-tab · trends-tab · more · profile · settings
- **Activity & movement:** steps · distance · walk · run · move-rings · movement · energy-active · energy-burned · timer
- **Workouts:** workouts · workout-library · strength · stretch · recovery · rest-day
- **Nutrition & meals:** nutrition · meals · breakfast · lunch · dinner · snacks · calories · macros · food-search · recipe · barcode · hydration · water
- **Vitals:** heart-rate · blood-pressure · blood-oxygen · cycle
- **Body:** body-measurements · body-photos · weight · height · progress-compare
- **Sleep & mind:** sleep · sleep-habit · mindfulness
- **Medication & care:** medication-reminder · appointment · reminders · log-entry · manual-entry
- **Goals & scores:** goals · score-gauge · health · insights · trends · streak · briefing · today-summary · suggestion
- **HealthKit & sync:** healthkit · healthkit-off · sync · sync-action · synced · not-synced · cloud-sync · history
- **Privacy & permissions:** privacy · consent · permission-needed · permission-denied · denied · local-only · local-only-status · biometric-unlock · lock-screen-hide · share-denied · share-disabled · delete-data
- **Data:** import · export · export-data · share
- **AI:** ai-coach · ai-off
- **Status:** complete · in-progress · pending · skipped · overdue · due · review-draft
- **Actions:** add · edit · delete · filter · sort · search
- **Notifications:** notifications
- **Auth / biometrics:** face-id · fingerprint

### Planned additions (v1.2.0 — 12)
mood · breathing · stress · temperature · respiratory-rate · symptoms · supplements · fasting · journal · calendar · vo2max · blood-glucose

---

## 7. Symply Kaizen — `symply-kaizen` · set `1.1.0`

**Palette:** primary `#5B7CFF` · dark `#4A68E0` / `#3A52B8` · light `#8AA4FF` · gradient `#5B7CFF → #4A68E0 → #3A52B8` · ink `#0A1325`
**Motif:** ensō (改善 kaizen — continuous improvement). Naming note: display name **Kaizen vs Life** is unresolved — do not bake lettering into glyphs.

### Shipping (v1.1.0 — 75)
- **Tabs / nav:** today · ai-coach · more · home
- **Today / daily core:** streaks · habits · focus · complete
- **Guide / AI coach:** chat · voice · insights
- **Career:** career · career-system · skills · interview · pipeline · goals · milestones · progress
- **Assess:** assess · practice · mock-test · question-bank
- **Learn:** learn · learning · courses · notes · flashcards · library · videos · knowledge · drive-import
- **Systems / life areas:** systems · health · physical · mental · spiritual · relationships · finance · creativity · travel · admin
- **Tasks / GTD:** gtd-inbox · inbox · tasks · projects
- **Focus / deep work:** deep-work · pomodoro · timer
- **Reviews / reflection:** review · weekly-review · journals · calendar
- **Insights / stats:** statistics · trends · reports · achievements
- **Data / sync:** sync · export · share
- **Notifications:** reminders
- **Account / actions:** profile · settings · add · edit · delete · search · filter · sort
- **Status:** in-progress · on-hold · pending · skipped
- **Auth / biometrics:** face-id · fingerprint

### Planned additions (v1.2.0 — 47)
- **Today:** flame · morning-reflection · move-body · evening-review
- **Guide:** reflection-prompt · suggestion
- **Career:** resume · job-offer · networking · mentor
- **Assess:** self-assessment · scorecard · strengths · growth-gaps · mastery
- **Learn:** learning-plan · quiz · bookmark · highlight · import
- **Systems:** personal · social · purpose
- **Tasks / GTD:** next-action · waiting-for · someday · habit-stack · tag
- **Focus:** break
- **Reviews:** monthly-review · gratitude · mood
- **Insights:** badge · heatmap
- **Data:** backup · cloud-offline
- **Notifications:** notification · snooze
- **Account:** sign-out · favorite · archive · help
- **Status:** overdue
- **Native (SF Symbols / mono mark — not PNG kit):** watch-app-icon · widget-mark · complication-streak · intent-log-habit

---

## 8. Logos & brand marks (per app)

Full identity sets live in each brandbook. For generation, each app needs the marks below; all app
icons must be **opaque 1024² (no alpha)**, light + dark masters. Symbol marks use the app palette.

| Mark | House | Budget | Language | Health | Kaizen |
|------|:-----:|:------:|:--------:|:------:|:------:|
| App icon iOS (light + dark) | ✓ | ✓ | ✓ | ✓ | ✓ |
| App icon iOS **tinted** | — | — | — | — | — |
| App icon Android adaptive | ✓ | ✓ | ✓ | ✓ | ✓ |
| App icon Android **themed (mono)** | — | — | — | — | — |
| Brand symbol / glyph mark | ✓ | ✓ | ✓ | ✓ | ✓ |
| Horizontal lockup (light+dark) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Stacked lockup | — | — | — | — | — |
| Splash mark + native splash | ✓ | ✓ | ✓ | ✓ | ✓ |
| Monochrome logo | — | — | — | — | — |
| Notification icon (Android mono) | — | — | — | — | — |
| Favicon / web + store marketing | — | — | — | — | — |

✓ = present · — = to create. **Wordmarks are blocked for any app whose display name is unresolved (Kaizen).**

---

## 9. Changelog

| Date | Manifest | Change |
|------|----------|--------|
| 2026-07-17 | `1.0.0` | Added shared paintbrush auth glyphs `face-id` + `fingerprint` to all 5 brand kits (set → `1.1.0`). Wired into `BiometricSetupModal` via `<Icon>`. |
| 2026-07-14 | `1.0.0` | Initial manifest. Captures shipping kits (House 75 / Budget 55 / Language 80 / Health 101 / Kaizen 73) + v1.1.0 planned additions per app. |
