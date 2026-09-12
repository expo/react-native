/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <XCTest/XCTest.h>

#import <React/EXPKeyboardInsets.h>

/**
 * The arithmetic that turns a follower's position into an obstruction.
 *
 * The sampling around it needs a real keyboard and is checked on a simulator, but
 * the edge cases live here: a follower below the window, a safe area larger than
 * the keyboard, the resting state where the two are the same number. None of
 * those need a device to provoke, and all of them have been wrong at some point.
 */
@interface EXPKeyboardGeometryTests : XCTestCase
@end

@implementation EXPKeyboardGeometryTests

static const CGFloat kWindowHeight = 874;
static const CGFloat kSafeArea = 34;

/**
 * A follower whose top is at `y`, with a fixed height.
 *
 * The height is deliberately NOT derived from the window: an earlier version
 * used `kWindowHeight - y`, which goes negative once the follower is below the
 * window — and `CGRectGetMinY` standardises such a rect, quietly returning the
 * BOTTOM edge instead. The below-the-window case then never produced a negative
 * subtraction at all, so the test for the clamp passed with the clamp deleted.
 */
static CGRect FollowerTopAt(CGFloat y)
{
  return CGRectMake(0, y, 402, 100);
}

- (void)testAKeyboardObstructsFromItsTopEdgeToTheBottomOfTheWindow
{
  // The guide's top at 539 on an 874pt window is a 335pt keyboard.
  EXPKeyboardGeometry geometry = EXPKeyboardGeometryFromFollower(FollowerTopAt(539), kWindowHeight, kSafeArea);

  XCTAssertEqualWithAccuracy(geometry.height, 335, 0.01);
  XCTAssertEqualWithAccuracy(geometry.safeArea, kSafeArea, 0.01);
}

- (void)testWithNoKeyboardTheObstructionIsTheSafeArea
{
  // UIKit rests the guide on the bottom safe area, which is what makes a bar
  // pinned to it correct in both states. The obstruction is then the indicator.
  EXPKeyboardGeometry geometry =
      EXPKeyboardGeometryFromFollower(FollowerTopAt(kWindowHeight - kSafeArea), kWindowHeight, kSafeArea);

  XCTAssertEqualWithAccuracy(geometry.height, kSafeArea, 0.01);
  XCTAssertEqualWithAccuracy(geometry.safeArea, kSafeArea, 0.01);
}

- (void)testAFollowerBelowTheWindowObstructsNothing
{
  // Reachable in the frames between asking the keyboard to hide and the guide
  // settling. A negative obstruction would be read downstream as a scroll view
  // that needs its content pushed DOWN, which is why this clamps rather than
  // trusting the subtraction.
  EXPKeyboardGeometry geometry = EXPKeyboardGeometryFromFollower(FollowerTopAt(kWindowHeight + 120), kWindowHeight, kSafeArea);

  XCTAssertEqualWithAccuracy(geometry.height, 0, 0.01);
}

- (void)testTheObstructionIsNotReducedByTheSafeAreaItContains
{
  // A keyboard is drawn OVER the home indicator, so the obstruction is the
  // keyboard's whole extent and not the part of it above the safe area. Reporting
  // 301 here would leave the last row of content behind the keyboard's bottom.
  EXPKeyboardGeometry geometry = EXPKeyboardGeometryFromFollower(FollowerTopAt(539), kWindowHeight, kSafeArea);

  XCTAssertEqualWithAccuracy(geometry.height, 335, 0.01);
  XCTAssertNotEqualWithAccuracy(geometry.height, 335 - kSafeArea, 0.01);
}

- (void)testASafeAreaTallerThanTheObstructionDoesNotGoNegative
{
  // An iPad with no home indicator reports zero; a device rotated mid-transition
  // can briefly report a safe area larger than what the follower covers.
  EXPKeyboardGeometry geometry =
      EXPKeyboardGeometryFromFollower(FollowerTopAt(kWindowHeight - 10), kWindowHeight, kSafeArea);

  XCTAssertEqualWithAccuracy(geometry.height, 10, 0.01);
  XCTAssertEqualWithAccuracy(geometry.safeArea, kSafeArea, 0.01);
  // The consumer subtracts these; the result has to be floored there, not here,
  // and this records that this function does NOT do it for them.
  XCTAssertLessThan(geometry.height, geometry.safeArea);
}


@end
