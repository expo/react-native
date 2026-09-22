import XCTest

/**
 With the keyboard up, long-pressing a balloon moves the composer down with the
 keyboard, below the lifted balloon; closing the menu brings the keyboard and
 composer back to where they were.
 */
// covers: Composer.js screens/ChatScreen.js reactions.js
final class PeekAccessoryCheck: DemoCase {
  override class var initialScreen: String? { "chat" }

  func testTheBarStandsDownForAPeekAndComesBack() throws {
    let field = app.textViews.firstMatch
    XCTAssertTrue(appears(field, within: 30), "no composer")
    field.tap()
    XCTAssertTrue(
      appears(app.keyboards.element(boundBy: 0), within: 10), "keyboard never came up")

    let balloon = text("Did the keyboard cover the last message?")
    XCTAssertTrue(appears(balloon, within: 10), "no balloon to hold")

    // The bottom strip shows keys now, and the dimmed transcript while the menu
    // is open.
    let beforeY = field.frame.minY
    let window = app.windows.element(boundBy: 0).frame
    let stripY = window.height - 80
    let before = try pixels().rowAverage(y: stripY, from: 40, to: window.width - 40)

    hold(balloon)

    let copy = app.buttons["Copy"]
    XCTAssertTrue(appears(copy, within: 10), "the platform menu never opened")

    let duringY = field.frame.minY
    XCTAssertGreaterThan(
      duringY, beforeY + 40,
      "the composer did not ride down for the peek: \(beforeY) -> \(duringY)")
    print("MEASURE composer before=\(beforeY) during=\(duringY)")

    // Saved for checking the z-order by eye.
    let shot = XCUIScreen.main.screenshot()
    try? shot.pngRepresentation.write(to: URL(fileURLWithPath: "/tmp/rcpt/peek_guide.png"))

    let during = try pixels().rowAverage(y: stripY, from: 40, to: window.width - 40)
    let moved = distance(before, during)
    print("MEASURE bottom-strip before=\(before) during=\(during) distance=\(moved)")
    XCTAssertGreaterThan(
      moved, 12,
      "the bottom of the screen is unchanged through the peek — the keyboard window is still "
        + "painted over the menu, which is the snapshot behaviour this replaced")

    let dismiss = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.08))
    dismiss.tap()
    XCTAssertTrue(
      appears(field, within: 10), "the composer never came back after the peek")
    XCTAssertTrue(isOnScreen(field), "the composer came back but is off screen")

    // UIKit raises the keyboard again when the menu closes, unless something
    // resigned the field while it was open.
    XCTAssertTrue(
      appears(app.keyboards.element(boundBy: 0), within: 10),
      "the keyboard did not come back after the peek")
    var afterY = field.frame.minY
    let deadline = Date().addingTimeInterval(3)
    while abs(afterY - beforeY) > 2, Date() < deadline {
      afterY = field.frame.minY
    }
    XCTAssertEqual(
      afterY, beforeY, accuracy: 2,
      "the composer came back but not to where the keyboard had it: \(beforeY) -> \(afterY)")
  }
}
