import XCTest

/// Signs in with a demo account and saves one screenshot per main screen.
///
///     xcrun simctl status_bar <device> override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3
///     xcrun simctl location <device> set 45.4215,-75.6972
///     TEST_RUNNER_DEMO_EMAIL=... TEST_RUNNER_DEMO_PASSWORD=... TEST_RUNNER_SCREENSHOT_DIR=/path \
///       xcodebuild test -scheme ServiceFlow -destination 'id=<device>'
final class AppStoreScreenshots: XCTestCase {
    private let app = XCUIApplication()
    private let env = ProcessInfo.processInfo.environment

    override func setUp() {
        continueAfterFailure = false
        // Location and notification prompts appear during clock-in.
        addUIInterruptionMonitor(withDescription: "Permission") { alert in
            for label in ["Allow While Using App", "Allow Once", "Allow"] where alert.buttons[label].exists {
                alert.buttons[label].tap()
                return true
            }
            return false
        }
    }

    func testCaptureMainScreens() throws {
        let email = try XCTUnwrap(env["DEMO_EMAIL"], "Set TEST_RUNNER_DEMO_EMAIL")
        let password = try XCTUnwrap(env["DEMO_PASSWORD"], "Set TEST_RUNNER_DEMO_PASSWORD")
        app.launch()

        let tabs = app.tabBars.firstMatch
        if !tabs.waitForExistence(timeout: 5) {
            let emailField = app.textFields["Email"]
            XCTAssertTrue(emailField.waitForExistence(timeout: 10))
            emailField.tap()
            emailField.typeText(email)
            let passwordField = app.secureTextFields["Password"]
            passwordField.tap()
            passwordField.typeText(password)
            app.buttons["Log In"].tap()
            XCTAssertTrue(tabs.waitForExistence(timeout: 30), "Sign-in failed")
            dismissSavePassword()
        }

        // Clock In: the map with the nearest job ready to start.
        tabs.buttons["Clock In"].tap()
        let start = app.buttons["Start clock in"]
        XCTAssertTrue(start.waitForExistence(timeout: 20))
        settle()
        capture("01-clock-in")

        // The running shift on its job: timer, budget and crew hours.
        start.tap()
        app.tap() // lets the interruption monitor answer a permission prompt
        XCTAssertTrue(start.waitForNonExistence(timeout: 30))
        let clockIns = app.buttons["Clock Ins"]
        XCTAssertTrue(clockIns.waitForExistence(timeout: 20))
        clockIns.tap()
        settle(4)
        capture("02-on-the-clock")

        // Jobs with labour budgets.
        tabs.buttons["Jobs"].tap()
        XCTAssertTrue(app.staticTexts["Maple Street Repaint"].firstMatch.waitForExistence(timeout: 20))
        settle()
        capture("03-jobs")

        // Timesheet history.
        tabs.buttons["Timesheet"].tap()
        settle(4)
        capture("04-timesheet")
    }

    /// iOS offers to save the password after sign-in; it would cover every shot.
    private func dismissSavePassword() {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        for host in [app, springboard] where host.buttons["Not Now"].waitForExistence(timeout: 5) {
            host.buttons["Not Now"].tap()
            return
        }
    }

    private func settle(_ seconds: TimeInterval = 2) {
        _ = XCTWaiter.wait(for: [expectation(description: "settle")], timeout: seconds)
    }

    private func capture(_ name: String) {
        let screenshot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = env["SCREENSHOT_DIR"] {
            try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
            try? screenshot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
        }
    }
}
