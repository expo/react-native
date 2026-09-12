import XCTest

/**
 The composer MID-gesture, which nothing else in this suite can see.

 Builds shipped that hid the composer while a gesture was in progress — the
 dismissal drag and the back-swipe — and every other case here passed, because
 they check the state AFTER a gesture. `press(…thenHoldForDuration:)` blocks the
 test process, so the composer's position during the hold cannot be read from
 here either. The app can: its dock tick runs every frame through any keyboard
 motion and pins a `bar OFF SCREEN` line whenever the composer's on-screen frame
 has left the screen while a field inside it is being edited, and the
 diagnostics alert counts those lines. This performs each gesture, held, and
 reads the count from the alert. The tolerance is four, for margin without
 meaning: a build that hides the composer through a drag pins twenty and hits
 the cap.
 */
final class HoldCheck: DemoCase {
  override class var initialScreen: String? { "chat" }

  private func raiseKeyboard() {
    let field = app.textViews.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 30), "no composer field")
    field.tap()
    XCTAssertTrue(app.keyboards.element(boundBy: 0).waitForExistence(timeout: 10), "no keyboard")
    Thread.sleep(forTimeInterval: 0.8)
  }

  /// The diagnostics alert's off-screen count, read the way `TraceDumpCheck` reads its numbers.
  private func offScreenFrames(file: StaticString = #filePath, line: UInt = #line) -> Int {
    if app.keyboards.count > 0 { dismissKeyboard() }
    let anywhere = app.staticTexts.firstMatch
    XCTAssertTrue(anywhere.waitForExistence(timeout: 10), "nothing on screen to tap", file: file, line: line)
    anywhere.tap(withNumberOfTaps: 2, numberOfTouches: 2)
    let alert = app.alerts.firstMatch
    XCTAssertTrue(alert.waitForExistence(timeout: 15), "the dump alert never appeared", file: file, line: line)
    let message = alert.staticTexts.element(boundBy: 1).label
    print("MEASURE dump-alert=\(message)")
    alert.buttons["Keep recording"].tap()
    // "... (N transitions, M off-screen frames). ..."
    guard let range = message.range(of: " off-screen frames") else {
      XCTFail("the alert does not report off-screen frames: \(message)", file: file, line: line)
      return Int.max
    }
    let before = message[..<range.lowerBound]
    let digits = before.reversed().prefix { $0.isNumber }
    return Int(String(digits.reversed())) ?? Int.max
  }

  func testTheComposerRidesTheKeysThroughAHeldDismissal() throws {
    raiseKeyboard()
    let window = app.windows.element(boundBy: 0)
    let keys = app.keyboards.element(boundBy: 0).frame
    let start = window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.30))
    let target = window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: keys.midY / window.frame.height))
    start.press(forDuration: 0.1, thenDragTo: target, withVelocity: .slow, thenHoldForDuration: 2.5)
    Thread.sleep(forTimeInterval: 1.0)
    XCTAssertTrue(app.textViews.firstMatch.exists, "no composer after the held dismissal")
    let off = offScreenFrames()
    XCTAssertLessThanOrEqual(off, 4,
      "the composer left the screen on \(off) frames during a held dismissal drag — it was not riding the keys")
  }

  func testTheComposerRidesTheCardThroughAHeldBackSwipe() throws {
    raiseKeyboard()
    let window = app.windows.element(boundBy: 0)
    let start = window.coordinate(withNormalizedOffset: CGVector(dx: 0.01, dy: 0.35))
    let mid = window.coordinate(withNormalizedOffset: CGVector(dx: 0.40, dy: 0.35))
    start.press(forDuration: 0.1, thenDragTo: mid, withVelocity: .slow, thenHoldForDuration: 2.5)
    Thread.sleep(forTimeInterval: 1.0)
    XCTAssertTrue(app.staticTexts["Chat"].exists, "the swipe did not spring back; visible: \(visibleText())")
    let off = offScreenFrames()
    XCTAssertLessThanOrEqual(off, 4,
      "the composer left the screen on \(off) frames during a held back-swipe")
  }
}
