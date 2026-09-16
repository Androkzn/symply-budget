# Branching — Symply Ecosystem

> Canonical git model for this repo. Agent rule: [`.cursor/rules/branching.mdc`](../../.cursor/rules/branching.mdc) · agent entry: [AGENTS.md](../../AGENTS.md) · deploy: [SERVICES.md](./SERVICES.md).

The generic answer would be “trunk-based with short-lived branches.” That is mostly right here, but three constraints change the details, and they are the ones that bite:

1. **One Worker codebase → four production Workers.** `deploy:fleet` ships whatever branch you are standing on to House, Budget, Kaizen, and Health at once. (Language is a separate Worker: `deploy:language:all`.)
2. **An auto-commit harness commits and pushes on its own.** It has already done so many times in a single day.
3. **The branches never finish.** `house-v2` is not a feature branch that merges and dies — it is a months-long programme.

## The model: trunk + long-running client branches

```text
main ──●────●────●────●────●────●──►   always green · ONLY deploy source
        ↘   ↗     ↘   ↗      ↘
      house-v2  health-v2  budget-v2   client-only · one per clone · never die
```

| Branch | Role |
|--------|------|
| `main` | Integration + the **single deploy source**. Always green. |
| `<app>-v2` | Long-running client programme for that app. Lives in **one clone**. Never dies. Carries only that app’s client code. |

Current programmes: `house-v2`, `budget-v2`, `health-v2`. New long-running app work uses the same `<app>-v2` name, one clone each.

Do **not** open a parallel `feat/<app>-v2-*` stack for the same programme. The stale `feat/house-v2-local-first` and `feat/budget-v2-local-first` branches on origin are what that mistake leaves behind.

## The one rule that prevents most pain

**Shared code goes to `main` behind a flag. App-only code goes to the branch.**

| Path | Where it lives |
|------|----------------|
| `backend/**`, `packages/local-first/**`, `wrangler*.toml`, `backend/migrations/**` | `main`, always — flagged off if unfinished |
| `src/features/<app>/**`, that app’s screens, its Proxy blocks | its `<app>-v2` branch |

This is why House H0 went to `main` gated off rather than sitting on `house-v2`. Backend on a branch means every deploy from `main` silently reverts it.

## Daily loop, per clone

```bash
git merge main                    # pull down — DAILY, not weekly
# ...work...
git push origin house-v2          # (or budget-v2 / health-v2)
```

Long-running branches drift fast here because `main` moves constantly — several commits can land on it in a single afternoon. Daily `git merge main` is the difference between a two-minute merge and a 400-file conflict.

## Landing to `main`

Never resolve conflicts on `main`. Merge `main` into **your** branch and fix it there. `main` stays deployable at every commit.

```bash
git merge main                    # 1. resolve conflicts on YOUR branch
npm test && npm run typecheck     # 2. verify the merged result
git push origin house-v2
gh pr create --base main --head house-v2
gh pr merge --merge               # 3. --merge, NOT --squash
```

Then in the **`main` checkout**: `git pull`, and if backend changed, `deploy:fleet`.

`--merge`, never `--squash`. These branches keep living after they land. A squash rewrites the history `main` saw, so the branch’s next merge re-conflicts with everything it already contributed.

## Hard rules (each learned the expensive way)

| Rule | Why |
|------|-----|
| **Merge, never rebase** | The harness auto-pushes. Rebasing rewrites commits it already published → divergence, or a force-push that eats work. |
| **Never `git stash`** | It has swept concurrent WIP repeatedly. Recovering it is luck, not a process. |
| **Never deploy from a clone** | One codebase, four Workers. Only the `main` checkout may run `deploy:fleet` / `deploy:*:all`. |
| **Never force-push** | Concurrent sessions are writing to these branches. |
| **Merge `main` daily** | A client branch is already behind after one afternoon. |
| **Keep `pull.rebase` false** | See below — this one is silent. |

Cursor / Claude / Codex agents still commit **only when the user asks**. The auto-commit harness is a separate writer. Do not rebase, stash, or force-push around it.

### `pull.rebase` — the silent one

"Merge, never rebase" is not enough on its own, because a plain `git pull` can *be* a rebase. This machine had `pull.rebase = true` set **globally**, so `git pull origin house-v2` began rewriting `house-v2` — discarding a merge commit and replaying `main`'s commits linearly — with no rebase ever typed. It was caught mid-flight and aborted with `git rebase --abort`; the merge commit came back intact.

Check every clone, not just the one that bit you:

```bash
git config --global pull.rebase false          # the fix
git config --get pull.rebase                   # per clone: must print false
```

A local `false` in one clone does not protect the others. Set it globally.

## Migrations are a shared resource

Migrations are **append-only** and land on `main` first. Two branches inventing the next number simultaneously is a genuine collision — the number is shared. Claim it on `main` before you build against it.

See [SERVICES.md](./SERVICES.md) for migrate-both-envs and `deploy:fleet`.
