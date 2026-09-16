#!/usr/bin/env bash
# Merge origin/main into every sibling clone of this workspace.
#
# Why this exists
# ---------------
# The fleet lives in four checkouts of one repo (main + <app>-v2 clients), and
# each one has to pick up main regularly. Doing that by hand is fine until
# `ios/Podfile.lock` conflicts, which it does almost every round for a reason
# that has nothing to do with anybody's work:
#
#   hermes-engine's podspec puts an ABSOLUTE path in user_target_xcconfig —
#     HERMES_CLI_PATH => <checkout>/node_modules/hermes-compiler/.../hermesc
#   computed with `require.resolve`, which resolves symlinks. Four checkouts sit
#   at four real paths, so each `pod install` produces a different podspec JSON
#   and therefore a different SPEC CHECKSUM for hermes-engine. glog moves with
#   it when the React-from-source toggle flips.
#
# So the SAME dependencies yield different checksum lines per clone, forever.
# That is noise, and this script resolves it by taking main's version — but ONLY
# when the conflict is confined to those checksum lines. Anything else (a real
# pod added or removed, a version bump) stops the run and is left for a human,
# because silently resolving a genuine dependency conflict is how a clone ends
# up building something nobody chose.
#
# Usage:
#   ./scripts/git/sync-clones.sh            # merge origin/main into every clone
#   ./scripts/git/sync-clones.sh --dry-run  # report what would happen
set -euo pipefail

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
UMBRELLA="$(dirname "$ROOT")"
LOCK="ios/Podfile.lock"

# Only these keys may differ for an auto-resolve. Both are machine/checkout
# artifacts, not dependency decisions.
COSMETIC_KEYS='^[+-]  (glog|hermes-engine): '

say() { printf '%s\n' "$*"; }

# Every checkout of THIS repo under the umbrella dir.
# Built with a plain loop, not `mapfile`: macOS ships bash 3.2, where mapfile
# does not exist and the script would die on line 1 of real work.
CLONES=()
for d in "$UMBRELLA"/*/; do
  [[ -d "$d/.git" ]] || continue
  url="$(git -C "$d" remote get-url origin 2>/dev/null || true)"
  [[ "$url" == *symply-ecosystem* ]] || continue
  CLONES+=("${d%/}")
done

if [[ ${#CLONES[@]} -eq 0 ]]; then
  say "No clones of symply-ecosystem found under $UMBRELLA"
  exit 1
fi

ok=0; skipped=0; failed=0

for clone in "${CLONES[@]}"; do
  name="$(basename "$clone")"
  branch="$(git -C "$clone" rev-parse --abbrev-ref HEAD)"
  dirty="$(git -C "$clone" status --porcelain | wc -l | tr -d ' ')"

  say ""
  say "── $name [$branch]"

  # A dirty clone is somebody's in-flight work (or the auto-commit harness
  # mid-write). Merging under it is how work gets lost — leave it alone; its
  # next sync picks main up anyway.
  if [[ "$dirty" != "0" ]]; then
    say "   SKIP — $dirty uncommitted change(s); not merging under live work"
    skipped=$((skipped + 1))
    continue
  fi

  git -C "$clone" fetch origin --quiet

  behind="$(git -C "$clone" rev-list --count HEAD..origin/main)"
  if [[ "$behind" == "0" ]]; then
    say "   up to date"
    ok=$((ok + 1))
    continue
  fi

  if [[ "$DRY_RUN" == "1" ]]; then
    say "   would merge origin/main ($behind commit(s) behind)"
    ok=$((ok + 1))
    continue
  fi

  if git -C "$clone" merge origin/main --no-edit >/dev/null 2>&1; then
    say "   merged origin/main ($behind commit(s))"
    ok=$((ok + 1))
    continue
  fi

  # Conflict. The only one we know how to settle is the lock-file checksum noise.
  conflicts="$(git -C "$clone" diff --name-only --diff-filter=U)"
  if [[ "$conflicts" != "$LOCK" ]]; then
    say "   CONFLICT in files this script will not touch:"
    printf '     %s\n' $conflicts
    say "   Left mid-merge for you to resolve (git -C \"$clone\" merge --abort to back out)."
    failed=$((failed + 1))
    continue
  fi

  # Confirm the ONLY difference is the cosmetic checksum lines before taking main's.
  real_changes="$(
    git -C "$clone" diff HEAD origin/main -- "$LOCK" |
      grep -E '^[+-][^+-]' | grep -Ev "$COSMETIC_KEYS" | wc -l | tr -d ' '
  )"
  if [[ "$real_changes" != "0" ]]; then
    say "   CONFLICT in $LOCK with $real_changes real dependency line(s) — NOT auto-resolving."
    say "   Resolve by hand, then re-run pod install in that clone."
    failed=$((failed + 1))
    continue
  fi

  git -C "$clone" checkout origin/main -- "$LOCK"
  git -C "$clone" add "$LOCK"
  git -C "$clone" commit --no-edit >/dev/null
  say "   merged origin/main; took main's $LOCK (checksum noise only)"
  say "   → run pod install in this clone before its next native build"
  ok=$((ok + 1))
done

say ""
say "sync-clones: $ok ok, $skipped skipped, $failed need attention"
[[ "$failed" == "0" ]]
