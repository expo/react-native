import XCTest

/**
 A composer that grows pushes the transcript up with it, and one that shrinks
 after a send leaves no gap.

 Reported from a phone, 2026-09-10: scrolled to the bottom of a long chat, typing
 a second and third line grew the composer but the transcript did not move, so
 the last message went under the bar. Same cause as `ArrivalCheck`: the bar's
 height changes in the screen with no keyboard event, and the sampler that turns
 the bar into the transcript's bottom inset was only woken by keyboard events.
 The bar now wakes it on every height change. This case grows the composer and
 reads the lowest message before and after; then sends, and checks the gap under
 the last message is no larger than it was.
 */
final class GrowthCheck: DemoCase {
  override class var initialScreen: String? { "chat" }

  /**
   The bottom edge of the lowest balloon still above `limit`, in window points.

   The transcript's balloons are `otherElements` labelled "Message N, …", not
   `staticTexts`: a seeded chat exposes three static texts, and the lowest one
   above the composer is the navigation title, which never moves. Measuring
   those made this check unable to fail.
   */
  private func lowestMessageBottom(above limit: CGFloat) -> CGFloat {
    let balloons = app.otherElements.matching(NSPredicate(format: "label BEGINSWITH 'Message '"))
    var lowest: CGFloat = 0
    for balloon in balloons.allElementsBoundByIndex {
      let frame = balloon.frame
      if frame.height > 0 && frame.maxY <= limit + 0.5 && frame.maxY > lowest {
        lowest = frame.maxY
      }
    }
    return lowest
  }

  func testAGrowingComposerPushesTheTranscriptUpAndASendLeavesNoGap() throws {
    app.launchEnvironment["EXP_SEED_MESSAGES"] = "203"
    app.terminate()
    app.launch()
    XCTAssertTrue(app.staticTexts["Chat"].waitForExistence(timeout: 30), "the seeded chat never rendered")
    let field = app.textViews.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 15), "no composer field")
    field.tap()
    XCTAssertTrue(app.keyboards.element(boundBy: 0).waitForExistence(timeout: 10), "no keyboard")
    Thread.sleep(forTimeInterval: 1.5)

    let topBefore = field.frame.minY
    let lowestBefore = lowestMessageBottom(above: topBefore - 4)
    XCTAssertGreaterThan(lowestBefore, 0, "no balloon found above the composer")
    let gapBefore = topBefore - lowestBefore

    // The text begins "Message " so the sent balloon carries a label this
    // check can find: the transcript labels a balloon by its own text, and a
    // helper that matched only the seeded "Message N" balloons would measure
    // the one ABOVE the send and read its height as a gap.
    app.typeText("Message from the growth check, one two three four five six seven "
      + "eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen")
    Thread.sleep(forTimeInterval: 1.5)
    let topGrown = field.frame.minY
    let growth = topBefore - topGrown
    XCTAssertGreaterThan(growth, 15, "the composer did not grow: top \(topBefore) -> \(topGrown)")
    let lowestGrown = lowestMessageBottom(above: topGrown - 4)
    XCTAssertEqual(
      lowestBefore - lowestGrown, growth, accuracy: 4.0,
      "the composer grew by \(growth) but the lowest message moved by \(lowestBefore - lowestGrown)")

    let send = app.buttons["Send"]
    XCTAssertTrue(send.waitForExistence(timeout: 5), "no send button with a draft")
    send.tap()
    Thread.sleep(forTimeInterval: 2.5)
    let topSent = field.frame.minY
    XCTAssertEqual(topSent, topBefore, accuracy: 2.0, "the composer did not return to one line after the send")
    let lowestSent = lowestMessageBottom(above: topSent - 4)
    let gapSent = topSent - lowestSent
    XCTAssertLessThanOrEqual(
      gapSent, gapBefore + 6,
      "after the send the gap under the last message is \(gapSent), it was \(gapBefore) before")
  }
}
