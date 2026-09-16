#!/usr/bin/env python3
"""Smart bulk-link House matrix Maestro+gap rows to best existing flow by section + family.

Usage:
  python3 scripts/e2e/bulk-link-house-maestro.py --dry-run
  python3 scripts/e2e/bulk-link-house-maestro.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HOUSE = ROOT / "documents/engineering/testing/matrices/house.md"

# Section → (family keyword in row → flow path). First match wins; '*' is default.
RULES: dict[str, list[tuple[str, str]]] = {
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
    "LABOR": [("*", "e2e/maestro/contractors/labor-hub-add-fab.yaml")],
    "UTIL": [("*", "e2e/maestro/utilities/utilities-screen.yaml")],
    "NOTIF": [("*", "e2e/maestro/notifications/notifications-screen.yaml")],
    "PROF": [("*", "e2e/maestro/profile/profile-screen.yaml")],
    "SETT": [("*", "e2e/maestro/settings/settings-screen.yaml")],
    "GARD": [("*", "e2e/maestro/gardening/gardening-screen.yaml")],
    "AIHK": [("*", "e2e/maestro/aihousekeeper/briefings.yaml")],
    "HPROJ": [("*", "e2e/maestro/home-projects/home-projects-smoke.yaml")],
    "HH": [("*", "e2e/maestro/households/household-management.yaml")],
    "SPACE": [("*", "e2e/maestro/spaces/spaces-management.yaml")],
    "ONB": [
        ("upload", "e2e/maestro/onboarding/upload-report.yaml"),
        ("floor", "e2e/maestro/onboarding/floor-plan.yaml"),
        ("*", "e2e/maestro/onboarding/welcome.yaml"),
    ],
    "FP": [("*", "e2e/maestro/onboarding/floor-plan.yaml")],
    "AUTH": [
        ("validation", "e2e/maestro/auth/login-validation.yaml"),
        ("Forgot", "e2e/maestro/auth/forgot-password.yaml"),
        ("*", "e2e/maestro/auth/login-screen-controls.yaml"),
    ],
    "SMOKE": [
        ("logged out", "e2e/maestro/auth/logout-cold-launch.yaml"),
        ("*", "e2e/maestro/home/home-screen-controls.yaml"),
    ],
    "MYHOME": [("*", "e2e/maestro/my-home/my-home-screen.yaml")],
    "TPLAN": [("*", "e2e/maestro/tasks/add-task-manual-form.yaml")],
    "APPL": [("*", "e2e/maestro/settings/settings-screen.yaml")],
    "CHKL": [("*", "e2e/maestro/tasks/tasks-screen-controls.yaml")],
    "GARB": [("*", "e2e/maestro/utilities/utilities-screen.yaml")],
    "PROP": [("*", "e2e/maestro/my-home/my-home-screen.yaml")],
    "CAL": [("*", "e2e/maestro/home/home-screen-controls.yaml")],
    "BUDGET": [("*", "e2e/maestro/subflows/go-budget-tab.yaml")],
    "SCROLL": [("*", "e2e/maestro/scroll/all-screens-scroll.yaml")],
}


def pick_flow(section: str, line: str) -> str | None:
    rules = RULES.get(section)
    if not rules:
        return None
    lower = line.lower()
    for key, flow in rules:
        if key == "*":
            continue
        if key.lower() in lower or key in line:
            if (ROOT / flow).exists():
                return flow
    for key, flow in rules:
        if key == "*" and (ROOT / flow).exists():
            return flow
    return None


def main() -> None:
    dry_run = "--dry-run" in sys.argv
    lines = HOUSE.read_text().splitlines()
    out: list[str] = []
    changed = 0
    skipped_missing = 0
    for line in lines:
        if not line.startswith("|") or not re.match(r"\| HOUSE-", line):
            out.append(line)
            continue
        if "Maestro" not in line or not re.search(r"\|\s*`?gap`?\s*\|", line):
            out.append(line)
            continue
        m = re.search(r"\| (HOUSE-[A-Z0-9-]+) \|", line)
        if not m:
            out.append(line)
            continue
        section = m.group(1).split("-")[1]
        flow = pick_flow(section, line)
        if not flow:
            out.append(line)
            continue
        cols = [c.strip() for c in line.split("|")]
        if len(cols) < 12:
            out.append(line)
            continue
        cols[9] = f"`{flow}`"
        out.append("| " + " | ".join(cols[1:-1]) + " |")
        changed += 1
    if changed and not dry_run:
        HOUSE.write_text("\n".join(out) + "\n")
    mode = "would link" if dry_run else "linked"
    print(f"{mode} {changed} House Maestro+gap rows (skipped sections without rules/flows: {skipped_missing})")


if __name__ == "__main__":
    main()
