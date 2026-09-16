#!/usr/bin/env bash
# Idempotent ios/ patches needed for Xcode 26 archive (survives prepare-xcode git checkout).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PF="$ROOT/ios/Podfile"
AD="$ROOT/ios/SymplyEcosystem/AppDelegate.swift"

if [[ -f "$PF" ]] && ! grep -q "INTERNAL_IMPORTS_BY_DEFAULT" "$PF"; then
  python3 - "$PF" << 'PY'
import sys
from pathlib import Path
p = Path(sys.argv[1])
text = p.read_text()
needle = "          cfg.build_settings['ENABLE_DEBUG_DYLIB'] = 'NO'"
insert = """          cfg.build_settings['SWIFT_UPCOMING_FEATURE_INTERNAL_IMPORTS_BY_DEFAULT'] = 'YES'
          cfg.build_settings['ENABLE_DEBUG_DYLIB'] = 'NO'"""
if needle in text:
    p.write_text(text.replace(needle, insert, 1))
PY
fi

if [[ -f "$AD" ]]; then
  sed -i '' '/bindReactNativeFactory/d' "$AD" 2>/dev/null || true
  sed -i '' 's/^import Expo$/internal import Expo/' "$AD" 2>/dev/null || true
  sed -i '' 's/^public class AppDelegate:/class AppDelegate:/' "$AD" 2>/dev/null || true
  sed -i '' 's/public override func/override func/g' "$AD" 2>/dev/null || true
fi

# EXConstants: direct script path (not bash -l -c) — expo-constants patch may apply via patch-package;
# re-apply on Pods project after pod install if a fix script exists.
FIX="$ROOT/scripts/ios/fix-exconstants-shell-script.sh"
if [[ -x "$FIX" ]]; then
  "$FIX" || true
fi

./scripts/ios/fix-rn-bundle-shell-script.sh

