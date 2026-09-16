#!/usr/bin/env python3
"""Fix remaining matrix automation/layer gaps."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MATRICES = ROOT / "documents/engineering/testing/matrices"

PATCHES: dict[str, dict[str, str]] = {
    "house.md": {
        "HOUSE-FP-006": "`e2e/maestro/floor-plans/floor-plans-deferred-readonly.yaml`",
    },
    "health.md": {
        # Layer column was wrongly set to `gap`; automation already has yaml.
        "HEALTH-PRIV-009": ("Maestro", "`e2e/maestro/health/privacy-data-paths.yaml`"),
        "HEALTH-AUTH-007": ("Maestro", "`e2e/maestro/health/login-screen-controls.yaml`"),
        "HEALTH-AUTH-009": ("Maestro", "`e2e/maestro/health/login-screen-controls.yaml`"),
    },
    "budget.md": {
        "BUDGET-SPEND-040": "`src/screens/budget/__tests__/BudgetSpendingsView.test.tsx`",
        "BUDGET-BILL-039": "`e2e/maestro/budget/budget-bills.yaml`, `backend/src/routes/__tests__/utilities.test.ts`",
        "BUDGET-BCHAT-032": "`src/features/budget/chat/screens/__tests__/BudgetChatRoomScreen.test.tsx`",
        "BUDGET-HH-027": "`e2e/maestro/budget/budget-household-extended.yaml`",
    },
}


def patch_automation(path: Path, row_id: str, automation: str) -> bool:
    text = path.read_text()
    pattern = rf"(\| {re.escape(row_id)} \|[^\n]+\| )([^\n|]+)( \| \*\*)"
    new_text, n = re.subn(pattern, rf"\1{automation}\3", text, count=1)
    if n:
        path.write_text(new_text)
        return True
    return False


def patch_layer_and_automation(path: Path, row_id: str, layer: str, automation: str) -> bool:
    text = path.read_text()
    # Replace Layer=gap with proper layer while keeping automation column
    pattern = rf"(\| {re.escape(row_id)} \|[^\n]+\| [^\n|]+\| [^\n|]+\| [^\n|]+\| [^\n|]+\| )gap( \| )(`[^`]+`)( \|)"
    new_text, n = re.subn(pattern, rf"\1{layer}\2{automation}\3", text, count=1)
    if n:
        path.write_text(new_text)
        return True
    return False


def main() -> None:
    for fname, rows in PATCHES.items():
        path = MATRICES / fname
        for row_id, value in rows.items():
            if isinstance(value, tuple):
                ok = patch_layer_and_automation(path, row_id, value[0], value[1])
            else:
                ok = patch_automation(path, row_id, value)
            print(f"{'ok' if ok else 'MISS'} {row_id} in {fname}")


if __name__ == "__main__":
    main()
