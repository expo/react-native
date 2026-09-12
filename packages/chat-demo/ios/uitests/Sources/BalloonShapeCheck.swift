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
}
