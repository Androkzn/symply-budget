import React from 'react';
import { Text, View } from 'react-native';

import {
  getE2ELastVerifyResult,
  subscribeE2ELastVerifyResult,
} from '@api/e2eTestObservability';

/**
 * Dev-only, effectively invisible: makes the last
 * {scheme}://e2e-verify-network deep-link result assertable by Maestro
 * (assertVisible id=e2e-verify-badge, text starting with PASS/FAIL/NONE)
 * instead of being console-only. Renders nothing in Release builds.
 *
 * KNOWN LIMITATION: mounted once at the app root, so it's covered — and
 * dropped from the accessibility tree Maestro reads — whenever a React
 * Navigation *native* modal screen (e.g. TaskDetailScreen) is presented on
 * top of it. Do NOT "fix" this with RN's own <Modal>: that opens a real
 * native modal presentation (UIViewController.present under the hood),
 * which makes everything under it non-interactive at the OS level —
 * pointerEvents can't undo that — and since this component is mounted
 * unconditionally whenever __DEV__ is true, it would break touch input in
 * every dev build, not just Maestro runs (tried + reverted 2026-07-31, see
 * [[maestro-badge-modal-visibility-limitation]]). For flows that verify
 * actions taken on a modal-presented screen, don't assert this badge —
 * confirm via the [E2E-VERIFY] console line / generate-report.mjs instead.
 *
 * ANDROID: this badge is currently NEVER reachable via Maestro's UiAutomator-
 * read accessibility tree, root-level-sibling-vs-modal distinction aside.
 * Confirmed absent across 5 independent hierarchy dumps (2026-08-05) while
 * ~50 sibling testIDs on the same screen resolved fine — ruled out size,
 * collapsable, importantForAccessibility, and a View+accessibilityLabel
 * wrapper (all present below; none fixed it in isolation or combined).
 * Leading theory: react-native-screens' native per-screen surface on Android
 * composites above root-level siblings outside the navigator, the same
 * category as the modal limitation above but broader. Flows guard their
 * `extendedWaitUntil: visible: id: e2e-verify-badge` checks behind
 * `E2E_PLATFORM != 'android'` (see run-budget-suite-android.sh) rather than
 * asserting this on Android — the underlying network verification still
 * fires via the {scheme}://e2e-verify-network deep link either way. If you
 * find the real fix, remove those guards and this paragraph.
 */
export function E2EVerifyBadge() {
  const result = React.useSyncExternalStore(
    subscribeE2ELastVerifyResult,
    getE2ELastVerifyResult
  );

  if (!__DEV__) return null;

  const text =
    result == null ? 'NONE' : result.ok ? 'PASS' : `FAIL:${result.detail}`;

  return (
    <View
      testID="e2e-verify-badge"
      accessible
      accessibilityLabel={text}
      collapsable={false}
      importantForAccessibility="yes"
      style={{ position: 'absolute', top: 0, left: 0, width: 8, height: 8 }}
    >
      <Text style={{ fontSize: 1 }}>{text}</Text>
    </View>
  );
}
