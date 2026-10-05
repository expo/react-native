/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>
#import <XCTest/XCTest.h>

#import <React/EXPElementControlMetricsProbe.h>
#import <objc/message.h>

/**
 * The press appearance, pinned to the measured value: UIKit's highlight
 * multiplies a `UIButton` by alpha 0.75 in both configurations. The private
 * `setPressed:` seam is driven directly, since `touchesBegan:` needs real
 * `UITouch`es XCTest cannot make.
 */
@interface EXPElementButtonPressAppearanceTests : XCTestCase
@end

/* What the platform says a press does, read the way the element reads it. */
static CGFloat PlatformPressDim(void)
{
  EXPPrewarmElementControlMetrics();
  return (CGFloat)facebook::react::elementControlMetrics().buttonPressedContentAlpha;
}

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
  XCTAssertEqualWithAccuracy(view.alpha, PlatformPressDim(), 0.001, @"an unanswered press is answered by the platform");
  XCTAssertEqualWithAccuracy(label.alpha, 1.0, 0.001, @"the whole button dims, not its contents twice over");

  setPressed(view, NO);
  XCTAssertEqualWithAccuracy(view.alpha, 1.0, 0.001);
}

- (void)testTheRuleItself
{
  // The decision as a pure function, since the flag arrives on the C++ props
  // and this file is plain Objective-C. Two feedbacks at once, the platform's
  // instant dim and the author's transition, is the failure it guards
  Class cls = NSClassFromString(@"EXPElementButtonComponentView");
  XCTAssertNotNil(cls);
  SEL rule = NSSelectorFromString(@"pressedAlphaWhenPressed:authorStatesPressFeedback:");
  XCTAssertTrue([cls respondsToSelector:rule]);
  CGFloat (*call)(id, SEL, BOOL, BOOL) = (CGFloat (*)(id, SEL, BOOL, BOOL))objc_msgSend;

  XCTAssertEqualWithAccuracy(call(cls, rule, YES, NO), PlatformPressDim(), 0.001, @"nobody else is drawing it");
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

  /*
   * Not `chrome.highlighted`: `UIControl` sets that flag from its OWN tracking,
   * so a press delivered by calling `setPressed:` never produces one, and
   * setting it does nothing on a glass button.
   */
  setPressed(view, YES);
  XCTAssertEqualWithAccuracy(
      label.alpha, PlatformPressDim(), 0.001, @"the content is dimmed by what UIKit dims its own by");
  XCTAssertEqualWithAccuracy(view.alpha, 1.0, 0.001, @"the box itself is not dimmed twice");

  setPressed(view, NO);
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

// The factor the element applies is read off a real button, and this asserts
// the reading against the control itself
- (void)testThePressDimIsReadFromARealButtonRatherThanWrittenDown
{
  UIButtonConfiguration *configuration = [UIButtonConfiguration filledButtonConfiguration];
  configuration.title = @"A";
  UIButton *button = [UIButton buttonWithConfiguration:configuration primaryAction:nil];
  UIWindow *window = [[UIWindow alloc] initWithFrame:CGRectMake(0, 0, 200, 100)];
  [window addSubview:button];
  [window layoutIfNeeded];
  const CGFloat rest = CGColorGetAlpha(button.titleLabel.textColor.CGColor);
  button.highlighted = YES;
  [window layoutIfNeeded];
  const CGFloat pressed = CGColorGetAlpha(button.titleLabel.textColor.CGColor);
  [button removeFromSuperview];

  XCTAssertGreaterThan(rest, 0.01, @"a rest title with no colour measures nothing");
  XCTAssertEqualWithAccuracy(
      PlatformPressDim(),
      pressed / rest,
      0.01,
      @"the published press dim is not what the control does to its own title");
}

@end
