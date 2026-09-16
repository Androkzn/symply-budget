# Budget · Savings → Income · per-entry Copy does not appear in the target month

**Status:** open — reproduced on device, root cause not yet located
**Found:** 2026-08-26, Budget-C (iOS 26.5 simulator), staging API
**Flow:** `e2e/maestro/budget/budget-savings-income-copy.yaml` (BUDGET-SAVE-027)
**Severity:** user-visible. The copy reports success and the sheet dismisses, but
the copied income is not in the month the user chose. Looks like silent data loss
from the member's point of view.

## Reproduction

1. Savings → Income, current month (August 2026).
2. Add an income entry (amount 77, source **refund**). It saves and appears.
3. Swipe the row left → **Copy** → `CopyEntryModal` opens.
4. Tap the **Next month** quick shift.
5. Tap **Confirm**. The sheet dismisses (success path).
6. Step the month header forward to September 2026.
7. **The copied refund entry is not there.**

## What is already ruled out

This was initially misread as a test-harness problem twice. Both readings are
disproven by the run of 2026-08-26 10:22 (report
`documents/engineering/testing/reports/budget-crud/20260826-102221`):

- **The quick-shift tap was NOT dropped.** iOS-26 New-Arch drops segmented
  control taps in a warm session (see `PensionView.tsx` header, and
  `subflows/budget-savings-force-subtab.yaml`), which would leave `target` on the
  SOURCE date and make the copy land in August — a harness artefact, not a bug.
  An assertion was added on the target label specifically to test that, and it
  passed:

  ```
  Assert that ".*Sep.*", id: copy-entry-target-label is visible   COMPLETED
  ```

  `copy-entry-target-label` renders `formatLong(target)`, so the modal genuinely
  held a **September** target at the moment Confirm was tapped.

- **The create did NOT throw.** `handleCopyTo` only calls `setCopyRow(null)` on
  the success path, and the flow waits for `copy-entry-confirm` to become not
  visible — which passed. A failed create would have raised the native
  "Could not copy this income." alert and left the sheet open. (Maestro cannot
  see native alerts, so the *sheet state* is the reliable signal here.)

- **The row is not merely off screen.** The failing lookup rewinds to the top of
  the list before searching (`savings-add-income`, direction UP) and then scans
  down. The screenshot at the failure shows the whole September list — Payroll
  ×3 and insurance — with no refund row and no scroll left to do.

## Code read (no defect found yet)

Both write layers look correct on inspection, which is why this needs a
data-level check rather than more code reading:

- `SavingsIncomeView.handleCopyTo` (`src/screens/budget/savings/SavingsIncomeView.tsx`)
  passes `income_date: targetDate` straight through to `savingsApi.createIncome`.
- `localSavingsApi.createIncome` (`src/features/budget/local/savings/localSavingsApi.ts`)
  stores `income_date: data.income_date` and derives `period: data.income_date.slice(0, 7)`
  from it — so the local-first bucket should be `2026-09`.
- `CopyEntryModal` computes the target with `addMonthsYMD(sourceDateYMD, 1)` and
  the label proves the value it held.

## Next step to isolate

Read where the row actually landed — that single fact splits the remaining
possibilities:

| Where the copy is | Implicated |
|---|---|
| In **August** (source month) | `targetDate` lost between `onConfirm` and the write |
| In **September** but not listed | the Income list query / local-first read path, or a stale list |
| **Nowhere** | the write silently no-ops (local queue not flushed, sync dropped) |

Ways to check, cheapest first:

1. Query staging directly for the household's income rows around the test date
   (`scripts/e2e/purge-budget-test-data.mjs` shows the auth + endpoint shape; it
   needs `E2E_PASSWORD`, which the Maestro runner does not export).
2. Add a dev-only `e2e-verify-persist`-style probe that reports the created
   entry's `income_date`/`period` through the existing `[E2E-VERIFY]` channel.

Note the **stale-list** possibility is not theoretical: the same suite proved on
2026-08-25 that saving a renewal does not refresh the Monthly Payments list until
the screen is remounted (see `budget-savings-renewal-reminder.yaml`, the forced
refetch before the pill assertion). If the Income list behaves the same way, the
copy may be persisting correctly and only the read is wrong.

## Unit coverage

`CopyEntryModal.test.tsx` covers the date maths. It passing while this fails
points at the write/read path rather than the shift calculation — consistent with
the label assertion above.

## Do not "fix" the flow around this

`budget-savings-income-copy.yaml` exists to prove the copy lands in the TARGET
month "and not silently into the current one" (its own header). It is currently
the only red flow in the Budget savings suite (16/16 others green), and it is red
because it is doing its job. Loosening its assertions would hide this.
