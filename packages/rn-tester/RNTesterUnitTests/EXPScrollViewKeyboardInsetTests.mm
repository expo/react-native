/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <XCTest/XCTest.h>

#import <React/EXPScrollViewComponentView.h>

/**
 * How much of a scroll view the keyboard claims. With no keyboard up, the
 * keyboard guide rests on the bottom safe area, so the obstruction the scroll
 * view is told about is the home indicator's strip; that strip is the safe
 * area, which `automaticInsets.bottom` decides, and the keyboard must not
 * reserve it a second time. A page that runs under the indicator with
 * `automaticInsets.bottom` off had 34 points of empty scroll range below its
 * content.
 */
@interface EXPScrollViewKeyboardInsetTests : XCTestCase
@end

@implementation EXPScrollViewKeyboardInsetTests

static const CGFloat kWindowHeight = 874;
static const CGFloat kSafeArea = 34;

- (void)testTheHomeIndicatorStripIsNotAKeyboard
{
  // A full-screen scroll view, the guide resting on the safe area
  CGFloat inset = EXPScrollViewKeyboardInset(kWindowHeight, kWindowHeight - kSafeArea, kWindowHeight, kSafeArea);

  XCTAssertEqualWithAccuracy(
      inset, 0, 0.01, @"the strip is the safe area, which the scroll view reserves itself or deliberately does not");
}

- (void)testAKeyboardClaimsWhatItCovers
{
  // A 335pt keyboard over a full-screen scroll view
  CGFloat inset = EXPScrollViewKeyboardInset(kWindowHeight, kWindowHeight - 335, kWindowHeight, kSafeArea);

  XCTAssertEqualWithAccuracy(inset, 335, 0.01, @"the keys cover the home indicator too, so all of it is claimed");
}

- (void)testABarDockedAboveTheStripClaimsWhatItCovers
{
  // An accessory resting above the indicator with the keyboard down: the
  // obstruction is the bar's top, above the strip
  CGFloat inset = EXPScrollViewKeyboardInset(kWindowHeight, kWindowHeight - kSafeArea - 52, kWindowHeight, kSafeArea);

  XCTAssertEqualWithAccuracy(inset, kSafeArea + 52, 0.01);
}

- (void)testAScrollViewAboveTheKeyboardIsNotCovered
{
  // A scroll view ending 400pt above the bottom, a 335pt keyboard below it
  CGFloat inset = EXPScrollViewKeyboardInset(kWindowHeight - 400, kWindowHeight - 335, kWindowHeight, kSafeArea);

  XCTAssertEqualWithAccuracy(inset, 0, 0.01);
}

- (void)testWithNoSafeAreaAKeyboardAtTheEdgeClaimsNothing
{
  // A device without a home indicator: the resting guide is at the window's edge
  CGFloat inset = EXPScrollViewKeyboardInset(kWindowHeight, kWindowHeight, kWindowHeight, 0);

  XCTAssertEqualWithAccuracy(inset, 0, 0.01);
}

@end
