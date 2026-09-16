//
//  NotificationActionHandler.swift
//  SymplyEcosystemWatch Extension
//
//  Handler for notification action buttons (Complete, Snooze, etc.)
//

import Foundation
import UserNotifications
import WatchConnectivity

class NotificationActionHandler {

    static let shared = NotificationActionHandler()

    var currentTaskId: String?
    var currentHouseholdId: String?

    private init() {
        // Register notification categories
        registerNotificationCategories()
    }

    /// Register notification categories with actions
    func registerNotificationCategories() {
        let center = UNUserNotificationCenter.current()

        // Task reminder actions
        let completeAction = UNNotificationAction(
            identifier: "mark_complete",
            title: "Complete",
            options: [.foreground]
        )

        let snoozeAction = UNNotificationAction(
            identifier: "snooze_1_day",
            title: "Snooze 1 Day",
            options: []
        )

        let viewAction = UNNotificationAction(
            identifier: "view_task",
            title: "View",
            options: [.foreground]
        )

        let taskReminderCategory = UNNotificationCategory(
            identifier: "task_reminder",
            actions: [completeAction, snoozeAction, viewAction],
            intentIdentifiers: [],
            options: []
        )

        // Task overdue actions
        let snoozeHourAction = UNNotificationAction(
            identifier: "snooze_1_hour",
            title: "Snooze 1 Hour",
            options: []
        )

        let completeNowAction = UNNotificationAction(
            identifier: "complete_now",
            title: "Complete Now",
            options: [.foreground]
        )

        let taskOverdueCategory = UNNotificationCategory(
            identifier: "task_overdue",
            actions: [completeNowAction, snoozeHourAction, viewAction],
            intentIdentifiers: [],
            options: []
        )

        center.setNotificationCategories([taskReminderCategory, taskOverdueCategory])

        print("[NotificationHandler] Notification categories registered")
    }

    /// Handle notification action
    func handleNotificationAction(actionIdentifier: String, for notification: UNNotification) {
        guard let taskId = notification.request.content.userInfo["taskId"] as? String else {
            print("[NotificationHandler] No taskId in notification")
            return
        }

        print("[NotificationHandler] Handling action: \(actionIdentifier) for task: \(taskId)")

        switch actionIdentifier {
        case "mark_complete", "complete_now":
            completeTask(taskId: taskId)

        case "snooze_1_day":
            snoozeTask(taskId: taskId, duration: 86400) // 24 hours

        case "snooze_1_hour":
            snoozeTask(taskId: taskId, duration: 3600) // 1 hour

        case "view_task":
            // Handled by app launch

            break

        default:
            print("[NotificationHandler] Unknown action: \(actionIdentifier)")
        }
    }

    /// Complete task from notification
    private func completeTask(taskId: String) {
        WatchConnectivityManager.shared.completeTask(taskId: taskId, notes: "Completed from notification")
    }

    /// Snooze task for specified duration
    private func snoozeTask(taskId: String, duration: TimeInterval) {
        // Send snooze request to iPhone/backend
        guard WCSession.isSupported() else {
            print("[NotificationHandler] WCSession not supported")
            return
        }

        let session = WCSession.default
        guard session.isReachable else {
            print("[NotificationHandler] Phone not reachable for snooze")
            return
        }

        let message: [String: Any] = [
            "type": "snooze_task",
            "taskId": taskId,
            "duration": duration
        ]

        session.sendMessage(message, replyHandler: { reply in
            if let success = reply["success"] as? Bool, success {
                print("[NotificationHandler] Task snoozed successfully")
            }
        }, errorHandler: { error in
            print("[NotificationHandler] Snooze error: \(error)")
        })
    }
}
