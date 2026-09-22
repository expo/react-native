/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 A chat seeded with no messages opens with the composer at the bottom, and a
 first message sent into it appears on screen.
 */
// covers: screens/ChatScreen.js
final class EmptyCheck: DemoCase {
  override class var initialScreen: String? { "chat" }
  override class var seedMessages: Int? { 0 }

  func testAnEmptyChatRestsOnItsComposerAndTakesTheFirstMessage() throws {
    let field = app.textViews.firstMatch
    XCTAssertTrue(appears(field, within: 15), "no composer field")

    // The first of `OPENERS` in ChatScreen.js, present in any non-empty chat.
    let opener = text("Did the keyboard cover the last message?")
    XCTAssertFalse(opener.exists, "a message in a chat seeded with none: \(visibleText())")

    let window = app.windows.element(boundBy: 0).frame
    let gap = window.maxY - field.frame.maxY
    XCTAssertLessThan(
      gap, 60, "the composer is \(gap) points above the bottom with nothing to push it")

    field.tap()
    XCTAssertTrue(appears(app.keyboards.element(boundBy: 0), within: 10))
    type("First")
    let send = app.buttons["Send"]
    XCTAssertTrue(appears(send, within: 5), "no send button with a draft")
    send.tap()

    let sent = text("First")
    XCTAssertTrue(
      appears(sent, within: 10),
      "the first message did not land: \(visibleText())")
    XCTAssertTrue(isOnScreen(sent), "the first message landed off screen")
  }

  /**
   In a transcript shorter than the screen, a send does not move the message
   above it. (Each send removes the previous message's receipt; the bottom
   anchor must not shift the offset for that, since short content can't
   scroll.)
   */
  func testASendDoesNotPushTheTranscriptDown() throws {
    let field = app.textViews.firstMatch
    XCTAssertTrue(appears(field, within: 15), "no composer field")
    field.tap()
    XCTAssertTrue(appears(app.keyboards.element(boundBy: 0), within: 10))

    type("One")
    let send = app.buttons["Send"]
    XCTAssertTrue(appears(send, within: 5), "no send button with a draft")
    send.tap()
    let first = text("One")
    XCTAssertTrue(appears(first, within: 10), "the first message never landed")
    // Let One's receipt appear; the next send moves it to Two.
    XCTAssertTrue(appears(text("Delivered"), within: 8), "One's receipt never appeared")
    settled(first)
    let before = first.frame.minY

    type("Two")
    XCTAssertTrue(appears(send, within: 5), "no send button for the second draft")
    send.tap()
    XCTAssertTrue(appears(text("Two"), within: 10), "the second message never landed")
    // The receipt moves from One to Two, and the transcript settles
    XCTAssertTrue(waitUntil(8) { text("Delivered").exists && text("Delivered").frame.minY > text("Two").frame.minY }, "the receipt never moved to Two")
    settled(first)

    let after = first.frame.minY
    XCTAssertEqual(
      after, before, accuracy: 1.0,
      "sending moved the message above it from \(before) to \(after)")
  }
}
