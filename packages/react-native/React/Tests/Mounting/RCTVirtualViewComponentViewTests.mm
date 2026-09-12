/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <React/RCTVirtualViewComponentView.h>
#import <XCTest/XCTest.h>

/**
 * `-containerRelativeRect:` must agree with UIKit, exactly.
 *
 * It no longer asks UIKit: the conversion is arithmetic up the superview chain,
 * because `-convertRect:toView:` goes through `CALayer` and the container calls
 * it for every registered view on every scroll event — which was the single
 * largest cost on the main thread while a long list was moving. These pin the
 * arithmetic to the answer it replaced, including the cases it refuses to
 * compute and hands back to UIKit.
 */
@interface RCTVirtualViewComponentViewTests : XCTestCase
@end

@implementation RCTVirtualViewComponentViewTests {
  UIScrollView *_scrollView;
  UIView *_content;
  UIView *_row;
  RCTVirtualViewComponentView *_virtualView;
}

- (void)setUp
{
  [super setUp];
  /*
   * The shape a `VirtualView` is actually in: a row inside a content view
   * inside the scroll view. Two steps, which is the case the walk is for.
   */
  _scrollView = [[UIScrollView alloc] initWithFrame:CGRectMake(0, 0, 400, 800)];
  _content = [[UIView alloc] initWithFrame:CGRectMake(0, 0, 400, 20000)];
  _row = [[UIView alloc] initWithFrame:CGRectMake(0, 5000, 400, 64)];
  _virtualView = [[RCTVirtualViewComponentView alloc] initWithFrame:CGRectMake(16, 12, 368, 40)];
  [_row addSubview:_virtualView];
  [_content addSubview:_row];
  [_scrollView addSubview:_content];
  _scrollView.contentSize = _content.bounds.size;
}

- (void)_assertAgreesWithUIKit:(NSString *)what
{
  const CGRect expected = [_virtualView convertRect:_virtualView.bounds toView:_scrollView];
  const CGRect actual = [_virtualView containerRelativeRect:_scrollView];
  XCTAssertTrue(
      CGRectEqualToRect(expected, actual),
      @"%@: expected %@, got %@",
      what,
      NSStringFromCGRect(expected),
      NSStringFromCGRect(actual));
}

- (void)testAgreesWithUIKitAtRest
{
  [self _assertAgreesWithUIKit:@"at rest"];
  XCTAssertTrue(
      CGRectEqualToRect([_virtualView containerRelativeRect:_scrollView], CGRectMake(16, 5012, 368, 40)),
      @"the rect is the sum of the frames, in content coordinates");
}

- (void)testIsInContentCoordinatesAndDoesNotMoveWhenScrolled
{
  const CGRect atRest = [_virtualView containerRelativeRect:_scrollView];
  _scrollView.contentOffset = CGPointMake(0, 4800);
  [self _assertAgreesWithUIKit:@"scrolled"];
  /*
   * The whole reason the container can compare this against `contentOffset`: a
   * scroll moves the scroll view's BOUNDS, not its content, so a row's rect in
   * content coordinates is the same number before and after.
   */
  XCTAssertTrue(
      CGRectEqualToRect(atRest, [_virtualView containerRelativeRect:_scrollView]),
      @"scrolling must not move a row in content coordinates");
}

- (void)testAgreesWithUIKitThroughANonZeroBoundsOrigin
{
  // A scrolled ancestor of its own — the term the walk subtracts at each step.
  _row.bounds = CGRectMake(7, 3, _row.bounds.size.width, _row.bounds.size.height);
  [self _assertAgreesWithUIKit:@"through a bounds origin"];
}

- (void)testFallsBackToUIKitUnderATransform
{
  // Not computable by adding origins, so it must not be computed that way.
  _row.transform = CGAffineTransformMakeScale(0.5, 0.5);
  [self _assertAgreesWithUIKit:@"under a transform on an ancestor"];
  _row.transform = CGAffineTransformIdentity;
  _virtualView.transform = CGAffineTransformMakeTranslation(11, 13);
  [self _assertAgreesWithUIKit:@"under a transform on the view itself"];
}

- (void)testRemembersTheFrameItWasGiven
{
  // The container reads this instead of `-[UIView frame]` on every scroll
  // event, so it has to be the same number however the frame was set.
  XCTAssertTrue(CGRectEqualToRect(_virtualView.virtualViewGeometry.frame, _virtualView.frame), @"from -initWithFrame:");

  _virtualView.frame = CGRectMake(3, 5, 100, 20);
  XCTAssertTrue(CGRectEqualToRect(_virtualView.virtualViewGeometry.frame, _virtualView.frame), @"after -setFrame:");

  _virtualView.bounds = CGRectMake(0, 0, 200, 40);
  XCTAssertTrue(CGRectEqualToRect(_virtualView.virtualViewGeometry.frame, _virtualView.frame), @"after -setBounds:");

  _virtualView.center = CGPointMake(77, 88);
  XCTAssertTrue(CGRectEqualToRect(_virtualView.virtualViewGeometry.frame, _virtualView.frame), @"after -setCenter:");
}

- (void)testRemembersTheSuperviewItWasAddedTo
{
  XCTAssertEqual(_virtualView.virtualViewGeometry.superview, _row, @"after being added");

  [_virtualView removeFromSuperview];
  XCTAssertNil(_virtualView.virtualViewGeometry.superview, @"after being removed");

  [_content addSubview:_virtualView];
  XCTAssertEqual(_virtualView.virtualViewGeometry.superview, _content, @"after being moved");
}

- (void)testFallsBackToUIKitWhenNotADescendant
{
  [_virtualView removeFromSuperview];
  UIScrollView *other = [[UIScrollView alloc] initWithFrame:CGRectMake(0, 0, 400, 800)];
  [other addSubview:_virtualView];
  [self _assertAgreesWithUIKit:@"in a different scroll view"];
}

@end
