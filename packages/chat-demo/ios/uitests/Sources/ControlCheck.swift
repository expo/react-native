/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 A `<button>`'s `onClick` actually fires, and focusing the composer goes to the
 present.

 The first is here because a `<button>` in a new app is DEAD by default and
 looks perfect: it draws its full native chrome and highlights under a finger,
 and does nothing, because `enableNativeGestureRecognizers` is read natively and
 a JavaScript `override()` cannot reach it. Nothing about the button says so.
 The count is in its own label precisely so a tap that did nothing is visible
 rather than inferred.

 The second is the native transcript's rule: a reader who has scrolled up
 into last week and taps the field has said they mean to write NOW.
 */
final class ControlCheck: DemoCase {
  func testAPanelCommandActuallyRuns() throws {
    // The list ends at row 10 until something adds to it.
    XCTAssertFalse(isOnScreen(text("row 11")), "the list already had a row 11")

    chooseCommand("Add a row")

    let list = app.scrollViews.firstMatch
    var swipes = 0
    while !isOnScreen(text("row 11")) && swipes < 20 {
      list.swipeUp(velocity: .fast)
      swipes += 1
    }
    XCTAssertTrue(
      isOnScreen(text("row 11")),
      "choosing a command did nothing. Either the panel's button did not fire, "
        + "or `<button>`'s press is dead — `enableNativeGestureRecognizers` is read "
        + "natively and has to be set in AppDelegate.")
  }

  func testFocusingTheComposerGoesToTheNewest() throws {
    app.links["Chat, with a composer"].tap()

    chooseCommand("Add fifty messages")

    // To the earliest message, deliberately: the claim is about being TAKEN to
    // the present, which is only a claim if you are not already there.
    chooseCommand("Go to the earliest")
    Thread.sleep(forTimeInterval: 1.0)
    let newest = text("Message 53, sent.")
    // NOT on screen — it is still mounted, and asking `exists` here would be a
    // guard that cannot fail.
    XCTAssertFalse(
      isOnScreen(newest), "the list did not go to the top, so this proves nothing")

    let field = app.textViews.firstMatch
    XCTAssertTrue(field.exists, "no composer field to focus")
    field.tap()
    XCTAssertTrue(
      app.keyboards.element(boundBy: 0).waitForExistence(timeout: 10),
      "the field never took focus, so nothing was triggered")

    var brought = false
    for _ in 0..<20 where !brought {
      Thread.sleep(forTimeInterval: 0.5)
      brought = isOnScreen(newest)
    }
    XCTAssertTrue(
      brought,
      "focusing the composer did not bring the newest message into view; "
        + "visible: \(visibleText())")
  }
}
