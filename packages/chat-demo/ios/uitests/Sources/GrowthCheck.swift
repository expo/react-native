import XCTest

/**
 When the composer grows, the transcript moves up by the same amount; after a
 send shrinks it back, the gap under the last message is no larger than before.
 */
// covers: Composer.js screens/ChatScreen.js
final class GrowthCheck: DemoCase {
  override class var initialScreen: String? { "chat" }
  override class var seedMessages: Int? { 203 }

  func testAGrowingComposerPushesTheTranscriptUpAndASendLeavesNoGap() throws {
    XCTAssertTrue(appears(app.staticTexts["Chat"], within: 30), "the seeded chat never rendered")
    let field = app.textViews.firstMatch
    XCTAssertTrue(appears(field, within: 15), "no composer field")
    field.tap()
    XCTAssertTrue(appears(app.keyboards.element(boundBy: 0), within: 10), "no keyboard")

    let topBefore = settled(field).minY
    let lowestBefore = lowestMessageBottom(above: topBefore - 4)
    XCTAssertGreaterThan(lowestBefore, 0, "no balloon found above the composer")
    let gapBefore = topBefore - lowestBefore

    // Starts with "Message " so `lowestMessageBottom` finds the sent balloon.
    type("Message from the growth check, one two three four five six seven "
      + "eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen")
    let topGrown = settled(field).minY
    let growth = topBefore - topGrown
    XCTAssertGreaterThan(growth, 15, "the composer did not grow: top \(topBefore) -> \(topGrown)")
    let lowestGrown = lowestMessageBottom(above: topGrown - 4)
    XCTAssertEqual(
      lowestBefore - lowestGrown, growth, accuracy: 4.0,
      "the composer grew by \(growth) but the lowest message moved by \(lowestBefore - lowestGrown)")

    let send = app.buttons["Send"]
    XCTAssertTrue(appears(send, within: 5), "no send button with a draft")
    send.tap()
    // The field shrinks back over the send's flight
    XCTAssertTrue(waitUntil(8) { abs(field.frame.minY - topBefore) < 2 }, "the composer never returned to one line")
    let topSent = settled(field).minY
    XCTAssertEqual(topSent, topBefore, accuracy: 2.0, "the composer did not return to one line after the send")
    let lowestSent = lowestMessageBottom(above: topSent - 4)
    let gapSent = topSent - lowestSent
    XCTAssertLessThanOrEqual(
      gapSent, gapBefore + 6,
      "after the send the gap under the last message is \(gapSent), it was \(gapBefore) before")
  }
}
