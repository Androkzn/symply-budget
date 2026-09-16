#!/bin/bash
set -e

echo "🍎 TestFlight Deployment for SymplyEcosystem"
echo "=========================================="
echo ""

# Check if EAS CLI is installed
if ! command -v eas &> /dev/null; then
    echo "❌ EAS CLI not found. Installing..."
    npm install -g eas-cli
fi

echo "✓ EAS CLI installed"
echo ""

# Check if logged in
if ! eas whoami &> /dev/null; then
    echo "🔐 Please login to Expo:"
    eas login
fi

EXPO_USER=$(eas whoami 2>/dev/null || echo "Not logged in")
echo "✓ Logged in as: $EXPO_USER"
echo ""

# Check app.json for version
if [ -f "app.json" ]; then
    VERSION=$(grep -o '"version": "[^"]*' app.json | cut -d'"' -f4)
    BUILD_NUMBER=$(grep -o '"buildNumber": "[^"]*' app.json | cut -d'"' -f4 || echo "1")
    echo "📦 Current version: $VERSION (Build $BUILD_NUMBER)"
else
    echo "⚠️  app.json not found"
    VERSION="unknown"
fi

echo ""
echo "🚀 Starting TestFlight build..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Ask user for confirmation
echo "This will:"
echo "  1. Build iOS app for TestFlight"
echo "  2. Upload to Expo servers (10-20 minutes)"
echo "  3. Optionally submit to App Store Connect"
echo ""
read -p "Continue? (y/N): " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Cancelled"
    exit 1
fi

echo ""
echo "Building..."
echo ""

# Build for TestFlight
eas build --profile testflight --platform ios

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Build complete!"
echo ""
echo "Next steps:"
echo "  1. Go to App Store Connect → TestFlight"
echo "  2. Add testers to your build"
echo "  3. Add 'What to Test' notes"
echo "  4. Distribute to test groups"
echo ""
echo "View builds: eas build:list"
echo "Submit manually: eas submit --platform ios --latest"
echo ""
echo "📖 Full guide: TESTFLIGHT-DEPLOYMENT.md"
