#!/usr/bin/env python3
"""Bulk-link matrix Automation column from `gap` to a Maestro flow path.

Usage:
  python3 scripts/e2e/link-matrix-automation.py house HOUSE-AUTH- e2e/maestro/auth/login-screen-controls.yaml
  python3 scripts/e2e/link-matrix-automation.py house HOUSE-AUTH-005,HOUSE-AUTH-006 e2e/maestro/auth/login-validation.yaml
  python3 scripts/e2e/link-matrix-automation.py --dry-run health HEALTH-HOME- e2e/maestro/health/home-weight-water-note.yaml

Only rows whose Automation cell is exactly `gap` (or gap without backticks) are updated.
Optional: pass --maestro-only to skip rows without Maestro in Layer column.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MATRICES = ROOT / "documents/engineering/testing/matrices"


def parse_args(argv: list[str]) -> tuple[bool, bool, str, list[str], str]:
    dry_run = False
    maestro_only = True
    args = list(argv)
    if "--dry-run" in args:
        dry_run = True
        args.remove("--dry-run")
    if "--all-layers" in args:
        maestro_only = False
        args.remove("--all-layers")
    if len(args) != 3:
        print(__doc__)
        sys.exit(2)
    app, ids_spec, flow = args
    if "," in ids_spec:
        id_patterns = [s.strip() for s in ids_spec.split(",") if s.strip()]
    else:
        id_patterns = [ids_spec.strip()]
    return dry_run, maestro_only, app, id_patterns, flow.strip()


def row_matches(row_id: str, patterns: list[str]) -> bool:
    for p in patterns:
        if p.endswith("-") and row_id.startswith(p):
            return True
        if row_id == p:
            return True
    return False


def link_file(path: Path, patterns: list[str], flow: str, dry_run: bool, maestro_only: bool) -> int:
    lines = path.read_text().splitlines()
    changed = 0
    out: list[str] = []
    for line in lines:
        if not line.startswith("|") or not re.match(r"\| [A-Z0-9]+-", line):
            out.append(line)
            continue
        cols = [c.strip() for c in line.split("|")]
        # cols[0]='' cols[1]=ID ... Automation is second-to-last before Notes
        if len(cols) < 12:
            out.append(line)
            continue
        row_id = cols[1]
        layer = cols[8] if len(cols) > 8 else ""
        automation = cols[9] if len(cols) > 9 else ""
        if not row_matches(row_id, patterns):
            out.append(line)
            continue
        if maestro_only and "Maestro" not in layer:
            out.append(line)
            continue
        if automation not in ("gap", "`gap`"):
            out.append(line)
            continue
        cols[9] = f"`{flow}`"
        out.append("| " + " | ".join(cols[1:-1]) + " |")
        changed += 1
    if changed and not dry_run:
        path.write_text("\n".join(out) + "\n")
    return changed


def main() -> None:
    dry_run, maestro_only, app, patterns, flow = parse_args(sys.argv[1:])
    path = MATRICES / f"{app}.md"
    if not path.exists():
        print(f"Matrix not found: {path}")
        sys.exit(1)
    n = link_file(path, patterns, flow, dry_run, maestro_only)
    mode = "would update" if dry_run else "updated"
    print(f"{mode} {n} row(s) in {path.name} → {flow}")


if __name__ == "__main__":
    main()
