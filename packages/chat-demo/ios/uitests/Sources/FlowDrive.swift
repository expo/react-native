/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 Chat flows through the `+` panel's commands and back-swipes, plus one
 recording driver (`testDriveTwoSendsForTheRecorder`).
 */
// covers: screens/ChatScreen.js Composer.js App.js
final class FlowDrive: DemoCase {
  override class var initialScreen: String? { "chat" }

  /// "Receive a message" adds an incoming balloon on screen. The predicate must
  /// match `REPLIES` in ChatScreen.js.
  func testReceivingDeliversAnIncomingBalloon() throws {
    chooseCommand("Receive a message")
    let reply = app.descendants(matching: .any).matching(
      NSPredicate(
        format:
          "label == 'Noted.' OR label == 'Try it with the keyboard up.' "
          + "OR label BEGINSWITH 'That reads' OR label BEGINSWITH 'Scroll up first' "
          + "OR label BEGINSWITH 'And sending' OR label BEGINSWITH 'Two lines'")
    ).firstMatch
    XCTAssertTrue(
      appears(reply, within: 8),
      "Receive a message delivered no incoming balloon — the rebuilt `receive` "
        + "may be broken; visible: \(visibleText())")
    // The transcript scrolls the arrival on: on a loaded machine that lands
    // after the balloon is in the tree
    XCTAssertTrue(waitUntil(5) { isOnScreen(reply) }, "the received balloon is off screen")
  }

  /// A completed back-swipe with the keyboard up: the home screen's docked
  /// composer comes back, and the keyboard doesn't.
  func testPopWithKeyboardLandsDockedAndQuiet() throws {
    let field = app.textViews.firstMatch
    XCTAssertTrue(appears(field, within: 15), "no composer field")
    field.tap()
    XCTAssertTrue(appears(app.keyboards.element(boundBy: 0), within: 10))
    settled(field)

    let window = app.windows.element(boundBy: 0)
    let start = window.coordinate(withNormalizedOffset: CGVector(dx: 0.01, dy: 0.35))
    let end = window.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.35))
    start.press(forDuration: 0.05, thenDragTo: end)

    XCTAssertTrue(
      appears(app.staticTexts["Safe areas"], within: 8),
      "the pop never landed on the home screen")
    settled(app.textViews.firstMatch)

    XCTAssertEqual(
      app.keyboards.count, 0,
      "the keyboard is still up on the home screen after the pop")
    // Matched by prefix: the placeholder's label has other text appended.
    let placeholder = app.descendants(matching: .any)
      .matching(NSPredicate(format: "label BEGINSWITH 'Message'"))
      .firstMatch
    XCTAssertTrue(
      isOnScreen(placeholder) && plusButton().exists,
      "the home screen's docked composer never came back; visible: \(visibleText())")
  }

  /**
   A cancelled back-swipe with the keyboard down leaves the chat's own composer
   on screen, identified by a marker typed into it. A slow, short drag held
   before release cancels; a quick one would complete the pop.
   */
  func testCancelledSwipeKeyboardDownKeepsThisScreensBar() throws {
    let field = app.textViews.firstMatch
    XCTAssertTrue(appears(field, within: 15), "no composer field")
    field.tap()
    XCTAssertTrue(appears(app.keyboards.element(boundBy: 0), within: 10))
    type("CHATBAR")
    dismissKeyboard()
    settled(field)

    // The marker must survive dismissing the keyboard, or the last check means
    // nothing.
    let marked = (app.textViews.firstMatch.value as? String) ?? ""
    XCTAssertTrue(
      marked.contains("CHATBAR"),
      "the marker text did not survive dismissing the keyboard, so this test cannot tell "
        + "the two bars apart; contents were \"\(marked)\"")

    let window = app.windows.element(boundBy: 0)
    let start = window.coordinate(withNormalizedOffset: CGVector(dx: 0.01, dy: 0.35))
    let short = window.coordinate(withNormalizedOffset: CGVector(dx: 0.30, dy: 0.35))
    start.press(
      forDuration: 0.1, thenDragTo: short, withVelocity: .slow, thenHoldForDuration: 0.6)
    settled(field)

    XCTAssertFalse(
      app.staticTexts["Safe areas"].exists,
      "the pop committed — this is not a cancelled swipe, so the case is untested")

    let shown = app.textViews.firstMatch
    XCTAssertTrue(appears(shown, within: 5), "no composer after the cancelled swipe")
    let value = (shown.value as? String) ?? ""
    XCTAssertTrue(
      value.contains("CHATBAR"),
      "the bar after a cancelled swipe is not this screen's — its contents are "
        + "\"\(value)\", visible: \(visibleText())")
  }

}

/// testHundredsThenRevealLandsAtTheLatest on its own launch, so its seed is the launch's and there is no second one.
// covers: screens/ChatScreen.js Composer.js
final class FlowHundredsCheck: DemoCase {
  override class var initialScreen: String? { "chat" }
  override class var seedMessages: Int? { 203 }

  /// With 203 messages scrolled to the top, focusing the composer brings the
  /// newest message to its resting place just above the keyboard.
  func testHundredsThenRevealLandsAtTheLatest() throws {
    XCTAssertTrue(
      appears(app.staticTexts["Chat"], within: 30),
      "the seeded relaunch never rendered")

    let field = app.textViews.firstMatch
    XCTAssertTrue(appears(field, within: 15), "no composer field")

    // Scroll to the top with a status-bar tap, as in `SafeAreaCheck`.
    XCUIApplication(bundleIdentifier: "com.apple.springboard")
      .coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.0))
      .withOffset(CGVector(dx: 0, dy: 8))
      .tap()
    settled(field)

    field.tap()
    XCTAssertTrue(appears(app.keyboards.element(boundBy: 0), within: 10))
    // Wait for the scroll and the keyboard animation.
    // The scroll to the end and the keyboard both settle the field
    settled(field)
    XCTAssertTrue(waitUntil(8) { isOnScreen(text("Message 203, sent.")) }, "the newest message never came on screen")

    // Message 203 is a sent one: `mockConversation` in ChatScreen.js sends
    // every third message from index 1, and 202 % 3 == 1
    let newest = text("Message 203, sent.")
    XCTAssertTrue(
      newest.exists,
      "the newest message is not in the tree at all; visible: \(visibleText())")
    XCTAssertTrue(
      isOnScreen(newest),
      "the newest message is off screen after the reveal; visible: \(visibleText())")

    // Between 4 and 60 pt above the field: a loose bound, because the failure
    // this catches is off by tens of points.
    let gap = field.frame.minY - newest.frame.maxY
    XCTAssertGreaterThanOrEqual(
      gap, 4, "the newest message is under the composer by \(-gap) points")
    XCTAssertLessThanOrEqual(
      gap, 60, "the newest message rests \(gap) points above the composer — landed short")
  }
}
