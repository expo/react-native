/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 The panel's tiles are circles, and each one still has its glyph.

 Both were reported and both were invisible at the default text size, which is
 why they are measured here rather than looked at.

 - The tile is a fixed 38-point circle in a flex row, and `flex-shrink` defaults
   to 1 — so the row was free to take width from it the moment the label wanted
   the room. At the default size the labels fit and nothing is taken; raise the
   text size and the tile was squashed to an oval, then a teardrop, then narrow
   enough to clip its own glyph away.
 - And a tile squeezed narrow enough clipped its own glyph out of existence,
   which is the second thing checked here.

 The glyph's POSITION is not asserted — see the note at the assertion for why an
 assertion I could not make fail was left out rather than left in.

 Read from PIXELS rather than from frames. A tile's roundness is not a frame
 property — a squashed one still reports 38 wide if the style says so — and the
 glyph's position inside it is not a frame at all.
 */
final class PanelTileCheck: DemoCase {
  override class var initialScreen: String? { "chat" }

  /// The panel's tiles are saturated; its card and labels are not.
  private func isTile(_ c: (r: Int, g: Int, b: Int)) -> Bool {
    let hi = max(c.r, max(c.g, c.b))
    let lo = min(c.r, min(c.g, c.b))
    return hi - lo > 55 && hi > 60
  }

  /// The white glyph inside a tile.
  private func isGlyph(_ c: (r: Int, g: Int, b: Int)) -> Bool {
    return c.r > 215 && c.g > 215 && c.b > 215
  }

  private func openThePanel() throws {
    let field = app.textViews.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 15), "no composer field")
    let plus = plusButton()
    XCTAssertTrue(plus.waitForExistence(timeout: 10), "no panel button")
    plus.tap()
    XCTAssertTrue(
      app.buttons["Add fifty messages"].waitForExistence(timeout: 10),
      "the panel never opened; visible: \(visibleText())")
    Thread.sleep(forTimeInterval: 0.8)
  }

  func testEveryTileIsACircleAndKeepsItsGlyph() throws {
    try openThePanel()
    let px = try pixels()
    let window = app.windows.element(boundBy: 0).frame

    /*
     * Each tile found as a BLOB, not along a column.
     *
     * The tiles are `<span>`s with no accessible identity — the row's name is
     * the command's — so there is nothing to look up, and the card is anchored
     * to whichever `+` opened it so its x cannot be stated either. Two
     * column-based attempts failed for that reason: one was left of the card
     * entirely, and one grazed the tiles' edges and measured a 38-point circle
     * as 15 by 24.
     *
     * Collecting every saturated row-run in the card's leading third and
     * grouping the ones that touch gives each tile's own bounding box, which is
     * what both assertions are about.
     */
    var spans: [(y: CGFloat, x0: CGFloat, x1: CGFloat)] = []
    var y: CGFloat = 0
    while y < window.height {
      var x = window.width * 0.03
      var runStart: CGFloat = -1
      while x < window.width * 0.42 {
        if isTile(px.at(x: x, y: y)) {
          if runStart < 0 { runStart = x }
        } else if runStart >= 0 {
          if x - runStart > 8 { spans.append((y, runStart, x - 0.5)) }
          runStart = -1
        }
        x += 0.5
      }
      y += 0.5
    }

    var boxes: [(top: CGFloat, bottom: CGFloat, left: CGFloat, right: CGFloat)] = []
    for span in spans {
      if let last = boxes.indices.last, span.y - boxes[last].bottom <= 1 {
        boxes[last].bottom = span.y
        boxes[last].left = min(boxes[last].left, span.x0)
        boxes[last].right = max(boxes[last].right, span.x1)
      } else {
        boxes.append((span.y, span.y, span.x0, span.x1))
      }
    }
    let runs = boxes.filter { $0.bottom - $0.top > 20 }

    for (index, run) in runs.enumerated() {
      let middle = (run.top + run.bottom) / 2
      let height = run.bottom - run.top
      let width = run.right - run.left
      XCTAssertEqual(
        width, height, accuracy: 2.0,
        "tile \(index) is \(width) x \(height) — an oval, not a circle")

      /*
       * That there IS a glyph, not where it sits.
       *
       * The centring is deliberately not asserted, because I could not
       * demonstrate the assertion failing. Pushing the glyph with a padding
       * does not move it — it is an anonymous run rather than a flex child, so
       * the box's own centring rules do not reach it (see
       * `elided-run-is-not-a-child`) — and enlarging its line box does not move
       * it either. An assertion I cannot make fail is not coverage, whatever it
       * reads like.
       *
       * Its PRESENCE is worth checking and is provable: a tile squeezed narrow
       * enough clips its own glyph away, which is the state this started from.
       */
      var hasInk = false
      var probe = run.top
      while probe <= run.bottom, !hasInk {
        var x = run.left
        while x <= run.right {
          if isGlyph(px.at(x: x, y: probe)) {
            hasInk = true
            break
          }
          x += 0.5
        }
        probe += 0.5
      }
      XCTAssertTrue(hasInk, "tile \(index) has no glyph in it — it has been clipped away")
    }
  }
}
