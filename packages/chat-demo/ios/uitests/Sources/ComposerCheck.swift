/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 The composer is one line, grows with what is typed, and then stops.

 All three have been wrong, and none of them was visible without measuring:

 - It opened **72 points** against the native composer's 40, because `<textarea>`'s `rows`
   defaults to 2 — HTML's own default, honoured faithfully — and the user-agent
   style sizes the control `chrome + rows * lineHeight` as an explicit height,
   which beats any `minHeight`. Fixed with `rows={1}` and `height: 'auto'`.
 - Then it never grew: 40 empty, 40 focused, **40 after a hundred and forty
   characters**. A `<textarea>` is a fixed-height box in HTML; the opt-out is
   CSS's `field-sizing: content`, which we do not implement. The control now
   reports its wrapped height and the composer sets its box from it — the
   height cannot be computed in JavaScript, because it depends on the font, the
   available width and the platform's line breaking.
 - And that report went to `layoutSubviews`, which does not run when the text
   changes and the box does not — every keystroke in a field that has not been
   resized yet. The one event a growing composer needs was the one that never
   arrived.

 The numbers below are the demo's own, and both match the platform's native
 composer rather than a screenshot: a one-line field is 40 tall and each further
 line adds 20.2871, so an n-line field is `40 + (n - 1) * 20.2871`.
 */
final class ComposerCheck: DemoCase {
  override class var initialScreen: String? { "chat" }

  private let line: CGFloat = 40
  private let lineHeight: CGFloat = 20.2871

  /**
   The send button sits at the bottom of the pill, not the top.

   The row stretches its children to the pill's height, and a child with a
   height of its own is aligned to the START of that — so the button climbed to
   the top corner as soon as the composer grew past one line.
   */
  func testTheSendButtonStaysAtTheBottom() throws {
    let field = app.textViews.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 10), "no composer field")
    field.tap()
    XCTAssertTrue(app.keyboards.element(boundBy: 0).waitForExistence(timeout: 10))

    app.typeText("Hi")
    Thread.sleep(forTimeInterval: 1.0)
    let send = app.buttons["Send"]
    XCTAssertTrue(send.waitForExistence(timeout: 5), "no send button with a draft")

    // One line: centred, so the gaps above and below match.
    let above = send.frame.minY - field.frame.minY
    let below = field.frame.maxY - send.frame.maxY
    XCTAssertEqual(
      above, below, accuracy: 2.0,
      "on one line the send button is not centred: \(above) above, \(below) below")

    // Grown: pinned to the bottom, so the gap below is unchanged and the gap
    // above is everything the field gained.
    app.typeText(" one two three four five six seven eight nine ten eleven twelve thirteen")
    Thread.sleep(forTimeInterval: 1.5)
    let grownBelow = field.frame.maxY - send.frame.maxY
    XCTAssertEqual(
      grownBelow, below, accuracy: 2.0,
      "the send button moved off the bottom as the composer grew: \(grownBelow) below, was \(below)")
  }

  func testItStartsAtOneLineGrowsAndThenStops() throws {
    let field = app.textViews.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 10), "no composer field")

    XCTAssertEqual(
      field.frame.height, line, accuracy: 1.0,
      "the composer opened \(field.frame.height) points tall, not one line")

    field.tap()
    XCTAssertTrue(app.keyboards.element(boundBy: 0).waitForExistence(timeout: 10))
    XCTAssertEqual(
      field.frame.height, line, accuracy: 1.0,
      "focusing changed the composer's height")

    // Enough to wrap, not enough to fill it.
    app.typeText("One two three four five six seven eight nine ten eleven twelve thirteen")
    Thread.sleep(forTimeInterval: 1.5)
    let grown = field.frame.height
    XCTAssertGreaterThan(
      grown, line,
      "the composer did not grow with what was typed — it is scrolling instead")
    /*
     * A WHOLE number of lines, and the rounding has to happen in lines rather
     * than in points. This read `(grown - line).rounded() / lineHeight * lineHeight`,
     * which cancels to `(grown - line).rounded()` and so asserted that a height
     * is within two points of itself — true for every possible height, including
     * the ones this case exists to catch.
     */
    let lines = ((grown - line) / lineHeight).rounded()
    XCTAssertEqual(
      grown, line + lines * lineHeight, accuracy: 2.0,
      "grew to \(grown), which is \((grown - line) / lineHeight) lines rather "
        + "than a whole number of them")

    /*
     * Far more than fits, so the SPACE is what decides.
     *
     * This used to assert a five-line cap, sourced to nothing.
     * The platform's own composer has no fixed cap: ninety words typed into it
     * on the simulator grow it until its top edge is under the navigation bar —
     * so a fixed line count is not the native behaviour, and the two assertions
     * below are: it goes well past five lines, and
     * it stops before it reaches the header.
     */
    app.typeText(
      " fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone "
        + "twentytwo twentythree twentyfour twentyfive twentysix twentyseven "
        + "twentyeight twentynine thirty thirtyone thirtytwo thirtythree thirtyfour "
        + "thirtyfive thirtysix thirtyseven thirtyeight thirtynine forty fortyone "
        + "fortytwo fortythree fortyfour fortyfive fortysix fortyseven fortyeight")
    Thread.sleep(forTimeInterval: 2.5)

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
  }

  /**
   The field is empty after a send, and the message is in the transcript.

   Clearing is a CONTROLLED write — the app sets the value to nothing — and the
   view refuses a write that is stale or that lands while text is being
   composed, so it is a rule with exceptions rather than an assignment. The
   exception that reached a phone was iOS's inline prediction: it MARKS text as
   you type, the clear was dropped as composition, and nothing sent it again, so
   the composer kept the message it had just sent. This covers the ordinary path
   the exceptions branch off.
   */
  func testSendingClearsTheField() throws {
    let field = app.textViews.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 10), "no composer field")
    field.tap()
    XCTAssertTrue(app.keyboards.element(boundBy: 0).waitForExistence(timeout: 10))

    app.typeText("Cleared")
    let send = app.buttons["Send"]
    XCTAssertTrue(send.waitForExistence(timeout: 5), "no send button with a draft")
    send.tap()

    XCTAssertTrue(
      text("Cleared").waitForExistence(timeout: 10),
      "the message never reached the transcript: \(visibleText())")
    // The placeholder is a label of its own, so an empty field reads as empty
    // rather than as its placeholder text.
    let left = (field.value as? String) ?? ""
    XCTAssertFalse(
      left.contains("Cleared"),
      "the composer still holds \"\(left)\" after sending it")
  }
}
