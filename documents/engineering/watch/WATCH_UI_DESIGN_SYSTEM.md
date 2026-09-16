# Apple Watch UI Design System - SimpleHouse
## Matching Main App's Design Language

**Last Updated:** February 8, 2026
**Status:** Design specification for production-ready Watch UI

---

## Design Principles from Main App

### Color System

**Primary Colors**
```swift
// Main app uses these colors from theme
primary: Blue (#007AFF / palette.blue[500])
primaryLight: Light Blue (#E5F2FF / palette.blue[50])
secondary: Dark Blue (#0051D5 / palette.blue[600])
```

**Status Colors**
```swift
success: Green (#34C759)
error: Red (#FF3B30)
warning: Orange (#FF9500)
```

**Pastel Accents**
```swift
teal: #5AC8FA (used in app)
skyBlue: #BFE5FF
cream: #FFF8DC
```

### Typography

```swift
fontSize.xs: 11pt    // Captions, metadata
fontSize.sm: 13pt    // Secondary text
fontSize.md: 15pt    // Body text (default)
fontSize.lg: 17pt    // Headlines
fontSize.xl: 20pt    // Large titles
```

### Spacing

```swift
xs: 4pt   // Tight spacing
sm: 8pt   // Small spacing
md: 16pt  // Standard spacing (default)
lg: 24pt  // Large spacing
xl: 32pt  // Extra large spacing
```

### Border Radius

```swift
sm: 4pt   // Small elements
md: 8pt   // Cards, inputs
lg: 12pt  // Buttons (PRIMARY - match this!)
xl: 20pt  // Large cards
full: 9999pt // Circular
```

### Button Styles (CRITICAL - Must Match)

**Primary Button**
- Background: Blue (#007AFF)
- Text: White
- Border Radius: 12pt
- Padding: 12pt vertical, 24pt horizontal
- Animation: Scale to 0.97 on press (spring animation)
- Haptic: Click feedback on press

**Secondary Button**
- Background: Surface color (system gray)
- Text: Primary text color
- Border Radius: 12pt
- Padding: 12pt vertical, 24pt horizontal

**Outline Button**
- Background: Transparent
- Border: 1.5pt Blue
- Text: Blue
- Border Radius: 12pt

**Ghost Button**
- Background: Transparent
- Text: Blue
- No border

### Icons

**System Category Icons (Emoji)**
```swift
hvac: ❄️
plumbing: 🚿
electrical: ⚡
gas: 🔥
appliances: 🔌
roof: 🏠
foundation: 🧱
windows_doors: 🪟
landscaping: 🌳
gutters: 🌧️
// ... (full list in SYSTEM_CATEGORY_ICONS)
```

---

## Apple Watch UI Updates Required

### 1. Task List View (TaskListView.swift)

**Current Issues:**
- ❌ Generic button styling
- ❌ No blue primary color
- ❌ No haptic feedback
- ❌ Missing pull-to-refresh
- ❌ No saved filter preference

**Required Updates:**
```swift
// Filter picker - add blue tint
.tint(Color.blue)

// Buttons - use borderedProminent with blue
.buttonStyle(.borderedProminent)
.buttonBorderShape(.roundedRectangle(radius: 12))
.tint(.blue)

// Haptic feedback on button press
WKInterfaceDevice.current().play(.click)

// Save filter preference
@AppStorage("selectedTaskFilter") private var savedFilter: String = "upcoming"

// Pull-to-refresh
.refreshable {
    await refreshTasksAsync()
}

// Loading indicator - add blue tint
ProgressView()
    .tint(.blue)
    .scaleEffect(1.2)
```

### 2. Task Row View (TaskRowView.swift)

**Current Issues:**
- ❌ Basic layout
- ❌ No visual hierarchy
- ❌ Missing completion status indicator

**Required Updates:**
```swift
// Card-like background for each row
.background(
    RoundedRectangle(cornerRadius: 12) // Match main app
        .fill(Color(.systemGray6))
)

// Priority indicator badge (match status colors)
if ["critical", "urgent", "high"].contains(task.prioritySeverity ?? "") {
    HStack(spacing: 4) {
        Image(systemName: "exclamationmark.circle.fill")
        Text(task.prioritySeverity?.uppercased() ?? "")
    }
    .font(.caption2)
    .foregroundColor(
        task.prioritySeverity == "critical" ? .red : .orange
    )
    .padding(.horizontal, 8)
    .padding(.vertical, 4)
    .background(
        Capsule()
            .fill(task.prioritySeverity == "critical"
                ? Color.red.opacity(0.15)
                : Color.orange.opacity(0.15))
    )
}

// Due date with color coding
Text(task.dueDateFormatted ?? "")
    .foregroundColor(task.isOverdue ? .red : .secondary)
    .font(.caption2)
```

### 3. Task Detail View (TaskDetailView.swift)

**Current Issues:**
- ❌ Generic button colors
- ❌ No haptic feedback
- ❌ No loading states
- ❌ Basic card styling

**Required Updates:**
```swift
// Task info card - rounded with background
VStack(alignment: .leading, spacing: 8) {
    // ... task content
}
.padding(12)
.background(
    RoundedRectangle(cornerRadius: 12) // Match main app
        .fill(Color(.systemGray6))
)

// Complete Task button - PRIMARY style
Button {
    // Haptic feedback
    WKInterfaceDevice.current().play(.success)
    showingCompletionSheet = true
} label: {
    Label("Complete Task", systemImage: "checkmark.circle.fill")
        .frame(maxWidth: .infinity)
}
.buttonStyle(.borderedProminent)
.buttonBorderShape(.roundedRectangle(radius: 12))
.tint(.green)
.disabled(connectivity.isLoading)

// Add Voice Note button - SECONDARY style
NavigationLink(destination: VoiceInputView(taskId: task.id)) {
    Label("Add Voice Note", systemImage: "mic.fill")
        .frame(maxWidth: .infinity)
}
.buttonStyle(.bordered)
.buttonBorderShape(.roundedRectangle(radius: 12))
.tint(.blue)

// Loading overlay
if connectivity.isLoading {
    ZStack {
        Color.black.opacity(0.3)
        ProgressView()
            .tint(.white)
            .scaleEffect(1.5)
    }
    .edgesIgnoringSafeArea(.all)
}
```

### 4. Task Completion Sheet (TaskCompletionSheet.swift)

**Current Issues:**
- ❌ Incorrect button role (.destructive for completion)
- ❌ No haptic feedback
- ❌ Basic styling

**Required Updates:**
```swift
// Complete button - GREEN to match success state
Button {
    // Haptic feedback
    WKInterfaceDevice.current().play(.success)
    onComplete()
    dismiss()
} label: {
    Text("Complete")
        .font(.headline)
        .frame(maxWidth: .infinity)
}
.buttonStyle(.borderedProminent)
.buttonBorderShape(.roundedRectangle(radius: 12))
.tint(.green) // GREEN for positive action
// Remove .destructive role - it's not destructive!

// Cancel button - GRAY secondary
Button("Cancel", role: .cancel) {
    dismiss()
}
.buttonStyle(.bordered)
.buttonBorderShape(.roundedRectangle(radius: 12))

// Notes TextField - match main app style
TextField("Add notes...", text: $notes, axis: .vertical)
    .lineLimit(3...5)
    .textFieldStyle(.roundedBorder)
    .padding(.horizontal)
```

### 5. Voice Input View (VoiceInputView.swift)

**Current Issues:**
- ❌ Generic button colors
- ❌ No haptic feedback on recording start/stop
- ❌ Misaligned UI elements

**Required Updates:**
```swift
// Record button - RED to indicate recording
Button(action: startRecording) {
    VStack(spacing: 12) {
        Image(systemName: "mic.circle.fill")
            .font(.system(size: 60))
            .foregroundColor(.red)
        Text("Tap to Record")
            .font(.headline)
    }
}
.buttonStyle(.plain)
.onTapGesture {
    // Haptic feedback
    WKInterfaceDevice.current().play(.start)
    requestPermissionAndStart()
}

// Stop Recording button - RED prominent
Button {
    // Haptic feedback
    WKInterfaceDevice.current().play(.stop)
    stopRecording()
} label: {
    Label("Stop Recording", systemImage: "stop.circle.fill")
        .frame(maxWidth: .infinity)
}
.buttonStyle(.borderedProminent)
.buttonBorderShape(.roundedRectangle(radius: 12))
.tint(.red)

// Upload button - BLUE primary
Button {
    // Haptic feedback
    WKInterfaceDevice.current().play(.click)
    uploadRecording()
} label: {
    Label("Upload Recording", systemImage: "icloud.and.arrow.up")
        .frame(maxWidth: .infinity)
}
.buttonStyle(.borderedProminent)
.buttonBorderShape(.roundedRectangle(radius: 12))
.tint(.blue)

// Timer - centered and prominent
Text(formatTime(voiceService.recordingDuration))
    .font(.largeTitle)
    .monospacedDigit()
    .foregroundColor(.red)
    .frame(maxWidth: .infinity)
```

### 6. Subtask Row View (SubtaskRowView.swift)

**Current Issues:**
- ❌ Basic card styling
- ❌ No visual feedback on toggle
- ❌ Plain background

**Required Updates:**
```swift
Button(action: {
    // Haptic feedback
    WKInterfaceDevice.current().play(.click)
    onToggle()
}) {
    HStack(spacing: 8) {
        Image(systemName: subtask.isCompleted ? "checkmark.circle.fill" : "circle")
            .foregroundColor(subtask.isCompleted ? .green : .gray)
            .font(.body)

        // ... text content
    }
    .padding(10) // More padding for touch targets
    .background(
        RoundedRectangle(cornerRadius: 10) // Match card radius
            .fill(Color(.systemGray6))
    )
}
.buttonStyle(.plain)
```

---

## Haptic Feedback Guide

**When to Use:**
```swift
// Success actions (completing tasks)
WKInterfaceDevice.current().play(.success)

// Failure/Error
WKInterfaceDevice.current().play(.failure)

// Click/Tap actions (buttons, toggles)
WKInterfaceDevice.current().play(.click)

// Start recording
WKInterfaceDevice.current().play(.start)

// Stop recording
WKInterfaceDevice.current().play(.stop)

// Retry/Refresh
WKInterfaceDevice.current().play(.retry)

// Navigation
WKInterfaceDevice.current().play(.navigationGenericManeuver)
```

---

## Button Style Reference

### Primary Action Buttons
```swift
Button {
    // Action
} label: {
    Text("Primary Action")
        .frame(maxWidth: .infinity)
}
.buttonStyle(.borderedProminent)
.buttonBorderShape(.roundedRectangle(radius: 12))
.tint(.blue) // or .green for success actions
```

### Secondary/Cancel Buttons
```swift
Button("Cancel") {
    // Action
}
.buttonStyle(.bordered)
.buttonBorderShape(.roundedRectangle(radius: 12))
```

### Icon Buttons (Toolbar)
```swift
Button(action: refresh) {
    Image(systemName: "arrow.clockwise")
        .foregroundColor(.blue)
}
```

---

## Color Usage Guidelines

### When to Use Each Color

**Blue (Primary)**
- Primary action buttons
- Navigation elements
- Active states
- Links

**Green**
- Success states
- Completion actions
- Positive feedback
- Completed checkmarks

**Red**
- Overdue indicators
- Recording indicators
- Delete/destructive actions
- Critical priority badges

**Orange**
- Warning states
- High priority
- Alerts

**Gray**
- Secondary text
- Disabled states
- Background surfaces

---

## Accessibility Requirements

### Dynamic Type Support
```swift
// Use relative font sizes
.font(.caption)      // Instead of .font(.system(size: 11))
.font(.body)         // Instead of .font(.system(size: 15))
.font(.headline)     // Instead of .font(.system(size: 17))
```

### VoiceOver Labels
```swift
.accessibilityLabel("Complete task")
.accessibilityHint("Marks this task as completed")
.accessibilityValue("\(task.subtasksCompleted) of \(task.subtaskCount) subtasks completed")
```

### Color Contrast
- All text must meet WCAG AA standards (4.5:1 ratio)
- Use SF Symbols for better accessibility
- Provide haptic feedback as non-visual cue

---

## Animation Guidelines

### Spring Animations (Match Main App)
```swift
.animation(.spring(response: 0.3, dampingFraction: 0.7), value: someValue)
```

### Button Press Animation
```swift
// Scale down on press (like main app)
.scaleEffect(isPressed ? 0.97 : 1.0)
.animation(.spring(response: 0.2, dampingFraction: 0.6), value: isPressed)
```

### Loading States
```swift
ProgressView()
    .tint(.blue)
    .scaleEffect(1.2) // Slightly larger for visibility
```

---

## Implementation Checklist

### Task List View
- [ ] Blue tint on segmented picker
- [ ] Rounded buttons (radius: 12)
- [ ] Haptic feedback on refresh
- [ ] Blue loading indicator
- [ ] Pull-to-refresh gesture
- [ ] Saved filter preference
- [ ] Bordered prominent buttons

### Task Detail View
- [ ] Rounded card backgrounds
- [ ] Blue/Green button tints
- [ ] Haptic feedback on actions
- [ ] Loading overlay
- [ ] Disabled state for loading
- [ ] Rounded button shapes (12pt)

### Task Completion
- [ ] Green complete button (not red/destructive)
- [ ] Haptic success feedback
- [ ] Rounded button shapes
- [ ] Proper text field styling

### Voice Input
- [ ] Red recording indicator
- [ ] Haptic start/stop feedback
- [ ] Blue upload button
- [ ] Centered timer display
- [ ] Rounded button shapes

### Subtasks
- [ ] Rounded background cards
- [ ] Green checkmark for completed
- [ ] Haptic feedback on toggle
- [ ] Proper touch targets (min 44pt)

---

## Testing Checklist

### Visual Testing
- [ ] All buttons use 12pt corner radius
- [ ] Blue is primary color throughout
- [ ] Green used for success/completion
- [ ] Red only for overdue/recording
- [ ] Consistent spacing (8pt, 16pt, 24pt)
- [ ] All text uses system fonts

### Interaction Testing
- [ ] All buttons provide haptic feedback
- [ ] Loading states prevent double-taps
- [ ] Animations feel smooth
- [ ] Pull-to-refresh works
- [ ] Filter preference persists

### Accessibility Testing
- [ ] VoiceOver reads all elements
- [ ] Dynamic Type scales properly
- [ ] Color contrast meets standards
- [ ] Touch targets ≥ 44pt

---

**Next Steps:**
1. Apply these updates to all Watch UI files
2. Test on physical Apple Watch
3. Verify visual consistency with main app
4. Submit for TestFlight beta testing

