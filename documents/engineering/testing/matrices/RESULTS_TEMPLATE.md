# Fleet Acceptance Results — Template

| Field | Value |
|-------|-------|
| **Doc type** | Dated scoring copy (Circle V2 style) |
| **App / scope** | `<platform \| house \| budget \| kaizen \| language \| health>` |
| **Run date** | `YYYY-MM-DD` |
| **Environment** | `staging` (default) \| `production` (release only) |
| **Runner** | |
| **Device / OS** | e.g. iPhone 16 Simulator, iOS 26 |
| **Matrix source** | Link to owning matrix file (e.g. [budget.md](./budget.md)) |
| **Strategy** | [FLEET_TEST_STRATEGY.md](../FLEET_TEST_STRATEGY.md) |

---

## How to use

1. Copy this file to `RESULTS_YYYY-MM-DD_<app>.md` before a scored run.
2. Execute rows on a **real simulator** and/or API harness — do not mark Pass from code reading alone.
3. Check **Pass**, **Fail**, or **N/A** only after an observed run.
4. Use **N/A** + **Notes** when blocked (missing harness, deferred IMP, account topology unavailable).
5. Link Maestro artifact paths or CI job URLs in **Notes** when useful.

---

## Summary

| Metric | Count |
|--------|------:|
| Total rows | |
| Pass | |
| Fail | |
| N/A | |
| Pass rate (excl. N/A) | |

**Blockers / follow-ups:**

- 

---

## Results

| ID | Description | Steps | Expected | Layer | Automation | Pass | Fail | N/A | Notes |
|----|-------------|-------|----------|-------|------------|:----:|:----:|:---:|-------|
| `<PREFIX>-<SECTION>-001` | | | | | | ☐ | ☐ | ☐ | |
| `<PREFIX>-<SECTION>-002` | | | | | | ☐ | ☐ | ☐ | |

*(Copy rows from the owning matrix file; add Pass / Fail / N/A columns only in RESULTS copies.)*

---

## Sign-off

| Role | Name | Date |
|------|------|------|
| Executed by | | |
| Reviewed by | | |
