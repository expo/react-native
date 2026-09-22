import XCTest

/*
 Produces bounces off the end of the transcript for tools/gate.sh, which needs
 at least three and fails if the trace shows a content-size change under 1 pt
 during one (see `-[EXPScrollViewInner holdOffsetWhile:]`). The test itself
 only asserts that the newest message is on screen afterwards.
 */
// covers: screens/ChatScreen.js
final class BounceCheck: DemoCase {
  override class var initialScreen: String? { "chat" }
  // Enough rows that those beyond the prerender band (above about row 40) are
  // hidden, so a bounce can switch rows between hidden and rendered.
  override class var seedMessages: Int? { 100 }

  func testABounceOffTheEndDoesNotReLayOutTheTranscript() throws {
    let field = app.textViews.firstMatch
    XCTAssertTrue(appears(field, within: 15), "no composer field")
    field.tap()
    XCTAssertTrue(
      appears(app.keyboards.element(boundBy: 0), within: 10),
      "the keyboard never came up, so nothing can be typed")
    let body = "Bounce \(Int(Date().timeIntervalSince1970) % 100000)"
    type(body)
    let send = app.buttons["Send"]
    XCTAssertTrue(appears(send, within: 8), "no send button with a draft")
    send.tap()
    XCTAssertTrue(appears(text(body), within: 10), "the message never arrived")

    // Three flicks past the end. A receipt may appear during a bounce; the gate
    // allows that 13 pt change.
    let window = app.windows.element(boundBy: 0)
    let from = window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.42))
    let to = window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.12))
    for _ in 0..<3 {
      from.press(forDuration: 0.02, thenDragTo: to, withVelocity: .fast, thenHoldForDuration: 0)
    }
    settled(app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH 'Message '")).firstMatch)

    XCTAssertTrue(
      isOnScreen(text(body)),
      "after bouncing off the end the newest message is not on screen; visible: \(visibleText())")
  }
}
