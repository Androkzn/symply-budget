//
//  NotificationController.swift
//  SymplyEcosystemWatch Extension
//
//  Custom notification interface for task reminders (SwiftUI-compatible)
//

import WatchKit
import UserNotifications
import SwiftUI

/// Notification controller for custom notification UI
/// Note: For SwiftUI apps, this provides minimal customization
/// Most notification UI comes from the system notification itself
class NotificationController: WKUserNotificationInterfaceController {

    override init() {
        super.init()
    }

    override func willActivate() {
        super.willActivate()
    }

    override func didDeactivate() {
        super.didDeactivate()
    }

    override func didReceive(_ notification: UNNotification) {
        // Parse notification data for action handling
        let content = notification.request.content

        if let taskId = content.userInfo["taskId"] as? String {
            // Store for action handling
            NotificationActionHandler.shared.currentTaskId = taskId
            NotificationActionHandler.shared.currentHouseholdId = content.userInfo["householdId"] as? String

            print("[NotificationController] Received notification for task: \(taskId)")
        }

        // Note: For SwiftUI apps, custom notification UI is limited
        // The system handles most of the notification display
        // Actions are handled via NotificationActionHandler
    }

    override func didReceive(_ notification: UNNotification, withCompletion completionHandler: @escaping (WKUserNotificationInterfaceType) -> Void) {
        // Store notification data
        self.didReceive(notification)

        // Use default notification interface (system manages UI)
        // For full custom UI, would need to create NotificationView.swift with SwiftUI
        completionHandler(.default)
    }
}

// MARK: - Modern SwiftUI Notification View (Optional Enhancement)

/// Custom SwiftUI view for rich notifications
/// To use: Create NotificationView.swift and register with UNNotificationContentExtension
struct TaskNotificationView: View {
    let notification: UNNotification

    var taskTitle: String {
        notification.request.content.title
    }

    var taskBody: String {
        notification.request.content.body
    }

    var dueDate: String? {
        notification.request.content.userInfo["dueDate"] as? String
    }

    var priority: String? {
        notification.request.content.userInfo["priority"] as? String
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Task title
            Text(taskTitle)
                .font(.headline)
                .foregroundColor(.primary)

            // Task description
            Text(taskBody)
                .font(.caption)
                .foregroundColor(.secondary)
                .lineLimit(3)

            // Due date badge
            if let dueDate = dueDate {
                HStack {
                    Image(systemName: "calendar")
                        .font(.caption2)
                    Text(dueDate)
                        .font(.caption2)
                }
                .foregroundColor(.orange)
            }

            // Priority indicator
            if let priority = priority, ["high", "critical", "urgent"].contains(priority.lowercased()) {
                HStack {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.caption2)
                    Text(priority.uppercased())
                        .font(.caption2)
                }
                .foregroundColor(.red)
            }
        }
        .padding()
    }
}
