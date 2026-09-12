/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 A chat with no messages opens on an empty transcript, and takes the first one.

 The empty conversation is a state the layout has to hold: nothing above the
 composer, and the composer at the bottom where it rests with a thousand rows
 above it. The first message then arrives into a transcript that has never
 laid a row out.
 */
final class EmptyCheck: DemoCase {
  override class var initialScreen: String? { "chat" }
  override class var seedMessages: Int? { 0 }

  func testAnEmptyChatRestsOnItsComposerAndTakesTheFirstMessage() throws {
    let field = app.textViews.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 15), "no composer field")

    // The opening conversation's first line, which every seeded chat carries.
    let opener = text("Did the keyboard cover the last message?")
    XCTAssertFalse(opener.exists, "a message in a chat seeded with none: \(visibleText())")

    // The composer rests on the bottom safe area, as it does with rows above it.
    let window = app.windows.element(boundBy: 0).frame
    let gap = window.maxY - field.frame.maxY
    XCTAssertLessThan(
      gap, 60, "the composer is \(gap) points above the bottom with nothing to push it")

    field.tap()
    XCTAssertTrue(app.keyboards.element(boundBy: 0).waitForExistence(timeout: 10))
    app.typeText("First")
    let send = app.buttons["Send"]
    XCTAssertTrue(send.waitForExistence(timeout: 5), "no send button with a draft")
    send.tap()

    let sent = text("First")
    XCTAssertTrue(
      sent.waitForExistence(timeout: 10),
      "the first message did not land: \(visibleText())")
    XCTAssertTrue(isOnScreen(sent), "the first message landed off screen")
  }

  /**
   A message sent into a short transcript does not move the ones above it.

   The transcript is bottom-anchored, and a hold keeps what is on screen still by
   moving the offset against the content. Where the content is SHORTER than the
   viewport there is nowhere to move it: the list has one legal position. Holding
   an anchor there wrote an offset the list could not honour, so each send —
   whose previous receipt closes and takes its height out of the content — pushed
   the whole stack DOWN by that height, again per message until the screen
   filled. Reported from a phone with a recording; measured here as "the first
   balloon does not move".
   */
  func testASendDoesNotPushTheTranscriptDown() throws {
    let field = app.textViews.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 15), "no composer field")
    field.tap()
    XCTAssertTrue(app.keyboards.element(boundBy: 0).waitForExistence(timeout: 10))

    app.typeText("One")
    let send = app.buttons["Send"]
    XCTAssertTrue(send.waitForExistence(timeout: 5), "no send button with a draft")
    send.tap()
    let first = text("One")
    XCTAssertTrue(first.waitForExistence(timeout: 10), "the first message never landed")
    // After its receipt has opened and settled, which is the state the next send
    // changes: the receipt closes under this message and opens under the new one.
    Thread.sleep(forTimeInterval: 3)
    let before = first.frame.minY

    app.typeText("Two")
    XCTAssertTrue(send.waitForExistence(timeout: 5), "no send button for the second draft")
    send.tap()
    XCTAssertTrue(text("Two").waitForExistence(timeout: 10), "the second message never landed")
    Thread.sleep(forTimeInterval: 3)

    let after = first.frame.minY
    XCTAssertEqual(
      after, before, accuracy: 1.0,
      "sending moved the message above it from \(before) to \(after)")
  }
}
