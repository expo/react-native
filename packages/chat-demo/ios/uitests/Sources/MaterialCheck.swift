/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 The chat bar's material dims content under the bar, and doesn't reach 16 pt
 above the bar's top edge. Measured on one sent balloon dragged across that
 edge: over a plain page the bar would look the same either way.
 */
// covers: Composer.js screens/ChatScreen.js
final class MaterialCheck: DemoCase {
  override class var initialScreen: String? { "chat" }

  func testTheBarCoversContentAndNothingAboveIt() throws {

    let windowElement = app.windows.element(boundBy: 0)
    let window = windowElement.frame

    // `testID="composer-bar"` in Composer.js. A covered screen's bar stays in
    // the hierarchy, so use the lowest one.
    let bars = app.otherElements.matching(identifier: "composer-bar")
    XCTAssertTrue(
      appears(bars.firstMatch, within: 10),
      "the composer bar has no frame to measure against — see `testID` on the "
        + "bar's glass container in Composer.js")
    func currentBar() -> XCUIElement? {
      let all = bars.allElementsBoundByIndex.filter { !$0.frame.isEmpty }
      return all.max { $0.frame.minY < $1.frame.minY }
    }
    guard let bar = currentBar() else {
      return XCTFail("no composer bar with a frame; visible: \(visibleText())")
    }
    XCTAssertGreaterThan(
      bar.frame.maxY, window.height * 0.6,
      "the composer bar's frame is \(bar.frame) in a \(window.size) window, "
        + "which is not where a composer sits — the reference is wrong and "
        + "every reading taken against it would be")

    // Needs a tall balloon with a straight side (one-line balloons have round
    // ends): 80 wide glyphs wrap to four lines, a 60 pt straight side. A sent
    // one, because the material changes blue about five times more than grey.
    // The fifty messages make the transcript long enough to scroll.
    chooseCommand("Add fifty messages")
    let text = "M" + String(repeating: "m", count: 79)
    let field = app.textViews.firstMatch
    XCTAssertTrue(appears(field, within: 10), "no composer field to type into")
    settled(field)
    field.tap()
    // The hardware-key path: the keyboard may come down, which does not matter
    // here — the keyboard is dismissed before anything is read
    typeInChunks(text)
    settled(field)
    app.buttons["Send"].tap()
    // Dismiss with the command: a drag would scroll the transcript, and with
    // the keyboard up the predictive bar shows the same text as a key. Match
    // the run by prefix, so one dropped key tap doesn't lose it.
    chooseCommand("Dismiss the keyboard")
    let runs = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Mmmmmmmm"))
    let run = runs.firstMatch
    guard appears(run, within: 10) else {
      return XCTFail("the tall message never landed; visible: \(visibleText())")
    }
    // The keys' slide and the transcript following them
    XCTAssertTrue(vanishes(app.keyboards.element(boundBy: 0), within: 8), "the keyboard stayed up")
    settled(bar)
    settled(run)
    print("MEASURE run frame=\(run.frame) matches=\(runs.count)")
    guard run.frame.height >= 60 else {
      return XCTFail(
        "the typed run is \(run.frame.height) points tall, fewer than three lines; "
          + "the balloon has no straight side long enough to read across the edge")
    }

    // Drag down until the run is centred 10 pt above the bar's top, so its
    // straight side covers the rows read below (26 pt above to 6 pt below).
    func remaining() -> CGFloat { (bar.frame.minY - 10) - run.frame.midY }
    for _ in 0..<10 where abs(remaining()) > 6 {
      let start = windowElement.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.45))
      // Released while moving: a touch that stops on a balloon opens its menu.
      let end = start.withOffset(CGVector(dx: 0, dy: max(-250, min(250, remaining()))))
      start.press(forDuration: 0.05, thenDragTo: end, withVelocity: 400, thenHoldForDuration: 0)
      settled(run)
    }
    // An open context menu would dim the whole screen.
    XCTAssertFalse(
      app.buttons["Copy"].exists,
      "a context menu is open over the transcript after the drags; visible: \(visibleText())")

    // Read the bar's frame with the screenshot: the bar moves with the keyboard.
    let px = try pixels()
    let barTop = bar.frame.minY
    let frame = run.frame

    // Sample the 12 pt left of the run: balloon padding (no glyphs), where the
    // balloon's edge is straight from 10 pt below the run's top to 10 pt above
    // its bottom.
    let x = frame.minX - 9
    let side = CGRect(x: frame.minX - 12, y: frame.minY + 10, width: 12, height: frame.height - 20)
    guard side.contains(CGPoint(x: x, y: barTop - 26)), side.contains(CGPoint(x: x + 6, y: barTop + 6))
    else {
      return XCTFail(
        "the run \(frame) does not straddle the bar's top edge at \(barTop) by enough "
          + "to hold three rows of fill on its straight side; visible: \(visibleText())")
    }
    let far = px.rowAverage(y: barTop - 26, from: x, to: x + 6)
    let near = px.rowAverage(y: barTop - 16, from: x, to: x + 6)
    let under = px.rowAverage(y: barTop + 6, from: x, to: x + 6)
    XCTAssertTrue(
      near.b > near.r + 40 && near.b > 150,
      "the column \(x) sixteen points above the edge reads \(near), which is not the "
        + "balloon's blue — the run's padding is not where this expects it")
    let farValue = (far.r + far.g + far.b) / 3
    let nearValue = (near.r + near.g + near.b) / 3
    let underValue = (under.r + under.g + under.b) / 3
    print("MEASURE material clear26=\(farValue) clear16=\(nearValue) covered6=\(underValue) x=\(Int(x)) barTop=\(Int(barTop))")

    // The material starts 12 pt above the bar
    // (`EXPKeyboardAccessoryMaterialRise` in EXPKeyboardAccessoryComponentView.mm),
    // so 16 and 26 pt above must match. 3 levels covers sampling noise and the
    // balloon's gradient.
    XCTAssertLessThanOrEqual(
      abs(nearValue - farValue), 3,
      "the balloon reads \(nearValue) sixteen points above the bar's top edge and "
        + "\(farValue) twenty-six points above — the same fill, so the bar's "
        + "material is reaching further above the bar than its twelve-point rise")

    // 6 pt inside the bar the material changes this blue by about 70 levels.
    XCTAssertGreaterThan(
      abs(nearValue - underValue), 6,
      "the balloon reads \(nearValue) sixteen points above the bar's top edge and "
        + "\(underValue) six points below it — the same fill, so the bar is not "
        + "covering what passes beneath it")
  }
}
