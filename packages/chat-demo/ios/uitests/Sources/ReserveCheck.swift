/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 After the keyboard is raised and dismissed, the home screen's list, scrolled
 to its end, shows no tinted reserved space between its last row and the bar.
 (The home screen tints reserved space; the fault left one bottom safe area of
 it.)
 */
// covers: screens/ChatScreen.js Composer.js
final class ReserveCheck: DemoCase {
  func testNoReserveLeftUnderTheLastRowAfterDismissing() throws {
    let field = app.textViews.firstMatch
    XCTAssertTrue(appears(field, within: 10), "no composer field")

    field.tap()
    XCTAssertTrue(
      appears(app.keyboards.element(boundBy: 0), within: 10),
      "the keyboard never came up, so the dismissal proves nothing")
    dismissKeyboard()

    let list = app.scrollViews.firstMatch
    // The last of the home list's rows (`ROWS` in App.js).
    let lastRow = text("row 10")
    var swipes = 0
    while !isOnScreen(lastRow) && swipes < 20 {
      list.swipeUp(velocity: .fast)
      swipes += 1
    }

    // Keep swiping until the last row stops moving: a fling can stop short of
    // the end.
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

    let px = try pixels()
    let window = app.windows.element(boundBy: 0).frame
    // Up to 26 pt below the last row (the band would be one safe area), and
    // clear of the bar's top fade, which also reads as a wash.
    let top = lastRow.frame.maxY + 2
    let bottom = min(field.frame.minY - 34, top + 26)
    // No gap is a pass: at the end the last row can sit under the bar. Assert
    // it here, or the loop below would pass without reading a pixel.
    guard bottom > top else {
      // 0.5 pt of slack: the last row can end where the field starts.
      XCTAssertLessThanOrEqual(
        lastRow.frame.maxY, field.frame.minY + 0.5,
        "the last row is above the bar with a gap this test decided not to "
          + "sample — that is the over-reserve it exists to catch")
      return
    }

    // Sampled on the right, clear of the row text and the scroll indicator, and
    // compared with the page colour rather than a fixed tint.
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
 Opening the `+` panel with the keyboard up doesn't move the transcript: the
 card (`<native:popover>`) stands the keys down
 behind a picture that keeps their obstruction, and is not an input view the
 transcript must clear.
 */
// covers: Composer.js screens/ChatScreen.js
final class KeyboardGrowthCheck: DemoCase {
  func testAnOverlayPanelDoesNotMoveTheTranscript() throws {
    app.links["Chat, with a composer"].tap()
    let field = app.textViews.firstMatch
    XCTAssertTrue(appears(field, within: 15), "no composer field")
    chooseCommand("Add fifty messages")
    settled(field)

    field.tap()
    let keyboard = app.keyboards.element(boundBy: 0)
    XCTAssertTrue(appears(keyboard, within: 10), "the keyboard never came up")
    settled(field)

    // Focusing scrolled to the end, so the newest message is just above the
    // keys.
    let mark = text("Message 53, sent.")
    XCTAssertTrue(appears(mark, within: 8), "the newest message never appeared")
    let restedAt = mark.frame.maxY
    let keysTop = keyboard.frame.minY

    plusButton().tap()
    let firstRow = app.buttons["Add fifty messages"]
    XCTAssertTrue(appears(firstRow, within: 8), "the panel never opened")
    XCTAssertTrue(vanishes(keyboard, within: 8), "the keys were not stood down for the card")
    settled(firstRow)

    // The panel must be open over where the keys were: the card is centred on
    // the +, so its lower rows lie in the keys' area. Treated as an inset, it
    // would move the transcript either way.
    let sixthRow = app.buttons["Go to the earliest"]
    XCTAssertTrue(sixthRow.exists, "the panel is missing its sixth row")
    XCTAssertGreaterThan(
      sixthRow.frame.minY, keysTop,
      "the panel's sixth row is at \(sixthRow.frame.minY), above where the keys were (\(keysTop)) — the "
        + "panel is not standing in for the keyboard and this case is measuring "
        + "something else")

    XCTAssertEqual(
      mark.frame.maxY, restedAt, accuracy: 1,
      "the transcript moved when an overlay opened — it rested at \(restedAt) and "
        + "is at \(mark.frame.maxY) now. An overlay is not an inset.")
  }

  /**
   The `+` card handing the keyboard back as it closes doesn't move a reader who
   has scrolled up, and a tap on the field still scrolls to the newest message.

   Only starting to compose scrolls to the newest message. Closing the card
   gives the field its focus back, which is not starting anything: the reader
   who scrolled up stays where they are.
   */
  func testTheCardGivingTheKeysBackLeavesTheReaderWhereTheyAre() throws {
    app.links["Chat, with a composer"].tap()
    let field = app.textViews.firstMatch
    XCTAssertTrue(appears(field, within: 15), "no composer field")
    chooseCommand("Add fifty messages")
    settled(field)

    field.tap()
    let keyboard = app.keyboards.element(boundBy: 0)
    XCTAssertTrue(appears(keyboard, within: 10), "the keyboard never came up")
    let mark = text("Message 53, sent.")
    XCTAssertTrue(appears(mark, within: 8), "the newest message never appeared")
    settled(mark)
    let atEnd = mark.frame.maxY

    // Away from the end, by a drag that stops before it lets go: no fling to
    // coast, so the only thing that can move the transcript afterwards is the app
    let window = app.windows.element(boundBy: 0)
    window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.15)).press(
      forDuration: 0.05,
      thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.45)),
      withVelocity: 600,
      thenHoldForDuration: 0.3)
    settled(mark)
    let scrolledTo = mark.frame.maxY
    XCTAssertGreaterThan(
      scrolledTo, atEnd + 100,
      "the drag did not scroll the transcript up (the newest message is at \(scrolledTo), was "
        + "\(atEnd)), so this case cannot tell a restored focus from a tap")

    plusButton().tap()
    let firstRow = app.buttons["Add fifty messages"]
    XCTAssertTrue(appears(firstRow, within: 8), "the panel never opened")
    // Closed by a tap outside it, which chooses nothing
    window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.08)).tap()
    XCTAssertTrue(vanishes(firstRow, within: 8), "the panel did not close")
    XCTAssertTrue(appears(keyboard, within: 8), "the card did not give the keys back")
    settled(mark)
    XCTAssertEqual(
      mark.frame.maxY, scrolledTo, accuracy: 1,
      "giving the keys back moved the transcript from \(scrolledTo) to \(mark.frame.maxY): a "
        + "focus the app restores is not the reader starting to compose")

    // A command closes the card too, and the keys it gives back are not
    // starting to compose either. "Load earlier messages" grows the transcript
    // above the reader, who stays on the same rows.
    plusButton().tap()
    XCTAssertTrue(appears(firstRow, within: 8), "the panel never reopened")
    app.buttons["Load earlier messages"].tap()
    XCTAssertTrue(vanishes(firstRow, within: 8), "choosing a command did not close the panel")
    XCTAssertTrue(appears(keyboard, within: 8), "the card did not give the keys back after a command")
    settled(mark)
    XCTAssertEqual(
      mark.frame.maxY, scrolledTo, accuracy: 1,
      "closing the card with a command moved the transcript from \(scrolledTo) to "
        + "\(mark.frame.maxY)")

    // The control: starting to compose does scroll to the newest message
    dismissKeyboard()
    field.tap()
    XCTAssertTrue(appears(keyboard, within: 10), "the keyboard never came back")
    settled(mark)
    XCTAssertEqual(
      mark.frame.maxY, atEnd, accuracy: 1,
      "tapping the field left the newest message at \(mark.frame.maxY), not just above the keys "
        + "at \(atEnd)")
  }
}
