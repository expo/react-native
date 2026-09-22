import XCTest

/**
 With the keyboard raised first on the main screen and then in the chat, a held
 and cancelled back-swipe leaves the chat's field focused and raised on the
 keyboard.
 */
// covers: App.js Composer.js
final class StealCheck: DemoCase {
  func testChatComposerKeepsItsKeyboardThroughASwipeAfterMainHadTheKeyboard() throws {
    let mainField = app.textViews.firstMatch
    XCTAssertTrue(appears(mainField, within: 30), "no composer field on the main screen")
    mainField.tap()
    XCTAssertTrue(appears(app.keyboards.element(boundBy: 0), within: 10), "no keyboard on the main screen")
    settled(mainField)

    let row = app.descendants(matching: .any).matching(NSPredicate(format: "label == 'Chat, with a composer'")).firstMatch
    XCTAssertTrue(appears(row, within: 15), "no chat row")
    row.tap()
    XCTAssertTrue(appears(app.staticTexts["Chat"], within: 10), "the chat did not open")
    settled(app.textViews.firstMatch)
    XCTAssertTrue(vanishes(app.keyboards.element(boundBy: 0), within: 5), "the main screen's keyboard should be gone after the push")

    let chatField = app.textViews.firstMatch
    chatField.tap()
    XCTAssertTrue(appears(app.keyboards.element(boundBy: 0), within: 10), "no keyboard in the chat")
    settled(chatField)
    let raised = chatField.frame

    let window = app.windows.element(boundBy: 0)
    let start = window.coordinate(withNormalizedOffset: CGVector(dx: 0.01, dy: 0.35))
    let mid = window.coordinate(withNormalizedOffset: CGVector(dx: 0.30, dy: 0.35))
    start.press(forDuration: 0.1, thenDragTo: mid, withVelocity: .slow, thenHoldForDuration: 2.0)
    settled(chatField)

    XCTAssertTrue(app.staticTexts["Chat"].exists, "the cancelled swipe should have left the chat on screen")
    XCTAssertEqual(app.keyboards.count, 1, "the chat's keyboard should have survived the cancelled swipe")
    let after = app.textViews.firstMatch.frame
    XCTAssertEqual(after.maxY, raised.maxY, accuracy: 1.0,
                   "the chat field should sit where it did on the keys, not docked or floating")
    XCTAssertEqual(after.width, raised.width, accuracy: 1.0,
                   "the chat field should keep its raised width, not the docked one")
  }
}
