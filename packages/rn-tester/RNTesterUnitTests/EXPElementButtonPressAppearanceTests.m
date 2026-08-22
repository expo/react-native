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

- (void)testAnAuthorSURFACEStillAnswersAPressWhenTheAuthorDoesNot
{
  /*
   * The dim is what UIKit does to the fill IT draws, so once the author has
   * claimed the surface there is no platform drawing left to dim. Nothing was
   * dimmed at all on that reasoning — and a `<button>` with a background and a
   * finger on it then looked exactly like one with no finger on it, which
   * reads as a control that is not responding rather than as a decision.
   *
   * So the platform answers when nobody else will. Which case it is comes from
   * `authorStatesPressFeedback`, computed where the styles are.
   */
  UIView *view = [self makeButtonView];
  UIView *label = [[UIView alloc] initWithFrame:view.bounds];
  [view addSubview:label];

  setPressed(view, YES);
  XCTAssertEqualWithAccuracy(view.alpha, 0.75, 0.001, @"an unanswered press is answered by the platform");
  XCTAssertEqualWithAccuracy(label.alpha, 1.0, 0.001, @"the whole button dims, not its contents twice over");

  setPressed(view, NO);
  XCTAssertEqualWithAccuracy(view.alpha, 1.0, 0.001);
}

- (void)testTheRuleItself
{
  /*
   * The decision as a pure function, which is the only way to reach the
   * author-answers-it branch from here: the flag arrives on the C++ props and
   * this file is plain Objective-C.
   *
   * Both feedbacks at once is the failure it guards: ours lands instantly and
   * the author's transitions over its own duration, reported from a device as
   * a button that goes dark on press and then changes colour again.
   */
  Class cls = NSClassFromString(@"EXPElementButtonComponentView");
  XCTAssertNotNil(cls);
  SEL rule = NSSelectorFromString(@"pressedAlphaWhenPressed:authorStatesPressFeedback:");
  XCTAssertTrue([cls respondsToSelector:rule]);
  CGFloat (*call)(id, SEL, BOOL, BOOL) = (CGFloat (*)(id, SEL, BOOL, BOOL))objc_msgSend;

  XCTAssertEqualWithAccuracy(call(cls, rule, YES, NO), 0.75, 0.001, @"nobody else is drawing it");
  XCTAssertEqualWithAccuracy(call(cls, rule, YES, YES), 1.0, 0.001, @"the author is drawing it");
  XCTAssertEqualWithAccuracy(call(cls, rule, NO, NO), 1.0, 0.001, @"not pressed");
  XCTAssertEqualWithAccuracy(call(cls, rule, NO, YES), 1.0, 0.001);
}

- (void)testPlatformCHROMEDimsItsContentByUIKitsFactor
{
  /*
   * The other regime: UIKit highlights the fill it drew, and the children it
   * cannot own are dimmed here by the measured x0.75 it applies to its own
   * title. The chrome is installed directly because it is otherwise built from
   * props, and this is a test of the appearance rule.
   */
  UIView *view = [self makeButtonView];
  UIButton *chrome = [UIButton buttonWithType:UIButtonTypeSystem];
  chrome.frame = view.bounds;
  [view addSubview:chrome];
  [view setValue:chrome forKey:@"chromeButton"];
  UIView *label = [[UIView alloc] initWithFrame:view.bounds];
  [view addSubview:label];

  setPressed(view, YES);
  XCTAssertTrue(chrome.highlighted, @"the platform highlights the fill it drew");
  XCTAssertEqualWithAccuracy(label.alpha, 0.75, 0.001, @"UIKit's highlight is x0.75, measured");
  XCTAssertEqualWithAccuracy(view.alpha, 1.0, 0.001, @"the box itself is not dimmed twice");

  setPressed(view, NO);
  XCTAssertFalse(chrome.highlighted);
  XCTAssertEqualWithAccuracy(label.alpha, 1.0, 0.001);
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
