/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 The two numbers a balloon is, measured against the platform's own chat.

 Both were wrong until 2026-09-13 and neither is visible in a screenshot taken
 on its own — they are differences of a few points, and the only way to see them
 is beside the app they are copied from. So they are pinned here, at the values
 measured on the same simulator with the same strings:

 **A wrapped balloon hugs its longest line.** Shrink-to-fit stops at
 `min(max-content, max-width)` and max-content is the message on one line, so the
 moment a message wraps the balloon stands at its limit — 280.67 here — with the
 space the last line did not use drawn as balloon. The platform's balloons for
 these two openers are 269.26 and 252.62. `experimental_hugsWrappedLines` is what
 closes it.

 **The line box is 20, not the font's 20.2871.** `[UIFont systemFontOfSize:17]`
 reports 20.2871 and the platform does not draw messages on it: its one-line
 balloon is 40.00 tall and its two-line one exactly 60.00, and the ink in an
 eleven-line balloon steps by 20.000. At the font's own line height a two-line
 balloon is 60.57.

 Measured on the balloon's TEXT rather than on the balloon: the element the
 accessibility tree offers for a message is the run, and the balloon is that plus
 its padding — 14 points on each side and 10 above and below, both measured off
 the platform. So the platform's 269.26-wide balloon is a 241.26-wide run, and
 its 60.00-tall one is a 40.00-tall run.

 A point of tolerance, which is the resolution of the screenshots the platform
 numbers were read from — and far tighter than either defect (11.4 points of
 width, 0.6 of height).
 */
final class BalloonShapeCheck: DemoCase {
  override class var initialScreen: String? { "chat" }

  private func balloon(containing text: String) -> XCUIElement {
    app.descendants(matching: .any)
      .matching(NSPredicate(format: "label CONTAINS %@", text))
      .firstMatch
  }

  func testAWrappedBalloonHugsItsLongestLine() throws {
    XCTAssertTrue(app.textViews.firstMatch.waitForExistence(timeout: 20))

    let opener = balloon(containing: "Did the keyboard cover the last")
    XCTAssertTrue(opener.waitForExistence(timeout: 20), "the transcript never appeared")
    XCTAssertEqual(
      opener.frame.width, 241.3, accuracy: 1.0,
      "a wrapped run must report its longest line — the platform's balloon is 269.26 wide around "
        + "241.26 of text, and the limit it would otherwise stand at is 280.67")

    let third = balloon(containing: "The bar follows the keyboard")
    XCTAssertTrue(third.exists, "the third opener is missing")
    XCTAssertEqual(
      third.frame.width, 224.6, accuracy: 1.0,
      "and a shorter longest line makes a narrower balloon: the platform's is 252.62 around "
        + "224.62 of text")
  }

  func testATwoLineBalloonIsTwoLineBoxesAndItsPadding() throws {
    XCTAssertTrue(app.textViews.firstMatch.waitForExistence(timeout: 20))

    let opener = balloon(containing: "Did the keyboard cover the last")
    XCTAssertTrue(opener.waitForExistence(timeout: 20), "the transcript never appeared")
    /*
     * Half a point, and it has to be: the whole defect is 0.57 of one. At the
     * font's own line height this run is 40.57 rather than 40.00, which a
     * point of tolerance would wave through — the accuracy IS the assertion.
     */
    XCTAssertEqual(
      opener.frame.height, 40.0, accuracy: 0.5,
      "two 20-point line boxes: the font's own 20.2871 would make this 40.57, and the balloon "
        + "around it 60.57 where the platform's is exactly 60.00")
  }

  /**
   A balloon is never narrower than the platform's floor.

   Messages does not let a balloon shrink to its text. Measured against it on
   the simulator, which sends to itself: a one-character message and a "."
   both come out at exactly 48.00 points wide — identical, so it is a minimum
   and not those glyphs' width. Ours had no floor at all and drew 32.33, an egg
   where the platform draws a circle.

   It is also what keeps the tail's outline whole. The tail's span is
   `min(22, w - r)`, and below about forty points that clamp bites while the
   control points steering the curve to it do not move — so the curve overshoots
   its own endpoint and doubles back, a notch in the bottom edge, reported from
   a device. At the floor the span is never clamped and the state cannot arise.
   Asserted on the WIDTH rather than on the outline because the width is the
   cause and an outline test that cannot fail on the bug is worse than none.
   */
  func testAOneCharacterBalloonKeepsThePlatformsMinimumWidth() throws {
    let field = app.textViews.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 20), "no composer field")
    field.tap()
    app.typeText("I")
    let send = app.buttons["Send"]
    XCTAssertTrue(send.waitForExistence(timeout: 8), "no send button with a draft")
    send.tap()
    XCTAssertTrue(text("I").waitForExistence(timeout: 10), "the message never arrived")
    // The flight and the settle, so the balloon is at its resting size.
    Thread.sleep(forTimeInterval: 3.0)

    /*
     * Read in PIXELS, because the accessibility frame for a message is its text
     * run and the floor is a property of the balloon around it. The balloon is
     * the only blue thing in its row.
     */
    let pixels = try self.pixels()
    let window = app.windows.element(boundBy: 0).frame
    var widest: CGFloat = 0
    var y = window.height * 0.25
    while y < window.height * 0.80 {
      var left: CGFloat = -1
      var right: CGFloat = -1
      var x: CGFloat = 0
      while x < window.width {
        let c = pixels.at(x: x, y: y)
        if c.b > 150 && c.b - c.r > 60 && c.b - c.g > 30 {
          if left < 0 { left = x }
          right = x
        }
        x += 1
      }
      if right > left, right - left < 90 { widest = max(widest, right - left + 1) }
      y += 1
    }
    XCTAssertGreaterThan(widest, 0, "no narrow balloon found to measure")
    XCTAssertEqual(
      widest, 48.0, accuracy: 1.5,
      "the balloon for a one-character message is \(widest) points wide. The "
        + "platform's floor is 48.00, measured off Messages; below about forty the "
        + "tail's curve overshoots where it rejoins and notches the bottom edge.")
  }
}
