import XCTest

/**
 After Back from the chat (keyboard up on both screens), the main screen's
 composer matches its keyboard: just above the keys if UIKit restored the
 keyboard, near the bottom edge if not.
 */
// covers: App.js Composer.js
final class ReturnCheck: DemoCase {
  func testMainComesBackWithItsComposerAgreeingWithTheKeyboard() throws {
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

    let chatField = app.textViews.firstMatch
    chatField.tap()
    XCTAssertTrue(appears(app.keyboards.element(boundBy: 0), within: 10), "no keyboard in the chat")
    settled(chatField)

    app.buttons["BackButton"].tap()
    XCTAssertTrue(appears(row, within: 10), "never got back to the main screen")
    settled(app.textViews.firstMatch)

    let window = app.windows.element(boundBy: 0).frame
    let field = app.textViews.firstMatch.frame
    let fromBottom = window.maxY - field.maxY

    if app.keyboards.count == 0 {
      // The docked bar is about 68 pt tall, home-indicator strip included.
      XCTAssertLessThan(fromBottom, 120,
                        "no keyboard, but the composer sits \(fromBottom) points above the bottom — docked to a keyboard that is not there")
    } else {
      let keys = app.keyboards.element(boundBy: 0).frame
      let gap = keys.minY - field.maxY
      XCTAssertGreaterThan(gap, -2, "the composer overlaps the keyboard by \(-gap) points")
      XCTAssertLessThan(gap, 120, "the composer sits \(gap) points above the keyboard it is docked to")
    }
  }
}
