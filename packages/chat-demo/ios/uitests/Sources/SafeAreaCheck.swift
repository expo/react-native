/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 The scroll view's top inset, and UIKit's scroll-to-top.

 Two fixes that took a device trace each, asserted here so neither can go back
 silently.

 **A scroll view rests at MINUS its top inset.** So a top inset that arrives
 after the content leaves the view scrolled by exactly that much — which is what
 "the demo starts already scrolled" was, with the first row under the clock.
 `contentInsetAdjustmentBehavior` is `Never` here on purpose (UIKit has no mode
 for "the top but not the bottom"), so the element composes the inset itself and
 has to move the offset to match. The demo prints the offset, so the resting
 position is readable rather than inferred.

 **The large title flickered on tap-status-bar-to-top.** During that scroll the
 title expands, changing this view's safe-area top every frame, and the element
 was adjusting the offset by that delta — two things writing the same number.
 The guard that should have caught it tested `layer.animationKeys`, which is
 EMPTY during a scroll-to-top; proven from a device trace reading
 `topDelta=52.0 applied=1 (track=0 decel=0 anim=0)`. It is bracketed by UIKit's
 own `scrollViewShouldScrollToTop:` / `scrollViewDidScrollToTop:` now.
 */
final class SafeAreaCheck: DemoCase {
  /// The offset the demo reports, in points.
  private func reportedOffset() -> CGFloat? {
    let readout = app.descendants(matching: .any)
      .matching(NSPredicate(format: "label BEGINSWITH 'contentOffset '"))
      .firstMatch
    guard readout.exists else { return nil }
    // "contentOffset -168pt. A scroll view rests at…"
    let words = readout.label.split(separator: " ")
    guard words.count > 1 else { return nil }
    return CGFloat(Double(words[1].replacingOccurrences(of: "pt.", with: "")) ?? .nan)
  }

  func testItOpensAtTheTopAndNotScrolledPastIt() throws {
    let offset = try XCTUnwrap(reportedOffset(), "no offset readout")

    /*
     * NEGATIVE, and equal to the top inset. Zero would mean the inset never
     * reached the offset — the content would start under the navigation bar,
     * which is the bug — and a positive number would mean it opened part-way
     * down its own content.
     */
    XCTAssertLessThan(
      offset, -20,
      "the view is resting at \(offset), so the top inset did not move the offset with it")

    /*
     * And the claim that number stands for: the content's own first thing is
     * visible, below the bar rather than behind it.
     *
     * The legend's heading, not `row 1` — the rows come after three sections,
     * so "row 1 is on screen" is false at rest for reasons that have nothing to
     * do with the inset. A guard that fails for the wrong reason is worse than
     * none.
     */
    XCTAssertTrue(
      isOnScreen(text("What the colours are")),
      "the top of the content is not on screen, so whatever the offset says the top is wrong")
  }

  func testTappingTheStatusBarReturnsToTheSameRestingPosition() throws {
    let resting = try XCTUnwrap(reportedOffset(), "no offset readout")

    let list = app.scrollViews.firstMatch
    for _ in 0..<6 {
      list.swipeUp(velocity: .fast)
    }
    Thread.sleep(forTimeInterval: 1.0)
    let scrolled = try XCTUnwrap(reportedOffset(), "no offset readout after scrolling")
    XCTAssertGreaterThan(
      scrolled, resting + 100, "the list did not move, so this proves nothing")

    /*
     * UIKit's own scroll-to-top, triggered the way a person triggers it.
     *
     * The status bar belongs to SpringBoard, not to this app — `app.statusBars`
     * matches nothing — so the tap has to be aimed at the system's own element.
     */
    /*
     * Aimed through SPRINGBOARD, not through this app.
     *
     * The status bar is the system's, and a tap addressed to the app's own
     * window at the same point does not trigger scroll-to-top — verified, and
     * verified in the other direction too: the same tap driven by `idb` at
     * (200, 8) scrolls the list perfectly, so the behaviour works and it is the
     * aim that was wrong.
     */
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.0))
      .withOffset(CGVector(dx: 0, dy: 8))
      .tap()
    Thread.sleep(forTimeInterval: 3.0)

    let returned = try XCTUnwrap(reportedOffset(), "no offset readout after scrolling to top")
    /*
     * Back to the SAME resting position, not merely near the top.
     *
     * An offset that lands anywhere else is the symptom of the delta being
     * applied during UIKit's scroll: the inset moves under it, the offset is
     * nudged, and the view comes to rest somewhere the element chose rather
     * than where UIKit put it.
     */
    XCTAssertEqual(
      returned, resting, accuracy: 1.0,
      "scroll-to-top ended at \(returned) but the resting position is \(resting)")
    XCTAssertTrue(
      isOnScreen(text("What the colours are")),
      "the top of the content is not visible after scrolling to the top")
  }
}
