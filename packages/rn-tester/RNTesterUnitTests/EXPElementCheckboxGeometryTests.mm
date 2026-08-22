/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>
#import <XCTest/XCTest.h>

#import <React/EXPElementCheckboxComponentView.h>

/*
 * The user-agent sheet states `<input type="checkbox">`'s footprint as the
 * literal size of the control that backs it, because a UISwitch IGNORES
 * assigned sizes: whatever box layout gives it, the control snaps back to its
 * own intrinsic size. When the sheet's numbers and the control's disagree, the
 * excess must hang out the TRAILING side only — the leading edge is the
 * element's alignment edge, and it must sit exactly where layout put the box.
 *
 * Two ways the sizes have really disagreed: iOS 26 grew UISwitch to 63x28
 * after a decade at 51x31 (the constant test below names the next resize),
 * and the accessibility content-size categories grow the control at runtime,
 * which no sheet constant can know. Centring the mismatch spilled half of it
 * past the text margin — a user's device screenshot showed a switch 6pt left
 * of the paragraph edge at large Dynamic Type.
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
   * ENFORCES when handed a frame. The literals MUST equal
   * `CHECKABLE_FOOTPRINT_BY_PLATFORM.ios` in
   * packages/expo-intrinsics/src/index.js (the identical-strings rule —
   * update both together).
   */
  UISwitch *control = [[UISwitch alloc] init];
  [control sizeToFit];
  XCTAssertEqualWithAccuracy(control.bounds.size.width, 63, 0.5, @"UISwitch width changed — update CHECKABLE_FOOTPRINT_BY_PLATFORM.ios");
  XCTAssertEqualWithAccuracy(control.bounds.size.height, 28, 0.5, @"UISwitch height changed — update CHECKABLE_FOOTPRINT_BY_PLATFORM.ios");
}

- (void)testControlOverflowHangsTrailingOnly
{
  // A box DELIBERATELY narrower and shorter than the control: the switch must
  // keep its leading edge on the box's leading edge and centre vertically,
  // spilling only to the trailing side — where the sheet's inline-end margin
  // and the platform's label gap budget the space.
  EXPElementCheckboxComponentView *view =
      [[EXPElementCheckboxComponentView alloc] initWithFrame:CGRectMake(0, 0, 40, 20)];
  [view layoutIfNeeded];

  UISwitch *control = nil;
  for (UIView *subview in view.subviews) {
    if ([subview isKindOfClass:[UISwitch class]]) {
      control = (UISwitch *)subview;
    }
  }
  XCTAssertNotNil(control);
  XCTAssertEqualWithAccuracy(CGRectGetMinX(control.frame), 0, 0.01, @"the control's leading edge is the element's alignment edge");
  XCTAssertGreaterThan(CGRectGetMaxX(control.frame), 40, @"the mismatch hangs out the trailing side");
  XCTAssertEqualWithAccuracy(CGRectGetMidY(control.frame), 10, 0.5, @"vertically centred in the box");
}

@end
