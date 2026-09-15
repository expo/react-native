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

 The times are read in PIXELS rather than through the accessibility tree, and
 that is forced rather than chosen: they are drawn at zero opacity until the
 drag inks them, and UIKit leaves a fully transparent view out of the
 accessibility tree altogether. So at rest there is no time element to find —
 which is the first case below — and where one sits has to be read off the
 screen, which is the second.
 */
final class RevealCheck: DemoCase {
  override class var initialScreen: String? { "chat" }
  // The drag-returns case reads the chat's own report of the gesture.
  override class var showsPerformance: Bool { true }

  func testTheTimesCostNothingUntilDragged() throws {
    /*
     * What a UI test can say about the reveal, and what it cannot.
     *
     * CAN: at rest the times cost a balloon nothing at all — no width, no
     * touch, and no place in the accessibility tree.
     *
     * That last one used to be an aspiration this case did not hold anyone to:
     * the times were parked outside the window at full strength, so they WERE
     * in the tree, at frames past the window's trailing edge, and the case
     * asserted exactly that. Now they are inked by the drag and are drawn at
     * nothing until it starts, and UIKit leaves a fully transparent view out of
     * the tree — so the stronger property is the true one, and it is the one
     * asserted.
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
     * finger lifts, so nothing can be read while the finger is down. Sampling
     * from another queue is not a way out either: XCUITest refuses to
     * synthesise from anywhere but the main thread. The curve itself is tested
     * as arithmetic in `__tests__/resistedReveal-test.js`, the drawing is
     * filmed by `RevealShot`, and the case below reads what the spring leaves
     * on screen.
     */
    XCTAssertTrue(
      text("Did the keyboard cover the last message?").waitForExistence(timeout: 10),
      "no transcript")

    if let time = timeElement() {
      XCTFail(
        "a time is in the tree at \(time.frame) without anyone dragging — it is "
          + "either being drawn, or being offered to a reader who cannot see it")
    }
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
  private func timeElement() -> XCUIElement? {
    app.descendants(matching: .any)
      .allElementsBoundByIndex
      .first {
        $0.label.range(
          of: "^[0-9]{1,2}:[0-9]{2}(.[A-Za-z.]{2,4})?$", options: .regularExpression) != nil
      }
  }

  /*
   * The reveal's own numbers, COPIED from `packages/chat-demo/reveal.js`, which
   * owns them. A UI test cannot import the module, so there is no way to say
   * this once; what there is instead is that a change there fails the case
   * here, which is the right way round.
   */
  /// `REVEAL_SETTLED` — where a decisive drag lands.
  static let settled: CGFloat = 56
  /// `SENT_REVEAL_GAP` — the extra a SENT balloon slides past it.
  static let sentGap: CGFloat = 6
  /// `REVEAL_INK_CURVE` — the ink's strength as a power of the fraction.
  static let inkCurve: CGFloat = 2.2

  /// `revealInk` — how strongly the times are drawn at a given reveal.
  static func ink(_ shown: CGFloat) -> CGFloat {
    if shown <= 0 { return 0 }
    if shown >= settled { return 1 }
    return pow(shown / settled, inkCurve)
  }

  /**
   Screenshots taken WHILE a drag is still being held.

   `press(…thenHoldForDuration:)` blocks the test until the finger lifts, which
   is why two earlier attempts at the reveal measured the resting state and
   reported no movement. It blocks by SPINNING THE MAIN RUN LOOP, though, and a
   UI test runs on that thread — so a block scheduled before the press runs
   during the hold, on the same thread, and `XCUIScreen.main.screenshot()` from
   inside it returns the screen with the finger still down.

   That is the whole trick, and it is the only way found to read a tracked
   gesture in process. It does not extend to queries: this schedules screenshots
   and nothing else, because synthesising or querying from anywhere but the main
   thread is what XCUITest refuses.
   */
  private func shotsDuringDrag(by dx: CGFloat, at moments: [Double]) -> [XCUIScreenshot] {
    let from = app.windows.element(boundBy: 0)
      .coordinate(withNormalizedOffset: CGVector(dx: 0.90, dy: 0.34))
    var shots: [XCUIScreenshot] = []
    for moment in moments {
      DispatchQueue.main.asyncAfter(deadline: .now() + moment) {
        shots.append(XCUIScreen.main.screenshot())
      }
    }
    let hold = (moments.max() ?? 0) + 0.5
    from.press(
      forDuration: 0.1, thenDragTo: from.withOffset(CGVector(dx: dx, dy: 0)),
      withVelocity: XCUIGestureVelocity(600), thenHoldForDuration: hold)
    return shots
  }

  /**
   The ink in each row of the strip the revealed times land in.

   A strip at the trailing edge, inside the transcript's own margin: wide enough
   for the widest time, and narrow enough that a sent balloon — which the same
   drag carries the other way — is never in it. Grey ink only, so that a balloon
   that has not quite cleared the strip cannot be read as a time.
   */
  private func timeInk(_ shot: Pixels, _ window: CGRect, _ scan: (top: CGFloat, bottom: CGFloat))
    -> [(y: CGFloat, ink: CGFloat)]
  {
    var rows: [(y: CGFloat, ink: CGFloat)] = []
    var y = scan.top
    while y < scan.bottom {
      var ink: CGFloat = 0
      var x = window.maxX - 58
      while x < window.maxX - 12 {
        let c = shot.at(x: x, y: y)
        let high = CGFloat(max(c.r, max(c.g, c.b)))
        let low = CGFloat(min(c.r, min(c.g, c.b)))
        if high - low < 24 { ink += 255 - high }
        x += 1
      }
      rows.append((y, ink))
      y += 0.5
    }
    return rows
  }

  /**
   The strongest ink in the strip beside ONE row, as the mean of its darkest
   pixels.

   Darkest PIXELS rather than the sum of them, because a shallower drag has less
   of the time on screen as well as less ink in it, and a sum would confound the
   two — while a glyph's darkest pixel scales with the opacity and nothing else.

   Beside one row, and a RECEIVED one, because everything else grey in that
   strip would otherwise be read as ink: the performance banner across the top,
   and the receipt under the last sent balloon, which the same drag carries
   sideways.
   */
  private func peakInk(_ shot: Pixels, _ window: CGRect, around mid: CGFloat) -> CGFloat {
    var darkest: [CGFloat] = []
    var y = mid - 8
    while y < mid + 8 {
      var x = window.maxX - 58
      while x < window.maxX - 12 {
        let c = shot.at(x: x, y: y)
        let high = CGFloat(max(c.r, max(c.g, c.b)))
        let low = CGFloat(min(c.r, min(c.g, c.b)))
        if high - low < 24 { darkest.append(255 - high) }
        x += 1
      }
      y += 0.5
    }
    darkest.sort(by: >)
    let top = darkest.prefix(12)
    return top.isEmpty ? 0 : top.reduce(0, +) / CGFloat(top.count)
  }

  /** The middles of the bands of ink, weighted by the ink in them. */
  private func inkBands(_ rows: [(y: CGFloat, ink: CGFloat)]) -> [CGFloat] {
    let floor = (rows.map { $0.ink }.max() ?? 0) * 0.25
    var bands: [CGFloat] = []
    var run: [(y: CGFloat, ink: CGFloat)] = []
    for row in rows + [(y: 0, ink: 0)] {
      if row.ink > floor {
        run.append(row)
      } else if !run.isEmpty {
        let weight = run.reduce(0) { $0 + $1.ink }
        bands.append(run.reduce(0) { $0 + $1.y * $1.ink } / weight)
        run = []
      }
    }
    return bands
  }

  /** Two sent messages, so both shapes are on screen: one mid-run and tailless,
      one ending the run with a tail and carrying the receipt. */
  private func sendTwo() -> [String] {
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
    dismissKeyboard()
    Thread.sleep(forTimeInterval: 1.0)
    return sent
  }

  /**
   Every revealed time sits level with its balloon's own text.

   The time is laid out from the balloon's line — an absolute child whose band
   is the balloon's height, less the tail's drop where there is one — rather
   than measured after the fact with a `getBoundingClientRect` and a second
   render. The invariant that states it without measuring anything itself: the
   time's middle is the TEXT's middle. A sender name above, a tail below, a
   receipt under the balloon: none of them may move the time, and each of them
   would, by its own height, if the band were the row's.

   Read in PIXELS while the drag is HELD, which is now the only reading there
   is: the times are drawn at nothing until a drag inks them, so at rest there
   is no element to ask and nothing on screen to measure. An earlier version of
   this case grabbed screenshots as fast as it could after the lift and caught
   only the settled state — the spring is over before the first one arrives.

   It compares DIFFERENCES rather than absolute positions. Ink and a layout box
   need not share a centre, and whatever they are apart by is the same for every
   row, so subtracting one row from another leaves exactly what the invariant is
   about: whether anything IN a row moved its time relative to another row's.
   (Measured, the two agree to about a seventh of a point, so the correction is
   small — but the failure this guards is four points and up.)
   */
  func testEveryTimeSitsLevelWithItsBalloonsText() throws {
    let sent = sendTwo()

    let window = app.windows.element(boundBy: 0).frame
    /* Between the header and the composer, which is all the transcript there is
       to read — and a balloon whose middle is outside it has no time on screen
       to compare against, so it is not a subject. */
    let scan = (top: window.height * 0.14, bottom: window.height * 0.80)

    // Their middles are read BEFORE the drag: the reveal moves rows sideways,
    // so these stay true through it.
    var subjects: [(String, CGFloat)] = []
    for message in sent + [
      "The bar follows the keyboard rather than copying it.",
      "Did the keyboard cover the last message?",
    ] {
      let balloon = text(message)
      guard balloon.exists, balloon.frame.height > 0 else { continue }
      let mid = balloon.frame.midY
      if mid > scan.top + 12 && mid < scan.bottom - 12 { subjects.append((message, mid)) }
    }
    XCTAssertGreaterThanOrEqual(subjects.count, 3, "not enough balloons on screen to compare")

    let shots = shotsDuringDrag(by: -340, at: [0.9, 1.2])
    XCTAssertFalse(shots.isEmpty, "no screenshot was taken during the hold")
    let read = try XCTUnwrap(Pixels(shots[0], pointHeight: window.height))
    let rows = timeInk(read, window, scan)

    /* Non-vacuous or nothing: a screenshot with no ink in the strip would leave
       every band below empty and every comparison trivially true. */
    XCTAssertGreaterThan(
      rows.reduce(0) { $0 + $1.ink }, 2000,
      "no revealed times on screen while the drag was held — the reveal did not happen")

    let bands = inkBands(rows)
    XCTAssertGreaterThanOrEqual(
      bands.count, subjects.count,
      "found \(bands.count) bands of ink for \(subjects.count) balloons")

    let paired = subjects.map { subject -> (String, CGFloat, CGFloat) in
      (subject.0, subject.1, bands.min(by: { abs($0 - subject.1) < abs($1 - subject.1) }) ?? 0)
    }
    let (firstName, firstMid, firstBand) = paired[0]
    for (name, mid, band) in paired.dropFirst() {
      XCTAssertEqual(
        band - firstBand, mid - firstMid, accuracy: 1.0,
        "the time beside \(name) sits \((band - firstBand) - (mid - firstMid)) points "
          + "off where the one beside \(firstName) does — the tail's drop, the sender "
          + "name or the receipt moved it")
    }
  }

  /**
   The times are INKED by the drag, on the curve the platform's are.

   Two holds, one shallow and one deep, read while the finger is still down. The
   reveal each one reached is not assumed from how far the finger went — the
   rubber band is between them — but measured in the same screenshot, off the
   sent balloon's trailing edge, and the ink is then compared against what
   `revealInk` says that reveal is worth.

   The strength is read as the PEAK ink rather than the total: a shallower drag
   has less of the time on screen as well as less ink in it, so a sum would
   confound the two, while the darkest pixel of a glyph scales with the opacity
   and nothing else.

   A ratio, not an absolute: what a grey at eleven points lands on after
   antialiasing is the renderer's business, and it cancels.
   */
  func testTheTimesAreInkedByTheDrag() throws {
    _ = sendTwo()
    let window = app.windows.element(boundBy: 0).frame
    let scan = (top: window.height * 0.14, bottom: window.height * 0.80)

    /* A RECEIVED balloon, whose row the reveal does not move at all — so the
       band its time is read in is the same band in every screenshot. */
    let subject = text("The bar follows the keyboard rather than copying it.")
    XCTAssertTrue(subject.exists, "the received balloon this case reads is not on screen")
    let band = subject.frame.midY
    XCTAssertTrue(
      band > scan.top + 12 && band < scan.bottom - 12,
      "the received balloon sits outside the strip this case can read")

    /// The reveal a screenshot was taken at, and how strongly its times are inked.
    func reading(_ shot: XCUIScreenshot) throws -> (travel: CGFloat, ink: CGFloat) {
      let read = try XCTUnwrap(Pixels(shot, pointHeight: window.height))
      // The trailing edge of a sent balloon, which the reveal carries left.
      var rightmost: CGFloat = 0
      var y = scan.top
      while y < scan.bottom {
        var x = window.maxX - 2
        while x > 0 {
          let c = read.at(x: x, y: y)
          if c.b > 200 && c.r < 120 && c.g > 100 {
            rightmost = max(rightmost, x)
            break
          }
          x -= 1
        }
        y += 2
      }
      return (rightmost, peakInk(read, window, around: band))
    }

    let rest = try reading(XCUIScreen.main.screenshot())
    XCTAssertGreaterThan(rest.travel, 0, "no sent balloon on screen to measure")
    XCTAssertLessThan(
      rest.ink, 8,
      "the times are inked \(rest.ink) with nobody dragging — they should be at nothing")

    let shallow = try reading(try XCTUnwrap(shotsDuringDrag(by: -110, at: [0.9]).first))
    let deep = try reading(try XCTUnwrap(shotsDuringDrag(by: -360, at: [0.9]).first))

    /* A sent balloon travels the reveal plus its own extra gap — the ratio in
       the screen — so the reveal is the travel back through it. The rubber band
       sits between the finger and this, which is why it is measured rather than
       taken from how far the drag went. */
    let sentRate = (RevealCheck.settled + RevealCheck.sentGap) / RevealCheck.settled
    let shallowReveal = (rest.travel - shallow.travel) / sentRate
    let deepReveal = (rest.travel - deep.travel) / sentRate
    XCTAssertGreaterThan(shallowReveal, 8, "the shallow drag revealed nothing to read")
    XCTAssertGreaterThan(deepReveal, shallowReveal + 8, "the two drags reached the same place")
    XCTAssertGreaterThan(deep.ink, 20, "no ink in the deep hold — nothing was revealed")

    /* A RATIO, not an absolute: what a grey at eleven points lands on after
       antialiasing is the renderer's business, and it cancels. */
    let expected = RevealCheck.ink(shallowReveal) / RevealCheck.ink(deepReveal)
    XCTAssertEqual(
      shallow.ink / deep.ink, expected, accuracy: 0.1,
      "at \(shallowReveal) points of reveal the times are inked "
        + "\(shallow.ink / deep.ink) of what they are at \(deepReveal), and the curve "
        + "asks for \(expected)")
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
