/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 Drivers and one measurement, in the `SendDrive` mould: flows a recording
 running outside the test wants to see happen on demand, plus the one landing
 that only arithmetic can judge.
 */
final class FlowDrive: DemoCase {
  override class var initialScreen: String? { "chat" }

  /**
   "Receive a message" actually delivers an incoming balloon.

   Guards the `receive` path, which was restructured to give an incoming
   message its mount-time pop (the `arriving` flag it sets and clears — see
   `ChatScreen`). The pop itself is an animation a UI test cannot see, but the
   MESSAGE arriving is the functional half, and a regression that broke the
   rebuilt `receive` (or left `arriving` stuck so a remount replayed it) shows
   up as no new balloon. The reply text is one of `REPLIES`; any of them proves
   delivery without depending on the id arithmetic that picks which.
   */
  func testReceivingDeliversAnIncomingBalloon() throws {
    chooseCommand("Receive a message")
    // The demo shows the typing indicator for ~1.6s, then the message.
    let reply = app.descendants(matching: .any).matching(
      NSPredicate(
        format:
          "label == 'Noted.' OR label == 'Try it with the keyboard up.' "
          + "OR label BEGINSWITH 'That reads' OR label BEGINSWITH 'Scroll up first' "
          + "OR label BEGINSWITH 'And sending' OR label BEGINSWITH 'Two lines'")
    ).firstMatch
    XCTAssertTrue(
      reply.waitForExistence(timeout: 8),
      "Receive a message delivered no incoming balloon — the rebuilt `receive` "
        + "may be broken; visible: \(visibleText())")
    XCTAssertTrue(isOnScreen(reply), "the received balloon is off screen")
  }

  /**
   "React to the last message" sticks a reaction badge on the newest balloon.

   The reactions display was rebuilt after being pulled — a corner badge that is
   a SIBLING of the balloon, set from the `+` panel because the picker the platform
   floats over the platter needs a private accessory view a `<menu>` cannot make
   (see the reactions-peek memory). The command cycles the six reactions; from a
   message with none it lands on the first, Heart, whose badge and menu row both
   carry the accessible label `Loved`. A regression that drops the badge, its
   label, or the wiring to `reactions` shows up as no `Loved` element.

   The badge must also survive being SIBLING, not child: it is asserted present
   after the command, which only holds if the wrapper mounted it beside the
   balloon rather than inside it (a child would have red-boxed the same way the
   old picker's unregistered subview did).
   */
  func testReactingSticksABadgeOnTheNewestBalloon() throws {
    chooseCommand("React to the last message")
    let badge = app.descendants(matching: .any).matching(
      NSPredicate(format: "label == 'Loved'")
    ).firstMatch
    XCTAssertTrue(
      badge.waitForExistence(timeout: 6),
      "React to the last message stuck no badge — the rebuilt reaction display "
        + "or its wiring to `reactions` is broken; visible: \(visibleText())")
    XCTAssertTrue(isOnScreen(badge), "the reaction badge is off screen")
  }

  /**
   Two more participants reacting turns the lone badge into the aggregate pile.

   A message ONE person reacted to wears a single 36pt badge; a message several
   reacted to wears the aggregate pile (a 46×40 container, measured on the
   platform). The pile is one
   accessible element labelled with all its faces joined, so a label carrying
   both the first reaction (`Loved`, from "React to the last message") and one
   the others add (`Laughed at`) can only be the pile — proving the single→pile
   switch on the reaction count, and that the pile mounted as a SIBLING of the
   balloon rather than red-boxing.
   */
  func testOthersReactingShowsTheAggregatePile() throws {
    chooseCommand("React to the last message")
    chooseCommand("Others react to the last message")
    let pile = app.descendants(matching: .any).matching(
      NSPredicate(format: "label CONTAINS 'Loved' AND label CONTAINS 'Laughed at'")
    ).firstMatch
    XCTAssertTrue(
      pile.waitForExistence(timeout: 6),
      "no aggregate pile after several reactions — the single→pile switch or the "
        + "pile's combined label is broken; visible: \(visibleText())")
    XCTAssertTrue(isOnScreen(pile), "the aggregate pile is off screen")
  }

  /// Two sends with the full receipt handover between them, for the recorder:
  /// throw, receipt arrival, second throw, tail-and-receipt handover.
  func testDriveTwoSendsForTheRecorder() throws {
    let field = app.textViews.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 15), "no composer field")
    field.tap()
    XCTAssertTrue(app.keyboards.element(boundBy: 0).waitForExistence(timeout: 10))

    app.typeText("Hi")
    let send = app.buttons["Send"]
    XCTAssertTrue(send.waitForExistence(timeout: 8), "no send button with a draft")
    Thread.sleep(forTimeInterval: 1.0)
    send.tap()
    Thread.sleep(forTimeInterval: 3.2)
    app.typeText("Hey")
    Thread.sleep(forTimeInterval: 0.5)
    send.tap()
    Thread.sleep(forTimeInterval: 3.6)
  }

  /**
   A committed back-swipe with the keyboard up.

   Asserts the two halves of the behaviour that regressed in opposite
   directions: the HOME screen's docked composer comes back (it stayed gone
   when the responder claim was first guarded), and the keyboard does NOT
   come back with it (it did when the reclaim ran mid-dismissal).
   */
  func testPopWithKeyboardLandsDockedAndQuiet() throws {
    let field = app.textViews.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 15), "no composer field")
    field.tap()
    XCTAssertTrue(app.keyboards.element(boundBy: 0).waitForExistence(timeout: 10))
    Thread.sleep(forTimeInterval: 1.0)

    let window = app.windows.element(boundBy: 0)
    let start = window.coordinate(withNormalizedOffset: CGVector(dx: 0.01, dy: 0.35))
    let end = window.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.35))
    start.press(forDuration: 0.05, thenDragTo: end)

    // The pop plus the keyboard's own coordinated dismissal.
    XCTAssertTrue(
      app.staticTexts["Safe areas"].waitForExistence(timeout: 8),
      "the pop never landed on the home screen")
    Thread.sleep(forTimeInterval: 1.5)

    XCTAssertEqual(
      app.keyboards.count, 0,
      "the keyboard is still up on the home screen after the pop")
    // The placeholder's label arrives composited with scroll-bar chatter, so
    // a prefix match is the honest query; the + button seals it.
    let placeholder = app.descendants(matching: .any)
      .matching(NSPredicate(format: "label BEGINSWITH 'Message'"))
      .firstMatch
    XCTAssertTrue(
      isOnScreen(placeholder) && plusButton().exists,
      "the home screen's docked composer never came back; visible: \(visibleText())")
  }

  /**
   A CANCELLED back-swipe with the keyboard down leaves THIS screen's bar.

   The bar that shows after a cancel must be the chat's own, and the only way to
   tell two composers apart is their contents — which is how the bug was reported:
   "I typed text into each accessory to be able to tell the difference." So this
   types into the chat's bar and asserts the text is still there afterwards. A
   home-screen bar would be empty.

   Driven as a slow short drag with a hold before release, which is what makes it
   a CANCEL: a quick drag to a fraction of the width silently commits the pop, and
   a test that commits proves nothing about cancelling. The assertion that the
   home screen is absent is there to catch exactly that.

   `idb` cannot drive this at all — a cancel needs the finger to go out and come
   back, and it only draws straight lines; short distances did not even start the
   transition. This is the only harness that reaches the case.
   */
  func testCancelledSwipeKeyboardDownKeepsThisScreensBar() throws {
    let field = app.textViews.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 15), "no composer field")
    field.tap()
    XCTAssertTrue(app.keyboards.element(boundBy: 0).waitForExistence(timeout: 10))
    app.typeText("CHATBAR")
    dismissKeyboard()
    Thread.sleep(forTimeInterval: 1.0)

    /*
     * The PRECONDITION, asserted rather than assumed.
     *
     * The whole test rests on the chat's bar being identifiable by its contents.
     * If the text does not survive putting the keyboard away, the check below
     * fails for a reason that has nothing to do with which bar is on screen —
     * and would be reported as the bug reproducing.
     */
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
    Thread.sleep(forTimeInterval: 1.5)

    XCTAssertFalse(
      app.staticTexts["Safe areas"].exists,
      "the pop committed — this is not a cancelled swipe, so the case is untested")

    let shown = app.textViews.firstMatch
    XCTAssertTrue(shown.waitForExistence(timeout: 5), "no composer after the cancelled swipe")
    let value = (shown.value as? String) ?? ""
    XCTAssertTrue(
      value.contains("CHATBAR"),
      "the bar after a cancelled swipe is not this screen's — its contents are "
        + "\"\(value)\", visible: \(visibleText())")
  }

  /**
   Two hundred messages, scrolled to the top, then the composer focused: the
   present intent must land the newest message at the transcript's resting
   position above the keyboard — with virtualized rows materialising under
   the jump, which is exactly what used to leave it somewhere else.
   */
  func testHundredsThenRevealLandsAtTheLatest() throws {
    /*
     * Seeded, not added. This used to open the `+` panel four times for "Add
     * fifty messages" — a quarter of the test spent driving UI that is not
     * under test. `EXP_SEED_MESSAGES` reaches the chat as initial props, so
     * one relaunch buys the same 203-message conversation the four commands
     * built, with the same labels ("Message 203, …" is `mockConversation`'s
     * own numbering either way).
     */
    app.launchEnvironment["EXP_SEED_MESSAGES"] = "203"
    app.terminate()
    app.launch()
    // The relaunch keeps `EXP_OPEN_SCREEN=chat` from `setUp`, so the sentinel
    // is the chat's own title — the home one is occluded beneath it.
    XCTAssertTrue(
      app.staticTexts["Chat"].waitForExistence(timeout: 30),
      "the seeded relaunch never rendered")

    let field = app.textViews.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 15), "no composer field")

    /*
     * To the very top in ONE gesture: the status-bar tap is UIKit's own
     * scroll-to-top, aimed through SpringBoard because the bar is the
     * system's, not this app's — the aiming is proven separately by
     * `testTappingTheStatusBarReturnsToTheSameRestingPosition`. It replaced
     * twelve coarse drags; this test's subject is the reveal from far away,
     * not the journey there.
     */
    XCUIApplication(bundleIdentifier: "com.apple.springboard")
      .coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.0))
      .withOffset(CGVector(dx: 0, dy: 8))
      .tap()
    Thread.sleep(forTimeInterval: 1.5)

    field.tap()
    XCTAssertTrue(app.keyboards.element(boundBy: 0).waitForExistence(timeout: 10))
    // The jump, the keyboard's rise, and every follow-up correction.
    Thread.sleep(forTimeInterval: 2.5)

    let last = text("Message 203, from Charles Babbage.")
    let fallback = text("Message 203, sent.")
    let newest = last.exists ? last : fallback
    XCTAssertTrue(
      newest.exists,
      "the newest message is not in the tree at all; visible: \(visibleText())")
    XCTAssertTrue(
      isOnScreen(newest),
      "the newest message is off screen after the reveal; visible: \(visibleText())")

    /*
     * WHERE it sits, not merely that it is visible. The transcript rests with
     * the newest row a fixed inset above the composer; landing short leaves a
     * gap below it, landing long hides part of it behind the bar. The bar's
     * top is the field's box; a row's text bottom sits the balloon padding
     * plus the transcript's bottom inset above that — generously bounded here
     * because fonts and insets move, and the failure this exists to catch was
     * tens of points, not two.
     */
    let gap = field.frame.minY - newest.frame.maxY
    XCTAssertGreaterThanOrEqual(
      gap, 4, "the newest message is under the composer by \(-gap) points")
    XCTAssertLessThanOrEqual(
      gap, 60, "the newest message rests \(gap) points above the composer — landed short")
  }
}
