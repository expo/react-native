/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 The scroll view reserves exactly the bar, and not a point more.

 This is a bug report turned into an assertion. Reported as "when I scroll down
 to the last row after dismissing the keyboard I see extra blue spacing under
 it", and measured off the screenshot as 33.7 points of reserve ending at the
 bar's top — one bottom safe area, over-reserved.

 The state matters and is the whole reason it went unnoticed: it appears only
 after the keyboard has been raised AND dismissed. At a fresh launch the reserve
 is right, and with the keyboard up it is right. I could not reproduce it for a
 day because I never focused and dismissed before scrolling down.

 The demo tints reserved space, so the fault has a colour: any tinted pixel
 between the last row and the bar IS the over-reserve. That is what this looks
 for, which also makes it fail for the right reason — a test that compared frame
 numbers would pass while showing a visible band, and one that only checked the
 resting states would never see this at all.
 */
final class ReserveCheck: DemoCase {
  func testNoReserveLeftUnderTheLastRowAfterDismissing() throws {
    let field = app.textViews.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 10), "no composer field")

    // Raise the keyboard, then dismiss it. Both, in that order: this is the one
    // sequence the fault needs.
    field.tap()
    XCTAssertTrue(
      app.keyboards.element(boundBy: 0).waitForExistence(timeout: 10),
      "the keyboard never came up, so the dismissal proves nothing")
    dismissKeyboard()

    // To the very bottom, which is where a bottom over-reserve is visible.
    // Driven to a CONDITION rather than a fixed number of swipes: how many it
    // takes depends on the row count and the device.
    let list = app.scrollViews.firstMatch
    let lastRow = text("row 10")
    var swipes = 0
    // ON SCREEN, not merely present: every row is mounted from the start, so
    // `exists` is true for one a thousand points above the viewport.
    while !isOnScreen(lastRow) && swipes < 20 {
      list.swipeUp(velocity: .fast)
      swipes += 1
    }

    /*
     * And then to the END, which is not the same thing and is where this test
     * kept going wrong.
     *
     * The loop above stops the moment the last row is on screen, and a fling
     * stops wherever its momentum runs out — so the resting position was
     * whatever the last swipe happened to leave, and the row's bottom edge was
     * measured at 817, 827 and 828 points on three consecutive runs of the same
     * build. Every assertion below is about the distance between that edge and
     * the bar, so a position that varies by ten points between runs is not a
     * measurement at all.
     *
     * Swiping until the row STOPS MOVING is the condition that means "at the
     * end", and it is the one the rest of this case assumes.
     */
    var settled = CGFloat.greatestFiniteMagnitude
    var nudges = 0
    while nudges < 8 {
      Thread.sleep(forTimeInterval: 0.6)
      let bottom = lastRow.frame.maxY
      if abs(bottom - settled) < 0.5 { break }
      settled = bottom
      list.swipeUp(velocity: .slow)
      nudges += 1
    }
    Thread.sleep(forTimeInterval: 1.5)

    XCTAssertTrue(
      isOnScreen(lastRow),
      "never reached the end of the list after \(swipes) swipes; visible: \(visibleText())")
    XCTAssertLessThan(
      nudges, 8,
      "the list never came to rest: the last row was still moving after eight "
        + "slow swipes, so nothing below is measuring a resting position")

    // Between the last row's bottom edge and the bar, sampled clear of the
    // scroll indicator on the right and the row text on the left.
    let px = try pixels()
    let window = app.windows.element(boundBy: 0).frame
    /*
     * The window between the last row and the bar, bounded so it cannot reach
     * the bar itself.
     *
     * `field.frame.minY - 14` was the bound, and it stopped being above the bar
     * when the composer became a centred line inside a 40-point pill — the test
     * then sampled the bar's own material and reported it as reserved space.
     * The band being looked for is one safe area, so 26 points is more than
     * enough to see it and cannot reach anything else.
     */
    let top = lastRow.frame.maxY + 2
    /*
     * 34, not 24, and this is the SECOND time this bound has had to move.
     *
     * The bar's material fades out over its top 28 points, and a sample taken
     * inside that fade is a wash over the page — which is exactly what this test
     * is looking for, so it reported the bar's own fade as reserved space the
     * moment the first screen's bar became a material like the chat screen's.
     * The bound has to clear the fade, not merely the field.
     */
    let bottom = min(field.frame.minY - 34, top + 26)
    /*
     * No gap at all is the ANSWER, not a broken measurement.
     *
     * The bar is a material and the list scrolls under it, so at the bottom the
     * last row sits below the bar's top and there is no strip between them —
     * measured at -8 points. That is the state this test wants: an over-reserve
     * pushes the last row UP, and the 33.7-point band it was written for would
     * open a gap of about 26. So a non-positive gap passes on its own evidence,
     * and only a positive one is worth sampling.
     *
     * Said out loud rather than left to the loop, because `bottom <= top` would
     * otherwise skip every assertion below and report success without looking at
     * a single pixel — which is the same silence a real over-reserve would have
     * to break.
     */
    guard bottom > top else {
      /*
       * A HALF POINT of slack, because the two edges are now genuinely
       * coincident and a strict comparison on them is a coin flip.
       *
       * The bar stopped padding above the pill — the native composer has no
       * cover inset above its field — so the last row's frame
       * now ends exactly where the field's begins. This read
       * 805.3334147135416 against 805.3333333333334 and failed on eight
       * ten-thousandths of a point, which is not the over-reserve it is looking
       * for: that one is a whole safe area, thirty-four.
       */
      XCTAssertLessThanOrEqual(
        lastRow.frame.maxY, field.frame.minY + 0.5,
        "the last row is above the bar with a gap this test decided not to "
          + "sample — that is the over-reserve it exists to catch")
      return
    }

    // The band, when it exists, is a wash of the accent over the page. Compare
    // against the page itself rather than naming a colour, so this keeps working
    // in dark mode and if the tint is ever restyled.
    let page = px.rowAverage(y: lastRow.frame.midY, from: window.width * 0.75, to: window.width * 0.95)

    var worst = 0
    var worstY = CGFloat(0)
    var y = top
    while y < bottom {
      let here = px.rowAverage(y: y, from: window.width * 0.75, to: window.width * 0.95)
      let d = distance(here, page)
      if d > worst {
        worst = d
        worstY = y
      }
      y += 1
    }

    XCTAssertLessThan(
      worst, 8,
      "reserved space is showing under the last row: \(Int(bottom - top))pt of gap, "
        + "worst difference \(worst) at y=\(Int(worstY))")
  }
}


/**
 An OVERLAY panel disturbs no layout.

 `<native:keyboardpanel presentation="overlay">` floats over the keys rather than
 taking their place, which is how it gets above a keyboard that no app window can
 reach. A surface presented that way is a menu: it covers what is under it and the
 content beneath does not move, exactly as it does not move for a `UIMenu`.

 That is the invariant here, and it took a wrong test to find it. The first
 version asserted the opposite — that the transcript must clear the panel, the
 way it clears the keyboard — and failed with the newest message ending at 436
 while the panel began at 373. The app was right and the assertion was not: the
 rule the transcript follows is the one for an INPUT VIEW, and this panel is not
 one. Written down here because the two presentations look identical on screen
 and have opposite requirements.
 */
final class KeyboardGrowthCheck: DemoCase {
  func testAnOverlayPanelDoesNotMoveTheTranscript() throws {
    app.links["Chat, with a composer"].tap()
    let field = app.textViews.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 15), "no composer field")
    chooseCommand("Add fifty messages")
    Thread.sleep(forTimeInterval: 1.2)

    field.tap()
    let keyboard = app.keyboards.element(boundBy: 0)
    XCTAssertTrue(keyboard.waitForExistence(timeout: 10), "the keyboard never came up")
    Thread.sleep(forTimeInterval: 1.5)

    /*
     * The newest message, by name. Focusing takes the list to the end, so this
     * one is sitting just above the keys.
     *
     * Named rather than found by walking: `allElementsBoundByIndex` over fifty
     * messages takes four minutes, and a `<p>` here does not report as a static
     * text so `app.staticTexts` finds nothing at all.
     */
    let mark = text("Message 53, sent.")
    XCTAssertTrue(mark.waitForExistence(timeout: 8), "the newest message never appeared")
    let restedAt = mark.frame.maxY

    plusButton().tap()
    let firstRow = app.buttons["Add fifty messages"]
    XCTAssertTrue(firstRow.waitForExistence(timeout: 8), "the panel never opened")
    Thread.sleep(forTimeInterval: 1.5)

    /*
     * The premise, proved before the claim: the panel has to be over the row, or
     * "the row did not move" is true for no reason.
     */
    let panelTop = firstRow.frame.minY
    /*
     * The panel has to be ON SCREEN and standing where the keyboard was. On
     * iOS 27 the newest message ends a few points ABOVE the card's top, where
     * on 26.5 the two overlapped slightly — and the overlap is not what this
     * case needs. The failure it exists for is an overlay being treated as an
     * INSET, and an inset shrinks the scroll view whether or not the panel
     * covers a particular row, so the transcript would move under either
     * geometry. These two state what must hold for the measurement below to
     * mean anything: the panel opened, and it opened where the keys were.
     */
    let window = app.windows.element(boundBy: 0)
    XCTAssertLessThan(
      panelTop, window.frame.maxY,
      "the panel's top is \(panelTop), off the bottom of the window — it never opened")
    XCTAssertGreaterThan(
      panelTop, restedAt - 40,
      "the panel's top is \(panelTop) against the newest message's \(restedAt) — the "
        + "panel is not standing in for the keyboard and this case is measuring "
        + "something else")

    XCTAssertEqual(
      mark.frame.maxY, restedAt, accuracy: 1,
      "the transcript moved when an overlay opened — it rested at \(restedAt) and "
        + "is at \(mark.frame.maxY) now. An overlay is not an inset.")
  }
}
