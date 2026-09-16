#!/bin/bash
# Echo an absolute Node binary that satisfies package.json engines (>=20).
# Xcode Run Script phases use a minimal PATH and often pick /usr/local/bin/node
# (v18), which Expo/metro reject (`Array.prototype.toReversed` is Node 20+).
set -euo pipefail
for n in \
  /opt/homebrew/opt/node@22/bin/node \
  /opt/homebrew/bin/node \
  /usr/local/opt/node@22/bin/node \
  "${NODE_BINARY:-}" \
  "$(command -v node 2>/dev/null || true)"; do
  if [ -n "${n:-}" ] && [ -x "$n" ]; then
    maj="$("$n" -p 'parseInt(process.versions.node, 10)' 2>/dev/null || echo 0)"
    if [ "$maj" -ge 20 ]; then
      echo "$n"
      exit 0
    fi
  fi
done
echo "error: need Node >= 20 for Xcode bundle scripts (found: $(command -v node 2>/dev/null || echo none))" >&2
exit 1
