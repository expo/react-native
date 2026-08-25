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
 * How host chrome behind a view gets the touches meant for it: the row in
 * front passes its own area through (`passesTouchesToHostChrome`, which is
 * `pointerEvents: box-none` asked for by chrome rather than a prop), while a
 * link inside the row keeps its touches, which rules out
 * `userInteractionEnabled = NO`.
 */
@interface RCTViewHostChromeTouchesTests : XCTestCase
@end

@implementation RCTViewHostChromeTouchesTests

static RCTViewComponentView *EXPRow(void)
{
  RCTViewComponentView *view = [RCTViewComponentView new];
  view.frame = CGRectMake(0, 0, 100, 50);
  return view;
}

- (void)testAViewAnswersForItsOwnAreaUnlessChromeAsksOtherwise
{
  // The default has to be "unchanged": this property is on every view in every
  // tree, and all but a handful of them have nothing behind them.
  RCTViewComponentView *view = EXPRow();
  XCTAssertFalse(view.passesTouchesToHostChrome);
  XCTAssertEqualObjects([view hitTest:CGPointMake(50, 25) withEvent:nil], view);
}

- (void)testAnAdoptedRowDeclinesItsOwnArea
{
  // The point falls through to whatever is behind — the run's list, which is
  // the native selector for the row.
  RCTViewComponentView *view = EXPRow();
  view.passesTouchesToHostChrome = YES;
  XCTAssertNil([view hitTest:CGPointMake(50, 25) withEvent:nil]);
}

- (void)testAnAdoptedRowSTILLOffersThePointToAChildThatWouldACTOnIt
{
  /*
   * A link inside a radio row keeps its own touches. A plain `UIView` stands in
   * for everything that is not a React view; those are never passed over.
   */
  RCTViewComponentView *row = EXPRow();
  row.passesTouchesToHostChrome = YES;

  UIView *link = [[UIView alloc] initWithFrame:CGRectMake(10, 10, 30, 20)];
  [row addSubview:link];

  XCTAssertEqualObjects([row hitTest:CGPointMake(20, 15) withEvent:nil], link);
  XCTAssertNil([row hitTest:CGPointMake(80, 40) withEvent:nil]);
}

- (void)testAChildThatONLYDrawsDoesNotSwallowTheRowsTouch
{
  /*
   * A `<Text>` with default props has no handlers, so it is passed over and the
   * chrome behind the row gets the point; `box-none` on the row alone would
   * give up only the row's own area.
   */
  RCTViewComponentView *row = EXPRow();
  row.passesTouchesToHostChrome = YES;

  RCTViewComponentView *label = [RCTViewComponentView new];
  label.frame = CGRectMake(10, 10, 60, 30);
  XCTAssertFalse(label.hasTouchHandlers, @"a view nobody gave a handler to acts on nothing");
  [row addSubview:label];

  XCTAssertNil([row hitTest:CGPointMake(20, 15) withEvent:nil], @"a label must not stand between a finger and the row");
}

- (void)testAPassiveChildIsStillHitWhenNoChromeIsBehind
{
  // The same label in an ordinary row is hit normally — the pass-over is the
  // chrome's doing and must not leak into every view in the tree.
  RCTViewComponentView *row = EXPRow();

  RCTViewComponentView *label = [RCTViewComponentView new];
  label.frame = CGRectMake(10, 10, 60, 30);
  [row addSubview:label];

  XCTAssertEqualObjects([row hitTest:CGPointMake(20, 15) withEvent:nil], label);
}

- (void)testRecyclingTakesTheAdoptionBack
{
  /*
   * A recycled row comes back as something with no list behind it, so the flag
   * must not survive recycling.
   */
  RCTViewComponentView *view = EXPRow();
  view.passesTouchesToHostChrome = YES;
  [view prepareForRecycle];
  XCTAssertFalse(view.passesTouchesToHostChrome);
  XCTAssertEqualObjects([view hitTest:CGPointMake(50, 25) withEvent:nil], view);
}

@end
