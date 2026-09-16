//
//  SymplyEcosystemWatchApp_Watch_AppUITests.swift
//  SymplyEcosystemWatchApp Watch AppUITests
//
//  Data-independent smoke tests. The old mock-data launch path was removed —
//  the Watch renders only real backend data — so these assert on the app's
//  chrome (navigation, toolbar) which is present regardless of data/auth state.
//

import XCTest

final class SymplyEcosystemWatchApp_Watch_AppUITests: XCTestCase {

    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launch()
    }

    private func waitForTaskList(timeout: TimeInterval = 20) {
        XCTAssertTrue(app.navigationBars["Tasks"].waitForExistence(timeout: timeout),
                      "Task list did not appear")
    }

    @MainActor
    func testTaskListLaunches() throws {
        waitForTaskList()
    }

    @MainActor
    func testSyncButtonExists() throws {
        waitForTaskList()
        XCTAssertTrue(app.buttons["sync-button"].waitForExistence(timeout: 10))
    }

    @MainActor
    func testNavigateToBriefing() throws {
        waitForTaskList()

        let briefingButton = app.buttons.matching(
            NSPredicate(format: "label CONTAINS 'briefing' OR identifier == 'briefing-button'")
        ).firstMatch
        XCTAssertTrue(briefingButton.waitForExistence(timeout: 10))
        briefingButton.tap()

        XCTAssertTrue(app.navigationBars["Briefing"].waitForExistence(timeout: 10))
    }
}
