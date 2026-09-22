import XCTest

/*
 Two sends inside the delivery delay, and the receipt stays where it is.

 The receipt is worn by the newest sent message that HAS one, and the next
 message takes it only when its own arrives — 1.13 seconds after the send, as
 measured on the platform. That rule was once written as "the last two sent
 messages", and two sends inside the delay put the wearer third from the end:
 its line dropped the instant the second was sent, and nothing wore a receipt
 until the first of the two was delivered. A device saw it as the Delivered of
 an earlier message leaving the moment a message was sent — sometimes.

 XCUITest cannot type and tap twice inside 1.13 seconds (measured: 1.47), so
 this case launches the app with the wait stretched to six — a launch
 environment the app honours for exactly this, and nothing a person can reach.
 Whether the two sends then fell inside the wait is still measured, not
 assumed.

 The drafts are typed on the software keyboard's own keys, not with
 `typeText`. `typeText` sends hardware key events, and iOS answers them by
 taking the software keyboard down while the field keeps focus and raising it
 again at the next touch — here, the send. The keyboard then rose under the
 flying balloon, and the swap to the row landed as far off as one frame of that
 rise: 15 points once, against a gate that allows 8 while the keyboard moves.
 A person typing on the keys never moves the keyboard, and neither does this.

 The assertion is not here. Every row logs its receipt state as it changes,
 and the gate reads the log: once any row has worn a receipt, some row wears
 one at the end of every commit. An accessibility poll was tried first and
 found the whole transcript missing from the tree for two seconds at a time
 while the screen plainly showed it — a harness reading a busy app, not the
 receipt. The row's own word is the instrument.
 */
final class ReceiptHandoffCheck: DemoCase {
  override class var initialScreen: String? { "chat" }
  static let deliveredAfter: TimeInterval = 6.0
  override class var extraEnvironment: [String: String] {
    ["EXP_DELIVERED_AFTER_MS": String(Int(deliveredAfter * 1000))]
  }

  func testTwoSendsInsideTheDeliveryDelay() throws {
    let field = app.textViews.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 15), "no composer field")
    field.tap()
    XCTAssertTrue(app.keyboards.element(boundBy: 0).waitForExistence(timeout: 10))
    let send = app.buttons["Send"]
    findKeys(for: "FirstSecondThird")

    typeOnKeys("First")
    XCTAssertTrue(send.waitForExistence(timeout: 8), "no send button with a draft")
    send.tap()
    XCTAssertTrue(text("First").waitForExistence(timeout: 10), "the first message never appeared")
    // Its Delivered, and its Read a second and a half after that.
    Thread.sleep(forTimeInterval: Self.deliveredAfter + 2.0)

    // Where the raised field sits, to prove the keyboard held still through both sends
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
    XCTAssertTrue(text("Third").waitForExistence(timeout: 5), "the third message never appeared")
    XCTAssertEqual(
      field.frame.maxY, fieldBottom, accuracy: 1.0,
      "the composer moved between the two sends, so the keyboard did too; the flights were measured against a moving bar")
    // Both handoffs — Second taking the receipt from First, Third from Second —
    // happen while the gate's trace is listening. That is the whole point.
    Thread.sleep(forTimeInterval: Self.deliveredAfter + 2.0)
  }
}
