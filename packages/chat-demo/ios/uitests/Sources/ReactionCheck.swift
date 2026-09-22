/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 A long press on a balloon opens UIKit's context menu (from the balloon's
 `<menu>`), and a tap opens nothing.
 */
// covers: screens/ChatScreen.js reactions.js
final class ReactionCheck: DemoCase {
  override class var initialScreen: String? { "chat" }

  /**
   A long press opens one UIKit menu with native Messages' commands. Only one:
   the element box also has its own long-press timer that fires `contextmenu`,
   which must stay off when the balloon has a menu interaction.
   */
  /// One launch, the tap first: the hold leaves a menu open.
  func testATapOpensNothingAndTheHoldOpensThePlatformsMenuAndOnlyThat() throws {
    try XCTContext.runActivity(named: "a tap opens nothing") { _ in
      // Hold-then-drag isn't tested: UIKit starts the lift before the scroll's
      // pan begins, as in native Messages. See
      // DOM-CSS-LIMITATION(peek-outruns-the-scroll).

      let balloon = text("Did the keyboard cover the last message?")
      XCTAssertTrue(appears(balloon, within: 10), "no balloon to tap")

      // Through a coordinate, for the same reason as `hold`.
      balloon.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
      // A second: a menu that opened late would still be a failure
      XCTAssertFalse(
        waitUntil(1.0) { app.buttons["Copy"].exists },
        "a tap opened the menu; visible: \(visibleText())")
    }

    try XCTContext.runActivity(named: "the hold opens the platform menu and only that") { _ in

      let balloon = text("Did the keyboard cover the last message?")
      XCTAssertTrue(appears(balloon, within: 10), "no balloon to hold")

      hold(balloon)

      let copy = app.buttons["Copy"]
      XCTAssertTrue(
        appears(copy, within: 4),
        "the hold opened no menu, or it carried no Copy row — so either "
          + "`contextmenu` never reached the platform or the menu is the app's own "
          + "drawing; visible: \(visibleText())")
      XCTAssertTrue(
        isOnScreen(copy), "the menu is mounted but off screen — check the anchor")
      XCTAssertEqual(
        app.buttons.matching(identifier: "Copy").count, 1,
        "two menus opened from one press — the box's fallback hold did not stand "
          + "down for the balloon's interaction")

      // "More…" ends with an ellipsis character, so match its prefix.
      for command in ["Translate", "Select"] {
        XCTAssertTrue(
          app.buttons[command].exists,
          "the menu is missing its \(command) row; visible: \(visibleText())")
      }
      XCTAssertTrue(
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'More'")).firstMatch.exists,
        "the menu is missing its More row; visible: \(visibleText())")
    }
  }
}

/**
 Leaving the chat after opening its `+` panel doesn't crash the app (checked by
 the home screen appearing). `<native:keyboardpanel>` mounts its children in
 its own view, so its unmounting must match, or the base class's unmount
 asserts.
 */
// covers: Composer.js App.js
final class TeardownCheck: DemoCase {
  override class var initialScreen: String? { "chat" }

  func testLeavingAChatThatHasOpenedItsPanelDoesNotAbort() throws {
    // The home screen's link: seeing it at the end shows the pop finished.
    let chat = app.links["Chat, with a composer"]

    // Open and close the panel, so it has mounted children when the chat goes.
    let plus = plusButton()
    XCTAssertTrue(appears(plus, within: 8), "no + button in the chat")
    plus.tap()
    XCTAssertTrue(
      appears(app.buttons["Receive a message"], within: 6),
      "the panel never opened, so this would prove nothing")
    plus.tap()
    Thread.sleep(forTimeInterval: 0.6)

    back()

    XCTAssertTrue(
      appears(chat, within: 8),
      "the app did not come back to the home screen — check the log for an abort")
  }

  /** Taps the navigation bar's back button, whatever its label. */
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
 Dragging the transcript left reveals each message's time, and the list still
 scrolls vertically. The times are read in pixels: they are transparent until
 dragged, so UIKit leaves them out of the accessibility tree.
 */
// covers: screens/ChatScreen.js reveal.js
final class RevealCheck: DemoCase {
  override class var initialScreen: String? { "chat" }
  // `testTheTranscriptComesBackWhenTheDragIsLetGo` reads the performance report.
  override class var showsPerformance: Bool { true }

  /// One launch for the three: two messages sent once for the two drags that
  /// read them, then the list with fifty more.
  func testEveryTimeSitsLevelIsInkedByTheDragAndTheListStillScrolls() throws {
    let sent = sendTwo()

    try XCTContext.runActivity(named: "every time sits level with its balloon's text") { _ in

      let window = app.windows.element(boundBy: 0).frame
      let scan = transcriptBand()

      // Read before the drag; the reveal only moves rows sideways.
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

      let shots = shotsDuringDrag(from: revealFrom(), by: -340, at: [0.9, 1.2])
      XCTAssertFalse(shots.isEmpty, "no screenshot was taken during the hold")
      let read = try XCTUnwrap(Pixels(shots[0], pointHeight: window.height))
      let rows = timeInk(read, window, scan)

      /* Without ink in the strip every comparison below would pass. */
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

    // The reveal springs back once the drag is let go
    settled(text(sent[1]))

    try XCTContext.runActivity(named: "the times are inked by the drag") { _ in
      let window = app.windows.element(boundBy: 0).frame
      let scan = transcriptBand()

      /* A received balloon: the reveal doesn't move it. */
      let subject = text("The bar follows the keyboard rather than copying it.")
      XCTAssertTrue(subject.exists, "the received balloon this case reads is not on screen")
      let band = subject.frame.midY
      XCTAssertTrue(
        band > scan.top + 12 && band < scan.bottom - 12,
        "the received balloon sits outside the strip this case can read")

      /// A sent balloon's trailing edge and the times' ink in one screenshot.
      func reading(_ shot: XCUIScreenshot) throws -> (travel: CGFloat, ink: CGFloat) {
        let read = try XCTUnwrap(Pixels(shot, pointHeight: window.height))
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

      let shallow = try reading(try XCTUnwrap(shotsDuringDrag(from: revealFrom(), by: -110, at: [0.9]).first))
      let deep = try reading(try XCTUnwrap(shotsDuringDrag(from: revealFrom(), by: -360, at: [0.9]).first))

      /* A sent balloon moves (settled + sentGap) / settled times the reveal. */
      let sentRate = (RevealCheck.settled + RevealCheck.sentGap) / RevealCheck.settled
      let shallowReveal = (rest.travel - shallow.travel) / sentRate
      let deepReveal = (rest.travel - deep.travel) / sentRate
      XCTAssertGreaterThan(shallowReveal, 8, "the shallow drag revealed nothing to read")
      XCTAssertGreaterThan(deepReveal, shallowReveal + 8, "the two drags reached the same place")
      XCTAssertGreaterThan(deep.ink, 20, "no ink in the deep hold — nothing was revealed")

      /* A ratio, so antialiasing cancels. */
      let expected = RevealCheck.ink(shallowReveal) / RevealCheck.ink(deepReveal)
      XCTAssertEqual(
        shallow.ink / deep.ink, expected, accuracy: 0.1,
        "at \(shallowReveal) points of reveal the times are inked "
          + "\(shallow.ink / deep.ink) of what they are at \(deepReveal), and the curve "
          + "asks for \(expected)")
    }

    settled(text(sent[1]))

    try XCTContext.runActivity(named: "the list still scrolls vertically") { _ in
      chooseCommand("Add fifty messages")

      let list = app.scrollViews.firstMatch
      XCTAssertTrue(appears(list, within: 8), "no transcript")
      let anchor = text("Message 53, sent.")
      XCTAssertTrue(appears(anchor, within: 8), "the fifty never arrived")

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

  // Copies of the reveal's constants; must match reveal.js and, for
  // `SENT_REVEAL_GAP`, screens/ChatScreen.js.
  /// `REVEAL_SETTLED`: the full reveal, in points.
  static let settled: CGFloat = 56
  /// `SENT_REVEAL_GAP`: how much further a sent balloon moves.
  static let sentGap: CGFloat = 6
  /// `REVEAL_INK_CURVE`: the exponent of the ink's opacity curve.
  static let inkCurve: CGFloat = 2.2

  /// `revealInk`: the times' opacity for a reveal distance.
  static func ink(_ shown: CGFloat) -> CGFloat {
    if shown <= 0 { return 0 }
    if shown >= settled { return 1 }
    return pow(shown / settled, inkCurve)
  }

  /** The vertical range between the header and the composer, in points. */
  private func transcriptBand() -> (top: CGFloat, bottom: CGFloat) {
    let height = app.windows.element(boundBy: 0).frame.height
    return (top: height * 0.14, bottom: height * 0.80)
  }

  /** On a row: a drag from empty transcript space scrolls instead. */
  private func revealFrom() -> XCUICoordinate {
    app.windows.element(boundBy: 0)
      .coordinate(withNormalizedOffset: CGVector(dx: 0.90, dy: 0.34))
  }

  /// Grey ink per pixel row in `strip`, where revealed times appear. Counting
  /// grey only ignores a sent balloon that hasn't cleared the strip.
  private func timeInk(_ shot: Pixels, _ window: CGRect, _ scan: (top: CGFloat, bottom: CGFloat))
    -> [(y: CGFloat, ink: CGFloat)]
  {
    var rows: [(y: CGFloat, ink: CGFloat)] = []
    var y = scan.top
    while y < scan.bottom {
      rows.append((y, strip(window).reduce(0) { $0 + greyInk(shot, $1, y) }))
      y += 0.5
    }
    return rows
  }

  /** Columns 12–58 pt from the trailing edge, 1 pt apart: wide enough for the
      widest time, clear of a sent balloon once the reveal has moved it. */
  private func strip(_ window: CGRect) -> StrideThrough<CGFloat> {
    stride(from: window.maxX - 58, through: window.maxX - 12, by: 1)
  }

  /** How dark a point is, counting grey ink only; a colour cast is a balloon. */
  private func greyInk(_ shot: Pixels, _ x: CGFloat, _ y: CGFloat) -> CGFloat {
    let c = shot.at(x: x, y: y)
    let high = CGFloat(max(c.r, max(c.g, c.b)))
    let low = CGFloat(min(c.r, min(c.g, c.b)))
    return high - low < 24 ? 255 - high : 0
  }

  /**
   Mean of the 12 darkest pixels in `strip` within 8 pt of `mid`. The darkest
   pixels scale with opacity alone, where a sum would also grow with how much
   of the time is on screen. Use a received row's middle, away from the
   performance banner and the receipt.
   */
  private func peakInk(_ shot: Pixels, _ window: CGRect, around mid: CGFloat) -> CGFloat {
    var darkest: [CGFloat] = []
    var y = mid - 8
    while y < mid + 8 {
      for x in strip(window) {
        darkest.append(greyInk(shot, x, y))
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

  /** Sends two messages, so a tailless balloon and a tailed one with a
      receipt are both on screen. */
  private func sendTwo() -> [String] {
    let field = app.textViews.firstMatch
    XCTAssertTrue(appears(field, within: 15), "no composer field")
    let sent = ["Tailless one", "Tailed two"]
    for message in sent {
      field.tap()
      type(message)
      let send = app.buttons["Send"]
      XCTAssertTrue(appears(send, within: 8), "no send button with a draft")
      send.tap()
      XCTAssertTrue(appears(text(message), within: 10), "\(message) never appeared")
    }
    // The second send's flight and its receipt
    XCTAssertTrue(waitUntil(8) { text("Delivered").exists && text("Delivered").frame.minY > text(sent[1]).frame.minY }, "the receipt never reached the second message")
    settled(text(sent[1]))
    dismissKeyboard()
    settled(field)
    return sent
  }

}

/// testTheTranscriptComesBackWhenTheDragIsLetGo on its own launch, so its seed is the launch's and there is no second one.
// covers: screens/ChatScreen.js reveal.js
final class RevealComesBackCheck: DemoCase {
  override class var initialScreen: String? { "chat" }
  override class var seedMessages: Int? { 60 }
  override class var showsPerformance: Bool { true }

  /**
   After a slow drag is released, the transcript returns to where it was. Read
   in pixels (a sent balloon's rightmost blue pixel): accessibility frames
   ignore `transform`, so they would pass whether or not it came back.
   */
  func testTheTranscriptComesBackWhenTheDragIsLetGo() throws {
    XCTAssertTrue(
      appears(app.staticTexts["Chat"], within: 30), "the seeded chat never rendered")

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

    // Slow, like a finger: a quick flick returns regardless.
    let start = app.windows.element(boundBy: 0)
      .coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.45))
    start.press(
      forDuration: 0.1, thenDragTo: start.withOffset(CGVector(dx: -240, dy: 0)),
      withVelocity: XCUIGestureVelocity(100), thenHoldForDuration: 0.5)

    // `endWork('reveal')` in ChatScreen.js reports "reveal — …" only if the
    // drag was taken as a reveal.
    let reported = app.descendants(matching: .any).matching(
      NSPredicate(format: "label BEGINSWITH 'reveal — '")
    ).firstMatch
    XCTAssertTrue(
      appears(reported, within: 5),
      "the drag was not taken as a reveal; visible: \(visibleText())")

    Thread.sleep(forTimeInterval: 1.5)
    let settled = try blueEdge()
    XCTAssertEqual(
      settled, resting, accuracy: 2,
      "the transcript rests \(resting - settled) points left of where it started — "
        + "the reveal did not come back")
  }
}
