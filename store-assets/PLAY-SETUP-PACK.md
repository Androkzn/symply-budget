# Google Play — Setup Pack (all 5 apps)

Generated 2026-07-14. Copy-paste source for each app's Play Console listing + "Set up your app" flow.
Account: **Personal** (Andrei Tekhtelev, ID 8418064687776376035). All 5 apps are **Draft**.

> **Legend:** ✅ ready · ⚠️ needs your input · 🔴 blocker before Production

---

## 0. Assets generated for you (in `store-assets/<brand>/`)

| Asset | Status | Notes |
|-------|--------|-------|
| `store-icon-512.png` (512×512) | ✅ all 5 | Play "App icon" |
| `feature-graphic-1024x500.png` | ✅ all 5 | Play "Feature graphic" (brand gradient + name) |
| Phone screenshots (min 2, 1080p+) | 🔴 all 5 | Must be **real** app screens — need Android emulator/device capture |

---

## 1. Blockers — RESOLVED ✅

### ✅ A. Public Privacy Policy URL
**`https://symply-legal.a-tekhtelev.workers.dev/privacy`** — live (Cloudflare Worker `symply-legal`, source in `legal-site/`). Paste into every app's "Privacy policy" field. Covers all 5 apps.

### ✅ B. Data-deletion URL
**`https://symply-legal.a-tekhtelev.workers.dev/data-deletion`** — live. Use in Data safety → "Provide a way for users to request that their data be deleted."

### ✅ C. App access test credentials (seeded on production backends)
Enter under **App access → All/some functionality is restricted**. All share password **`SymplyPlay#2026`**:

| App | Reviewer login |
|-----|----------------|
| Symply House | `a.tekhtelev+play-house@gmail.com` |
| Symply Budget | `a.tekhtelev+play-budget@gmail.com` |
| Symply Kaizen | `a.tekhtelev+play-kaizen@gmail.com` |
| Symply Language | `a.tekhtelev+play-language@gmail.com` |
| Symply Health | `a.tekhtelev+play-health@gmail.com` |

All 5 verified with a successful login (HTTP 200) against each app's production API. Plus-addressed to your Gmail so any verification email reaches you. Instruction to add for reviewers: "Tap 'Continue with email', enter the credentials above, and sign in."

---

## 2. Store listings (copy-paste)

> Title is already set as the app name. `Short description` ≤ 80 chars. `Full description` ≤ 4000 chars.

### Symply House — Category: **House & Home**
- **Short description:**
  `Your household command center — tasks, spaces, bills, reminders and AI help.`
- **Full description:**
```
Symply House turns everything about running your home into one calm, practical command center.

Organize your household the way it actually works:
• Tasks & reminders — never lose track of chores, maintenance, or one-off jobs
• Spaces — rooms, areas, and what belongs where
• Bills & utilities — keep home costs and providers in one place
• Contractors & visits — who's coming, what for, and when
• Household chat — keep everyone on the same page
• Reports — a clear picture of how your home is running
• Widgets & Apple Watch — glance at what matters without opening the app

Meet Mira, your optional AI Housekeeper — she helps plan, remind, and tidy up your household data. Prefer to do it yourself? Every core feature works fully with AI turned off.

Your data is yours. Sign in with Apple or Google, and delete your account and data any time from Settings.

Symply House is part of the Symply family of focused apps for a simpler life.
```

### Symply Budget — Category: **Finance**
- **Short description:**
  `Plan spending, track bills and grow savings — your full household budget.`
- **Full description:**
```
Symply Budget is your dedicated household budgeting app — built for real life, not spreadsheets.

Take control of your money:
• Planned vs actual spending — see where your money is really going
• Bills & recurring payments — never miss a due date
• Savings goals — set targets and watch them grow
• Registered accounts — keep your accounts organized in one place
• Document import — pull in statements instead of typing everything
• Long-term planning — budget for home maintenance and big future costs

Manual entry and review-before-save always work, with optional AI to speed up imports and categorization. Nothing is shared without your explicit consent.

Sign in with Apple or Google. Widgets and Apple Watch keep your budget a glance away. Delete your account and data any time from Settings.

Symply Budget is part of the Symply family — one account, focused apps.
```

### Symply Kaizen — Category: **Productivity**
> ⚠️ Naming: brand config + build show **"Symply Kaizen"**; product docs lean "Symply Life." Listing below uses **Symply Kaizen** to match the built app. Decide before Production if you want "Symply Life."
- **Short description:**
  `Your personal operating system — habits, systems, growth and daily focus.`
- **Full description:**
```
Symply Kaizen is your personal operating system — a calm home for daily systems, habits, and steady growth.

Build the life you want, one small improvement at a time:
• Today — your daily focus and core actions in one view
• Systems & habits — routines that actually stick
• Career & growth — track goals and progress that matter
• Learning & practice — turn intentions into consistent reps
• Reviews — reflect, adjust, and keep momentum
• Optional coaching — guidance when you want it

Every core flow works with AI off — Today, systems, practice, and logging stay useful and manual whenever you prefer.

Sign in with Apple or Google. Delete your account and data any time from Settings.

Symply Kaizen is part of the Symply family of focused apps for a simpler life.
```

### Symply Language — Category: **Education**
- **Short description:**
  `Learn a language simply — assessment, guided practice and teaching chat.`
- **Full description:**
```
Symply Language helps you learn a new language the simple way — with a plan that fits you and practice that sticks.

Learn at your level:
• Assessment — find your real starting point
• Personal learning plan — clear next steps, not overwhelm
• Guided practice — bite-sized sessions that build fluency
• Teaching chat — practice conversation and get feedback
• Vocabulary & pronunciation — review what matters most
• Progress tracking — see how far you've come

AI can enhance assessment, chat, and feedback — but core navigation, vocabulary review, and progress always work without it.

Sign in with Apple or Google. Delete your account and data any time from Settings.

Symply Language is part of the Symply family of focused apps for a simpler life.
```

### Symply Health — Category: **Health & Fitness**
- **Short description:**
  `Privacy-first health and wellness — nutrition, movement and body metrics.`
- **Full description:**
```
Symply Health is a privacy-first way to track your health and wellness — you decide what to share, always.

Understand your wellbeing:
• Health summaries — the big picture at a glance
• Nutrition — log meals and see patterns
• Movement — track activity your way
• Body metrics — weight and measurements over time
• Progress review — reflect and stay motivated

Privacy is the default. Permissions are scoped and explained, manual entry is always available, and your health data is never shared with other apps without a clear, explicit opt-in.

Sign in with Apple or Google. Delete your account and data any time from Settings.

Symply Health is part of the Symply family of focused apps for a simpler life.
```

---

## 3. "Set up your app" — recommended answers (per app unless noted)

> ⚠️ Data safety and content rating are legal declarations — **verify against actual behavior** before submitting. These are grounded recommendations, not guarantees.

| Section | Recommended answer |
|---------|-------------------|
| **Privacy policy** | `https://symply-legal.a-tekhtelev.workers.dev/privacy` |
| **Ads** | No, this app does not contain ads |
| **App access** | All/some functionality restricted → reviewer login from §1C |
| **Content rating** | Complete IARC questionnaire; email `privacy@simplehouse.app`; category **Utility/Productivity**; no violence/sexual/profanity/gambling. ⚠️ If the app has **user-to-user chat** (House household chat), declare "Users interact / share content." Expect **Everyone / PEGI 3** (or Teen if interaction declared). |
| **Target audience** | Target age **18+** (finance/health/adult productivity). "Appeals to children" → **No**. Keeps you out of Families policy. |
| **News app** | No |
| **COVID-19 contact tracing** | No |
| **Data safety** | See table §4 |
| **Government app** | No |
| **Financial features** *(Budget only)* | Personal budgeting / money management. Not loans, not a regulated product, no crypto. Declare as personal finance management. |
| **Health apps** *(Health only)* | Personal health & wellness tracking; no medical device claims, no clinical/diagnostic function. |

---

## 4. Data safety — draft answers (verify!)

Applies to all; **Budget** adds Financial info, **Health** adds Health & fitness.

| Question | Answer |
|----------|--------|
| Collect or share user data? | **Yes** |
| Personal info | **Name, Email** (from Apple/Google sign-in) — required, app functionality |
| App activity | **Analytics/app interactions** (PostHog) |
| App performance | **Crash logs, Diagnostics** (Sentry) |
| Financial info *(Budget)* | **Other financial info** — user's own budget data, app functionality, **not shared** |
| Health & fitness *(Health)* | **Health info** — app functionality, **not shared** |
| Purchases | **Purchase history** (RevenueCat subscriptions) |
| Encrypted in transit? | **Yes** (HTTPS to Cloudflare Worker) |
| Can users request deletion? | **Yes** — in-app Delete Account + `https://symply-legal.a-tekhtelev.workers.dev/data-deletion` |
| Data shared with third parties? | Analytics/crash/purchases vendors act as **processors on your behalf** — review each against Play's "shared" definition; if only processing, mark **collected, not shared** |

---

## 5. Testers — start the 14-day / 12-tester Closed-test clock

**Invite message (send with each app's opt-in link):**
```
You're invited to test <App name> before launch 🎉

1) Tap this link on your Android phone: <PASTE OPT-IN LINK>
2) Tap "Become a tester", then install from Google Play
3) Please stay opted in for at least 2 weeks and don't leave the test —
   Google requires 12 testers for 14 continuous days before we can launch.

Thanks! Any feedback is welcome.
```

**Tester tracker — need ≥12 opted-in, aim for 14–15 buffer:**

| # | Name | Google account email | Group added | Opted in? |
|---|------|----------------------|-------------|-----------|
| 1 |  |  | ☐ | ☐ |
| 2 |  |  | ☐ | ☐ |
| 3 |  |  | ☐ | ☐ |
| 4 |  |  | ☐ | ☐ |
| 5 |  |  | ☐ | ☐ |
| 6 |  |  | ☐ | ☐ |
| 7 |  |  | ☐ | ☐ |
| 8 |  |  | ☐ | ☐ |
| 9 |  |  | ☐ | ☐ |
| 10 |  |  | ☐ | ☐ |
| 11 |  |  | ☐ | ☐ |
| 12 |  |  | ☐ | ☐ |
| 13 |  |  | ☐ | ☐ (buffer) |
| 14 |  |  | ☐ | ☐ (buffer) |
| 15 |  |  | ☐ | ☐ (buffer) |

Reuse the **same Google Group** (`symply-testers@googlegroups.com`) across all 5 apps → 5 clocks run in parallel.

---

## 6. Per-app upload checklist (repeat for each of the 5)

1. ☐ App → **Store listing**: paste short + full description (§2), upload `store-icon-512.png` + `feature-graphic-1024x500.png`, add ≥2 phone screenshots, set category
2. ☐ **Set up your app** tasks (§3) all green
3. ☐ **Data safety** (§4) submitted
4. ☐ **Content rating** questionnaire submitted
5. ☐ **Testing → Closed testing → Alpha** → add Google Group → upload `.aab` (EAS build) → create release → roll out
6. ☐ Copy opt-in link → send tester invite (§5)
7. ☐ Collect 12+ opt-ins → 14-day clock starts
8. ☐ (Day 14+, identity approved) → apply for Production access → promote

---

## 7. Build → AAB status

All 5 Android production AABs launched on EAS (2026-07-14). Watch:
- House https://expo.dev/accounts/androkzn/projects/simple-house/builds/dd5eb80b-36d8-4598-926b-2fe322b1f81b
- Budget https://expo.dev/accounts/androkzn/projects/symply-budget/builds/4d3a7552-fe3b-44c0-8827-bd959015a824
- Kaizen https://expo.dev/accounts/androkzn/projects/symply-kaizen/builds/548e0fc4-8b68-43b6-ba43-cd59d1306603
- Language https://expo.dev/accounts/androkzn/projects/symply-language/builds/517dd320-3453-4bc5-aa75-9dabf7645408
- Health https://expo.dev/accounts/androkzn/projects/simple-health/builds/93f29d26-cde1-4c04-bef5-783516d911b7

Download the `.aab` from each build page (or `eas build:download`) once FINISHED.
