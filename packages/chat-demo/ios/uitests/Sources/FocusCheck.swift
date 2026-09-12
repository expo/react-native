/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 Tapping the field raises the keyboard. EVERY time.

 Reported from a device: "sometimes when I tap on the text area it doesn't bring
 up the keyboard. I have not had this problem with [the native chat]."
 Intermittent, so the only honest instrument is a COUNT — a single tap that
 happens to work says nothing, and a single tap that happens to fail says
 nothing either.

 The suspicion it was written to test: the field's `<textarea>` now lives inside
 the glass effect view, because that is what makes `UIGlassEffect.interactive`
 see the touch at all. An effect view with `interactive` on does its own touch
 handling, and "sometimes" is the shape of two things arbitrating for the same
 tap.

 Twelve rounds rather than three. At a failure rate of one in four — which is
 roughly what "sometimes" describes — three rounds miss it a third of the time
 and would report a fix that fixed nothing.
 */
final class FocusCheck: DemoCase {
  override class var initialScreen: String? { "chat" }

  func testTappingTheFieldAlwaysRaisesTheKeyboard() throws {
    let field = app.textViews.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 15), "no composer field")

    var failures: [Int] = []
    for round in 0..<12 {
      field.tap()
      let raised = app.keyboards.element(boundBy: 0).waitForExistence(timeout: 3)
      if !raised { failures.append(round) }

      /*
       * Put it away between rounds by the DRAG, not the panel. The panel cost
       * every round an open-choose-close cycle — three seconds of UI that is
       * not under test — and the original worry ("a drag that misses would
       * look like a focus failure on the NEXT round") is already answered
       * inside `dismissKeyboard`: it asserts its own success, so a missed drag
       * fails loudly as a dismissal, here, not as a focus failure later.
       */
      if raised {
        dismissKeyboard()
      }
      // No settling nap: the dismissal is asserted above, and `tap()` itself
      // waits for quiescence before the next round's touch.
    }

    XCTAssertTrue(
      failures.isEmpty,
      "the keyboard did not appear on \(failures.count) of 12 taps (rounds "
        + "\(failures)) — the tap is being taken by something other than the "
        + "text view, and the glass effect view the field now sits inside is "
        + "the thing that started handling touches")
  }

  /**
   EVERY point in the field raises it, including the leading edge.

   That edge is where "sometimes" turned out to live. A form control is laid out
   in its CONTENT box — inside its padding, which is where padding belongs on a
   control — so the padding strip belonged to the container and a touch there
   reached nothing. On this composer that is fifteen points down the field's
   leading edge, between the pill's edge and the first glyph, and a tap in it did
   nothing at all: measured on the simulator, ten failures out of ten at x=92
   against zero at x=98.

   Sampled across the field rather than at one place, because a dead strip is
   found by where you press and the middle always worked.
   */
  func testEveryPointInTheFieldRaisesTheKeyboard() throws {
    let field = app.textViews.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 15), "no composer field")

    // The leading edge first: it is the one that was dead, and a run that fails
    // there should say so before it has done anything else.
    var dead: [Double] = []
    for dx in [0.0, 0.02, 0.25, 0.5, 0.9] {
      field.coordinate(withNormalizedOffset: CGVector(dx: dx, dy: 0.5)).tap()
      let raised = app.keyboards.element(boundBy: 0).waitForExistence(timeout: 3)
      if !raised { dead.append(dx) }
      if raised {
        // The asserted drag, for the same reasons as the twelve-round case.
        dismissKeyboard()
      }
    }

    XCTAssertTrue(
      dead.isEmpty,
      "the keyboard did not appear for taps at \(dead) across the field — a "
        + "control's hit area is its border box, and a strip of it is reaching "
        + "the container instead of the control")
  }
}
