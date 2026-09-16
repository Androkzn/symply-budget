# [Improvement Title] - Improvements Plan

> Use for multi-phase cleanup, architecture hardening, migration, or product polish that is broader than one bug fix.

| Field | Value |
|-------|-------|
| **Doc type** | Improvements plan |
| **Area** | `FE / BE / Native / Docs / Cross-platform` |
| **Owning app** | `[app id or _ecosystem]` |
| **Status** | `draft / approved / in-progress / complete` |
| **Created** | `YYYY-MM-DD` |
| **Last updated** | `YYYY-MM-DD` |

---

## Agent Kickoff Prompt

```text
Read first:
1. AGENTS.md
2. documents/ecosystem/PROJECT.md
3. documents/ecosystem/NAMING.md
4. documents/apps/<id>/README.md if app-specific

Create or update:
documents/requirements/<Area>/<Improvement_Title>_Plan.md

Rules:
- Keep scope explicit and phased.
- Do not mix unrelated refactors.
- Preserve Shared User, brand, Widget/Watch, and AI-off contracts.
- Include verification and deployment gates per phase.
```

---

## 0. Version History

| Version | Date | Changes |
|---------|------|---------|
| v0.1 | YYYY-MM-DD | Initial plan |

---

## 1. Objective

### 1.1 Summary

[What improves and why now.]

### 1.2 Success Criteria

| Outcome | Signal |
|---------|--------|
| [Outcome] | [Observable signal] |

---

## 2. Scope

### In Scope

- [Area]

### Out Of Scope

- [Area]

### Dependencies

| Dependency | Notes |
|------------|-------|
| [Dependency] | [Notes] |

---

## 3. Current State

| Area | Current behavior | Evidence |
|------|------------------|----------|
| [Area] | [Behavior] | `file:line` or doc link |

---

## 4. Target State

| Area | Target behavior |
|------|-----------------|
| [Area] | [Behavior] |

---

## 5. Phases

| Phase | Scope | Exit criteria | Verification |
|-------|-------|---------------|--------------|
| P1 | [Scope] | [Exit] | [Checks] |
| P2 | [Scope] | [Exit] | [Checks] |

---

## 6. Risk And Rollback

| Risk | Mitigation | Rollback |
|------|------------|----------|
| [Risk] | [Mitigation] | [Rollback] |

---

## 7. Verification And Deployment

| Change type | Required check |
|-------------|----------------|
| Brand/config | `npm run validate:brand` |
| FE code | Targeted Jest/E2E/manual smoke |
| Worker | `cd backend && npm run typecheck && npm test` where practical; deploy all if changed |
| D1 schema | Apply migrations to staging and production |
| Native | EAS build for affected brand/profile |

---

## 8. Docs Updates

| Doc | Update needed |
|-----|---------------|
| App BRD/TRD | [yes/no] |
| Feature index | [yes/no] |
| FLEET / MIGRATION / RELATIONSHIPS | [yes/no] |
| Engineering docs | [yes/no] |

---

## 9. Acceptance

- [ ] Scope is phased and bounded.
- [ ] Shared ecosystem contracts are preserved.
- [ ] Verification gates are explicit.
- [ ] Deployment/migration plan is clear.
- [ ] Docs updates are listed.
