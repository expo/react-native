import XCTest

/**
 A screen must never show a composer docked to a keyboard that is not there.

 Reported from a phone, 2026-09-10: keyboard up on the main screen, push into
 the chat, keyboard up in the chat, tap Back — the main screen came back with
 its composer floating in the middle of the screen and no keyboard under it.

 The first version of this case asserted the main screen comes back with NO
 keyboard, which was an assumption about what the platform ought to do. It does
 the opposite, deliberately: UIKit resigns the field as the push pins the input
 views and flags it to become first responder again when its view returns, so a
 completed pop restores the keyboard to the screen that had it. Measured on the
 simulator — `app.keyboards.count == 1`, the sampler reading 335, the bar docked
 at 482.

 So the invariant is not "no keyboard", it is that the composer and the keys
 agree. Docked with keys: the field sits just above them. No keys: the field
 sits on the bottom edge. The reported bug is the third case, which neither
 asserts on its own.
 */
final class ReturnCheck: DemoCase {
  func testMainComesBackWithItsComposerAgreeingWithTheKeyboard() throws {
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

    let chatField = app.textViews.firstMatch
    chatField.tap()
    XCTAssertTrue(app.keyboards.element(boundBy: 0).waitForExistence(timeout: 10), "no keyboard in the chat")
    Thread.sleep(forTimeInterval: 1.0)

    app.buttons["BackButton"].tap()
    XCTAssertTrue(row.waitForExistence(timeout: 10), "never got back to the main screen")
    Thread.sleep(forTimeInterval: 1.5)

    let window = app.windows.element(boundBy: 0).frame
    let field = app.textViews.firstMatch.frame
    let fromBottom = window.maxY - field.maxY

    if app.keyboards.count == 0 {
      // The bar is ~68 tall including the home indicator's strip, and the field
      // sits inside it. Anything further up is a bar docked to nothing.
      XCTAssertLessThan(fromBottom, 120,
                        "no keyboard, but the composer sits \(fromBottom) points above the bottom — docked to a keyboard that is not there")
    } else {
      // On the keys: the field's bottom must be within a bar's height of the
      // keyboard's top, not hundreds of points adrift.
      let keys = app.keyboards.element(boundBy: 0).frame
      let gap = keys.minY - field.maxY
      XCTAssertGreaterThan(gap, -2, "the composer overlaps the keyboard by \(-gap) points")
      XCTAssertLessThan(gap, 120, "the composer sits \(gap) points above the keyboard it is docked to")
    }
  }
}
