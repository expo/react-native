/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 A long conversation opens on its newest rows; older ones render as you reach them.

 Every row is a `VirtualView`; one that starts NOT hidden renders, measures and
 mounts its balloon before the first layout can hide it. So only the newest
 rows start that way, and the rest start in the view's hidden mode — a
 placeholder with nothing in it — until the container brings them near.

 Asserted through the load caption under the header — the rows rendered
 against the total — and through the rows themselves: the newest is there at
 once, an old one is not, and scrolling up brings it.

 The mock conversation's text is deterministic: message `n` (1-based) is
 "Message n, sent." when `(n - 1) % 3 == 1`, otherwise "Message n, from <name>."
 with the name from the cast by `(n - 1) % 3`.
 */
final class LoadCheck: DemoCase {
  override class var initialScreen: String? { "chat" }
  override class var seedMessages: Int? { 1000 }
  override class var showsPerformance: Bool { true }

  private static let cast = ["Ada Lovelace", "Grace Hopper", "Alan Turing"]
  private func message(_ n: Int) -> String {
    let i = n - 1
    return i % 3 == 1 ? "Message \(n), sent." : "Message \(n), from \(Self.cast[i % 3])."
  }

  func testALongConversationOpensOnItsNewestRowsAndPagesOlderOnesIn() throws {
    let newest = text(message(1000))
    XCTAssertTrue(newest.waitForExistence(timeout: 15), "the newest row is not on screen")

    // A `<p>` is an `Other` with a label, not a static text — see `text(_:)`.
    let caption = app.descendants(matching: .any).matching(
      NSPredicate(format: "label BEGINSWITH '1000 messages, '")
    ).firstMatch
    XCTAssertTrue(
      caption.waitForExistence(timeout: 5),
      "no load caption under the last row; visible: \(visibleText())")
    let label = caption.label
    let inTree = try XCTUnwrap(
      label.split(separator: " ").dropFirst(2).first.flatMap { Int($0) },
      "cannot read the rows in the tree from \"\(label)\"")
    XCTAssertLessThan(inTree, 200, "\(inTree) of 1000 rows rendered at open: \(label)")
    XCTAssertGreaterThanOrEqual(inTree, 20, "too few rows to fill a screen: \(label)")

    /*
     The container renders the hidden rows inside its prerender threshold on
     the first layout, so what is in the tree once that settles is what is
     counted — a hidden row renders nothing, so it is not there to count.
     */
    let rows = app.descendants(matching: .any).matching(
      NSPredicate(format: "label BEGINSWITH 'Message '"))
    sleep(2)
    let settled = rows.count
    print("LoadCheck: \(inTree) rows at first layout, \(settled) once the threshold is served")
    XCTAssertLessThan(settled, 400, "\(settled) of 1000 rows rendered at rest — nothing stayed hidden")
    let older = text(message(1000 - settled - 20))
    XCTAssertFalse(older.exists, "a row 20 above the settled tree (\(settled) rows) is already in it")

    // Scrolling up brings the hidden rows near, and the container renders them.
    for _ in 0..<12 where !older.exists {
      app.swipeDown(velocity: .fast)
    }
    XCTAssertTrue(
      older.waitForExistence(timeout: 5),
      "scrolling up did not render older rows; visible: \(visibleText())")
  }
}
