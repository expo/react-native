import XCTest

/**
 The composer stands down for a peek, and comes back after it.

 A docked bar is held up by a first responder of its own, so unlike an ordinary
 accessory it does not go down when a context menu presents — it has no field to
 resign. It then draws above the lifted balloon, because it lives in the
 keyboard's window and nothing the app owns can be put above that: an overlay at
 `windowLevel = 100000000` still composites behind. So "the bar stays and the
 balloon lifts above it" is not available at any price, and the bar going down is
 what the platform does once nothing is propping it up.

 Driven with `press(forDuration:)` rather than `idb`: a context menu's hold is a
 continuously tracked gesture and `idb ui tap --duration` does not deliver one.
 Three attempts through `idb` produced no menu at all, which says nothing about
 the app — see the gesture-harness notes.
 */
final class PeekAccessoryCheck: DemoCase {
  override class var initialScreen: String? { "chat" }

  func testTheBarStandsDownForAPeekAndComesBack() throws {
    let field = app.textViews.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 30), "no composer")
    field.tap()
    XCTAssertTrue(
      app.keyboards.element(boundBy: 0).waitForExistence(timeout: 10), "keyboard never came up")

    let balloon = text("Did the keyboard cover the last message?")
    XCTAssertTrue(balloon.waitForExistence(timeout: 10), "no balloon to hold")

    /*
     * The bottom strip BEFORE the hold: what the peek must do to the bottom of
     * the screen is visible in pixels and not in the accessibility tree, where a
     * bar that rides down and a bar that is torn out read the same. With the
     * keyboard up the strip is keys; through the peek it is the dimmed
     * transcript, so it must CHANGE.
     */
    let beforeY = field.frame.minY
    let window = app.windows.element(boundBy: 0).frame
    let stripY = window.height - 80
    let before = try pixels().rowAverage(y: stripY, from: 40, to: window.width - 40)

    /*
     * Through a COORDINATE: a balloon's text is painted by its box rather than
     * mounted as a view, so `press(forDuration:)` on the element refuses with
     * "Not hittable". Same reason as `ReactionCheck.hold`.
     */
    balloon.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
      .press(forDuration: 0.9)

    /*
     * FIRST that the peek actually happened. Asserting the bar is gone without
     * this passes for a hold that never opened a menu, which is the vacuous
     * shape this suite has been bitten by.
     */
    let copy = app.buttons["Copy"]
    XCTAssertTrue(copy.waitForExistence(timeout: 10), "the platform menu never opened")

    /*
     * The composer RIDES DOWN, it does not disappear.
     *
     * With the bar hosted by the input system, standing down meant the accessory
     * being torn out — the assertion here was that it left the screen. Hosted on
     * the screen by the keyboard layout guide it cannot leave: it is an ordinary
     * subview, and what "going down" means is that it follows the keyboard to the
     * docked position. That is the behaviour that was asked for — "the accessory
     * should go down when a bubble is popped out, and the bubble should have a
     * higher z index" — and being an ordinary subview is also what puts the
     * lifted balloon above it.
     */
    let duringY = field.frame.minY
    XCTAssertGreaterThan(
      duringY, beforeY + 40,
      "the composer did not ride down for the peek: \(beforeY) -> \(duringY)")
    print("MEASURE composer before=\(beforeY) during=\(duringY)")

    // A frame of the held peek, so the z-order can be looked at rather than argued about.
    let shot = XCUIScreen.main.screenshot()
    try? shot.pngRepresentation.write(to: URL(fileURLWithPath: "/tmp/rcpt/peek_guide.png"))

    let during = try pixels().rowAverage(y: stripY, from: 40, to: window.width - 40)
    let moved = distance(before, during)
    print("MEASURE bottom-strip before=\(before) during=\(during) distance=\(moved)")
    XCTAssertGreaterThan(
      moved, 12,
      "the bottom of the screen is unchanged through the peek — the keyboard window is still "
        + "painted over the menu, which is the snapshot behaviour this replaced")

    // And back when the menu goes: dismissing leaves the screen as it was.
    let dismiss = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.08))
    dismiss.tap()
    XCTAssertTrue(
      field.waitForExistence(timeout: 10), "the composer never came back after the peek")
    XCTAssertTrue(isOnScreen(field), "the composer came back but is off screen")

    /*
     * And the keyboard with it, which is UIKit's doing and not ours: presenting
     * the menu takes it down and dismissing it brings it back, in step with the
     * menu's own animation. What this holds is that nothing in the peek gets in
     * the way of that — resigning the field for the lift, as this once did,
     * leaves a keyboard the app has to raise by hand after the balloon lands.
     */
    XCTAssertTrue(
      app.keyboards.element(boundBy: 0).waitForExistence(timeout: 10),
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
