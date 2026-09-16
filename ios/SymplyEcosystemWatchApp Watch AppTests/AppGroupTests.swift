//
//  AppGroupTests.swift
//  SymplyEcosystemWatchApp Watch AppTests
//

import Foundation
import Testing
@testable import SymplyEcosystemWatchApp_Watch_App

@Suite(.serialized)
struct AppGroupTests {

    private func clearTestState() {
        AppGroup.clearAuth()
        AppGroup.clearAihousekeeperBriefing()
        AppGroup.defaults.removeObject(forKey: AppGroup.cachedTasksKey)
        AppGroup.defaults.removeObject(forKey: AppGroup.lastSyncTimestampKey)
        AppGroup.defaults.synchronize()
    }

    @Test func storeAndRetrieveAuth() {
        clearTestState()
        defer { clearTestState() }

        AppGroup.storeAuth(token: "token-abc", householdId: "hh-1", userId: "user-1")
        #expect(AppGroup.getAuthToken() == "token-abc")
        #expect(AppGroup.getHouseholdId() == "hh-1")
        #expect(AppGroup.getUserId() == "user-1")
        #expect(AppGroup.isAuthenticated() == true)
    }

    @Test func clearAuthRemovesCredentials() {
        clearTestState()
        defer { clearTestState() }

        AppGroup.storeAuth(token: "token", householdId: "hh", userId: "u")
        AppGroup.clearAuth()
        #expect(AppGroup.isAuthenticated() == false)
        #expect(AppGroup.getCachedTasks() == nil)
    }

    @Test func cacheAndLoadTasks() {
        clearTestState()
        defer { clearTestState() }

        let tasks = [
            WatchTask(id: "t1", householdId: "hh", title: "Task A"),
            WatchTask(id: "t2", householdId: "hh", title: "Task B"),
        ]
        AppGroup.cacheTasks(tasks)

        let cached = AppGroup.getCachedTasks()
        #expect(cached?.count == 2)
        #expect(cached?.first?.id == "t1")
        #expect(AppGroup.getLastSyncTimestamp() != nil)
        #expect(AppGroup.isCacheExpired() == false)
    }

    @Test func cacheExpiredAfterOneHour() {
        clearTestState()
        defer { clearTestState() }

        AppGroup.defaults.set(
            Date().addingTimeInterval(-3700),
            forKey: AppGroup.lastSyncTimestampKey
        )
        #expect(AppGroup.isCacheExpired() == true)
    }

    @Test func storeAndRetrieveBriefingForDate() {
        clearTestState()
        defer { clearTestState() }

        let date = "2026-07-02"
        AppGroup.storeAihousekeeperBriefing(paragraph: "Check HVAC today.", date: date)

        #expect(AppGroup.getAihousekeeperBriefing(for: date) == "Check HVAC today.")
        #expect(AppGroup.getAihousekeeperBriefing(for: "2026-07-01") == nil)
    }

    @Test func getLatestBriefingRegardlessOfDate() {
        clearTestState()
        defer { clearTestState() }

        AppGroup.storeAihousekeeperBriefing(paragraph: "Stale briefing.", date: "2026-01-01")
        let latest = AppGroup.getAihousekeeperBriefingLatest()
        #expect(latest?.paragraph == "Stale briefing.")
        #expect(latest?.date == "2026-01-01")
    }
}
