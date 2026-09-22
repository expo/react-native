/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 The composer bar's margins match native Messages: 28 pt from the screen's
 sides and bottom when docked (concentric with the display's rounded corner),
 16 pt at the sides when raised, and the raised `+` at the same height. See
 ui-metrics.md, "Composer landmarks, docked".
 */
// covers: Composer.js
final class DockCheck: DemoCase {
  override class var initialScreen: String? { "chat" }

  /// Must match `COMPOSER_CONCENTRIC` in Composer.js.
  private let concentric: CGFloat = 28
  /// Must match `COMPOSER_MARGIN` and `COMPOSER_MARGIN_TRAILING` in Composer.js.
  /// See ui-metrics.md, "Composer side margins".
  private let raisedLeading: CGFloat = 16
  private let raisedTrailing: CGFloat = 16

  /**
   One launch, docked reads then raised: docked, the `+` starts 28 pt in and
   ends 28 pt above the screen's bottom edge (inside the 34 pt safe area, which
   needs `automaticInsets={false}` on the `<native:keyboardaccessory>`); raised,
   it starts 16 pt in and is centred at y 509.5 like native Messages' (the
   absolute numbers are this simulator's 402×874 window, read only there). See
   ui-metrics.md, "Composer landmarks, docked" and "Composer raised bottom".
   */
  func testTheBarStandsInDockedAndSitsWhereThePlatformDoesRaised() throws {
    let plus = plusButton()
    XCTAssertTrue(appears(plus, within: 15), "no + button on the composer")
    let field = app.textViews.firstMatch
    XCTAssertTrue(field.exists, "no composer field")
    // The first layout and `onDockChange`
    settled(field)
    settled(plus)
    let window = app.windows.element(boundBy: 0).frame
    let standardWindow = abs(window.height - 874) < 1 && abs(window.width - 402) < 1
    let dockedLeading = plus.frame.minX
    let dockedTrailing = window.maxX - field.frame.maxX
    XCTContext.runActivity(named: "docked") { _ in
      // The `+` starts where the bar's padding ends, so its x is the margin.
      XCTAssertEqual(
        dockedLeading, concentric, accuracy: 1.0,
        "docked, the + starts at \(dockedLeading) and the platform's starts at \(concentric). "
          + "The bar is not taking its concentric padding — is `onDockChange` arriving?")
      if standardWindow {
        let below = window.maxY - plus.frame.maxY
        XCTAssertEqual(
          below, 28, accuracy: 1.5,
          "there are \(below) points below the + and the platform leaves 28 — its "
            + "concentric padding, measured on this simulator. More than that is the bar "
            + "paying for the home indicator's strip twice, the element reserving it and the bar "
            + "padding it; less is the pill too far into the band.")
      }
    }

    field.tap()
    let keyboard = app.keyboards.element(boundBy: 0)
    XCTAssertTrue(appears(keyboard, within: 10), "the keyboard never came up")
    settled(plus)
    XCTContext.runActivity(named: "raised") { _ in
      let raisedLeadingMeasured = plus.frame.minX
      let raisedTrailingMeasured = window.maxX - field.frame.maxX
      XCTAssertEqual(
        raisedLeadingMeasured, raisedLeading, accuracy: 1.0,
        "raised, the + starts at \(raisedLeadingMeasured) and should be at \(raisedLeading) — "
          + "the concentric padding is being applied off the corner")
      // Trailing, compare the two states: the field's accessibility frame is its
      // text box, 10 pt inside the pill, and the difference cancels that inset.
      let travelled = dockedTrailing - raisedTrailingMeasured
      XCTAssertEqual(
        travelled, concentric - raisedTrailing, accuracy: 1.5,
        "the field's trailing edge moved \(travelled) points between the two states and "
          + "should move \(concentric - raisedTrailing) — 28 docked against 16 raised")
      if standardWindow {
        XCTAssertEqual(
          plus.frame.midY, 509.5, accuracy: 2.0,
          "raised, the + is centred at \(plus.frame.midY) and the platform centres its own at "
            + "509.5 on this simulator")
      }
    }
  }
}
