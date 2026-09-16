# Watch App Files Addition Checklist

Xcode should now be open. Follow these steps to add all Swift files to the Watch app target.

## Current Situation
- ✅ Files exist in filesystem: `ios/Shared/`, `ios/SimpleHouseWatch/`, `ios/SimpleHouseWatch Extension/`
- ❌ Files NOT in Xcode project yet
- 🎯 Target: `SimpleHouseWatchApp Watch App`

---

## Step 1: Add Shared Files (3 files)

**These files should be added to BOTH iOS app AND Watch app targets**

1. In Xcode's left sidebar (Project Navigator), **right-click on "SimpleHouse" folder** (the top-level one)
2. Select **"Add Files to 'SimpleHouse'..."**
3. Navigate to `ios/Shared/` folder
4. Select all 3 files:
   - `Models/SharedTask.swift`
   - `Models/SharedSubtask.swift`
   - `Utilities/AppGroup.swift`
5. In the dialog, check these options:
   - ✅ **"Copy items if needed"** = UNCHECKED (files are already in the right place)
   - ✅ **"Create groups"** = SELECTED
   - ✅ **"Add to targets"**:
     - ✅ SimpleHouse (iOS app)
     - ✅ SimpleHouseWatchApp Watch App
6. Click **"Add"**

**Expected result:** You should see a "Shared" folder appear in the project navigator with 3 Swift files.

---

## Step 2: Add Main Watch App Files (11 files)

**These files should be added to Watch app target ONLY**

### Option A: Add All at Once (Recommended)

1. **Right-click on "SimpleHouseWatchApp Watch App" folder** in Xcode
2. Select **"Add Files to 'SimpleHouse'..."**
3. Navigate to `ios/SimpleHouseWatch/` folder
4. Select the **entire folder** OR select all files inside:
   - Services/WatchAPIClient.swift
   - Services/WatchConnectivityManager.swift
   - Services/WatchVoiceService.swift
   - Views/TaskListView.swift
   - Views/TaskDetailView.swift
   - Views/TaskRowView.swift
   - Views/TaskCompletionSheet.swift
   - Views/VoiceInputView.swift
   - Complications/TaskCountProvider.swift
   - SimpleHouseWatchApp.swift
   - ExtensionDelegate.swift
5. In the dialog:
   - ✅ **"Copy items if needed"** = UNCHECKED
   - ✅ **"Create groups"** = SELECTED
   - ✅ **"Add to targets"**:
     - ❌ SimpleHouse (iOS app) = UNCHECKED
     - ✅ SimpleHouseWatchApp Watch App = CHECKED
6. Click **"Add"**

### Option B: Add by Category (If Option A doesn't work)

Add files one category at a time:

**Services (3 files):**
- WatchAPIClient.swift
- WatchConnectivityManager.swift
- WatchVoiceService.swift

**Views (5 files):**
- TaskListView.swift
- TaskDetailView.swift
- TaskRowView.swift
- TaskCompletionSheet.swift
- VoiceInputView.swift

**Complications (1 file):**
- TaskCountProvider.swift

**Root (2 files):**
- SimpleHouseWatchApp.swift
- ExtensionDelegate.swift

---

## Step 3: Add Notification Handlers (2 files)

1. **Right-click on "SimpleHouseWatchApp Watch App" folder**
2. Select **"Add Files to 'SimpleHouse'..."**
3. Navigate to `ios/SimpleHouseWatch Extension/` folder
4. Select both files:
   - NotificationController.swift
   - NotificationActionHandler.swift
5. In the dialog:
   - ✅ **"Copy items if needed"** = UNCHECKED
   - ✅ **"Create groups"** = SELECTED
   - ✅ **"Add to targets"**:
     - ❌ SimpleHouse = UNCHECKED
     - ✅ SimpleHouseWatchApp Watch App = CHECKED
6. Click **"Add"**

---

## Step 4: Verify Files Were Added

In the Project Navigator, you should now see:

```
SimpleHouse (root)
├── SimpleHouse/
│   └── (existing iOS app files)
├── Shared/ ✨ NEW
│   ├── Models/
│   │   ├── SharedTask.swift
│   │   └── SharedSubtask.swift
│   └── Utilities/
│       └── AppGroup.swift
├── SimpleHouseWatchApp Watch App/
│   ├── ContentView.swift (existing)
│   ├── SimpleHouseWatchAppApp.swift (existing)
│   ├── Services/ ✨ NEW
│   │   ├── WatchAPIClient.swift
│   │   ├── WatchConnectivityManager.swift
│   │   └── WatchVoiceService.swift
│   ├── Views/ ✨ NEW
│   │   ├── TaskListView.swift
│   │   ├── TaskDetailView.swift
│   │   ├── TaskRowView.swift
│   │   ├── TaskCompletionSheet.swift
│   │   └── VoiceInputView.swift
│   ├── Complications/ ✨ NEW
│   │   └── TaskCountProvider.swift
│   ├── SimpleHouseWatchApp.swift ✨ NEW
│   ├── ExtensionDelegate.swift ✨ NEW
│   ├── NotificationController.swift ✨ NEW
│   └── NotificationActionHandler.swift ✨ NEW
```

---

## Step 5: Verify Target Membership

Select any of the newly added files in the Project Navigator, then check the **File Inspector** (right sidebar, first tab):

**For Shared files:**
- ✅ SimpleHouse (should be checked)
- ✅ SimpleHouseWatchApp Watch App (should be checked)

**For Watch files:**
- ❌ SimpleHouse (should be UNCHECKED)
- ✅ SimpleHouseWatchApp Watch App (should be checked)

---

## Step 6: Update Main Watch App File

The default `SimpleHouseWatchAppApp.swift` needs to be replaced with our custom one:

1. In Project Navigator, find **two files** with similar names:
   - `SimpleHouseWatchAppApp.swift` (existing, in "SimpleHouseWatchApp Watch App" folder - created by Xcode)
   - `SimpleHouseWatchApp.swift` (new, just added - our custom app file)

2. **Delete the OLD one:**
   - Select `SimpleHouseWatchAppApp.swift` (the one WITHOUT "App.swift" at the end)
   - Right-click → "Delete"
   - Choose "Move to Trash"

3. **Rename the NEW one:**
   - Select `SimpleHouseWatchApp.swift`
   - Press Enter or right-click → "Rename"
   - Rename it to: `SimpleHouseWatchAppApp.swift`

**OR** just keep both and update the @main annotation:
- Open `SimpleHouseWatchApp.swift`
- Make sure it has `@main` at the top
- Remove `@main` from the old `SimpleHouseWatchAppApp.swift`

---

## Step 7: Clean Build Folder

1. In Xcode menu: **Product → Clean Build Folder** (or Cmd+Shift+K)
2. This ensures Xcode picks up all the new files

---

## Step 8: Build the Watch App

1. In Xcode toolbar, select the scheme: **"SimpleHouseWatchApp Watch App"**
2. Select a destination: **iPhone 15 Pro + Apple Watch Series 10**
3. Click **Build** (Cmd+B)
4. Watch for any errors in the build log

---

## Common Issues & Fixes

### ❌ "Cannot find 'SharedTask' in scope"
**Fix:** Make sure Shared files are added to BOTH iOS and Watch targets

### ❌ "Duplicate symbol '_main'"
**Fix:** Only ONE file should have `@main` annotation - remove it from the old default file

### ❌ "No such module 'WatchConnectivity'"
**Fix:** Add WatchConnectivity framework:
1. Select project → SimpleHouseWatchApp Watch App target
2. "Frameworks, Libraries, and Embedded Content"
3. Click "+" → Add "WatchConnectivity.framework"

### ❌ Files appear red/missing in Xcode
**Fix:** The file path references are wrong. Delete the file reference and re-add it with correct path.

---

## Quick Verification Script

After adding files, run this in Terminal to verify:

```bash
cd /Users/andreitekhtelev/Desktop/SimpleHouse/ios
grep -c "\.swift" SimpleHouse.xcodeproj/project.pbxproj
```

**Expected output:** Should show ~18-20 Swift files (original 2 + 16 new ones)

If it shows only 2, the files weren't added to the project.

---

## Need Help?

If you get stuck, take a screenshot of:
1. The Project Navigator (left sidebar)
2. The File Inspector for one of the new files (right sidebar)
3. Any build errors

Let me know and I'll help debug! 🚀
