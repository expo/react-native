/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>
#import <XCTest/XCTest.h>

#import <React/EXPScrollViewComponentView.h>

/*
 * A scroll indicator clears the corners that would cut it off.
 *
 * An indicator is drawn INSIDE the scroll view, so an ancestor with
 * `overflow: hidden` and a corner radius clips both of its ends — the arc
 * crosses the indicator's own column for the first and last `radius` points,
 * and it reads as a scroll bar that stops short of the list it belongs to.
 * Reported that way: "the scroll bar is cut off by the rounded corners at the
 * top and bottom".
 *
 * There are two things to hold here, and the second is the one that was
 * actually broken:
 *
 *  - the inset is the largest radius on any CLIPPING ancestor, walked up from
 *    the scroll view, because that is where an author puts it — a card with
 *    rounded corners holding a plain list, where the scroll view has no radius
 *    of its own at all;
 *  - it is applied from LAYOUT. It used to live inside the method that composes
 *    the content inset, which returns early when that inset has not changed —
 *    so a scroll view whose content inset never changes returned there on its
 *    very first layout and reached the indicator code exactly never. The panel
 *    in the keyboard demo's composer was one: its indicator inset had never
 *    been computed, and no amount of scrolling would have made it so.
 *
 * These are unit tests rather than UI tests because there is nothing to see:
 * XCUITest cannot read a scroll view's insets, and the indicator itself fades
 * within a second of a scroll ending, so a screenshot of it is a race. The
 * value is the thing being asserted.
 */
@interface EXPScrollIndicatorInsetTests : XCTestCase
@end

@implementation EXPScrollIndicatorInsetTests {
  UIView *_card;
  EXPScrollViewComponentView *_scroll;
}

- (void)setUp
{
  [super setUp];
  // A rounded, clipping card holding a plain list — the shape the fault came
  // from, and the shape an author writes as `overflow: hidden` plus a radius.
  _card = [[UIView alloc] initWithFrame:CGRectMake(0, 0, 300, 400)];
  _card.clipsToBounds = YES;
  _card.layer.cornerRadius = 30;

  _scroll = [[EXPScrollViewComponentView alloc] initWithFrame:_card.bounds];
  [_card addSubview:_scroll];
}

/// The card's radius reaches the indicator, top and bottom.
- (void)testAClippingRoundedAncestorInsetsTheIndicator
{
  [_scroll layoutIfNeeded];

  UIEdgeInsets indicator = _scroll.scrollView.verticalScrollIndicatorInsets;
  XCTAssertEqualWithAccuracy(
      indicator.top,
      30,
      0.01,
      @"the indicator starts under the card's top corner, so its first 30 points are clipped away");
  XCTAssertEqualWithAccuracy(
      indicator.bottom, 30, 0.01, @"the same at the bottom, where the other corner cuts it");
}

/// A rounded ancestor that does NOT clip takes nothing away.
- (void)testANonClippingRoundedAncestorInsetsNothing
{
  _card.clipsToBounds = NO;
  [_scroll layoutIfNeeded];

  UIEdgeInsets indicator = _scroll.scrollView.verticalScrollIndicatorInsets;
  XCTAssertEqualWithAccuracy(
      indicator.top,
      0,
      0.01,
      @"a view that lets its children paint outside itself is not cutting the indicator off, and "
      @"insetting for its corners would move the indicator away from an edge that is not there");
}

/// The LARGEST radius on the way up, not the nearest one.
- (void)testTheOutermostClippingCornerWins
{
  UIView *inner = [[UIView alloc] initWithFrame:_card.bounds];
  inner.clipsToBounds = YES;
  inner.layer.cornerRadius = 8;
  [_card addSubview:inner];
  [_scroll removeFromSuperview];
  [inner addSubview:_scroll];

  [_scroll layoutIfNeeded];

  UIEdgeInsets indicator = _scroll.scrollView.verticalScrollIndicatorInsets;
  XCTAssertEqualWithAccuracy(
      indicator.top,
      30,
      0.01,
      @"the 8-point inner corner does not save the indicator from the 30-point outer one; both "
      @"clip, so the one that takes the most is the one that matters");
}

/// The walk stops where the clipping stops.
- (void)testTheWalkStopsAtTheFirstAncestorThatDoesNotClip
{
  UIView *loose = [[UIView alloc] initWithFrame:_card.bounds];
  loose.clipsToBounds = NO;
  [_card addSubview:loose];
  [_scroll removeFromSuperview];
  [loose addSubview:_scroll];

  [_scroll layoutIfNeeded];

  UIEdgeInsets indicator = _scroll.scrollView.verticalScrollIndicatorInsets;
  XCTAssertEqualWithAccuracy(
      indicator.top,
      0,
      0.01,
      @"the card still has its radius, but nothing between it and the scroll view clips — so the "
      @"card is not what the indicator is drawn into and its corners cannot reach it");
}

/// Never so much that there is no indicator left.
- (void)testTheInsetIsCappedAtHalfTheView
{
  _card.frame = CGRectMake(0, 0, 300, 40);
  _card.layer.cornerRadius = 200;
  _scroll.frame = _card.bounds;
  [_scroll layoutIfNeeded];

  UIEdgeInsets indicator = _scroll.scrollView.verticalScrollIndicatorInsets;
  XCTAssertLessThanOrEqual(
      indicator.top + indicator.bottom,
      CGRectGetHeight(_scroll.bounds),
      @"a radius larger than the view is a capsule, and insetting by it would leave the indicator "
      @"with negative room");
}

@end
