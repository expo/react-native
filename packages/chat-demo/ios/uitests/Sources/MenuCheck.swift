/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 The composer's `+` is drawn at rest, and again after the panel card it opens
 has closed. Checked in pixels: a `+` that isn't drawn still looks visible to
 XCUITest and in its view properties.
 */
// covers: Composer.js
final class MenuCheck: DemoCase {
  override class var initialScreen: String? { "chat" }

  /// Minimum red-channel difference (0–255) between the `+`'s rim and the bar.
  /// On iOS 27 the rim reads 172 and the bar 244.
  private let minimumContrast = 20

  /// How much darker the `+`'s rim is than the bar, in the red channel. Reads
  /// the rim at the left edge, not the fill, which on iOS 27 matches the bar.
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
    // Below the button the bar is at full strength; above it the material fades.
    let bar = pixels.rowAverage(
      y: box.maxY + 3,
      from: box.minX + 4,
      to: box.maxX - 4)
    return bar.r - rim
  }

  func testTheGlassPlusSurvivesItsOwnSurface() throws {
    let field = app.textViews.firstMatch
    XCTAssertTrue(appears(field, within: 10), "no composer field")
    field.tap()
    XCTAssertTrue(
      appears(app.keyboards.element(boundBy: 0), within: 8),
      "the keyboard never came up, so the + is not in an accessory and this "
        + "test is not looking at the case it is for")

    let atRest = try plusStandsOut()
    XCTAssertGreaterThan(
      atRest, minimumContrast,
      "the + is not drawn as a disc even at rest, so this test cannot see the "
        + "fault it is for. Check the menu button's glass effect view before reading the rest.")

    let plus = plusButton()
    plus.tap()
    XCTAssertTrue(
      appears(app.buttons["Add fifty messages"], within: 8),
      "the + opened nothing; visible: \(visibleText())")

    // Not checked while the card is open: UIKit's zoom transition turns the
    // `+` into the card.

    // Close the card by tapping above it. Not `app.tap()`: the card reaches
    // past the screen's centre, and a tap on the card closes nothing.
    app.windows.element(boundBy: 0).coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.15)).tap()
    XCTAssertTrue(vanishes(app.buttons["Add fifty messages"], within: 8), "the card did not close")
    settled(plusButton())

    let after = try plusStandsOut()
    XCTAssertGreaterThan(
      after, minimumContrast,
      "the + did not come back after the card closed (contrast \(after), was "
        + "\(atRest)). The view reads as visible in every property; only the "
        + "pixels show it.")
  }
}
