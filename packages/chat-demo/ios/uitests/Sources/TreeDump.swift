/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import XCTest

/**
 Prints the accessibility tree, for debugging a query that finds nothing.
 Always passes. (`idb describe-all` shows this app as one zero-sized element;
 XCUITest sees the whole tree.) Run it alone:

     xcodebuild test-without-building ... -only-testing:ChatDemoUITests/TreeDump
 */
// covers: screens/ChatScreen.js
final class TreeDump: DemoCase {
  func testPrintTheTree() throws {
    print("=== SAFE AREAS ===")
    print(app.debugDescription)

    app.links["Chat, with a composer"].tap()
    chooseCommand("Add fifty messages")
    print("=== CHAT ===")
    print(app.debugDescription)
  }
}
