/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 The composer's `+` survives its own menu.

 Presenting a menu lifts its source view out of the tree and draws it in a
 `UITextEffectsWindow` — measured at window level 1, against the app's own
 window at level 0. That is what makes the lift read as the button rising off
 the screen, and it works everywhere the menu's window is above the source's.

 An accessory's window is not. Measured, `UIRemoteKeyboardWindow` is at level
 10000001, so the lift of a button in the composer is drawn UNDERNEATH the bar
 it came from: the `+` is hidden for as long as the menu is up, and its glass
 has to be whole again when the menu closes.

 It is worth a pixel test rather than an existence one because nothing about the
 view says so: `hidden` is 0, `alpha` and `layer.opacity` are 1, the
 configuration is set, and the button is in its superview at the right index —
 the only place such a fault exists is the screen.
 */
final class MenuCheck: DemoCase {
  override class var initialScreen: String? { "chat" }

  /// How far the `+`'s RIM has to stand out from the bar behind it.
  ///
  /// Measured on iOS 27: the rim reads 172 where the bar reads 244, so seventy
  /// points of margin against a threshold of twenty.
  private let minimumContrast = 20

  /// Whether the `+` is drawn as a disc, sampled rather than asked.
  ///
  /// The disc's RIM, not its fill. On iOS 27 the fill and the bar under it are
  /// the same near-white and the difference between them is nothing, so a
  /// reading of the fill says "the + is not drawn as a disc" about a build
  /// where it plainly is. What makes the disc visible on either OS is its
  /// edge, so that is what this measures: the darkest pixel across the LEFT
  /// EDGE, where nothing else is drawn (the glyph is in the middle, and the
  /// fill either side of the rim is the bar's own colour).
  private func plusStandsOut() throws -> Int {
    let plus = plusButton()
    XCTAssertTrue(plus.exists, "no + button")
    let box = plus.frame
    let pixels = try self.pixels()
    var rim = 255
    var x = box.minX - 1
    while x <= box.minX + 8 {
      rim = min(rim, pixels.at(x: x, y: box.midY).r)
      x += 0.5
    }
    /*
     * The band just BELOW the button, which is bar at full strength: above it
     * is the material's fade, and beside it is the rim this is compared to.
     */
    let bar = pixels.rowAverage(
      y: box.maxY + 3,
      from: box.minX + 4,
      to: box.maxX - 4)
    return bar.r - rim
  }

  func testTheGlassPlusSurvivesItsOwnSurface() throws {
    let field = app.textViews.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 10), "no composer field")
    field.tap()
    XCTAssertTrue(
      app.keyboards.element(boundBy: 0).waitForExistence(timeout: 8),
      "the keyboard never came up, so the + is not in an accessory and this "
        + "test is not looking at the case it is for")

    let atRest = try plusStandsOut()
    XCTAssertGreaterThan(
      atRest, minimumContrast,
      "the + is not drawn as a disc even at rest, so this test cannot see the "
        + "fault it is for. Check the glass configuration before reading the rest.")

    let plus = plusButton()
    plus.tap()
    XCTAssertTrue(
      app.buttons["Add fifty messages"].waitForExistence(timeout: 8),
      "the + opened nothing; visible: \(visibleText())")

    /*
     * Deliberately NOT asserted while the menu is up. The + opens a platform
     * menu (`showsMenuAsPrimaryAction`), and the whole point of that is the
     * MORPH: the button becomes the menu while it is open, exactly as the
     * native chat's + does. The menu's own dimming veil sits over the bar as
     * well, which takes the contrast under the threshold. What must hold — and
     * what the rest of this test checks — is that the disc is a disc at rest
     * and comes back whole after the menu closes.
     */

    // Dismissing by choosing nothing: a tap on the transcript above the menu.
    app.tap()
    Thread.sleep(forTimeInterval: 1.0)

    let after = try plusStandsOut()
    XCTAssertGreaterThan(
      after, minimumContrast,
      "the + did not come back after the menu closed (contrast \(after), was "
        + "\(atRest)). The view reads as visible in every property; only the "
        + "pixels show it.")
  }
}
