#!/usr/bin/env bash
# Run Apple Watch unit and UI tests on the watchOS simulator.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IOS_DIR="$ROOT/ios"
PROJECT="$IOS_DIR/SymplyEcosystem.xcodeproj"
SCHEME="SymplyEcosystemWatchApp Watch App"

WATCH_DEVICE_NAME="${WATCH_DEVICE_NAME:-SymplyEcosystem Watch Test}"
WATCH_RUNTIME="${WATCH_RUNTIME:-com.apple.CoreSimulator.SimRuntime.watchOS-26-5}"
WATCH_DEVICE_TYPE="${WATCH_DEVICE_TYPE:-com.apple.CoreSimulator.SimDeviceType.Apple-Watch-Series-11-46mm}"
IPHONE_DEVICE_NAME="${IPHONE_DEVICE_NAME:-iPhone 17}"

find_device_id() {
  xcrun simctl list devices available | rg "$1" | head -1 | rg -o '[A-F0-9-]{36}'
}

WATCH_ID="$(find_device_id "$WATCH_DEVICE_NAME" || true)"
if [[ -z "$WATCH_ID" ]]; then
  WATCH_ID="$(xcrun simctl create "$WATCH_DEVICE_NAME" "$WATCH_DEVICE_TYPE" "$WATCH_RUNTIME")"
fi

IPHONE_ID="$(find_device_id "$IPHONE_DEVICE_NAME" || true)"
if [[ -z "$IPHONE_ID" ]]; then
  echo "No iPhone simulator named '$IPHONE_DEVICE_NAME' found." >&2
  exit 1
fi

xcrun simctl boot "$IPHONE_ID" 2>/dev/null || true
xcrun simctl boot "$WATCH_ID" 2>/dev/null || true
xcrun simctl pair "$WATCH_ID" "$IPHONE_ID" 2>/dev/null || true

DESTINATION="platform=watchOS Simulator,id=$WATCH_ID"

cd "$IOS_DIR"

echo "Building Watch app and tests..."
xcodebuild build-for-testing \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -destination "$DESTINATION" \
  -quiet

echo "Running unit tests..."
xcodebuild test-without-building \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -destination "$DESTINATION" \
  -only-testing:"SymplyEcosystemWatchApp Watch AppTests" \
  -parallel-testing-enabled NO

echo "Running UI tests..."
xcodebuild test-without-building \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -destination "$DESTINATION" \
  -only-testing:"SymplyEcosystemWatchApp Watch AppUITests" \
  -parallel-testing-enabled NO

echo "All Watch tests passed."
