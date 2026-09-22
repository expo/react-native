/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 Each tile in the `+` panel is a circle, not squashed by its label, and still
 shows its glyph. Read from pixels: a squashed tile still reports its styled
 38 pt width.
 */
// covers: Composer.js
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
    XCTAssertTrue(appears(field, within: 15), "no composer field")
    let plus = plusButton()
    XCTAssertTrue(appears(plus, within: 10), "no panel button")
    plus.tap()
    XCTAssertTrue(
      appears(app.buttons["Add fifty messages"], within: 10),
      "the panel never opened; visible: \(visibleText())")
    settled(app.buttons["Add fifty messages"])
  }

  func testEveryTileIsACircleAndKeepsItsGlyph() throws {
    try openThePanel()
    let px = try pixels()
    let window = app.windows.element(boundBy: 0).frame

    // Tiles have no accessibility element, and the card's x depends on which
    // `+` opened it, so each tile is found as a blob of saturated pixels.
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
    // The card's tile row: with no tile found the loop below checks nothing
    XCTAssertGreaterThanOrEqual(runs.count, 3, "found \(runs.count) tiles to measure; the scan found no tile row")

    for (index, run) in runs.enumerated() {
      let middle = (run.top + run.bottom) / 2
      let height = run.bottom - run.top
      let width = run.right - run.left
      XCTAssertEqual(
        width, height, accuracy: 2.0,
        "tile \(index) is \(width) x \(height) — an oval, not a circle")

      // Only that a glyph is present. Its centring isn't checked: the glyph is
      // an anonymous text run, so no style change could make that check fail.
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
