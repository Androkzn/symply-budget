#!/usr/bin/env python3
"""Re-link House matrix Maestro rows in target sections to section-specific flows.

Updates Automation for Maestro-layer rows whose IDs match TARGET_PREFIXES,
even when Automation is already set (fixes bulk-link mis-assignments).

Usage:
  python3 scripts/e2e/relink-house-maestro-sections.py --dry-run
  python3 scripts/e2e/relink-house-maestro-sections.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HOUSE = ROOT / "documents/engineering/testing/matrices/house.md"

TARGET_PREFIXES = (
    "HOUSE-HH-",
    "HOUSE-FP-",
    "HOUSE-GARD-",
    "HOUSE-AIHK-",
    "HOUSE-HPROJ-",
    "HOUSE-TPLAN-",
    "HOUSE-SPACE-",
    "HOUSE-SETT-",
    "HOUSE-PROF-",
)

# Explicit overrides (highest priority)
ID_FLOW: dict[str, str] = {
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
    "HOUSE-FP-018": "gap",
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
    "HOUSE-PROF-015": "gap",
    "HOUSE-PROF-018": "e2e/maestro/home/home-screen-controls.yaml",
    "HOUSE-HH-025": "src/stores/__tests__/appStore.test.ts",
    "HOUSE-HH-029": "gap",
    "HOUSE-HH-030": "src/stores/__tests__/inviteStore.test.ts",
}

# Prefix + numeric range → flow (checked after ID_FLOW)
RANGE_RULES: list[tuple[str, int, int, str]] = [
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
    ("HOUSE-FP-", 4, 5, "e2e/maestro/floor-plans/floor-plans-screen.yaml"),
    ("HOUSE-FP-", 6, 12, "e2e/maestro/floor-plans/floor-plans-deferred-readonly.yaml"),
    ("HOUSE-FP-", 13, 15, "e2e/maestro/floor-plans/floor-plans-screen.yaml"),
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
    ("HOUSE-HPROJ-", 15, 16, "e2e/maestro/home-projects/home-projects-hub-mutations.yaml"),
    ("HOUSE-HPROJ-", 19, 20, "e2e/maestro/home-projects/home-projects-hub-mutations.yaml"),
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


def row_num(row_id: str) -> int | None:
    m = re.search(r"-(\d+)$", row_id)
    return int(m.group(1)) if m else None


def pick_flow(row_id: str) -> str | None:
    if row_id in ID_FLOW:
        return ID_FLOW[row_id]
    n = row_num(row_id)
    if n is None:
        return None
    for prefix, lo, hi, flow in RANGE_RULES:
        if row_id.startswith(prefix) and lo <= n <= hi:
            if flow.startswith("e2e/") and not (ROOT / flow).exists():
                return None
            return flow
    return None


def merge_automation(old: str, maestro_flow: str) -> str:
    """Keep unit/API paths; replace maestro/gap slot with maestro_flow."""
    parts = [p.strip().strip("`") for p in old.split(",")]
    kept = [p for p in parts if p and not p.startswith("e2e/maestro/") and p not in ("gap", "")]
    if maestro_flow.startswith("e2e/"):
        kept.insert(0, maestro_flow)
    elif maestro_flow != "gap":
        kept.insert(0, maestro_flow)
    return ", ".join(f"`{p}`" for p in kept)


def main() -> None:
    dry_run = "--dry-run" in sys.argv
    lines = HOUSE.read_text().splitlines()
    out: list[str] = []
    changed = 0
    for line in lines:
        if not line.startswith("| HOUSE-"):
            out.append(line)
            continue
        cols = [c.strip() for c in line.split("|")]
        if len(cols) < 12:
            out.append(line)
            continue
        row_id, layer, automation = cols[1], cols[8], cols[9]
        if not any(row_id.startswith(p) for p in TARGET_PREFIXES):
            out.append(line)
            continue
        if "Maestro" not in layer:
            out.append(line)
            continue
        flow = pick_flow(row_id)
        if not flow:
            out.append(line)
            continue
        if flow.startswith("e2e/") and not (ROOT / flow).exists():
            out.append(line)
            continue
        new_auto = merge_automation(automation, flow)
        if automation == new_auto:
            out.append(line)
            continue
        cols[9] = new_auto
        out.append("| " + " | ".join(cols[1:-1]) + " |")
        changed += 1
    if changed and not dry_run:
        HOUSE.write_text("\n".join(out) + "\n")
    mode = "would relink" if dry_run else "relinked"
    print(f"{mode} {changed} Maestro row(s) in {HOUSE.name}")


if __name__ == "__main__":
    main()
