import XCTest

/**
 A chat that has a draft opens with its keyboard up and the draft in the field,
 whether or not the main screen's keyboard was up. `StealCheck` covers a chat
 without a draft.
 */
// covers: Composer.js App.js screens/ChatScreen.js
final class DraftCheck: DemoCase {
  private let row = "Chat, with a composer"

  /// Type a draft into the chat, then come back to the main screen.
  private func leaveADraft() {
    text(row).tap()
    XCTAssertTrue(appears(app.staticTexts["Chat"], within: 10), "the chat did not open")
    let chatField = app.textViews.firstMatch
    XCTAssertTrue(appears(chatField, within: 10), "no composer field in the chat")
    chatField.tap()
    XCTAssertTrue(appears(app.keyboards.element(boundBy: 0), within: 10), "no keyboard in the chat")
    chatField.typeText("Later")
    settled(chatField)
    app.buttons["BackButton"].tap()
    XCTAssertTrue(appears(app.staticTexts["Safe areas"], within: 10), "main did not come back")
    settled(app.textViews.firstMatch)
  }

  /// Asserts the chat is open with its keyboard up, and its field on the keys
  /// still holding the draft.
  private func assertChatOpenedFocused(file: StaticString = #filePath, line: UInt = #line) {
    XCTAssertTrue(appears(app.staticTexts["Chat"], within: 10), "the chat did not open", file: file, line: line)
    XCTAssertTrue(
      appears(app.keyboards.element(boundBy: 0), within: 5),
      "a conversation with a draft should open with its keyboard", file: file, line: line)
    settled(app.textViews.firstMatch, file: file, line: line)
    let field = app.textViews.firstMatch
    let keys = app.keyboards.element(boundBy: 0).frame
    let gap = keys.minY - field.frame.maxY
    XCTAssertGreaterThan(gap, -2, "the chat field is under the keys", file: file, line: line)
    XCTAssertLessThan(gap, 120, "the chat field is not docked on the keys", file: file, line: line)
    XCTAssertEqual(field.value as? String, "Later", "the draft did not survive the visit", file: file, line: line)
  }

  func testADraftTakesTheKeyboardFromMainWithoutDismissingIt() throws {
    XCTAssertTrue(appears(text(row), within: 15), "no chat row")
    leaveADraft()

    let mainField = app.textViews.firstMatch
    mainField.tap()
    XCTAssertTrue(appears(app.keyboards.element(boundBy: 0), within: 10), "no keyboard on the main screen")
    settled(mainField)

    text(row).tap()
    assertChatOpenedFocused()
  }

  func testADraftRaisesTheKeyboardOverAQuietMain() throws {
    XCTAssertTrue(appears(text(row), within: 15), "no chat row")
    leaveADraft()
    dismissKeyboard()

    text(row).tap()
    assertChatOpenedFocused()
  }

  /**
   A send with trailing spaces leaves the field empty. The field shows the
   trimmed message until the balloon appears (`handoff` in Composer.js), so
   this send writes to the text view twice: the trimmed text, then "".
   */
  func testASendWithTrimmableTextLeavesTheFieldEmpty() throws {
    text(row).tap()
    let field = app.textViews.firstMatch
    XCTAssertTrue(appears(field, within: 15), "no composer field")
    field.tap()
    XCTAssertTrue(appears(app.keyboards.element(boundBy: 0), within: 10))

    type("Trim me   ")
    let send = app.buttons["Send"]
    XCTAssertTrue(appears(send, within: 8), "no send button with a draft")
    send.tap()

    // Wait for the balloon: until then the field still shows the message.
    XCTAssertTrue(
      appears(
        app.descendants(matching: .any)
          .matching(NSPredicate(format: "label == 'Trim me'"))
          .firstMatch,
        within: 10),
      "the message never arrived")
    Thread.sleep(forTimeInterval: 2.0)

    let held = (field.value as? String) ?? ""
    XCTAssertTrue(
      held.isEmpty || held == "Message",
      "the field still holds \"\(held)\" after sending it")
  }
}
