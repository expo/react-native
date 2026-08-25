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
 * Where host chrome sits among a view's children. A flattened `<View>` that
 * paints stays in the container as a childless subview carrying its
 * background, ordered before the children it held, so chrome "at the back" is
 * behind that rectangle and invisible; chrome that backs a run of children has
 * to sit behind those children and in front of everything before them, and the
 * mount-index arithmetic has to survive chrome in the middle of the subviews.
 */
@interface EXPHostChromeZOrderTests : XCTestCase
@end

@implementation EXPHostChromeZOrderTests {
  RCTViewComponentView *_container;
  NSMutableArray<RCTViewComponentView *> *_children;
}

- (void)setUp
{
  [super setUp];
  _container = [RCTViewComponentView new];
  _children = [NSMutableArray new];
  for (NSInteger index = 0; index < 3; index++) {
    RCTViewComponentView *child = [RCTViewComponentView new];
    [_children addObject:child];
    [_container mountChildComponentView:child index:index];
  }
}

/** The child at `position` in the container's subviews, or nil. */
- (nullable UIView *)subviewAt:(NSUInteger)position
{
  NSArray<UIView *> *subviews = _container.subviews;
  return position < subviews.count ? subviews[position] : nil;
}

- (void)testChromeForTheWholeViewGoesToTheBack
{
  UIView *chrome = [UIView new];
  [_container addHostChromeSubview:chrome];

  XCTAssertEqualObjects([self subviewAt:0], chrome);
  XCTAssertTrue([_container isHostChromeSubview:chrome]);
  XCTAssertTrue(_container.hasHostChromeSubviews);
}

- (void)testChromeForARunGoesDIRECTLYBehindThatRun
{
  // `_children[0]` stands for the flattened ancestor's backdrop: a childless
  // sibling that paints, ordered before the children it used to hold.
  UIView *card = [UIView new];
  [_container addHostChromeSubview:card behindSubview:_children[1]];

  XCTAssertEqualObjects([self subviewAt:0], _children[0], @"the backdrop stays behind");
  XCTAssertEqualObjects([self subviewAt:1], card, @"and the card sits in front of it");
  XCTAssertEqualObjects([self subviewAt:2], _children[1], @"immediately behind its own first row");
}

- (void)testChromeThatIsALREADYASubviewMovesToTheRightPlace
{
  /*
   * UIKit removes a view that is already a subview before re-inserting it, so an
   * index computed beforehand is one too high when chrome is moved rather than
   * added; rows arrive, leave and re-order, so moving is the ordinary case.
   */
  UIView *card = [UIView new];
  [_container addHostChromeSubview:card];
  XCTAssertEqualObjects([self subviewAt:0], card);

  [_container addHostChromeSubview:card behindSubview:_children[2]];

  XCTAssertEqualObjects([self subviewAt:2], card);
  XCTAssertEqualObjects([self subviewAt:3], _children[2]);
  XCTAssertEqual(_container.subviews.count, 4u, @"moved, not added twice");
}

- (void)testChromeGoesToTheBackWhenItsSiblingIsNotOurs
{
  UIView *card = [UIView new];
  [_container addHostChromeSubview:card behindSubview:[UIView new]];

  XCTAssertEqualObjects([self subviewAt:0], card);
}

- (void)testMountingSkipsChromeSITTINGINTHEMIDDLE
{
  UIView *card = [UIView new];
  [_container addHostChromeSubview:card behindSubview:_children[1]];

  // Subviews are now [c0, card, c1, c2]; mounting still counts 0, 1, 2.
  RCTViewComponentView *arrival = [RCTViewComponentView new];
  [_container mountChildComponentView:arrival index:1];

  XCTAssertEqualObjects([self subviewAt:0], _children[0]);
  XCTAssertEqualObjects([self subviewAt:1], card);
  XCTAssertEqualObjects([self subviewAt:2], arrival, @"index 1 means after one mounted child");
  XCTAssertEqualObjects([self subviewAt:3], _children[1]);
  XCTAssertEqualObjects([self subviewAt:4], _children[2]);
}

- (void)testUnmountingSkipsChromeSITTINGINTHEMIDDLE
{
  // The failure this guards is not cosmetic: mounting addresses children by
  // index, and an off-by-one makes a valid removal abort.
  UIView *card = [UIView new];
  [_container addHostChromeSubview:card behindSubview:_children[1]];

  XCTAssertNoThrow([_container unmountChildComponentView:_children[2] index:2]);
  XCTAssertNil(_children[2].superview);
  XCTAssertEqualObjects([self subviewAt:0], _children[0]);
  XCTAssertEqualObjects([self subviewAt:1], card);
  XCTAssertEqualObjects([self subviewAt:2], _children[1]);
}

- (void)testChromeCanBeTakenBackOut
{
  UIView *card = [UIView new];
  [_container addHostChromeSubview:card behindSubview:_children[1]];
  [_container removeHostChromeSubview:card];

  XCTAssertNil(card.superview);
  XCTAssertFalse([_container isHostChromeSubview:card]);
  XCTAssertFalse(_container.hasHostChromeSubviews);
  XCTAssertEqualObjects([self subviewAt:1], _children[1]);
}

@end
