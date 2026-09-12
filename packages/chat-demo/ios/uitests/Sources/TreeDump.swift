/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 Prints the accessibility tree, so a query that finds nothing can be told apart
 from an app that exposes nothing.

 Not an assertion — it always passes. It exists because both of those look
 identical from a failing `XCTAssertTrue(element.exists)`, and guessing which
 one it is has cost more than one wrong diagnosis: `idb describe-all` reports a
 single zero-sized element for this app, which reads exactly like "the app is
 invisible to accessibility" and is in fact a broken instrument. XCUITest can
 see the tree perfectly well.

 Run it alone when a query is behaving oddly:

     xcodebuild test-without-building ... -only-testing:ChatDemoUITests/TreeDump
 */
final class TreeDump: DemoCase {
  func testPrintTheTree() throws {
    print("=== SAFE AREAS ===")
    print(app.debugDescription)

    app.links["Chat, with a composer"].tap()
    // Through the panel, like everything else. The row of buttons under the
    // field that this used to tap — `+50` — has not existed since the commands
    // moved behind the `+`, so the one test whose whole point is to be readable
    // when a query goes wrong was itself failing on a query that could never
    // succeed.
    chooseCommand("Add fifty messages")
    print("=== CHAT ===")
    print(app.debugDescription)
  }
}
