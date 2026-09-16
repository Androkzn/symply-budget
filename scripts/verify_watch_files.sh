#!/bin/bash

echo "🔍 Verifying Watch app files were added to Xcode project..."
echo ""

PROJECT_FILE="/Users/andreitekhtelev/Desktop/SymplyEcosystem/ios/SymplyEcosystem.xcodeproj/project.pbxproj"

# Count Swift files in project
SWIFT_COUNT=$(grep -c "\.swift" "$PROJECT_FILE")
echo "📊 Total Swift files in project: $SWIFT_COUNT"
echo "   Expected: ~18-20 files (2 original + 16 new)"
echo ""

# Check for specific key files
echo "🔎 Checking for key files in project.pbxproj:"
echo ""

check_file() {
    local filename=$1
    if grep -q "$filename" "$PROJECT_FILE"; then
        echo "   ✅ $filename"
    else
        echo "   ❌ $filename (MISSING)"
    fi
}

echo "Shared files:"
check_file "SharedTask.swift"
check_file "SharedSubtask.swift"
check_file "AppGroup.swift"

echo ""
echo "Watch Services:"
check_file "WatchAPIClient.swift"
check_file "WatchConnectivityManager.swift"
check_file "WatchVoiceService.swift"

echo ""
echo "Watch Views:"
check_file "TaskListView.swift"
check_file "TaskDetailView.swift"
check_file "VoiceInputView.swift"

echo ""
echo "Watch Core:"
check_file "SymplyEcosystemWatchApp.swift"
check_file "ExtensionDelegate.swift"

echo ""
echo "Notifications:"
check_file "NotificationController.swift"
check_file "NotificationActionHandler.swift"

echo ""
echo "---"
echo ""

# Count how many are actually present
PRESENT=$(grep -E "SharedTask|SharedSubtask|AppGroup|WatchAPIClient|WatchConnectivityManager|WatchVoiceService|TaskListView|TaskDetailView|VoiceInputView|SymplyEcosystemWatchApp|ExtensionDelegate|NotificationController|NotificationActionHandler" "$PROJECT_FILE" | grep -c "\.swift")

if [ "$PRESENT" -ge 13 ]; then
    echo "✅ SUCCESS: $PRESENT/13 key files found in project!"
    echo ""
    echo "Next steps:"
    echo "1. Build the Watch app in Xcode (Cmd+B)"
    echo "2. Select 'SymplyEcosystemWatchApp Watch App' scheme"
    echo "3. Fix any build errors if they appear"
elif [ "$PRESENT" -eq 0 ]; then
    echo "❌ FAILED: No Watch files found in project"
    echo ""
    echo "The files were NOT added to the Xcode project yet."
    echo "Please follow the manual steps in WATCH_FILES_CHECKLIST.md"
else
    echo "⚠️  PARTIAL: Only $PRESENT/13 key files found"
    echo ""
    echo "Some files are missing. Double-check that all files were added."
fi

echo ""
