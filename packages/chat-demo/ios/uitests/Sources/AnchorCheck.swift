/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 A bottom-anchored transcript holds the CONTENT still, not the offset.

 `contentAnchor="bottom"` used to mean one thing only: follow the end when the
 reader is at the end. That is half of what the anchor means, and the missing
 half is the half a reader notices. A scroll offset is measured from the TOP, so
 anything that changes the content above the viewport — older messages loaded
 in, a row measured for the first time, an edit two hundred rows back — moves
 everything on screen down by exactly what it added. A reader who had scrolled
 up got no anchoring at all.

 This drives the case directly: scroll up until a known message is on screen,
 note where it is, load twenty older messages ABOVE it, and require that it has
 not moved. Twenty messages is well over a screen, so an unanchored list would
 not merely drift — it would take the message off the bottom entirely.

 It is also the foundation for virtualizing a transcript: a `VirtualView`
 materialising above the viewport is the same event as a message arriving there.
 */
final class AnchorCheck: DemoCase {
  override class var initialScreen: String? { "chat" }

  func testLoadingEarlierMessagesDoesNotMoveTheReader() throws {

    // Enough content to scroll within, and a landmark far enough from either
    // end that neither the top nor the bottom clamps the result.
    chooseCommand("Add fifty messages")
    Thread.sleep(forTimeInterval: 1.0)
    chooseCommand("Go to the earliest")
    Thread.sleep(forTimeInterval: 1.0)

    let windowElement = app.windows.element(boundBy: 0)
    windowElement.swipeUp()
    Thread.sleep(forTimeInterval: 1.0)

    /*
     * Whatever is actually on screen, rather than a message chosen in advance.
     * A swipe is a page and the demo's own content decides what lands; asking
     * for a particular row would be asking the test to control something it
     * does not.
     */
    guard let landmark = firstVisibleMessage() else {
      return XCTFail("nothing recognisable on screen to anchor to; visible: \(visibleText())")
    }
    let before = landmark.element.frame.origin.y

    chooseCommand("Load earlier messages")
    Thread.sleep(forTimeInterval: 1.5)

    XCTAssertTrue(
      landmark.element.exists,
      "\"\(landmark.label)\" left the tree when twenty messages were loaded above it")
    let after = landmark.element.frame.origin.y
    XCTAssertEqual(
      after, before, accuracy: 2.0,
      "\"\(landmark.label)\" moved \(after - before) points when twenty messages "
        + "were loaded above it. A bottom-anchored list has to correct the offset "
        + "by however much the content grew above the viewport; without that the "
        + "reader is carried down by everything that arrives.")
  }

  /**
   The first mock message whose row is on screen, and its label.

   The demo numbers its filler — "Message 7, sent." and "Message 8, from Ada
   Lovelace." — so a label is enough to find one again after the tree has
   changed. Searched by predicate rather than by walking every element:
   `allElementsBoundByIndex` over a seventy-row transcript is minutes.
   */
  private func firstVisibleMessage() -> (element: XCUIElement, label: String)? {
    for index in 1...70 {
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
