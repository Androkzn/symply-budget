//
//  ExtensionDelegate.swift
//  SymplyEcosystemWatch
//
//  Extension delegate for watchOS app lifecycle management
//

import WatchKit
import UserNotifications

class ExtensionDelegate: NSObject, WKExtensionDelegate {

    func applicationDidFinishLaunching() {
        print("[ExtensionDelegate] Application did finish launching")

        // Initialize Watch Connectivity
        _ = WatchConnectivityManager.shared

        // Register notification categories
        NotificationActionHandler.shared.registerNotificationCategories()

        // Request notification permissions
        requestNotificationPermissions()

        // Schedule background refresh
        scheduleBackgroundRefresh()
    }

    func applicationDidBecomeActive() {
        print("[ExtensionDelegate] Application did become active")

        // Refresh tasks when app becomes active
        if AppGroup.isCacheExpired() {
            WatchConnectivityManager.shared.requestTaskSync()
        }

        // Update complications
        TaskCountProvider.requestUpdate()
    }

    func applicationWillResignActive() {
        print("[ExtensionDelegate] Application will resign active")
    }

    func applicationDidEnterBackground() {
        print("[ExtensionDelegate] Application did enter background")

        // Schedule next background refresh
        scheduleBackgroundRefresh()
    }

    // MARK: - Notification Permissions

    private func requestNotificationPermissions() {
        let center = UNUserNotificationCenter.current()

        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            if granted {
                print("[ExtensionDelegate] Notification permissions granted")
            } else if let error = error {
                print("[ExtensionDelegate] Notification permission error: \(error)")
            } else {
                print("[ExtensionDelegate] Notification permissions denied")
            }
        }
    }

    // MARK: - Background Refresh

    private func scheduleBackgroundRefresh() {
        // Schedule background refresh in 15 minutes
        let fireDate = Date().addingTimeInterval(15 * 60)

        WKExtension.shared().scheduleBackgroundRefresh(
            withPreferredDate: fireDate,
            userInfo: nil
        ) { error in
            if let error = error {
                print("[ExtensionDelegate] Background refresh scheduling error: \(error)")
            } else {
                print("[ExtensionDelegate] Background refresh scheduled for \(fireDate)")
            }
        }
    }

    func handle(_ backgroundTasks: Set<WKRefreshBackgroundTask>) {
        for task in backgroundTasks {
            switch task {
            case let backgroundTask as WKApplicationRefreshBackgroundTask:
                handleApplicationRefreshTask(backgroundTask)

            case let snapshotTask as WKSnapshotRefreshBackgroundTask:
                handleSnapshotRefreshTask(snapshotTask)

            case let connectivityTask as WKWatchConnectivityRefreshBackgroundTask:
                handleConnectivityRefreshTask(connectivityTask)

            case let urlSessionTask as WKURLSessionRefreshBackgroundTask:
                handleURLSessionRefreshTask(urlSessionTask)

            default:
                task.setTaskCompletedWithSnapshot(false)
            }
        }
    }

    private func handleApplicationRefreshTask(_ task: WKApplicationRefreshBackgroundTask) {
        print("[ExtensionDelegate] Handling application refresh task")

        // Refresh tasks in background
        Task {
            do {
                let tasks = try await WatchAPIClient.shared.fetchUpcomingTasks()
                await MainActor.run {
                    WatchConnectivityManager.shared.tasks = tasks
                    AppGroup.cacheTasks(tasks)
                    TaskCountProvider.requestUpdate()
                }

                // Schedule next refresh
                scheduleBackgroundRefresh()

                task.setTaskCompletedWithSnapshot(false)
            } catch {
                print("[ExtensionDelegate] Background refresh error: \(error)")
                task.setTaskCompletedWithSnapshot(false)
            }
        }
    }

    private func handleSnapshotRefreshTask(_ task: WKSnapshotRefreshBackgroundTask) {
        print("[ExtensionDelegate] Handling snapshot refresh task")
        task.setTaskCompleted(
            restoredDefaultState: true,
            estimatedSnapshotExpiration: Date().addingTimeInterval(1800), // 30 minutes
            userInfo: nil
        )
    }

    private func handleConnectivityRefreshTask(_ task: WKWatchConnectivityRefreshBackgroundTask) {
        print("[ExtensionDelegate] Handling connectivity refresh task")
        task.setTaskCompletedWithSnapshot(false)
    }

    private func handleURLSessionRefreshTask(_ task: WKURLSessionRefreshBackgroundTask) {
        print("[ExtensionDelegate] Handling URL session refresh task")
        task.setTaskCompletedWithSnapshot(false)
    }

    // MARK: - Notification Handling

    func didReceiveRemoteNotification(
        _ userInfo: [AnyHashable : Any],
        fetchCompletionHandler completionHandler: @escaping (WKBackgroundFetchResult) -> Void
    ) {
        print("[ExtensionDelegate] Received remote notification: \(userInfo)")

        // Check if notification contains task update
        if let taskId = userInfo["taskId"] as? String {
            print("[ExtensionDelegate] Task notification for: \(taskId)")

            // Refresh tasks
            WatchConnectivityManager.shared.requestTaskSync()
            TaskCountProvider.requestUpdate()

            completionHandler(.newData)
        } else {
            completionHandler(.noData)
        }
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        print("[ExtensionDelegate] User tapped notification action: \(response.actionIdentifier)")

        // Handle notification actions
        NotificationActionHandler.shared.handleNotificationAction(
            actionIdentifier: response.actionIdentifier,
            for: response.notification
        )

        completionHandler()
    }
}
