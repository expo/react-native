/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 A hold on a balloon opens the reaction picker, and choosing one sticks.

 Three separate things have to work for this to pass:

 - The hold has to REACH JavaScript. It is `contextmenu`, the event a browser
   fires when a finger rests on an element, timed natively from the touches the
   box already receives. A `<div>` reports no presses at all — that is
   deliberate, since every paragraph on every screen is one — so nothing else
   would carry it.
 - The picker has to appear WHERE THE BALLOON IS. A measurement inside a scroll
   view comes back in the CONTENT's coordinates, and the transcript rests at
   minus its top inset, so an anchor that ignores the inset puts the pill 117
   points too high — off the top of the screen.
 - Choosing has to not take the app down. The pill draws a material, an
   unregistered extra subview shifts every mount index after it, and unmounting
   the pill then aborts on `unmountChildComponentView:index:`.

 Asserted through the accessible name rather than pixels: the badge and the
 picker's item share the label `Loved`, and after choosing, the picker is gone —
 so a `Loved` element still on screen is the badge.
 */
final class ReactionCheck: DemoCase {
  override class var initialScreen: String? { "chat" }

  /**
   A hold at an element's centre, through a COORDINATE.

   `press(forDuration:)` on the element itself refuses with *Not hittable*: a
   balloon's text is painted by its box rather than mounted as a view, so the
   element the accessibility tree offers is not a target. The point is still the
   right point, and a coordinate derived from it presses there.
   */
  private func hold(_ element: XCUIElement) {
    element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
      .press(forDuration: 0.9)
  }

  /**
   The hold opens the PLATFORM's menu, and only that.

   Two things tell it apart from a drawing of the app's own, and both are
   assertions rather than descriptions:

   - **"Copy" exists.** A `<menu>` handed to `UIContextMenuInteraction` produces
     a real UIKit command row, so a row saying Copy can only have come from the
     platform's menu rather than any drawing of the app's own.
   - **There is exactly one "Copy".** The element box runs a fallback hold of
     its own and publishes `contextmenu` from a timer; a balloon that installed
     the interaction tells its box to stop, or one press starts two menus half a
     frame apart and the reader gets both.
   */
  func testTheHoldOpensThePlatformsMenuAndOnlyThat() throws {

    let balloon = text("Did the keyboard cover the last message?")
    XCTAssertTrue(balloon.waitForExistence(timeout: 10), "no balloon to hold")

    hold(balloon)

    let copy = app.buttons["Copy"]
    XCTAssertTrue(
      copy.waitForExistence(timeout: 4),
      "the hold opened no menu, or it carried no Copy row — so either "
        + "`contextmenu` never reached the platform or the menu is the app's own "
        + "drawing; visible: \(visibleText())")
    XCTAssertTrue(
      isOnScreen(copy), "the menu is mounted but off screen — check the anchor")
    XCTAssertEqual(
      app.buttons.matching(identifier: "Copy").count, 1,
      "two menus opened from one press — the box's fallback hold did not stand "
        + "down for the balloon's interaction")

    // The full command set the native chat shows under the reactions — all
    // four, from the `<menu>`'s `<li>` rows. A regression that drops one (or
    // reverts the menu to Copy-only) fails here. "More…" carries an ellipsis
    // character.
    for command in ["Translate", "Select"] {
      XCTAssertTrue(
        app.buttons[command].exists,
        "the menu is missing its \(command) row; visible: \(visibleText())")
    }
    XCTAssertTrue(
      app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'More'")).firstMatch.exists,
      "the menu is missing its More row; visible: \(visibleText())")
  }

  func testATapOpensNothing() throws {
    /*
     * The picker belongs to a HOLD, and only to a hold.
     *
     * A hold-then-drag is not a case that can be written:
     * `UIContextMenuInteraction` commits to the lift before the scroll starts.
     * Measured, with the interaction logging its own callbacks against the
     * scroll view's pan: UIKit asks for a configuration at 44.101 and the
     * scroll's pan reaches `Began` at 44.181 — eighty milliseconds later, so
     * nothing downstream can take the lift back. Removing and re-adding the
     * interaction from the pan's first callback is too late for the same
     * reason.
     *
     * That is also the native chat's behaviour — once a balloon lifts, dragging
     * moves the preview rather than dismissing it — so the platform's answer is
     * the one to keep. A synthetic gesture that holds still for three hundred
     * milliseconds before moving does dismiss it, but a finger beginning a
     * scroll does not hold still.
     *
     * See DOM-CSS-LIMITATION(peek-outruns-the-scroll).
     */

    let balloon = text("Did the keyboard cover the last message?")
    XCTAssertTrue(balloon.waitForExistence(timeout: 10), "no balloon to tap")

    // Through a coordinate, like `hold` above: `tap()` insists the element be
    // "hittable", and a balloon's accessible element is the box behind its own
    // text, so XCUITest declines. The point is the same one a finger would land
    // on.
    balloon.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
    Thread.sleep(forTimeInterval: 1.0)
    XCTAssertFalse(
      app.buttons["Copy"].exists,
      "a tap opened the menu; visible: \(visibleText())")
  }
}

/**
 Leaving a screen that has a panel in it does not take the app down.

 `<native:keyboardpanel>` puts React's children into the panel's own view — they
 are drawn in the keyboard's window — so it has to override BOTH halves of
 mounting. The base class's unmount asserts the child's superview IS the
 component view, so a panel that overrides the mounting half alone hits *Attempt
 to unmount a view which is mounted inside a different view* the moment the
 screen goes away.

 Only a panel WITH CHILDREN IN IT reaches that: opening it, using it and closing
 it touch nothing here, and walking out is the whole case.

 The assertion is that the app is still answering afterwards: a process that has
 aborted cannot show you the home screen.
 */
final class TeardownCheck: DemoCase {
  override class var initialScreen: String? { "chat" }

  func testLeavingAChatThatHasOpenedItsPanelDoesNotAbort() throws {
    // Already in the chat (the seeded launch); the link matters again at the
    // END, as the proof the pop landed.
    let chat = app.links["Chat, with a composer"]

    // The panel has to have MOUNTED CHILDREN for this to be the failing case,
    // so it is opened and closed rather than merely present.
    let plus = plusButton()
    XCTAssertTrue(plus.waitForExistence(timeout: 8), "no + button in the chat")
    plus.tap()
    XCTAssertTrue(
      app.buttons["Receive a message"].waitForExistence(timeout: 6),
      "the panel never opened, so this would prove nothing")
    plus.tap()
    Thread.sleep(forTimeInterval: 0.6)

    back()

    XCTAssertTrue(
      chat.waitForExistence(timeout: 8),
      "the app did not come back to the home screen — check the log for an abort")
  }

  /** The native header's back button, whatever it is called on this system. */
  private func back() {
    let bar = app.navigationBars.element(boundBy: 0)
    let named = bar.buttons["Back"]
    if named.exists {
      named.tap()
      return
    }
    let first = bar.buttons.element(boundBy: 0)
    XCTAssertTrue(first.exists, "no back button in the navigation bar")
    first.tap()
  }
}

/**
 Dragging the transcript aside shows each message's time, and does not cost the
 list its own gesture.

 Both halves matter and they pull against each other. A horizontal drag has to
 be claimed from a scroll view that is already watching every touch — and a
 responder that claims too eagerly takes vertical scrolling with it, which is a
 far worse trade than not having the feature.

 The times are read through the accessibility tree rather than pixels: `7:36` is
 there or it is not, and where exactly it sits is the drag's business.
 */
final class RevealCheck: DemoCase {
  override class var initialScreen: String? { "chat" }
  // The drag-returns case reads the chat's own report of the gesture.
  override class var showsPerformance: Bool { true }

  func testTheTimesAreParkedOffScreenUntilDragged() throws {
    /*
     * What a UI test can say about the reveal, and what it cannot.
     *
     * CAN: the times are mounted and sitting outside the window, so they cost a
     * balloon no width, take no touch, add nothing to the accessibility tree,
     * and are there the instant a drag starts.
     *
     * The property has to survive the column's WIDTH. A column wide enough for
     * "10:38 PM" is fifty-two points, and a drag moves the transcript forty —
     * so a column that starts off screen and travels at the transcript's rate
     * cannot reach the margin. Placing it where it lands and fading it in
     * reaches the margin and gives this property up: it then overlaps the
     * trailing strip of every sent balloon, invisibly. What keeps both is
     * letting the column travel FASTER than the transcript — see
     * `REVEAL_COLUMN_RATE` — which is also nearer what the native chat does,
     * where the times do not move at all and the balloons slide off them.
     *
     * CANNOT: the drag itself. `press(…thenHoldForDuration:)` blocks until the
     * finger lifts and the reveal springs back the moment it does, so every
     * reading after it is a reading of the resting state, and a case that
     * samples there reports no movement whatever the drag did. Sampling from
     * another queue is not a way out either: XCUITest refuses to synthesise from
     * anywhere but the main thread. The curve itself is tested as arithmetic in
     * `__tests__/resistedReveal-test.js`, and the drag is verified by
     * screenshot.
     */
    XCTAssertTrue(
      text("Did the keyboard cover the last message?").waitForExistence(timeout: 10),
      "no transcript")

    guard let time = timeElement() else {
      return XCTFail("no time element in the transcript; visible: \(visibleText())")
    }
    let window = app.windows.element(boundBy: 0).frame
    XCTAssertGreaterThanOrEqual(
      time.frame.minX, window.maxX - 4,
      "a time is on screen without anyone dragging — it would be taking width "
        + "from every balloon, and a touch from the one beside it")
  }

  /**
   The first element whose label reads like a clock time.

   The day period is OPTIONAL, and the space before it is ANY character.

   The column asks `Intl` for a short time, so a 24-hour locale gets `15:52` with
   nothing appended and en-US gets `3:52 PM` — where ICU separates the marker
   with U+202F, a narrow no-break space, not a plain one. A pattern that ends at
   the minutes, or that demands a plain space, reads "no time element in the
   transcript" about a transcript full of them.
   */
  /**
   Every element whose label reads like a clock time.

   Through a PREDICATE, not by walking the tree: `allElementsBoundByIndex` on
   `descendants(matching: .any)` materialises every element in the app, which is
   free at three messages and minutes at three hundred.
   */
  private func revealedTimes() -> [XCUIElement] {
    app.descendants(matching: .any)
      .matching(NSPredicate(format: "label MATCHES %@", "[0-9]{1,2}:[0-9]{2}(.[A-Za-z.]{2,4})?"))
      .allElementsBoundByIndex
  }

  private func timeElement() -> XCUIElement? {
    app.descendants(matching: .any)
      .allElementsBoundByIndex
      .first {
        $0.label.range(
          of: "^[0-9]{1,2}:[0-9]{2}(.[A-Za-z.]{2,4})?$", options: .regularExpression) != nil
      }
  }

  /**
   Every parked time sits level with its balloon's own text.

   The time is laid out from the balloon's line — an absolute child whose band
   is the balloon's height, less the tail's drop where there is one — rather
   than measured after the fact with a `getBoundingClientRect` and a second
   render. The invariant that states it without measuring anything itself: the
   time's middle is the TEXT's middle. A sender name above, a tail below, a
   receipt under the balloon: none of them may move the time, and each of them
   would, by its own height, if the band were the row's.

   Read AT REST, the only reading a UI test can trust here — the drag springs
   back the moment the finger lifts (see the case above), and parking the
   column moves it in X alone.

   Two sent messages put both shapes on screen: the first is mid-run and
   tailless, the second ends the run with a tail and carries the receipt.
   */
  func testEveryTimeSitsLevelWithItsBalloonsText() throws {
    let field = app.textViews.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 15), "no composer field")
    let sent = ["Tailless one", "Tailed two"]
    for message in sent {
      field.tap()
      app.typeText(message)
      let send = app.buttons["Send"]
      XCTAssertTrue(send.waitForExistence(timeout: 8), "no send button with a draft")
      send.tap()
      XCTAssertTrue(text(message).waitForExistence(timeout: 10), "\(message) never appeared")
    }
    // The flight, the receipt opening, and the tail leaving the first balloon.
    Thread.sleep(forTimeInterval: 2.5)

    let times = revealedTimes()
    XCTAssertGreaterThanOrEqual(
      times.count, 3, "the transcript should have a parked time per message")

    // Both sent messages, and a received one that carries a sender name.
    var subjects = sent.map { text($0) }
    let named = text("Did the keyboard cover the last message?")
    if named.exists { subjects.append(named) }
    for balloon in subjects {
      let mid = balloon.frame.midY
      let time = try XCTUnwrap(
        times.min(by: { abs($0.frame.midY - mid) < abs($1.frame.midY - mid) }),
        "no time near \(balloon.label)")
      XCTAssertEqual(
        time.frame.midY, mid, accuracy: 1.5,
        "the time beside \(balloon.label) is \(time.frame.midY - mid) points off its "
          + "text's middle — the tail's drop, the sender name or the receipt moved it")
    }
  }

  /**
   The transcript comes back when the drag is let go.

   Read in PIXELS — the rightmost blue pixel, a sent balloon's trailing edge,
   which the reveal carries left with everything else. An accessibility frame
   does not reflect a transform: every time element reports its resting
   position whether or not the reveal has moved it, so a query-based version of
   this case passed against a build whose transcript never came back.

   What it CANNOT do, stated because a case that cannot fail is worse than no
   case: it does not catch a transcript left stranded by a settle that changes
   drivers mid-flight. That one is measured by hand — an `idb` drag of two and
   a half seconds reads 385 pt at rest, 343 during, and 343 three seconds after
   release — and no XCUITest gesture, slow or quick, reproduces it. So this
   guards the plain property, that a reveal returns at all.
   */
  func testTheTranscriptComesBackWhenTheDragIsLetGo() throws {
    app.launchEnvironment["EXP_SEED_MESSAGES"] = "60"
    app.terminate()
    app.launch()
    XCTAssertTrue(
      app.staticTexts["Chat"].waitForExistence(timeout: 30), "the seeded chat never rendered")

    /// The rightmost blue pixel across the transcript, in points.
    func blueEdge() throws -> CGFloat {
      let shot = try pixels()
      let window = app.windows.element(boundBy: 0).frame
      var rightmost: CGFloat = 0
      var y = window.height * 0.25
      while y < window.height * 0.72 {
        var x = window.width - 2
        while x > 0 {
          let c = shot.at(x: x, y: y)
          if c.b > 200 && c.r < 120 && c.g > 100 {
            rightmost = max(rightmost, x)
            break
          }
          x -= 2
        }
        y += 8
      }
      return rightmost
    }

    let resting = try blueEdge()
    XCTAssertGreaterThan(resting, 0, "no sent balloon on screen to measure")

    /*
     SLOWLY, over a couple of seconds. A quick flick is taken as a reveal and
     comes back regardless; the failure needs a drag long enough to have driven
     the views from JavaScript for a while before the settle asks for the other
     driver — which is what a finger does.
     */
    let start = app.windows.element(boundBy: 0)
      .coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.45))
    start.press(
      forDuration: 0.1, thenDragTo: start.withOffset(CGVector(dx: -240, dy: 0)),
      withVelocity: XCUIGestureVelocity(100), thenHoldForDuration: 0.5)

    // The app's own caption reports the gesture, so a drag the responder never
    // claimed cannot pass this case by never having moved anything.
    let reported = app.descendants(matching: .any).matching(
      NSPredicate(format: "label BEGINSWITH 'reveal — '")
    ).firstMatch
    XCTAssertTrue(
      reported.waitForExistence(timeout: 5),
      "the drag was not taken as a reveal; visible: \(visibleText())")

    Thread.sleep(forTimeInterval: 1.5)
    let settled = try blueEdge()
    XCTAssertEqual(
      settled, resting, accuracy: 2,
      "the transcript rests \(resting - settled) points left of where it started — "
        + "the reveal did not come back")
  }

  func testTheListStillScrollsVertically() throws {
    chooseCommand("Add fifty messages")

    let list = app.scrollViews.firstMatch
    XCTAssertTrue(list.waitForExistence(timeout: 8), "no transcript")
    let anchor = text("Message 53, sent.")
    XCTAssertTrue(anchor.waitForExistence(timeout: 8), "the fifty never arrived")

    let before = anchor.frame.minY
    list.swipeDown(velocity: .fast)
    Thread.sleep(forTimeInterval: 1.0)
    let after = anchor.frame.minY

    XCTAssertNotEqual(
      before, after,
      "the list did not move — a pan responder that claims too eagerly takes "
        + "vertical scrolling with it")
  }
}
