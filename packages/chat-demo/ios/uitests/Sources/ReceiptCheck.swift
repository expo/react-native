/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 The receipt sits against the balloon it belongs to, and says two things.

 Both halves have been wrong on a shipped build, and neither is visible without
 measuring against the native chat.

 - **The gap.** It was eleven points below the balloon's body where the platform
   puts it at eight, and the correction before that overshot from a phone
   screenshot's 2.97. The number now comes from a real native balloon on this
   simulator — the native chat will send an SMS to itself, which is the only way
   to get one — and `styles.receipt` carries the derivation.
 - **The word and the time are different faces.** The native status line is SF
   Semibold 11 and its date is SF Regular 11. Ours was one flat regular run, and
   the stem width of the native "Delivered" measures 1.33 points against
   regular's 0.96, so the difference is real and not a rendering of the same
   thing.

 A UI test cannot see a font, so the second half is checked the only way it can
 be: the receipt has to READ as two parts, a word and a time.
 */
final class ReceiptCheck: DemoCase {
  override class var initialScreen: String? { "chat" }

  func testTheReceiptSitsAgainstTheBalloon() throws {
    let field = app.textViews.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 15), "no composer field")
    field.tap()
    XCTAssertTrue(app.keyboards.element(boundBy: 0).waitForExistence(timeout: 10))

    let message = "Receipt"
    app.typeText(message)
    let send = app.buttons["Send"]
    XCTAssertTrue(send.waitForExistence(timeout: 8), "no send button with a draft")
    send.tap()

    /*
     * `Delivered` first, then `Read` a beat later — the demo shows both, in that
     * order, deliberately. Either will do here; what is being measured is where
     * the line SITS, and both sit in the same place.
     */
    let sent = text(message)
    XCTAssertTrue(sent.waitForExistence(timeout: 10), "the message never appeared")

    /*
     * BELOW the sent balloon, which is the whole of the scoping. The mock
     * conversation already wears a `Delivered` on an earlier message, and it
     * keeps wearing it until the new balloon has settled and its own receipt's
     * ink has waited out the handover — a window the natively measured timing
     * makes over a second wide. An unscoped label query matched that earlier
     * receipt, a hundred and fifty points up, and measured the wrong row.
     */
    func belowTheBalloon(_ candidate: XCUIElement) -> Bool {
      candidate.exists && candidate.frame.minY > sent.frame.maxY
    }
    var receipt: XCUIElement?
    let deadline = Date().addingTimeInterval(10)
    while Date() < deadline && receipt == nil {
      for candidate in [text("Delivered"), text("Read")]
      where belowTheBalloon(candidate) {
        receipt = candidate
      }
      if receipt == nil {
        // The whole line, when the status and the time have merged into one label.
        let any = app.descendants(matching: .any)
          .matching(NSPredicate(format: "label BEGINSWITH 'Read ' OR label == 'Delivered'"))
          .firstMatch
        if belowTheBalloon(any) { receipt = any }
      }
      if receipt == nil { Thread.sleep(forTimeInterval: 0.3) }
    }
    guard let line = receipt else {
      return XCTFail("no receipt under the sent message; visible: \(visibleText())")
    }

    /*
     * WHERE it is, worked out from the message's own text rather than from the
     * balloon: a `native-chatbubble` is a surface with no accessibility of its
     * own, and the text inside it is the one landmark a test can name.
     *
     *   the body's bottom  = the text's bottom + `BUBBLE_PADDING_V` (10)
     *   the receipt's box  = that + the tail's drop (6.65) + `marginTop` (-1)
     *
     * so the line's own top should be 5.65 below the body. Measured against the
     * native chat the INK lands 8.00 below the body, and the two agree: an
     * 11-point line box carries about 2.35 points of leading above its
     * ascenders. The version that shipped put the ink at 11.00, which is this
     * number at 8.65 — outside the tolerance below, which is the point.
     */
    let bodyBottom = sent.frame.maxY + 10
    let gap = line.frame.minY - bodyBottom
    print("MEASURE balloon=\(sent.frame) receipt=\(line.frame) gap=\(gap)")
    for c in app.descendants(matching: .any)
      .matching(NSPredicate(format: "label BEGINSWITH 'Read ' OR label == 'Delivered' OR label == 'Receipt'"))
      .allElementsBoundByIndex {
      print("MEASURE candidate '\(c.label)' \(c.frame) type=\(c.elementType.rawValue)")
    }
    XCTAssertEqual(
      gap, 5.65, accuracy: 1.5,
      "the receipt's box starts \(gap) below the balloon's body, not 5.65 — "
        + "text at \(sent.frame.maxY), receipt at \(line.frame.minY)")

    // And inside the balloon's trailing edge rather than flush with it.
    XCTAssertLessThan(
      line.frame.maxX, sent.frame.maxX + 16,
      "the receipt runs past the balloon's trailing edge")
  }

  /**
   `Read` carries a time and `Delivered` does not — which is the platform's rule.

   Kept separate from the geometry because it is a different claim and fails for
   a different reason: the time is what makes the line two faces rather than one,
   and a `<span>` inside a `<p>` is how that is spelled. If the span ever stops
   reaching the mounted tree, this is what says so.
   */
  func testReadCarriesATimeAndDeliveredDoesNot() throws {
    let field = app.textViews.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 15), "no composer field")
    field.tap()
    XCTAssertTrue(app.keyboards.element(boundBy: 0).waitForExistence(timeout: 10))
    app.typeText("Read receipt")
    let send = app.buttons["Send"]
    XCTAssertTrue(send.waitForExistence(timeout: 8), "no send button with a draft")
    send.tap()

    // ICU writes a narrow no-break space before AM/PM, so the separator is not
    // a plain space — see `ReactionCheck`, which learned the same thing.
    let read = app.descendants(matching: .any)
      .matching(NSPredicate(format: "label MATCHES %@", "^Read .?[0-9]{1,2}:[0-9]{2}.?([A-Za-z.]{2,4})?$"))
      .firstMatch
    XCTAssertTrue(
      read.waitForExistence(timeout: 12),
      "no \"Read <time>\" line; the status and the time are one run again. "
        + "visible: \(visibleText())")
  }

  /**
   The receipt PUSHES the transcript up when it opens at the bottom.

   The three-message conversation the other cases use never fills the screen, so
   a receipt opening under the newest balloon has empty room to grow into and is
   visible whatever the scroll does — which is exactly why they did not catch
   this. Reported from a device: "when the read indicator makes room in a bubble
   and we are scrolled to the bottom, it doesn't push the content up" — the
   receipt opened behind the composer instead. So this seeds a full transcript
   (`EXP_SEED_MESSAGES`) that rests AT the bottom, sends, and requires the
   receipt line to be ON SCREEN and clear of the composer's top edge. It can
   only be there if the transcript rose to meet it.

   The fix is `EXPScrollViewComponentView` pinning a bottom-anchored list's
   anchor row by its BOTTOM edge, so growth below the newest balloon drives the
   offset. A regression there reopens the receipt behind the bar, and this
   fails.
   */
  func testTheReceiptPushesTheTranscriptClearOfTheComposer() throws {
    // A transcript tall enough to rest at the bottom rather than float in space.
    app.launchEnvironment["EXP_SEED_MESSAGES"] = "40"
    app.terminate()
    app.launch()
    XCTAssertTrue(
      app.staticTexts["Chat"].waitForExistence(timeout: 30),
      "the seeded chat never rendered")

    let field = app.textViews.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 15), "no composer field")
    field.tap()
    XCTAssertTrue(app.keyboards.element(boundBy: 0).waitForExistence(timeout: 10))

    let message = "Push"
    app.typeText(message)
    let send = app.buttons["Send"]
    XCTAssertTrue(send.waitForExistence(timeout: 8), "no send button with a draft")
    send.tap()

    let sent = text(message)
    XCTAssertTrue(sent.waitForExistence(timeout: 10), "the message never appeared")

    // The receipt below THIS balloon — same scoping as the geometry case.
    func belowTheBalloon(_ candidate: XCUIElement) -> Bool {
      candidate.exists && candidate.frame.minY > sent.frame.maxY
    }
    var receipt: XCUIElement?
    let deadline = Date().addingTimeInterval(10)
    while Date() < deadline && receipt == nil {
      for candidate in [text("Delivered"), text("Read")] where belowTheBalloon(candidate) {
        receipt = candidate
      }
      if receipt == nil {
        let any = app.descendants(matching: .any)
          .matching(NSPredicate(format: "label BEGINSWITH 'Read ' OR label == 'Delivered'"))
          .firstMatch
        if belowTheBalloon(any) { receipt = any }
      }
      if receipt == nil { Thread.sleep(forTimeInterval: 0.3) }
    }
    guard let line = receipt else {
      return XCTFail("no receipt under the sent message; visible: \(visibleText())")
    }
    // Give the push-up a beat to settle.
    Thread.sleep(forTimeInterval: 1.0)

    XCTAssertTrue(
      isOnScreen(line),
      "the receipt is not on screen — it opened behind the composer instead of "
        + "pushing the transcript up; visible: \(visibleText())")
    XCTAssertLessThanOrEqual(
      line.frame.maxY, field.frame.minY + 0.5,
      "the receipt's bottom (\(line.frame.maxY)) is below the composer's top "
        + "(\(field.frame.minY)) — the content did not rise to clear it")
  }
}
