# Agent permissions — how Claude Code runs unprompted here

How this repo is configured so agents execute Terminal commands without a
permission prompt on every call, what the guardrails are, and how to carry the
setup to another project.

Companion rules: root [CLAUDE.md](../../CLAUDE.md) §1 (autonomy) ·
[.claude/README.md](../../.claude/README.md)

## The mechanism in one line

Both the global and the project settings set
`permissions.defaultMode: "bypassPermissions"`. That — not the `allow` list — is
what removes the prompts. The `allow` list is the portable *policy*: it is what
would apply if bypass mode were ever turned off, and it is the part worth copying
to a new project.

## The three files

| File | Scope | Git | What it carries |
|------|-------|-----|-----------------|
| `~/.claude/settings.json` | every project on this Mac | not in any repo | `bypassPermissions`, `skipDangerousModePermissionPrompt`, `additionalDirectories`, `effortLevel` |
| [`.claude/settings.json`](../../.claude/settings.json) | this repo | **committed** | `bypassPermissions`, the `allow` list, path scoping |
| `~/.claude/settings.local.json` | this repo, this machine | globally gitignored | personal one-offs (`git add`, `git commit -q -m`) |

Load order is user → project → local; later overrides earlier.

**There is currently no `deny` list and no hooks in any source.** That is a
deliberate choice — see [Optional hardening](#optional-hardening-not-currently-applied)
for what a deny list would buy and cost.

### Global — `~/.claude/settings.json`

- `permissions.defaultMode: "bypassPermissions"` — no prompt for any tool call.
- `skipDangerousModePermissionPrompt: true` — suppresses the "are you sure?"
  banner when entering bypass mode.
- `permissions.additionalDirectories` — lets agents work **outside** the repo
  root: `/tmp`, Xcode `DerivedData`, the SwiftPM cache, the Android SDK,
  `~/Downloads`, `~/.claude`. Needed for iOS builds, sim runs, and disk cleanup.
- `permissions.allow` — coarse tool names plus MCP tools.

  ⚠️ This array accumulates junk. Every one-time "yes, allow this" click appends
  the *literal command string*, so it grows entries like a specific `awk` format
  string or a `bash /private/tmp/claude-501/.../rc-watch.sh` from a dead session.
  Those are worthless and should never be copied to another machine. Prune
  periodically.

### Project — `.claude/settings.json` (the one that travels)

- `defaultMode: "bypassPermissions"` — so the repo works the same on a machine
  whose global settings are stricter.
- `allow` — ~60 explicit command prefixes: read-only tools (`grep`, `rg`, `jq`,
  `find`…), file mutation (`rm`, `mv`, `chmod`), process control (`pkill`), and
  the toolchain that actually matters here — `git`, `gh`,
  `npm`/`npx`/`node`/`yarn`/`pnpm`/`bun`, `tsc`/`tsx`, `wrangler`, `eas`,
  `expo`, `aws`, `security` (Keychain), `sentry-cli`,
  `xcodebuild`/`xcrun`/`swift`, `pod`/`bundle`.

  A `Bash(*)` catch-all sits at the **top** of this list, so under any mode the
  60 entries below it are redundant. They are kept as documentation of the
  intended toolchain and as the policy that would apply if both `Bash(*)` and
  bypass mode were removed.
- **Path scoping** — `Read` across the whole `Symply Ecosystem/` umbrella so the
  Swift/RN donor trees are readable; `Edit`/`Write` **only** inside
  `Simply Ecosystem/`. Donors are read-only by construction, matching the
  umbrella-disk rule in [PROJECT.md](../ecosystem/PROJECT.md).
## What actually restrains destructive actions

Nothing in the harness. The guardrails are the prose rules in
[CLAUDE.md](../../CLAUDE.md) §1 ("Still ask / stop": force-push, rebase, `git stash`,
deploy from a client clone, destructive git resets, Apple/Google 2FA, new paid cloud accounts, Amplify CLI)
plus the `Edit`/`Write` path scoping above.

Those are **model-obeyed conventions, not enforcement.** Under
`bypassPermissions` with `Bash(*)`, an agent can technically run
`git push --force`, `rm -rf`, or a production `wrangler d1 execute --command
"DROP TABLE …"` without a prompt. The setup trades enforcement for velocity —
which is the correct trade for this project's E2E-ownership mandate, but it
should be a known trade rather than a surprise.

Recovery, not prevention, is the safety net here: work is committed to git
frequently, and the donor trees are read-only by path scoping.

## Optional hardening (not currently applied)

A `permissions.deny` array is the only part of settings the harness *enforces*.
`deny` beats `allow` in every source **and overrides `bypassPermissions`** —
verified by probe, not assumed. It refuses outright; it never prompts, so it
costs nothing in interactivity.

A minimal set, if this is ever wanted — deliberately limited to the
unrecoverable cases:

```jsonc
"deny": [
  "Bash(git push --force:*)",
  "Bash(git push -f:*)",
  "Bash(git reset --hard:*)",
  "Bash(git clean -fd:*)",
  "Bash(git filter-branch:*)",
  "Bash(rm -rf /:*)",
  "Bash(rm -rf ~:*)",
  "Bash(amplify:*)",                                  // CLAUDE.md §1 forbids it
  "Read(//<umbrella>/**/.env.local)",                 // secrets hygiene
  "Read(//<umbrella>/**/credentials/**)"
]
```

**Deploys must stay allowed.** `wrangler`, `eas`, `deploy:fleet`,
`db:migrate:remote --env production`, and the Lambda scripts are all mandated by
CLAUDE.md §1 — denying them would contradict the project's operating model.

Avoid denying `git branch -D` or `git checkout --`: deleting a merged branch and
reverting one file are routine, and blocking them creates friction without
preventing anything unrecoverable.

### Known limits of a deny list

Even applied, `deny` is a speed bump, not a sandbox. Three honest gaps:

1. **Prefix matching is literal.** `Bash(git push --force:*)` does not match
   `git push origin main --force` (flag last) or `--force-with-lease`. Argument
   reordering evades it.
2. **`Read(...)` rules do not govern Bash.** `cat .env.local` is a `Bash` call
   and bypasses the `Read` deny entries entirely. Those entries stop the *Read
   tool*, which is the common path, not every path.
3. **Destructive SQL is not covered.** A `wrangler d1 execute --command "DROP
   TABLE …"` against production is allowed, because `wrangler` must stay allowed
   for deploys. Migrations remain immutable-once-applied by convention only.

So a deny list would cover the blunt catastrophic cases only; CLAUDE.md's
stop-conditions would still carry everything else either way.

## Porting to another project

1. Copy [`templates/claude-settings.template.json`](./templates/claude-settings.template.json)
   to the new repo as `.claude/settings.json`.
2. Replace every `<REPO_ROOT>` / `<READONLY_SIBLING>` placeholder with absolute
   paths. Permission path rules do **not** expand `~`.
3. Trim the `allow` toolchain block to what that project actually uses — an
   allowlist naming tools the project does not have is noise that hides the real
   policy.
4. Decide on the template's `deny` block: keep it, or delete it to match this
   repo, which runs without one.
5. Copy the CLAUDE.md §1 "Allowed without asking / Still ask" section too. Bypass
   mode without stated stop-conditions is the half of the setup that bites.
6. Do **not** copy `~/.claude/settings.json` verbatim — it is machine-local and
   carries the accumulated one-off junk described above.

`.claude/settings.local.json` is gitignored globally via
`~/.config/git/ignore`; a new repo inherits that automatically on this machine
but needs its own `.gitignore` entry elsewhere.

## Verifying a change

```sh
jq -e '.permissions.defaultMode' .claude/settings.json   # valid JSON + mode intact
```

A malformed `settings.json` **silently disables every setting in that file** — it
does not error loudly, it just stops applying. Always re-validate with `jq` after
editing.

If a `deny` list is ever added, confirm a rule actually fires by running a
harmless denied command (e.g. `git clean -fd --dry-run`) and checking that the
tool call is refused rather than executed.
