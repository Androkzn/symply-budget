//
//  KaizenWatchRenderTests.swift
//  SymplyEcosystemWatchApp Watch AppUITests
//
//  Matrix: KAIZEN-WATCH-016…020
//  (documents/engineering/testing/matrices/kaizen.md)
//
//  Drives the real Kaizen watch face on a paired simulator. The snapshot is
//  injected through the `-SYMPLY_UI_TEST_KAIZEN_SNAPSHOT` launch argument, which
//  `KaizenToday.load()` decodes straight from argv and NEVER persists — so unlike
//  the old harness (see WatchUITesting.swift) these tests cannot leak fabricated
//  data into the shared App Group and pollute a real session.
//
//  Requires the Kaizen brand watch scheme on a paired `Kaizen-Watch` simulator.
//  Mark N/A in RESULTS when no paired sim / insufficient disk — never Fail.
//

import XCTest

final class KaizenWatchRenderTests: XCTestCase {

    private static let populatedSnapshot =
        #"{"done":3,"total":5,"current_streak":12,"next_habit":"Meditate"}"#

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    /// Launch the watch app with an injected (non-persistent) snapshot.
    /// Pass an empty string to drive the signed-out / never-synced empty state.
    private func launch(snapshot: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-SYMPLY_UI_TEST_KAIZEN_SNAPSHOT", snapshot]
        app.launch()
        return app
    }

    // MARK: - KAIZEN-WATCH-016 — launches and renders the Kaizen face

    @MainActor
    func testKaizenFaceLaunchesAndRendersHeader() throws {
        let app = launch(snapshot: Self.populatedSnapshot)

        XCTAssertTrue(app.staticTexts["Kaizen"].waitForExistence(timeout: 20),
                      "Kaizen watch header did not render")
        // 3/5 → 60%, computed by KaizenToday.progressPercent.
        XCTAssertTrue(app.staticTexts["60%"].waitForExistence(timeout: 10),
                      "Progress percent did not render in the header")
    }

    // MARK: - KAIZEN-WATCH-017 — stat tiles

    @MainActor
    func testStatTilesShowProgressAndStreak() throws {
        let app = launch(snapshot: Self.populatedSnapshot)

        XCTAssertTrue(app.staticTexts["Kaizen"].waitForExistence(timeout: 20))

        XCTAssertTrue(app.staticTexts["3/5"].exists, "Habits-done tile value missing")
        XCTAssertTrue(app.staticTexts["Habits done"].exists, "Habits-done caption missing")
        XCTAssertTrue(app.staticTexts["12"].exists, "Streak tile value missing")
        XCTAssertTrue(app.staticTexts["Day streak"].exists, "Streak caption missing")
    }

    // MARK: - KAIZEN-WATCH-018 — next-habit row

    @MainActor
    func testNextHabitRowShowsPendingHabit() throws {
        let app = launch(snapshot: Self.populatedSnapshot)

        XCTAssertTrue(app.staticTexts["Kaizen"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["Meditate"].waitForExistence(timeout: 10),
                      "Next-habit row did not render the pending habit")
        XCTAssertTrue(app.staticTexts["Up next"].exists, "Next-habit detail label missing")
    }

    @MainActor
    func testCompletedDayShowsCompletionRowInsteadOfNextHabit() throws {
        // next_habit null → the row is REPLACED by the completion row, not hidden.
        let app = launch(snapshot: #"{"done":5,"total":5,"current_streak":12,"next_habit":null}"#)

        XCTAssertTrue(app.staticTexts["Kaizen"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["All habits complete"].waitForExistence(timeout: 10),
                      "Completion row did not render for a fully-done day")
        XCTAssertTrue(app.staticTexts["100%"].exists, "A fully-done day must read 100%")
        XCTAssertFalse(app.staticTexts["Up next"].exists,
                       "Completed day must not still show an 'Up next' row")
    }

    // MARK: - KAIZEN-WATCH-019 — empty state

    @MainActor
    func testEmptyStateRendersWithNoSnapshot() throws {
        // Empty payload → load() returns nil → SymplyEmptyState.
        let app = launch(snapshot: "")

        XCTAssertTrue(app.staticTexts["No habits to track yet"].waitForExistence(timeout: 20),
                      "Empty state did not render when no snapshot was synced")
        XCTAssertFalse(app.staticTexts["Habits done"].exists,
                       "Stat tiles must not render without a snapshot")
    }

    @MainActor
    func testZeroTotalDoesNotRenderNaNPercent() throws {
        // The divide-by-zero guard, observed end-to-end rather than in isolation.
        let app = launch(snapshot: #"{"done":0,"total":0,"current_streak":0,"next_habit":null}"#)

        XCTAssertTrue(app.staticTexts["Kaizen"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["0%"].exists, "Zero-total day must read 0%")
        XCTAssertFalse(app.staticTexts["nan%"].exists)
        XCTAssertFalse(app.staticTexts["NaN%"].exists)
    }

    // MARK: - KAIZEN-WATCH-020 — scroll contract

    @MainActor
    func testNextHabitRowIsReachableByScrollingOnSmallFaces() throws {
        let app = launch(snapshot: Self.populatedSnapshot)

        XCTAssertTrue(app.staticTexts["Kaizen"].waitForExistence(timeout: 20))

        let nextRow = app.staticTexts["Meditate"]
        if !nextRow.isHittable {
            // 40 mm faces need a swipe to reveal the row below the stat tiles.
            app.swipeUp()
        }
        XCTAssertTrue(nextRow.waitForExistence(timeout: 10),
                      "Next-habit row was not reachable after scrolling")
    }
}
