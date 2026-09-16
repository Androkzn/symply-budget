# Manual check — Symply Budget widget & Watch

| Field | Value |
|-------|-------|
| **Scope** | The last hop only: iOS home-screen widget + Apple Watch companion rendering |
| **Backs** | `BUDGET-WIDGET-010`, `BUDGET-WIDGET-011`, `BUDGET-WIDGET-019`, `BUDGET-WIDGET-020`, `BUDGET-WIDGET-022`, `BUDGET-WATCH-010` |
| **Matrix** | [budget.md](../matrices/budget.md) — WIDGET / WATCH sections |
| **Why manual** | Maestro drives the app process only. It has no home-screen surface and no watchOS surface, so widget installation, timeline refresh, widget tap and paired-watch rendering cannot be automated. |

Everything **upstream** of these three rows is unit-covered — payload shape, units,
null-guarding, brand gating, key naming and logout hygiene all fail in CI before a
human ever runs this page. Treat this checklist as proof of the final hop, not as
the primary safety net.

---

## Prerequisites

1. Free disk first — an Expo dev build needs ~20–40 GB and this machine runs close
   to full. See the disk-cleanup notes before starting.
2. Build the Budget brand:
   ```sh
   npm run prepare:xcode:budget
   ```
   Confirm the built app is `com.symply.budget` — the brand tooling has historically
   produced a Budget bundle from a House prepare and vice versa. Check
   `ios/Brand.generated.xcconfig` before you build.
3. Sign in with the shared test account and open the **Home** tab. Wait for the
   dashboard to finish loading — the snapshot is not written until the monthly
   overview resolves (that null-guard is `BUDGET-WIDGET-004`).

---

## BUDGET-WIDGET-010 — widget renders live figures

1. Long-press the simulator home screen → **+** → search "Symply".
2. Add the **small** Budget widget.
3. Read the remaining / spent / budget figures.

**Pass:** the figures match the dashboard's balance card exactly.

**Watch for the two failure modes this row exists to catch:**

- **Placeholder forever.** Means nothing wrote `widget_budget_summary`. This was the
  real state of the app until 2026-07-20 — the only writer was `BudgetHomeScreen`,
  which is never mounted for the Budget brand.
- **Figures 100× too small** (e.g. `$1,234.56` shows as `$12`). Means major units were
  published where the widget expects integer cents. `BudgetFormat.money(_ cents: Int)`
  divides by 100 itself. Unit-guarded by `BUDGET-WIDGET-003`.

4. Change the budget in-app, return to the home screen.

**Pass:** the widget updates after the reload rather than waiting for the system's
next timeline slot.

5. Repeat for the **medium** family. Confirm the thin spend-progress bar under the
   two stat tiles reads the same percentage as the dashboard, and — if the household
   has savings data — the "Saved $X · ±N% vs last month" row appears with an
   up/down arrow matching the actual direction (a brand-new household with no prior
   month shows a neutral banknote glyph and no percentage instead).
6. If the household has a recent AI "Budget Wins" card on the dashboard, confirm its
   message (or a close paraphrase — copy can be re-generated) appears at the bottom
   of the medium widget with the matching emoji. If there is no AI insight yet, the
   widget falls back to the top-category/next-bill row instead — that is correct,
   not a bug.

---

## BUDGET-WIDGET-019 — `systemLarge` renders the full dashboard

1. Add the **large** Budget widget (previously identical to medium — it silently
   fell back through `default:`).

**Pass:** shows all four figures as a 2×2 grid (remaining, spent, budget, savings),
a spend-progress bar, the top category, the next bill, and the AI insight banner at
the bottom (when one exists this month). This is the "full dashboard" size — nothing
should look stretched or duplicated from the medium layout.

---

## BUDGET-WIDGET-020 — header shows the real Budget app icon

1. Look at the widget header's leading badge (small/medium/large, and the gallery
   preview).

**Pass:** it is the actual Symply Budget app icon (rounded-square artwork), not a
generic white dollar-sign glyph on a mint circle. Other brands' widgets (Kaizen,
Language, Health, House) are unaffected — only Budget passes `logoImageName` to
`SymplyHeader`.

---

## BUDGET-WIDGET-022 — widget follows Settings → Currency

The one hop unit tests cannot reach: the JS side is proven to write the new ISO
code, but only a device shows that WidgetKit re-rendered with it.

1. With the widget on the home screen, note the symbol it is using.
2. In the app, go to **Settings → Currency** and pick a different currency —
   deliberately *without* visiting the Budget tab afterwards.
3. Return to the home screen.

**Pass:** the widget's figures now lead with the new currency (e.g. `CA$2,000`,
`€2,000`). The amounts themselves do **not** change — this is a display swap, not
a conversion (see `@config/currencies`).

**Watch for:**

- **Still `US$`.** The snapshot was published without a `currency`, so the widget
  fell back to USD (`BudgetBrief.currency`). This was the shipped behaviour before
  2026-09-02: the only writer never passed the field.
- **Changes only after opening the Budget tab.** The app-level watcher
  (`startBudgetSnapshotWatcher`, installed in `app/_layout.tsx`) is not running —
  without it the sole publisher is an effect inside `BudgetDashboardView`, which is
  not mounted while the member is in Settings.

4. Repeat with the paired watch running (`BUDGET-WATCH-011`). Its fallback is the
   device locale rather than USD, so on a US-region device a missing code looks
   *correct* here — check on a device whose region differs from the currency.

---

## BUDGET-WIDGET-011 — widget tap deep-links

1. Tap the widget while the app is **backgrounded**.

**Pass:** Budget opens on the widget's intended route.

2. Fully quit the app (swipe up from the app switcher), then tap the widget again.

**Pass:** the link still resolves after auth rehydration.
**Fail:** it lands on Home with the link silently discarded — the classic cold-start
drop. The in-app half of this is automated in `e2e/maestro/budget/budget-deep-links.yaml`.

---

## BUDGET-WATCH-010 — Watch renders live figures

Needs a paired watch simulator or a real paired device.

1. Run the Watch scheme against the same signed-in phone app.
2. Open the Symply Budget watch app.

**Pass:** it shows remaining / spent / budget.
**Fail:** it shows *"No budget yet. Open Symply Budget on your iPhone."* — that empty
state was **permanent** for every brand before 2026-07-20, because no code anywhere
in the repo wrote any `watch_*` App Group key. If you see it again, the publisher
regressed; start at `src/features/budget/budgetSnapshot.ts`.

3. Change the budget on the phone.

**Pass:** the watch reflects it without a manual relaunch.

4. Drive spending **past** the budget so remaining goes negative.

**Pass:** the "Over budget" caption and accent render. A clamped-at-zero payload
would hide this state entirely — unit-guarded by `BUDGET-WATCH-004`.

5. Note the units: the watch takes **major units** (`1234.56`) while the widget takes
   **integer cents** (`123456`). This divergence is deliberate and is pinned by
   `BUDGET-WATCH-003`. If watch figures look 100× too large, the widget payload was
   sent to the watch key.

---

## Logout hygiene (both surfaces)

1. With both the widget and the watch app showing live figures, **sign out** in the app.

**Pass:** both fall back to their placeholder / empty state.
**Fail:** either still shows household figures. That is a privacy defect — household
data readable from a signed-out device. `clear()` omitted all four `watch_*` keys
until 2026-07-20. Unit-guarded by `BUDGET-WIDGET-007` / `BUDGET-WATCH-007`, and the
drift guard `BUDGET-WIDGET-008` fails CI if a new snapshot key is added without a
matching entry in `clear()`.

---

## Recording the result

Score these three rows in the dated `RESULTS_YYYY-MM-DD_budget.md` copy, not here.
Note the simulator/device and watchOS version in the row's Notes column. Do not paste
account identifiers or tokens into the results file.
