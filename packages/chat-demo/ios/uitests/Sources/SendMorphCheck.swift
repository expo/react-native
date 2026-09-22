/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 The send animation starts at the composer field's width, and the balloon
 shrinks below its final width before settling, as in native Messages.

 XCUITest can't observe the animation (`tap()` returns after it ends, and the
 accessibility frame ignores `transform`), so this reads the widths ChatScreen
 publishes afterwards as a label: `flight <low> <high> <resting>` in points
 (`flightTrace` in ChatScreen.js).
 */
// covers: screens/ChatScreen.js Composer.js
final class SendMorphCheck: DemoCase {
  /// Short, so the resting balloon is much narrower than the field.
  private let message = "Hi"

  /// One launch: the second part's first send is the first part's. The label
  /// is replaced on each send: `flightTrace` is screen state, so a send that
  /// published nothing would leave the previous send's numbers.
  func testTheBalloonIsBornAsTheFieldDipsBeforeItSettlesAndTheTraceIsTheLatestSend() throws {
    let first = try XCTContext.runActivity(named: "the first send is born as the field and dips") { _ -> Trace in
      let trace = try send(message)

      // A resting width of ~0 means the label wasn't read.
      XCTAssertGreaterThan(
        trace.resting, 20,
        "the resting width came back as \(trace.resting), which is not a balloon. "
          + "This case is reading the wrong label.")

      // The field is over 300 pt wide and this balloon about 50, so starting at
      // the field's width gives a ratio near 6; 2 is a safe floor.
      XCTAssertGreaterThan(
        trace.high, trace.resting * 2,
        "the widest the balloon ever got was \(trace.high) points against a "
          + "resting \(trace.resting). It is not being born as the composer's "
          + "field — see `THROW_SPRING` in ChatScreen.js for the frames.")

      // From a one-line composer the narrowest point is 0.77 of the resting width
      // (`SQUASH_TROUGH` in ChatScreen.js); 0.9 leaves margin.
      XCTAssertLessThan(
        trace.low, trace.resting * 0.9,
        "the narrowest the balloon got was \(trace.low) against a resting "
          + "\(trace.resting) — it never dipped below its final width, so the "
          + "squash and the swell have collapsed into one move.")
      return trace
    }

    try XCTContext.runActivity(named: "the trace is the latest send") { _ in
      // The first part's send, so the two sends differ and so do their traces
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
  }

  // MARK: -

  private struct Trace {
    let low: CGFloat
    let high: CGFloat
    let resting: CGFloat
  }

  /// Sends `body` (opening the chat first if needed) and returns the widths
  /// from the `flight` label.
  private func send(_ body: String, file: StaticString = #filePath, line: UInt = #line) throws
    -> Trace
  {
    // Only the home screen has this link. (A composer field is on both
    // screens, and Send exists only with a draft.)
    let entrance = app.links["Chat, with a composer"]
    if entrance.exists {
      entrance.tap()
      let field = app.textViews.firstMatch
      XCTAssertTrue(appears(field, within: 15), "no composer field", file: file, line: line)
      field.tap()
      XCTAssertTrue(
        appears(app.keyboards.element(boundBy: 0), within: 10),
        "the keyboard never came up, so nothing can be typed", file: file, line: line)
    }

    // A fresh query each time: a resolved element keeps looking for the label
    // it was resolved with, and the label's text is what changes
    func flightLabel() -> XCUIElement {
      app.descendants(matching: .any)
        .matching(NSPredicate(format: "label BEGINSWITH 'flight '"))
        .firstMatch
    }
    let before = flightLabel()
    let previous = before.exists ? before.label : ""
    type(body)
    let send = app.buttons["Send"]
    XCTAssertTrue(
      appears(send, within: 8), "no send button with a draft", file: file, line: line)
    send.tap()

    XCTAssertTrue(
      appears(text(body), within: 10), "the message never arrived", file: file, line: line)
    // The label is written when the send animation completes, replacing the
    // previous send's
    XCTAssertTrue(
      waitUntil(8) {
        let now = flightLabel()
        return now.exists && now.label != previous
      },
      "the send never published a flight trace; see `flightTrace` in ChatScreen.js",
      file: file, line: line)
    let label = flightLabel()

    let parts = label.label.split(separator: " ")
    XCTAssertEqual(
      parts.count, 4, "unreadable flight trace: \(label.label)", file: file, line: line)
    return Trace(
      low: CGFloat(Double(parts[1]) ?? 0),
      high: CGFloat(Double(parts[2]) ?? 0),
      resting: CGFloat(Double(parts[3]) ?? 0))
  }
}
