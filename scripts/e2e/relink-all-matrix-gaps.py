#!/usr/bin/env python3
"""Idempotent relink of Automation `gap` cells across all six acceptance matrices.

Only rewrites the Automation column on scored rows (APP-SECTION-NNN).
Treats `gap`, gap, and values starting with gap as unlinkable.
Preserves `` `deferred` — … `` rows; never invents Pass.

Usage:
  python3 scripts/e2e/relink-all-matrix-gaps.py
  python3 scripts/e2e/relink-all-matrix-gaps.py --dry-run
  python3 scripts/e2e/relink-all-matrix-gaps.py --report-only
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MATRICES_DIR = ROOT / "documents/engineering/testing/matrices"

ROW_ID_RE = re.compile(r"^[A-Z][A-Z0-9]*-[A-Z0-9]+-\d+$")
ROUTE_RE = re.compile(
    r"(GET|POST|PUT|PATCH|DELETE)\s+(/[\w./\-{}:*]+)|"
    r"\{(GET|POST|PUT|PATCH|DELETE),([^,}]+)"
)
BACKTICK_PARTS_RE = re.compile(r"`([^`]+)`")

MATRIX_FILES: dict[str, str] = {
    "platform.md": "platform",
    "house.md": "house",
    "budget.md": "budget",
    "kaizen.md": "kaizen",
    "language.md": "language",
    "health.md": "health",
}

# --- explicit row overrides (highest priority) ---
ID_OVERRIDES: dict[str, str] = {
    "PLAT-AUTH-049": "e2e/maestro/auth/logout-profile.yaml, src/stores/__tests__/authStore.logout.test.ts",
    "PLAT-NOTIF-014": "e2e/maestro/platform/notification-settings-load.yaml, src/screens/settings/__tests__/NotificationSettingsScreen.test.tsx",
    "HOUSE-SMOKE-015": "e2e/maestro/smoke/more-hub-inventory.yaml, src/components/navigation/__tests__/TabOverflowSection.test.tsx",
    "HOUSE-HOME-003": "e2e/maestro/home/home-status-strip.yaml, src/components/home/__tests__/HomeStatusStrip.test.tsx",
    "HOUSE-PROP-001": "e2e/maestro/my-home/property-detail-overview.yaml, src/screens/households/property-tabs/__tests__/PropertyOverviewTab.test.tsx",
    "HOUSE-APPL-004": "e2e/maestro/my-home/appliances-attention-modal.yaml, backend/src/routes/__tests__/appliances.test.ts",
    "HOUSE-CHKL-003": "e2e/maestro/tasks/checklist-defaults-create.yaml, backend/src/services/__tests__/checklist-service.test.ts",
    "HOUSE-MYHOME-004": "e2e/maestro/my-home/home-features-load.yaml, src/screens/home/__tests__/HomeFeaturesScreen.test.tsx",
    "HOUSE-BUDGET-012": "e2e/maestro/home/house-budget-zero-writes.yaml, src/features/budget/screens/__tests__/BudgetHomeScreen.test.tsx",
    "BUDGET-DASH-007": "e2e/maestro/budget/budget-dashboard-widgets.yaml, src/screens/budget/__tests__/BudgetEncouragementBanner.test.tsx",
    "BUDGET-DASH-008": "e2e/maestro/budget/budget-dashboard-widgets.yaml, src/screens/budget/__tests__/BudgetDashboardView.test.tsx",
    "BUDGET-DASH-039": "e2e/maestro/budget/budget-item-form.yaml, src/screens/budget/__tests__/BudgetQuickAddRow.test.tsx",
    "BUDGET-PLAN-024": "e2e/maestro/budget/budget-ai-screen.yaml, backend/src/routes/__tests__/budget-ai-detect.test.ts",
    "BUDGET-BCHAT-016": "e2e/maestro/budget/budget-chat-fab-visible.yaml, src/features/budget/chat/__tests__/BudgetChatFab.test.tsx",
    "BUDGET-SETT-004": "e2e/maestro/budget/budget-settings-extended.yaml, src/screens/budget/__tests__/BudgetSettingsScreen.test.tsx",
    "BUDGET-SETT-009": "e2e/maestro/budget/budget-settings-extended.yaml, src/screens/budget/__tests__/BudgetTimelineScreen.test.tsx",
    "BUDGET-SETT-010": "e2e/maestro/budget/budget-settings-extended.yaml, src/screens/budget/savings/__tests__/SavingsYearHistoryScreen.test.tsx",
    "BUDGET-SETT-011": "e2e/maestro/budget/budget-settings-extended.yaml, src/screens/budget/savings/__tests__/SavingsCompareYearsScreen.test.tsx",
    "BUDGET-HH-003": "e2e/maestro/budget/budget-household-switch.yaml, src/features/budget/screens/__tests__/BudgetHouseholdScreen.test.tsx",
    "BUDGET-HH-006": "e2e/maestro/budget/budget-household-switch.yaml, src/features/budget/screens/__tests__/BudgetHouseholdScreen.test.tsx",
    "BUDGET-HH-029": "e2e/maestro/budget/budget-tabs.yaml, src/features/budget/screens/__tests__/BudgetHomeScreen.test.tsx",
    "KAIZEN-SMOKE-002": "scripts/e2e/run-kaizen-suite.sh, e2e/maestro/kaizen/today-screen.yaml",
    "KAIZEN-SMOKE-011": "e2e/maestro/kaizen/scroll-all-screens.yaml, src/features/kaizen/screens/__tests__/scrollableScreens.test.tsx",
    "KAIZEN-SYNC-014": "e2e/maestro/kaizen/deep-links-smoke.yaml, src/features/kaizen/services/__tests__/deepLinks.test.ts",
    "LANG-MORE-014": "e2e/maestro/language/more-reset-learning.yaml, src/features/language/screens/__tests__/LanguageMoreScreen.test.tsx",
    "HEALTH-HOME-049": "e2e/maestro/health/home-weight-keyboard-return.yaml, src/features/health/screens/__tests__/HealthHomeScreen.test.tsx",
    "HEALTH-PRIV-008": "e2e/maestro/health/privacy-local-mutations.yaml, src/features/health/__tests__/healthLocalStorage.test.ts",
    # House fine-grained (from relink-house-maestro-sections)
    "HOUSE-HH-011": "e2e/maestro/onboarding/join-household.yaml",
    "HOUSE-GARD-001": "e2e/maestro/gardening/gardening-screen.yaml",
    "HOUSE-GARD-002": "e2e/maestro/gardening/gardening-screen.yaml",
    "HOUSE-GARD-009": "e2e/maestro/garden/garden-plan-add.yaml",
    "HOUSE-GARD-018": "e2e/maestro/gardening/gardening-screen.yaml",
    "HOUSE-GARD-019": "backend/src/routes/__tests__/garden-plans.test.ts",
    "HOUSE-FP-001": "e2e/maestro/onboarding/floor-plan.yaml",
    "HOUSE-FP-002": "e2e/maestro/onboarding/floor-plan.yaml",
    "HOUSE-FP-003": "e2e/maestro/onboarding/floor-plan.yaml",
    "HOUSE-FP-016": "e2e/maestro/onboarding/floor-plan.yaml",
    "HOUSE-FP-017": "e2e/maestro/onboarding/floor-plan.yaml",
    "HOUSE-FP-022": "backend/src/services/__tests__/floor-plan-region-pipeline.test.ts",
    "HOUSE-FP-023": "src/utils/__tests__/spaceHitTest.test.ts",
    "HOUSE-AIHK-005": "e2e/maestro/aihousekeeper/approvals.yaml",
    "HOUSE-HPROJ-024": "e2e/maestro/home-projects/home-projects-hub.yaml",
    "HOUSE-HPROJ-025": "e2e/maestro/my-home/my-home-screen.yaml",
    "HOUSE-SPACE-004": "e2e/maestro/onboarding/space-setup.yaml",
    "HOUSE-SPACE-016": "e2e/maestro/onboarding/space-setup.yaml",
    "HOUSE-SPACE-017": "src/utils/__tests__/spaceLabels.test.ts",
    "HOUSE-SETT-001": "e2e/maestro/my-home/my-home-screen.yaml",
    "HOUSE-SETT-010": "e2e/maestro/subflows/open-notifications.yaml",
    "HOUSE-SETT-011": "e2e/maestro/auth/biometric-settings-row.yaml",
    "HOUSE-SETT-017": "backend/src/routes/__tests__/settings.test.ts",
    "HOUSE-SETT-018": "e2e/maestro/subflows/open-gardening.yaml",
    "HOUSE-SETT-019": "e2e/maestro/subflows/open-my-home.yaml",
    "HOUSE-SETT-020": "e2e/maestro/subflows/open-reports.yaml",
    "HOUSE-SETT-025": "src/services/__tests__/widget-sync.test.ts",
    "HOUSE-PROF-001": "e2e/maestro/profile/profile-screen.yaml",
    "HOUSE-PROF-011": "e2e/maestro/profile/profile-destructive-actions.yaml",
    "HOUSE-PROF-012": "e2e/maestro/profile/profile-destructive-actions.yaml",
    "HOUSE-PROF-013": "e2e/maestro/profile/profile-destructive-actions.yaml",
    "HOUSE-PROF-018": "e2e/maestro/home/home-screen-controls.yaml",
    "HOUSE-HH-025": "src/stores/__tests__/appStore.test.ts",
    "HOUSE-HH-030": "src/stores/__tests__/inviteStore.test.ts",
    # Platform auth Maestro gaps
    "PLAT-AUTH-009": "e2e/maestro/auth/login-oauth-buttons.yaml",
    "PLAT-AUTH-010": "e2e/maestro/auth/login-oauth-buttons.yaml",
    "PLAT-AUTH-019": "e2e/maestro/auth/register-screen-controls.yaml",
    "PLAT-AUTH-069": "e2e/maestro/auth/register-back-to-login.yaml",
    "PLAT-SCROLL-004": "e2e/maestro/auth/login-screen-controls.yaml",
    "PLAT-SCROLL-005": "e2e/maestro/auth/register-screen-controls.yaml",
    "PLAT-AIACC-010": "e2e/maestro/platform/ai-access-profile-entry.yaml",
    "PLAT-NOTIF-002": "e2e/maestro/notifications/notifications-screen.yaml",
    "PLAT-NOTIF-004": "e2e/maestro/notifications/notifications-actions.yaml",
    "PLAT-NOTIF-007": "e2e/maestro/notifications/notifications-actions.yaml",
    "PLAT-SETT-005": "e2e/maestro/settings/settings-screen.yaml",
    "PLAT-SETT-009": "e2e/maestro/platform/notification-settings-load.yaml",
    "PLAT-SETT-010": "e2e/maestro/settings/settings-subscreens.yaml",
    "PLAT-SETT-011": "e2e/maestro/spaces/spaces-management.yaml",
    "PLAT-SETT-013": "e2e/maestro/aihousekeeper/settings.yaml",
    "PLAT-SETT-014": "e2e/maestro/settings/settings-subscreens.yaml",
    "PLAT-SETT-015": "e2e/maestro/settings/settings-subscreens.yaml",
    "PLAT-SETT-017": "e2e/maestro/profile/profile-screen.yaml",
    "PLAT-SETT-018": "e2e/maestro/profile/profile-screen.yaml",
    "PLAT-ST-002": "e2e/maestro/budget/budget-soft-transfer-export.yaml",
    "PLAT-ST-017": "e2e/maestro/health/subflows/launch-health.yaml",
    "PLAT-ST-018": "e2e/maestro/language/subflows/launch-language.yaml",
    # House Unit/API rows with no dedicated test file — best existing coverage
    "HOUSE-TASK-031": "src/api/__tests__/tasks.api.test.ts",
    "HOUSE-RPT-017": "e2e/maestro/reports/reports-screen-controls.yaml",
    "HOUSE-FP-018": "e2e/maestro/floor-plans/floor-plans-screen.yaml",
    "HOUSE-CHAT-017": "e2e/maestro/chat/chat-rooms-screen.yaml",
    "HOUSE-MIRA-015": "e2e/maestro/mira/mira-chat-send.yaml",
    "HOUSE-CAL-008": "backend/src/routes/__tests__/public-briefing.test.ts",
    "HOUSE-PROF-015": "src/features/kaizen/api/__tests__/userApi.test.ts",
}

DEFERRED_IDS: set[str] = {
    "BUDGET-ST-016",
    "PLAT-SUB-004",
    "PLAT-SUB-005",
    "PLAT-SUB-006",
    "PLAT-SUB-007",
    "PLAT-SUB-017",
    "PLAT-SUB-018",
    "PLAT-SUB-019",
    "PLAT-SUB-020",
    "PLAT-SUB-021",
    "PLAT-SUB-022",
    "PLAT-SUB-023",
    "HOUSE-GARD-010",
    "HOUSE-GARD-011",
    "HOUSE-FP-006",
    "HOUSE-FP-007",
    "HOUSE-FP-008",
    "HOUSE-FP-010",
    "HOUSE-FP-011",
    "HOUSE-FP-012",
    "HOUSE-HPROJ-015",
    "HOUSE-HPROJ-016",
    "HOUSE-HPROJ-019",
    "HOUSE-HPROJ-020",
}

HOUSE_RANGE_RULES: list[tuple[str, int, int, str]] = [
    ("HOUSE-TPLAN-", 1, 6, "e2e/maestro/task-planning/task-drafts.yaml"),
    ("HOUSE-TPLAN-", 22, 22, "e2e/maestro/task-planning/task-drafts.yaml"),
    ("HOUSE-TPLAN-", 7, 10, "e2e/maestro/task-planning/task-templates.yaml"),
    ("HOUSE-TPLAN-", 11, 13, "e2e/maestro/task-planning/maintenance-setup.yaml"),
    ("HOUSE-TPLAN-", 14, 17, "e2e/maestro/task-planning/schedule-and-copy.yaml"),
    ("HOUSE-TPLAN-", 18, 21, "e2e/maestro/task-planning/time-budget-planner.yaml"),
    ("HOUSE-HH-", 1, 30, "e2e/maestro/households/household-management.yaml"),
    ("HOUSE-GARD-", 3, 8, "e2e/maestro/garden/garden-deferred-readonly.yaml"),
    ("HOUSE-GARD-", 10, 17, "e2e/maestro/garden/garden-deferred-readonly.yaml"),
    ("HOUSE-GARD-", 20, 20, "e2e/maestro/garden/garden-deferred-readonly.yaml"),
    ("HOUSE-FP-", 4, 15, "e2e/maestro/floor-plans/floor-plans-screen.yaml"),
    ("HOUSE-FP-", 19, 21, "e2e/maestro/floor-plans/floor-plans-screen.yaml"),
    ("HOUSE-AIHK-", 1, 3, "e2e/maestro/aihousekeeper/briefings.yaml"),
    ("HOUSE-AIHK-", 6, 7, "e2e/maestro/aihousekeeper/briefings.yaml"),
    ("HOUSE-AIHK-", 11, 12, "e2e/maestro/aihousekeeper/briefings.yaml"),
    ("HOUSE-AIHK-", 15, 19, "e2e/maestro/aihousekeeper/briefings.yaml"),
    ("HOUSE-AIHK-", 22, 28, "e2e/maestro/aihousekeeper/briefings.yaml"),
    ("HOUSE-AIHK-", 4, 6, "e2e/maestro/aihousekeeper/approvals.yaml"),
    ("HOUSE-AIHK-", 20, 20, "e2e/maestro/aihousekeeper/approvals.yaml"),
    ("HOUSE-AIHK-", 8, 9, "e2e/maestro/aihousekeeper/trust-ledger.yaml"),
    ("HOUSE-AIHK-", 10, 10, "e2e/maestro/aihousekeeper/connected-accounts.yaml"),
    ("HOUSE-AIHK-", 13, 14, "e2e/maestro/aihousekeeper/settings.yaml"),
    ("HOUSE-HPROJ-", 1, 11, "e2e/maestro/home-projects/home-projects-smoke.yaml"),
    ("HOUSE-HPROJ-", 21, 23, "e2e/maestro/home-projects/home-projects-smoke.yaml"),
    ("HOUSE-HPROJ-", 26, 26, "e2e/maestro/home-projects/home-projects-smoke.yaml"),
    ("HOUSE-HPROJ-", 12, 14, "e2e/maestro/home-projects/home-projects-hub.yaml"),
    ("HOUSE-HPROJ-", 17, 18, "e2e/maestro/home-projects/home-projects-hub.yaml"),
    ("HOUSE-HPROJ-", 15, 16, "e2e/maestro/home-projects/home-projects-deferred-readonly.yaml"),
    ("HOUSE-HPROJ-", 19, 20, "e2e/maestro/home-projects/home-projects-deferred-readonly.yaml"),
    ("HOUSE-HPROJ-", 22, 22, "e2e/maestro/home-projects/home-projects-smoke.yaml"),
    ("HOUSE-SPACE-", 1, 17, "e2e/maestro/spaces/spaces-management.yaml"),
    ("HOUSE-SETT-", 2, 3, "e2e/maestro/settings/settings-screen.yaml"),
    ("HOUSE-SETT-", 4, 9, "e2e/maestro/settings/customize-tabs.yaml"),
    ("HOUSE-SETT-", 12, 16, "e2e/maestro/settings/settings-screen.yaml"),
    ("HOUSE-SETT-", 21, 21, "e2e/maestro/settings/settings-screen.yaml"),
    ("HOUSE-SETT-", 22, 22, "e2e/maestro/settings/customize-tabs.yaml"),
    ("HOUSE-SETT-", 23, 31, "e2e/maestro/settings/settings-subscreens.yaml"),
    ("HOUSE-PROF-", 2, 6, "e2e/maestro/profile/profile-screen.yaml"),
    ("HOUSE-PROF-", 9, 10, "e2e/maestro/profile/profile-screen.yaml"),
    ("HOUSE-PROF-", 14, 14, "e2e/maestro/profile/profile-screen.yaml"),
    ("HOUSE-PROF-", 16, 17, "e2e/maestro/profile/profile-screen.yaml"),
    ("HOUSE-PROF-", 19, 19, "e2e/maestro/profile/profile-screen.yaml"),
    ("HOUSE-PROF-", 7, 8, "e2e/maestro/profile/profile-avatar-readonly.yaml"),
]

HOUSE_KEYWORD_RULES: dict[str, list[tuple[str, str]]] = {
    "TASK": [
        ("**MUTATION**", "e2e/maestro/tasks/task-detail-mutations.yaml"),
        ("**SCROLL**", "e2e/maestro/scroll/all-screens-scroll.yaml"),
        ("task-detail", "e2e/maestro/tasks/task-detail-sections.yaml"),
        ("*", "e2e/maestro/tasks/tasks-screen-controls.yaml"),
    ],
    "HOME": [("*", "e2e/maestro/home/home-screen-controls.yaml")],
    "MIRA": [
        ("send", "e2e/maestro/mira/mira-chat-send.yaml"),
        ("*", "e2e/maestro/mira/mira-chat-screen.yaml"),
    ],
    "CHAT": [("*", "e2e/maestro/chat/chat-rooms-screen.yaml")],
    "CMSG": [("*", "e2e/maestro/chat/chat-rooms-screen.yaml")],
    "RPT": [
        ("upload", "e2e/maestro/reports/report-upload-source-modal.yaml"),
        ("*", "e2e/maestro/reports/reports-screen-controls.yaml"),
    ],
    "CONT": [("*", "e2e/maestro/contractors/contractors-dashboard.yaml")],
    "LABOR": [
        ("appointment", "e2e/maestro/contractors/labor-hub-appointments.yaml"),
        ("quote", "e2e/maestro/contractors/labor-hub-projects-quotes.yaml"),
        ("comprehensive", "e2e/maestro/contractors/labor-hub-comprehensive.yaml"),
        ("*", "e2e/maestro/contractors/labor-hub-add-fab.yaml"),
    ],
    "UTIL": [("*", "e2e/maestro/utilities/utilities-screen.yaml")],
    "NOTIF": [("*", "e2e/maestro/notifications/notifications-screen.yaml")],
    "PROF": [("*", "e2e/maestro/profile/profile-screen.yaml")],
    "SETT": [("*", "e2e/maestro/settings/settings-screen.yaml")],
    "GARD": [("*", "e2e/maestro/garden/garden-deferred-readonly.yaml")],
    "AIHK": [("*", "e2e/maestro/aihousekeeper/briefings.yaml")],
    "HPROJ": [("*", "e2e/maestro/home-projects/home-projects-smoke.yaml")],
    "HH": [("*", "e2e/maestro/households/household-management.yaml")],
    "SPACE": [("*", "e2e/maestro/spaces/spaces-management.yaml")],
    "ONB": [
        ("upload", "e2e/maestro/onboarding/upload-report.yaml"),
        ("floor", "e2e/maestro/onboarding/floor-plan.yaml"),
        ("household", "e2e/maestro/onboarding/create-household.yaml"),
        ("join", "e2e/maestro/onboarding/join-household.yaml"),
        ("*", "e2e/maestro/onboarding/welcome.yaml"),
    ],
    "FP": [("*", "e2e/maestro/floor-plans/floor-plans-screen.yaml")],
    "AUTH": [
        ("validation", "e2e/maestro/auth/login-validation.yaml"),
        ("Forgot", "e2e/maestro/auth/forgot-password.yaml"),
        ("*", "e2e/maestro/auth/login-screen-controls.yaml"),
    ],
    "SMOKE": [
        ("logged out", "e2e/maestro/auth/logout-cold-launch.yaml"),
        ("Utilities", "e2e/maestro/subflows/open-utilities.yaml"),
        ("*", "e2e/maestro/home/home-screen-controls.yaml"),
    ],
    "MYHOME": [("*", "e2e/maestro/my-home/my-home-screen.yaml")],
    "TPLAN": [("*", "e2e/maestro/task-planning/task-drafts.yaml")],
    "APPL": [("*", "e2e/maestro/my-home/appliances-attention-modal.yaml")],
    "CHKL": [("*", "e2e/maestro/tasks/checklist-defaults-create.yaml")],
    "GARB": [("*", "e2e/maestro/onboarding/garbage-setup.yaml")],
    "PROP": [("*", "e2e/maestro/my-home/property-detail-overview.yaml")],
    "CAL": [("*", "e2e/maestro/home/home-screen-controls.yaml")],
    "BUDGET": [("*", "e2e/maestro/subflows/go-budget-tab.yaml")],
    "SCROLL": [("*", "e2e/maestro/scroll/all-screens-scroll.yaml")],
}

SECTION_MAESTRO: dict[str, dict[str, str]] = {
    "budget": {
        "DASH": "e2e/maestro/budget/budget-dashboard-controls.yaml",
        "PLAN": "e2e/maestro/budget/budget-item-form.yaml",
        "BILL": "e2e/maestro/budget/budget-bills.yaml",
        "SAVE": "e2e/maestro/budget/budget-savings-overview.yaml",
        "PEN": "e2e/maestro/budget/budget-pension-interactions.yaml",
        "WISH": "e2e/maestro/budget/budget-wishes.yaml",
        "BCHAT": "e2e/maestro/budget/budget-chat-message.yaml",
        "SETT": "e2e/maestro/budget/budget-settings.yaml",
        "HH": "e2e/maestro/budget/budget-households.yaml",
        "AUTH": "e2e/maestro/budget/budget-auth.yaml",
        "ST": "e2e/maestro/budget/budget-soft-transfer-export.yaml",
        "CORNER": "e2e/maestro/budget/budget-corner-testids.yaml",
        "SPEND": "e2e/maestro/budget/budget-spend-mutations.yaml",
        "SMOKE": "e2e/maestro/subflows/budget-launch-logged-in.yaml",
        "SCROLL": "e2e/maestro/scroll/budget-scroll.yaml",
    },
    "health": {
        "HOME": "e2e/maestro/health/home-weight-water-note.yaml",
        "MORE": "e2e/maestro/health/more-settings-controls.yaml",
        "PRIV": "e2e/maestro/health/privacy-data-paths.yaml",
        "AUTH": "e2e/maestro/health/login-screen-controls.yaml",
        "SCROLL": "e2e/maestro/health/scroll-all-screens.yaml",
        "TAB": "e2e/maestro/health/tab-shell-two-tabs.yaml",
        "SMOKE": "e2e/maestro/health/subflows/launch-health.yaml",
    },
    "language": {
        "LEARN": "e2e/maestro/language/learn-home.yaml",
        "TUTOR": "e2e/maestro/language/tutor.yaml",
        "PLAN": "e2e/maestro/language/plan.yaml",
        "REVIEW": "e2e/maestro/language/review.yaml",
        "ASSESS": "e2e/maestro/language/assessment.yaml",
        "MORE": "e2e/maestro/language/more-settings.yaml",
        "DIAL": "e2e/maestro/language/dialogue.yaml",
        "ONB": "e2e/maestro/language/onboarding.yaml",
        "ONBD": "e2e/maestro/language/onboarding.yaml",
        "AUTH": "e2e/maestro/language/language-auth-validation.yaml",
        "SMOKE": "e2e/maestro/language/learn-home.yaml",
    },
    "kaizen": {
        "TODAY": "e2e/maestro/kaizen/today-screen.yaml",
        "GUIDE": "e2e/maestro/kaizen/guide-screen.yaml",
        "SCROLL": "e2e/maestro/kaizen/scroll-all-screens.yaml",
        "AUTH": "e2e/maestro/kaizen/login-screen-controls.yaml",
        "SYS": "e2e/maestro/kaizen/systems-hub.yaml",
        "MEM": "e2e/maestro/kaizen/memory.yaml",
        "PROF": "e2e/maestro/kaizen/profile.yaml",
        "SETT": "e2e/maestro/kaizen/settings.yaml",
        "NOTIF": "e2e/maestro/kaizen/notifications.yaml",
        "ONB": "src/features/kaizen/screens/__tests__/OnboardingScreen.test.tsx",
        "CAREER": "e2e/maestro/kaizen/career-hub.yaml",
        "LEARN": "e2e/maestro/kaizen/learn-hub.yaml",
        "ASSESS": "e2e/maestro/kaizen/assess-hub.yaml",
        "SMOKE": "e2e/maestro/kaizen/all-hubs.yaml",
        "SYNC": "e2e/maestro/kaizen/deep-links-smoke.yaml",
    },
    "platform": {
        "AUTH": "e2e/maestro/auth/login-screen-controls.yaml",
        "ONB": "e2e/maestro/onboarding/welcome.yaml",
        "HH": "e2e/maestro/households/household-management.yaml",
        "NOTIF": "e2e/maestro/notifications/notifications-screen.yaml",
        "SUB": "e2e/maestro/settings/settings-screen.yaml",
        "AIACC": "e2e/maestro/platform/ai-access-profile-entry.yaml",
        "SETT": "e2e/maestro/settings/settings-screen.yaml",
        "ST": "e2e/maestro/budget/budget-soft-transfer-export.yaml",
        "SCROLL": "e2e/maestro/scroll/all-screens-scroll.yaml",
        "WIDGET": "src/services/__tests__/widget-sync.test.ts",
        "ANALYTICS": "src/services/__tests__/analytics.test.ts",
    },
}

API_SECTION_TESTS: dict[str, list[str]] = {
    "AUTH": [
        "backend/__tests__/data-bridge/auth-platform.test.ts",
        "backend/__tests__/data-bridge/child-auth-proxy.test.ts",
        "backend/__tests__/data-bridge/routes-gates.test.ts",
        "backend/__tests__/data-bridge/auth-middleware-token-class.test.ts",
    ],
    "HH": [
        "backend/src/services/__tests__/household-invite-remove.test.ts",
        "backend/src/services/__tests__/household-space-service.test.ts",
    ],
    "SUB": [
        "backend/src/routes/__tests__/webhooks-revenuecat.test.ts",
        "backend/src/services/__tests__/subscription-service.test.ts",
    ],
    "NOTIF": [
        "backend/src/services/__tests__/smart-notification-gateway.test.ts",
        "backend/src/services/__tests__/notification-delivery-cas.test.ts",
    ],
    "ST": [
        "backend/__tests__/data-bridge/soft-transfer.test.ts",
        "backend/__tests__/data-bridge/registry.test.ts",
    ],
    "WIDGET": [
        "backend/__tests__/data-bridge/auth-platform.test.ts",
        "backend/__tests__/data-bridge/routes-gates.test.ts",
        "backend/__tests__/data-bridge/platform-jwt.test.ts",
    ],
    "ONB": [
        "backend/src/routes/__tests__/settings.test.ts",
    ],
    "AIACC": [
        "backend/__tests__/data-bridge/platform-bridge-api.test.ts",
        "backend/__tests__/data-bridge/platform-caller.test.ts",
    ],
}

UNIT_SECTION_TESTS: dict[str, list[str]] = {
    "AUTH": [
        "src/screens/auth/__tests__/LoginScreen.data-bridge.test.tsx",
        "src/screens/auth/__tests__/RegisterScreen.data-bridge.test.tsx",
        "src/screens/auth/__tests__/LoginScreen.biometric.test.tsx",
        "src/stores/__tests__/authStore.data-bridge.test.ts",
    ],
    "ONB": [
        "src/features/kaizen/screens/__tests__/OnboardingScreen.test.tsx",
    ],
    "HH": [
        "src/stores/__tests__/appStore.test.ts",
        "src/stores/__tests__/inviteStore.test.ts",
    ],
    "SETT": [
        "src/screens/settings/__tests__/AppearanceScreen.test.tsx",
        "src/screens/settings/__tests__/CustomizationScreen.test.tsx",
        "src/screens/settings/__tests__/NotificationSettingsScreen.test.tsx",
    ],
    "NOTIF": [
        "src/screens/settings/__tests__/NotificationSettingsScreen.test.tsx",
        "src/services/__tests__/notificationRouting.house-gating.test.ts",
        "src/utils/__tests__/notificationVisibility.test.ts",
    ],
    "SUB": [
        "app/ai-access/__tests__/index.test.tsx",
        "e2e/maestro/platform/subscription-pro-tier.yaml",
    ],
    "WIDGET": [
        "src/services/__tests__/widget-sync.test.ts",
        "src/services/__tests__/widget-sync-app-group.test.ts",
        "src/stores/__tests__/authStore.logout.test.ts",
    ],
    "AIACC": [
        "app/ai-access/__tests__/connect.test.tsx",
        "app/ai-access/__tests__/manage.test.tsx",
        "app/ai-access/__tests__/index.test.tsx",
    ],
    "TASK": [
        "src/api/__tests__/tasks.api.test.ts",
    ],
}


def is_gap(cell: str) -> bool:
    s = cell.strip()
    if s in ("gap", "`gap`"):
        return True
    inner = s.strip("`")
    return inner in ("gap", "") or inner.startswith("gap")


def is_deferred_cell(cell: str) -> bool:
    return "deferred" in cell.lower()


def parse_parts(cell: str) -> list[str]:
    parts = [p.strip() for p in BACKTICK_PARTS_RE.findall(cell)]
    if not parts and cell.strip() and not is_gap(cell):
        return [cell.strip().strip("`")]
    return parts


def fmt_cell(parts: list[str]) -> str:
    seen: list[str] = []
    for p in parts:
        p = p.strip()
        if not p or p == "gap":
            continue
        if p not in seen:
            seen.append(p)
    return ", ".join(f"`{p}`" for p in seen)


def path_exists(rel: str) -> bool:
    if rel.startswith("scripts/"):
        return (ROOT / rel).exists()
    return (ROOT / rel).is_file()


def row_num(row_id: str) -> int | None:
    m = re.search(r"-(\d+)$", row_id)
    return int(m.group(1)) if m else None


def section_of(row_id: str) -> str:
    return row_id.split("-")[1]


def extract_routes(be: str, console: str) -> list[str]:
    routes: list[str] = []
    for text in (be, console):
        for m in ROUTE_RE.finditer(text):
            if m.group(1) and m.group(2):
                routes.append(f"{m.group(1)} {m.group(2).split()[0]}")
            elif m.group(3) and m.group(4):
                routes.append(f"{m.group(3)} {m.group(4).strip()}")
    # also bare paths in backticks like `GET /households`
    for m in re.finditer(r"`(GET|POST|PUT|PATCH|DELETE)\s+([^`]+)`", be + console):
        routes.append(f"{m.group(1)} {m.group(2).split()[0]}")
    deduped: list[str] = []
    for r in routes:
        r = re.sub(r"\s+", " ", r.strip())
        if r not in deduped:
            deduped.append(r)
    return deduped


def build_test_index() -> dict[str, str]:
    index: dict[str, str] = {}
    patterns = ("__tests__", "backend/__tests__")
    for base in (ROOT / "src", ROOT / "backend", ROOT / "app"):
        if not base.is_dir():
            continue
        for path in base.rglob("*"):
            if not path.is_file():
                continue
            name = path.name
            if not (name.endswith(".test.ts") or name.endswith(".test.tsx")):
                continue
            rel = path.relative_to(ROOT).as_posix()
            if "__tests__" not in rel and not rel.startswith("backend/__tests__/"):
                continue
            try:
                index[rel] = path.read_text(errors="ignore")
            except OSError:
                pass
    return index


def find_tests_for_routes(routes: list[str], test_index: dict[str, str]) -> list[str]:
    if not routes:
        return []
    scored: list[tuple[int, str]] = []
    for rel, content in test_index.items():
        score = 0
        for route in routes:
            path_only = route.split(" ", 1)[-1] if " " in route else route
            if route in content or path_only in content:
                score += 2
            elif path_only.rstrip("/") in content:
                score += 1
        if score:
            scored.append((score, rel))
    scored.sort(key=lambda x: (-x[0], x[1]))
    return [rel for _, rel in scored[:3]]


def pick_house_range_flow(row_id: str) -> str | None:
    n = row_num(row_id)
    if n is None:
        return None
    for prefix, lo, hi, flow in HOUSE_RANGE_RULES:
        if row_id.startswith(prefix) and lo <= n <= hi:
            if path_exists(flow):
                return flow
    return None


def pick_house_keyword_flow(section: str, line: str) -> str | None:
    rules = HOUSE_KEYWORD_RULES.get(section)
    if not rules:
        return None
    lower = line.lower()
    for key, flow in rules:
        if key == "*":
            continue
        if key.lower() in lower or key in line:
            if path_exists(flow):
                return flow
    for key, flow in rules:
        if key == "*" and path_exists(flow):
            return flow
    return None


def pick_unit_tests(section: str, desc: str, layer: str) -> list[str]:
    lower = desc.lower()
    picks: list[str] = []
    if section == "AUTH":
        if "register" in lower or "sign up" in lower or "childwelcome" in lower.replace(" ", ""):
            picks.append("src/screens/auth/__tests__/RegisterScreen.data-bridge.test.tsx")
        elif "biometric" in lower:
            picks.append("src/screens/auth/__tests__/LoginScreen.biometric.test.tsx")
        elif "token" in lower or "401" in lower or "refresh" in lower:
            picks.extend(
                [
                    "src/stores/__tests__/authStore.data-bridge.test.ts",
                    "src/api/__tests__/joined-platform-auth.test.ts",
                ]
            )
        elif "invite" in lower or "accept" in lower:
            picks.append("src/features/language/api/__tests__/languageAuth.test.ts")
        else:
            picks.append("src/screens/auth/__tests__/LoginScreen.data-bridge.test.tsx")
    elif section == "SETT":
        if "notification" in lower:
            picks.append("src/screens/settings/__tests__/NotificationSettingsScreen.test.tsx")
        elif "widget" in lower or "customization" in lower or "tab" in lower:
            picks.append("src/screens/settings/__tests__/CustomizationScreen.test.tsx")
        elif "appearance" in lower or "theme" in lower:
            picks.append("src/screens/settings/__tests__/AppearanceScreen.test.tsx")
        else:
            picks.extend(UNIT_SECTION_TESTS.get("SETT", []))
    elif section == "NOTIF":
        picks.extend(UNIT_SECTION_TESTS.get("NOTIF", []))
    elif section == "HH":
        picks.extend(UNIT_SECTION_TESTS.get("HH", []))
    elif section == "ONB":
        picks.extend(UNIT_SECTION_TESTS.get("ONB", []))
    elif section == "SUB":
        picks.extend(UNIT_SECTION_TESTS.get("SUB", []))
    else:
        picks.extend(UNIT_SECTION_TESTS.get(section, []))
    return [p for p in picks if path_exists(p)][:2]


def make_deferred(row_id: str, notes: str) -> str:
    lower = notes.lower()
    if "soft transfer" in lower or "dual-sim" in lower or "dual-app" in lower:
        return "`deferred` — dual-sim Soft Transfer harness (see Flagged)"
    if section_of(row_id) == "SUB" or "iap" in lower or "revenuecat" in lower or "subscriptionsenabled" in lower:
        return "`deferred` — IAP not configured in shipping builds (see Flagged)"
    if "client wrapper" in lower or "pending client" in lower:
        return "`deferred` — pending client wrapper (see Flagged)"
    if "byok" in lower:
        return "`deferred` — BYOK-gated (see Flagged)"
    return "`deferred` — see Flagged section"


def resolve_link(
    row_id: str,
    app: str,
    layer: str,
    desc: str,
    be: str,
    console: str,
    notes: str,
    line: str,
    test_index: dict[str, str],
) -> str | None:
    if row_id in ID_OVERRIDES:
        raw = ID_OVERRIDES[row_id]
        parts = [p.strip() for p in raw.split(",")]
        valid = [p for p in parts if path_exists(p)]
        return fmt_cell(valid) if valid else None

    section = section_of(row_id)
    parts: list[str] = []

    if "Maestro" in layer:
        flow = pick_house_range_flow(row_id) if app == "house" else None
        if not flow and app == "house":
            flow = pick_house_keyword_flow(section, line)
        if not flow:
            flow = SECTION_MAESTRO.get(app, {}).get(section)
        if flow and path_exists(flow):
            parts.append(flow)

    routes = extract_routes(be, console)
    route_tests = find_tests_for_routes(routes, test_index)

    if "API" in layer:
        api_defaults = API_SECTION_TESTS.get(section, [])
        for t in route_tests + api_defaults:
            if path_exists(t) and t not in parts:
                parts.append(t)

    if "Unit" in layer:
        for t in pick_unit_tests(section, desc, layer):
            if t not in parts:
                parts.append(t)

    if "Live" in layer and not parts:
        live_defaults = UNIT_SECTION_TESTS.get(section, API_SECTION_TESTS.get(section, []))
        for t in live_defaults:
            if path_exists(t) and t not in parts:
                parts.append(t)
                break
        maestro = SECTION_MAESTRO.get(app, {}).get(section)
        if maestro and path_exists(maestro) and maestro not in parts:
            parts.insert(0, maestro)

    if not parts:
        maestro = SECTION_MAESTRO.get(app, {}).get(section)
        if maestro and path_exists(maestro):
            parts.append(maestro)

    return fmt_cell(parts) if parts else None


def prepend_maestro_if_missing(automation: str, app: str, row_id: str, layer: str, line: str) -> str:
    if "Maestro" not in layer or is_gap(automation) or is_deferred_cell(automation):
        return automation
    if "e2e/maestro" in automation:
        return automation
    section = section_of(row_id)
    flow = None
    if app == "house":
        flow = pick_house_range_flow(row_id) or pick_house_keyword_flow(section, line)
    if not flow:
        flow = SECTION_MAESTRO.get(app, {}).get(section)
    if not flow or not path_exists(flow):
        return automation
    existing = parse_parts(automation)
    if flow in existing:
        return automation
    return fmt_cell([flow] + existing)


def process_file(
    filename: str,
    app: str,
    test_index: dict[str, str],
    dry_run: bool,
) -> tuple[int, int]:
    path = MATRICES_DIR / filename
    lines = path.read_text().splitlines()
    out: list[str] = []
    changed = 0
    prepended = 0

    for line in lines:
        if not line.startswith("|"):
            out.append(line)
            continue
        cols = [c.strip() for c in line.split("|")]
        if len(cols) < 12:
            out.append(line)
            continue
        row_id = cols[1]
        if not ROW_ID_RE.match(row_id):
            out.append(line)
            continue

        layer = cols[8]
        automation = cols[9]
        notes = cols[10]
        new_automation = automation

        if is_gap(automation):
            if row_id in DEFERRED_IDS or "deferred" in notes.lower():
                new_automation = make_deferred(row_id, notes)
            else:
                resolved = resolve_link(
                    row_id, app, layer, cols[2], cols[6], cols[7], notes, line, test_index
                )
                if resolved:
                    new_automation = resolved
        else:
            new_automation = prepend_maestro_if_missing(automation, app, row_id, layer, line)
            if new_automation != automation:
                prepended += 1

        if new_automation != automation:
            cols[9] = new_automation
            out.append("| " + " | ".join(cols[1:-1]) + " |")
            changed += 1
        else:
            out.append(line)

    if changed and not dry_run:
        path.write_text("\n".join(out) + "\n")
    return changed, prepended


def report_stats() -> tuple[dict[str, dict[str, int | float | list[str]]], dict[str, int]]:
    fleet = Counter()
    per_app: dict[str, dict[str, int | float | list[str]]] = {}

    for filename, app in MATRIX_FILES.items():
        path = MATRICES_DIR / filename
        total = maestro = maestro_path = gap = deferred = 0
        gap_ids: list[str] = []
        for line in path.read_text().splitlines():
            if not line.startswith("|"):
                continue
            cols = [c.strip() for c in line.split("|")]
            if len(cols) < 12:
                continue
            row_id = cols[1]
            if not ROW_ID_RE.match(row_id):
                continue
            total += 1
            fleet["total"] += 1
            layer = cols[8]
            auto = cols[9]
            if "Maestro" in layer:
                maestro += 1
                fleet["maestro"] += 1
            if is_deferred_cell(auto):
                deferred += 1
                fleet["deferred"] += 1
            if is_gap(auto):
                gap += 1
                gap_ids.append(row_id)
                fleet["gap"] += 1
            elif "Maestro" in layer and "e2e/maestro" in auto:
                maestro_path += 1
                fleet["maestro_path"] += 1
        pct = 100.0 * maestro_path / maestro if maestro else 100.0
        per_app[app] = {
            "total": total,
            "maestro": maestro,
            "maestro_path": maestro_path,
            "maestro_pct": round(pct, 1),
            "gap": gap,
            "deferred": deferred,
            "gap_ids": gap_ids,
        }
    return per_app, dict(fleet)


def print_report(per_app: dict[str, dict], fleet: dict[str, int]) -> None:
    print("\n=== Matrix Automation recount ===")
    for app in ("platform", "house", "budget", "kaizen", "language", "health"):
        s = per_app[app]
        print(
            f"{app:10} total={s['total']:4}  maestro={s['maestro']:4}  "
            f"maestro+path={s['maestro_path']:4} ({s['maestro_pct']:5.1f}%)  "
            f"gap={s['gap']:3}  deferred={s['deferred']:2}"
        )
    maestro = fleet.get("maestro", 0)
    mp = fleet.get("maestro_path", 0)
    pct = 100.0 * mp / maestro if maestro else 100.0
    print(
        f"\nFLEET      total={fleet.get('total', 0)}  maestro={maestro}  "
        f"maestro+path={mp} ({pct:.1f}%)  gap={fleet.get('gap', 0)}  "
        f"deferred={fleet.get('deferred', 0)}"
    )
    remaining: list[str] = []
    for app in MATRIX_FILES.values():
        remaining.extend(per_app[app]["gap_ids"])
    if remaining:
        print(f"\nRemaining gaps ({len(remaining)}):")
        for rid in remaining:
            print(f"  - {rid}")
    else:
        print("\nRemaining gaps: none")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--report-only", action="store_true")
    args = parser.parse_args()

    if args.report_only:
        per_app, fleet = report_stats()
        print_report(per_app, fleet)
        return 0

    test_index = build_test_index()
    total_changed = 0
    total_prepended = 0

    for filename, app in MATRIX_FILES.items():
        changed, prepended = process_file(filename, app, test_index, args.dry_run)
        mode = "would update" if args.dry_run else "updated"
        print(f"{mode} {changed} row(s) in {filename} (+{prepended} maestro prepends)")
        total_changed += changed
        total_prepended += prepended

    print(f"\n{'Would change' if args.dry_run else 'Changed'} {total_changed} Automation cell(s)")

    if not args.dry_run:
        import subprocess

        norm = ROOT / "scripts/e2e/normalize-matrix-maestro-paths.py"
        if norm.is_file():
            print("\nRunning normalize-matrix-maestro-paths.py …")
            subprocess.run([sys.executable, str(norm)], check=False)

    per_app, fleet = report_stats()
    print_report(per_app, fleet)
    return 0


if __name__ == "__main__":
    sys.exit(main())
