import XCTest

/**
 Two screens, two composers, and a keyboard that must stay with the screen being popped.

 Reported from a phone, 2026-09-10: keyboard up on the main screen, push into the
 chat, keyboard up in the chat, back-swipe held — the chat composer vanished
 behind the keyboard and came back in its docked shape when the swipe was
 cancelled. The main field, resigned by UIKit when the push took its view out of
 the window, had been flagged to become first responder again "when possible",
 and did so the moment its view was back: the start of the pop. A covered screen
 now lets its own field go, so nothing can reclaim the keyboard later; this case
 performs the exact sequence and reads the chat field after the cancelled swipe.
 */
final class StealCheck: DemoCase {
  func testChatComposerKeepsItsKeyboardThroughASwipeAfterMainHadTheKeyboard() throws {
    let mainField = app.textViews.firstMatch
    XCTAssertTrue(mainField.waitForExistence(timeout: 30), "no composer field on the main screen")
    mainField.tap()
    XCTAssertTrue(app.keyboards.element(boundBy: 0).waitForExistence(timeout: 10), "no keyboard on the main screen")
    Thread.sleep(forTimeInterval: 0.8)

    let row = app.descendants(matching: .any).matching(NSPredicate(format: "label == 'Chat, with a composer'")).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 15), "no chat row")
    row.tap()
    XCTAssertTrue(app.staticTexts["Chat"].waitForExistence(timeout: 10), "the chat did not open")
    Thread.sleep(forTimeInterval: 1.2)
    XCTAssertEqual(app.keyboards.count, 0, "the main screen's keyboard should be gone after the push")

    let chatField = app.textViews.firstMatch
    chatField.tap()
    XCTAssertTrue(app.keyboards.element(boundBy: 0).waitForExistence(timeout: 10), "no keyboard in the chat")
    Thread.sleep(forTimeInterval: 1.0)
    let raised = chatField.frame

    let window = app.windows.element(boundBy: 0)
    let start = window.coordinate(withNormalizedOffset: CGVector(dx: 0.01, dy: 0.35))
    let mid = window.coordinate(withNormalizedOffset: CGVector(dx: 0.30, dy: 0.35))
    start.press(forDuration: 0.1, thenDragTo: mid, withVelocity: .slow, thenHoldForDuration: 2.0)
    Thread.sleep(forTimeInterval: 1.5)

    XCTAssertTrue(app.staticTexts["Chat"].exists, "the cancelled swipe should have left the chat on screen")
    XCTAssertEqual(app.keyboards.count, 1, "the chat's keyboard should have survived the cancelled swipe")
    let after = app.textViews.firstMatch.frame
    XCTAssertEqual(after.maxY, raised.maxY, accuracy: 1.0,
                   "the chat field should sit where it did on the keys, not docked or floating")
    XCTAssertEqual(after.width, raised.width, accuracy: 1.0,
                   "the chat field should keep its raised width, not the docked one")
  }
}
