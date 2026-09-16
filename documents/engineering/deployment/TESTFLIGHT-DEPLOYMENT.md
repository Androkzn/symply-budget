# TestFlight Deployment Guide

Complete guide to deploy your SimpleHouse app to TestFlight for iOS testing.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Initial Setup](#initial-setup)
3. [Build for TestFlight](#build-for-testflight)
4. [Submit to TestFlight](#submit-to-testflight)
5. [Testing](#testing)
6. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### 1. Apple Developer Account
- Enrolled in Apple Developer Program ($99/year)
- Access to App Store Connect
- Developer certificate and provisioning profiles

### 2. Required Tools
```bash
# Install/Update EAS CLI
npm install -g eas-cli

# Login to Expo
eas login

# Verify installation
eas --version
```

### 3. App Store Connect Setup
1. Go to [App Store Connect](https://appstoreconnect.apple.com)
2. Create a new app (if not exists):
   - Click "+" → "New App"
   - Platform: iOS
   - Name: SimpleHouse
   - Primary Language: English
   - Bundle ID: `fox-family.simple-house` (from app.json)
   - SKU: `simple-house-001` (or any unique identifier)

---

## Initial Setup

### Step 1: Configure EAS

Your `eas.json` has been created. Update it with your Apple credentials:

```json
{
  "submit": {
    "production": {
      "ios": {
        "appleId": "YOUR_APPLE_ID@example.com",
        "ascAppId": "YOUR_APP_STORE_CONNECT_APP_ID",
        "appleTeamId": "YOUR_TEAM_ID"
      }
    }
  }
}
```

**Find your details:**
- **Apple ID**: Your Apple Developer account email
- **ASC App ID**: Found in App Store Connect → App → App Information
- **Team ID**: Found in [Apple Developer](https://developer.apple.com/account) → Membership

### Step 2: Update app.json (if needed)

Ensure your app.json has proper iOS configuration:

```json
{
  "expo": {
    "name": "SimpleHouse",
    "slug": "simple-house",
    "version": "1.0.0",
    "ios": {
      "bundleIdentifier": "fox-family.simple-house",
      "buildNumber": "1",
      "supportsTablet": true
    }
  }
}
```

### Step 3: Configure App Store Connect

1. **Create App Store Connect API Key** (recommended for automation):
   - Go to App Store Connect → Users and Access → Keys
   - Click "+" to create new key
   - Name: "EAS CLI"
   - Access: App Manager
   - Download the `.p8` key file
   - Note the Key ID and Issuer ID

2. **Save API Key for EAS**:
```bash
# Using API Key (recommended)
eas credentials

# Or use your Apple ID credentials (easier for first time)
# EAS will prompt for credentials during build
```

---

## Build for TestFlight

### Quick Build (Recommended)

```bash
# Build for TestFlight
cd /Users/andreitekhtelev/Desktop/SimpleHouseApp
eas build --profile testflight --platform ios
```

This will:
1. Create iOS build configuration
2. Upload to Expo servers
3. Build the app
4. Generate `.ipa` file
5. Optionally submit to TestFlight

### Step-by-Step Build

**1. Start the build:**
```bash
eas build --profile testflight --platform ios
```

**2. EAS will prompt for:**
- Apple ID credentials (if not configured)
- Push notification credentials
- App signing configuration

**3. Monitor build:**
```bash
# Check build status
eas build:list

# View build logs
eas build:view
```

**4. Build takes 10-20 minutes**
- You'll receive a link to monitor progress
- Notification when complete

---

## Submit to TestFlight

### Option 1: Automatic Submission (During Build)

When running the build, EAS will ask:
```
? Would you like to submit to App Store Connect after build? (Y/n)
```

Choose **Yes** to automatically submit to TestFlight.

### Option 2: Manual Submission (After Build)

```bash
# Submit specific build to TestFlight
eas submit --platform ios --latest

# Or specify build ID
eas submit --platform ios --id YOUR_BUILD_ID
```

### Option 3: Using App Store Connect

1. Download `.ipa` from EAS build page
2. Upload using [Transporter app](https://apps.apple.com/app/transporter/id1450874784)
3. Go to App Store Connect → TestFlight
4. Select uploaded build
5. Add compliance information
6. Distribute to testers

---

## Testing

### Add Testers

**Internal Testers (up to 100):**
1. App Store Connect → TestFlight → Internal Testing
2. Add users from your team
3. They receive instant access

**External Testers (up to 10,000):**
1. App Store Connect → TestFlight → External Testing
2. Create test group
3. Add testers by email
4. Submit for Beta App Review (1-2 days)

### Distribute Build

1. Go to TestFlight tab in App Store Connect
2. Select your build
3. Add "What to Test" notes
4. Enable for test groups
5. Testers receive notification via email

### Test the App

Testers install TestFlight app:
1. Download [TestFlight](https://apps.apple.com/app/testflight/id899247664)
2. Accept invite email
3. Install SimpleHouse from TestFlight
4. Provide feedback

---

## Complete Workflow

### Initial Deployment (First Time)

```bash
# 1. Install EAS CLI
npm install -g eas-cli

# 2. Login to Expo
eas login

# 3. Configure project
cd /Users/andreitekhtelev/Desktop/SimpleHouseApp
eas build:configure

# 4. Build and submit to TestFlight
eas build --profile testflight --platform ios --auto-submit

# 5. Wait for build (10-20 minutes)
# 6. Check App Store Connect → TestFlight
# 7. Add testers
# 8. Distribute build
```

### Regular Updates

```bash
# 1. Update version in app.json
# "version": "1.0.1"
# "ios": { "buildNumber": "2" }

# 2. Build and submit
cd /Users/andreitekhtelev/Desktop/SimpleHouseApp
eas build --profile testflight --platform ios --auto-submit

# 3. Testers get notified of new build
```

---

## Build Profiles Explained

Your `eas.json` has different profiles:

### `development`
- For local development
- Includes dev client
- Can run on simulator

### `preview`
- Internal testing
- Release configuration
- Doesn't go to App Store

### `testflight`
- Beta testing via TestFlight
- Production configuration
- Distributed through TestFlight

### `production`
- App Store submission
- Final production build

---

## Environment Variables

If your app uses environment variables:

**1. Create `.env` files:**
```bash
# .env.production
API_URL=https://api.simplehouse.app
ENVIRONMENT=production

# .env.testflight
API_URL=https://staging-api.simplehouse.app
ENVIRONMENT=testflight
```

**2. Update eas.json:**
```json
{
  "build": {
    "testflight": {
      "env": {
        "API_URL": "https://staging-api.simplehouse.app",
        "ENVIRONMENT": "testflight"
      }
    }
  }
}
```

**3. Use in app:**
```javascript
import Constants from 'expo-constants';

const apiUrl = Constants.expoConfig.extra.API_URL;
```

---

## Troubleshooting

### Build Fails

**Error: "No valid code signing identity"**
```bash
# Clear credentials and reconfigure
eas credentials
# Select: iOS App Store Credentials
# Remove all credentials
# Run build again - EAS will regenerate
```

**Error: "Bundle identifier is not available"**
- Change bundle ID in app.json
- Or create app in App Store Connect first

**Error: "Build took too long"**
- Check build logs for errors
- May need to optimize package size
- Remove unused dependencies

### Submission Fails

**Error: "Missing compliance information"**
1. App Store Connect → TestFlight → Build
2. Answer export compliance questions
3. Usually select "No" for encryption

**Error: "Invalid provisioning profile"**
```bash
# Regenerate profiles
eas credentials
# Select: iOS Distribution Certificate
# Regenerate
```

### App Crashes on TestFlight

```bash
# View crash logs
eas build:view --platform ios

# Enable better error reporting
# Add Sentry or similar in your app
```

---

## Best Practices

### Versioning

Follow semantic versioning:
```json
{
  "version": "1.0.0",  // Major.Minor.Patch
  "ios": {
    "buildNumber": "1"  // Increment with each build
  }
}
```

### Release Notes

Always provide "What to Test":
```
Version 1.0.1 (Build 2)

New Features:
- Added PDF report uploading
- Improved image analysis

Bug Fixes:
- Fixed crash on iOS 15
- Corrected login flow

Known Issues:
- Camera permission prompt appears twice
```

### Testing Checklist

Before distributing to testers:
- [ ] Test on actual device (not just simulator)
- [ ] Verify all API endpoints work
- [ ] Check permissions (camera, photos, etc.)
- [ ] Test offline functionality
- [ ] Verify Apple Sign In works
- [ ] Check tablet/iPad layout
- [ ] Test dark mode (if supported)

### Automated Deployments

**GitHub Actions Example:**

```yaml
name: Deploy to TestFlight

on:
  push:
    branches: [testflight]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - uses: actions/setup-node@v2
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm ci

      - name: Install EAS CLI
        run: npm install -g eas-cli

      - name: Build and Submit
        run: |
          eas build --profile testflight --platform ios --non-interactive --auto-submit
        env:
          EXPO_TOKEN: ${{ secrets.EXPO_TOKEN }}
```

---

## Quick Commands Reference

```bash
# Login to Expo
eas login

# Build for TestFlight
eas build --profile testflight --platform ios

# Build and auto-submit
eas build --profile testflight --platform ios --auto-submit

# Submit existing build
eas submit --platform ios --latest

# Check build status
eas build:list

# View build details
eas build:view BUILD_ID

# Configure credentials
eas credentials

# Update project configuration
eas build:configure

# View all commands
eas --help
```

---

## Additional Resources

- [Expo EAS Build Docs](https://docs.expo.dev/build/introduction/)
- [TestFlight Docs](https://developer.apple.com/testflight/)
- [App Store Connect](https://appstoreconnect.apple.com)
- [Expo Forums](https://forums.expo.dev/)

---

## Summary

### First Time Setup (30-60 minutes)
1. Install EAS CLI
2. Configure Apple Developer account
3. Create app in App Store Connect
4. Configure eas.json with credentials
5. Run first build

### Regular Deployments (15-30 minutes)
1. Update version/build number
2. Run `eas build --profile testflight --platform ios --auto-submit`
3. Wait for build
4. Distribute to testers

**Next build is usually faster as credentials are cached!**

---

**Last Updated:** 2026-01-28
**Your app:** SimpleHouse (fox-family.simple-house)
