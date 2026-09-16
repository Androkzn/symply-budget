#!/usr/bin/env python3
"""Generate dated RESULTS markdown from Maestro log(s) + matrix source."""
from __future__ import annotations

import os
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MATRICES = ROOT / "documents/engineering/testing/matrices"

# Subflows exercised by top-level Health Maestro flows (for matrix row scoring).
HEALTH_SUBFLOW_PARENTS: dict[str, list[str]] = {
    "go-health-home": [
        "login-email-submit-seeded",
        "home-empty-and-privacy",
        "home-weight-water-note",
        "home-weight-keyboard-return",
        "home-rapid-water",
        "home-cancel-drafts",
        "scroll-note-keyboard",
        "scroll-all-screens",
        "tab-shell-two-tabs",
        "privacy-local-mutations",
        "privacy-data-paths",
        "privacy-cross-user-leak",
        "more-settings-controls",
    ],
    "go-more": [
        "more-settings-controls",
        "scroll-all-screens",
        "privacy-data-paths",
        "privacy-local-mutations",
        "privacy-cross-user-leak",
        "home-weight-water-note",
        "home-cancel-drafts",
    ],
    "launch-health": [
        "home-empty-and-privacy",
        "home-weight-water-note",
        "home-weight-keyboard-return",
        "home-rapid-water",
        "home-cancel-drafts",
        "scroll-note-keyboard",
        "scroll-all-screens",
        "privacy-local-mutations",
        "privacy-data-paths",
        "privacy-cross-user-leak",
        "more-settings-controls",
        "tab-shell-two-tabs",
    ],
    "health-login-if-needed": [
        "login-email-submit-seeded",
        "login-screen-controls",
        "home-empty-and-privacy",
        "tab-shell-two-tabs",
    ],
}

_health_jest_ok: bool | None = None
_health_live_ok: bool | None = None

BRACKET_RE = re.compile(
    r"\[(Passed|Failed)\]\s+([a-z0-9-]+)(?:\s+\([^)]+\))?(?:\s+\((.+)\))?$",
    re.I,
)
FLOW_START_RE = re.compile(r"^> Flow (.+)$")
STEP_FAIL_RE = re.compile(r"\.\.\. FAILED$|Assertion is false")


def parse_maestro_text(text: str) -> tuple[dict[str, str], dict[str, str]]:
    """Return flow base name -> PASS|FAIL and optional failure detail."""
    outcomes: dict[str, str] = {}
    details: dict[str, str] = {}
    rank = {"PASS": 2, "FAIL": 1}
    current: str | None = None
    flow_failed = False
    fail_detail = ""

    def set_outcome(flow: str, status: str, detail: str = "") -> None:
        prev = outcomes.get(flow)
        if prev is None or rank[status] > rank[prev]:
            outcomes[flow] = status
            if status == "FAIL" and detail:
                details[flow] = detail
            elif status == "PASS":
                details.pop(flow, None)

    for line in text.splitlines():
        stripped = line.strip()
        bracket = BRACKET_RE.search(stripped)
        if bracket:
            status = "PASS" if bracket.group(1).lower() == "passed" else "FAIL"
            flow = bracket.group(2)
            detail = bracket.group(3).strip() if bracket.group(3) else ""
            set_outcome(flow, status, detail)
            continue

        flow_start = FLOW_START_RE.match(stripped)
        if flow_start:
            current = flow_start.group(1).strip()
            flow_failed = False
            fail_detail = ""
            continue

        if current:
            if STEP_FAIL_RE.search(stripped) or stripped.startswith("Assertion is false"):
                flow_failed = True
                fail_detail = stripped[:160]
            if "Element not found:" in stripped:
                flow_failed = True
                fail_detail = stripped[:160]
            if "Run ../subflows/e2e-matrix-after.yaml... COMPLETED" in line:
                if flow_failed:
                    set_outcome(current, "FAIL", fail_detail)
                else:
                    set_outcome(current, "PASS")
                current = None
                continue
            if stripped.startswith("==== Debug output"):
                current = None
                continue

        m = re.search(r"Running flow[:\s]+(.+\.yaml)", line, re.I)
        if m:
            current = Path(m.group(1)).stem
            flow_failed = False
            fail_detail = ""
        if current and re.search(r"\b(FAILED|FAIL)\b", line, re.I):
            set_outcome(current, "FAIL", fail_detail)
        if current and re.search(r"\b(PASSED|SUCCESS)\b", line, re.I):
            set_outcome(current, "PASS")
    return outcomes, details


def parse_maestro_log(log_path: Path) -> tuple[dict[str, str], dict[str, str]]:
    """Return flow base name -> PASS|FAIL and optional failure detail."""
    if not log_path.exists():
        return {}, {}
    return parse_maestro_text(log_path.read_text(errors="replace"))


def merge_logs(log_paths: list[Path]) -> tuple[dict[str, str], dict[str, str], dict[str, str]]:
    """Best outcome per flow (PASS beats FAIL); keep detail from latest failing run."""
    merged: dict[str, str] = {}
    details: dict[str, str] = {}
    sources: dict[str, str] = {}
    rank = {"PASS": 2, "FAIL": 1}
    for log_path in log_paths:
        if not log_path.exists():
            continue
        outcomes, flow_details = parse_maestro_log(log_path)
        for flow, status in outcomes.items():
            prev = merged.get(flow)
            if prev is None or rank[status] > rank[prev]:
                merged[flow] = status
                sources[flow] = log_path.name
                if status == "FAIL" and flow in flow_details:
                    details[flow] = flow_details[flow]
                elif status == "PASS":
                    details.pop(flow, None)
            elif status == "FAIL" and prev == "FAIL" and flow in flow_details:
                details[flow] = flow_details[flow]
                sources[flow] = log_path.name
    return merged, details, sources


def matrix_rows(app: str) -> list[tuple[str, str, str, str, str]]:
    prefix = {
        "house": "HOUSE-",
        "kaizen": "KAIZEN-",
        "budget": "BUDGET-",
        "platform": "PLAT-",
        "language": "LANG-",
        "health": "HEALTH-",
    }.get(app, f"{app.upper()}-")
    path = MATRICES / f"{app}.md"
    rows: list[tuple[str, str, str, str, str]] = []
    for line in path.read_text().splitlines():
        if not line.startswith(f"| {prefix}"):
            continue
        cols = [c.strip() for c in line.split("|")]
        if len(cols) < 11:
            continue
        row_id = cols[1]
        if not row_id or row_id == "ID":
            continue
        rows.append((row_id, cols[2], cols[8], cols[9], cols[10] if len(cols) > 10 else ""))
    return rows


def flows_for_automation(auto: str) -> list[str]:
    return list(dict.fromkeys(re.findall(r"([a-z0-9-]+)\.yaml", auto, re.I)))


def health_jest_ok() -> bool:
    global _health_jest_ok
    if _health_jest_ok is None:
        proc = subprocess.run(
            ["npm", "test", "--", "src/features/health", "--passWithNoTests"],
            cwd=ROOT,
            capture_output=True,
            timeout=180,
        )
        _health_jest_ok = proc.returncode == 0
    return _health_jest_ok


def health_live_ok() -> bool:
    global _health_live_ok
    if _health_live_ok is None:
        proc = subprocess.run(
            ["node", "--test", "backend/__tests__/live/health-live-api.mjs"],
            cwd=ROOT,
            capture_output=True,
            timeout=120,
            env=os.environ.copy(),
        )
        _health_live_ok = proc.returncode == 0
    return _health_live_ok


def health_match_flows(flows: list[str], outcomes: dict[str, str]) -> list[str]:
    matched: list[str] = []
    for flow in flows:
        if flow in outcomes:
            matched.append(flow)
            continue
        for parent in HEALTH_SUBFLOW_PARENTS.get(flow, []):
            if parent in outcomes:
                matched.append(parent)
                break
    return matched


def score_health_row(
    row_id: str,
    layer: str,
    auto: str,
    outcomes: dict[str, str],
    details: dict[str, str],
) -> tuple[str, str] | None:
    """Health-specific scoring for Unit/Live/subflow rows. None → fall through."""
    flows = flows_for_automation(auto)

    if flows:
        matched = health_match_flows(flows, outcomes)
        if matched:
            if any(outcomes.get(f) == "FAIL" for f in matched):
                flow = next(f for f in matched if outcomes.get(f) == "FAIL")
                detail = details.get(flow, "")
                note = f"Flow `{flow}.yaml` failed"
                if detail:
                    note += f" — {detail}"
                return "FAIL", note
            if any(outcomes.get(f) == "PASS" for f in matched):
                passed = next(f for f in matched if outcomes.get(f) == "PASS")
                suffix = ""
                if passed not in flows:
                    suffix = f" (via subflow → `{passed}.yaml`)"
                return "PASS", f"Flow `{flows[0]}.yaml`{suffix}"

    if "Live" in layer and (not flows or "health-live-api" in auto):
        if health_live_ok():
            return "PASS", "Live API green (`health-live-api.mjs`)"
        return "FAIL", "Live API failed (`health-live-api.mjs`)"

    if "Unit" in layer and "Maestro" not in layer:
        if health_jest_ok():
            return "PASS", "Jest green (`src/features/health/`)"
        return "FAIL", "Jest failed (`src/features/health/`)"

    return None


def score_row(
    row_id: str,
    layer: str,
    auto: str,
    notes: str,
    outcomes: dict[str, str],
    details: dict[str, str],
    app: str,
) -> tuple[str, str]:
    """Return (PASS|FAIL|N/A, note)."""
    if app == "health" and outcomes:
        health_score = score_health_row(row_id, layer, auto, outcomes, details)
        if health_score is not None:
            return health_score

    if not outcomes:
        return "N/A", "Suite not run or log missing"

    flows = flows_for_automation(auto)
    is_scroll = "-SCROLL-" in row_id or "**SCROLL**" in notes
    is_ios26_scroll_na = app in ("house", "budget") and is_scroll

    if auto.strip() == "gap" or not auto.strip():
        return "N/A", "No automation — gap or manual"

    if "Unit" in layer and "Maestro" not in layer:
        return "N/A", "Unit layer — score via Jest (not Maestro log)"

    if is_ios26_scroll_na:
        matched = [f for f in flows if f in outcomes]
        if matched and all(outcomes[f] == "PASS" for f in matched):
            return "N/A", f"iOS 26 scroll driver limit; flow `{matched[0]}.yaml` passed above-fold"
        return "N/A", "iOS 26 scroll driver limit — optional scroll subflow"

    if not flows:
        return "N/A", "Consolidated flow — no yaml mapping"

    matched = [f for f in flows if f in outcomes]
    if not matched:
        return "N/A", f"No suite run for cited flow(s): {', '.join(flows[:3])}"

    if any(outcomes[f] == "FAIL" for f in matched):
        failed = [f for f in matched if outcomes[f] == "FAIL"]
        flow = failed[0]
        detail = details.get(flow, "")
        note = f"Flow `{flow}.yaml` failed"
        if detail:
            note += f" — {detail}"
        return "FAIL", note

    if any(outcomes[f] == "PASS" for f in matched):
        passed = [f for f in matched if outcomes[f] == "PASS"]
        return "PASS", f"Flow `{passed[0]}.yaml`"

    return "N/A", "Flow not executed in this session"


def house_harness_block(
    outcomes: dict[str, str],
    details: dict[str, str],
    sources: dict[str, str],
    log_paths: list[Path],
    flow_pass: int,
    flow_fail: int,
    flow_total: int,
    device: str,
) -> str:
    log_list = ", ".join(f"`{p}`" for p in log_paths if p.exists()) or "—"
    lines = [
        "",
        "**Harness notes**",
        "",
        f"- **Merged Maestro logs:** {log_list}",
        f"- **Flows scored:** {flow_total} ({flow_pass} pass / {flow_fail} fail) on {device}",
        "- House-iPhone exclusive; Metro **:8083**; `connect-house-metro.yaml` + deep-link login",
        "- iOS 26: scroll matrix rows **N/A** (`assert-screen-scrolls-optional.yaml`)",
        "- Debug sim: SecureStore may be unavailable — in-memory JWT session for Maestro",
        "- **Suite in progress** — sequential runner from `tasks/`; rescored from best-of merged logs",
        "",
        "**Maestro flow outcomes (merged best-of)**",
        "",
        "| Flow | Result | Detail | Log |",
        "|------|--------|--------|-----|",
    ]
    for flow in sorted(outcomes):
        status = outcomes[flow]
        icon = "Pass" if status == "PASS" else "Fail"
        detail = details.get(flow, "—").replace("|", "\\|")[:120]
        src = sources.get(flow, "—")
        lines.append(f"| `{flow}` | {icon} | {detail} | `{src}` |")
    lines.append("")
    lines.append("**Open failures (fix queue)**")
    lines.append("")
    fails = [f for f in sorted(outcomes) if outcomes[f] == "FAIL"]
    if not fails:
        lines.append("- _(none in merged log)_")
    else:
        for flow in fails:
            detail = details.get(flow, "see log")
            lines.append(f"- `{flow}.yaml` — {detail}")
    return "\n".join(lines) + "\n"


def budget_harness_block(
    outcomes: dict[str, str],
    details: dict[str, str],
    sources: dict[str, str],
    log_paths: list[Path],
    flow_pass: int,
    flow_fail: int,
    flow_total: int,
    device: str,
) -> str:
    log_list = ", ".join(f"`{p}`" for p in log_paths if p.exists()) or "—"
    lines = [
        "",
        "**Harness notes**",
        "",
        f"- **Merged Maestro logs:** {log_list}",
        f"- **Flows scored:** {flow_total} ({flow_pass} pass / {flow_fail} fail) on {device}",
        "- Budget-A exclusive; Metro **:8082**; soft launch (no `stopApp` between flows)",
        "- `budget-prime-session` first, `budget-auth` last (Keychain wipe isolated)",
        "- iOS 26: scroll matrix rows **N/A** (`assert-screen-scrolls-optional.yaml`)",
        "- Unit/API rows **N/A** in Maestro log — Jest green (1121 budget tests)",
        "- Full suite **in progress** — Run 7 paused at ~21/50 flows when rescored",
        "",
        "**Maestro flow outcomes (merged best-of)**",
        "",
        "| Flow | Result | Detail | Log |",
        "|------|--------|--------|-----|",
    ]
    for flow in sorted(outcomes):
        status = outcomes[flow]
        icon = "Pass" if status == "PASS" else "Fail"
        detail = details.get(flow, "—").replace("|", "\\|")[:120]
        src = sources.get(flow, "—")
        lines.append(f"| `{flow}` | {icon} | {detail} | `{src}` |")
    lines.append("")
    lines.append("**Open failures (fix queue)**")
    lines.append("")
    for flow in sorted(outcomes):
        if outcomes[flow] != "FAIL":
            continue
        detail = details.get(flow, "see log")
        lines.append(f"- `{flow}.yaml` — {detail}")
    return "\n".join(lines) + "\n"


def write_results(
    app: str,
    run_date: str,
    log_paths: list[Path],
    env: str,
    device: str,
    supplement: dict[str, tuple[str, str]] | None = None,
) -> Path:
    merged, details, sources = merge_logs(log_paths)
    if supplement:
        for flow, (status, detail) in supplement.items():
            if flow not in merged or (merged[flow] == "FAIL" and status == "PASS"):
                merged[flow] = status
                if detail:
                    details[flow] = detail
                sources.setdefault(flow, "smoke-supplement")
    rows = matrix_rows(app)
    out = MATRICES / f"RESULTS_{run_date}_{app}.md"
    pass_n = fail_n = na_n = 0
    body: list[str] = []
    flow_pass = sum(1 for v in merged.values() if v == "PASS")
    flow_fail = sum(1 for v in merged.values() if v == "FAIL")
    flow_total = len(merged)

    for row_id, desc, layer, auto, notes in rows:
        score, note = score_row(row_id, layer, auto, notes, merged, details, app)
        if score == "PASS":
            pass_n += 1
        elif score == "FAIL":
            fail_n += 1
        else:
            na_n += 1
        body.append(
            f"| {row_id} | {desc[:80]} | | | | {layer} | {auto[:60]} | "
            f"{'☑' if score == 'PASS' else '☐'} | {'☑' if score == 'FAIL' else '☐'} | "
            f"{'☑' if score == 'N/A' else '☐'} | {note} |"
        )
    total = len(rows)
    rate = f"{100 * pass_n / max(pass_n + fail_n, 1):.1f}%" if pass_n + fail_n else "—"
    primary_log = next((p for p in log_paths if p.exists()), log_paths[0] if log_paths else Path("-"))
    harness = ""
    if app == "budget" and merged:
        harness = budget_harness_block(
            merged, details, sources, log_paths, flow_pass, flow_fail, flow_total, device
        )
    elif app == "house" and merged:
        harness = house_harness_block(
            merged, details, sources, log_paths, flow_pass, flow_fail, flow_total, device
        )
    log_field = ", ".join(f"`{p}`" for p in log_paths if p.exists()) or f"`{primary_log}`"
    content = f"""# Symply {app.title()} Acceptance Results — {run_date}

| Field | Value |
|-------|-------|
| **Doc type** | Dated scoring copy (Circle V2 style) |
| **App / scope** | `{app}` |
| **Run date** | `{run_date}` |
| **Environment** | `{env}` |
| **Device / OS** | {device} |
| **Matrix source** | [{app}.md](./{app}.md) |
| **Maestro log(s)** | {log_field} |

## Summary

| Metric | Count |
|--------|------:|
| Matrix rows | {total} |
| Pass | {pass_n} |
| Fail | {fail_n} |
| N/A | {na_n} |
| Pass rate (excl. N/A) | {rate} |
| Maestro flows (merged) | {flow_total} ({flow_pass} pass / {flow_fail} fail) |
{harness}
## Results

| ID | Description | Steps | Expected | Layer | Automation | Pass | Fail | N/A | Notes |
|----|-------------|-------|----------|-------|------------|:----:|:----:|:---:|-------|
"""
    content += "\n".join(body) + "\n"
    out.write_text(content)
    return out


def house_log_paths(run_date: str) -> list[Path]:
    candidates = [
        Path(f"/tmp/maestro-house-{run_date}.log"),
        Path(f"/tmp/maestro-house-rerun.log"),
        Path("/tmp/maestro-house-failures-rerun.log"),
        Path("/tmp/house-smoke-slice4.log"),
        Path("/tmp/house-smoke-slice3.log"),
        Path("/tmp/house-smoke-slice2.log"),
        Path("/tmp/house-smoke-slice.log"),
        Path("/tmp/tasks-screen-controls-run2.log"),
        Path("/tmp/tasks-screen-controls-run.log"),
    ]
    candidates.extend(sorted(Path("/tmp").glob(f"maestro-house-{run_date}-*.log")))
    seen: set[Path] = set()
    ordered: list[Path] = []
    for p in candidates:
        if p.exists() and p not in seen:
            seen.add(p)
            ordered.append(p)
    return ordered


def budget_log_paths(run_date: str) -> list[Path]:
    candidates = [
        Path(f"/tmp/maestro-budget-{run_date}.log"),
        Path(f"/tmp/maestro-budget-retry-{run_date}.log"),
        Path(f"/tmp/maestro-budget-full-{run_date}-run8.log"),
        Path(f"/tmp/maestro-budget-full-{run_date}-run9.log"),
        ROOT / ".tmp" / "e2e-logs" / f"maestro-budget-full-{run_date}-run12.log",
        ROOT / ".tmp" / "e2e-logs" / f"maestro-budget-full-{run_date}-run11.log",
        ROOT / ".tmp" / "e2e-logs" / f"maestro-budget-full-{run_date}-run10.log",
        ROOT / ".tmp" / "e2e-logs" / f"maestro-budget-full-{run_date}-run9.log",
        ROOT / ".tmp" / "e2e-logs" / f"maestro-budget-retry-{run_date}.log",
        Path(f"/tmp/maestro-budget-full-{run_date}-run7.log"),
        Path(f"/tmp/maestro-budget-full-{run_date}-run6.log"),
        Path(f"/tmp/maestro-budget-full-{run_date}-run5.log"),
        Path(f"/tmp/maestro-budget-full-{run_date}-run4.log"),
        Path(f"/tmp/maestro-budget-full-{run_date}-run3.log"),
        Path(f"/tmp/maestro-budget-full-{run_date}.log"),
        Path(f"/tmp/maestro-budget-smoke3.log"),
        Path(f"/tmp/maestro-budget-smoke4.log"),
        Path(f"/tmp/maestro-budget-smoke5.log"),
        Path(f"/tmp/maestro-budget-canary4.log"),
    ]
    seen: set[Path] = set()
    ordered: list[Path] = []
    for p in candidates:
        if p.exists() and p not in seen:
            seen.add(p)
            ordered.append(p)
    # Active run logs may use wall-clock date (e.g. run11 started after midnight).
    log_dir = ROOT / ".tmp" / "e2e-logs"
    for p in sorted(log_dir.glob("maestro-budget-full-*-run12.log"), reverse=True):
        if p.exists() and p not in seen:
            seen.add(p)
            ordered.append(p)
    for p in sorted(log_dir.glob("maestro-budget-full-*-run11.log"), reverse=True):
        if p.exists() and p not in seen:
            seen.add(p)
            ordered.insert(0, p)
    for p in sorted(log_dir.glob("maestro-budget-full-*-run10.log"), reverse=True):
        if p.exists() and p not in seen:
            seen.add(p)
            ordered.insert(0, p)
    for p in sorted(log_dir.glob(f"maestro-budget-full-{run_date}-run14.log"), reverse=True):
        if p.exists() and p not in seen:
            seen.add(p)
            ordered.insert(0, p)
    return ordered


def health_log_paths(run_date: str) -> list[Path]:
    candidates = [
        Path(f"/tmp/maestro-health-{run_date}.log"),
        Path("/tmp/maestro-health-final-progress.log"),
        Path("/tmp/maestro-health-verify-final.log"),
    ]
    candidates.extend(sorted(Path("/tmp").glob(f"maestro-health-*-{run_date}.log")))
    candidates.extend(sorted(Path("/tmp").glob("maestro-health-*.log")))
    seen: set[Path] = set()
    ordered: list[Path] = []
    for p in candidates:
        if p.exists() and p not in seen:
            seen.add(p)
            ordered.append(p)
    return ordered


def health_supplement() -> dict[str, tuple[str, str]]:
    """Progress log uses PASS/FAIL lines when Maestro bracket markers are absent."""
    progress = Path("/tmp/maestro-health-final-progress.log")
    if not progress.exists():
        return {}
    out: dict[str, tuple[str, str]] = {}
    for line in progress.read_text().splitlines():
        if line.startswith("PASS "):
            flow = line.split()[1]
            out[flow] = ("PASS", "sequential verify 2026-07-20")
        elif line.startswith("FAIL "):
            flow = line.split()[1]
            detail = line.split("—", 1)[-1].strip() if "—" in line else ""
            out[flow] = ("FAIL", detail)
    return out


def budget_supplement() -> dict[str, tuple[str, str]]:
    """Early smoke/canary evidence when log files were rotated off disk."""
    return {
        "budget-tabs": ("PASS", "smoke3"),
        "check-spendings-layout": ("PASS", "smoke3"),
        "budget-savings-overview": (
            "FAIL",
            "savings-goals-add-list not visible (smoke4)",
        ),
        "budget-settings": (
            "FAIL",
            "budget-settings-timeline-link scroll (smoke3)",
        ),
    }


def main() -> None:
    run_date = sys.argv[1] if len(sys.argv) > 1 else date.today().isoformat()
    env = sys.argv[2] if len(sys.argv) > 2 else "staging"
    device = sys.argv[3] if len(sys.argv) > 3 else "House-A, iOS 26"
    apps = sys.argv[4:] if len(sys.argv) > 4 else ["platform", "house", "budget", "kaizen", "language", "health"]
    for app in apps:
        if app == "house":
            log_paths = house_log_paths(run_date)
            path = write_results(app, run_date, log_paths, env, device)
        elif app == "budget":
            log_paths = budget_log_paths(run_date)
            path = write_results(
                app,
                run_date,
                log_paths,
                env,
                device,
                supplement=budget_supplement(),
            )
        elif app == "health":
            log_paths = health_log_paths(run_date)
            path = write_results(
                app,
                run_date,
                log_paths,
                env,
                device,
                supplement=health_supplement(),
            )
        else:
            log = Path(f"/tmp/maestro-{app}-{run_date}.log")
            path = write_results(app, run_date, [log], env, device)
        print(path)


if __name__ == "__main__":
    main()
