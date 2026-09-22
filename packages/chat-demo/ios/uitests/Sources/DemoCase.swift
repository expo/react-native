/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 Base class for every check. Relaunches the app for each test (`activate()`
 would keep the previous test's state) and waits for a known element first, so
 a blank app (Metro not serving) fails instead of passing negative assertions.
 */
class DemoCase: XCTestCase {
  static let bundleID = "dev.expo.frontierdemo"


  /// The screen to launch on, via `EXP_OPEN_SCREEN`, with the home screen
  /// underneath. nil launches on the home screen.
  class var initialScreen: String? { nil }
  /// The conversation's length, as `EXP_SEED_MESSAGES`; nil leaves the default.
  class var seedMessages: Int? { nil }
  /// Sets `EXP_PROFILING`, which shows the chat's performance banner.
  class var showsPerformance: Bool { false }
  class var extraEnvironment: [String: String] { [:] }

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
    // Echo the keyboard trace to the system log, where tools/gate.sh records
    // it. (`SIMCTL_CHILD_*` variables don't reach an app XCUITest launches.)
    app.launchEnvironment["EXP_KEYBOARD_TRACE_ECHO"] = "1"
    // Labels trace lines with the test name; tools/gate.sh prints it on failure.
    app.launchEnvironment["EXP_CASE"] = name
    for (key, value) in Self.extraEnvironment {
      app.launchEnvironment[key] = value
    }
    app.terminate()
    app.launch()
    /*
     * Fail early if the app didn't render (usually Metro isn't serving). Each
     * start screen needs its own element, because a pushed screen removes the
     * home title from the accessibility tree.
     */
    let ready: XCUIElement
    let timeout: TimeInterval = 30
    switch Self.initialScreen {
    case "chat":
      ready = app.staticTexts["Chat"]
    case "virtualized":
      ready = app.buttons["To the start"]
    default:
      ready = app.staticTexts["Safe areas"]
    }
    XCTAssertTrue(
      appears(ready, within: timeout),
      "the demo never rendered; is Metro serving from the repository root?")
  }

  override func tearDownWithError() throws {
    app.terminate()
  }

  // MARK: - Pixels

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

    /// The colour at a point given in window points, not pixels.
    func at(x: CGFloat, y: CGFloat) -> (r: Int, g: Int, b: Int) {
      let px = min(max(Int(x * scale), 0), width - 1)
      let py = min(max(Int(y * scale), 0), height - 1)
      let i = (py * width + px) * 4
      return (Int(rgba[i]), Int(rgba[i + 1]), Int(rgba[i + 2]))
    }

    /// Mean colour along a horizontal line, sampled every 2 pt, so one stray
    /// glyph pixel doesn't decide the result.
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

  /**
   Like `pixels().at`, but also correct when the window is rotated: screenshots
   are always in portrait orientation. Handles `landscapeLeft`, the only
   rotation the suite uses. Takes a single screenshot.
   */
  func windowSampler() throws -> (CGFloat, CGFloat) -> (r: Int, g: Int, b: Int) {
    let window = app.windows.element(boundBy: 0).frame
    let sideways = window.width > window.height
    let read = try XCTUnwrap(
      Pixels(XCUIScreen.main.screenshot(), pointHeight: sideways ? window.width : window.height),
      "could not read the screen")
    if sideways {
      return { x, y in read.at(x: window.height - y, y: x) }
    }
    return { x, y in read.at(x: x, y: y) }
  }

  /**
   Screenshots taken while a drag is held. `press(…thenHoldForDuration:)` spins
   the main run loop while it blocks, so blocks queued with `asyncAfter` run
   during the hold. Only take screenshots in them: XCUITest can't query
   elements or send events while the press is running.
   */
  func shotsDuringDrag(
    from start: XCUICoordinate,
    by dx: CGFloat,
    at moments: [Double],
    velocity: XCUIGestureVelocity = 600
  ) -> [XCUIScreenshot] {
    var shots: [XCUIScreenshot] = []
    for moment in moments {
      DispatchQueue.main.asyncAfter(deadline: .now() + moment) {
        shots.append(XCUIScreen.main.screenshot())
      }
    }
    start.press(
      forDuration: 0.1, thenDragTo: start.withOffset(CGVector(dx: dx, dy: 0)),
      withVelocity: velocity, thenHoldForDuration: (moments.max() ?? 0) + 0.5)
    return shots
  }

  /// How far apart two colours are, as the largest per-channel difference.
  func distance(_ a: (r: Int, g: Int, b: Int), _ b: (r: Int, g: Int, b: Int)) -> Int {
    max(abs(a.r - b.r), max(abs(a.g - b.g), abs(a.b - b.b)))
  }

  // MARK: - Gestures

  /**
   Dismisses the keyboard by dragging from the transcript into it, and fails the
   test if it stays up. (The screens have no Done button, and
   `typeText(escape)` does nothing to a software keyboard.)
   */
  func dismissKeyboard(file: StaticString = #filePath, line: UInt = #line) {
    guard app.keyboards.count > 0 else { return }
    let window = app.windows.element(boundBy: 0)
    let start = window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.30))
    let end = window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.99))
    // Two tries: after XCUITest has typed on the software keys, the first drag
    // doesn't dismiss the keyboard (iOS 27). A tap on the transcript would
    // work too, but can hit a balloon.
    for _ in 0..<2 {
      // Not faster: a 2500 pt/s drag flung a three-message transcript into a
      // bounce that never settled, and XCUITest then waited its full minute
      // for the app to go idle before every step that followed
      start.press(forDuration: 0.05, thenDragTo: end, withVelocity: 800, thenHoldForDuration: 0.2)
      if vanishes(app.keyboards.element(boundBy: 0), within: 4) {
        return
      }
    }
    XCTFail("the keyboard would not go away", file: file, line: line)
  }

  // MARK: - Typing

  /**
   Types by tapping the software keyboard's keys. Use this instead of
   `typeText` when the keyboard must not move: `typeText` sends hardware key
   events, which make iOS lower the software keyboard and raise it again on the
   next touch. Each key's position is looked up once (a lookup by label
   snapshots the whole app), matching either case because the keyboard
   auto-capitalises.
   */
  func typeOnKeys(_ text: String, file: StaticString = #filePath, line: UInt = #line) {
    for character in text.lowercased() {
      if keyCentres[character] == nil {
        let key = app.keys.matching(NSPredicate(format: "label ==[c] %@", String(character))).firstMatch
        guard appears(key, within: 3) else {
          XCTFail("no \"\(character)\" key on the keyboard while typing \"\(text)\"", file: file, line: line)
          return
        }
        keyCentres[character] = CGVector(dx: key.frame.midX, dy: key.frame.midY)
      }
      app.coordinate(withNormalizedOffset: .zero).withOffset(keyCentres[character]!).tap()
    }
  }

  /// Looks up every key `text` needs in advance, so `typeOnKeys` only taps.
  func findKeys(for text: String, file: StaticString = #filePath, line: UInt = #line) {
    for character in Set(text.lowercased()) where keyCentres[character] == nil {
      let key = app.keys.matching(NSPredicate(format: "label ==[c] %@", String(character))).firstMatch
      guard appears(key, within: 3) else {
        XCTFail("no \"\(character)\" key on the keyboard", file: file, line: line)
        continue
      }
      keyCentres[character] = CGVector(dx: key.frame.midX, dy: key.frame.midY)
    }
  }

  private var keyCentres: [Character: CGVector] = [:]

  /**
   Types through the hardware-key path in chunks of sixteen glyphs. One
   `typeText` call is one synthesized event, forty times cheaper than a tap per
   key; the chunks are because a long string in one call has come back a line
   taller than it is. Use `typeOnKeys` only where the software keyboard must
   not move: this path can take it down and dock the bar.
   */
  func typeInChunks(_ text: String) {
    var rest = Substring(text)
    while !rest.isEmpty {
      let chunk = rest.prefix(16)
      type(String(chunk))
      rest = rest.dropFirst(chunk.count)
    }
  }

  /**
   Types into the text view that has the keyboard. Not `app.typeText`: that
   first asks every element in the tree whether it has keyboard focus, which
   took 2.6 s on a chat with three messages; the text views alone answer at
   once.
   */
  func type(_ text: String) {
    app.textViews.matching(NSPredicate(format: "hasKeyboardFocus == true")).firstMatch.typeText(text)
  }

  // MARK: - Waiting on what can be seen

  /// Polls `condition` until it holds or `timeout` passes, every `interval`.
  /// The replacement for a sleep whose length was a guess at how long
  /// something takes: it ends the moment the thing has happened.
  @discardableResult
  func waitUntil(_ timeout: TimeInterval = 8, interval: TimeInterval = 0.1, _ condition: () -> Bool) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      if condition() {
        return true
      }
      Thread.sleep(forTimeInterval: interval)
    }
    return condition()
  }

  /**
   Whether the element exists within `timeout`, looked for every twentieth of a
   second. Not `waitForExistence(timeout:)`: that sleeps a whole second before
   its first look, so it cost 1.1 s on an element that was already there —
   measured, and paid about three hundred times a run. An `exists` on the chat
   screen costs a hundredth of a second.
   */
  func appears(_ element: XCUIElement, within timeout: TimeInterval = 8) -> Bool {
    waitUntil(timeout, interval: 0.05) { element.exists }
  }

  /// The counterpart of `appears`, for `waitForNonExistence(timeout:)`.
  func vanishes(_ element: XCUIElement, within timeout: TimeInterval = 8) -> Bool {
    waitUntil(timeout, interval: 0.05) { !element.exists }
  }

  /**
   The element's frame once it has stopped moving: the same frame, within half
   a point, on two reads a tenth of a second apart. A UIKit animation is already
   over when the tap that started it returns (XCUITest waits for the app to go
   quiet), so this is for what follows one — a React commit, the transcript
   taking its inset, a CSS transition the renderer drives frame by frame — which
   XCUITest cannot see and a sleep used to guess at.
   */
  @discardableResult
  func settled(
    _ element: XCUIElement, timeout: TimeInterval = 8, file: StaticString = #filePath, line: UInt = #line
  ) -> CGRect {
    var last = element.frame
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      Thread.sleep(forTimeInterval: 0.1)
      let now = element.frame
      if abs(now.minX - last.minX) < 0.5, abs(now.minY - last.minY) < 0.5,
        abs(now.width - last.width) < 0.5, abs(now.height - last.height) < 0.5
      {
        return now
      }
      last = now
    }
    XCTFail("still moving after \(timeout) s: \(element)", file: file, line: line)
    return last
  }

  /// The keyboard, up and at rest: the field's bottom edge no longer moving.
  func waitForKeyboard(over field: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
    XCTAssertTrue(
      appears(app.keyboards.element(boundBy: 0), within: 8), "the keyboard never came up", file: file, line: line)
    settled(field, file: file, line: line)
  }

  // MARK: - Finding text

  /**
   The element whose label equals `exact`, of any type. Use this rather than
   `app.staticTexts`: the demo's text (`<p>`, or text in a `<div>`) is exposed
   as an `Other` element, not a `StaticText`.
   */
  func text(_ exact: String) -> XCUIElement {
    app.descendants(matching: .any)
      .matching(NSPredicate(format: "label == %@", exact))
      .firstMatch
  }

  /// Whether the element's frame is inside the window. `exists` is also true
  /// for mounted rows scrolled far off screen.
  func isOnScreen(_ element: XCUIElement) -> Bool {
    guard element.exists else { return false }
    let window = app.windows.element(boundBy: 0).frame
    let frame = element.frame
    return frame.height > 0 && frame.minY >= window.minY && frame.maxY <= window.maxY
  }

  /// The bottom edge, in window points, of the lowest "Message N, …" balloon
  /// above `limit`. Matching the label skips the navigation title, a static
  /// text that never moves.
  func lowestMessageBottom(above limit: CGFloat) -> CGFloat {
    let balloons = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH 'Message '"))
    var lowest: CGFloat = 0
    for balloon in balloons.allElementsBoundByIndex {
      let frame = balloon.frame
      if frame.height > 0 && frame.maxY <= limit + 0.5 && frame.maxY > lowest {
        lowest = frame.maxY
      }
    }
    return lowest
  }

  // MARK: - The diagnostics dump

  /**
   Opens the diagnostics alert (AppDelegate.mm's two-finger double tap), returns
   its message, and keeps recording. The counts are read from the alert, not
   the pasteboard: reading the pasteboard raises a paste prompt XCUITest can't
   dismiss, and the suite hangs. The keyboard is dismissed first and a visible
   element tapped: XCUITest can't compute a gesture point on the window, the
   app, or an element the keyboard covers, and the recogniser is on the window,
   so any element works.
   */
  func dumpAlertMessage(file: StaticString = #filePath, line: UInt = #line) -> String {
    dismissKeyboard(file: file, line: line)
    let anywhere = app.staticTexts.firstMatch
    XCTAssertTrue(appears(anywhere, within: 10), "nothing on screen to tap", file: file, line: line)
    anywhere.tap(withNumberOfTaps: 2, numberOfTouches: 2)
    let alert = app.alerts.firstMatch
    XCTAssertTrue(appears(alert, within: 15), "the dump alert never appeared", file: file, line: line)
    let message = alert.staticTexts.element(boundBy: 1).label
    print("MEASURE dump-alert=\(message)")
    alert.buttons["Keep recording"].tap()
    return message
  }

  // MARK: - Holding a balloon

  /// Long-presses a balloon's centre through a coordinate, which opens the
  /// platform's context menu: pressing the element itself fails with "Not
  /// hittable" (a balloon's text is drawn by its box, not a view).
  func hold(_ element: XCUIElement) {
    element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
      .press(forDuration: 0.9)
  }

  /**
   The composer's panel `+` button. The labels must match the
   `accessibilityLabel`s in Composer.js: "More", or "More, panel" when
   `PLUS_KIND = 'both'` shows all three.
   */
  func plusButton() -> XCUIElement {
    let labelled = app.buttons["More, panel"]
    return labelled.exists ? labelled : app.buttons["More"]
  }

  /// Opens the `+` panel and taps the command with this title.
  func chooseCommand(_ title: String, file: StaticString = #filePath, line: UInt = #line) {
    let plus = plusButton()
    XCTAssertTrue(appears(plus, within: 10), "no + button", file: file, line: line)
    plus.tap()

    let command = app.buttons[title]
    XCTAssertTrue(
      appears(command, within: 8),
      "the panel never offered \(title); visible: \(visibleText())",
      file: file,
      line: line)
    command.tap()
    // The panel has closed once the command's button is gone.
    _ = vanishes(command, within: 5)
  }

  /// A short summary of the screen for failure messages. Kept to two bounded
  /// queries: `allElementsBoundByIndex` can throw while the tree changes, and
  /// `app.debugDescription` hangs on a 200-message transcript.
  func visibleText() -> String {
    let count = app.staticTexts.count
    let first = app.staticTexts.firstMatch
    let label = first.exists ? first.label : "(none)"
    return "\(count) static texts; first: \(label)"
  }
}
