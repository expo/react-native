import XCTest

/**
 The reported vanishing keyboard: a back-swipe HELD mid-drag, with the keyboard
 UP, and then completed.

 Reported repeatedly from a device and never reproduced here. Every capture the
 user sent had the same shape and they were explicit about it — "I was mid-drag
 when the keyboard disappeared. Then I completed the navigation back to the main
 screen", and afterwards "I am *always* mid-drag in this keyboard test".

 **What was missing, and why nine `idb` attempts found nothing.** `idb ui swipe`
 always completes: it draws a straight line and lifts, so a finger that is DOWN
 and STILL partway through an interactive pop is a state it cannot express. The
 suite's own back-swipe case (`FlowDrive.testCancelledSwipeKeyboardDownKeepsThisScreensBar`)
 does hold mid-drag, but it dismisses the keyboard first — the name says so.
 Nothing covered the combination the reports describe: keyboard up, finger held
 partway, then the pop committed.

 **What this can and cannot see.** `press(…thenHoldForDuration:)` BLOCKS until the
 finger lifts, and XCUITest refuses to synthesise events from any thread but the
 main one, so nothing can be asserted DURING the hold — the same limit written up
 in `ReactionCheck`. What can be done is check the state the reports describe
 AFTER it: the user's complaint is not only that the keyboard went, it is that
 tapping the main screen's composer afterwards would not bring it back. That is
 observable, and it is what the last assertion here is.

 The app narrates itself through the hold regardless: `EXP_KEYBOARD_TRACE_ECHO`
 is on for every case in this suite, so a run of this test carries the per-frame
 geometry through the drag in the system log —

     log stream --predicate 'subsystem == "dev.expo.keyboard"'

 — which is the only view inside the window where the finger is still down.
 */
final class VanishingKeyboardCheck: DemoCase {
  override class var initialScreen: String? { "chat" }

  func testKeyboardUpBackSwipeHeldMidDragThenCommitted() throws {
    let field = app.textViews.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 30), "no composer field")
    field.tap()
    XCTAssertTrue(
      app.keyboards.element(boundBy: 0).waitForExistence(timeout: 10),
      "the keyboard never came up, so the reported sequence cannot start")

    /*
     * A marker, for the same reason `FlowDrive` uses one: after the pop the only
     * way to tell the home screen's composer from the chat's is its contents.
     * Typed with the keyboard already up and deliberately NOT dismissed —
     * dismissing it is the difference between that test and this one.
     */
    app.typeText("CHATBAR")

    let window = app.windows.element(boundBy: 0)
    let start = window.coordinate(withNormalizedOffset: CGVector(dx: 0.01, dy: 0.35))
    let past = window.coordinate(withNormalizedOffset: CGVector(dx: 0.62, dy: 0.35))

    /*
     * SLOW, and held well past the point the transition is interactive, so the
     * finger is stationary mid-pop for over a second — the state the reports
     * describe. Released beyond the commit threshold so the pop then finishes,
     * which is the second half of "then I completed the navigation back".
     */
    start.press(forDuration: 0.1, thenDragTo: past, withVelocity: .slow, thenHoldForDuration: 1.3)
    Thread.sleep(forTimeInterval: 1.5)

    /*
     * The pop must have COMMITTED. A swipe that sprang back is the case
     * `FlowDrive` already covers, and asserting the rest against it would pass
     * for the wrong reason.
     */
    XCTAssertTrue(
      app.staticTexts["Safe areas"].waitForExistence(timeout: 10),
      "the back-swipe did not commit, so this is not the reported sequence; "
        + "visible: \(visibleText())")

    // Reported, not asserted: whether the keyboard survived the pop at all is
    // the user's first sentence, but the native chat lets it go here too, so
    // it is recorded rather than failed on.
    print("MEASURE keyboards after the committed pop = \(app.keyboards.count)")

    let home = app.textViews.firstMatch
    XCTAssertTrue(home.waitForExistence(timeout: 10), "no composer on the main screen")
    let contents = (home.value as? String) ?? ""
    XCTAssertFalse(
      contents.contains("CHATBAR"),
      "the composer on screen is still the CHAT's after a committed pop — this test "
        + "is looking at the wrong bar, so its result would mean nothing")

    /*
     * THE REPORTED FAILURE. "Keyboard disappeared on tap": the keyboard going
     * down during a transition is one thing, a field that will no longer raise
     * one is the bug.
     */
    home.tap()
    XCTAssertTrue(
      app.keyboards.element(boundBy: 0).waitForExistence(timeout: 10),
      "REPRODUCED: after a keyboard-up back-swipe held mid-drag and then committed, "
        + "tapping the main screen's composer does not raise the keyboard; "
        + "visible: \(visibleText())")
  }

  /**
   The same held mid-drag pop, but with the HOME composer focused first.

   A second condition worth separating, because the device reports came with
   "I typed text into each accessory to be able to tell the difference" — so both
   fields had been first responder by the time the swipe happened, and the trace
   the user sent caught a field leaving the window while it still held the
   keyboard. One screen's field having been focused earlier is state the first
   case never creates.
   */
  func testBothComposersFocusedThenHeldMidDragPop() throws {
    // Start on the home screen instead, so its composer can be focused first.
    app.terminate()
    app.launchEnvironment["EXP_OPEN_SCREEN"] = "insets"
    app.launch()

    let home = app.textViews.firstMatch
    XCTAssertTrue(home.waitForExistence(timeout: 30), "no composer on the main screen")
    home.tap()
    XCTAssertTrue(
      app.keyboards.element(boundBy: 0).waitForExistence(timeout: 10),
      "the main screen's composer never raised a keyboard to begin with")
    app.typeText("HOMEBAR")
    dismissKeyboard()

    // The home screen's own row, by its accessible name — it is an `<a>`, whose
    // name comes from its contents, so it is neither a `+` command nor a plain
    // static text.
    let row = app.descendants(matching: .any)
      .matching(NSPredicate(format: "label == 'Chat, with a composer'")).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 15), "no chat row; visible: \(visibleText())")
    row.tap()
    XCTAssertTrue(
      app.staticTexts["Chat"].waitForExistence(timeout: 15),
      "never reached the chat screen; visible: \(visibleText())")

    let chat = app.textViews.firstMatch
    XCTAssertTrue(chat.waitForExistence(timeout: 15), "no composer on the chat screen")
    chat.tap()
    XCTAssertTrue(
      app.keyboards.element(boundBy: 0).waitForExistence(timeout: 10),
      "the chat composer never raised a keyboard")
    app.typeText("CHATBAR")

    let window = app.windows.element(boundBy: 0)
    let start = window.coordinate(withNormalizedOffset: CGVector(dx: 0.01, dy: 0.35))
    let past = window.coordinate(withNormalizedOffset: CGVector(dx: 0.62, dy: 0.35))
    start.press(forDuration: 0.1, thenDragTo: past, withVelocity: .slow, thenHoldForDuration: 1.3)
    Thread.sleep(forTimeInterval: 1.5)

    XCTAssertTrue(
      app.staticTexts["Safe areas"].waitForExistence(timeout: 10),
      "the back-swipe did not commit, so this is not the reported sequence; "
        + "visible: \(visibleText())")

    let back = app.textViews.firstMatch
    XCTAssertTrue(back.waitForExistence(timeout: 10), "no composer after the pop")
    let contents = (back.value as? String) ?? ""
    XCTAssertTrue(
      contents.contains("HOMEBAR"),
      "the bar after the pop is not the main screen's own — its contents are "
        + "\"\(contents)\", so this result would mean nothing")

    back.tap()
    XCTAssertTrue(
      app.keyboards.element(boundBy: 0).waitForExistence(timeout: 10),
      "REPRODUCED: with both composers previously focused, tapping the main screen's "
        + "composer after a held mid-drag pop does not raise the keyboard; "
        + "visible: \(visibleText())")
  }
}
