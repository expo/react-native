import XCTest

/*
 * The two-finger double-tap dump carries BOTH timelines.
 *
 * The keyboard trace records geometry and the transition engine keeps its own
 * ring; until they were joined, a report of an animation flickering arrived with
 * the geometry and nothing about whether a transition started, was retargeted,
 * or was skipped as non-interpolable. Joining them is only useful if the join
 * actually happens on a phone, and the only way to know is to perform the
 * gesture and read what lands on the pasteboard.
 *
 * This is a test of the INSTRUMENT, not of the app. It is here because the
 * instrument is what the next device report depends on, and an instrument that
 * silently drops half its output is worse than none — the missing half reads as
 * "nothing happened".
 */
final class TraceDumpCheck: DemoCase {
  override class var initialScreen: String? { "chat" }

  func testTheDumpCarriesTheTransitionTimeline() {
    // Something that certainly runs transitions: a send moves the column, closes
    // the previous receipt's row and opens a new one.
    let field = app.textViews.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 30), "composer never appeared")
    field.tap()
    XCTAssertTrue(app.keyboards.element(boundBy: 0).waitForExistence(timeout: 10))
    app.typeText("trace")
    let send = app.buttons["Send"]
    XCTAssertTrue(send.waitForExistence(timeout: 10), "send button never appeared")
    send.tap()
    // Let the send's flight and the receipt handover run.
    Thread.sleep(forTimeInterval: 3)

    // The keyboard covers most of the screen and XCUITest will not compute a
    // gesture point on a fully occluded element, so put it away first — the
    // recogniser is on the window with `cancelsTouchesInView = NO`, so any
    // hittable element carries the gesture to it.
    dismissKeyboard()
    // On a hittable ELEMENT, not the window or the app: XCUITest refuses to
    // compute a gesture point on those ("unable to compute coordinates for
    // gesture after 5 attempts") even though they have a frame.
    let anywhere = app.staticTexts.firstMatch
    XCTAssertTrue(anywhere.waitForExistence(timeout: 10), "nothing on screen to tap")
    anywhere.tap(withNumberOfTaps: 2, numberOfTouches: 2)

    /*
     * The ALERT reports the counts, and the test reads them there.
     *
     * Reading the pasteboard from the test process raises the system's paste
     * prompt, which XCUITest does not dismiss — the run waits for the app to
     * idle and the whole SUITE hangs behind it, which is what happened twice.
     * The app already knows both numbers, so it says them.
     */
    let alert = app.alerts.firstMatch
    XCTAssertTrue(alert.waitForExistence(timeout: 15), "the dump alert never appeared")
    let message = alert.staticTexts.element(boundBy: 1).label
    print("MEASURE dump-alert=\(message)")

    // Plain string work rather than a `Regex`, which needs iOS 16 and this
    // deployment target is lower.
    var count = 0
    if let open = message.range(of: "("),
      let close = message.range(of: " transitions)") {
      let digits = message[open.upperBound..<close.lowerBound]
      count = Int(digits) ?? 0
    }
    XCTAssertGreaterThan(
      count, 0,
      "the dump carries no transition lines after a send, so the engine's timeline is "
        + "not reaching a device report: \(message)")

    alert.buttons["Keep recording"].tap()

    /*
     * And the bar is still there afterwards.
     *
     * Presenting a `UIAlertController` resigns the first responder — and a docked
     * composer IS a first responder, holding the bar as its `inputAccessoryView`.
     * So the diagnostic gesture put the bar away and nothing brought it back:
     * `-_followScreenVisibility` only acts on a CHANGE of screen, and the reclaim
     * watchdog only runs off end-editing notifications, neither of which an alert
     * produces. Reported as "just going to chat and double tapping with two
     * fingers hides the accessory".
     *
     * Asserted here rather than in its own case because the gesture is already
     * being performed; a second test would only repeat the setup.
     */
    let composer = app.textViews.firstMatch
    XCTAssertTrue(
      composer.waitForExistence(timeout: 10),
      "the composer is gone after the dump alert; visible: \(visibleText())")
    XCTAssertTrue(
      isOnScreen(composer),
      "the composer came back off screen after the dump alert")
  }
}