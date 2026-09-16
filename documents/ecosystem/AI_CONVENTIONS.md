# AI conventions — Symply Ecosystem

> Applies to **Cursor**, **Claude Code**, and **Codex**. Canonical: root [AGENTS.md](../../AGENTS.md) · [CLAUDE.md](../../CLAUDE.md) · [CODEX.md](../../CODEX.md).

## Mandate: agents own E2E

Own the loop: **understand → implement → verify → deploy → update docs**.  
Do not leave “next steps for the developer” when you can run them. Human = product decisions + 2FA + billing + explicit commits.

## Read order

1. [`PROJECT.md`](./PROJECT.md) — project vs House + umbrella disk  
2. [`SERVICES.md`](./SERVICES.md) — secrets + deploy  
3. [`BRANCHING.md`](./BRANCHING.md) — trunk + `<app>-v2` clones; never deploy from a clone  
4. [`../INDEX.md`](../INDEX.md)  
5. [`FLEET.md`](./FLEET.md) + [`NAMING.md`](./NAMING.md)  
6. **App:** `apps/<id>/README.md` → BRD → TRD → `features/`  
7. Shared contracts → `apps/_ecosystem/`  
8. Template → `apps/symply-house/` + `brands/symply-house/`  
9. Donors → `apps/<id>/migration.md` under `~/Desktop/Symply Ecosystem/`

## Autonomy (rapid development)

| Do without asking | Stop / ask |
|-------------------|------------|
| Edit FE + BE + docs + brands | Force-push **any** branch; rebase; `git stash` |
| Test / typecheck / lint | Apple/Google 2FA |
| `deploy:fleet` / `deploy:house:all` from the **`main` checkout only** | Deploy from an `<app>-v2` clone |
| D1 migrate both envs; Lambda deploy | Print or commit secrets |
| EAS build / update / submit | Amplify CLI |
| Read donors for inventory | Implement inside donor repos / multi-root + donors |

```bash
eval "$(./scripts/secrets/export-env.sh)"
```

## Do / Don't

| Do | Don't |
|----|-------|
| Call the project **Symply Ecosystem** | Call the whole project “SimpleHouse” |
| Treat **Symply House** as template parent | Treat House as the only product forever |
| Open **only** this repo as the workspace | Multi-root Health + Language + Kaizen + platform |
| Ignore `_archive/` (legacy + samples) | Treat `_archive/simple-house-legacy-expo` as the app |
| Copy `brands/symply-house/` for new apps | Open legacy repos as platform roots |
| One app BRD + one app TRD | Feature catalogs inside app BRD/TRD |
| Gate domains with `brand.features` | Fork Login / Widget / Watch per brand |
| Update `migration.md` when donors move | Leave stale Desktop paths |
| Merge `main` daily on `<app>-v2`; land with `--merge` | Rebase, stash, force-push, squash-merge, or `deploy:fleet` from a clone |
