#!/usr/bin/env python3
"""Normalize Automation column paths in acceptance matrix files.

Expands relative Maestro `.yaml` cites and bare Jest `.ts`/`.tsx` filenames to
full repo paths. Only touches scored rows (ID matching APP-SECTION-NNN) and
only the Automation column.

Usage:
  python3 scripts/e2e/normalize-matrix-maestro-paths.py
  python3 scripts/e2e/normalize-matrix-maestro-paths.py --dry-run
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MATRICES_DIR = ROOT / "documents/engineering/testing/matrices"
MAESTRO_ROOT = ROOT / "e2e/maestro"
SRC_ROOT = ROOT / "src"

MATRIX_FILES: dict[str, str] = {
    "budget.md": "budget",
    "health.md": "health",
    "platform.md": "platform",
    "house.md": "house",
    "kaizen.md": "kaizen",
    "language.md": "language",
}

ROW_ID_RE = re.compile(r"^[A-Z][A-Z0-9]*-[A-Z0-9]+-\d+$")
BACKTICK_RE = re.compile(r"`([^`]+)`")


def build_maestro_basename_index() -> dict[str, list[str]]:
    index: dict[str, list[str]] = {}
    if not MAESTRO_ROOT.is_dir():
        return index
    for path in MAESTRO_ROOT.rglob("*.yaml"):
        rel = path.relative_to(ROOT).as_posix()
        index.setdefault(path.name, []).append(rel)
    return index


def build_src_test_index() -> dict[str, list[str]]:
    index: dict[str, list[str]] = {}
    if not SRC_ROOT.is_dir():
        return index
    for path in SRC_ROOT.rglob("*"):
        if not path.is_file():
            continue
        name = path.name
        if not (name.endswith(".test.ts") or name.endswith(".test.tsx") or name.endswith(".ts") or name.endswith(".tsx")):
            continue
        rel = path.relative_to(ROOT).as_posix()
        index.setdefault(name, []).append(rel)
    return index


def resolve_yaml(ref: str, app: str, maestro_by_basename: dict[str, list[str]]) -> tuple[str, bool]:
    """Return (resolved_path, found)."""
    ref = ref.strip()
    if ref.startswith("e2e/maestro/"):
        return ref, True

    basename = ref.rsplit("/", 1)[-1]

    candidates: list[Path] = [
        MAESTRO_ROOT / app / ref,
        MAESTRO_ROOT / app / basename,
        MAESTRO_ROOT / app / "subflows" / basename,
        MAESTRO_ROOT / "subflows" / basename,
        MAESTRO_ROOT / basename,
    ]
    seen: set[str] = set()
    for candidate in candidates:
        rel = candidate.relative_to(ROOT).as_posix()
        if rel in seen:
            continue
        seen.add(rel)
        if candidate.is_file():
            return rel, True

    matches = maestro_by_basename.get(basename, [])
    if len(matches) == 1:
        return matches[0], True

    return ref, False


def resolve_src_test(ref: str, src_by_basename: dict[str, list[str]]) -> tuple[str, bool]:
    ref = ref.strip()
    if ref.startswith("src/"):
        return ref, True
    if "/" in ref:
        return ref, True
    if not re.search(r"\.(test\.)?(tsx?)$", ref):
        return ref, True

    matches = src_by_basename.get(ref, [])
    if len(matches) == 1:
        return matches[0], True
    return ref, True


def normalize_automation_cell(
    cell: str,
    app: str,
    maestro_by_basename: dict[str, list[str]],
    src_by_basename: dict[str, list[str]],
    unresolved_yaml: list[str],
) -> tuple[str, int]:
    updates = 0

    def replace_backtick(match: re.Match[str]) -> str:
        nonlocal updates
        original = match.group(1)
        if original in ("gap", "n/a"):
            return f"`{original}`"

        new_val = original
        changed = False

        if original.endswith(".yaml") and not original.startswith("e2e/maestro/"):
            resolved, found = resolve_yaml(original, app, maestro_by_basename)
            if found and resolved != original:
                new_val = resolved
                changed = True
            elif not found:
                unresolved_yaml.append(original)

        elif re.search(r"\.(test\.)?(tsx?)$", original) and not original.startswith("src/"):
            resolved, _ = resolve_src_test(original, src_by_basename)
            if resolved != original:
                new_val = resolved
                changed = True

        if changed:
            updates += 1
        return f"`{new_val}`"

    new_cell = BACKTICK_RE.sub(replace_backtick, cell)
    return new_cell, updates


def process_matrix_file(
    filename: str,
    app: str,
    maestro_by_basename: dict[str, list[str]],
    src_by_basename: dict[str, list[str]],
    dry_run: bool,
) -> tuple[bool, int, list[str]]:
    path = MATRICES_DIR / filename
    lines = path.read_text().splitlines()
    out: list[str] = []
    rows_updated = 0
    unresolved: list[str] = []
    file_changed = False

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

        automation = cols[9]
        new_automation, n = normalize_automation_cell(
            automation, app, maestro_by_basename, src_by_basename, unresolved
        )
        if new_automation != automation:
            cols[9] = new_automation
            out.append("| " + " | ".join(cols[1:-1]) + " |")
            rows_updated += 1
            file_changed = True
        else:
            out.append(line)

    if file_changed and not dry_run:
        path.write_text("\n".join(out) + "\n")

    return file_changed, rows_updated, unresolved


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Report changes without writing files")
    args = parser.parse_args()

    maestro_by_basename = build_maestro_basename_index()
    src_by_basename = build_src_test_index()

    files_changed = 0
    total_rows = 0
    all_unresolved: list[str] = []

    for filename, app in MATRIX_FILES.items():
        changed, rows, unresolved = process_matrix_file(
            filename, app, maestro_by_basename, src_by_basename, args.dry_run
        )
        if changed:
            files_changed += 1
        total_rows += rows
        all_unresolved.extend(unresolved)

    unique_unresolved = sorted(set(all_unresolved))

    mode = "would change" if args.dry_run else "changed"
    print(f"Summary ({mode}):")
    print(f"  files {mode}: {files_changed}/{len(MATRIX_FILES)}")
    print(f"  rows updated: {total_rows}")
    if unique_unresolved:
        print(f"  unresolved yaml ({len(unique_unresolved)}):")
        for item in unique_unresolved:
            print(f"    - {item}")
    else:
        print("  unresolved yaml: none")

    return 0


if __name__ == "__main__":
    sys.exit(main())
