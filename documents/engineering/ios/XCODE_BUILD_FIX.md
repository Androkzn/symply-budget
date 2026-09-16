# Xcode Build Fix - Module Map Errors

## Problem
Xcode shows errors about missing module map files for Expo modules:
- `EXApplication.modulemap not found`
- `EXConstants.modulemap not found`
- `ExpoImagePicker.modulemap not found`
- etc.

## Solution Applied

1. ✅ Cleaned DerivedData: `~/Library/Developer/Xcode/DerivedData/SimpleHouse-*`
2. ✅ Cleaned iOS build files: `ios/build`, `ios/Pods`, `ios/Podfile.lock`
3. ✅ Cleaned caches: `node_modules/.cache`, `.expo`
4. ✅ Deintegrated and reinstalled pods
5. ✅ Cleaned Xcode build

## Next Steps

### Option 1: Build via Command Line (Recommended)
```bash
cd /Users/andreitekhtelev/Desktop/simple-house
npm run ios
```

This will:
- Build all Expo modules properly
- Generate module maps
- Launch the simulator

### Option 2: Build in Xcode

1. **Open Xcode:**
   ```bash
   open ios/SimpleHouse.xcworkspace
   ```

2. **In Xcode:**
   - Select a simulator (e.g., iPhone 17 Pro Max)
   - Product → Clean Build Folder (Shift+Cmd+K)
   - Product → Build (Cmd+B)
   - Wait for build to complete
   - Product → Run (Cmd+R)

3. **If errors persist:**
   - Close Xcode
   - Run: `cd ios && pod install && cd ..`
   - Reopen Xcode
   - Clean Build Folder again
   - Build again

## Why This Happens

The module map files are generated during the build process. If the build cache is corrupted or incomplete, Xcode can't find them. A clean rebuild regenerates all module maps.

## Verification

After a successful build, you should see:
- No module map errors
- App launches in simulator
- Avatar upload works correctly
