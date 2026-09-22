/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 The receipt under a sent message: its position below the balloon, how long
 `Delivered` shows before `Read`, `Read` carrying a time, and the transcript
 scrolling up to show it.
 */
// covers: screens/ChatScreen.js receiptTiming.js
final class ReceiptCheck: DemoCase {
  override class var initialScreen: String? { "chat" }

  func testTheReceiptSitsAgainstTheBalloon() throws {
    let field = app.textViews.firstMatch
    XCTAssertTrue(appears(field, within: 15), "no composer field")
    field.tap()
    XCTAssertTrue(appears(app.keyboards.element(boundBy: 0), within: 10))

    let message = "Receipt"
    type(message)
    let send = app.buttons["Send"]
    XCTAssertTrue(appears(send, within: 8), "no send button with a draft")
    send.tap()

    let sent = text(message)
    XCTAssertTrue(appears(sent, within: 10), "the message never appeared")

    // Only a receipt below this balloon: an earlier message keeps its receipt
    // for over a second after the send.
    func belowTheBalloon(_ candidate: XCUIElement) -> Bool {
      candidate.exists && candidate.frame.minY > sent.frame.maxY
    }
    // Wait for `Read`, not `Delivered`: the text changes in place, and reading
    // the frame of a `Delivered` that has just become `Read` fails with
    // "failed to get matching snapshot".
    var receipt: XCUIElement?
    let deadline = Date().addingTimeInterval(10)
    while Date() < deadline && receipt == nil {
      let any = app.descendants(matching: .any)
        .matching(NSPredicate(format: "label BEGINSWITH 'Read '"))
        .firstMatch
      if belowTheBalloon(any) { receipt = any }
      if receipt == nil { Thread.sleep(forTimeInterval: 0.3) }
    }
    guard let line = receipt else {
      return XCTFail("no receipt under the sent message; visible: \(visibleText())")
    }

    /*
     * Expected position, from the message's text (the balloon has no
     * accessibility element). Must match ChatScreen.js:
     *
     *   the body's bottom  = the text's bottom + `BUBBLE_PADDING_V` (10)
     *   the receipt's box  = that + `CHAT_BUBBLE_TAIL_DROP` (6.65)
     *                        + `styles.receipt` marginTop (-1)
     *
     * With the line's leading, the ink is then 8.00 pt below the body, as in
     * native Messages. See ui-metrics.md, "Receipt vertical position".
     */
    let bodyBottom = sent.frame.maxY + 10
    let gap = line.frame.minY - bodyBottom
    print("MEASURE balloon=\(sent.frame) receipt=\(line.frame) gap=\(gap)")
    for c in app.descendants(matching: .any)
      .matching(NSPredicate(format: "label BEGINSWITH 'Read ' OR label == 'Delivered' OR label == 'Receipt'"))
      .allElementsBoundByIndex {
      print("MEASURE candidate '\(c.label)' \(c.frame) type=\(c.elementType.rawValue)")
    }
    XCTAssertEqual(
      gap, 5.65, accuracy: 1.5,
      "the receipt's box starts \(gap) below the balloon's body, not 5.65 — "
        + "text at \(sent.frame.maxY), receipt at \(line.frame.minY)")

    // Not past the balloon's trailing edge (the text plus 14 pt of padding).
    XCTAssertLessThan(
      line.frame.maxX, sent.frame.maxX + 16,
      "the receipt runs past the balloon's trailing edge")
  }

  /**
   `Delivered` shows for 2.9 to 4.3 s before `Read` replaces it, timed between
   each label's first appearance (polled every 20 ms; a label leaves the tree
   before its text leaves the screen, so its disappearance isn't used). Depends
   on `RECEIPT_HOLD_MS` in receiptTiming.js. See ui-metrics.md, "Delivered to
   Read interval".
   */
  func testTheReaderGetsAMomentBetweenDeliveredAndRead() throws {
    let field = app.textViews.firstMatch
    XCTAssertTrue(appears(field, within: 15), "no composer field")
    field.tap()
    XCTAssertTrue(appears(app.keyboards.element(boundBy: 0), within: 10))
    type("Hold")
    let send = app.buttons["Send"].firstMatch
    XCTAssertTrue(appears(send, within: 8), "no send button with a draft")
    send.tap()

    func firstSighting(_ predicate: String, within: TimeInterval) -> Date? {
      let element = app.descendants(matching: .any)
        .matching(NSPredicate(format: predicate))
        .firstMatch
      let deadline = Date().addingTimeInterval(within)
      while Date() < deadline {
        if element.exists {
          return Date()
        }
        Thread.sleep(forTimeInterval: 0.02)
      }
      return nil
    }

    guard let deliveredAt = firstSighting("label == 'Delivered'", within: 12) else {
      return XCTFail("`Delivered` never appeared; visible: \(visibleText())")
    }
    guard let readAt = firstSighting("label BEGINSWITH 'Read '", within: 12) else {
      return XCTFail("`Read` never replaced `Delivered`; visible: \(visibleText())")
    }

    let gap = readAt.timeIntervalSince(deliveredAt)
    print("MEASURE delivered-to-read \(gap)s")
    XCTAssertGreaterThan(
      gap, 2.9,
      "`Read` arrived \(gap)s after `Delivered` — the demo leaves about "
        + "3.6s, and a reader cannot take a word that is replaced that fast")
    XCTAssertLessThan(
      gap, 4.3,
      "`Read` arrived \(gap)s after `Delivered` — the demo leaves about "
        + "3.6s, so something is holding the swap open")
  }

}

/// testTheReceiptPushesTheTranscriptClearOfTheComposer on its own launch, so its seed is the launch's and there is no second one.
// covers: screens/ChatScreen.js receiptTiming.js
final class ReceiptPushCheck: DemoCase {
  override class var initialScreen: String? { "chat" }
  override class var seedMessages: Int? { 40 }

  /// In a chat long enough to rest at its bottom, a new message's receipt ends
  /// up on screen above the composer: the transcript scrolls up to show it.
  func testTheReceiptPushesTheTranscriptClearOfTheComposer() throws {
    XCTAssertTrue(
      appears(app.staticTexts["Chat"], within: 30),
      "the seeded chat never rendered")

    let field = app.textViews.firstMatch
    XCTAssertTrue(appears(field, within: 15), "no composer field")
    field.tap()
    XCTAssertTrue(appears(app.keyboards.element(boundBy: 0), within: 10))

    let message = "Push"
    type(message)
    let send = app.buttons["Send"]
    XCTAssertTrue(appears(send, within: 8), "no send button with a draft")
    send.tap()

    let sent = text(message)
    XCTAssertTrue(appears(sent, within: 10), "the message never appeared")

    func belowTheBalloon(_ candidate: XCUIElement) -> Bool {
      candidate.exists && candidate.frame.minY > sent.frame.maxY
    }
    // `Read` only, as in the first test.
    var receipt: XCUIElement?
    let deadline = Date().addingTimeInterval(10)
    while Date() < deadline && receipt == nil {
      let any = app.descendants(matching: .any)
        .matching(NSPredicate(format: "label BEGINSWITH 'Read '"))
        .firstMatch
      if belowTheBalloon(any) { receipt = any }
      if receipt == nil { Thread.sleep(forTimeInterval: 0.3) }
    }
    guard let line = receipt else {
      return XCTFail("no receipt under the sent message; visible: \(visibleText())")
    }
    Thread.sleep(forTimeInterval: 1.0)

    XCTAssertTrue(
      isOnScreen(line),
      "the receipt is not on screen — it opened behind the composer instead of "
        + "pushing the transcript up; visible: \(visibleText())")
    XCTAssertLessThanOrEqual(
      line.frame.maxY, field.frame.minY + 0.5,
      "the receipt's bottom (\(line.frame.maxY)) is below the composer's top "
        + "(\(field.frame.minY)) — the content did not rise to clear it")
  }
}
