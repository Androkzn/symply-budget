# How to Run the App

## The Problem

You're getting module map errors in Xcode because:
- Xcode tries to build the app before Expo modules are built
- Module maps are generated during the build process
- Xcode can't find them if they don't exist yet

## Solution: Use Command Line Build

**Don't build directly in Xcode** - use the command line instead:

```bash
cd /Users/andreitekhtelev/Desktop/simple-house
npm run ios
```

This will:
1. ✅ Build all Expo modules first (generates module maps)
2. ✅ Build the main app
3. ✅ Launch the simulator automatically
4. ✅ Connect to Metro bundler

## Alternative: Build in Xcode (After Command Line Build)

If you want to use Xcode:

1. **First, build once via command line:**
   ```bash
   npm run ios
   ```
   (Wait for it to complete, then stop it)

2. **Then open Xcode:**
   ```bash
   open ios/SimpleHouse.xcworkspace
   ```

3. **In Xcode:**
   - Select simulator (iPhone 17 Pro Max)
   - Product → Build (Cmd+B)
   - Product → Run (Cmd+R)

## Why Command Line Works

The `npm run ios` command (which runs `expo run:ios`) handles the build order correctly:
- Builds Expo modules first
- Generates all module maps
- Then builds your app
- Everything is in the right order

## Quick Start

Just run:
```bash
npm run ios
```

Wait 3-5 minutes for the first build, then the app will launch automatically!
