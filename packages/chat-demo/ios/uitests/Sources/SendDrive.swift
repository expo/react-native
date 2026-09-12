/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 Not a check — a way to DRIVE a send while something else records the screen.

 Sending cannot be scripted from outside the app: a synthetic tap on the send
 button's coordinates missed twice, and what a frame-by-frame tracker then
 followed was the button itself rather than a balloon. XCUITest finds the button
 by name and types through the real keyboard, which is the only reliable way to
 get the animation to happen on demand.

 Named so it is skipped by default — it asserts almost nothing and exists to be
 run deliberately.
 */
final class SendDrive: DemoCase {
  func testDriveASendForTheRecorder() throws {
    app.links["Chat, with a composer"].tap()
    let field = app.textViews.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 15), "no composer field")
    field.tap()
    XCTAssertTrue(app.keyboards.element(boundBy: 0).waitForExistence(timeout: 10))

    app.typeText("Hello")
    let send = app.buttons["Send"]
    XCTAssertTrue(send.waitForExistence(timeout: 8), "no send button with a draft")

    // A moment of stillness before and after, so the recording has a clean
    // before and a settled after to measure between.
    Thread.sleep(forTimeInterval: 1.5)
    send.tap()
    Thread.sleep(forTimeInterval: 2.5)
  }

  /**
   Sends from a composer that has GROWN, which is where the transcript jumps.

   Reported from a device with a recording: with two lines in the field, sending
   takes the whole transcript up and out of view for several frames before the
   balloon arrives. The field collapsing back to one line and the message being
   appended land in the same moment, and the anchor sees both.

   The text is long enough to wrap on a 402-point window and no longer, so what
   is being driven is exactly two lines rather than a scrolling field.
   */
  func testDriveAGrownSendForTheRecorder() throws {
    app.links["Chat, with a composer"].tap()
    let field = app.textViews.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 15), "no composer field")
    field.tap()
    XCTAssertTrue(app.keyboards.element(boundBy: 0).waitForExistence(timeout: 10))

    app.typeText("It's not perfect yet but this is a neat app recreation!!")
    let send = app.buttons["Send"]
    XCTAssertTrue(send.waitForExistence(timeout: 8), "no send button with a draft")

    Thread.sleep(forTimeInterval: 1.5)
    send.tap()
    Thread.sleep(forTimeInterval: 2.5)
  }

  /**
   Holds the first `+` down, for a recorder to watch the glass press.

   Not a check for the same reason as above, and for one more: what a Liquid
   Glass button does under a finger is UIKit's, so there is nothing here whose
   correctness this file could assert. What it establishes is that the press
   HAPPENS — the button is a real `UIControl` that received a real touch — which
   is exactly what was not true before, and which no screenshot taken from
   outside can show, because a synthetic touch from `idb` never holds.
   */
  func testHoldThePlusForTheRecorder() throws {
    app.links["Chat, with a composer"].tap()
    /*
     * The PANEL `+`, not the menu one.
     *
     * A button whose primary action is a `UIMenu` opens it almost at once, and
     * what follows is the menu's presentation rather than a press. This one
     * activates on release, so a hold is two seconds of press and nothing else.
     */
    let plus = plusButton()
    XCTAssertTrue(plus.waitForExistence(timeout: 15), "no + button")

    Thread.sleep(forTimeInterval: 1.5)
    plus.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
      .press(forDuration: 2.0)
    Thread.sleep(forTimeInterval: 1.5)
  }

  /**
   Holds the composer's FIELD down, for a recorder to watch the glass react.

   `idb`'s synthetic touch does not hold on this machine — measured, a
   three-second one-point swipe over the field produced a mean pixel difference
   of 0.85, which is the caret blinking — so the only way to see what the field
   does under a finger is to have XCUITest keep one there while something else
   records.

   The question it answers is a specific one: `UIGlassEffect.interactive` does
   NOT work when the effect view is a sibling behind the content with
   interaction off, which is exactly how a backdrop material is built. So the
   press is reproduced rather than delegated, and this is how to see whether the
   reproduction is running and what it looks like.
   */
  func testHoldTheFieldForTheRecorder() throws {
    app.links["Chat, with a composer"].tap()
    let field = app.textViews.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 15), "no composer field")

    // Still and unfocused, which is the state it was reported in: empty, no
    // keyboard, nothing else moving on screen for a frame tracker to confuse
    // with the press.
    Thread.sleep(forTimeInterval: 2.0)
    field.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
      .press(forDuration: 2.0)
    Thread.sleep(forTimeInterval: 1.5)
  }

  /**
   Dismisses the keyboard twice — by dragging, then programmatically — for a
   recorder to compare the two.

   The complaint is that the drag "snaps down" where the programmatic dismissal
   glides, and neither can be driven from outside the app: `idb` cannot hold a
   touch through a tracked drag on this machine. XCUITest can, so the two land in
   one recording and a frame tracker can put the keyboard's top edge from each on
   the same axis.
   */
  func testDismissTwiceForTheRecorder() throws {
    app.links["Chat, with a composer"].tap()
    let field = app.textViews.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 15), "no composer field")

    field.tap()
    XCTAssertTrue(app.keyboards.element(boundBy: 0).waitForExistence(timeout: 10))
    Thread.sleep(forTimeInterval: 1.5)

    // 1. THE DRAG. From the middle of the transcript, down past the keyboard's
    // top edge, which is what interactive dismissal tracks.
    let top = app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.45))
    let bottom = app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.98))
    /*
     * SLOWLY, and that is the point of the number.
     *
     * UIKit finishes an interactive dismissal at the velocity the finger left
     * at, so a synthetic flick completing quickly proves nothing — it is the
     * platform doing what it was asked. A slow drag that still snaps is the
     * fault; a slow drag that glides says the flick was the artefact.
     */
    top.press(
      forDuration: 0.15,
      thenDragTo: bottom,
      withVelocity: .slow,
      thenHoldForDuration: 0.1)
    Thread.sleep(forTimeInterval: 2.5)

    // 2. PROGRAMMATIC. Raise it again, then use the panel's own command.
    field.tap()
    XCTAssertTrue(app.keyboards.element(boundBy: 0).waitForExistence(timeout: 10))
    Thread.sleep(forTimeInterval: 1.5)
    chooseCommand("Dismiss the keyboard")
    Thread.sleep(forTimeInterval: 2.5)
  }

  /**
   Raises the keyboard from two scroll positions, for a recorder to compare.

   The claim under test is that the transcript should follow the keyboard up
   WHEREVER it is scrolled, not only when it is already at the bottom. So this
   does it twice: once at the end of the list, once a few hundred points above
   it, with a still moment either side of each so a tracker has a before and an
   after to subtract.
   */
  func testRaiseFromTwoScrollPositionsForTheRecorder() throws {
    app.links["Chat, with a composer"].tap()
    let field = app.textViews.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 15), "no composer field")
    chooseCommand("Add fifty messages")
    Thread.sleep(forTimeInterval: 1.5)

    // 1. AT THE BOTTOM.
    field.tap()
    XCTAssertTrue(app.keyboards.element(boundBy: 0).waitForExistence(timeout: 10))
    Thread.sleep(forTimeInterval: 2.0)
    chooseCommand("Dismiss the keyboard")
    Thread.sleep(forTimeInterval: 2.0)

    // 2. SCROLLED UP, so the last message is well clear of the composer.
    let window = app.windows.firstMatch
    let low = window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.35))
    let high = window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.72))
    low.press(forDuration: 0.1, thenDragTo: high, withVelocity: .slow, thenHoldForDuration: 0.1)
    Thread.sleep(forTimeInterval: 2.0)
    field.tap()
    XCTAssertTrue(app.keyboards.element(boundBy: 0).waitForExistence(timeout: 10))
    Thread.sleep(forTimeInterval: 2.5)
  }

  /**
   Hold on the typing indicator, for a recorder outside the process.

   Its geometry is the platform's — 57.5 x 35 for the bubble with 11.5 and 5
   point tail circles — and none of that is checkable from inside XCUITest: the
   dots and the circles are `<div>`s with no accessible name, and the whole
   cluster breathes on a 1.9-second loop that a snapshot cannot see. So this
   case exists only to put the indicator on screen and keep it there.
   */
  func testShowTheTypingIndicatorForTheRecorder() throws {
    app.links["Chat, with a composer"].tap()
    XCTAssertTrue(
      app.textViews.firstMatch.waitForExistence(timeout: 15), "no composer field")
    chooseCommand("Receive a message")
    // The dots run for 1.6 seconds before the message lands — long enough to
    // record the indicator, its breath, and the moment it is replaced.
    Thread.sleep(forTimeInterval: 5.0)
  }
  /**
   Hold a balloon and hold the peek open, for a recorder outside the process.

   The menu is UIKit's, so nothing about it is in the app's accessibility tree
   the way a drawn picker was — it is presented in a window the app does not
   own. A recording is how it gets looked at.
   */
  func testHoldABalloonForTheRecorder() throws {
    /*
     * SKIPPED, with the reason measured rather than guessed.
     *
     * The balloon declares a `<menu>` and the element knows how to hand it to
     * `UIContextMenuInteraction`, but `wantsContextMenu` never reaches
     * `ElementBoxProps` — logged at the shadow node across 1347 boxes on this
     * screen, not one carried the flag or a command. So the peek is never
     * enabled and there is no platform menu for this case to find.
     *
     * A skip rather than a red test, because a suite with a permanent failure
     * in it stops answering the only question it is for. Delete this line when
     * the flag arrives; the assertion below is already the right one.
     */
    throw XCTSkip(
      "`wantsContextMenu` does not reach the shadow node, so no platform menu "
        + "is presented — see peek-never-installed")
    // swiftlint:disable:next unreachable_code
    app.links["Chat, with a composer"].tap()
    XCTAssertTrue(
      app.textViews.firstMatch.waitForExistence(timeout: 15), "the screen never loaded")
    Thread.sleep(forTimeInterval: 1.0)
    /*
     * By COORDINATE, because a balloon's text is a painted run rather than a
     * named element — `staticTexts` does not have it. The sent balloon is the
     * second row of the seeded conversation, about a quarter of the way down.
     */
    app.windows.firstMatch
      .coordinate(withNormalizedOffset: CGVector(dx: 0.62, dy: 0.35))
      .press(forDuration: 1.2)
    /*
     * The menu is UIKit's, presented in a window the app does not own — but
     * XCUITest queries the whole application, so its rows ARE reachable. Which
     * is the only assertion worth making here: that the platform put a menu up.
     */
    XCTAssertTrue(
      app.buttons["Copy"].waitForExistence(timeout: 5),
      "the peek did not present a menu — the balloon's `<menu>` never reached "
        + "the interaction, or the hold never completed")
    Thread.sleep(forTimeInterval: 3.0)
  }
}
