#!/usr/bin/env python3
"""Bulk-link Budget Maestro+gap rows to existing e2e/maestro/budget flows."""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MATRIX = ROOT / "documents/engineering/testing/matrices/budget.md"

RULES: dict[str, str] = {
    "DASH": "e2e/maestro/budget/budget-dashboard-controls.yaml",
    "SPEND": "e2e/maestro/budget/budget-tabs.yaml",
    "SAVE": "e2e/maestro/budget/budget-savings-overview.yaml",
    "PLAN": "e2e/maestro/budget/budget-tabs.yaml",
    "PEN": "e2e/maestro/budget/budget-pension-interactions.yaml",
    "BILL": "e2e/maestro/budget/budget-bills.yaml",
    "WISH": "e2e/maestro/budget/budget-wishes.yaml",
    "BCHAT": "e2e/maestro/budget/budget-chat-message.yaml",
    "SETT": "e2e/maestro/budget/budget-settings.yaml",
    "AUTH": "e2e/maestro/subflows/budget-login-email-if-needed.yaml",
    "HH": "e2e/maestro/budget/budget-households.yaml",
    "SMOKE": "e2e/maestro/subflows/budget-launch-logged-in.yaml",
    "CORNER": "e2e/maestro/budget/budget-tabs.yaml",
}


def main() -> None:
    dry_run = "--dry-run" in sys.argv
    lines = MATRIX.read_text().splitlines()
    out: list[str] = []
    changed = 0
    for line in lines:
        if not line.startswith("|") or not re.match(r"\| BUDGET-", line):
            out.append(line)
            continue
        if "Maestro" not in line or not re.search(r"\|\s*`?gap`?\s*\|", line):
            out.append(line)
            continue
        m = re.search(r"\| (BUDGET-[A-Z0-9-]+) \|", line)
        if not m:
            out.append(line)
            continue
        section = m.group(1).split("-")[1]
        flow = RULES.get(section)
        if not flow or not (ROOT / flow).exists():
            out.append(line)
            continue
        cols = [c.strip() for c in line.split("|")]
        cols[9] = f"`{flow}`"
        out.append("| " + " | ".join(cols[1:-1]) + " |")
        changed += 1
    if changed and not dry_run:
        MATRIX.write_text("\n".join(out) + "\n")
    print(f"{'would link' if dry_run else 'linked'} {changed} Budget Maestro+gap rows")


if __name__ == "__main__":
    main()
