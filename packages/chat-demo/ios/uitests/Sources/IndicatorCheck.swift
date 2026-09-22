/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 The chat's scroll indicator starts just below the header and ends above the
 composer (not one extra safe area lower, which is what
 `automaticallyAdjustsScrollIndicatorInsets = YES` adds).

 The indicator isn't an accessibility element and shows only while scrolling,
 so it is read from a screenshot taken during a held drag down from the
 earliest message (the rubber band keeps it at the top of its track).
 */
// covers: screens/ChatScreen.js
final class IndicatorCheck: DemoCase {
  override class var initialScreen: String? { "chat" }

  /// The indicator's top and bottom in window points, or nil if not found.
  /// Uses each row's darkest pixel near the trailing edge: an average over the
  /// band would wash out the 3 pt indicator.
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
    chooseCommand("Go to the earliest")
    settled(app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH 'Message '")).firstMatch)

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

    // The header title's bottom edge stands in for the header's.
    let title = app.staticTexts["Chat"].frame
    XCTAssertTrue(title.height > 0, "no header title to measure the content's top from")

    XCTAssertGreaterThan(
      bar.top, title.maxY,
      "the indicator starts at \(bar.top), above the header's title at \(title.maxY)")

    // Measured 24.7 pt below the title when correct and 140.7 pt with
    // `automaticallyAdjustsScrollIndicatorInsets = YES`; 45 sits between them.
    let doubleCounted: CGFloat = 45
    XCTAssertLessThan(
      bar.top - title.maxY, doubleCounted,
      "the indicator starts \(bar.top - title.maxY) points below the header's title, which is "
        + "about one safe area — `automaticallyAdjustsScrollIndicatorInsets` adding it a second "
        + "time is what that looks like")

    let plus = plusButton()
    XCTAssertTrue(plus.exists, "no + button to take the bar's position from")
    XCTAssertLessThanOrEqual(
      bar.bottom, plus.frame.minY,
      "the indicator runs to \(bar.bottom), under a composer whose top is \(plus.frame.minY)")
  }
}
