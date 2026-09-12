import XCTest

/**
 A conversation with a draft opens ready to finish it; an empty one opens quiet.

 The chat's composer asks for the keyboard as it enters the window only when it
 has text. Pushed over a main screen whose keyboard is up, the covered screen
 reads that and hands the keyboard over instead of dismissing it, so the keys
 never leave; pushed over a quiet main screen the keyboard rises with the push.
 `StealCheck` covers the empty composer: the keyboard is gone after the push.
 */
final class DraftCheck: DemoCase {
  private let row = "Chat, with a composer"

  /// Type a draft into the chat, then come back to the main screen.
  private func leaveADraft() {
    text(row).tap()
    XCTAssertTrue(app.staticTexts["Chat"].waitForExistence(timeout: 10), "the chat did not open")
    let chatField = app.textViews.firstMatch
    XCTAssertTrue(chatField.waitForExistence(timeout: 10), "no composer field in the chat")
    chatField.tap()
    XCTAssertTrue(app.keyboards.element(boundBy: 0).waitForExistence(timeout: 10), "no keyboard in the chat")
    chatField.typeText("Later")
    Thread.sleep(forTimeInterval: 0.5)
    app.buttons["BackButton"].tap()
    XCTAssertTrue(app.staticTexts["Safe areas"].waitForExistence(timeout: 10), "main did not come back")
    Thread.sleep(forTimeInterval: 1.0)
  }

  /// The chat is up, its keyboard is up, and its field sits on the keys holding the draft.
  private func assertChatOpenedFocused(file: StaticString = #filePath, line: UInt = #line) {
    XCTAssertTrue(app.staticTexts["Chat"].waitForExistence(timeout: 10), "the chat did not open", file: file, line: line)
    Thread.sleep(forTimeInterval: 1.2)
    XCTAssertEqual(app.keyboards.count, 1, "a conversation with a draft should open with its keyboard", file: file, line: line)
    let field = app.textViews.firstMatch
    let keys = app.keyboards.element(boundBy: 0).frame
    let gap = keys.minY - field.frame.maxY
    XCTAssertGreaterThan(gap, -2, "the chat field is under the keys", file: file, line: line)
    XCTAssertLessThan(gap, 120, "the chat field is not docked on the keys", file: file, line: line)
    XCTAssertEqual(field.value as? String, "Later", "the draft did not survive the visit", file: file, line: line)
  }

  func testADraftTakesTheKeyboardFromMainWithoutDismissingIt() throws {
    XCTAssertTrue(text(row).waitForExistence(timeout: 15), "no chat row")
    leaveADraft()

    let mainField = app.textViews.firstMatch
    mainField.tap()
    XCTAssertTrue(app.keyboards.element(boundBy: 0).waitForExistence(timeout: 10), "no keyboard on the main screen")
    Thread.sleep(forTimeInterval: 0.8)

    text(row).tap()
    assertChatOpenedFocused()
  }

  func testADraftRaisesTheKeyboardOverAQuietMain() throws {
    XCTAssertTrue(text(row).waitForExistence(timeout: 15), "no chat row")
    leaveADraft()
    dismissKeyboard()

    text(row).tap()
    assertChatOpenedFocused()
  }
}
