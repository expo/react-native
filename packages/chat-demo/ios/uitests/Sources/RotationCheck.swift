/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 The chat on its side.

 Two things change when the phone turns, and neither of them is the drawing:
 the column narrows by the sensor housing, and the transcript's viewport loses
 most of its height to a keyboard that is now most of the screen. Both were
 wrong, in ways that only a rotation could show.

 Every case here puts the device back upright afterwards, because XCUITest's
 orientation is the SIMULATOR's and outlives the process that set it — a case
 that leaves it on its side hands the next one a window it was not written for.
 */
final class RotationCheck: DemoCase {
  override class var initialScreen: String? { "chat" }

  override func tearDown() {
    XCUIDevice.shared.orientation = .portrait
    Thread.sleep(forTimeInterval: 1.5)
    super.tearDown()
  }

  /**
   The colour at a point of the WINDOW, whichever way the window is.

   A screenshot comes back in the DISPLAY's orientation, always: the image of a
   window that is on its side is an upright one with the window lying in it. So
   the scale `Pixels` computes from the window's height is wrong by the aspect
   ratio, and the axes are swapped on top of that — this case first reported the
   transcript as 13 points from one edge and 774 from the other, which is every
   sample squashed into a corner. Neither `XCUIScreen`'s screenshot nor the
   window element's own is any different; the mapping is the fix.

   `landscapeLeft` only, which is the one this file turns to: the window's
   leading edge is the image's BOTTOM, so a point across the window is a point
   down the image and a point down the window is a point back across it.
   */
  private func windowPixels() throws -> (Pixels, (CGFloat, CGFloat) -> (r: Int, g: Int, b: Int)) {
    let window = app.windows.element(boundBy: 0).frame
    let sideways = window.width > window.height
    let read = try XCTUnwrap(
      Pixels(XCUIScreen.main.screenshot(), pointHeight: sideways ? window.width : window.height),
      "could not read the screen")
    if sideways {
      return (read, { x, y in read.at(x: window.height - y, y: x) })
    }
    return (read, { x, y in read.at(x: x, y: y) })
  }

  /// The trailing edge of the widest sent balloon, and the leading edge of the
  /// leftmost ink beside it, both in points across the transcript's own band.
  private func columnEdges() throws -> (leading: CGFloat, trailing: CGFloat) {
    let window = app.windows.element(boundBy: 0).frame
    let (_, at) = try windowPixels()
    var trailing: CGFloat = 0
    var leading = window.maxX
    /*
     * BELOW the navigation bar, whose own back button is the leftmost ink on
     * the screen and is not the transcript's. A fraction of the window is not
     * enough: upright the bar ends at 116 and a sixth of 874 clears it, on its
     * side it ends at 78 and a sixth of 402 lands inside it — which is what
     * this case first read as a 47-point leading margin.
     */
    let below = app.buttons["Back"].frame.maxY + 6
    var y = max(window.height * 0.16, below)
    while y < window.height - COMPOSER_BAR_HEIGHT - 4 {
      var x = window.maxX - 1
      while x > 0 {
        let c = at(x, y)
        if c.b > 190 && c.b - c.r > 70 {
          trailing = max(trailing, x)
          break
        }
        x -= 1
      }
      x = 0
      while x < window.maxX {
        let c = at(x, y)
        // Any ink at all: the leading edge of a received row is its avatar,
        // which is the greyest thing on that side.
        if c.r < 235 || c.g < 235 || c.b < 235 {
          leading = min(leading, x)
          break
        }
        x += 1
      }
      y += 1
    }
    return (leading, trailing)
  }

  /**
   The column keeps the same margin either side, whichever way the phone is.

   Stated as a SYMMETRY rather than as a number, because the number is the
   platform's to tell us and it differs per device: measured on this simulator
   it is 16 upright and 78.33 on its side, which is the 62-point sensor housing
   and the transcript's own sixteen. What cannot differ is the two sides, and a
   safe area applied to one of them — or to neither — shows up here immediately.
   */
  func testTheColumnKeepsItsMarginEitherSide() throws {
    XCTAssertTrue(
      text("Did the keyboard cover the last message?").waitForExistence(timeout: 15),
      "no transcript")

    let upright = try columnEdges()
    let uprightWidth = app.windows.element(boundBy: 0).frame.maxX
    XCTAssertGreaterThan(upright.trailing, 0, "no sent balloon on screen upright")
    XCTAssertEqual(
      upright.leading, uprightWidth - upright.trailing, accuracy: 1.5,
      "upright, the transcript is \(upright.leading) from one edge and "
        + "\(uprightWidth - upright.trailing) from the other")

    XCUIDevice.shared.orientation = .landscapeLeft
    Thread.sleep(forTimeInterval: 3)

    let sideways = try columnEdges()
    let sidewaysWidth = app.windows.element(boundBy: 0).frame.maxX
    XCTAssertGreaterThan(sideways.trailing, 0, "no sent balloon on screen sideways")
    XCTAssertEqual(
      sideways.leading, sidewaysWidth - sideways.trailing, accuracy: 1.5,
      "on its side, the transcript is \(sideways.leading) from one edge and "
        + "\(sidewaysWidth - sideways.trailing) from the other")
    /*
     * And it is a BIGGER margin than upright, which is what says the safe area
     * is being read at all rather than the two sides merely agreeing on 16.
     */
    XCTAssertGreaterThan(
      sideways.leading, upright.leading + 20,
      "on its side the transcript keeps \(sideways.leading) from the edge, the same "
        + "as upright — the sensor housing is not being read")
  }

  /**
   A reader at the newest message is still there after the phone turns.

   The case that needs a message SENT first: the seeded conversation fits an
   upright window, and a transcript that has never had to scroll has never
   recorded that anyone was at its end. Turning the phone is then the first
   moment the content does not fit — 357 points of it in a 304-point viewport —
   and the anchor has to know what the reader was looking at before the box
   changed. It did not, and the transcript rested 27 points short with the last
   balloon behind the composer.
   */
  func testTheNewestMessageSurvivesARotation() throws {
    let field = app.textViews.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 15), "no composer field")
    field.tap()
    app.typeText("Turn me over")
    XCTAssertTrue(app.buttons["Send"].waitForExistence(timeout: 8), "no send button")
    app.buttons["Send"].tap()
    let newest = text("Turn me over")
    XCTAssertTrue(newest.waitForExistence(timeout: 10), "the message never arrived")
    Thread.sleep(forTimeInterval: 2.5)
    dismissKeyboard()
    Thread.sleep(forTimeInterval: 1.5)

    XCUIDevice.shared.orientation = .landscapeLeft
    Thread.sleep(forTimeInterval: 3.5)

    XCTAssertTrue(newest.exists, "the newest message left the tree on rotation")
    let bar = app.windows.element(boundBy: 0).frame.height - COMPOSER_BAR_HEIGHT
    XCTAssertLessThan(
      newest.frame.maxY, bar,
      "after turning the phone the newest message ends at \(newest.frame.maxY), below the "
        + "composer's top edge at \(bar) — the transcript did not stay at the end")
    XCTAssertGreaterThan(
      newest.frame.minY, 0, "the newest message is off the top after the rotation")
  }
}

/** The bar's own height, which is the same on its side as upright — measured. */
private let COMPOSER_BAR_HEIGHT: CGFloat = 69
