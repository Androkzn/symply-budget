# [Feature Name] - Technical Requirements Document

> Feature-level technical contract. Keep app positioning in `documents/apps/<id>/TRD.md` and file-by-file build sequencing in the Implementation document.

| Field | Value |
|-------|-------|
| **Doc type** | Feature TRD |
| **Feature id** | `[kebab-feature-id]` |
| **Owning app** | `[app id]` |
| **Status** | `draft / in-review / approved / shipped` |
| **Version** | `v0.1` |
| **Created** | `YYYY-MM-DD` |
| **Last updated** | `YYYY-MM-DD` |
| **Feature BRD** | `documents/requirements/<Feature>/<Feature>_BRD.md` |
| **Implementation** | `documents/requirements/<Feature>/<Feature>_Implementation.md` |

---

## Agent Kickoff Prompt

```text
Read first:
1. AGENTS.md
2. documents/apps/<id>/README.md
3. documents/apps/<id>/BRD.md
4. documents/apps/<id>/TRD.md
5. documents/requirements/<Feature>/<Feature>_BRD.md

Create or update:
documents/requirements/<Feature>/<Feature>_TRD.md

Rules:
- Extract BRD requirements before technical synthesis.
- Do not guess missing contracts. Add blockers in Open Questions.
- Keep implementation file paths and task sequencing for the Implementation doc.
- Respect Shared User, brand gates, AI-off behavior, and Soft Transfer consent.
```

---

## 0. Version History

| Version | Date | Changes |
|---------|------|---------|
| v0.1 | YYYY-MM-DD | Initial draft |

---

## 1. Requirement Inventory

| BRD Req ID | Summary | In Scope | Technical Contract Needed | Notes |
|------------|---------|----------|---------------------------|-------|
| BR-01 | [Summary] | Y/N | [State/API/schema/UI/etc.] | [Notes] |

---

## 2. Architecture And Ownership

| Concern | Owner / Path | Contract |
|---------|--------------|----------|
| Mobile UI | `src/features/<domain>/` or `src/screens/...` | [Contract] |
| Mobile state | `src/stores/...` | [Contract] |
| API client | `src/api/...` | [Contract] |
| Worker route/service | `backend/src/routes/...`, `backend/src/services/...` | [Contract] |
| Schema | `backend/migrations/...` | [Contract] |
| Shared platform | `_ecosystem` | [Shared User / Smart Engine / AI gate] |

---

## 3. Feature Gates And Entitlements

| Gate | Source | Default | Contract |
|------|--------|---------|----------|
| `[featureFlag]` | `src/config/features.ts` / backend registry | `[true/false]` | [Behavior] |
| `[brand.features key]` | `brands/<id>/brand.cjs` | `[value]` | [Behavior] |
| `[entitlement]` | Shared User / subscription | `[value]` | [Behavior] |

---

## 4. Data Model

| Entity / table | Owner | Fields | Notes |
|----------------|-------|--------|-------|
| [Entity] | [App/platform] | [Fields] | [Notes] |

Migration requirements:

- [ ] No schema change.
- [ ] D1 migration required: `[migration name]`.
- [ ] Backfill required: `[yes/no]`.

---

## 5. API Contract

| Endpoint / method | Auth | Request | Response | Errors |
|-------------------|------|---------|----------|--------|
| `[METHOD /path]` | `[required]` | `[schema]` | `[schema]` | `[error contract]` |

Offline/local behavior:

- [Behavior]

---

## 6. State And UX Behavior

| State | Trigger | User-visible behavior | Recovery |
|-------|---------|-----------------------|----------|
| Empty | [Trigger] | [UI] | [Recovery] |
| Loading | [Trigger] | [UI] | [Recovery] |
| Error | [Trigger] | [UI] | [Recovery] |
| AI off | [Trigger] | [UI] | Manual path |

---

## 7. Security, Privacy, And Consent

- Auth boundary:
- Data scoping:
- Secret handling:
- Logging restrictions:
- Soft Transfer / consent:
- Sensitive-data rules:

---

## 8. Observability

| Signal | Source | Purpose |
|--------|--------|---------|
| [Log/metric/event] | [FE/BE] | [Purpose] |

---

## 9. Testing Strategy

| Layer | Tests |
|-------|-------|
| Unit | [Stores/services/utils] |
| Integration | [API/Worker flow] |
| E2E | [Maestro flow or manual smoke] |
| AI-off | [Manual/automated check] |
| Migration | [D1 local/remote check] |

---

## 10. Rollout And Deployment

| Item | Contract |
|------|----------|
| Feature flag | `[flag or none]` |
| Backend deploy | Shared Worker: `cd backend && npm run deploy:fleet`; House-only: `deploy:house:all` (deprecated alias: `deploy:all`); per-brand: `deploy:<brand>:all`; Language: `deploy:language:all` (not in `deploy:fleet`) |
| D1 migrations | staging and production if schema changes |
| EAS update/build | `[profile/channel]` if app release needed |
| Rollback | [Disable flag / revert version / migration plan] |

---

## 11. Open Questions / Blockers

| # | Question | Severity | Owner | Status |
|---|----------|----------|-------|--------|
| T1 | [Question] | high / medium / low | [Owner] | open |

---

## 12. Acceptance

- [ ] Every in-scope BRD requirement maps to a technical contract.
- [ ] Shared User, brand, and Soft Transfer rules are respected.
- [ ] AI-off path is covered.
- [ ] Testing and rollout gates are explicit.
- [ ] Implementation doc can be created without guessing.
