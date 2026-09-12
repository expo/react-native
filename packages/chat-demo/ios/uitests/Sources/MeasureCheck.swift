/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 A hold still opens the platform's peek after the list has SCROLLED.

 `ReactionCheck` holds a balloon in the demo's three opening messages, where the
 transcript has barely moved. This is the same act after fifty more, with the
 list a couple of thousand points along and every message wrapped in a
 `VirtualView` — so the balloon under the finger is one that was rendered on the
 way past rather than one that has been mounted since launch.

 **What it stopped being able to assert.** It was written when the picker was
 the app's own drawing, and it measured where that picker landed relative to the
 balloon. The peek is `UIContextMenuInteraction` now: the lift, the platter and
 its placement are UIKit's, and a test of this app has no business asserting
 where UIKit puts a menu — it measured 145 points above the balloon rather than
 the 14 to 60 the app used to draw, and both numbers are correct for their own
 owner. What is still this app's, and what this pins, is that the interaction is
 installed on a balloon deep in a scrolled transcript and that choosing from it
 reaches JavaScript.

 **What it does NOT cover, said plainly.** Not the scroll offset. Nothing ever
 wrote the scrolled offset into `<native:scroll>`'s shadow state, so
 `ExpoScrollViewShadowNode::getContentOriginOffset` returned zero and
 `measureInWindow` on anything inside a transcript came back short by however far
 the list had been scrolled. This case was run against a build with that fix
 deliberately taken out, and it PASSED. It is kept for the coverage it does give
 and is not claimed as cover for the offset, which is verified by measurement:
 the balloon measured 296.67 and painted at 405.67 before, and measures 405.67
 and paints at 405.7 after.
 */
final class MeasureCheck: DemoCase {
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

  func testAHoldStillOpensTheMenuAfterTheListHasScrolled() throws {

    // Fifty of them, so the list has somewhere to have scrolled TO. Three
    // messages fit on one screen and rest at an offset small enough that a
    // measurement taken in the wrong space is still roughly right.
    chooseCommand("Add fifty messages")
    Thread.sleep(forTimeInterval: 1.5)

    let newest = text("Message 53, sent.")
    XCTAssertTrue(newest.waitForExistence(timeout: 10), "the fifty never arrived")
    // The premise: the list really is scrolled. A test that held a balloon in an
    // unscrolled list would pass whatever the offset did, which is the vacuous
    // version of this case.
    XCTAssertFalse(
      isOnScreen(text("Did the keyboard cover the last message?")),
      "the opening message is still on screen, so the list has not scrolled and "
        + "this proves nothing")

    hold(newest)

    // "Copy" marks the platform menu now that the reaction rows are
    // gone — see `ReactionCheck`.
    let copy = app.buttons["Copy"]
    XCTAssertTrue(
      copy.waitForExistence(timeout: 4),
      "the hold opened no menu on a balloon this far along; visible: \(visibleText())")
    XCTAssertTrue(
      isOnScreen(copy),
      "the menu is mounted but off screen")
    // The balloon is LIFTED, not scrolled away from: UIKit anchors the platter
    // to the view it lifted, and a lift that lost its view would take it off
    // screen with it.
    XCTAssertTrue(isOnScreen(newest), "the lifted balloon left the screen")

    copy.tap()

    /*
     * `exists`, not `isOnScreen`: reading the frame of an element that vanishes
     * between the guard and the read makes XCUITest throw, and a menu animating
     * out is exactly that.
     */
    var waited = 0.0
    while app.buttons["Copy"].exists && waited < 2.0 {
      Thread.sleep(forTimeInterval: 0.1)
      waited += 0.1
    }
    XCTAssertFalse(app.buttons["Copy"].exists, "the menu never closed after a choice")
    XCTAssertTrue(
      isOnScreen(newest),
      "the balloon the menu was opened on is gone")
  }
}
