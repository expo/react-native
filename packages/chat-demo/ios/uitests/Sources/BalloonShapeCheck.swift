/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 Balloon sizes match native Messages for the same strings. The first two tests
 read the message's text run (its accessibility element), which is the balloon
 less 14 pt of padding each side and 10 pt top and bottom. See ui-metrics.md,
 "Balloon text inset".
 */
// covers: screens/ChatScreen.js
final class BalloonShapeCheck: DemoCase {
  override class var initialScreen: String? { "chat" }

  private func balloon(containing text: String) -> XCUIElement {
    app.descendants(matching: .any)
      .matching(NSPredicate(format: "label CONTAINS %@", text))
      .firstMatch
  }

  /// A wrapped balloon is as wide as its longest line, not its max width. See
  /// ui-metrics.md, "Wrapped balloon width".
  func testBalloonsHugTheirLongestLineStandTwoLineBoxesTallAndKeepTheMinimumWidth() throws {
    try XCTContext.runActivity(named: "a wrapped balloon hugs its longest line") { _ in
      XCTAssertTrue(appears(app.textViews.firstMatch, within: 20))

      let opener = balloon(containing: "Did the keyboard cover the last")
      XCTAssertTrue(appears(opener, within: 20), "the transcript never appeared")
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

    try XCTContext.runActivity(named: "a two-line balloon is two line boxes and its padding") { _ in
      XCTAssertTrue(appears(app.textViews.firstMatch, within: 20))

      let opener = balloon(containing: "Did the keyboard cover the last")
      XCTAssertTrue(appears(opener, within: 20), "the transcript never appeared")
      // Two 20 pt lines. Within 0.5 pt, because the font's own line height would
      // give 40.57. See ui-metrics.md, "Message line height".
      XCTAssertEqual(
        opener.frame.height, 40.0, accuracy: 0.5,
        "two 20-point line boxes: the font's own 20.2871 would make this 40.57, and the balloon "
          + "around it 60.57 where the platform's is exactly 60.00")
    }

    try XCTContext.runActivity(named: "a one-character balloon keeps the minimum width") { _ in
      let field = app.textViews.firstMatch
      XCTAssertTrue(appears(field, within: 20), "no composer field")
      field.tap()
      type("I")
      let send = app.buttons["Send"]
      XCTAssertTrue(appears(send, within: 8), "no send button with a draft")
      send.tap()
      XCTAssertTrue(appears(text("I"), within: 10), "the message never arrived")
      // The send's flight, and the receipt beneath it
      settled(text("I"))
      XCTAssertTrue(appears(text("Delivered"), within: 8), "no receipt under the sent balloon")

      // In pixels, because the accessibility frame is the text run, not the
      // balloon. The balloon is the only blue in its row.
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
}
