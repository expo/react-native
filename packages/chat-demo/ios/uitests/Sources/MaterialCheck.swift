/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 The chat bar's surface covers content, and covers nothing above itself.

 Both halves have been broken, in ways nothing else would have caught.

 The bar was a `linear-gradient` of translucent white — a colour, so it stayed
 white in dark mode. Then it was a MATERIAL, and drew nothing at all: a `<div>`
 whose only visible property is `-apple-visual-effect` was flattened away by
 Fabric, because the flattening rules are a list of `ViewProps` and the material
 is not one of them. Then the material was moved onto the accessory itself,
 where it drew — in the simulator. On the phone it never blurred at all: a
 backdrop samples the window it is in, and a bar in the keyboard's window has
 the app's window nowhere in reach. It is a translucent colour again now, for
 that reason, and this case is what says so honestly on either.

 **This is a two-sample test on ONE balloon**, and it has to be. A translucent
 fill over a page of its own colour is invisible by construction, so comparing
 the bar with the page proves nothing at all — an earlier version of this case
 did exactly that and passed on five levels of grey. The balloon is dragged
 until it STRADDLES the bar's top edge, and then the same blue is read twice:
 once uncovered, once through the surface. Same content, same colour, one line
 apart.

 That arrangement also tests the second half for free. The reading taken above
 the line has to be the balloon undimmed; if the surface reached above the bar —
 as it did for eighteen points, and was reported as "it extends above the text
 area too much" — that sample would be dimmed too and the two would agree.
 */
final class MaterialCheck: DemoCase {
  override class var initialScreen: String? { "chat" }

  func testTheBarCoversContentAndNothingAboveIt() throws {

    // A transcript long enough to run behind the bar, so there is something for
    // the surface to be a surface OF.
    chooseCommand("Add fifty messages")
    chooseCommand("Go to the earliest")
    Thread.sleep(forTimeInterval: 1.0)

    let plus = plusButton()
    XCTAssertTrue(plus.exists, "no + button to take the bar's geometry from")
    // The bar's own top edge: its top padding above the `+`.
    let barTop = plus.frame.minY - 8

    /*
     * SWIPED, from the earliest, until a sent balloon is at the bar's edge.
     *
     * From the newest the list rests against its own end with the bottom inset
     * reserved, so nothing is behind the bar and a drag toward it rubber-bands.
     * From the top the transcript runs the full height, and each swipe brings a
     * different message to the edge — which has to be one of OURS to be read as
     * blue, so this seeks rather than assuming a distance.
     *
     * `swipeUp()` rather than a press-and-drag: two earlier versions used
     * `press(forDuration:thenDragTo:)` on an element and then on a coordinate,
     * and neither moved the list where this needed it. The stock gesture is one
     * page and lands where it says.
     */
    let windowElement = app.windows.element(boundBy: 0)
    let window = windowElement.frame

    /// The first column in the trailing half whose pixels at `y` are balloon blue.
    func blueColumn(_ px: Pixels, _ y: CGFloat) -> (CGFloat, (r: Int, g: Int, b: Int))? {
      var x = window.width * 0.5
      while x < window.width - 24 {
        let sample = px.rowAverage(y: y, from: x, to: x + 6)
        if sample.b > sample.r + 40 && sample.b > 150 {
          return (x, sample)
        }
        x += 6
      }
      return nil
    }

    /*
     * WHERE the covering STOPS, read up one column of whatever is behind it.
     *
     * Not by colour. Three earlier versions looked for a blue balloon at a fixed
     * row and could not be aimed: a swipe is a page, the messages are fifty
     * points apart, and the composer's own pill masks the middle of the bar — so
     * the only place a covered balloon can be seen at all is the few points
     * between the bar's top edge and the pill's. Whether what lands there is one
     * of ours, one of theirs or the gap between them is not something the test
     * can choose.
     *
     * So it reads a STEP instead. Take a value just inside the bar, walk up the
     * same column, and the first row that differs from it by more than a dozen
     * levels is where the surface ends. That row has to be the bar's own edge,
     * give or take the four points it reaches above by design — the native
     * bar's does the same, measured. Eighteen is what shipped once and was
     * reported as "it extends above the text area too much".
     */
    let inside = barTop + 5
    var edge: CGFloat?
    var step = (from: 0, to: 0)
    var px = try pixels()
    for attempt in 0..<10 {
      var x = window.width * 0.2
      while x < window.width - 24 && edge == nil {
        let covered = px.rowAverage(y: inside, from: x, to: x + 6)
        let coveredValue = (covered.r + covered.g + covered.b) / 3
        // Something has to BE there. A column showing the bar over bare page is
        // one where nothing is covered and nothing can be concluded.
        if coveredValue < 250 {
          var y = inside - 2
          while y > barTop - 40 {
            let sample = px.rowAverage(y: y, from: x, to: x + 6)
            let value = (sample.r + sample.g + sample.b) / 3
            if abs(value - coveredValue) > 12 {
              edge = y
              step = (from: coveredValue, to: value)
              break
            }
            y -= 2
          }
        }
        x += 6
      }
      if edge != nil { break }
      if attempt == 0 {
        chooseCommand("Add fifty messages")
        chooseCommand("Go to the earliest")
      } else {
        windowElement.swipeUp()
      }
      Thread.sleep(forTimeInterval: 1.0)
      px = try pixels()
    }
    guard let stops = edge else {
      return XCTFail(
        "nothing behind the bar changes as the column leaves it, so either there "
          + "is no content back there or there is no surface over it; visible: "
          + "\(visibleText())")
    }

    XCTAssertGreaterThan(
      stops, barTop - 10,
      "the column still reads as covered \(barTop - stops) points above the "
        + "bar's top edge — \(step.from) inside, \(step.to) there — so the "
        + "surface is reaching above the bar it belongs to")

    /*
     * And the step itself is the surface DOING something: a bar that drew
     * nothing would read the same on both sides of its own edge, and this
     * assertion is what an empty `appleVisualEffect` fails.
     */
    XCTAssertGreaterThan(
      abs(step.from - step.to), 12,
      "the content reads \(step.from) inside the bar and \(step.to) just above "
        + "it — the bar is not covering what is behind it")
  }
}
