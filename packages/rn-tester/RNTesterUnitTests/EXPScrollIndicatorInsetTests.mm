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
 * A scroll indicator clears the corners that would cut it off: an indicator is
 * drawn inside the scroll view, so a rounded ancestor with `overflow: hidden`
 * clips both of its ends. The inset is the largest radius on any clipping
 * ancestor, where an author puts it, and it is applied from layout, since a
 * scroll view whose content inset never changes would otherwise never reach it.
 * Unit tests because XCUITest cannot read a scroll view's insets and the
 * indicator fades within a second.
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
  // A rounded, clipping card holding a plain list, `overflow: hidden` plus a radius
  _card = [[UIView alloc] initWithFrame:CGRectMake(0, 0, 300, 400)];
  _card.clipsToBounds = YES;
  _card.layer.cornerRadius = 30;

  _scroll = [[EXPScrollViewComponentView alloc] initWithFrame:_card.bounds];
  [_card addSubview:_scroll];
}

// The card's radius reaches the indicator, top and bottom
- (void)testAClippingRoundedAncestorInsetsTheIndicator
{
  [_scroll layoutIfNeeded];

  UIEdgeInsets indicator = _scroll.scrollView.verticalScrollIndicatorInsets;
  XCTAssertEqualWithAccuracy(
      indicator.top,
      30,
      0.01,
      @"the indicator starts under the card's top corner, so its first 30 points are clipped away");
  XCTAssertEqualWithAccuracy(indicator.bottom, 30, 0.01, @"the same at the bottom, where the other corner cuts it");
}

// A rounded ancestor that does not clip takes nothing away
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

// The largest radius on the way up, not the nearest one
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

// The walk stops where the clipping stops
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

// Never so much that there is no indicator left
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
