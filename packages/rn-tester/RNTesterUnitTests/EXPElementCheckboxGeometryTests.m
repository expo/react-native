/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>
#import <XCTest/XCTest.h>

/*
 * The user-agent sheet states `<input type="checkbox">`'s footprint as the
 * literal size of the control that backs it, because a UISwitch IGNORES
 * assigned sizes: whatever box layout gives it, the control snaps back to its
 * own intrinsic size. When the sheet's numbers and the control's disagree, the
 * switch hangs out of the right edge of its layout box and swallows the
 * checkable-label margin plus the label's own space — the label reads as glued
 * to the switch, and nothing warns.
 *
 * That is exactly what happened when iOS 26 grew UISwitch to 63x28 after a
 * decade at 51x31. This test turns the next such resize into a named failure:
 * the literals below MUST equal `CHECKABLE_FOOTPRINT_BY_PLATFORM.ios` in
 * packages/expo-intrinsics/src/index.js (the identical-strings rule — update
 * both together).
 */
@interface EXPElementCheckboxGeometryTests : XCTestCase
@end

@implementation EXPElementCheckboxGeometryTests

- (void)testSwitchEnforcedSizeMatchesTheUserAgentSheet
{
  /*
   * `sizeToFit`, not `intrinsicContentSize`: the two DISAGREE (this test
   * found that — intrinsic reports a width of 61 while the control snaps any
   * assigned frame to 63). What matters to layout is the size the control
   * ENFORCES when handed a frame, and that is `sizeThatFits`' answer, which
   * is also the rectangle the component view centres.
   */
  UISwitch *control = [[UISwitch alloc] init];
  [control sizeToFit];
  XCTAssertEqualWithAccuracy(control.bounds.size.width, 63, 0.5, @"UISwitch width changed — update CHECKABLE_FOOTPRINT_BY_PLATFORM.ios");
  XCTAssertEqualWithAccuracy(control.bounds.size.height, 28, 0.5, @"UISwitch height changed — update CHECKABLE_FOOTPRINT_BY_PLATFORM.ios");
}

@end
