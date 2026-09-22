import XCTest

/*
 Sends two messages within the delivery delay, for tools/gate.sh: it reads each
 row's logged receipt state and fails if no message shows a receipt after one
 has. (The accessibility tree can't be used for this: under this load it drops
 the transcript for seconds at a time.)

 XCUITest can't send twice within the real 1.13 s delay (`DELIVERED_AFTER` in
 ChatScreen.js), so `EXP_DELIVERED_AFTER_MS` stretches it to 6 s.
 */
// covers: screens/ChatScreen.js receiptTiming.js
final class ReceiptHandoffCheck: DemoCase {
  override class var initialScreen: String? { "chat" }
  static let deliveredAfter: TimeInterval = 6.0
  override class var extraEnvironment: [String: String] {
    ["EXP_DELIVERED_AFTER_MS": String(Int(deliveredAfter * 1000))]
  }

  func testTwoSendsInsideTheDeliveryDelay() throws {
    let field = app.textViews.firstMatch
    XCTAssertTrue(appears(field, within: 15), "no composer field")
    field.tap()
    XCTAssertTrue(appears(app.keyboards.element(boundBy: 0), within: 10))
    let send = app.buttons["Send"]
    findKeys(for: "FirstSecondThird")

    typeOnKeys("First")
    XCTAssertTrue(appears(send, within: 8), "no send button with a draft")
    send.tap()
    XCTAssertTrue(appears(text("First"), within: 10), "the first message never appeared")
    // First's Delivered, then its Read. Existence only: a receipt's frame read
    // between its label changing and its move to the next message fails the
    // test with "no matching snapshot".
    XCTAssertTrue(waitUntil(Self.deliveredAfter + 6) { receipt("Delivered").exists }, "First was never delivered")
    XCTAssertTrue(waitUntil(Self.deliveredAfter + 6) { receipt("Read ").exists }, "First never read")

    // `typeOnKeys` keeps the keyboard still; this checks it did.
    let fieldBottom = field.frame.maxY
    typeOnKeys("Second")
    send.tap()
    let secondSentAt = Date()
    typeOnKeys("Third")
    send.tap()
    let apart = Date().timeIntervalSince(secondSentAt)
    print("MEASURE sends apart=\(apart)")
    guard apart < Self.deliveredAfter - 1.0 else {
      XCTFail("the harness took \(apart)s between the two sends, not inside the \(Self.deliveredAfter)s wait; the sequence under test did not happen")
      return
    }
    XCTAssertTrue(appears(text("Third"), within: 5), "the third message never appeared")
    XCTAssertEqual(
      field.frame.maxY, fieldBottom, accuracy: 1.0,
      "the composer moved between the two sends, so the keyboard did too; the flights were measured against a moving bar")
    // Keep the app running until the receipt has moved to Second and then
    // Third, so the trace records both.
    // Third's Delivered replaces Second's Read, then becomes Read itself
    XCTAssertTrue(waitUntil(Self.deliveredAfter + 6) { receipt("Delivered").exists }, "Third was never delivered")
    XCTAssertTrue(
      waitUntil(Self.deliveredAfter + 6) { !receipt("Delivered").exists && receipt("Read ").exists },
      "the receipt never reached Third")
  }

  /// The receipt line whose text starts with `prefix`, wherever it is.
  private func receipt(_ prefix: String) -> XCUIElement {
    app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", prefix)).firstMatch
  }
}
