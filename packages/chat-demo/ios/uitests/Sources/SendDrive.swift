/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 Not checks: each test performs one interaction for a screen recording made
 outside the test. tools/gate.sh skips this class (by name) unless
 `GATE_RECORDERS=1`.
 */
// covers: screens/ChatScreen.js Composer.js
final class SendDrive: DemoCase {
  func testDriveASendForTheRecorder() throws {
    app.links["Chat, with a composer"].tap()
    let field = app.textViews.firstMatch
    XCTAssertTrue(appears(field, within: 15), "no composer field")
    field.tap()
    XCTAssertTrue(appears(app.keyboards.element(boundBy: 0), within: 10))

    type("Hello")
    let send = app.buttons["Send"]
    XCTAssertTrue(appears(send, within: 8), "no send button with a draft")

    // Still frames before and after, for the recording.
    Thread.sleep(forTimeInterval: 1.5)
    send.tap()
    Thread.sleep(forTimeInterval: 2.5)
  }

  /// Sends a message that wraps to two lines on a 402 pt window, so the field
  /// shrinks back to one line as the message is added.
  func testDriveAGrownSendForTheRecorder() throws {
    app.links["Chat, with a composer"].tap()
    let field = app.textViews.firstMatch
    XCTAssertTrue(appears(field, within: 15), "no composer field")
    field.tap()
    XCTAssertTrue(appears(app.keyboards.element(boundBy: 0), within: 10))

    type("It's not perfect yet but this is a neat app recreation!!")
    let send = app.buttons["Send"]
    XCTAssertTrue(appears(send, within: 8), "no send button with a draft")

    Thread.sleep(forTimeInterval: 1.5)
    send.tap()
    Thread.sleep(forTimeInterval: 2.5)
  }

  /// Holds the `+` down for 2 s, to record the glass press.
  func testHoldThePlusForTheRecorder() throws {
    app.links["Chat, with a composer"].tap()
    // The panel `+` acts on release, so holding it shows only the press.
    let plus = plusButton()
    XCTAssertTrue(appears(plus, within: 15), "no + button")

    Thread.sleep(forTimeInterval: 1.5)
    plus.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
      .press(forDuration: 2.0)
    Thread.sleep(forTimeInterval: 1.5)
  }

  /// Holds the composer field down for 2 s, to record its press effect. The app
  /// draws that effect itself: `UIGlassEffect.interactive` doesn't work on an
  /// effect view that sits behind the content.
  func testHoldTheFieldForTheRecorder() throws {
    app.links["Chat, with a composer"].tap()
    let field = app.textViews.firstMatch
    XCTAssertTrue(appears(field, within: 15), "no composer field")

    // Nothing else moves on screen during the press.
    Thread.sleep(forTimeInterval: 2.0)
    field.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
      .press(forDuration: 2.0)
    Thread.sleep(forTimeInterval: 1.5)
  }

  /// Dismisses the keyboard with a slow drag and then with the panel command, to
  /// compare the two keyboard animations in one recording.
  func testDismissTwiceForTheRecorder() throws {
    app.links["Chat, with a composer"].tap()
    let field = app.textViews.firstMatch
    XCTAssertTrue(appears(field, within: 15), "no composer field")

    field.tap()
    XCTAssertTrue(appears(app.keyboards.element(boundBy: 0), within: 10))
    Thread.sleep(forTimeInterval: 1.5)

    let top = app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.45))
    let bottom = app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.98))
    // Slow: UIKit finishes an interactive dismissal at the finger's release
    // speed, so a fast drag would snap down regardless.
    top.press(
      forDuration: 0.15,
      thenDragTo: bottom,
      withVelocity: .slow,
      thenHoldForDuration: 0.1)
    Thread.sleep(forTimeInterval: 2.5)

    field.tap()
    XCTAssertTrue(appears(app.keyboards.element(boundBy: 0), within: 10))
    Thread.sleep(forTimeInterval: 1.5)
    chooseCommand("Dismiss the keyboard")
    Thread.sleep(forTimeInterval: 2.5)
  }

  /// Raises the keyboard at the end of the list and again scrolled a few hundred
  /// points up, to record whether the transcript follows the keyboard in both.
  func testRaiseFromTwoScrollPositionsForTheRecorder() throws {
    app.links["Chat, with a composer"].tap()
    let field = app.textViews.firstMatch
    XCTAssertTrue(appears(field, within: 15), "no composer field")
    chooseCommand("Add fifty messages")
    Thread.sleep(forTimeInterval: 1.5)

    field.tap()
    XCTAssertTrue(appears(app.keyboards.element(boundBy: 0), within: 10))
    Thread.sleep(forTimeInterval: 2.0)
    chooseCommand("Dismiss the keyboard")
    Thread.sleep(forTimeInterval: 2.0)

    // Scrolled up, so the last message is well clear of the composer.
    let window = app.windows.firstMatch
    let low = window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.35))
    let high = window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.72))
    low.press(forDuration: 0.1, thenDragTo: high, withVelocity: .slow, thenHoldForDuration: 0.1)
    Thread.sleep(forTimeInterval: 2.0)
    field.tap()
    XCTAssertTrue(appears(app.keyboards.element(boundBy: 0), within: 10))
    Thread.sleep(forTimeInterval: 2.5)
  }

  /// Shows the typing indicator long enough to record it.
  func testShowTheTypingIndicatorForTheRecorder() throws {
    app.links["Chat, with a composer"].tap()
    XCTAssertTrue(
      appears(app.textViews.firstMatch, within: 15), "no composer field")
    chooseCommand("Receive a message")
    // `receive` in ChatScreen.js shows the dots for 1.6 s.
    Thread.sleep(forTimeInterval: 5.0)
  }
  /// Long-presses a balloon and keeps the context menu open, to record it.
  func testHoldABalloonForTheRecorder() throws {
    app.links["Chat, with a composer"].tap()
    XCTAssertTrue(
      appears(app.textViews.firstMatch, within: 15), "the screen never loaded")
    // The seeded chat's last received balloon, as `LiftCheck` holds it
    let balloon = text("Did the keyboard cover the last message?")
    XCTAssertTrue(appears(balloon, within: 10), "no balloon to hold")
    Thread.sleep(forTimeInterval: 1.0)
    hold(balloon)
    XCTAssertTrue(
      appears(app.buttons["Copy"], within: 5),
      "the hold opened no menu; visible: \(visibleText())")
    Thread.sleep(forTimeInterval: 3.0)
  }
}
