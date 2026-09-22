/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 The composer field opens one line tall, grows a line at a time as text wraps,
 stops growing below the header, and is empty after a send.
 */
// covers: Composer.js
final class ComposerCheck: DemoCase {
  override class var initialScreen: String? { "chat" }

  // Must match `LINE` and `LINE_HEIGHT` in Composer.js. See ui-metrics.md,
  // "Composer line box".
  private let line: CGFloat = 40
  private let lineHeight: CGFloat = 20.2871

  /// One launch, in this order: the field is read pristine first, its twelve
  /// lines go out as one message so it is empty again, then a send clears it,
  /// then the send button is read against a growing field.
  func testItStartsAtOneLineGrowsAndStopsSendingClearsItAndTheSendButtonStaysAtTheBottom() throws {
    try XCTContext.runActivity(named: "it starts at one line, grows and then stops") { _ in
      let field = app.textViews.firstMatch
      XCTAssertTrue(appears(field, within: 10), "no composer field")

      XCTAssertEqual(
        field.frame.height, line, accuracy: 1.0,
        "the composer opened \(field.frame.height) points tall, not one line")

      field.tap()
      XCTAssertTrue(appears(app.keyboards.element(boundBy: 0), within: 10))
      XCTAssertEqual(
        field.frame.height, line, accuracy: 1.0,
        "focusing changed the composer's height")
      // The bar wraps the pill, which wraps the field: what the bar adds to the
      // field's height must not change as the field grows. `testID="composer-bar"`
      // in Composer.js; the lowest one, as a covered screen's bar stays around.
      let bars = app.otherElements.matching(identifier: "composer-bar")
      func barHeight() -> CGFloat {
        bars.allElementsBoundByIndex.map { $0.frame }.filter { !$0.isEmpty }.map { $0.height }.last ?? 0
      }
      let chrome = barHeight() - field.frame.height
      XCTAssertGreaterThan(chrome, 0, "no composer bar to measure against")

      // Enough to wrap, not enough to fill it.
      type("One two three four five six seven eight nine ten eleven twelve thirteen")
      let grown = settled(field).height
      XCTAssertGreaterThan(
        grown, line,
        "the composer did not grow with what was typed — it is scrolling instead")
      // Round to whole lines, not points; rounding points would always pass.
      let lines = ((grown - line) / lineHeight).rounded()
      XCTAssertEqual(
        grown, line + lines * lineHeight, accuracy: 2.0,
        "grew to \(grown), which is \((grown - line) / lineHeight) lines rather "
          + "than a whole number of them")

      // Native Messages has no line limit; the available space stops the growth.
      type(
        " fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone "
          + "twentytwo twentythree twentyfour twentyfive twentysix twentyseven "
          + "twentyeight twentynine thirty thirtyone thirtytwo thirtythree thirtyfour "
          + "thirtyfive thirtysix thirtyseven thirtyeight thirtynine forty fortyone "
          + "fortytwo fortythree fortyfour fortyfive fortysix fortyseven fortyeight")
      settled(field)

      let fiveLines = line + 4 * lineHeight
      XCTAssertGreaterThan(
        field.frame.height, fiveLines + lineHeight,
        "the composer stopped at \(field.frame.height), which is the old five-line "
          + "cap; the platform has no line cap and grows into the space instead")

      let back = app.buttons["BackButton"]
      XCTAssertTrue(back.exists, "no back button to take the header's edge from")
      XCTAssertGreaterThan(
        field.frame.minY, back.frame.maxY,
        "the composer grew to \(field.frame.height) and its top edge reached "
          + "\(field.frame.minY), which is over the header at \(back.frame.maxY) — "
          + "a composer that grows without limit eats the screen it is on")

      let keyboard = app.keyboards.element(boundBy: 0)
      XCTAssertLessThanOrEqual(
        field.frame.maxY, keyboard.frame.minY + 1,
        "the composer's bottom edge \(field.frame.maxY) is inside the keyboard at "
          + "\(keyboard.frame.minY)")

      // Past twelve lines the field scrolls (`maxHeight` in `styles.field`) and
      // the pill must stop with it, whatever room the transcript still has.
      type(
        " fortynine fifty fiftyone fiftytwo fiftythree fiftyfour fiftyfive fiftysix "
          + "fiftyseven fiftyeight fiftynine sixty sixtyone sixtytwo sixtythree "
          + "sixtyfour sixtyfive sixtysix sixtyseven sixtyeight sixtynine seventy "
          + "seventyone seventytwo seventythree seventyfour seventyfive seventysix")
      settled(field)
      let twelveLines = line + 11 * lineHeight
      XCTAssertEqual(
        field.frame.height, twelveLines, accuracy: 1.0,
        "the field is \(field.frame.height) tall with more than twelve lines typed; it stops at \(twelveLines) and scrolls")
      XCTAssertEqual(
        barHeight() - field.frame.height, chrome, accuracy: 2.0,
        "the bar adds \(barHeight() - field.frame.height) to the field's height, was \(chrome): the pill outgrew its field")
    }

    app.buttons["Send"].tap()
    let emptied = app.textViews.firstMatch
    XCTAssertTrue(waitUntil(8) { ((emptied.value as? String) ?? "").isEmpty }, "the field did not clear after the long send")

    try XCTContext.runActivity(named: "sending clears the field") { _ in
      let field = app.textViews.firstMatch
      XCTAssertTrue(appears(field, within: 10), "no composer field")
      field.tap()
      XCTAssertTrue(appears(app.keyboards.element(boundBy: 0), within: 10))

      type("Cleared")
      let send = app.buttons["Send"]
      XCTAssertTrue(appears(send, within: 5), "no send button with a draft")
      send.tap()

      XCTAssertTrue(
        appears(text("Cleared"), within: 10),
        "the message never reached the transcript: \(visibleText())")
      let left = (field.value as? String) ?? ""
      XCTAssertFalse(
        left.contains("Cleared"),
        "the composer still holds \"\(left)\" after sending it")
    }

    try XCTContext.runActivity(named: "the send button stays at the bottom") { _ in
      let field = app.textViews.firstMatch
      XCTAssertTrue(appears(field, within: 10), "no composer field")
      field.tap()
      XCTAssertTrue(appears(app.keyboards.element(boundBy: 0), within: 10))

      type("Hi")
      settled(field)
      let send = app.buttons["Send"]
      XCTAssertTrue(appears(send, within: 5), "no send button with a draft")

      // On one line the button is centred.
      let above = send.frame.minY - field.frame.minY
      let below = field.frame.maxY - send.frame.maxY
      XCTAssertEqual(
        above, below, accuracy: 2.0,
        "on one line the send button is not centred: \(above) above, \(below) below")

      type(" one two three four five six seven eight nine ten eleven twelve thirteen")
      settled(field)
      let grownBelow = field.frame.maxY - send.frame.maxY
      XCTAssertEqual(
        grownBelow, below, accuracy: 2.0,
        "the send button moved off the bottom as the composer grew: \(grownBelow) below, was \(below)")
    }
  }
}
