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
}
