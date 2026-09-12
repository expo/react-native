/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 A sent message leaves the COMPOSER, at the composer's own width, and dips
 below its resting size before settling into it.

 The send used to start the balloon's surface at 78% of its own resting width
 and grow it. It looked plausible and it was wrong: recorded frame by frame,
 the native balloon is born as the FIELD — the pill's full width, at the pill's
 frame, with the message in it — and squashes past the balloon's width as it
 rises before springing back. Reported as "the bubbles don't swoop in from the
 text in the text area". The 78% was the TROUGH of that squash, read off a
 recording where the frames before it were hidden behind the composer.

 **The app reports its own numbers, and that is not laziness.** Three ways of
 measuring this from outside were tried and all three are blind:

 - `XCUIElement.tap()` returns when the app is next IDLE, which for a send is
   after the balloon has landed. Every sample taken after the tap is of a
   settled screen: measured a widest-ever width of 46.0 points against a resting
   46.0, through an animation that starts above 280.
 - Screenshots taken from another thread while the tap runs do not help. The
   automation session is serialised, so they queue behind it and arrive late —
   the widest that version saw was 54.0.
 - The accessibility tree cannot see it either. The text rides in on a
   `transform`, which lands on `layer.transform`, and `accessibilityFrame` does
   not read that: thirty samples across the flight measured 0.11 points of
   travel through a journey of over a hundred and forty.

 So `ChatScreen` publishes what the animated value actually did, as a label on a
 one-point view — `low high resting`, in points. That is the quantity under test
 rather than a photograph of it, and it is readable after the flight, when
 XCUITest is able to read anything at all.
 */
final class SendMorphCheck: DemoCase {
  /// Short on purpose. The flight starts at the composer's width whatever the
  /// message is, so a small resting balloon makes the ratio unambiguous.
  private let message = "Hi"

  func testTheBalloonIsBornAsTheFieldAndDipsBeforeItSettles() throws {
    let trace = try send(message)

    /*
     * The instrument first, and it is worth being pedantic about: a missing
     * trace would make every comparison below vacuous, and the most likely way
     * for that to happen — the label never rendered — looks exactly like a pass.
     */
    XCTAssertGreaterThan(
      trace.resting, 20,
      "the resting width came back as \(trace.resting), which is not a balloon. "
        + "This case is reading the wrong label.")

    /*
     * Born as the field. This demo's composer field runs over three hundred
     * points and a two-letter balloon is about fifty, so the real ratio is
     * around six. Twice is a floor no settling could reach, and one the old
     * behaviour cannot reach at all: starting at 78% of the resting width and
     * growing, its widest value IS the resting width.
     */
    XCTAssertGreaterThan(
      trace.high, trace.resting * 2,
      "the widest the balloon ever got was \(trace.high) points against a "
        + "resting \(trace.resting). It is not being born as the composer's "
        + "field — see `THROW_SPRING` in ChatScreen.js for the frames.")

    /*
     * And past it on the way. The native send morph scales down to
     * 0.7 and the two springs cross at 0.77; 0.9 is a ceiling that leaves room
     * for both and still fails a width that only ever approaches its target
     * from one side.
     */
    XCTAssertLessThan(
      trace.low, trace.resting * 0.9,
      "the narrowest the balloon got was \(trace.low) against a resting "
        + "\(trace.resting) — it never dipped below its final width, so the "
        + "squash and the swell have collapsed into one move.")
  }

  /**
   And a SECOND send does the same thing.

   The trace is a piece of state on the screen rather than on the message, so a
   send that reported nothing would leave the previous send's numbers in place
   and this file would keep passing on them. Sending a much longer message and
   requiring the resting width to change is what makes that impossible.
   */
  func testTheTraceIsTheLatestSendAndNotTheFirst() throws {
    let first = try send(message)
    let second = try send("A considerably longer message than the first one")

    XCTAssertGreaterThan(
      second.resting, first.resting + 50,
      "the second send reported a resting width of \(second.resting) against "
        + "the first's \(first.resting). A much longer message should be a much "
        + "wider balloon; this looks like the first send's trace, which would "
        + "make every other case here pass on stale numbers.")
    XCTAssertGreaterThan(
      second.high, second.resting,
      "the second send was never wider than its own resting width")
  }

  // MARK: -

  private struct Trace {
    let low: CGFloat
    let high: CGFloat
    let resting: CGFloat
  }

  /// Types a message, sends it, and returns what the flight's width did.
  private func send(_ body: String, file: StaticString = #filePath, line: UInt = #line) throws
    -> Trace
  {
    /*
     * The LINK, which only exists on the screen that lists the screens.
     *
     * Two other guards were wrong here. The Send button only exists while there
     * is a draft, so after the first send it read as "not in the chat" and tried
     * to navigate again; and a composer field is on the first screen too, so
     * asking for one read as "already in the chat" and typed into a field that
     * had no focus.
     */
    let entrance = app.links["Chat, with a composer"]
    if entrance.exists {
      entrance.tap()
      let field = app.textViews.firstMatch
      XCTAssertTrue(field.waitForExistence(timeout: 15), "no composer field", file: file, line: line)
      field.tap()
      XCTAssertTrue(
        app.keyboards.element(boundBy: 0).waitForExistence(timeout: 10),
        "the keyboard never came up, so nothing can be typed", file: file, line: line)
    }

    app.typeText(body)
    let send = app.buttons["Send"]
    XCTAssertTrue(
      send.waitForExistence(timeout: 8), "no send button with a draft", file: file, line: line)
    send.tap()

    XCTAssertTrue(
      text(body).waitForExistence(timeout: 10), "the message never arrived", file: file, line: line)
    // The trace is written when the flight's completion handler runs, which is
    // after the swell's spring has settled.
    Thread.sleep(forTimeInterval: 2.0)

    let label = app.descendants(matching: .any)
      .matching(NSPredicate(format: "label BEGINSWITH 'flight '"))
      .element(boundBy: 0)
    XCTAssertTrue(
      label.waitForExistence(timeout: 5),
      "the send never published a flight trace; see `flightTrace` in ChatScreen.js",
      file: file, line: line)

    let parts = label.label.split(separator: " ")
    XCTAssertEqual(
      parts.count, 4, "unreadable flight trace: \(label.label)", file: file, line: line)
    return Trace(
      low: CGFloat(Double(parts[1]) ?? 0),
      high: CGFloat(Double(parts[2]) ?? 0),
      resting: CGFloat(Double(parts[3]) ?? 0))
  }
}
