# [App Display Name] - Business Requirements Document

> **App-level document only.** Feature detail belongs in [features/README.md](./features/README.md) and the linked requirement docs.

| Field | Value |
|-------|-------|
| **Doc type** | App BRD |
| **App id** | `[brand-id]` |
| **Display name** | `Symply [Product]` |
| **Role** | `parent / template` or `child` |
| **Parent platform** | `_ecosystem` |
| **Template parent** | `simple-house` |
| **Status** | `draft / in-progress / approved` |
| **Version** | `v0.1` |
| **Created** | `YYYY-MM-DD` |
| **Last updated** | `YYYY-MM-DD` |
| **TRD** | [TRD.md](./TRD.md) |
| **Feature index** | [features/README.md](./features/README.md) |

---

## 0. Version History

| Version | Date | Changes |
|---------|------|---------|
| v0.1 | YYYY-MM-DD | Initial app BRD |

---

## 1. Purpose

### 1.1 One-Liner

[One sentence: what this app is for.]

### 1.2 Problem

[Who hurts today, what is scattered or broken, and why this app should exist.]

### 1.3 Product Promise

- [Promise 1]
- [Promise 2]
- [Promise 3]

### 1.4 Success Metrics

| Outcome | Signal |
|---------|--------|
| [Outcome] | [Observable product/user signal] |

---

## 2. Fleet Placement

| Item | Value |
|------|-------|
| Project | Symply Ecosystem |
| App role | `[parent/template/child]` |
| Brand id | `[brand-id]` |
| Sibling apps | Symply House, Symply Budget, Symply Kaizen, Symply Language, Symply Health |
| Shared login | Required: same `user_id` across fleet |
| Shared contracts | `_ecosystem` owns Shared User, Smart Engine, Soft Transfer, and shared AI entitlement direction |
| Data sharing | `[none / opt-in packages / TBD]`; never silent cross-app reads |

---

## 3. Personas And Jobs

| Persona | Job-to-be-done |
|---------|----------------|
| [Persona] | [Job] |

---

## 4. Scope

### 4.1 In Scope

- [App-owned capability theme]
- [App-owned capability theme]

### 4.2 Out Of Scope

- Shared auth rewrite.
- Forked Widget/Watch/Login/Drive flows.
- Product scope owned by a sibling app.
- Implementation inside donor repos or `_archive/`.

### 4.3 Dependencies

| Dependency | Why it matters |
|------------|----------------|
| `_ecosystem` Shared User | Single account and entitlement model |
| `brands/<id>/` | Build-time identity, tokens, tabs, integrations |
| [Sibling app or platform feature] | [Dependency] |

---

## 5. Product Surfaces

| Surface | Priority | Requirement |
|---------|----------|-------------|
| iOS app | P0 | Expo brand build unless explicitly native-only during migration. |
| Android app | P1 | Same platform contract unless product decides otherwise. |
| Widget | P? | Shared companion when enabled by brand. |
| Watch | P? | Shared companion when enabled by brand. |
| Backend Worker | P0 | Shared API and app domain services. |
| Web | Not v1 / TBD | [Decision] |

---

## 6. Functional Themes

Detailed feature requirements stay in feature docs.

| Theme id | Theme | Priority | Notes |
|----------|-------|----------|-------|
| T-1 | [Theme] | P0 | [Notes] |

---

## 7. Data And Sharing

| Data class | App stance |
|------------|------------|
| Auth/profile | Shared User contract from `_ecosystem`; no app-specific account fork. |
| App domain data | Owned by this app's domain module and Worker tables/routes. |
| AI data | AI features use entitlement/provider gates; core flows must not require AI. |
| Cross-app sharing | Only through Smart Engine / Soft Transfer packages with explicit consent. |
| Sensitive data | Deny by default unless this BRD and `_ecosystem` explicitly allow it. |

---

## 8. Constraints

- One platform repo: implement in Symply Ecosystem.
- One app BRD and one app TRD.
- AI optional unless product explicitly approves AI-only scope.
- No secrets in docs, commits, or chat.
- Keep technical ids stable unless release/store strategy explicitly changes.

---

## 9. Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| [Risk] | [Impact] | [Mitigation] |

---

## 10. Open Questions

| # | Question | Owner | Status |
|---|----------|-------|--------|
| Q1 | [Question] | Product / engineering | open |

---

## 11. Acceptance

- [ ] App is positioned correctly in Symply Ecosystem.
- [ ] Shared User / Smart Engine contracts are referenced, not redefined.
- [ ] Feature detail is linked from the feature index, not expanded here.
- [ ] Product confirms sibling-app boundaries.
- [ ] TRD remains aligned with this BRD.
