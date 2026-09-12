/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 The field and the balloon break at the same character.

 A sent message is laid out ONCE: the flying copy is given the row's width and
 keeps it for the whole throw, so nothing reflows in the air. That is only
 invisible if the line breaks it flies with are the ones the writer was looking
 at — a column a character narrower in the field than in the balloon means a
 word jumps a line at the moment of the send.

 The platform keeps the two the same width. A hundred and fifty narrow glyphs
 fill 250.00 points of the native composer and 249.67 of a native balloon,
 measured on this simulator with both apps open; ours were a character apart
 until the field's insets were measured against it — `SEND_INSET_TRAILING` and
 the field's own `paddingRight` in `Composer`.

 So: sixty-six narrow glyphs fill one line of the field and the sixty-seventh
 does not, and this asserts the same of the BALLOON. Counts rather than points,
 because a count is what a reader sees, and pinned at both ends — too narrow a
 balloon wraps the sixty-six, too wide a one keeps the sixty-seven on one line.

 The probe begins with a capital `I` because the keyboard capitalises the first
 letter typed into an empty field whatever this asks for, and a capital is a
 point wider than the rest: written down, the probe is the same string however
 it is typed.

 To within ONE GLYPH, which is 3.74 points: two columns closer than that break
 at the same character and this case cannot tell them apart. It is the coarsest
 the question can be asked in typing, and it is the size of the defect it was
 written for — the send button's trailing inset, 3.7 points out.

 On a 402-point window, which is what the gate's simulators are. Another width
 moves the counts and this case has to be re-measured for it; the failure
 messages say so.
 */
final class WrapCheck: DemoCase {
  override class var initialScreen: String? { "chat" }

  /// The line box a message is drawn on, and so a one-line run's height.
  /// Measured against the platform in `BalloonShapeCheck`.
  private let lineBox: CGFloat = 20
  private let fits = 66
  private let wraps = 67

  /// The message's own run, which is the element the transcript names — a
  /// balloon is that run plus its padding.
  private func run(labelled label: String) -> XCUIElement {
    app.descendants(matching: .any)
      .matching(NSPredicate(format: "label == %@", label))
      .firstMatch
  }

  /**
   Typing, a mouthful at a time.

   A single `typeText` of fifty glyphs put a draft in the field that came back
   two lines tall, where the same string typed through the simulator's own input
   fits on one. Short calls, with a breath between them, land what they are
   given.
   */
  private func type(_ string: String, into field: XCUIElement) {
    var rest = Substring(string)
    while !rest.isEmpty {
      let chunk = rest.prefix(16)
      field.typeText(String(chunk))
      rest = rest.dropFirst(chunk.count)
      Thread.sleep(forTimeInterval: 0.2)
    }
  }

  /// Type `count` glyphs and send them: the field's height before the send, and
  /// the height of the run that lands.
  private func sendGlyphs(_ count: Int, _ field: XCUIElement) -> (field: CGFloat, run: CGFloat) {
    let probe = "I" + String(repeating: "i", count: count - 1)
    type(probe, into: field)
    Thread.sleep(forTimeInterval: 0.8)
    let fieldHeight = fieldHeightRaised(field)
    XCTAssertEqual(
      (field.value as? String)?.count ?? 0, count,
      "the keyboard did not put \(count) glyphs in the field")
    app.buttons["Send"].tap()
    Thread.sleep(forTimeInterval: 2.5)
    let sent = run(labelled: probe)
    guard sent.waitForExistence(timeout: 10) else {
      XCTFail("the message of \(count) glyphs never landed")
      return (fieldHeight, 0)
    }
    return (fieldHeight, sent.frame.height)
  }

  /**
   The field's height, with the keyboard UP.

   A docked bar is not the same width as a raised one — its trailing margin is
   28 against 16, which `DockCheck` measures — so its column is a dozen points
   narrower and wraps earlier. Typing through XCUITest goes down the hardware
   keyboard's path and the software keyboard sometimes leaves while it does,
   which docks the bar: measured there, the field's line count is a different
   question from the one this case is asking.
   */
  private func fieldHeightRaised(_ field: XCUIElement) -> CGFloat {
    let window = app.windows.element(boundBy: 0).frame
    /*
     * RAISED is read off the bar's position, not off `app.keyboards`: typing
     * through XCUITest goes down the hardware keyboard's path and the software
     * one sometimes leaves while it does, and what is left behind still answers
     * that query. The bar's own place in the window does not lie — docked, it
     * is against the bottom edge.
     */
    var tries = 0
    while field.frame.maxY > window.maxY - 120 && tries < 3 {
      field.tap()
      Thread.sleep(forTimeInterval: 1.2)
      tries += 1
    }
    XCTAssertLessThan(
      field.frame.maxY, window.maxY - 120,
      "the bar stayed docked, and a docked bar's column is a dozen points narrower than a raised "
        + "one — see `DockCheck`, which measures the two margins")
    return field.frame.height
  }

  /// A height in line boxes: what a reader counts.
  private func lines(_ height: CGFloat, over oneLine: CGFloat) -> Int {
    1 + Int((height - oneLine + lineBox / 2) / lineBox)
  }

  func testTheFieldAndTheBalloonBreakAtTheSameCharacter() throws {
    let field = app.textViews.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 20), "no composer field")
    field.tap()
    XCTAssertTrue(app.keyboards.element(boundBy: 0).waitForExistence(timeout: 10), "no keyboard")
    Thread.sleep(forTimeInterval: 1.0)
    let oneLine = fieldHeightRaised(field)

    for count in [fits, wraps] {
      if count != fits {
        field.tap()
        Thread.sleep(forTimeInterval: 0.5)
      }
      let sent = sendGlyphs(count, field)
      let inTheField = lines(sent.field, over: oneLine)
      let inTheBalloon = Int((sent.run + lineBox / 2) / lineBox)
      XCTAssertEqual(
        inTheField, inTheBalloon,
        "\(count) glyphs are \(inTheField) lines in the field and \(inTheBalloon) in the balloon: "
          + "the two columns are not the same width, so the message re-wraps as it is sent "
          + "(the field is \(field.frame), the keyboard count \(app.keyboards.count))")
      // And the calibration, which is what makes the comparison above a tight
      // one: these counts straddle the break, so a column that moved by a
      // glyph is caught rather than stepped over.
      XCTAssertEqual(
        inTheField, count == fits ? 1 : 2,
        "\(count) glyphs are \(inTheField) lines in the field, and this case is measured on a "
          + "402-point window where \(fits) fill one line and \(wraps) do not — re-measure both "
          + "counts for another window")
    }
  }
}
