---
description: Land work from an <app>-v2 client clone onto main and propagate it to the other clones. Runs the preflight (path routing, divergence, dirty clones, concurrent writers), the PR with --merge, the per-clone merge, and the deploy-or-skip decision. Use when asked to "land this", "merge to main", "apply this to all clones", "propagate this change", "ship these docs", or after finishing work on a client branch.
---

<!-- fix-skill: v 1 -->
<!-- Do not place anything above the frontmatter — Claude Code's skill loader reads the `description` for auto-invocation. -->

Take committed work on an `<app>-v2` branch and land it on `main`, then get it into every other clone — without violating the hard git rules.

**Input:** $ARGUMENTS (optional — a branch name, or nothing to use the current branch)

**Rules are not repeated here.** Canonical: [documents/ecosystem/BRANCHING.md](../../documents/ecosystem/BRANCHING.md).
Read it if any step below is ambiguous. This file is the *procedure*; that file is the *law*.
If the two ever disagree, BRANCHING.md wins and this file is the bug.

---

## Step 0 — Route the change (do this before anything else)

**The single most consequential decision.** Getting it wrong is silent: backend
on a client branch is reverted by the next `deploy:fleet` from `main`, and shared
docs on a client branch leave the other clones reading stale material.

```sh
git diff --name-only origin/main...HEAD | sed 's|/.*||' | sort -u
```

| Changed paths | Destination |
|---|---|
| `backend/**`, `packages/**`, `wrangler*.toml`, `backend/migrations/**` | **`main`** — flagged off if unfinished |
| `documents/**`, `.claude/**`, `.cursor/**`, root `*.md`, `scripts/**` | **`main`** — shared; every clone reads these |
| `src/features/<app>/**`, that app's screens, its Proxy blocks | stays on **`<app>-v2`** |

Mixed diff → land it; the shared half must not linger on the branch.
App-only diff → **stop**, nothing to do, just `git push origin <app>-v2`.

## Step 1 — Preflight

Run all of it before touching anything. Report what you find; do not silently proceed past a failure.

```sh
git fetch origin --quiet

# a. Am I behind main? (BRANCHING.md: resolve conflicts on YOUR branch, never on main)
git rev-list --left-right --count origin/main...HEAD

# b. Working tree clean? Uncommitted work must be committed first — NEVER stash.
git status --porcelain

# c. The silent one: a plain `git pull` under pull.rebase=true rewrites the branch.
git config --get pull.rebase   # must print false, in EVERY clone
```

- **Behind main → `git merge main` on this branch first**, resolve here, then verify
  (`npm test`, `npm run typecheck` — skip for docs-only diffs; say that you skipped and why).
- **Dirty tree → commit it.** Never `git stash`; it has swept concurrent WIP repeatedly.
- **`pull.rebase` not false → fix globally** (`git config --global pull.rebase false`) and
  re-check each clone; a local `false` in one clone does not protect the others.

## Step 2 — Land on `main`

```sh
git push origin <branch>
gh pr create --base main --head <branch> --title "<type>: <summary>"
gh pr merge --merge          # --merge, NEVER --squash
```

`--squash` rewrites the history `main` saw. These branches keep living after they land, so
the next merge re-conflicts with everything the branch already contributed.

## Step 3 — Propagate

The main checkout first, then the client clones. Clones sharing this remote:

```sh
cd "$(git rev-parse --show-toplevel)/.."     # the umbrella dir
for d in */; do
  [ -d "$d/.git" ] || continue
  case "$(git -C "$d" remote get-url origin)" in
    *symply-ecosystem*) printf '%-28s %s | %s dirty\n' "$d" \
      "$(git -C "$d" rev-parse --abbrev-ref HEAD)" \
      "$(git -C "$d" status --porcelain | wc -l | tr -d ' ')" ;;
  esac
done
```

Expect four: `Simply Ecosystem` (main), `-budget`, `-health`, `-house`.
`Simply Health` / `Simply Language` / `Simply Kaizen` are **separate donor repos** — never touch them here.

```sh
git -C "../Simply Ecosystem" pull            # main checkout
git -C "../Simply Ecosystem-house"  merge origin/main
git -C "../Simply Ecosystem-health" merge origin/main
```

**Check before merging into a clone:**

- **Dirty clone → leave it alone** and say so. Its next daily `git merge main` picks the change up;
  merging under someone's WIP is how work gets lost.
- **The auto-commit harness is a concurrent writer** on these branches. If a session is mid-flight
  on a clone, sequence after it settles rather than merging underneath it.

Propagation is a convenience, not a requirement — client branches merge `main` daily anyway.
Doing it explicitly only buys *sooner*.

## Step 4 — Deploy gate

| Diff touched | Action |
|---|---|
| `backend/**`, `wrangler*.toml`, `packages/local-first/**` | Deploy — **from the `Simply Ecosystem` (main) checkout only** |
| `backend/migrations/**` | Migrate **both** envs, staging **and** production |
| docs / `.claude` / app client code only | **No deploy.** Say so explicitly and stop |

```sh
# main checkout ONLY — one codebase ships four Workers
eval "$(./scripts/secrets/export-env.sh)"
cd backend && npm run deploy:fleet
```

Never run this from an `<app>-v2` clone.

---

## Report back

State plainly: what routed where, the PR number, which clones took the merge, which were
skipped and why, and whether a deploy was needed. If you skipped tests, say that too.
