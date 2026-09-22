import XCTest


/// testBothComposersFocusedThenHeldMidDragPop on its own launch, so its seed is the launch's and there is no second one.
// covers: App.js Composer.js
final class VanishingBothComposersCheck: DemoCase {
  override class var initialScreen: String? { nil }

  /// The same, with the home screen's composer focused first, so both fields
  /// have been first responder before the swipe.
  func testBothComposersFocusedThenHeldMidDragPop() throws {

    let home = app.textViews.firstMatch
    XCTAssertTrue(appears(home, within: 30), "no composer on the main screen")
    home.tap()
    XCTAssertTrue(
      appears(app.keyboards.element(boundBy: 0), within: 10),
      "the main screen's composer never raised a keyboard to begin with")
    type("HOMEBAR")
    dismissKeyboard()

    let row = app.descendants(matching: .any)
      .matching(NSPredicate(format: "label == 'Chat, with a composer'")).firstMatch
    XCTAssertTrue(appears(row, within: 15), "no chat row; visible: \(visibleText())")
    row.tap()
    XCTAssertTrue(
      appears(app.staticTexts["Chat"], within: 15),
      "never reached the chat screen; visible: \(visibleText())")

    let chat = app.textViews.firstMatch
    XCTAssertTrue(appears(chat, within: 15), "no composer on the chat screen")
    chat.tap()
    XCTAssertTrue(
      appears(app.keyboards.element(boundBy: 0), within: 10),
      "the chat composer never raised a keyboard")
    type("CHATBAR")

    let window = app.windows.element(boundBy: 0)
    let start = window.coordinate(withNormalizedOffset: CGVector(dx: 0.01, dy: 0.35))
    let past = window.coordinate(withNormalizedOffset: CGVector(dx: 0.62, dy: 0.35))
    start.press(forDuration: 0.1, thenDragTo: past, withVelocity: .slow, thenHoldForDuration: 1.3)
    settled(app.textViews.firstMatch)

    XCTAssertTrue(
      appears(app.staticTexts["Safe areas"], within: 10),
      "the back-swipe did not commit, so this is not the reported sequence; "
        + "visible: \(visibleText())")

    let back = app.textViews.firstMatch
    XCTAssertTrue(appears(back, within: 10), "no composer after the pop")
    let contents = (back.value as? String) ?? ""
    XCTAssertTrue(
      contents.contains("HOMEBAR"),
      "the bar after the pop is not the main screen's own — its contents are "
        + "\"\(contents)\", so this result would mean nothing")

    back.tap()
    XCTAssertTrue(
      appears(app.keyboards.element(boundBy: 0), within: 10),
      "REPRODUCED: with both composers previously focused, tapping the main screen's "
        + "composer after a held mid-drag pop does not raise the keyboard; "
        + "visible: \(visibleText())")
  }
}
