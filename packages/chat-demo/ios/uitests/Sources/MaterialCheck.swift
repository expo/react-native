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

    /*
     * THE BAR SAYS WHERE IT IS. This was `plus.frame.minY - 8` — the bar's top
     * edge inferred from the `+` button and a fitted constant, which is not a
     * number the product states anywhere (`BAR_TOP_PADDING` is 0 on iOS). Any
     * change to the button's inset moved the RULER rather than the thing being
     * measured, and the test reported it as the surface moving.
     */
    let windowElement = app.windows.element(boundBy: 0)
    let window = windowElement.frame

    /*
     * THE BAR ON THIS SCREEN, and not whichever one the query reaches first.
     *
     * A pushed screen leaves the one beneath it in the hierarchy, composer and
     * all, so `firstMatch` can return a bar belonging to a screen nobody is
     * looking at — whose frame is a perfectly good number pointing at nothing.
     * Under two-lane load that is what it returned, and the test read the same
     * value on both sides of an edge that was not there. It said so, which is
     * the only reason this was found and not fitted around.
     *
     * The lowest one is this screen's: a composer sits at the bottom of the
     * window it belongs to.
     */
    let bars = app.otherElements.matching(identifier: "composer-bar")
    XCTAssertTrue(
      bars.firstMatch.waitForExistence(timeout: 10),
      "the composer bar has no frame to measure against — see `testID` on the "
        + "bar's glass container in Composer.js")
    func currentBar() -> XCUIElement? {
      let all = bars.allElementsBoundByIndex.filter { !$0.frame.isEmpty }
      return all.max { $0.frame.minY < $1.frame.minY }
    }
    guard let bar = currentBar() else {
      return XCTFail("no composer bar with a frame; visible: \(visibleText())")
    }
    /*
     * And it has to be WHERE A BAR IS. A reference that points somewhere the bar
     * is not produces readings that are internally consistent and meaningless —
     * see the frame this returned from the screen underneath.
     */
    XCTAssertGreaterThan(
      bar.frame.maxY, window.height * 0.6,
      "the composer bar's frame is \(bar.frame) in a \(window.size) window, "
        + "which is not where a composer sits — the reference is wrong and "
        + "every reading taken against it would be")

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
     * SO IT USES ONE BALLOON AS ITS OWN CONTROL.
     *
     * An earlier version took a value just inside the bar, walked up the column
     * and called the first row differing by a dozen levels the surface's edge.
     * That measured the wrong thing, and here is the profile that says so —
     * `dy` is points below the bar's top edge, negative above it:
     *
     *     +8:246  +6:247  +4:248  +2:250   0:254
     *     -2:254  -6:254  -10:254  -12:233  -14:233 … -20:233
     *
     * The page above the bar is bare white for ten points, so the material is
     * NOT reaching above the bar. The step at -12 is a grey received balloon
     * sitting above it. Over the page it actually had behind it the material
     * moves the value nine levels; the balloon's edge is twenty-two. The scan
     * found the balloon every time, and the median could not reject it because
     * the balloon spanned every column. Pass or fail by scroll position.
     *
     * The precondition was the real fault: this needs content SPANNING the
     * bar's top edge, and nothing checked that it had any. So the seek below
     * looks for a column where one balloon's uniform fill runs from above the
     * edge to below it, and FAILS if it cannot find one rather than measuring
     * whatever else is in the column.
     *
     * With that, the balloon is its own control and both readings are
     * differences of one fill against itself:
     *
     *   COVERED — the fill below the edge against the same fill above it. The
     *     bar must attenuate what passes beneath it.
     *   CLEAR — the fill six points above the edge against the same fill
     *     sixteen points above. The material must have no influence there:
     *     `FADE` is documented as beginning four points above the bar's top
     *     edge, measured off the native app, so six is just outside it and
     *     sixteen is well clear.
     *
     * Both are contrast-normalised by construction, which is what the earlier
     * fixed twelve-level threshold could not be: a fade crossed at a fixed
     * level lands in a different place for every colour behind it.
     */
    /*
     * READ TOGETHER, and that is not a detail: the bar MOVES — it rides the
     * keyboard — so a frame taken once and compared against screenshots taken
     * later measures the bar where it used to be. That produced a run reading
     * the same value on both sides of an edge that was no longer there, and the
     * test correctly reported the bar as not covering anything.
     */
    func lookAtTheBar() throws -> (px: Pixels, barTop: CGFloat) {
      let px = try pixels()
      return (px, bar.frame.minY)
    }

    var (px0, barTop0) = try lookAtTheBar()
    /*
     * Whether any column got as far as spanning the edge, so that a failure can
     * tell "nothing was arranged" from "the bar covers nothing".
     */
    var sawSpanning = false
    /// A column reading the same fill at `above` and `below` the bar's edge.
    func spanningColumn(_ px: Pixels, _ barTop: CGFloat) -> (x: CGFloat, above: Int, below: Int)? {
      var x = window.width * 0.12
      while x < window.width - 24 {
        let high = px.rowAverage(y: barTop - 16, from: x, to: x + 6)
        let mid = px.rowAverage(y: barTop - 6, from: x, to: x + 6)
        let low = px.rowAverage(y: barTop + 6, from: x, to: x + 6)
        let highValue = (high.r + high.g + high.b) / 3
        let midValue = (mid.r + mid.g + mid.b) / 3
        let lowValue = (low.r + low.g + low.b) / 3
        /*
         * A FILL, not an edge: the two rows above the bar have to agree, or the
         * column is crossing the balloon's own boundary and the difference
         * below would be that rather than the bar's. And not the page: bare
         * white has nothing to attenuate, which is the case that produced the
         * profile above.
         */
        /*
         * AND THE BAR HAS TO BE COVERING IT — which is a condition of the
         * ARRANGEMENT, not something to discover by asserting it afterwards.
         *
         * This is the third time this test has asserted a thing it had not
         * established. A column can have one fill on both sides of the edge and
         * no material over the lower half: the bar's blur is not up yet, the
         * peek before this case left it hidden, the flight layer is over it.
         * Measured then, the two sides agree — and "the same fill reads the
         * same" was being reported as "the bar is not covering", which is true
         * of that screenshot and says nothing about the bar.
         *
         * So a column counts only when the bar is demonstrably doing something
         * to it, and the seek keeps looking otherwise. The assertion below is
         * then about the SIZE of the covering, on a column where covering
         * exists — and a screen where the bar covers nothing at all runs the
         * seek out and fails saying exactly that, which is still the regression
         * this case is for.
         */
        if highValue < 250 && abs(highValue - midValue) <= 3 && lowValue < 250 {
          sawSpanning = true
          if abs(midValue - lowValue) > 3 {
            return (x, midValue, lowValue)
          }
        }
        x += 6
      }
      return nil
    }

    var found = spanningColumn(px0, barTop0)
    var px = px0
    var barTop = barTop0
    for attempt in 0..<10 where found == nil {
      if attempt == 0 {
        chooseCommand("Add fifty messages")
        chooseCommand("Go to the earliest")
      } else {
        windowElement.swipeUp()
      }
      Thread.sleep(forTimeInterval: 1.0)
      (px, barTop) = try lookAtTheBar()
      found = spanningColumn(px, barTop)
    }

    guard let column = found else {
      return XCTFail(
        sawSpanning
          ? "a balloon spans the bar's top edge and reads the SAME on both "
            + "sides of it — the bar is covering nothing at all; visible: "
            + "\(visibleText())"
          : "no column has one balloon's fill both above and below the bar's "
            + "top edge, so there is nothing whose covering can be read; "
            + "visible: \(visibleText())")
    }

    let clearSample = px.rowAverage(y: barTop - 16, from: column.x, to: column.x + 6)
    let clearValue = (clearSample.r + clearSample.g + clearSample.b) / 3
    print(
      "MEASURE material clear16=\(clearValue) clear6=\(column.above) "
        + "covered6=\(column.below)")

    /*
     * NOTHING ABOVE THE BAR. The same fill, six points above the edge and
     * sixteen above it, has to read the same — `FADE` starts four points above
     * by design and nothing of it should survive to six. Three levels is the
     * noise of a six-point-wide row average over a rendered fill; it is not a
     * budget for the material to spend.
     */
    XCTAssertLessThanOrEqual(
      abs(column.above - clearValue), 3,
      "the balloon reads \(column.above) six points above the bar's top edge "
        + "and \(clearValue) sixteen points above — the same fill, so the bar's "
        + "material is reaching above the bar it belongs to")

    /*
     * And the bar DOING something: the same fill, below its edge, has to be
     * attenuated. This is what an empty `appleVisualEffect` fails — it would
     * read identically on both sides of an edge it is not drawing.
     */
    XCTAssertGreaterThan(
      abs(column.above - column.below), 6,
      "the balloon reads \(column.above) just above the bar's top edge and "
        + "\(column.below) just below it — the same fill, so the bar is not "
        + "covering what passes beneath it")
  }
}
