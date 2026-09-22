/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 With `contentAnchor="bottom"`, loading twenty older messages above the
 viewport doesn't move the messages on screen. (The offset is measured from the
 top, so the scroll view must add whatever was inserted above.)
 */
// covers: screens/ChatScreen.js
final class AnchorCheck: DemoCase {
  override class var initialScreen: String? { "chat" }

  func testLoadingEarlierMessagesDoesNotMoveTheReader() throws {

    // Scrolled away from both ends, so neither clamps the offset.
    chooseCommand("Add fifty messages")
    chooseCommand("Go to the earliest")

    let windowElement = app.windows.element(boundBy: 0)
    windowElement.swipeUp()
    settled(app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH 'Message '")).firstMatch)

    guard let landmark = firstVisibleMessage() else {
      return XCTFail("nothing recognisable on screen to anchor to; visible: \(visibleText())")
    }
    let before = landmark.element.frame.origin.y
    let earlier = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH 'Earlier message '")).firstMatch
    XCTAssertFalse(earlier.exists, "an earlier message is in the tree before any was loaded")

    chooseCommand("Load earlier messages")
    settled(landmark.element)
    // The command must have added rows above, or the landmark staying put
    // proves nothing. They are labelled "Earlier message N." in ChatScreen.js
    // and land inside the prerender band, so at least one is rendered.
    XCTAssertTrue(appears(earlier, within: 8), "\"Load earlier messages\" put no earlier message in the tree")

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
   The first on-screen message labelled by `mockConversation` in ChatScreen.js
   ("Message 7, sent.", "Message 8, from Ada Lovelace."). Looked up by label,
   not by enumerating: `allElementsBoundByIndex` over seventy rows takes
   minutes.
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
