#!/usr/bin/env python3
"""Link remaining Maestro matrix rows to e2e/maestro YAML paths."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MATRICES = ROOT / "documents/engineering/testing/matrices"

# row_id -> automation cell (repo-relative yaml paths)
LINKS: dict[str, str] = {
    "PLAT-AUTH-049": "`e2e/maestro/auth/logout-profile.yaml`, `src/stores/__tests__/authStore.logout.test.ts`",
    "PLAT-NOTIF-014": "`e2e/maestro/platform/notification-settings-load.yaml`, `src/screens/settings/__tests__/NotificationSettingsScreen.test.tsx`",
    "HOUSE-SMOKE-015": "`e2e/maestro/smoke/more-hub-inventory.yaml`, `src/components/navigation/__tests__/TabOverflowSection.test.tsx`",
    "HOUSE-HOME-003": "`e2e/maestro/home/home-status-strip.yaml`, `src/components/home/__tests__/HomeStatusStrip.test.tsx`",
    "HOUSE-PROP-001": "`e2e/maestro/my-home/property-detail-overview.yaml`, `src/screens/households/property-tabs/__tests__/PropertyOverviewTab.test.tsx`",
    "HOUSE-APPL-004": "`e2e/maestro/my-home/appliances-attention-modal.yaml`, `backend/src/routes/__tests__/appliances.test.ts`",
    "HOUSE-CHKL-003": "`e2e/maestro/tasks/checklist-defaults-create.yaml`, `backend/src/services/__tests__/checklist-service.test.ts`",
    "HOUSE-MYHOME-004": "`e2e/maestro/my-home/home-features-load.yaml`, `src/screens/home/__tests__/HomeFeaturesScreen.test.tsx`",
    "HOUSE-BUDGET-012": "`e2e/maestro/home/house-budget-zero-writes.yaml`, `src/features/budget/screens/__tests__/BudgetHomeScreen.test.tsx`",
    "BUDGET-DASH-007": "`e2e/maestro/budget/budget-dashboard-widgets.yaml`, `src/screens/budget/__tests__/BudgetEncouragementBanner.test.tsx`",
    "BUDGET-DASH-008": "`e2e/maestro/budget/budget-dashboard-widgets.yaml`, `src/screens/budget/__tests__/BudgetDashboardView.test.tsx`",
    "BUDGET-DASH-039": "`e2e/maestro/budget/budget-item-form.yaml`, `src/screens/budget/__tests__/BudgetQuickAddRow.test.tsx`",
    "BUDGET-PLAN-024": "`e2e/maestro/budget/budget-ai-screen.yaml`, `backend/src/routes/__tests__/budget-ai-detect.test.ts`",
    "BUDGET-BCHAT-016": "`e2e/maestro/budget/budget-chat-fab-visible.yaml`, `src/features/budget/chat/__tests__/BudgetChatFab.test.tsx`",
    "BUDGET-SETT-004": "`e2e/maestro/budget/budget-settings-extended.yaml`, `src/screens/budget/__tests__/BudgetSettingsScreen.test.tsx`",
    "BUDGET-SETT-009": "`e2e/maestro/budget/budget-settings-extended.yaml`, `src/screens/budget/__tests__/BudgetTimelineScreen.test.tsx`",
    "BUDGET-SETT-010": "`e2e/maestro/budget/budget-settings-extended.yaml`, `src/screens/budget/savings/__tests__/SavingsYearHistoryScreen.test.tsx`",
    "BUDGET-SETT-011": "`e2e/maestro/budget/budget-settings-extended.yaml`, `src/screens/budget/savings/__tests__/SavingsCompareYearsScreen.test.tsx`",
    "BUDGET-HH-003": "`e2e/maestro/budget/budget-household-switch.yaml`, `src/features/budget/screens/__tests__/BudgetHouseholdScreen.test.tsx`",
    "BUDGET-HH-006": "`e2e/maestro/budget/budget-household-switch.yaml`, `src/features/budget/screens/__tests__/BudgetHouseholdScreen.test.tsx`",
    "BUDGET-HH-029": "`e2e/maestro/budget/budget-tabs.yaml`, `src/features/budget/screens/__tests__/BudgetHomeScreen.test.tsx`",
    "KAIZEN-SMOKE-002": "`scripts/e2e/run-kaizen-suite.sh`, `e2e/maestro/kaizen/today-screen.yaml`",
    "KAIZEN-SMOKE-011": "`e2e/maestro/kaizen/scroll-all-screens.yaml`, `src/features/kaizen/screens/__tests__/scrollableScreens.test.tsx`",
    "KAIZEN-SYNC-014": "`e2e/maestro/kaizen/deep-links-smoke.yaml`, `src/features/kaizen/services/__tests__/deepLinks.test.ts`",
    "LANG-MORE-014": "`e2e/maestro/language/more-reset-learning.yaml`, `src/features/language/screens/__tests__/LanguageMoreScreen.test.tsx`",
    "HEALTH-HOME-049": "`e2e/maestro/health/home-weight-keyboard-return.yaml`, `src/features/health/screens/__tests__/HealthHomeScreen.test.tsx`",
    "HEALTH-PRIV-008": "`e2e/maestro/health/privacy-local-mutations.yaml`, `src/features/health/__tests__/healthLocalStorage.test.ts`",
}


def patch_matrix(path: Path, row_id: str, automation: str) -> bool:
    text = path.read_text()
    pattern = rf"(\| {re.escape(row_id)} \|[^\n]+\| )([^\n|]+)( \| \*\*)"
    new_text, n = re.subn(pattern, rf"\1{automation}\3", text, count=1)
    if n:
        path.write_text(new_text)
        return True
    return False


def main() -> None:
    files = list(MATRICES.glob("*.md"))
    ok = miss = 0
    for row_id, automation in LINKS.items():
        prefix = row_id.split("-")[0]
        matrix_name = {
            "PLAT": "platform",
            "HOUSE": "house",
            "BUDGET": "budget",
            "KAIZEN": "kaizen",
            "LANG": "language",
            "HEALTH": "health",
        }.get(prefix)
        if not matrix_name:
            print(f"skip unknown prefix {row_id}")
            miss += 1
            continue
        path = MATRICES / f"{matrix_name}.md"
        if patch_matrix(path, row_id, automation):
            print(f"linked {row_id}")
            ok += 1
        else:
            print(f"MISS {row_id} in {path.name}")
            miss += 1
    print(f"done: linked={ok} miss={miss}")


if __name__ == "__main__":
    main()
