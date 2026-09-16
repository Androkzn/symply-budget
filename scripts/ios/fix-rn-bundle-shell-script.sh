#!/usr/bin/env bash
# Quote RN bundle script paths so Archive works when the repo path contains spaces.
# Also skip the Sentry wrapper (/bin/sh -c unquoted path) — use react-native-xcode.sh directly.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PBX="$ROOT/ios/SymplyEcosystem.xcodeproj/project.pbxproj"
[[ -f "$PBX" ]] || exit 0
python3 - "$PBX" << 'PY'
import re
import sys
from pathlib import Path

p = Path(sys.argv[1])
text = p.read_text()

# Replace the tail of the Bundle RN script: resolve RN xcode script and run it quoted.
# Match either old backtick form or previous SENTRY_/REACT_NATIVE_ vars form.
patterns = [
    (
        re.compile(
            r'/bin/sh `\\"\$NODE_BINARY\\" --print \\"require\(\'path\'\)\.dirname\(require\.resolve\(\'@sentry/react-native/package\.json\'\)\) \+ \'/scripts/sentry-xcode\.sh\'\\"` `\\"\$NODE_BINARY\\" --print \\"require\(\'path\'\)\.dirname\(require\.resolve\(\'react-native/package\.json\'\)\) \+ \'/scripts/react-native-xcode\.sh\'\\"`\\n\\n";',
            re.M,
        ),
        None,
    ),
]

replacement_tail = (
    'REACT_NATIVE_XCODE_SCRIPT=$(\\"$NODE_BINARY\\" --print \\"require(\'path\').dirname(require.resolve(\'react-native/package.json\')) + \'/scripts/react-native-xcode.sh\'\\")\\n'
    '/bin/sh \\"$REACT_NATIVE_XCODE_SCRIPT\\"\\n\\n";'
)

# Prefer replacing an existing SENTRY_XCODE_SCRIPT block if present.
old_block = (
    'SENTRY_XCODE_SCRIPT=$(\\"$NODE_BINARY\\" --print \\"require(\'path\').dirname(require.resolve(\'@sentry/react-native/package.json\')) + \'/scripts/sentry-xcode.sh\'\\")\\n'
    'REACT_NATIVE_XCODE_SCRIPT=$(\\"$NODE_BINARY\\" --print \\"require(\'path\').dirname(require.resolve(\'react-native/package.json\')) + \'/scripts/react-native-xcode.sh\'\\")\\n'
    '/bin/sh \\"$SENTRY_XCODE_SCRIPT\\" \\"$REACT_NATIVE_XCODE_SCRIPT\\"\\n\\n";'
)
if old_block in text:
    text = text.replace(old_block, replacement_tail, 1)
    print("replaced Sentry+RN block with RN-only quoted invoke")
elif replacement_tail in text:
    print("RN-only quoted invoke already present")
else:
    # Fallback: find end of Bundle script and rewrite last /bin/sh line heuristically
    marker = 'Bundle React Native code and images'
    if marker not in text:
        print("Bundle phase not found")
        sys.exit(0)
    # last resort: replace any unquoted sentry+rn backticks near export:embed
    text2, n = re.subn(
        r'/bin/sh `\\"[^`]+sentry-xcode\.sh[^`]+` `\\"[^`]+react-native-xcode\.sh[^`]+`\\n\\n";',
        replacement_tail,
        text,
        count=1,
    )
    if n:
        text = text2
        print(f"regex-replaced backtick invoke ({n})")
    else:
        print("WARN: could not locate bundle invoke to patch")
        sys.exit(0)

text = text.replace('export PROJECT_ROOT=\\"$PROJECT_DIR\\"/..', 'export PROJECT_ROOT=\\"$PROJECT_DIR/..\\"', 1)

# Quote Sentry debug-files upload script
old_dbg = 'shellScript = "/bin/sh ../node_modules/@sentry/react-native/scripts/sentry-xcode-debug-files.sh";'
new_dbg = 'shellScript = "/bin/sh \\"${SRCROOT}/../node_modules/@sentry/react-native/scripts/sentry-xcode-debug-files.sh\\"";'
if old_dbg in text:
    text = text.replace(old_dbg, new_dbg, 1)
    print("quoted sentry debug-files script")

p.write_text(text)
print("ok", p)
PY
