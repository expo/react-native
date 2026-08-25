/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>
#import <XCTest/XCTest.h>

#import <React/RCTViewComponentView.h>

/*
 * Why press feedback is driven by a view's TOUCHES and not by a recognizer.
 *
 * A scroll view's `delaysContentTouches` holds a touch back for a moment to see
 * whether a scroll was meant, and it does so by delaying delivery *to the
 * view*. Gesture recognizers are outside that — UIKit hands them the touch
 * immediately, whatever the scroll view decides later — so recognizer-driven
 * feedback lights up under a finger that was only passing through. Reported
 * from the device against a run of `<input type="radio">` rows: every row a
 * scrolling finger crossed lit up on the way past.
 *
 * The first fix reimplemented the wait, with UIKit's own 0.15 read out of
 * `-[UIScrollView _touchDelayForScrollDetection]`. It worked and it was still
 * wrong: none of that timing is ours to hold. This is the seam that lets chrome
 * ask the platform instead — and these say that a view reports its touches, and
 * that a view nobody is watching is unchanged.
 *
 * The timing itself is UIKit's and not tested here; what is tested is that we
 * are asking for it rather than reproducing it.
 */
@interface EXPPressSpy : NSObject <RCTViewPressObserver>
@property (nonatomic, assign) BOOL pressed;
@property (nonatomic, assign) NSUInteger reports;
@end

@implementation EXPPressSpy
- (void)pressedView:(UIView *)view didBecomePressed:(BOOL)pressed
{
  _pressed = pressed;
  _reports++;
}
@end

@interface RCTViewPressObserverTests : XCTestCase
@end

@implementation RCTViewPressObserverTests

- (void)testAViewHasNoObserverUnlessChromeAsksForOne
{
  // The default has to be nothing: this runs on every view in every tree.
  XCTAssertNil([RCTViewComponentView new].pressObserver);
}

- (void)testAViewReportsAFingerLandingAndLifting
{
  RCTViewComponentView *view = [RCTViewComponentView new];
  EXPPressSpy *spy = [EXPPressSpy new];
  view.pressObserver = spy;

  [view touchesBegan:[NSSet set] withEvent:nil];
  XCTAssertTrue(spy.pressed);

  [view touchesEnded:[NSSet set] withEvent:nil];
  XCTAssertFalse(spy.pressed);
}

- (void)testACANCELLEDTouchReleasesThePress
{
  /*
   * The case the whole seam exists for: an enclosing scroll view claiming the
   * gesture once the finger has moved far enough to be a scroll. The press must
   * release — a row left lit under a scrolling finger is the reported bug.
   */
  RCTViewComponentView *view = [RCTViewComponentView new];
  EXPPressSpy *spy = [EXPPressSpy new];
  view.pressObserver = spy;

  [view touchesBegan:[NSSet set] withEvent:nil];
  [view touchesCancelled:[NSSet set] withEvent:nil];

  XCTAssertFalse(spy.pressed);
}

- (void)testAViewNobodyIsWatchingIsUnchanged
{
  // No observer, no crash, and nothing reported — the state every other view in
  // the tree is in.
  RCTViewComponentView *view = [RCTViewComponentView new];
  XCTAssertNoThrow([view touchesBegan:[NSSet set] withEvent:nil]);
  XCTAssertNoThrow([view touchesEnded:[NSSet set] withEvent:nil]);
  XCTAssertNoThrow([view touchesCancelled:[NSSet set] withEvent:nil]);
}

- (void)testTheObserverIsWEAK
{
  /*
   * Chrome going away must not leave a view reporting into freed memory. The
   * radio coordinator is held by the container, not by the rows it watches.
   */
  RCTViewComponentView *view = [RCTViewComponentView new];
  @autoreleasepool {
    EXPPressSpy *spy = [EXPPressSpy new];
    view.pressObserver = spy;
    XCTAssertNotNil(view.pressObserver);
  }
  XCTAssertNil(view.pressObserver);
}

@end
