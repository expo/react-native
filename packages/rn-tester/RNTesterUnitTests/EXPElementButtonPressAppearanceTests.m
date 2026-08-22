/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>
#import <XCTest/XCTest.h>
#import <objc/message.h>

/**
 * What a press looks like on iOS, pinned to the measured value.
 *
 * A real `UIButton` was rendered in both states on the simulator and its pixels
 * compared: UIKit's highlight multiplies the whole button by alpha 0.75 — a
 * gray configuration's fill goes 41/255 to 31/255 and a filled one's 255 to
 * 191, the same factor. The press feedback used to be `opacity: 0.6` applied
 * from React state, which was the wrong number applied from the wrong thread.
 *
 * The class is resolved by name and the private `setPressed:` seam is driven
 * directly, because this is a unit test of the appearance rule, not of touch
 * delivery — `touchesBegan:` needs real `UITouch`es, which XCTest cannot make.
 * Scroll-cancel and delivery timing are exercised on the device.
 */
@interface EXPElementButtonPressAppearanceTests : XCTestCase
@end

@implementation EXPElementButtonPressAppearanceTests

static void setPressed(UIView *view, BOOL pressed)
{
  void (*call)(id, SEL, BOOL) = (void (*)(id, SEL, BOOL))objc_msgSend;
  call(view, NSSelectorFromString(@"setPressed:"), pressed);
}

- (UIView *)makeButtonView
{
  Class cls = NSClassFromString(@"EXPElementButtonComponentView");
  XCTAssertNotNil(cls, @"EXPElementButtonComponentView is not linked into the test host");
  UIView *view = [[cls alloc] initWithFrame:CGRectMake(0, 0, 120, 44)];
  XCTAssertTrue([view respondsToSelector:NSSelectorFromString(@"setPressed:")]);
  return view;
}

- (void)testPressDimsTheWholeButtonByUIKitsFactor
{
  UIView *view = [self makeButtonView];
  XCTAssertEqualWithAccuracy(view.alpha, 1.0, 0.001);

  setPressed(view, YES);
  XCTAssertEqualWithAccuracy(view.alpha, 0.75, 0.001, @"UIKit's highlight is x0.75, measured");

  setPressed(view, NO);
  XCTAssertEqualWithAccuracy(view.alpha, 1.0, 0.001, @"release must restore the resting alpha");
}

- (void)testRecycleClearsAPressInFlight
{
  UIView *view = [self makeButtonView];
  setPressed(view, YES);

  // A recycled view carries its alpha into whatever element it is reused for,
  // so the pool reset has to put it back.
  SEL prepareForRecycle = NSSelectorFromString(@"prepareForRecycle");
  if ([view respondsToSelector:prepareForRecycle]) {
    ((void (*)(id, SEL))objc_msgSend)(view, prepareForRecycle);
    XCTAssertEqualWithAccuracy(view.alpha, 1.0, 0.001);
  }
}

@end
