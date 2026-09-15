/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 The chat on its side.

 Two things change when the phone turns, and neither is the drawing: the column
 narrows by the sensor housing, and the transcript's viewport loses most of its
 height to a keyboard that is now most of the screen.

 Every case here puts the device back upright afterwards. XCUITest's orientation
 is the SIMULATOR's and outlives the process that set it, so a case that leaves
 it on its side hands the next one a window it was not written for.
 */
final class RotationCheck: DemoCase {
  override class var initialScreen: String? { "chat" }

  /** The composer's top edge, which is where the transcript stops. The bar is
      the same 69 tall on its side as upright — measured. */
  private var composerTop: CGFloat {
    app.windows.element(boundBy: 0).frame.height - 69
  }

  override func tearDown() {
    XCUIDevice.shared.orientation = .portrait
    Thread.sleep(forTimeInterval: 1.5)
    super.tearDown()
  }

  /// The trailing edge of the widest sent balloon, and the leading edge of the
  /// leftmost ink beside it, both in points across the transcript's own band.
  private func columnEdges() throws -> (leading: CGFloat, trailing: CGFloat) {
    let window = app.windows.element(boundBy: 0).frame
    let at = try windowSampler()
    var trailing: CGFloat = 0
    var leading = window.maxX
    /*
     * BELOW the navigation bar, whose back button is the leftmost ink on the
     * screen and is not the transcript's. Anchored to the bar rather than to a
     * fraction of the window, because the two orientations put it in different
     * places: a sixth of 874 clears a bar ending at 116, a sixth of 402 lands
     * inside one ending at 78.
     */
    let below = app.buttons["Back"].frame.maxY + 6
    var y = max(window.height * 0.16, below)
    while y < composerTop - 4 {
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
   The transcript does not scroll sideways, on its side or upright.

   The sensor housing is reserved ONCE. `<native:scroll>` reserves every edge by
   default as a content INSET, and this screen takes it off the LAYOUT instead,
   because a balloon's cap and its trailing edge are measured from the column.
   Reserved both ways they ADD, and the second reservation is not a margin: an
   inset on an edge the content already clears is scrolling room, 124 points of
   it sideways.

   Read off the scroll view's own indicator, which states the answer rather than
   implying it: `1 page` is a transcript with nowhere to go, `2 pages` is the
   housing being paid for twice.
   */
  func testTheTranscriptDoesNotScrollSideways() throws {
    XCTAssertTrue(
      text("Did the keyboard cover the last message?").waitForExistence(timeout: 15),
      "no transcript")

    func horizontalPages() -> [String] {
      let composer = composerTop
      return app.descendants(matching: .any)
        .matching(NSPredicate(format: "label BEGINSWITH 'Horizontal scroll bar'"))
        .allElementsBoundByIndex
        // The composer's own field carries one too, and it is allowed to
        // scroll: a long draft moves sideways inside the pill.
        .filter { $0.frame.maxY < composer }
        .map { $0.label }
    }

    for upright in horizontalPages() {
      XCTAssertEqual(upright, "Horizontal scroll bar, 1 page", "upright: \(upright)")
    }

    XCUIDevice.shared.orientation = .landscapeLeft
    Thread.sleep(forTimeInterval: 3)

    let sideways = horizontalPages()
    XCTAssertFalse(
      sideways.isEmpty,
      "no horizontal indicator to read on its side, so nothing was checked")
    for bar in sideways {
      XCTAssertEqual(
        bar, "Horizontal scroll bar, 1 page",
        "on its side the transcript reads '\(bar)' — it has somewhere to go "
          + "sideways, which means the sensor housing is being reserved twice")
    }
  }

  /**
   A reader at the newest message is still there after the phone turns.

   A message is SENT first because the seeded conversation fits an upright
   window, and a transcript that has never had to scroll has never recorded that
   anyone was at its end. Turning the phone is then the first moment the content
   does not fit — 357 points of it in a 304-point viewport — so the anchor has to
   have taken its reading before the box changed.
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
    let bar = composerTop
    XCTAssertLessThan(
      newest.frame.maxY, bar,
      "after turning the phone the newest message ends at \(newest.frame.maxY), below the "
        + "composer's top edge at \(bar) — the transcript did not stay at the end")
    XCTAssertGreaterThan(
      newest.frame.minY, 0, "the newest message is off the top after the rotation")
  }
}
