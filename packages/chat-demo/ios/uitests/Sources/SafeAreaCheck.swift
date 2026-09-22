/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 The home screen's list opens at its resting offset (minus its top inset, with
 the content's top visible), and tapping the status bar scrolls it back to that
 same offset.
 */
// covers: App.js
final class SafeAreaCheck: DemoCase {
  /// The y offset, in points, from the home screen's readout.
  private func reportedOffset() -> CGFloat? {
    let readout = app.descendants(matching: .any)
      .matching(NSPredicate(format: "label BEGINSWITH 'contentOffset '"))
      .firstMatch
    guard readout.exists else { return nil }
    // Must match `ReadoutLine` in App.js: "contentOffset  -168 pt".
    let words = readout.label.split(separator: " ")
    guard words.count > 1 else { return nil }
    return CGFloat(Double(words[1].replacingOccurrences(of: "pt.", with: "")) ?? .nan)
  }

  func testItOpensAtTheTopAndTheStatusBarReturnsToTheSameRestingPosition() throws {
    try XCTContext.runActivity(named: "opens at the top") { _ in
      let offset = try XCTUnwrap(reportedOffset(), "no offset readout")

      // At rest the offset is minus the top inset; 0 would put the content under
      // the navigation bar.
      XCTAssertLessThan(
        offset, -20,
        "the view is resting at \(offset), so the top inset did not move the offset with it")

      // The legend's heading is the content's first element; `row 1` is below the
      // fold even when the offset is right.
      XCTAssertTrue(
        isOnScreen(text("What the colours are")),
        "the top of the content is not on screen, so whatever the offset says the top is wrong")
    }

    try XCTContext.runActivity(named: "the status bar returns it to the resting offset") { _ in
      let resting = try XCTUnwrap(reportedOffset(), "no offset readout")

      let list = app.scrollViews.firstMatch
      for _ in 0..<6 {
        list.swipeUp(velocity: .fast)
      }
      XCTAssertTrue(waitUntil(5) { (reportedOffset() ?? resting) > resting + 100 }, "the list did not move")
      let scrolled = try XCTUnwrap(reportedOffset(), "no offset readout after scrolling")
      XCTAssertGreaterThan(
        scrolled, resting + 100, "the list did not move, so this proves nothing")

      // Tap the status bar through SpringBoard: `app.statusBars` matches nothing,
      // and a tap on the app's window at the same point doesn't scroll to top.
      let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
      springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.0))
        .withOffset(CGVector(dx: 0, dy: 8))
        .tap()
      // The scroll to the top, and the readout catching up with it
      _ = waitUntil(8) { abs((reportedOffset() ?? .infinity) - resting) < 1 }

      let returned = try XCTUnwrap(reportedOffset(), "no offset readout after scrolling to top")
      // The large title changes the safe area during scroll-to-top; that must not
      // shift the offset, so the list returns to its starting offset.
      XCTAssertEqual(
        returned, resting, accuracy: 1.0,
        "scroll-to-top ended at \(returned) but the resting position is \(resting)")
      XCTAssertTrue(
        isOnScreen(text("What the colours are")),
        "the top of the content is not visible after scrolling to the top")
    }
  }
}
