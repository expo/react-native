import XCTest

/**
 The composer stays on screen while a keyboard-dismissal drag or a back-swipe
 is held. XCUITest can't read positions during a held press, so this reads the
 app's count of off-screen bar positions from the diagnostics alert (one trace
 line per position the bar was drawn at off screen). Up to 4 is tolerated; a
 hidden composer logs about 20.
 */
// covers: Composer.js App.js ios/ChatDemo/AppDelegate.mm
final class HoldCheck: DemoCase {
  override class var initialScreen: String? { "chat" }

  private func raiseKeyboard() {
    let field = app.textViews.firstMatch
    XCTAssertTrue(appears(field, within: 30), "no composer field")
    field.tap()
    XCTAssertTrue(appears(app.keyboards.element(boundBy: 0), within: 10), "no keyboard")
    settled(field)
  }

  /// The off-screen position count from the diagnostics alert.
  private func offScreenPositions(file: StaticString = #filePath, line: UInt = #line) -> Int {
    let message = dumpAlertMessage(file: file, line: line)
    // Must match the alert text in AppDelegate.mm:
    // "N lines on the clipboard (T transitions). M off-screen positions. ..."
    guard let range = message.range(of: " off-screen positions") else {
      XCTFail("the alert does not report off-screen positions: \(message)", file: file, line: line)
      return Int.max
    }
    let before = message[..<range.lowerBound]
    let digits = before.reversed().prefix { $0.isNumber }
    // A count of zero is only an answer from a trace that recorded the drag:
    // the same alert reports how many lines it holds
    let lines = Int(message.prefix { $0.isNumber }) ?? 0
    XCTAssertGreaterThan(lines, 50, "the trace recorded only \(lines) lines, so its zero off-screen count says nothing: \(message)", file: file, line: line)
    return Int(String(digits.reversed())) ?? Int.max
  }

  func testTheComposerRidesTheKeysThroughAHeldDismissal() throws {
    raiseKeyboard()
    let window = app.windows.element(boundBy: 0)
    let keys = app.keyboards.element(boundBy: 0).frame
    let start = window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.30))
    let target = window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: keys.midY / window.frame.height))
    start.press(forDuration: 0.1, thenDragTo: target, withVelocity: .slow, thenHoldForDuration: 2.5)
    settled(app.textViews.firstMatch)
    XCTAssertTrue(app.textViews.firstMatch.exists, "no composer after the held dismissal")
    let off = offScreenPositions()
    XCTAssertLessThanOrEqual(off, 4,
      "the composer was drawn off screen at \(off) positions during a held dismissal drag — it was not riding the keys")
  }

  func testTheComposerRidesTheCardThroughAHeldBackSwipe() throws {
    raiseKeyboard()
    let window = app.windows.element(boundBy: 0)
    let start = window.coordinate(withNormalizedOffset: CGVector(dx: 0.01, dy: 0.35))
    let mid = window.coordinate(withNormalizedOffset: CGVector(dx: 0.40, dy: 0.35))
    start.press(forDuration: 0.1, thenDragTo: mid, withVelocity: .slow, thenHoldForDuration: 2.5)
    settled(app.textViews.firstMatch)
    XCTAssertTrue(app.staticTexts["Chat"].exists, "the swipe did not spring back; visible: \(visibleText())")
    let off = offScreenPositions()
    XCTAssertLessThanOrEqual(off, 4,
      "the composer was drawn off screen at \(off) positions during a held back-swipe")
  }
}
