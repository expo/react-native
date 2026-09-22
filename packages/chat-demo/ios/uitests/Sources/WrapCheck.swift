/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 The composer field and the sent balloon wrap at the same character, so a
 message keeps its line breaks when sent. Depends on `SEND_INSET_TRAILING` and
 the field's `paddingRight` in Composer.js. See ui-metrics.md, "Text column:
 composer field vs balloon".
 */
// covers: Composer.js screens/ChatScreen.js
final class WrapCheck: DemoCase {
  override class var initialScreen: String? { "chat" }

  /// Height of one line of message text. See ui-metrics.md, "Message line
  /// height".
  private let lineBox: CGFloat = 20
  // On a 402 pt window, 66 narrow glyphs fill one line of the field and 67
  // wrap (one glyph is 3.74 pt). Other window widths need new counts.
  private let fits = 66
  private let wraps = 67

  private func run(labelled label: String) -> XCUIElement {
    app.descendants(matching: .any)
      .matching(NSPredicate(format: "label == %@", label))
      .firstMatch
  }

  /// In chunks through the hardware-key path; `fieldHeightRaised` re-raises the
  /// keyboard if that took it down, so the field is read at its raised width.
  private func type(_ string: String, into field: XCUIElement) {
    typeInChunks(string)
  }

  /// Types `count` glyphs and sends them. Returns the field's height before the
  /// send and the sent message's text height.
  private func sendGlyphs(_ count: Int, _ field: XCUIElement) -> (field: CGFloat, run: CGFloat) {
    // Starts with a capital because the keyboard capitalises the first letter.
    let probe = "I" + String(repeating: "i", count: count - 1)
    type(probe, into: field)
    settled(field)
    let fieldHeight = fieldHeightRaised(field)
    XCTAssertEqual(
      (field.value as? String)?.count ?? 0, count,
      "the keyboard did not put \(count) glyphs in the field")
    app.buttons["Send"].tap()
    let sent = run(labelled: probe)
    guard appears(sent, within: 10) else {
      XCTFail("the message of \(count) glyphs never landed")
      return (fieldHeight, 0)
    }
    return (fieldHeight, settled(sent).height)
  }

  /// The field's height, after making sure the bar is raised: docked, the bar's
  /// side margins are 28 pt instead of 16, so the field wraps earlier.
  private func fieldHeightRaised(_ field: XCUIElement) -> CGFloat {
    let window = app.windows.element(boundBy: 0).frame
    // Checked by the field's position, not `app.keyboards`, which can still
    // report a keyboard that XCUITest typing has taken down.
    var tries = 0
    while field.frame.maxY > window.maxY - 120 && tries < 3 {
      field.tap()
      waitForKeyboard(over: field)
      tries += 1
    }
    XCTAssertLessThan(
      field.frame.maxY, window.maxY - 120,
      "the bar stayed docked, and a docked bar's column is a dozen points narrower than a raised "
        + "one — see `DockCheck`, which measures the two margins")
    return field.frame.height
  }

  /// The number of lines in a field of this height.
  private func lines(_ height: CGFloat, over oneLine: CGFloat) -> Int {
    1 + Int((height - oneLine + lineBox / 2) / lineBox)
  }

  func testTheFieldAndTheBalloonBreakAtTheSameCharacter() throws {
    let field = app.textViews.firstMatch
    XCTAssertTrue(appears(field, within: 20), "no composer field")
    field.tap()
    waitForKeyboard(over: field)
    let oneLine = fieldHeightRaised(field)

    for count in [fits, wraps] {
      if count != fits {
        field.tap()
        settled(field)
      }
      let sent = sendGlyphs(count, field)
      let inTheField = lines(sent.field, over: oneLine)
      let inTheBalloon = Int((sent.run + lineBox / 2) / lineBox)
      XCTAssertEqual(
        inTheField, inTheBalloon,
        "\(count) glyphs are \(inTheField) lines in the field and \(inTheBalloon) in the balloon: "
          + "the two columns are not the same width, so the message re-wraps as it is sent "
          + "(the field is \(field.frame), the keyboard count \(app.keyboards.count))")
      // The counts must straddle the field's break, or the check above is loose.
      XCTAssertEqual(
        inTheField, count == fits ? 1 : 2,
        "\(count) glyphs are \(inTheField) lines in the field, and this case is measured on a "
          + "402-point window where \(fits) fill one line and \(wraps) do not — re-measure both "
          + "counts for another window")
    }
  }
}
