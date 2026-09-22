/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 Every tap on the composer field raises the keyboard. Repeated twelve times
 because a failure would be intermittent: the field sits inside an interactive
 glass effect view, which handles touches too.
 */
// covers: Composer.js
final class FocusCheck: DemoCase {
  override class var initialScreen: String? { "chat" }

  /// Twelve taps, then a tap at every point across the field, in one launch:
  /// both start and end with the keyboard down.
  /*
   A tap anywhere across the field raises the keyboard, including on its leading
   padding (about 15 pt between the pill's edge and the first glyph): a
   control's hit area includes its padding.
   */
  func testEveryTapAndEveryPointInTheFieldRaisesTheKeyboard() throws {
    try XCTContext.runActivity(named: "twelve taps on the field") { _ in
      let field = app.textViews.firstMatch
      XCTAssertTrue(appears(field, within: 15), "no composer field")

      var failures: [Int] = []
      for round in 0..<12 {
        field.tap()
        let raised = appears(app.keyboards.element(boundBy: 0), within: 3)
        if !raised { failures.append(round) }

        if raised {
          dismissKeyboard()
        }
      }

      XCTAssertTrue(
        failures.isEmpty,
        "the keyboard did not appear on \(failures.count) of 12 taps (rounds "
          + "\(failures)) — the tap is being taken by something other than the "
          + "text view, and the glass effect view the field now sits inside is "
          + "the thing that started handling touches")
    }

    try XCTContext.runActivity(named: "a tap at every point across the field") { _ in
      let field = app.textViews.firstMatch
      XCTAssertTrue(appears(field, within: 15), "no composer field")

      var dead: [Double] = []
      for dx in [0.0, 0.02, 0.25, 0.5, 0.9] {
        field.coordinate(withNormalizedOffset: CGVector(dx: dx, dy: 0.5)).tap()
        let raised = appears(app.keyboards.element(boundBy: 0), within: 3)
        if !raised { dead.append(dx) }
        if raised {
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
}
