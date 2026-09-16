# Apple Watch Extension Setup Guide

This guide walks you through the manual Xcode configuration steps needed to complete the Apple Watch extension integration.

## ✅ Completed (All Source Code Created)

All Swift and TypeScript source files have been created:
- ✅ Shared models (SharedTask, SharedSubtask, AppGroup)
- ✅ iOS WatchConnectivityService
- ✅ React Native bridge (WatchBridge.swift/m)
- ✅ Watch connectivity manager
- ✅ Watch API client
- ✅ Watch UI views (TaskList, TaskDetail, VoiceInput, etc.)
- ✅ Voice recording service
- ✅ Notification controllers
- ✅ Complications provider
- ✅ Entitlements files
- ✅ Info.plist files

## 📋 Manual Steps Required

### Step 1: Open Xcode Project

```bash
cd /Users/andreitekhtelev/Desktop/SimpleHouse
open ios/SimpleHouse.xcworkspace
```

**Important:** Open `.xcworkspace`, not `.xcodeproj` (since you're using CocoaPods)

### Step 2: Add Watch App Target

1. In Xcode, select the `SimpleHouse` project in the navigator (blue icon at top)
2. At the bottom of the targets list, click the **+** button
3. Search for "Watch App" template
4. Select **Watch App** (not "Watch App for iOS App")
5. Click **Next**
6. Configure the watch app:
   - **Product Name:** `SimpleHouseWatch`
   - **Bundle Identifier:** `fox-family.simple-house.watchkitapp`
   - **Language:** Swift
   - **Interface:** SwiftUI
   - **Deployment Target:** watchOS 9.0 or later
7. Click **Finish**
8. When prompted "Activate scheme?", click **Activate**

This will create two new targets:
- `SimpleHouseWatch` (Watch App)
- `SimpleHouseWatch Extension` (Watch Extension)

### Step 3: Add Shared Files to Targets

**3.1 Add Shared Utility Files**

1. In Xcode's Project Navigator (left sidebar), right-click on the `SimpleHouse` folder
2. Select **Add Files to "SimpleHouse"...**
3. Navigate to `ios/Shared/Utilities/`
4. Select `AppGroup.swift`
5. **IMPORTANT:** In the "Add to targets" section:
   - ✅ Check `SimpleHouse` (iOS app)
   - ✅ Check `SimpleHouseWatch Extension`
   - ❌ Uncheck `SimpleHouseWatch` (Watch App doesn't need it)
6. Click **Add**

**3.2 Add Shared Model Files**

Repeat the above process for:
- `ios/Shared/Models/SharedTask.swift` → Add to `SimpleHouse` + `SimpleHouseWatch Extension`
- `ios/Shared/Models/SharedSubtask.swift` → Add to `SimpleHouse` + `SimpleHouseWatch Extension`

**3.3 Add iOS-Specific Files**

Add these files to **only** the `SimpleHouse` target:
- `ios/SimpleHouse/Services/WatchConnectivityService.swift` → `SimpleHouse` only
- `ios/SimpleHouse/WatchBridge.swift` → `SimpleHouse` only
- `ios/SimpleHouse/WatchBridge.m` → `SimpleHouse` only

**3.4 Add Watch App Files**

Add these files to **only** the `SimpleHouseWatch Extension` target:

**Services:**
- `ios/SimpleHouseWatch/Services/WatchConnectivityManager.swift`
- `ios/SimpleHouseWatch/Services/WatchAPIClient.swift`
- `ios/SimpleHouseWatch/Services/WatchVoiceService.swift`

**Views:**
- `ios/SimpleHouseWatch/Views/TaskListView.swift`
- `ios/SimpleHouseWatch/Views/TaskDetailView.swift`
- `ios/SimpleHouseWatch/Views/TaskRowView.swift`
- `ios/SimpleHouseWatch/Views/TaskCompletionSheet.swift`
- `ios/SimpleHouseWatch/Views/VoiceInputView.swift`

**App Entry:**
- `ios/SimpleHouseWatch/SimpleHouseWatchApp.swift`

**Complications:**
- `ios/SimpleHouseWatch/Complications/TaskCountProvider.swift`

**3.5 Add Watch Extension Files**

Add these files to **only** the `SimpleHouseWatch Extension` target:
- `ios/SimpleHouseWatch Extension/NotificationController.swift`
- `ios/SimpleHouseWatch Extension/NotificationActionHandler.swift`

### Step 4: Configure Entitlements

**4.1 iOS App Entitlements**

The iOS app entitlements have already been updated. Verify:

1. Select `SimpleHouse` target
2. Go to **Signing & Capabilities** tab
3. You should see **App Groups** capability with:
   - ✅ `group.fox-family.simple-house`

**4.2 Watch App Entitlements**

1. Select `SimpleHouseWatch Extension` target
2. Go to **Signing & Capabilities** tab
3. Click **+ Capability** button
4. Add **App Groups**
5. Click **+** under App Groups
6. Enter: `group.fox-family.simple-house`
7. Add **Push Notifications** capability (click + Capability again)

### Step 5: Update Info.plist Files

**5.1 Watch App Info.plist**

1. Select `SimpleHouseWatch Extension` target
2. Go to **Build Settings** tab
3. Search for "Info.plist File"
4. Set the path to: `SimpleHouseWatch/Info.plist`

**5.2 Watch Extension Info.plist**

The watch extension should use the same Info.plist. Verify it's pointing to `SimpleHouseWatch/Info.plist`.

### Step 6: Configure App Groups in Apple Developer Portal

**IMPORTANT:** You must configure App Groups in your Apple Developer account:

1. Go to [Apple Developer Portal](https://developer.apple.com/account/)
2. Navigate to **Certificates, Identifiers & Profiles**
3. Select **Identifiers**
4. Find your app ID: `fox-family.simple-house`
5. Edit the identifier
6. Enable **App Groups** capability
7. Click **Configure** next to App Groups
8. Click **+** to create new App Group
9. Enter:
   - **Description:** SimpleHouse Shared Data
   - **Identifier:** `group.fox-family.simple-house`
10. Click **Continue** then **Register**
11. Save the app identifier

Repeat for the watch app identifiers:
- `fox-family.simple-house.watchkitapp`
- `fox-family.simple-house.watchkitapp.watchkitextension`

### Step 7: Update Provisioning Profiles

After enabling App Groups, you need to regenerate provisioning profiles:

1. In Xcode, go to **Preferences** → **Accounts**
2. Select your Apple ID
3. Click **Download Manual Profiles**
4. For each target (`SimpleHouse`, `SimpleHouseWatch`, `SimpleHouseWatch Extension`):
   - Select the target
   - Go to **Signing & Capabilities**
   - Under **Signing**, click the refresh icon next to **Provisioning Profile**
   - Select **Automatically manage signing** if not already enabled

### Step 8: Configure Watch Connectivity Framework

**8.1 Link WatchConnectivity Framework (iOS)**

1. Select `SimpleHouse` target
2. Go to **General** tab
3. Scroll to **Frameworks, Libraries, and Embedded Content**
4. Click **+** button
5. Search for `WatchConnectivity.framework`
6. Add it (should be "Do Not Embed")

**8.2 Link WatchConnectivity Framework (Watch)**

Repeat for `SimpleHouseWatch Extension` target.

### Step 9: Update Build Settings

**9.1 Swift Bridging Header (iOS)**

1. Select `SimpleHouse` target
2. Go to **Build Settings**
3. Search for "Objective-C Bridging Header"
4. Verify path is set to: `SimpleHouse/SimpleHouse-Bridging-Header.h`

### Step 10: Build and Test

**10.1 Build iOS App**

1. Select scheme: `SimpleHouse`
2. Select destination: iPhone simulator or physical device
3. Press **⌘+B** to build
4. Fix any compilation errors (there shouldn't be any if all files were added correctly)

**10.2 Build Watch App**

1. Select scheme: `SimpleHouseWatch`
2. Select destination: Apple Watch simulator (paired with iPhone simulator)
3. Press **⌘+B** to build
4. Fix any compilation errors

**10.3 Run Watch App**

1. Make sure iPhone simulator is running first
2. Select `SimpleHouseWatch` scheme
3. Select Apple Watch simulator destination
4. Press **⌘+R** to run
5. Watch app should launch on the watch simulator

### Step 11: Integrate with React Native App

**11.1 Initialize Watch Sync in App.tsx**

The watch sync service has been created. To initialize it, add to `src/App.tsx`:

```typescript
import { Platform } from 'react-native';
import { watchSyncService } from './services/watch-sync';

// In your main App component, add to useEffect:
useEffect(() => {
  if (Platform.OS === 'ios') {
    watchSyncService.initialize();
  }
}, []);
```

**11.2 Sync Auth Tokens on Login**

In your auth store or login flow, add:

```typescript
import { watchSyncService } from '@services/watch-sync';

// After successful login:
if (Platform.OS === 'ios') {
  watchSyncService.syncAuthTokens(
    authToken,
    currentHouseholdId,
    userId
  );
}
```

**11.3 Sync Tasks When They Change**

In your task store (`src/stores/taskStore.ts`), add:

```typescript
import { Platform } from 'react-native';
import { watchSyncService } from '@services/watch-sync';

// After fetching/updating tasks:
if (Platform.OS === 'ios') {
  watchSyncService.syncTasks(maintenanceTasks);
}
```

## 🧪 Testing Checklist

### Basic Functionality
- [ ] Watch app launches successfully
- [ ] Task list shows cached tasks
- [ ] Tapping refresh syncs tasks from iPhone
- [ ] Tapping a task opens task detail view
- [ ] Task detail shows subtasks correctly

### Task Completion
- [ ] Tapping "Complete Task" marks task as complete on backend
- [ ] Completion syncs to iPhone app
- [ ] Subtask toggle updates backend

### Voice Recording
- [ ] Microphone permission request appears
- [ ] Voice recording starts and shows timer
- [ ] Recording stops and saves
- [ ] Upload succeeds (via iPhone or direct API)
- [ ] Transcription appears (if available)

### Notifications
- [ ] Task reminder notification appears on watch
- [ ] "Complete" action button works
- [ ] "Snooze" action button works
- [ ] Tapping notification opens task detail

### Complications
- [ ] Task count complication appears on watch face
- [ ] Count updates when tasks are completed
- [ ] Tapping complication opens app

### Offline Mode
- [ ] With iPhone in airplane mode, watch can still:
  - [ ] View cached tasks
  - [ ] Complete tasks (queued for sync)
  - [ ] Record voice notes
- [ ] When iPhone reconnects, changes sync

## 🐛 Troubleshooting

### "Symbol not found" errors
- Make sure all shared files are added to **both** iOS app and Watch Extension targets

### "App Group not found" errors
- Verify App Group is configured in Apple Developer Portal
- Regenerate provisioning profiles
- Check entitlements files include the correct App Group ID

### WatchConnectivity not working
- Ensure WatchConnectivity framework is linked in both iOS and watch targets
- Check that `WatchConnectivityService.shared.activate()` is called in AppDelegate
- Verify watch and iPhone simulators are paired (Window → Devices and Simulators)

### Build errors with "duplicate symbols"
- Make sure files are **not** added to multiple targets unless specified
- Shared files should only be in iOS app + Watch Extension (not Watch App target)

### React Native bridge not found
- Verify `WatchBridge.m` is added to iOS app target
- Clean build folder (⌘+Shift+K)
- Rebuild iOS app

## 📝 Next Steps

After successful setup:

1. **Test on Physical Device:**
   - Pair your Apple Watch with your iPhone
   - Build and run on physical devices
   - Test all features end-to-end

2. **App Store Submission:**
   - Generate watch app icons (1024x1024)
   - Update App Store listing to mention Apple Watch support
   - Submit for TestFlight beta testing

3. **Future Enhancements:**
   - Add task creation from watch (currently only completion)
   - Siri Shortcuts integration
   - More complication styles
   - Rich notification images

## 🎉 Done!

You now have a fully functional Apple Watch extension for SimpleHouse! Users can:
- View upcoming, today's, and overdue tasks
- Complete tasks and subtasks
- Record voice notes during inspections
- Receive task reminder notifications
- See task count on watch face complications

All data syncs seamlessly between iPhone and Apple Watch, with offline support via local caching and direct API calls.
