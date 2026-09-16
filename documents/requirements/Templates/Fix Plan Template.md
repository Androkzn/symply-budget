# [Fix Title] - Fix Plan

> Use for a bug fix or targeted correction. Use the Improvements template for multi-phase cleanup or architecture work.

| Field | Value |
|-------|-------|
| **Doc type** | Fix plan |
| **Area** | `FE / BE / FE+BE / Native / Docs` |
| **Owning app** | `[app id or _ecosystem]` |
| **Severity** | `critical / high / medium / low` |
| **Status** | `planned / in-progress / fixed / verified` |
| **Created** | `YYYY-MM-DD` |
| **Last updated** | `YYYY-MM-DD` |

---

## Agent Kickoff Prompt

```text
Read first:
1. AGENTS.md
2. documents/ecosystem/PROJECT.md
3. documents/ecosystem/SERVICES.md
4. documents/apps/<id>/README.md if app-specific

Create or update:
documents/requirements/<FeatureOrArea>/<Fix_Title>_FixPlan.md

Rules:
- Every root-cause claim must cite file:line or real log/output evidence.
- Do not guess. Mark unknowns as blockers.
- Respect secrets policy and shared user/data boundaries.
- Include verification and deployment actions when the fix changes behavior.
```

---

## 0. Version History

| Version | Date | Changes |
|---------|------|---------|
| v0.1 | YYYY-MM-DD | Initial fix plan |

---

## 1. Problem

### 1.1 Symptoms

- [Observable symptom]
- [Environment/scope]

### 1.2 Impact

| Dimension | Detail |
|-----------|--------|
| User-facing | [What users see or cannot do] |
| Frequency | [How often] |
| Data risk | [None / possible / confirmed] |
| Severity rationale | [Why severity is correct] |

---

## 2. Evidence And Root Cause

| Evidence | Source | Notes |
|----------|--------|-------|
| [Snippet/log/output] | `path:line` or command output | [Notes] |

Failure chain:

1. `[file:line]` - [trigger]
2. `[file:line]` - [failure point]
3. Result: [bug]

Unknowns / blockers:

- [ ] [Unknown that blocks safe implementation]

---

## 3. Affected Files

| File | Change | In scope |
|------|--------|----------|
| `path/to/file` | [Change] | yes/no |

Out of scope:

- [File/area and reason]

---

## 4. Fix Strategy

| Step | Change | Why it fixes the cause | Verification |
|------|--------|------------------------|--------------|
| 1 | [Change] | [Reason] | [Check] |

Security/privacy review required if the fix touches auth, access control, secrets, personal data, Health data, Soft Transfer, or AI provider credentials.

---

## 5. Verification

| Layer | Command / check |
|-------|-----------------|
| Unit | `[command]` |
| Integration | `[command]` |
| Manual smoke | `[steps]` |
| Regression scan | `[same-pattern search]` |
| AI-off | `[check if relevant]` |

---

## 6. Deployment / Rollback

| Change type | Action |
|-------------|--------|
| FE only | EAS update/build if shipping |
| Worker (shared) | `cd backend && npm run deploy:fleet` |
| Worker (House-only) | `cd backend && npm run deploy:house:all` (deprecated alias: `deploy:all`) |
| Worker (Language) | `cd backend-language && npm run deploy:language:all` |
| D1 schema | Apply migration to staging and production |
| Lambda | Deploy staging/prod if touched |
| Rollback | [Flag off / revert / deploy previous version] |

---

## 7. Acceptance

- [ ] Root cause has concrete evidence.
- [ ] Fix is scoped to affected files.
- [ ] Verification passes.
- [ ] Deploy/migration completed if required.
- [ ] Docs updated if behavior or contracts changed.
