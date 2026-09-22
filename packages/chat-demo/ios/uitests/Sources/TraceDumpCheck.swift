import XCTest

/*
 * The two-finger double-tap diagnostics dump (AppDelegate.mm) includes CSS
 * transition lines after a send, and the composer is still on screen after the
 * dump's alert.
 */
// covers: ios/ChatDemo/AppDelegate.mm Composer.js
final class TraceDumpCheck: DemoCase {
  override class var initialScreen: String? { "chat" }

  func testTheDumpCarriesTheTransitionTimeline() {
    // A send runs CSS transitions.
    let field = app.textViews.firstMatch
    XCTAssertTrue(appears(field, within: 30), "composer never appeared")
    field.tap()
    XCTAssertTrue(appears(app.keyboards.element(boundBy: 0), within: 10))
    type("trace")
    let send = app.buttons["Send"]
    XCTAssertTrue(appears(send, within: 10), "send button never appeared")
    send.tap()
    // The send's flight and its receipt, which the timeline must carry
    XCTAssertTrue(appears(text("Delivered"), within: 8), "no receipt after the send")
    settled(app.textViews.firstMatch)

    let message = dumpAlertMessage()
    // Must match the alert text in AppDelegate.mm: "… (T transitions). …".
    // Not `Regex`, which needs iOS 16 (the deployment target is 15.1).
    var count = 0
    if let open = message.range(of: "("),
      let close = message.range(of: " transitions)") {
      let digits = message[open.upperBound..<close.lowerBound]
      count = Int(digits) ?? 0
    }
    XCTAssertGreaterThan(
      count, 0,
      "the dump carries no transition lines after a send, so the engine's timeline is "
        + "not reaching a device report: \(message)")

    // Presenting a `UIAlertController` resigns the first responder; the
    // composer must survive that.
    let composer = app.textViews.firstMatch
    XCTAssertTrue(
      appears(composer, within: 10),
      "the composer is gone after the dump alert; visible: \(visibleText())")
    XCTAssertTrue(
      isOnScreen(composer),
      "the composer came back off screen after the dump alert")
  }
}