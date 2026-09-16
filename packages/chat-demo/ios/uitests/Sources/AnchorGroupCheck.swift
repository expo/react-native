/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 The same anchor, on a transcript long enough to be GROUPED.

 `AnchorCheck` drives a conversation of a few dozen messages, which the chat
 lays out as one or two groups — so it exercises the correction without
 exercising the tree it now has to see through. Three thousand messages is
 ninety-four groups of thirty-two inside three groups of those, and two separate
 things have to be right for the reader to stay put:

 - A group is keyed by the RANGE it covers, not by the message that starts it.
   The leading group is a partial one, so keying it by its first message makes
   it a different element the moment an older message arrives, and React throws
   away the box and every row in it — the anchor's pinned view among them.
 - The anchor has to hold a ROW and not the group the row is in. Its candidate
   is the bottom-most child it can see; grouped, that child is a box taller than
   the screen, and everything that happens inside it between its own bottom edge
   and where the reader is looking is a correction applied to a movement that
   never happened.

 Measured before either was fixed: the reader was carried 1,459 points down a
 transcript that is supposed to hold still.
 */
final class AnchorGroupCheck: DemoCase {
  override class var initialScreen: String? { "chat" }
  override class var seedMessages: Int? { 3000 }

  func testLoadingEarlierMessagesHoldsAGroupedTranscriptStill() throws {
    XCTAssertTrue(
      text("Message 3000, from Alan Turing.").waitForExistence(timeout: 60),
      "the transcript never opened")

    /*
     * At the OLDEST end, which is where a page of history lands and where the
     * leading partial group is. At the newest end the anchor never has to run:
     * a reader at the end is followed there, and growth at the far side of three
     * thousand messages moves nothing they can see.
     */
    chooseCommand("Go to the earliest")
    Thread.sleep(forTimeInterval: 3.0)
    // Off the very top, so the correction has somewhere to move the offset to —
    // a list held against its own resting position cannot go further up.
    app.windows.element(boundBy: 0).swipeUp()
    Thread.sleep(forTimeInterval: 2.0)

    guard let landmark = firstVisibleMessage() else {
      return XCTFail("nothing recognisable on screen; visible: \(visibleText())")
    }
    let before = landmark.element.frame.origin.y

    chooseCommand("Load earlier messages")
    Thread.sleep(forTimeInterval: 2.5)

    XCTAssertTrue(
      landmark.element.exists,
      "\"\(landmark.label)\" left the tree when twenty messages were loaded above it — "
        + "a group re-keyed and took its rows with it")
    let after = landmark.element.frame.origin.y
    XCTAssertEqual(
      after, before, accuracy: 2.0,
      "\"\(landmark.label)\" moved \(after - before) points when twenty messages were "
        + "loaded above it, in a transcript of three thousand. The correction is the "
        + "same one `AnchorCheck` drives; what differs here is that the rows are in "
        + "boxes and the anchor has to see through them.")
  }

  /**
   The first mock message whose row is on screen, and its label.

   The oldest messages are the low numbers, and `Go to the earliest` puts them
   there — so the search starts at one. Searched by predicate rather than by
   walking every element: `allElementsBoundByIndex` over three thousand rows
   does not return.
   */
  private func firstVisibleMessage() -> (element: XCUIElement, label: String)? {
    for index in 1...60 {
      for suffix in [", sent.", ", from Ada Lovelace.", ", from Grace Hopper.", ", from Alan Turing."] {
        let label = "Message \(index)\(suffix)"
        let element = text(label)
        if element.exists && isOnScreen(element) {
          return (element, label)
        }
      }
    }
    return nil
  }
}
