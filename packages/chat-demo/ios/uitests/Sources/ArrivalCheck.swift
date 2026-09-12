import XCTest

/**
 A long conversation must not move after the push into it has settled.

 Reported from a phone, 2026-09-10: with enough messages to fill the transcript,
 navigating from the main screen into the chat left the transcript where it
 landed and then, half a second later, moved it up by the composer's height.
 The trace showed the scroll view's bottom inset stepping from the safe area to
 the bar's height after the transition — the keyboard-insets sampler, which
 counts a docked bar into the obstruction, runs only while something moves and
 is woken by keyboard notifications; a screen appearing with its bar posts none.
 The bar now wakes it when it is hosted. This case reads the lowest visible
 message just after the push and again once everything has had time to settle.
 */
final class ArrivalCheck: DemoCase {
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

  func testTheTranscriptStaysPutAfterThePushSettles() throws {
    app.launchEnvironment["EXP_SEED_MESSAGES"] = "203"
    app.terminate()
    app.launch()
    let row = app.descendants(matching: .any).matching(NSPredicate(format: "label == 'Chat, with a composer'")).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 30), "no chat row on the main screen")
    row.tap()
    XCTAssertTrue(app.staticTexts["Chat"].waitForExistence(timeout: 10), "the chat did not open")
    // The push animation is 0.35 s; the reported step came about half a second
    // after arrival, so the first reading is taken right after the slide ends.
    Thread.sleep(forTimeInterval: 0.45)
    let field = app.textViews.firstMatch
    XCTAssertTrue(field.exists, "no composer field in the chat")
    let composerTop = field.frame.minY - 20
    let early = lowestMessageBottom(above: composerTop)
    XCTAssertGreaterThan(early, 0, "no balloon found above the composer")
    Thread.sleep(forTimeInterval: 1.5)
    let late = lowestMessageBottom(above: composerTop)
    XCTAssertEqual(late, early, accuracy: 1.0,
                   "the lowest message moved from \(early) to \(late) after the push had settled")
  }
}
