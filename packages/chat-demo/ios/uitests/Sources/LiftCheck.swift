/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 A lifted balloon keeps its colour.

 The received balloon's fill is a system fill with alpha, which is the balloon's
 grey only over the page it sits on. A lift renders the balloon on a platter and
 dims the page behind it; the platter has to carry the page's colour, or the
 fill composes over the dimmed page and the lifted balloon reads darker and
 see-through, which the sent balloon — an opaque fill — never does.

 Sampled at a spot inside the balloon that is fill on both screenshots: the
 second text line is short, so the row through it is fill to the right of the
 words, and a lift scales the balloon outward about its centre, so a point
 inside the balloon at rest is inside it lifted.

 Guarded both ways: the rest sample has to be the balloon's grey (or the spot is
 not fill and the comparison means nothing), and the page beside the balloon has
 to be dimmed on the lifted screenshot (or nothing was lifted and the comparison
 is of the screen with itself).
 */
final class LiftCheck: DemoCase {
  override class var initialScreen: String? { "chat" }

  func testALiftedReceivedBalloonKeepsItsGrey() throws {
    let balloon = text("Did the keyboard cover the last message?")
    XCTAssertTrue(balloon.waitForExistence(timeout: 10), "no balloon to hold")
    let frame = balloon.frame
    let window = app.windows.element(boundBy: 0).frame
    let row = frame.maxY - 12
    let x0 = frame.maxX - 60
    let x1 = frame.maxX - 12
    let pageX = (frame.maxX + window.maxX) / 2

    let rest = try pixels()
    let restFill = rest.rowAverage(y: row, from: x0, to: x1)
    let restPage = rest.at(x: pageX, y: row)
    XCTAssertLessThanOrEqual(
      distance(restFill, (r: 233, g: 233, b: 235)), 6,
      "the spot sampled at rest is not the received grey but \(restFill) — "
        + "the row runs through glyphs or off the balloon; frame \(frame)")

    balloon.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
      .press(forDuration: 0.9)
    XCTAssertTrue(
      app.buttons["Copy"].waitForExistence(timeout: 4),
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
