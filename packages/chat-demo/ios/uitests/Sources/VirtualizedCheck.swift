/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 `VirtualView` rows inside `<native:scroll>` are virtualized: rows far from the
 viewport leave the accessibility tree (a hidden `VirtualView` renders
 `null`), rows near it stay, and virtualizing doesn't move the list. Rows are
 hidden only beyond five viewport heights, hence the long list. See
 ui-metrics.md, "Virtualized prerender band".
 */
// covers: screens/VirtualizedScreen.js
final class VirtualizedCheck: DemoCase {
  /// Must be `ROW_COUNT - 1` from VirtualizedScreen.js. A label the screen
  /// doesn't have never exists, and every `XCTAssertFalse` here would pass.
  private let lastRow = "Row 9999"
  /// After a jump the container updates the rows' modes and React commits,
  /// which takes seconds at 10,000 rows: waits until the row the list should
  /// be on is in the tree and at rest, and the far end has left it.
  private func settle(on row: String, without farRow: String) {
    // The far row leaving is the last thing to happen
    XCTAssertTrue(waitUntil(25) { !text(farRow).exists }, "\(farRow) is still in the tree after the jump to \(row)")
    XCTAssertTrue(text(row).exists, "\(row) is not rendered after the jump")
  }

  override class var initialScreen: String? { "virtualized" }

  private func openList() {
    XCTAssertTrue(waitUntil(25) { text("Row 30").exists }, "the list never rendered its prerender band")
  }

  private func goToStart() {
    app.buttons["To the start"].tap()
    settle(on: "Row 0", without: lastRow)
  }

  private func goToEnd() {
    app.buttons["To the end"].tap()
    settle(on: lastRow, without: "Row 0")
  }

  func testTheFarEndLeavesTheTreeAndVirtualizingDoesNotMoveTheList() throws {
    try XCTContext.runActivity(named: "the far end leaves the tree") { _ in
      openList()
      goToStart()

      XCTAssertTrue(text("Row 0").exists, "the first row is not rendered")
      // Rows just off screen must already be rendered, or scrolling shows blanks.
      // About 11 rows fit, so row 30 is off screen but inside the prerender band.
      XCTAssertTrue(
        text("Row 30").exists,
        "row 30 is off screen but only two viewport-heights down, inside a "
          + "prerender band five deep — it should already be rendered")
      XCTAssertFalse(
        text(lastRow).exists,
        "\(lastRow) is still in the tree with the list at row 0 — six hundred "
          + "thousand points away, and five viewport-heights is four thousand. "
          + "Nothing is virtualizing it: the scroll view is not answering "
          + "`virtualViewContainerState`, or the state is not hearing about "
          + "scrolls.")

      goToEnd()

      XCTAssertTrue(
        text(lastRow).exists,
        "\(lastRow) did not come back when the list was scrolled to it — a "
          + "`VirtualView` that hides and never returns is worse than one that "
          + "never hides")
      XCTAssertFalse(
        text("Row 0").exists,
        "row 0 is still in the tree with the list at the far end, so hiding is "
          + "one-way")
    }

    try XCTContext.runActivity(named: "virtualizing does not move the list") { _ in
      // The list is at its far end from the part before
      let last = text(lastRow)
      XCTAssertTrue(last.exists, "the end of the list is not rendered at the end")
      let before = last.frame.origin.y

      Thread.sleep(forTimeInterval: 3.0)

      XCTAssertTrue(last.exists, "\(lastRow) left the tree while the list sat on it")
      let after = last.frame.origin.y
      XCTAssertEqual(
        after, before, accuracy: 2.0,
        "\(lastRow) moved \(after - before) points while the list sat still and the "
          + "rows above it virtualized")
    }
  }
}
