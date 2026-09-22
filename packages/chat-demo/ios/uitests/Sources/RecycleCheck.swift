/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 After leaving the chat and coming back, when Fabric reuses (recycles) the
 composer's component views, the field and `+` are hittable and drawn, and
 nothing new covers the transcript.
 */
// covers: Composer.js App.js
final class RecycleCheck: DemoCase {
  // The first trip starts here; later trips navigate back in from home.
  override class var initialScreen: String? { "chat" }

  /// Some faults appear only after more than one return.
  private let trips = 4

  func testTheComposerSurvivesLeavingAndReturning() throws {
    for trip in 1...trips {
      if trip > 1 {
        app.links["Chat, with a composer"].tap()
      }

      let field = app.textViews.firstMatch
      XCTAssertTrue(
        appears(field, within: 10), "trip \(trip): the composer's field never appeared")

      // `isHittable`, not `exists`: a covered control still exists.
      XCTAssertTrue(field.isHittable, "trip \(trip): the composer's field is covered")

      let button = plusButton()
      XCTAssertTrue(appears(button, within: 5), "trip \(trip): the + is missing")
      XCTAssertTrue(button.isHittable, "trip \(trip): the + is covered")

      app.buttons["BackButton"].tap()
      XCTAssertTrue(
        appears(app.staticTexts["Safe areas"], within: 10),
        "trip \(trip): never got back to the first screen")
    }
  }

  /// The `+` glyph is still drawn after returns made with the keyboard up. Read
  /// in pixels: an undrawn `+` still exists and is hittable.
  func testThePlusIsDrawnAfterAReturnWithTheKeyboardUp() throws {
    for trip in 1...trips {
      if trip > 1 {
        app.links["Chat, with a composer"].tap()
      }
      let field = app.textViews.firstMatch
      XCTAssertTrue(appears(field, within: 10), "trip \(trip): no field")
      field.tap()
      XCTAssertTrue(appears(app.keyboards.element(boundBy: 0), within: 5), "trip \(trip): no keyboard")
      settled(field)
      let button = plusButton()
      XCTAssertTrue(appears(button, within: 5), "trip \(trip): the + is missing")
      let box = button.frame
      let px = try pixels()
      let ink = px.rowAverage(y: box.midY, from: box.midX - 3, to: box.midX + 3)
      // The glyph is near-black on the glass; the bar behind it reads above 200.
      XCTAssertLessThan(
        (ink.r + ink.g + ink.b) / 3, 150,
        "trip \(trip): the + exists at \(box) but nothing is drawn at its centre — reads \(ink)")
      app.buttons["BackButton"].tap()
      XCTAssertTrue(
        appears(app.staticTexts["Safe areas"], within: 10),
        "trip \(trip): never got back to the first screen")
    }
  }

  /// After a return, a message is as hittable, and in the same place, as
  /// before: the panel's hidden host view must not be left over the transcript.
  func testThePanelHandleStaysHiddenAfterAReturn() throws {
    // Compared with the first reading, not asserted: a message may not be
    // hittable to begin with.
    func bubble() -> XCUIElement {
      app.descendants(matching: .any).matching(
        NSPredicate(format: "label CONTAINS %@", "Pull it down and watch")
      ).firstMatch
    }

    XCTAssertTrue(appears(app.textViews.firstMatch, within: 20))
    let first = bubble()
    XCTAssertTrue(appears(first, within: 20), "the transcript never appeared")
    let hittableFirst = first.isHittable
    let frameFirst = first.frame

    app.buttons["BackButton"].tap()
    XCTAssertTrue(appears(app.staticTexts["Safe areas"], within: 20))

    app.links["Chat, with a composer"].tap()
    XCTAssertTrue(appears(app.textViews.firstMatch, within: 20))
    let again = bubble()
    XCTAssertTrue(
      appears(again, within: 20),
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
