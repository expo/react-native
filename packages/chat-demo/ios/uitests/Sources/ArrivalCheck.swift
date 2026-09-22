import XCTest

/**
 After a push into a long chat, the transcript doesn't move once the push
 animation has ended. (No keyboard notification fires on a push, so the hosted
 bar itself must update the transcript's bottom inset.)
 */
// covers: screens/ChatScreen.js App.js
final class ArrivalCheck: DemoCase {
  override class var seedMessages: Int? { 203 }

  func testTheTranscriptStaysPutAfterThePushSettles() throws {
    let row = app.descendants(matching: .any).matching(NSPredicate(format: "label == 'Chat, with a composer'")).firstMatch
    XCTAssertTrue(appears(row, within: 30), "no chat row on the main screen")
    row.tap()
    XCTAssertTrue(appears(app.staticTexts["Chat"], within: 10), "the chat did not open")
    // Right after the 0.35 s push animation, before a late inset change would
    // move the transcript (about 0.5 s after arrival).
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
