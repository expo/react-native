/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 What a hard fling costs, printed.

 A recorder rather than an assertion. The numbers it reads are the whole
 report — the rows' own render time, the renderer's commit and layout, the main
 thread's mounting, and the container's geometry sweep — and no single one of
 them has a threshold that would mean anything on its own. What a run is for is
 the COMPARISON: the same gesture before and after a change, on the same
 simulator, and the same gesture at two conversation lengths.

 It exists because the alternative was a person with a phone, and a change to
 how rows are told their mode cannot be iterated on at that distance.

 Not `final`, and with no tests of its own, so that it holds the driving and the
 reading for the lengths below and runs nothing itself. The gate discovers cases
 by `final class`, which is also why this one is invisible to it.
 */
class ScrollProfileCase: DemoCase {
  override class var initialScreen: String? { "chat" }
  override class var showsPerformance: Bool { true }

  /** The newest message in a seeded conversation of `seedMessages`. */
  func waitForTheTranscript() throws {
    let count = try XCTUnwrap(Self.seedMessages, "a profile needs a seeded length")
    // Message `n` is "from <name>" unless `(n - 1) % 3 == 1`; the cast is
    // Ada Lovelace, Grace Hopper, Alan Turing by `(n - 1) % 3`.
    let cast = ["Ada Lovelace", "Grace Hopper", "Alan Turing"]
    let i = count - 1
    let newest =
      i % 3 == 1 ? "Message \(count), sent." : "Message \(count), from \(cast[i % 3])."
    XCTAssertTrue(
      text(newest).waitForExistence(timeout: 120),
      "the transcript never opened at \(count) messages")
  }

  /** Hard flings up the transcript, one after another. */
  func fling(_ times: Int) {
    /*
     * Flung from a ROW and downward, which is the direction that has somewhere
     * to go: the chat opens at its newest message, so every row a fling reaches
     * is one that starts hidden and has to render, which is the case under
     * test. The pause is shorter than the fling's own deceleration, so the
     * momentum runs on rather than stopping between bursts.
     */
    let window = app.windows.element(boundBy: 0)
    let from = window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.35))
    let to = window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.85))
    for _ in 0..<times {
      from.press(forDuration: 0.01, thenDragTo: to, withVelocity: 3000, thenHoldForDuration: 0)
      Thread.sleep(forTimeInterval: 0.35)
    }
  }

  /**
   The report for the LAST gesture, expanded.

   The meter runs on past the last fling — see `SCROLL_SETTLE_MS` — and the
   caption does not appear until it stops, because a report written while rows
   are still arriving is a report on half of them. A gesture before this one has
   its own report, which this replaces: each `elapsed` is one gesture's.
   */
  func report(_ label: String) throws {
    let caption = app.descendants(matching: .any).matching(
      NSPredicate(format: "label CONTAINS 'scroll —'")
    ).firstMatch
    XCTAssertTrue(
      caption.waitForExistence(timeout: 30),
      "no scroll report; is the performance banner on?")
    // One tap swaps the summary for the summary AND the detail; a second would
    // copy and dismiss, and a UI test must not read the pasteboard.
    caption.tap()
    let detailed = app.descendants(matching: .any).matching(
      NSPredicate(format: "label CONTAINS 'the renderer'")
    ).firstMatch
    XCTAssertTrue(detailed.waitForExistence(timeout: 15), "the caption never expanded")
    print("=== \(label) ===\n\(detailed.label)\n=== END ===")
  }

  /** The first flings after the open: the rows below the change are few. */
  func measureNearTheNewest(_ label: String) throws {
    try waitForTheTranscript()
    fling(8)
    try report("\(label) NEAR THE END")
  }

  /**
   The same gesture, far from where the transcript opened.

   A row that is revealed grows from its placeholder height to its real one, and
   every row BELOW it moves — which is every row already scrolled past. So the
   question this pair answers is whether the cost of a fling depends on how far
   the list has already been flung, and the two runs differ in nothing else.

   The first flings are unmeasured: they only carry the transcript into
   territory it has not rendered before. The pause lets their own report land
   and be replaced by the one that is read.
   */
  func measureFarFromTheNewest(_ label: String) throws {
    try waitForTheTranscript()
    fling(45)
    Thread.sleep(forTimeInterval: 4)
    fling(8)
    try report("\(label) FAR FROM THE END")
  }
}

/**
 Three thousand messages: long enough for anything O(N) to show, short enough
 that a fling still covers ground a person would cover.
 */
final class ScrollProfile: ScrollProfileCase {
  override class var seedMessages: Int? { 3000 }

  func testAFlingNearTheNewestMessage() throws { try measureNearTheNewest("3000") }
  func testAFlingFarFromTheNewestMessage() throws { try measureFarFromTheNewest("3000") }
}

/**
 Ten thousand, which is where the shape of the cost has to be read rather than
 inferred.

 A fix that divides a cost by a constant and a fix that changes what the cost
 depends on look the same at one length. More than three times the conversation
 is what tells them apart: the same gesture over the same distance should cost
 the same here as it does at three thousand, and anything that does not is still
 counting the whole list.

 Not more than ten thousand, and the limit is the TESTER rather than the app.
 XCUITest's first query against a ten-thousand-row tree takes twenty to thirty
 seconds — measured, repeatedly, in `VirtualizedCheck` — and it is walking the
 accessibility tree, so it grows with the conversation whatever the app does
 about drawing it. At thirty thousand the reading would be mostly the cost of
 asking.
 */
final class ScrollProfileLong: ScrollProfileCase {
  override class var seedMessages: Int? { 10000 }

  func testAFlingNearTheNewestMessage() throws { try measureNearTheNewest("10000") }
  func testAFlingFarFromTheNewestMessage() throws { try measureFarFromTheNewest("10000") }
}
