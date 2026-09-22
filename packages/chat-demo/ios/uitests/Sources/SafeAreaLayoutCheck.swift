/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 Each edge is independent: Duo's status controls can reserve a side instead
 of a horizontal band. Read the surface's env() probes, then check the actual
 foreground in the chat against that safe rectangle. The page uses local
 viewport events to reserve its sides, independently of these reference probes.
 */
// covers: App.js Composer.js screens/ChatScreen.js
final class SafeAreaLayoutCheck: DemoCase {
  private func safeArea() throws -> UIEdgeInsets {
    let list = app.scrollViews.firstMatch
    func row(_ edge: String) -> XCUIElement {
      app.descendants(matching: .any)
        .matching(NSPredicate(format: "label BEGINSWITH %@", "env(safe-area-inset-\(edge)) "))
        .firstMatch
    }
    for _ in 0..<8 {
      if row("right").exists { break }
      list.swipeUp(velocity: .fast)
    }
    func value(_ edge: String) throws -> CGFloat {
      let element = row(edge)
      XCTAssertTrue(element.exists, "missing \(edge) safe-area readout")
      XCTAssertTrue(waitUntil(5) { element.label.hasSuffix(" pt") }, "safe-area readout did not settle")
      let words = element.label.split(separator: " ")
      return CGFloat(try XCTUnwrap(words.count >= 3 ? Double(words[words.count - 2]) : nil))
    }
    return try UIEdgeInsets(top: value("top"), left: value("left"), bottom: value("bottom"), right: value("right"))
  }

  private func openChat() {
    let row = text("Chat, with a composer")
    for _ in 0..<8 {
      if row.exists && row.isHittable { break }
      app.scrollViews.firstMatch.swipeDown(velocity: .fast)
    }
    row.tap()
    XCTAssertTrue(appears(app.staticTexts["Chat"], within: 10))
    settled(app.textViews.firstMatch)
  }

  func testForegroundUsesEachSafeEdgeAndTheComposerFollowsTheKeyboard() throws {
    let inset = try safeArea()
    openChat()
    let window = app.windows.element(boundBy: 0).frame
    let safe = window.inset(by: inset)
    let field = app.textViews.firstMatch
    let plus = plusButton()
    XCTAssertGreaterThanOrEqual(plus.frame.minX, safe.minX - 1)
    XCTAssertLessThanOrEqual(field.frame.maxX, safe.maxX + 1)
    XCTAssertLessThanOrEqual(plus.frame.maxY, safe.maxY + 1)
    XCTAssertLessThanOrEqual(field.frame.maxY, safe.maxY + 1)
    let newest = text("The bar follows the keyboard rather than copying it.")
    XCTAssertTrue(appears(newest, within: 10))
    XCTAssertGreaterThanOrEqual(newest.frame.minX, safe.minX - 1)
    XCTAssertLessThanOrEqual(newest.frame.maxX, safe.maxX + 1)

    let sent = text("It should not. Pull it down and watch.")
    XCTAssertTrue(appears(sent, within: 10))
    XCTAssertGreaterThanOrEqual(sent.frame.minX, safe.minX + 15)
    XCTAssertLessThanOrEqual(sent.frame.maxX, safe.maxX - 15)
    let before = sent.frame
    let transcript = app.scrollViews.firstMatch
    transcript.swipeLeft(velocity: .slow)
    XCTAssertTrue(appears(sent, within: 5))
    XCTAssertTrue(waitUntil(5) {
      abs(sent.frame.minX - before.minX) <= 1 && abs(sent.frame.maxX - before.maxX) <= 1
    }, "the sent message did not return to its column after the swipe")

    field.tap()
    let keyboard = app.keyboards.element(boundBy: 0)
    waitForKeyboard(over: field)
    field.typeText("Duo safe-area draft")
    settled(field)
    XCTAssertEqual(field.value as? String, "Duo safe-area draft")
    XCTAssertGreaterThanOrEqual(plus.frame.minX, safe.minX - 1)
    XCTAssertLessThanOrEqual(field.frame.maxX, safe.maxX + 1)
    XCTAssertLessThanOrEqual(field.frame.maxY, keyboard.frame.minY + 1)
  }
}
