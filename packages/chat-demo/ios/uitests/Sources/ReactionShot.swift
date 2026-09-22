import XCTest

/**
 Captures the reaction art for comparison against the platform's own reactions.

 Not an assertion: the reactions were rebuilt from the platform's own metrics and
 its rendered stacked-disc assets, and reported afterwards as not looking
 right. A picture of ours beside a picture of the real one is the only thing that
 settles that, and the app cannot take it of itself.
 */
final class ReactionShot: DemoCase {
  override class var initialScreen: String? { "chat" }

  /**
   Every reaction in turn: each one leaves a badge, and each badge is the size
   the platform's own is.

   The capture is the point — the glyphs were corrected by comparing these
   frames against the platform's own — but a test that only takes pictures passes whatever
   happens, including the badge not appearing at all. So each turn is also
   checked: the reaction the command cycled to is on screen, and the disc is the
   34 points the platform's badge size minus its mask insets gives.
   */
  func testEveryGlyphLeavesABadgeOfTheRightSize() throws {
    let labels = ["Loved", "Liked", "Disliked", "Laughed at", "Emphasised", "Questioned"]
    for (index, label) in labels.enumerated() {
      chooseCommand("React to the last message")
      let badge = app.descendants(matching: .any)
        .matching(NSPredicate(format: "label == %@", label)).firstMatch
      XCTAssertTrue(
        badge.waitForExistence(timeout: 8),
        "no \(label) badge after \(index + 1) reaction(s); visible: \(visibleText())")
      XCTAssertEqual(
        badge.frame.width, 34, accuracy: 1,
        "the \(label) badge's disc is \(badge.frame.width) wide, not 34")
      Thread.sleep(forTimeInterval: 0.8)
      try? XCUIScreen.main.screenshot().pngRepresentation
        .write(to: URL(fileURLWithPath: "/tmp/rcpt/glyph_\(index).png"))
    }
  }

  func testCaptureSingleAndPile() throws {
    chooseCommand("React to the last message")
    let badge = app.descendants(matching: .any)
      .matching(NSPredicate(format: "label == 'Loved'")).firstMatch
    XCTAssertTrue(badge.waitForExistence(timeout: 8), "no badge")
    Thread.sleep(forTimeInterval: 1.2)
    try? XCUIScreen.main.screenshot().pngRepresentation
      .write(to: URL(fileURLWithPath: "/tmp/rcpt/ours_single.png"))
    print("MEASURE single badge frame=\(badge.frame)")

    chooseCommand("Others react to the last message")
    Thread.sleep(forTimeInterval: 1.5)
    try? XCUIScreen.main.screenshot().pngRepresentation
      .write(to: URL(fileURLWithPath: "/tmp/rcpt/ours_pile.png"))
  }
}
