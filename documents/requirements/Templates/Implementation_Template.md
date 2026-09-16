# [Feature Name] - Implementation Plan

> Execution handoff from approved feature TRD to code. This document can include file-level plans and agent prompts. It must not redefine product scope or technical contracts from the BRD/TRD.

| Field | Value |
|-------|-------|
| **Doc type** | Feature implementation plan |
| **Feature id** | `[kebab-feature-id]` |
| **Owning app** | `[app id]` |
| **Status** | `draft / ready / in-progress / shipped` |
| **Version** | `v0.1` |
| **Created** | `YYYY-MM-DD` |
| **Last updated** | `YYYY-MM-DD` |
| **BRD** | `documents/requirements/<Feature>/<Feature>_BRD.md` |
| **TRD** | `documents/requirements/<Feature>/<Feature>_TRD.md` |

---

## Agent Kickoff Prompt

```text
Read first:
1. AGENTS.md
2. documents/apps/<id>/README.md
3. documents/apps/<id>/BRD.md
4. documents/apps/<id>/TRD.md
5. documents/requirements/<Feature>/<Feature>_BRD.md
6. documents/requirements/<Feature>/<Feature>_TRD.md

Create or update:
documents/requirements/<Feature>/<Feature>_Implementation.md

Rules:
- Do not redefine BRD/TRD scope. Log conflicts as blockers.
- Use repo paths and existing patterns.
- Plan verification and deployment; do not hand routine commands back to the human.
- Do not include secrets.
```

---

## 0. Version History

| Version | Date | Changes |
|---------|------|---------|
| v0.1 | YYYY-MM-DD | Initial plan |

---

## 1. Readiness Gate

| Gate | Status | Notes |
|------|--------|-------|
| BRD approved or accepted for build | [ ] | |
| TRD complete enough to implement | [ ] | |
| Open HIGH blockers resolved | [ ] | |
| Data/privacy concerns reviewed | [ ] | |
| Feature flag / rollout path known | [ ] | |

---

## 2. Non-Goals

- [Non-goal copied from BRD/TRD]
- [Non-goal]

---

## 3. File Plan

| File / module | Change | Owner | Notes |
|---------------|--------|-------|-------|
| `src/...` | [Change] | FE | [Notes] |
| `backend/src/...` | [Change] | BE | [Notes] |
| `backend/migrations/...` | [Change] | BE | [Notes] |
| `documents/...` | [Change] | Docs | [Notes] |

---

## 4. Phases

### Phase 1 - [Name]

Scope:

- [Task]

Acceptance:

- [ ] [Check]

Verification:

```bash
[targeted command]
```

### Phase 2 - [Name]

Scope:

- [Task]

Acceptance:

- [ ] [Check]

Verification:

```bash
[targeted command]
```

---

## 5. Data And Migration Plan

| Item | Plan |
|------|------|
| Schema change | `[none / migration name]` |
| Backfill | `[none / plan]` |
| Remote migration | staging and production if schema changed |
| Rollback | [Plan] |

---

## 6. QA Plan

| Layer | Command / check |
|-------|-----------------|
| Brand validation | `npm run validate:brand` |
| FE unit | `[targeted jest command]` |
| E2E | `[relevant e2e script or manual smoke]` |
| BE typecheck | `cd backend && npm run typecheck` |
| BE tests | `cd backend && npm test` |
| AI-off | [Manual/automated check] |

---

## 7. Deployment Plan

| Change type | Required action |
|-------------|-----------------|
| Frontend JS only | EAS update if shipping OTA |
| Native config/assets | EAS build for affected brand |
| Worker behavior (shared) | `cd backend && npm run deploy:fleet` |
| Worker behavior (House-only) | `cd backend && npm run deploy:house:all` (deprecated alias: `deploy:all`) |
| Worker behavior (Language) | `cd backend-language && npm run deploy:language:all` |
| D1 schema | Apply migrations to staging and production |
| Lambda processor | Deploy staging/prod scripts if touched |

---

## 8. Open Gaps

| # | Gap | Severity | Owner | Status |
|---|-----|----------|-------|--------|
| G1 | [Gap] | high / medium / low | [Owner] | open |

---

## 9. Completion Checklist

- [ ] Code implemented in Symply Ecosystem repo only.
- [ ] Relevant tests/typecheck/lint pass.
- [ ] Backend deployed staging and production if changed.
- [ ] D1 migrations applied to both envs if schema changed.
- [ ] Docs/fleet/migration indexes updated if scope or identity changed.
- [ ] No secrets printed or committed.
