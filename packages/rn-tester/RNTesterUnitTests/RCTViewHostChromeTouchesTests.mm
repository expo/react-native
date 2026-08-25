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
 * How host chrome standing BEHIND a view gets the touches meant for it.
 *
 * Chrome is added behind the children it stands for
 * (`addHostChromeSubview:behindSubview:`) — a run of `<input type="radio">`
 * rows is drawn by a `UICollectionView` sitting behind the rows, which is what
 * lets the platform's own list select them. A touch meant for that list has to
 * pass through the row drawn in front of it, and UIKit's only hook for "let it
 * past" is `hitTest:` returning nil for self.
 *
 * That is `pointerEvents: box-none`, which `RCTViewComponentView` already
 * implements; `passesTouchesToHostChrome` asks for it on a view whose author
 * never wrote a prop.
 *
 * WHY NOT `userInteractionEnabled = NO`: it takes the whole subtree with it, so
 * a link inside a radio row would stop working. Only the view's own area is
 * given up, which is what the third test here pins down.
 *
 * This replaces `RCTViewPressObserverTests`. That seam reported a view's
 * touches so chrome could light a cell from outside; the cell highlights
 * itself now, and the observer went with the tap recognizer and the hand-rolled
 * drag check that used to stand in for `UICollectionViewDelegate`.
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
   * The case that rules out `userInteractionEnabled = NO`: a link inside a
   * radio row keeps taking its own touches.
   *
   * A plain `UIView` stands in for everything that is not ours — a `UIControl`,
   * a text run answering because a link is under the point. Those are never
   * passed over, because only a React view can be asked whether it would do
   * anything with the touch.
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
   * The reported bug: the empty part of a radio row selected it and the WORDS
   * did not, because the `<Text>` claimed its own box and `box-none` on the row
   * only ever gave up the row's own area.
   *
   * A React view with default props has no handlers — nothing would happen if
   * it took the touch — so it is passed over and the chrome behind the row
   * gets the point.
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
   * A row is a component view: it comes back as something with no radios in it
   * and no list behind it. A view still declining its own area would take no
   * touches in its next life either — which is the shape of the bug that a
   * gesture recognizer left on a recycled row used to cause.
   */
  RCTViewComponentView *view = EXPRow();
  view.passesTouchesToHostChrome = YES;
  [view prepareForRecycle];
  XCTAssertFalse(view.passesTouchesToHostChrome);
  XCTAssertEqualObjects([view hitTest:CGPointMake(50, 25) withEvent:nil], view);
}

@end
