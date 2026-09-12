/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 The composer stands further in when it is resting on the screen's corner.

 The concentric padding is 28, and it is used only docked: the platform's native
 composer stands 28 in when it rests on the screen's corner and its
 ordinary 16 and 12 raised. The reason is the display's own rounded corner — a
 bar sitting on the bottom of the screen has that curve beside it, and a pill
 concentric with it has to stand further in. Raised, the bar is on the keyboard,
 the corner is nowhere near it, and the ordinary margins apply.

 Measured on the same simulator, both apps docked: the native `+` glyph begins
 at x 40.33, twelve points further in than a bar taking its raised 16 — exactly
 the difference between 28 and 16.

 The dock state comes from `onDockChange`, which the element publishes because
 nothing else can answer it: `Keyboard`'s notifications fire with the accessory's
 own frame as the end frame, so a bar that listens to them reads as permanently
 undocked. See `NativeKeyboardAccessory.md`.

 **Both states are at rest**, so nothing here samples an animation — the point of
 the fraction the element sends is that the transition between them is smooth,
 and that is measured on a recording rather than asserted here.
 */
final class DockCheck: DemoCase {
  override class var initialScreen: String? { "chat" }

  /// The platform's concentric padding, measured on its own composer.
  private let concentric: CGFloat = 28
  /// And ours raised, which matches the native composer.
  private let raisedLeading: CGFloat = 16
  private let raisedTrailing: CGFloat = 12
  /// The room below the pill while the bar is on the keys.
  private let raisedBottom: CGFloat = 16

  func testTheBarStandsInWhenItIsDockedAndNotWhenItIsRaised() throws {
    let plus = plusButton()
    XCTAssertTrue(plus.waitForExistence(timeout: 15), "no + button on the composer")
    let field = app.textViews.firstMatch
    XCTAssertTrue(field.exists, "no composer field")
    // The bar settles into place after the screen's first layout; the dock event
    // arrives with it.
    Thread.sleep(forTimeInterval: 1.5)

    let window = app.windows.element(boundBy: 0).frame
    let dockedLeading = plus.frame.minX
    let dockedTrailing = window.maxX - field.frame.maxX

    field.tap()
    let keyboard = app.keyboards.element(boundBy: 0)
    XCTAssertTrue(keyboard.waitForExistence(timeout: 10), "the keyboard never came up")
    Thread.sleep(forTimeInterval: 1.5)

    let raisedLeadingMeasured = plus.frame.minX
    let raisedTrailingMeasured = window.maxX - field.frame.maxX

    /*
     * The LEADING edge is measured absolutely, because the `+` is a sibling of
     * the pill and starts exactly where the bar's padding ends.
     */
    XCTAssertEqual(
      dockedLeading, concentric, accuracy: 1.0,
      "docked, the + starts at \(dockedLeading) and the platform's starts at \(concentric). "
        + "The bar is not taking its concentric padding — is `onDockChange` arriving?")
    XCTAssertEqual(
      raisedLeadingMeasured, raisedLeading, accuracy: 1.0,
      "raised, the + starts at \(raisedLeadingMeasured) and should be at \(raisedLeading) — "
        + "the concentric padding is being applied off the corner")

    /*
     * The TRAILING edge is measured as a DIFFERENCE, and that is not a dodge.
     *
     * The only landmark on that side is the text field, and a field's
     * accessibility frame is its text box rather than the pill it sits in — ten
     * points short of the pill's own edge, in both states. Asserting the
     * absolute number would be asserting that inset as well, and it belongs to
     * the field rather than to the bar. The difference between the states
     * cancels it exactly, and the difference is the whole of what changed.
     */
    let travelled = dockedTrailing - raisedTrailingMeasured
    XCTAssertEqual(
      travelled, concentric - raisedTrailing, accuracy: 1.5,
      "the field's trailing edge moved \(travelled) points between the two states and "
        + "should move \(concentric - raisedTrailing) — 28 docked against 12 raised")
  }

  /**
   And raised it sits exactly where the platform's own does.

   Measured on the same simulator with the same keyboard up, both apps: the `+`
   glyph's centre is at y 509.5 in the platform's own chat and at 510.0 here. The
   number is the OS's rather than ours — 502.83 on iOS 26.5 and 509.5 on 27,
   measured the same way: Messages opened on the simulator with its own composer
   focused, and the `+` glyph's ink read off the screenshot.

   Raised, the bar takes the sixteen points below the pill and the eight above
   it, and this case exists so that the docked change above cannot quietly move
   the raised state too.

   The `+` BUTTON rather than the glyph, because a test reads the accessibility
   tree and the glyph is paint. A disc centred on the same point, so the centre
   is the same number and the height is not.

   Written against this simulator's window, because a keyboard's height is not
   something a test can derive — the guard is what stops that from becoming a
   silent wrong answer elsewhere.
   */
  func testTheBarSitsWhereThePlatformDoesOnTheKeys() throws {
    let field = app.textViews.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 15), "no composer field")
    field.tap()
    XCTAssertTrue(
      app.keyboards.element(boundBy: 0).waitForExistence(timeout: 10),
      "the keyboard never came up")
    Thread.sleep(forTimeInterval: 1.5)

    let window = app.windows.element(boundBy: 0).frame
    try XCTSkipUnless(
      abs(window.height - 874) < 1 && abs(window.width - 402) < 1,
      "this case's numbers are this simulator's 402x874 window")

    let plus = plusButton()
    XCTAssertTrue(plus.exists, "no + button with the keyboard up")
    XCTAssertEqual(
      plus.frame.midY, 509.5, accuracy: 2.0,
      "raised, the + is centred at \(plus.frame.midY) and the platform centres its own at "
        + "509.5 on this simulator")
  }

  /**
   And docked it sits where the platform's own composer does: TWENTY-EIGHT points
   off the bottom.

   That is the concentric padding, and it is LESS than the
   34-point bottom safe area — the native pill deliberately overlaps the top of
   the strip the system reserves, because 28 is concentric with the display's
   corner. Measured on the same simulator with both apps docked and the keyboard
   down: the native pill ends 28.00 points above the screen's edge.

   Reaching a number smaller than the safe area is what `automaticInsets={false}`
   on `<native:keyboardaccessory>` is for. While the element reserves the strip
   AND the bar pads, the two add and 28 is unreachable; the bar owns the whole
   distance instead and pays 28 of it.

   So this catches two opposite mistakes with one number. Above 28 means the bar
   is paying for the strip twice — the element reserving and the bar padding —
   which puts the composer twenty-two points above the native one. Below it
   means the pill has been let too far into the indicator's band.

   Written against this simulator's 402x874 window, because nothing publishes
   either number to a test. The guard on the window is what stops that from
   becoming a silent wrong answer somewhere else.
   */
  func testTheBarDoesNotPadBelowItselfWhenItIsDocked() throws {
    let plus = plusButton()
    XCTAssertTrue(plus.waitForExistence(timeout: 15), "no + button on the composer")
    Thread.sleep(forTimeInterval: 1.5)

    let window = app.windows.element(boundBy: 0).frame
    try XCTSkipUnless(
      abs(window.height - 874) < 1 && abs(window.width - 402) < 1,
      "this case's numbers are this simulator's 402x874 window and its 34-point safe area")

    let below = window.maxY - plus.frame.maxY
    XCTAssertEqual(
      below, 28, accuracy: 1.5,
      "there are \(below) points below the + and the platform leaves 28 — its "
        + "concentric padding, measured on this simulator. More than that is the bar "
        + "paying for the home indicator's strip twice, the element reserving it and the bar "
        + "padding it; less is the pill too far into the band.")
  }
}
