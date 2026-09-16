# Symply Kaizen — Maestro E2E

End-to-end UI flows for the **Kaizen** brand (`symply-kaizen`), covering every screen
and interactive element on **iPhone and iPad**.

- App: bundle id `com.symply.kaizen`, URL scheme `kaizen://`
- Brand feature code: [`src/features/kaizen/`](../../../src/features/kaizen)
- Component + unit tests (Jest): [`src/features/kaizen/**/__tests__`](../../../src/features/kaizen)

## Flows

| Flow | Covers |
|------|--------|
| `scroll-all-screens.yaml` | Scroll contract — every hub tab scrolls to its bottom sentinel |
| `all-hubs.yaml` | **Default runner** — single-session smoke across Today, Guide, More, Systems, Career, Assess, Learn (includes scroll checks) |
| `today-screen.yaml` | Today tab — daily core summary |
| `guide-screen.yaml` | Guide tab — AI coach shell |
| `more-hub.yaml` | More tab — overflow sections + stack navigation |
| `career-hub.yaml` | Career hub — stats + tool rows |
| `assess-hub.yaml` | Assess hub — mastery summary |
| `learn-hub.yaml` | Learn hub — capture card |
| `systems-hub.yaml` | Systems hub — enabled life systems |

### Per-screen interaction flows

Each drives one destination screen: launch logged-in → deep-link to the route
(`subflows/open-kaizen-route.yaml`) → assert the screen + key content → tap the
primary controls with real selectors → assert the UI outcome → scroll contract →
`subflows/return-to-today.yaml`.

| Flow | Primary interaction / outcome |
|------|-------------------------------|
| `deep-work.yaml` | Type a focus topic → text renders (Add block untapped: backgrounds app) |
| `weekly-rotation.yaml` | Type a day focus → renders |
| `system-detail.yaml` | Pause → button flips to `Enable system`; re-enable restores |
| `system-config.yaml` | Add a custom action → chip appears |
| `habit-stacks.yaml` | Name a stack; add a step when daily-core exists (`Added`) |
| `question-banks.yaml` | Pick bank + add question; banks screen persists |
| `question-import.yaml` | Paste + Import for review → `Imported …` count |
| `practice-session.yaml` | Composer answer + self-score (guarded; empty state ok) |
| `learning-plan.yaml` | Plan sections + `Back to skill` |
| `reviews.yaml` | Fill 3 fields + Save review |
| `memory.yaml` | Approve a saved memory (guarded; empty state ok) |
| `notifications.yaml` | Registration button + permission-dialog dismissal |
| `profile.yaml` | Edit display name → Save/Cancel appear; Cancel restores |
| `settings.yaml` | Sync Kaizen + navigate into Manage memory |
| `books.yaml` | Reveal add form, type title, pick language |
| `book-detail.yaml` / `book-reader.yaml` / `book-quiz.yaml` | Graceful no-id states |
| `career-progress.yaml` | Read-only 30-day metrics |
| `interview-pipeline.yaml` | Add opportunity → row + `saved` stage |
| `career-setup.yaml` | Toggle goal chip + advance to Resume step |
| `resume-review.yaml` | Paste resume → renders (Review is optional AI) |
| `skill-assessment.yaml` | Begin/Start assessment shell |
| `skill-detail.yaml` | Graceful no-id state |
| `insights.yaml` | Read-only momentum panels |
| `attempt-history.yaml` | No-id empty state |

Run the whole suite (each flow individually, continue-on-failure + summary):

```sh
./scripts/e2e/run-kaizen-suite.sh                    # Kaizen-A
E2E_DEVICE=Kaizen-iPad ./scripts/e2e/run-kaizen-suite.sh
E2E_ONLY=profile,books ./scripts/e2e/run-kaizen-suite.sh   # subset
```

Dev-only onboarding bypass for Maestro: `kaizen://e2e-setup` (see `src/services/e2e-kaizen-setup.ts`), wired from `scripts/run-e2e-kaizen.sh`.

`subflows/` holds the shared launch/login/navigation steps.

## Running

```sh
# 1. Install Maestro (once)
curl -fsSL https://get.maestro.mobile.dev | bash

# 2. Build + install the Kaizen brand on a simulator (com.symply.kaizen)
npm run prepare:xcode:kaizen
APP_BRAND=symply-kaizen EXPO_PUBLIC_APP_BRAND=symply-kaizen npm run ios

# 3. Provide autologin creds (git-ignored)
#    e2e/credentials.local:  E2E_EMAIL=...  E2E_PASSWORD=...

# 4. Run — iPhone (default) and iPad
./scripts/run-e2e-kaizen.sh
E2E_DEVICE=Kaizen-iPad ./scripts/run-e2e-kaizen.sh

# single flow
./scripts/run-e2e-kaizen.sh e2e/maestro/kaizen/today-screen.yaml

# scroll contract only (all hub tabs)
./scripts/run-e2e-kaizen.sh e2e/maestro/kaizen/scroll-all-screens.yaml
npm run test:e2e:scroll:kaizen
```

The same flows run unchanged on both device classes — the runner just targets a
different simulator. On first `Kaizen-iPad` run the script creates an iPad Pro
simulator if none exists.

## Notes

- Login uses the dev-only `kaizen://e2e-login` deep link (see
  [`src/services/e2e-autologin.ts`](../../../src/services/e2e-autologin.ts));
  its `isE2ELoginUrl()` matches the `e2e-login` host on any brand scheme.
- The legacy Kaizen donor app (`com.kaizen.app`) is a different
  build with different screens — these flows target the ecosystem Kaizen brand
  `com.symply.kaizen`.
