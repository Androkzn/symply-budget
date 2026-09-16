#!/usr/bin/env python3
"""Insert e2e-matrix-before/after blocks into mutation Maestro flows missing them."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MAESTRO = ROOT / "e2e/maestro"

# relative path from e2e/maestro -> (matrix_row, scheme, optional after verify)
MUTATION_FLOWS: dict[str, tuple[str, str, dict[str, str] | None]] = {
    "budget/budget-spend-mutations.yaml": (
        "BUDGET-SPEND-006",
        "simplebudget",
        {"E2E_VERIFY_METHOD": "POST", "E2E_VERIFY_PATH": "/budget/spent", "E2E_VERIFY_STATUS": "201"},
    ),
    "budget/budget-item-form.yaml": ("BUDGET-PLAN-001", "simplebudget", None),
    "budget/budget-spent-form.yaml": ("BUDGET-SPEND-001", "simplebudget", None),
    "budget/budget-plan-delete.yaml": ("BUDGET-PLAN-010", "simplebudget", None),
    "budget/budget-transfer.yaml": ("BUDGET-PLAN-015", "simplebudget", None),
    "budget/budget-savings-goal.yaml": ("BUDGET-SAV-001", "simplebudget", None),
    "budget/budget-chat-message.yaml": ("BUDGET-BCHAT-001", "simplebudget", None),
    "budget/budget-wishes.yaml": ("BUDGET-WISH-001", "simplebudget", None),
    "budget/budget-categories.yaml": ("BUDGET-CAT-001", "simplebudget", None),
    "budget/budget-auth.yaml": ("BUDGET-AUTH-001", "simplebudget", None),
    "auth/logout-relaunch.yaml": ("HOUSE-SMOKE-016", "simplehouse", None),
    "tasks/add-task-manual-form.yaml": ("HOUSE-TASK-011", "simplehouse", {"E2E_VERIFY_METHOD": "POST", "E2E_VERIFY_PATH": "/tasks", "E2E_VERIFY_STATUS": "201"}),
    "tasks/task-detail-mutations.yaml": ("HOUSE-TASK-017", "simplehouse", None),
    "contractors/contractors-mutations.yaml": ("HOUSE-CONT-001", "simplehouse", None),
    "utilities/utilities-mutations.yaml": ("HOUSE-UTIL-010", "simplehouse", None),
    "onboarding/create-household.yaml": ("HOUSE-ONBD-003", "simplehouse", {"E2E_VERIFY_METHOD": "POST", "E2E_VERIFY_PATH": "/households", "E2E_VERIFY_STATUS": "201"}),
    "health/home-weight-water-note.yaml": ("HEALTH-HOME-001", "simplehealth", None),
    "budget/budget-household-extended.yaml": ("BUDGET-HH-010", "simplebudget", None),
    "budget/budget-wishes-extended.yaml": ("BUDGET-WISH-010", "simplebudget", None),
    "budget/budget-chat-extended.yaml": ("BUDGET-BCHAT-010", "simplebudget", None),
}

BEFORE = """- runFlow:
    file: ../subflows/e2e-matrix-before.yaml
    env:
      E2E_APP_SCHEME: {scheme}
      E2E_MATRIX_ROW: {row}
"""

AFTER = """- runFlow:
    file: ../subflows/e2e-matrix-after.yaml
    env:
      E2E_APP_SCHEME: {scheme}
{verify}
"""


def after_block(scheme: str, verify: dict[str, str] | None) -> str:
    if not verify:
        return AFTER.format(scheme=scheme, verify="")
    lines = "\n".join(f"      {k}: {v}" for k, v in verify.items())
    return AFTER.format(scheme=scheme, verify=lines)


def wire(path: Path, row: str, scheme: str, verify: dict[str, str] | None) -> bool:
    text = path.read_text()
    if "e2e-matrix-before" in text:
        return False
    lines = text.splitlines()
    insert_at = None
    for i, line in enumerate(lines):
        if line.startswith("- runFlow:") and "launch" in line:
            insert_at = i + 1
            if i + 1 < len(lines) and lines[i + 1].strip().startswith("file:"):
                insert_at = i + 2
            break
        if line.startswith("- launchApp:"):
            insert_at = i + 1
            while insert_at < len(lines) and lines[insert_at].startswith("    "):
                insert_at += 1
            break
    if insert_at is None:
        for i, line in enumerate(lines):
            if line.strip() == "---":
                insert_at = i + 1
                break
    if insert_at is None:
        return False
    before_lines = BEFORE.format(scheme=scheme, row=row).rstrip().splitlines()
    after_lines = after_block(scheme, verify).rstrip().splitlines()
    new_lines = lines[:insert_at] + before_lines + lines[insert_at:] + [""] + after_lines
    path.write_text("\n".join(new_lines) + "\n")
    return True


def main() -> None:
    wired = skipped = 0
    for rel, (row, scheme, verify) in MUTATION_FLOWS.items():
        path = MAESTRO / rel
        if not path.exists():
            print(f"missing {rel}")
            skipped += 1
            continue
        if wire(path, row, scheme, verify):
            print(f"wired {rel}")
            wired += 1
        else:
            print(f"skip {rel} (already wired or no anchor)")
            skipped += 1
    print(f"done wired={wired} skipped={skipped}")


if __name__ == "__main__":
    main()
