/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 The `+` card over a raised keyboard, and the way back.

 The card is a popover in the app's window, and the keys are stood down behind
 a picture of themselves while it is up — so what this checks is the round
 trip: the keyboard is gone for the card and back after it, with the field still
 focused and the `+` back where it was drawn; and a rotation with the card up
 closes it and brings the keyboard back on its own.

 Read from the accessibility tree, which knows whether a keyboard is up; the
 pictures are pixels only. The morph itself is checked by eye on a recording —
 see `NativePopover.md`.
 */
// covers: Composer.js
final class PanelCardCheck: DemoCase {
  override class var initialScreen: String? { "chat" }

  private func raiseTheKeyboard(_ field: XCUIElement) {
    field.tap()
    waitForKeyboard(over: field)
  }

  /// The keys stood down for the card: no keyboard, and the card's rows at rest.
  private func keysStoodDown(for row: XCUIElement, _ message: String, file: StaticString = #filePath, line: UInt = #line) {
    XCTAssertTrue(vanishes(app.keyboards.element(boundBy: 0), within: 8), message, file: file, line: line)
    settled(row, file: file, line: line)
  }

  /// One launch: the first part ends with the card closed and the keyboard up,
  /// which is where the second starts. A card reopened the instant the last
  /// one closed still covers the keys: the keys are still returning under
  /// their picture then, and a presentation that ran at once met a live
  /// keyboard and was parked above it.
  func testTheKeysStandDownForTheCardComeBackAfterItAndAReopenedCardStillCoversThem() throws {
    try XCTContext.runActivity(named: "the keys stand down for the card and come back after it") { _ in
      let field = app.textViews.firstMatch
      XCTAssertTrue(appears(field, within: 15), "no composer field")
      raiseTheKeyboard(field)
      let plus = plusButton()
      XCTAssertTrue(appears(plus, within: 8), "no + button")
      let raised = plus.frame

      plus.tap()
      let row = app.buttons["Receive a message"]
      XCTAssertTrue(appears(row, within: 8), "the card never opened")
      keysStoodDown(for: row, "the keys were not stood down for the card")
      // The card is centred on the + (the system chat's placement), so it
      // straddles the bar: its first row above the button, its sixth below the
      // bar, where the keys were
      let sixth = app.buttons["Go to the earliest"]
      XCTAssertTrue(sixth.exists, "the card is missing its sixth row")
      XCTAssertLessThan(row.frame.minY, raised.midY, "the card's first row is at \(row.frame.minY), below the + at \(raised.midY): the card is not centred on the button")
      XCTAssertGreaterThan(sixth.frame.minY, raised.maxY, "the card does not reach the keys; its sixth row is at \(sixth.frame.minY)")

      app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.15)).tap()
      XCTAssertTrue(vanishes(row, within: 8), "a tap outside did not close the card")
      XCTAssertTrue(appears(app.keyboards.element(boundBy: 0), within: 8), "the keyboard did not come back after the card")
      settled(plus)
      XCTAssertEqual(
        plus.frame.minY, raised.minY, accuracy: 1.0,
        "the + is not back where it was drawn: \(plus.frame) against \(raised)")
      XCTAssertEqual(field.value(forKey: "hasKeyboardFocus") as? Bool, true, "the field lost the keyboard")
    }

    try XCTContext.runActivity(named: "a card reopened as the keys return still covers them") { _ in
      let field = app.textViews.firstMatch
      XCTAssertTrue(appears(field, within: 15), "no composer field")
      raiseTheKeyboard(field)
      let plus = plusButton()
      XCTAssertTrue(appears(plus, within: 8), "no + button")
      let raised = plus.frame
      let row = app.buttons["Receive a message"]
      let sixth = app.buttons["Go to the earliest"]
      for attempt in 1...3 {
        plus.tap()
        XCTAssertTrue(appears(row, within: 8), "attempt \(attempt): the card never opened")
        keysStoodDown(for: row, "attempt \(attempt): the keys were not stood down for the card")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.15)).tap()
        // No waiting for the card to go: two taps straight after the outside one.
        // XCUITest's own latency puts the first inside the card's dismissal,
        // where it is swallowed, and the second inside the keys' return.
        let plusCentre = plus.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        plusCentre.tap()
        plusCentre.tap()
        XCTAssertTrue(appears(row, within: 8), "attempt \(attempt): the card never reopened")
        keysStoodDown(for: row, "attempt \(attempt): the keys were not stood down for the reopened card")
        XCTAssertTrue(sixth.exists, "attempt \(attempt): the reopened card is missing its sixth row")
        XCTAssertGreaterThan(
          sixth.frame.minY, raised.maxY,
          "attempt \(attempt): the reopened card sits above the keys; its sixth row is at \(sixth.frame.minY)")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.15)).tap()
        XCTAssertTrue(vanishes(row, within: 8), "attempt \(attempt): the reopened card did not close")
        XCTAssertTrue(appears(app.keyboards.element(boundBy: 0), within: 8), "attempt \(attempt): the keyboard did not come back")
        settled(plus)
      }
    }
  }

  /// In landscape the card keeps its portrait width, so the rest of the
  /// screen is still there to tap outside it.
  func testTheCardKeepsItsPortraitWidthInLandscape() throws {
    defer { XCUIDevice.shared.orientation = .portrait }
    XCUIDevice.shared.orientation = .landscapeLeft
    let field = app.textViews.firstMatch
    XCTAssertTrue(appears(field, within: 15), "no composer field")
    settled(field)
    raiseTheKeyboard(field)
    let plus = plusButton()
    XCTAssertTrue(appears(plus, within: 8), "no + button")
    plus.tap()
    let row = app.buttons["Receive a message"]
    XCTAssertTrue(appears(row, within: 8), "the card never opened in landscape")
    keysStoodDown(for: row, "the keys were not stood down for the card")
    let window = app.windows.element(boundBy: 0).frame
    XCTAssertLessThanOrEqual(
      row.frame.width, window.height,
      "a row is \(row.frame.width) wide in landscape: the card took the window's width, not its portrait width")

    // Outside the card, on the right half of the screen
    app.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.5)).tap()
    XCTAssertTrue(vanishes(row, within: 8), "a tap beside the card did not close it")
    XCTAssertTrue(appears(app.keyboards.element(boundBy: 0), within: 8), "the keyboard did not come back after the card")
  }

  func testARotationClosesTheCardAndBringsTheKeyboardBack() throws {
    let field = app.textViews.firstMatch
    XCTAssertTrue(appears(field, within: 15), "no composer field")
    raiseTheKeyboard(field)
    let plus = plusButton()
    XCTAssertTrue(appears(plus, within: 8), "no + button")
    plus.tap()
    let row = app.buttons["Receive a message"]
    XCTAssertTrue(appears(row, within: 8), "the card never opened")
    keysStoodDown(for: row, "the keys were not stood down for the card")

    XCUIDevice.shared.orientation = .landscapeLeft
    defer { XCUIDevice.shared.orientation = .portrait }
    XCTAssertTrue(vanishes(row, within: 8), "the card survived a rotation")
    XCTAssertTrue(appears(app.keyboards.element(boundBy: 0), within: 8), "the keyboard did not come back after the rotation")

    XCUIDevice.shared.orientation = .portrait
    settled(plus)
    plus.tap()
    XCTAssertTrue(appears(row, within: 8), "the card would not open again after the rotation")
    app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.15)).tap()
    XCTAssertTrue(vanishes(row, within: 8), "the reopened card did not close")
  }
}
