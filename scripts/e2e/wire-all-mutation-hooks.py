#!/usr/bin/env python3
"""Wire e2e-matrix-before/after on every Maestro flow tagged mutation."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MAESTRO = ROOT / "e2e/maestro"

SCHEME = {
    "com.symply.house": "simplehouse",
    "com.symply.budget": "simplebudget",
    "com.symply.kaizen": "kaizen",
    "com.symply.language": "simplelanguage",
    "com.symply.health": "simplehealth",
}


def subflow_prefix(path: Path) -> str:
    rel = path.relative_to(MAESTRO)
    depth = len(rel.parts) - 1
    return "../" * depth + "subflows/"


def parse_app_id(text: str) -> str | None:
    m = re.search(r"^appId:\s*(.+)$", text, re.M)
    return m.group(1).strip() if m else None


def parse_matrix_row(text: str) -> str:
    m = re.search(r"# Matrix:\s*([A-Z0-9-]+)", text)
    if m:
        return m.group(1)
    m = re.search(r"# Matrix:.*?([A-Z]{2,}-[A-Z0-9]+-\d{3})", text)
    if m:
        return m.group(1)
    return "E2E-MUTATION"


def is_mutation_flow(text: str) -> bool:
    if "config.yaml" in text:
        return False
    return bool(re.search(r"^\s+- mutation\s*$", text, re.M))


def insert_hooks(path: Path) -> bool:
    text = path.read_text()
    if not is_mutation_flow(text):
        return False
    if "e2e-matrix-before" in text:
        return False

    app_id = parse_app_id(text)
    if not app_id or app_id.startswith("${"):
        return False
    scheme = SCHEME.get(app_id)
    if not scheme:
        return False

    row = parse_matrix_row(text)
    prefix = subflow_prefix(path)

    lines = text.splitlines()
    insert_at = None
    for i, line in enumerate(lines):
        if line.strip() == "---":
            insert_at = i + 1
            break
    if insert_at is None:
        return False

    before = [
        "- runFlow:",
        "    file: " + prefix + "e2e-matrix-before.yaml",
        "    env:",
        f"      E2E_APP_SCHEME: {scheme}",
        f"      APP_ID: {app_id}",
        f"      E2E_MATRIX_ROW: {row}",
    ]
    after = [
        "",
        "- runFlow:",
        "    file: " + prefix + "e2e-matrix-after.yaml",
        "    env:",
        f"      E2E_APP_SCHEME: {scheme}",
        f"      APP_ID: {app_id}",
    ]

    # Skip duplicate launch if first command is runFlow launch
    new_lines = lines[:insert_at] + before + lines[insert_at:] + after
    path.write_text("\n".join(new_lines) + "\n")
    return True


def main() -> None:
    wired = skipped = 0
    for path in sorted(MAESTRO.rglob("*.yaml")):
        if path.parent.name == "subflows" and "subflows" in path.parts:
            continue
        if insert_hooks(path):
            print("wired", path.relative_to(MAESTRO))
            wired += 1
        else:
            skipped += 1
    print(f"done wired={wired} skipped={skipped}")


if __name__ == "__main__":
    main()
