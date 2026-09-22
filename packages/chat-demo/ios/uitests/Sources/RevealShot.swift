/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 Not a check: performs one slow timestamp-reveal drag so a `simctl io
 recordVideo` recording can measure the ink curve frame by frame. See
 ui-metrics.md, "Timestamp reveal ink curve".
 */
// covers: screens/ChatScreen.js reveal.js
final class RevealShot: DemoCase {
  override class var initialScreen: String? { "chat" }

  /**
   Slow, so the recording has enough frames to fit a curve; held, to show the
   ink follows the finger's position rather than time. The pull is long enough
   to reach the full 56 pt reveal through `resistedReveal`.
   */
  func testOneSlowPullHeldAtTheEnd() throws {
    let window = app.windows.element(boundBy: 0)
    XCTAssertTrue(appears(window, within: 20), "no window")
    // Start on a row: a drag from empty transcript space scrolls instead.
    let start = window.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.34))
    let end = window.coordinate(withNormalizedOffset: CGVector(dx: 0.02, dy: 0.34))
    // Still frames first, as the recording's baseline.
    Thread.sleep(forTimeInterval: 1.5)
    start.press(
      forDuration: 0.1, thenDragTo: end, withVelocity: 120, thenHoldForDuration: 2.0)
    Thread.sleep(forTimeInterval: 2.0)
  }
}
