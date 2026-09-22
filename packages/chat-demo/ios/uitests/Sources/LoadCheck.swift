/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 A 1,000-message chat opens with only its newest rows rendered, and older rows
 render when scrolled to.
 */
// covers: screens/ChatScreen.js
final class LoadCheck: DemoCase {
  override class var initialScreen: String? { "chat" }
  override class var seedMessages: Int? { 1000 }
  override class var showsPerformance: Bool { true }

  // Must match `CAST` and the labels `mockConversation` builds in ChatScreen.js.
  private static let cast = ["Ada Lovelace", "Grace Hopper", "Alan Turing"]
  private func message(_ n: Int) -> String {
    let i = n - 1
    return i % 3 == 1 ? "Message \(n), sent." : "Message \(n), from \(Self.cast[i % 3])."
  }

  func testALongConversationOpensOnItsNewestRowsAndPagesOlderOnesIn() throws {
    let newest = text(message(1000))
    XCTAssertTrue(appears(newest, within: 15), "the newest row is not on screen")

    // Must match the `open` report in ChatScreen.js:
    // "1000 messages, N rows rendered, rendered in T ms".
    let caption = app.descendants(matching: .any).matching(
      NSPredicate(format: "label BEGINSWITH '1000 messages, '")
    ).firstMatch
    XCTAssertTrue(
      appears(caption, within: 5),
      "no load caption under the last row; visible: \(visibleText())")
    let label = caption.label
    let inTree = try XCTUnwrap(
      label.split(separator: " ").dropFirst(2).first.flatMap { Int($0) },
      "cannot read the rows in the tree from \"\(label)\"")
    XCTAssertLessThan(inTree, 200, "\(inTree) of 1000 rows rendered at open: \(label)")
    XCTAssertGreaterThanOrEqual(inTree, 20, "too few rows to fill a screen: \(label)")

    // Give the container time to render rows inside its prerender band. Hidden
    // rows render nothing, so the count is of rendered rows.
    let rows = app.descendants(matching: .any).matching(
      NSPredicate(format: "label BEGINSWITH 'Message '"))
    // Until the count stops changing: rows are paged in over a few commits
    var stable = rows.count
    for _ in 0..<30 {
      Thread.sleep(forTimeInterval: 0.1)
      let now = rows.count
      if now == stable { break }
      stable = now
    }
    let settled = stable
    print("LoadCheck: \(inTree) rows at first layout, \(settled) once the threshold is served")
    XCTAssertLessThan(settled, 400, "\(settled) of 1000 rows rendered at rest — nothing stayed hidden")
    let older = text(message(1000 - settled - 20))
    XCTAssertFalse(older.exists, "a row 20 above the settled tree (\(settled) rows) is already in it")

    for _ in 0..<12 where !older.exists {
      app.swipeDown(velocity: .fast)
    }
    XCTAssertTrue(
      appears(older, within: 5),
      "scrolling up did not render older rows; visible: \(visibleText())")
  }
}
