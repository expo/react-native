/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 The chat in landscape: equal margins on both sides, no sideways scrolling,
 and the newest message stays on screen through a rotation.
 */
// covers: screens/ChatScreen.js
final class RotationCheck: DemoCase {
  override class var initialScreen: String? { "chat" }

  /** The composer's top edge. The bar is 69 pt tall in both orientations. */
  private var composerTop: CGFloat {
    app.windows.element(boundBy: 0).frame.height - 69
  }

  // The orientation belongs to the simulator and would carry into the next test.
  override func tearDown() {
    XCUIDevice.shared.orientation = .portrait
    let window = app.windows.element(boundBy: 0)
    _ = waitUntil(5) { window.frame.height > window.frame.width }
    super.tearDown()
  }

  /// The window on its side (or upright) and the composer at rest in it.
  private func turned(sideways: Bool, file: StaticString = #filePath, line: UInt = #line) {
    let window = app.windows.element(boundBy: 0)
    XCTAssertTrue(
      waitUntil(8) { (window.frame.width > window.frame.height) == sideways },
      "the window did not turn", file: file, line: line)
    settled(app.textViews.firstMatch, file: file, line: line)
  }

  /// The rightmost sent-balloon pixel and the leftmost ink, in window points,
  /// between the navigation bar and the composer.
  private func columnEdges() throws -> (leading: CGFloat, trailing: CGFloat) {
    let window = app.windows.element(boundBy: 0).frame
    let at = try windowSampler()
    var trailing: CGFloat = 0
    var leading = window.maxX
    // Start below the navigation bar, which can draw a full-width hairline.
    let bar = app.navigationBars.element(boundBy: 0)
    let below = (bar.exists ? bar.frame.maxY : app.buttons["Back"].frame.maxY) + 4
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
        // Any ink: a received row's leading edge is its avatar.
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

  /// The transcript's left and right margins are equal in both orientations.
  /// Checked as a symmetry because the landscape margin (safe area + 16 pt)
  /// varies by device. See ui-metrics.md, "Transcript side margin".
  func testTheColumnKeepsItsMarginEitherSide() throws {
    XCTAssertTrue(
      appears(text("Did the keyboard cover the last message?"), within: 15),
      "no transcript")

    let upright = try columnEdges()
    let uprightWidth = app.windows.element(boundBy: 0).frame.maxX
    XCTAssertGreaterThan(upright.trailing, 0, "no sent balloon on screen upright")
    XCTAssertEqual(
      upright.leading, uprightWidth - upright.trailing, accuracy: 1.5,
      "upright, the transcript is \(upright.leading) from one edge and "
        + "\(uprightWidth - upright.trailing) from the other")

    XCUIDevice.shared.orientation = .landscapeLeft
    turned(sideways: true)

    let sideways = try columnEdges()
    let sidewaysWidth = app.windows.element(boundBy: 0).frame.maxX
    XCTAssertGreaterThan(sideways.trailing, 0, "no sent balloon on screen sideways")
    XCTAssertEqual(
      sideways.leading, sidewaysWidth - sideways.trailing, accuracy: 1.5,
      "on its side, the transcript is \(sideways.leading) from one edge and "
        + "\(sidewaysWidth - sideways.trailing) from the other")
    // Larger than upright, so the landscape safe area is included.
    XCTAssertGreaterThan(
      sideways.leading, upright.leading + 20,
      "on its side the transcript keeps \(sideways.leading) from the edge, the same "
        + "as upright — the sensor housing is not being read")
  }

  /**
   The transcript has no horizontal scroll range in either orientation, read
   from the horizontal indicator's accessibility label ("1 page"). The chat
   applies the landscape safe area as layout padding, so `<native:scroll>` must
   not also add it as a content inset.
   */
  func testTheTranscriptDoesNotScrollSideways() throws {
    XCTAssertTrue(
      appears(text("Did the keyboard cover the last message?"), within: 15),
      "no transcript")

    func horizontalPages() -> [String] {
      let composer = composerTop
      return app.descendants(matching: .any)
        .matching(NSPredicate(format: "label BEGINSWITH 'Horizontal scroll bar'"))
        .allElementsBoundByIndex
        // Skip the composer field's indicator; the field may scroll.
        .filter { $0.frame.maxY < composer }
        .map { $0.label }
    }

    for upright in horizontalPages() {
      XCTAssertEqual(upright, "Horizontal scroll bar, 1 page", "upright: \(upright)")
    }

    XCUIDevice.shared.orientation = .landscapeLeft
    turned(sideways: true)

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
   The newest message stays on screen through a rotation. A message is sent
   first so the transcript has recorded being at its end (the seeded chat fits
   an upright window and never scrolls); in landscape the content overflows.
   */
  func testTheNewestMessageSurvivesARotation() throws {
    let field = app.textViews.firstMatch
    XCTAssertTrue(appears(field, within: 15), "no composer field")
    field.tap()
    type("Turn me over")
    XCTAssertTrue(appears(app.buttons["Send"], within: 8), "no send button")
    app.buttons["Send"].tap()
    let newest = text("Turn me over")
    XCTAssertTrue(appears(newest, within: 10), "the message never arrived")
    settled(newest)
    dismissKeyboard()
    settled(field)

    XCUIDevice.shared.orientation = .landscapeLeft
    turned(sideways: true)
    settled(newest)

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
