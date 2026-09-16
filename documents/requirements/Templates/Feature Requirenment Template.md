# [Feature Name] - Feature Requirement / BRD

> Copy this file into `documents/requirements/<Feature>/` for one feature-sized scope. Keep app-wide product positioning in `documents/apps/<id>/BRD.md`.

| Field | Value |
|-------|-------|
| **Doc type** | Feature BRD / requirement |
| **Feature id** | `[kebab-feature-id]` |
| **Owning app** | `[simple-house / simple-budget / kaizen / simple-language / simple-health / _ecosystem]` |
| **Status** | `draft / in-review / approved / shipped` |
| **Version** | `v0.1` |
| **Created** | `YYYY-MM-DD` |
| **Last updated** | `YYYY-MM-DD` |
| **App BRD** | `documents/apps/<id>/BRD.md` |
| **App TRD** | `documents/apps/<id>/TRD.md` |
| **Feature TRD** | `documents/requirements/<Feature>/<Feature>_TRD.md` |

---

## Agent Kickoff Prompt

```text
Read first:
1. AGENTS.md
2. documents/ecosystem/PROJECT.md
3. documents/ecosystem/NAMING.md
4. documents/ecosystem/RELATIONSHIPS.md
5. documents/apps/<id>/README.md
6. documents/apps/<id>/BRD.md
7. documents/apps/<id>/TRD.md

Create or update:
documents/requirements/<Feature>/<Feature>_BRD.md

Rules:
- Keep this feature-sized. Do not rewrite the app BRD/TRD here.
- Respect Shared User, Smart Engine, Soft Transfer consent, and AI-off paths.
- Do not define sibling-app scope unless this feature owns an explicit integration.
- Do not include secrets or deployment credentials.
```

---

## 0. Version History

| Version | Date | Changes |
|---------|------|---------|
| v0.1 | YYYY-MM-DD | Initial draft |

---

## 1. Overview

### 1.1 Summary

| Item | Value |
|------|-------|
| Feature name | `[Feature Name]` |
| Owning app | `[app id]` |
| Objective | `[What problem this solves and why it matters]` |
| Primary users | `[Personas]` |
| Success metrics | `[Observable product/user signals]` |

### 1.2 Fleet Placement

| Concern | Requirement |
|---------|-------------|
| Shared User | Reuse the same `user_id`; no new account system. |
| Brand system | Brand-specific UI through `brands/<id>/` and tokens. |
| Data sharing | Use Soft Transfer only with explicit consent. |
| AI | Core path must work with AI off unless explicitly approved. |

---

## 2. Scope

### 2.1 In Scope

- [Capability]
- [Capability]

### 2.2 Out Of Scope

- [Sibling-app product scope]
- [Implementation detail reserved for TRD/Implementation]

### 2.3 Dependencies

| Dependency | Type | Notes |
|------------|------|-------|
| `[dependency]` | app / backend / feature / external | [Notes] |

---

## 3. Requirements

| Req ID | Requirement | Priority | Notes |
|--------|-------------|----------|-------|
| BR-01 | [Requirement] | P0 | [Notes] |

---

## 4. UX And Content

| Surface | Requirement |
|---------|-------------|
| Entry point | [Tab/card/deep link/notification/etc.] |
| Empty state | [What users see with no data] |
| Error state | [Recoverable failure behavior] |
| Copy tone | [Domain-appropriate guidance] |
| Accessibility | [Dynamic Type, contrast, labels, non-color cues] |

Design references:

- [DesignSystem.md](../../design/DesignSystem.md)
- [UI_Rules_For_Chat_Generated_UI.md](../../design/UI_Rules_For_Chat_Generated_UI.md)

---

## 5. Data, Privacy, And Sharing

| Data | Owner | Requirement |
|------|-------|-------------|
| [Data class] | [App/platform] | [Read/write/retention/privacy rule] |

Privacy rules:

- [Rule]
- [Rule]

Soft Transfer packages:

| Package | From | To | Consent | Status |
|---------|------|----|---------|--------|
| `[package.v1]` | `[app]` | `[app]` | required | draft |

---

## 6. Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| [Risk] | [Impact] | [Mitigation] |

---

## 7. Open Questions

| # | Question | Owner | Status |
|---|----------|-------|--------|
| Q1 | [Question] | Product / engineering | open |

---

## 8. Acceptance

- [ ] Requirements are app-boundary safe.
- [ ] AI-off path is documented or explicitly waived.
- [ ] Data/privacy and Soft Transfer implications are clear.
- [ ] Feature TRD can be created without guessing product scope.
