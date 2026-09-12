/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 `VirtualView` works inside `<native:scroll>`.

 It did not, and the way it failed is the reason this case exists: a
 `VirtualView` finds its container by walking up for the first ancestor that
 answers `virtualViewContainerState`, and only `RCTScrollViewComponentView`
 answered it. Inside one of ours the walk found nothing, so no mode ever
 arrived, so every row stayed rendered — a list that looks perfect, scrolls
 perfectly, and virtualizes nothing at all. Nothing on screen says so.

 What says so is whether a row a long way off is IN THE TREE. A hidden
 `VirtualView` renders `null` for its children, so the row's label is genuinely
 absent rather than merely off screen — which `exists` can see, and a screenshot
 cannot.

 **The numbers are not arbitrary.** `virtualViewPrerenderRatio` is 5.0 and the
 prerender rectangle is the viewport inflated by that on each side, so a row has
 to be more than five viewport-heights away — about four thousand points here,
 or sixty-odd of these rows — before it is `Hidden`. That is why the screen is
 long and why this asserts about the far end of it. A twenty-row list would pass
 this test with the container ripped out.
 */
final class VirtualizedCheck: DemoCase {
  /**
   The last row's index, which must match `ROW_COUNT` in `VirtualizedScreen.js`.

   Named once rather than written into eight assertions, because the failure
   when it drifts is silent in the worst direction: a row this screen does not
   have is a row that does not exist, `exists` is false, and every
   `XCTAssertFalse` here passes for the wrong reason. The screen went from four
   hundred rows to ten thousand and this is the only line that had to know.
   */
  private let lastRow = "Row 9999"
  /**
   The screen takes a moment to settle: the container computes modes after the
   first layout, and React then commits the rows that changed.

   EIGHT seconds, where four hundred rows needed two. That is the clearest thing
   the ten-thousand-row list measures — virtualization at this size is CORRECT
   and SLOW, not broken. At two seconds the far end was still in the tree after a
   scroll to it, which reads exactly like hiding being one-way; at eight it is
   not, and at twenty it certainly is not. Both were run rather than reasoned
   about.

   The other half of the cost is on the query side and is worse: see `openList`.
   */
  private func settle() {
    Thread.sleep(forTimeInterval: 8.0)
  }

  /*
   * Every case here starts by saying where it wants the list to be rather than
   * relying on where it happens to open.
   */
  /*
   * Launches straight onto the list. The first query against the
   * ten-thousand-row accessibility tree is the expensive part — measured at
   * longer than twenty seconds while the screen itself opened in one — and
   * `setUp` now pays it as the readiness wait (with the ninety-second timeout
   * that measurement demands), so `openList` only settles.
   */
  override class var initialScreen: String? { "virtualized" }

  private func openList() {
    settle()
  }

  private func goToStart() {
    app.buttons["To the start"].tap()
    settle()
  }

  func testTheFarEndOfTheListLeavesTheTree() throws {
    openList()
    goToStart()

    XCTAssertTrue(text("Row 0").exists, "the first row is not rendered")
    /*
     * And the band is a BAND, not a viewport — asserted here, at the state
     * this test is already in, rather than in a test of its own. It was one:
     * thirty seconds of launch and settling to re-create this exact position
     * and ask one more question of it. A row just off the screen must already
     * be rendered, or scrolling shows blanks that fill in afterwards; this is
     * what separates a working container from one that simply unmounts
     * everything it cannot see, and both would pass the far-end assertions.
     * About eleven rows fit; row 30 is off the bottom and well inside a
     * prerender band five viewports deep.
     */
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

    app.buttons["To the end"].tap()
    settle()

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

  /**
   Virtualizing does not move the reader.

   This is the combination that has to work and the one where the two features
   pull against each other. A row materialising or being dropped ABOVE the
   viewport changes the content's height, and a scroll offset is measured from
   the top — so unless the scroll view corrects for what changed above, a list
   is pushed along by its own virtualization, while the reader is reading.

   `<native:scroll>` corrects for it on every mounting transaction, for both
   anchors — see `-mountingTransactionWillMount:`. That is not the bottom
   anchor's doing and this screen sets no anchor, so what is being measured here
   is the correction itself.

   Measured rather than argued: put the list at the end, note where the last row
   sits, wait for the container to settle every mode it is going to change, and
   require that it has not moved.
   */
  func testVirtualizingRowsDoesNotMoveTheList() throws {
    openList()
    app.buttons["To the end"].tap()
    settle()

    let last = text(lastRow)
    XCTAssertTrue(last.exists, "the end of the list is not rendered at the end")
    let before = last.frame.origin.y

    // Long enough for every mode change the container is going to make, and for
    // React to commit each of them.
    Thread.sleep(forTimeInterval: 3.0)

    XCTAssertTrue(last.exists, "\(lastRow) left the tree while the list sat on it")
    let after = last.frame.origin.y
    XCTAssertEqual(
      after, before, accuracy: 2.0,
      "\(lastRow) moved \(after - before) points while the list sat still and the "
        + "rows above it virtualized")
  }
}
