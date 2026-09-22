/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 Drives the timestamp reveal slowly enough to be filmed.

 A recorder rather than an assertion, because a CURVE is what is under test and
 a host recording is the instrument for one — `simctl io recordVideo` alongside
 this case, read frame by frame, which is how the platform's own capture was
 measured, so the two are comparable. `RevealCheck` holds the two points a case
 can decide; this is for the shape between them.

 What it read: over the 161 frames of the pull the drawn ink sits 0.015 rms from
 `p^2.2`, worst point 0.029, against 0.16 for a linear fade. Over the 125 frames
 of the hold the balloon does not move and the ink varies by 0.009. The release
 comes back down the same curve.
 */
final class RevealShot: DemoCase {
  override class var initialScreen: String? { "chat" }

  /**
   One slow pull the width of the screen, held, and let go.

   Slow because the reading is per frame: at the default velocity the whole
   reveal is over in a third of a second and there are twenty frames to fit a
   curve to. The hold is what proves the fade is driven by POSITION — the ink
   must sit still while the finger does, and a timed fade would carry on. The
   release is filmed too, for the spring back down.

   The pull is long enough to reach the settled state through the rubber band:
   `resistedReveal` gives 56 points of reveal for about 370 of finger, which is
   most of a 402-point window.
   */
  func testOneSlowPullHeldAtTheEnd() throws {
    let window = app.windows.element(boundBy: 0)
    XCTAssertTrue(window.waitForExistence(timeout: 20), "no window")
    /* Started on a ROW: the reveal's responder is on the rows, and a drag that
       begins in the transcript's empty space belongs to the scroll view. */
    let start = window.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.34))
    let end = window.coordinate(withNormalizedOffset: CGVector(dx: 0.02, dy: 0.34))
    // A beat of still frames first, so the reading has a rest state to
    // subtract — the ink at nothing is what everything else is measured from.
    Thread.sleep(forTimeInterval: 1.5)
    start.press(
      forDuration: 0.1, thenDragTo: end, withVelocity: 120, thenHoldForDuration: 2.0)
    Thread.sleep(forTimeInterval: 2.0)
  }
}
