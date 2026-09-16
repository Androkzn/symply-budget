#!/usr/bin/env python3
"""Bulk-link Language / Kaizen / Health / Platform Maestro+gap rows."""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

CONFIG = {
    "language.md": {
        "prefix": "LANG-",
        "rules": {
            "LEARN": "e2e/maestro/language/learn-home.yaml",
            "TUTOR": "e2e/maestro/language/tutor.yaml",
            "REVIEW": "e2e/maestro/language/review.yaml",
            "PLAN": "e2e/maestro/language/plan.yaml",
            "MORE": "e2e/maestro/language/more-settings.yaml",
            "ASSESS": "e2e/maestro/language/assessment.yaml",
            "AUTH": "e2e/maestro/language/subflows/language-login-if-needed.yaml",
            "ONB": "e2e/maestro/language/onboarding.yaml",
            "SHELL": "e2e/maestro/language/subflows/launch-language.yaml",
            "SMOKE": "e2e/maestro/language/learn-home.yaml",
        },
    },
    "kaizen.md": {
        "prefix": "KAIZEN-",
        "rules": {
            "GUIDE": "e2e/maestro/kaizen/guide-screen.yaml",
            "SCROLL": "e2e/maestro/kaizen/scroll-all-screens.yaml",
            "AUTH": "e2e/maestro/kaizen/login-screen-controls.yaml",
            "TODAY": "e2e/maestro/kaizen/today-screen.yaml",
            "SYS": "e2e/maestro/kaizen/systems-hub.yaml",
            "SYNC": "e2e/maestro/kaizen/systems-hub.yaml",
        },
    },
    "health.md": {
        "prefix": "HEALTH-",
        "rules": {
            "HOME": "e2e/maestro/health/home-weight-water-note.yaml",
            "PRIV": "e2e/maestro/health/home-empty-and-privacy.yaml",
            "AUTH": "e2e/maestro/health/login-screen-controls.yaml",
            "SCROLL": "e2e/maestro/health/scroll-all-screens.yaml",
            "TAB": "e2e/maestro/health/subflows/go-health-home.yaml",
            "MORE": "e2e/maestro/health/more-settings-controls.yaml",
            "SMOKE": "e2e/maestro/health/subflows/launch-health.yaml",
        },
    },
    "platform.md": {
        "prefix": "PLAT-",
        "rules": {
            "AUTH": "e2e/maestro/auth/login-screen-controls.yaml",
            "HH": "e2e/maestro/households/household-management.yaml",
            "NOTIF": "e2e/maestro/notifications/notifications-screen.yaml",
            "SUB": "e2e/maestro/settings/settings-screen.yaml",
            "AIACC": "e2e/maestro/settings/settings-screen.yaml",
            "SETT": "e2e/maestro/settings/settings-screen.yaml",
            "ONB": "e2e/maestro/onboarding/welcome.yaml",
        },
    },
}


def link_matrix(filename: str, cfg: dict, dry_run: bool) -> int:
    path = ROOT / "documents/engineering/testing/matrices" / filename
    prefix = cfg["prefix"]
    rules = cfg["rules"]
    lines = path.read_text().splitlines()
    out: list[str] = []
    changed = 0
    pat = re.compile(rf"\| ({re.escape(prefix.rstrip('-'))}[A-Z0-9-]+) \|")
    for line in lines:
        if not line.startswith("|") or prefix.rstrip("-") not in line:
            out.append(line)
            continue
        if "Maestro" not in line or not re.search(r"\|\s*`?gap`?\s*\|", line):
            out.append(line)
            continue
        m = pat.search(line)
        if not m:
            out.append(line)
            continue
        section = m.group(1).split("-")[1]
        flow = rules.get(section)
        if not flow or not (ROOT / flow).exists():
            out.append(line)
            continue
        cols = [c.strip() for c in line.split("|")]
        cols[9] = f"`{flow}`"
        out.append("| " + " | ".join(cols[1:-1]) + " |")
        changed += 1
    if changed and not dry_run:
        path.write_text("\n".join(out) + "\n")
    return changed


def main() -> None:
    dry_run = "--dry-run" in sys.argv
    total = 0
    for fn, cfg in CONFIG.items():
        n = link_matrix(fn, cfg, dry_run)
        print(f"{'would link' if dry_run else 'linked'} {n} in {fn}")
        total += n
    print(f"total: {total}")


if __name__ == "__main__":
    main()
