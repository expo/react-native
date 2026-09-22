/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 A received balloon keeps its grey when long-pressed (lifted). UIKit's lift
 platter is clear, so the fill must be opaque (`BUBBLE_GREY` in ChatScreen.js)
 or the balloon darkens over the dimmed page.
 */
// covers: screens/ChatScreen.js reactions.js
final class LiftCheck: DemoCase {
  override class var initialScreen: String? { "chat" }

  func testALiftedReceivedBalloonKeepsItsGrey() throws {
    let balloon = text("Did the keyboard cover the last message?")
    XCTAssertTrue(appears(balloon, within: 10), "no balloon to hold")
    let frame = balloon.frame
    let window = app.windows.element(boundBy: 0).frame
    // Right of the short second line's words: balloon fill both at rest and
    // lifted (the lift scales about the balloon's centre).
    let row = frame.maxY - 12
    let x0 = frame.maxX - 60
    let x1 = frame.maxX - 12
    let pageX = (frame.maxX + window.maxX) / 2

    let rest = try pixels()
    let restFill = rest.rowAverage(y: row, from: x0, to: x1)
    let restPage = rest.at(x: pageX, y: row)
    // The received balloon's grey. See ui-metrics.md, "Received balloon grey".
    XCTAssertLessThanOrEqual(
      distance(restFill, (r: 233, g: 233, b: 235)), 6,
      "the spot sampled at rest is not the received grey but \(restFill) — "
        + "the row runs through glyphs or off the balloon; frame \(frame)")

    hold(balloon)
    XCTAssertTrue(
      appears(app.buttons["Copy"], within: 4),
      "the hold opened no menu; visible: \(visibleText())")

    let lifted = try pixels()
    let liftedPage = lifted.at(x: pageX, y: row)
    XCTAssertGreaterThan(
      distance(liftedPage, restPage), 20,
      "the page beside the balloon is not dimmed (\(restPage) → \(liftedPage)), "
        + "so the balloon was not lifted when the screenshot was taken")
    let liftedFill = lifted.rowAverage(y: row, from: x0, to: x1)
    XCTAssertLessThanOrEqual(
      distance(liftedFill, restFill), 8,
      "the lifted balloon's fill is \(liftedFill) against \(restFill) at rest — "
        + "the fill is composing over the dimmed page, not over the page's colour")

    app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.12)).tap()
  }
}
