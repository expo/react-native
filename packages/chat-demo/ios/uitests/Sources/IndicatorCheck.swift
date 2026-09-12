/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 The scroll indicator starts where the content does, not one safe area lower.

 Reported against all three screens at once: "there's a bug where the scroll bar
 starts too low. It's like one extra top safe area too low." It was —
 `UIScrollView.automaticallyAdjustsScrollIndicatorInsets` defaults to YES and
 ADDS the safe area to whatever `verticalScrollIndicatorInsets` is set to, so a
 view that derives its indicator insets from the obstruction it already knows
 about pays for the top twice. The platform's own transcript sets the same flag to
 NO for the same reason.

 Nothing else in this suite would catch it coming back. The indicator is not an
 accessibility element, it is three points wide, and it is on screen only while
 the content is moving — so it is invisible to every element query and to every
 screenshot taken at rest.

 Three things make it observable, and each was necessary:

 - **From the EARLIEST**, so the indicator is at the top of its own track. From
   anywhere else its position is a fraction of the content's length and says
   nothing about the inset.
 - **Dragging DOWN**, into the rubber band. That keeps the content pinned at
   offset zero while still moving it, so the indicator stays at the track's top
   for the whole gesture instead of sliding away from it.
 - **Held**, because it fades the moment the finger leaves. A screenshot after a
   completed swipe finds nothing, which reads as "no indicator" and would pass
   this case by accident — so a missing indicator is a failure here, not a skip.
 */
final class IndicatorCheck: DemoCase {
  override class var initialScreen: String? { "chat" }

  /**
   The indicator's vertical extent in points, or nil if it is not on screen.

   Measured at x = width − 5, which is where it is: sampled on this device it
   occupies 396 to 398 of a 402-point window. A per-row MINIMUM rather than an
   average, because averaging a three-point capsule across a wider band dilutes
   it into the white page and finds nothing.
   */
  private func indicatorSpan(_ pixels: Pixels, window: CGRect) -> (top: CGFloat, bottom: CGFloat)? {
    var top: CGFloat?
    var bottom: CGFloat?
    var y = window.minY
    while y < window.maxY {
      var darkest = 255
      var x = window.maxX - 6
      while x <= window.maxX - 3 {
        let c = pixels.at(x: x, y: y)
        darkest = min(darkest, max(c.r, max(c.g, c.b)))
        x += 1
      }
      if darkest < 215 {
        if top == nil { top = y }
        bottom = y
      }
      y += 1
    }
    guard let t = top, let b = bottom, b - t > 20 else { return nil }
    return (t, b)
  }

  func testTheIndicatorStartsAtTheTopOfTheContentArea() throws {
    chooseCommand("Add fifty messages")
    Thread.sleep(forTimeInterval: 1.0)
    chooseCommand("Go to the earliest")
    Thread.sleep(forTimeInterval: 1.5)

    let window = app.windows.element(boundBy: 0).frame
    let from = app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.34))
    let to = app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.49))

    var span: (top: CGFloat, bottom: CGFloat)?
    for _ in 0..<3 {
      from.press(
        forDuration: 0.05,
        thenDragTo: to,
        withVelocity: .slow,
        thenHoldForDuration: 1.2)
      span = indicatorSpan(try pixels(), window: window)
      if span != nil { break }
      Thread.sleep(forTimeInterval: 1.0)
    }
    let bar = try XCTUnwrap(span, "no scroll indicator found against the trailing edge")

    /*
     * The header's own bottom is what the indicator's track begins under, and
     * the title is the only part of it this test can name. Its bottom edge is
     * therefore the reference, with the bar's remaining chrome inside the
     * allowance below.
     */
    let title = app.staticTexts["Chat"].frame
    XCTAssertTrue(title.height > 0, "no header title to measure the content's top from")

    XCTAssertGreaterThan(
      bar.top, title.maxY,
      "the indicator starts at \(bar.top), above the header's title at \(title.maxY)")

    /*
     * FORTY-FIVE, and the number is chosen from the fault rather than from the
     * fit — both ends of it MEASURED by putting the bug back.
     *
     *     correct                                 24.7 points under the title
     *     `automaticallyAdjustsScrollIndicatorInsets = YES`   140.7
     *
     * The gap is larger than one bare safe area because the inset UIKit adds it
     * to already contains the header and the transcript's own top space, so the
     * second count compounds. Forty-five sits in the middle of a 116-point gulf,
     * which is what lets it survive a device with different chrome instead of
     * failing on the next one.
     */
    let doubleCounted: CGFloat = 45
    XCTAssertLessThan(
      bar.top - title.maxY, doubleCounted,
      "the indicator starts \(bar.top - title.maxY) points below the header's title, which is "
        + "about one safe area — `automaticallyAdjustsScrollIndicatorInsets` adding it a second "
        + "time is what that looks like")

    /*
     * And it ends above the composer, because the bar is an obstruction the
     * scroll view already reserves. An indicator running under it is the same
     * mistake at the other end, and it is reachable from here: the bar's height
     * is the accessory's, and the accessory stopped reserving the home
     * indicator's strip when the composer took `automaticInsets={false}`.
     */
    let plus = plusButton()
    XCTAssertTrue(plus.exists, "no + button to take the bar's position from")
    XCTAssertLessThanOrEqual(
      bar.bottom, plus.frame.minY,
      "the indicator runs to \(bar.bottom), under a composer whose top is \(plus.frame.minY)")
  }
}
