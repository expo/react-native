/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 The composer survives being navigated away from and back to.

 Both faults this covers were invisible on a first visit and only appeared after
 a screen had been left and re-entered, which is when Fabric recycles a
 component view rather than making a new one.

 - **The bar went blank.** `EXPKeyboardAccessoryContentView` redirected React's
   children into an inner container by overriding `insertSubview:atIndex:`. It
   is a `UIInputView`, and UIKit inserts subviews of its own — so the override
   swallowed a full-width UIKit backdrop as well. First time round it landed at
   index 0, behind the controls, invisible. After a recycle it landed last, and
   painted over the entire bar: every control still mounted, still positioned,
   and completely hidden.
 - **An empty rectangle covered the screen.** The panel's host view is a hidden
   handle, and `hidden` was set only in `updateProps`. The layout pass sets it
   too, from the display type, and on a recycled view that pass forces an update
   and runs last — so the handle came back visible at its full 370x452.

 Both are checked here through what a reader would see, rather than through view
 hierarchies: the controls are hittable, and something behind the bar is not.
 */
final class RecycleCheck: DemoCase {
  // Launches straight into the chat; the trips below still tap their way back
  // in, which is the movement under test.
  override class var initialScreen: String? { "chat" }

  /// How many times to leave and come back. Both faults appeared on the FIRST
  /// return, but a loop is what catches a fault that needs a few.
  private let trips = 4

  func testTheComposerSurvivesLeavingAndReturning() throws {
    for trip in 1...trips {
      // Trip one is the seeded launch; every later trip enters by the link,
      // and the faults this guards both lived in the RETURN.
      if trip > 1 {
        app.links["Chat, with a composer"].tap()
      }

      let field = app.textViews.firstMatch
      XCTAssertTrue(
        field.waitForExistence(timeout: 10), "trip \(trip): the composer's field never appeared")

      /*
       * HITTABLE, not merely present.
       *
       * `exists` was true throughout the bug — the views were mounted and
       * correctly placed, with a UIKit backdrop drawn over them. `isHittable`
       * is the question a reader is really asking, and the only one of the two
       * that was ever false.
       */
      XCTAssertTrue(field.isHittable, "trip \(trip): the composer's field is covered")

      /*
       * The `+`, by name. `<native:menubutton>` used to announce itself as
       * "plus" — the decorative glyph — and could not be looked up here; it
       * carries its author's label now.
       *
       * One button, because the composer shows one: `PLUS_KIND` was `'both'`
       * while all three kinds were being compared side by side, and is `'panel'`
       * now that the composer is meant to look like the native one.
       */
      let button = plusButton()
      XCTAssertTrue(button.waitForExistence(timeout: 5), "trip \(trip): the + is missing")
      XCTAssertTrue(button.isHittable, "trip \(trip): the + is covered")

      app.buttons["BackButton"].tap()
      XCTAssertTrue(
        app.staticTexts["Safe areas"].waitForExistence(timeout: 10),
        "trip \(trip): never got back to the first screen")
    }
  }

  /**
   Nothing of the panel's is left over the transcript after a round trip.

   The handle is 370 points wide and 452 tall — far larger than the bar it
   belongs to — so when it came back visible it sat over the messages. A message
   that cannot be tapped is the symptom a reader would meet.
   */
  func testThePanelHandleStaysHiddenAfterAReturn() throws {
    /*
     * The SAME message, before and after — because "is it hittable" only means
     * something against what it was.
     *
     * Asserting hittability outright failed here, and not because anything was
     * covering the message: a bubble in a scroll view is not necessarily a hit
     * target to begin with. Comparing the two readings asks the question this
     * test is actually about — did going away and coming back change what a
     * reader can reach — and cannot pass by accident, because a handle that came
     * back visible would change it.
     */
    func bubble() -> XCUIElement {
      app.descendants(matching: .any).matching(
        NSPredicate(format: "label CONTAINS %@", "Pull it down and watch")
      ).firstMatch
    }

    XCTAssertTrue(app.textViews.firstMatch.waitForExistence(timeout: 20))
    let first = bubble()
    XCTAssertTrue(first.waitForExistence(timeout: 20), "the transcript never appeared")
    let hittableFirst = first.isHittable
    let frameFirst = first.frame

    app.buttons["BackButton"].tap()
    XCTAssertTrue(app.staticTexts["Safe areas"].waitForExistence(timeout: 20))

    app.links["Chat, with a composer"].tap()
    XCTAssertTrue(app.textViews.firstMatch.waitForExistence(timeout: 20))
    let again = bubble()
    XCTAssertTrue(
      again.waitForExistence(timeout: 20),
      "the transcript never came back; visible: \(visibleText())")

    XCTAssertEqual(
      again.isHittable, hittableFirst,
      "the message became \(again.isHittable ? "reachable" : "unreachable") after a round "
        + "trip — something is covering the transcript that was not there before")
    XCTAssertEqual(
      again.frame, frameFirst,
      "the message moved after a round trip: \(frameFirst) then \(again.frame)")
  }
}
