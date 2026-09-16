//
//  SymplyEcosystemWatchApp_Watch_AppUITestsLaunchTests.swift
//  SymplyEcosystemWatchApp Watch AppUITests
//

import XCTest

final class SymplyEcosystemWatchApp_Watch_AppUITestsLaunchTests: XCTestCase {

    override class var runsForEachTargetApplicationUIConfiguration: Bool {
        false
    }

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testLaunch() throws {
        let app = XCUIApplication()
        app.launch()

        XCTAssertTrue(app.navigationBars["Tasks"].waitForExistence(timeout: 15))

        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "Task List Launch"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
