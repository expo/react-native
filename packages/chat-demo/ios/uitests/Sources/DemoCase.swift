/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 A base case that starts every test from the same place, and can read pixels.

 Two things here are requirements rather than convenience.

 **The app is terminated and launched for every test.** `XCUIApplication.activate()`
 resumes whatever state the previous test left, so the previous test decides the
 answer — and a reading of the wrong screen still comes back green.

 **Nothing is judged until the app has demonstrably loaded.** A demo whose Metro
 server is not running comes up black, every query matches nothing, and a test
 phrased as "no blue band is present" passes perfectly. So the first thing every
 case does is wait for a real element and fail loudly if it never arrives.
 */
class DemoCase: XCTestCase {
  static let bundleID = "dev.expo.frontierdemo"

  /** Which hosting the suite judges: the keyboard layout guide, or the input system. */
  static let layoutGuideBar = true


  /**
   The screen the app LAUNCHES on, for classes whose every test starts there.

   Tapping "Chat, with a composer" costs each test a couple of seconds of
   navigation that is not under test. `EXP_OPEN_SCREEN` reaches the app as
   initial props and seeds the stack's first state — home beneath, target
   pushed — so a test begins where tapping in would have left it.
   Classes with a test that starts on the home screen, or whose subject is the
   entrance itself, keep the default and keep tapping.
   */
  class var initialScreen: String? { nil }
  /// The conversation's length, as `EXP_SEED_MESSAGES`; nil leaves the default.
  class var seedMessages: Int? { nil }
  /// Whether the chat measures itself and shows the banner. Off for a person,
  /// so a case that reads the banner has to ask.
  class var showsPerformance: Bool { false }

  var app: XCUIApplication!

  override func setUpWithError() throws {
    continueAfterFailure = false
    app = XCUIApplication(bundleIdentifier: DemoCase.bundleID)
    if let screen = Self.initialScreen {
      app.launchEnvironment["EXP_OPEN_SCREEN"] = screen
    }
    if let count = Self.seedMessages {
      app.launchEnvironment["EXP_SEED_MESSAGES"] = String(count)
    }
    if Self.showsPerformance {
      app.launchEnvironment["EXP_PROFILING"] = "1"
    }
    /*
     * The geometry trace, echoed to the system log for the whole run.
     *
     * `SIMCTL_CHILD_*` only reaches an app launched by `simctl`, and these are
     * launched by XCUITest — so a `log stream` running alongside a test sees
     * nothing at all. Set here, every test doubles as a way to capture the
     * keyboard's per-frame geometry:
     *
     *     log stream --level info --predicate 'subsystem == "dev.expo.keyboard"'
     */
    app.launchEnvironment["EXP_KEYBOARD_TRACE_ECHO"] = "1"
    /*
     * Which hosting the suite judges, so the SAME suite can be run against both
     * models: the accessory the input system hosts, and the bar pinned to
     * `UIKeyboardLayoutGuide`.
     *
     * Set HERE, not read from the runner's environment.
     * `ProcessInfo.processInfo.environment` in the test runner does not inherit
     * xcodebuild's shell environment, so a variable passed that way silently
     * never arrives and the run judges the other hosting while reporting this
     * one. A constant cannot lie about which mode ran.
     */
    app.launchEnvironment["EXP_LAYOUT_GUIDE_BAR"] = DemoCase.layoutGuideBar ? "1" : "0"
    app.terminate()
    app.launch()
    /*
     * A screen-appropriate element that proves the app LOADED. If this never
     * appears the app did not render — almost always a stopped Metro — and
     * every assertion after it would be vacuous. The home title is occluded
     * when a screen is seeded on top (covered screens leave the accessibility
     * tree), so each start has its own sentinel. The virtualized screen's
     * timeout is the measured one: its first query against the ten-thousand-row
     * tree takes longer than twenty seconds — see `VirtualizedCheck`.
     */
    let ready: XCUIElement
    var timeout: TimeInterval = 30
    switch Self.initialScreen {
    case "chat":
      ready = app.staticTexts["Chat"]
    case "virtualized":
      ready = app.buttons["To the start"]
      timeout = 90
    default:
      ready = app.staticTexts["Safe areas"]
    }
    XCTAssertTrue(
      ready.waitForExistence(timeout: timeout),
      "the demo never rendered; is Metro serving from the repository root?")
  }

  override func tearDownWithError() throws {
    app.terminate()
  }

  // MARK: - Pixels

  /// One screen's pixels, with the scale needed to go from points to them.
  struct Pixels {
    let width: Int
    let height: Int
    let scale: CGFloat
    private let rgba: [UInt8]

    init?(_ screenshot: XCUIScreenshot, pointHeight: CGFloat) {
      guard let cg = screenshot.image.cgImage else { return nil }
      width = cg.width
      height = cg.height
      scale = CGFloat(cg.height) / pointHeight
      var buffer = [UInt8](repeating: 0, count: width * height * 4)
      guard
        let context = CGContext(
          data: &buffer,
          width: width,
          height: height,
          bitsPerComponent: 8,
          bytesPerRow: width * 4,
          space: CGColorSpaceCreateDeviceRGB(),
          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
      else { return nil }
      context.draw(cg, in: CGRect(x: 0, y: 0, width: width, height: height))
      rgba = buffer
    }

    /// The colour at a point, in POINTS — the coordinate space element frames use.
    func at(x: CGFloat, y: CGFloat) -> (r: Int, g: Int, b: Int) {
      let px = min(max(Int(x * scale), 0), width - 1)
      let py = min(max(Int(y * scale), 0), height - 1)
      let i = (py * width + px) * 4
      return (Int(rgba[i]), Int(rgba[i + 1]), Int(rgba[i + 2]))
    }

    /// The average across a horizontal run, which suppresses a stray glyph.
    func rowAverage(y: CGFloat, from x0: CGFloat, to x1: CGFloat) -> (r: Int, g: Int, b: Int) {
      var r = 0, g = 0, b = 0, n = 0
      var x = x0
      while x < x1 {
        let c = at(x: x, y: y)
        r += c.r
        g += c.g
        b += c.b
        n += 1
        x += 2
      }
      return n == 0 ? (0, 0, 0) : (r / n, g / n, b / n)
    }
  }

  func pixels() throws -> Pixels {
    let shot = XCUIScreen.main.screenshot()
    let height = app.windows.element(boundBy: 0).frame.height
    let pixels = Pixels(shot, pointHeight: height)
    return try XCTUnwrap(pixels, "could not read the screenshot")
  }

  /// How far apart two colours are, as the largest per-channel difference.
  func distance(_ a: (r: Int, g: Int, b: Int), _ b: (r: Int, g: Int, b: Int)) -> Int {
    max(abs(a.r - b.r), max(abs(a.g - b.g), abs(a.b - b.b)))
  }

  // MARK: - Gestures

  /**
   Put the keyboard away by DRAGGING it, which is the gesture the demo supports.

   There is no Done button on the screen this is used from, and
   `typeText(escape)` does nothing to a software keyboard. What does work is the
   platform's own interactive dismissal: a drag that begins in the content and
   reaches the keyboard takes it down with the finger.

   Asserted rather than assumed. A dismissal that silently did not happen would
   leave every later step operating on a covered screen, and the test that
   followed would fail somewhere unrelated.
   */
  func dismissKeyboard(file: StaticString = #filePath, line: UInt = #line) {
    guard app.keyboards.count > 0 else { return }
    let window = app.windows.element(boundBy: 0)
    let start = window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.30))
    let end = window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.99))
    /*
     * Twice, because after `typeText` once is never enough.
     *
     * Measured on iOS 27 with a scratch case that printed the keyboard's frame,
     * its key count and the composer's position after each attempt: with
     * nothing typed, every drag shape takes the keyboard down; once XCUITest
     * has typed through the software keys, no single drag does — thirty-five
     * keys still up and the composer still raised. The same text typed through
     * `idb` and the same drag dismisses, and the app dismisses on a phone, so
     * this is the harness's typing rather than the app.
     *
     * The second drag always lands. Tapping the transcript first works too and
     * is not used: a tap can reach a balloon.
     */
    for _ in 0..<2 {
      start.press(forDuration: 0.05, thenDragTo: end, withVelocity: 800, thenHoldForDuration: 0.2)
      if app.keyboards.element(boundBy: 0).waitForNonExistence(timeout: 4) {
        return
      }
    }
    XCTFail("the keyboard would not go away", file: file, line: line)
  }

  // MARK: - Finding text

  /**
   A run of text by its exact words, whatever element type it landed on.

   `app.staticTexts[...]` does NOT find the demo's text, and the reason is worth
   knowing: a `<p>`, or a bare string inside a `<div>`, arrives with the right
   accessible label on an element of type `Other` rather than `StaticText`. It
   is named — VoiceOver reads it — but it does not carry
   `UIAccessibilityTraitStaticText`, so anything that navigates or queries BY
   TYPE cannot see it. In the DOM these are text nodes.

   Matching on the label alone keeps this suite about the thing it is testing.
   The trait itself is a separate gap, recorded rather than worked around here.
   */
  func text(_ exact: String) -> XCUIElement {
    app.descendants(matching: .any)
      .matching(NSPredicate(format: "label == %@", exact))
      .firstMatch
  }

  /// Whether an element is actually within the window, not merely in the tree.
  ///
  /// Everything mounted is in the tree, including rows scrolled a thousand
  /// points off the top — so `exists` answers "is it mounted", never "can it be
  /// seen". Asking the wrong one lets a guard meant to establish that the list
  /// has moved pass without it having moved.
  func isOnScreen(_ element: XCUIElement) -> Bool {
    guard element.exists else { return false }
    let window = app.windows.element(boundBy: 0).frame
    let frame = element.frame
    return frame.height > 0 && frame.minY >= window.minY && frame.maxY <= window.maxY
  }

  /**
   Open the composer's `+` and choose a command by its exact title.

   The demo's actions live behind the `+`, which is where the native chat puts
   them — in a panel that takes the KEYBOARD'S place rather than a menu drawn
   over the composer. Either way a test that wants one has to open it first.
   */
  /**
   The composer's `+`, and specifically the one built out of the ELEMENTS.

   The demo can show three of them at once (`PLUS_KIND = 'both'` in `Composer.js`): the
   `<button>` with a `<menu>` child, the `<native:menubutton>` control group, and the older
   panel. Every test here is about the first — the elements are what this suite is for — so it
   is named rather than taken by position, and the plain `"More"` is the label when only one
   is on screen.
   */
  func plusButton() -> XCUIElement {
    let labelled = app.buttons["More, HTML"]
    return labelled.exists ? labelled : app.buttons["More"]
  }

  func chooseCommand(_ title: String, file: StaticString = #filePath, line: UInt = #line) {
    let plus = plusButton()
    XCTAssertTrue(plus.waitForExistence(timeout: 10), "no + button", file: file, line: line)
    plus.tap()

    let command = app.buttons[title]
    XCTAssertTrue(
      command.waitForExistence(timeout: 8),
      "the panel never offered \(title); visible: \(visibleText())",
      file: file,
      line: line)
    command.tap()
    /*
     * Wait for the panel to actually close rather than sleeping a flat second.
     * The command's button leaving the tree IS the close; a fixed sleep both
     * overshoots it every time and — multiplied by FocusCheck's seventeen
     * dismissals — is twenty seconds of the suite doing nothing.
     */
    _ = command.waitForNonExistence(timeout: 5)
  }

  /// A CHEAP description of what is on screen, for a failure message.
  ///
  /// Two bounded queries and no enumeration, because both richer versions cost
  /// a full gate each:
  ///
  ///   - `descendants(matching: .any).allElementsBoundByIndex` re-queries per
  ///     index, so a tree still laying out mutates under it and XCTest throws
  ///     "No matches found for Element at index 100" — a failure inside the
  ///     failure message, which replaced the real one.
  ///   - `app.debugDescription` snapshots the WHOLE tree, which on a 200-message
  ///     transcript is slow enough that the test hangs instead of reporting.
  ///
  /// A diagnostic must be able to neither crash nor hang. This one cannot do
  /// either: it says how much is there and shows one label.
  func visibleText() -> String {
    let count = app.staticTexts.count
    let first = app.staticTexts.firstMatch
    let label = first.exists ? first.label : "(none)"
    return "\(count) static texts; first: \(label)"
  }
}
