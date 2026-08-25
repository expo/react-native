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
 * Host chrome and the mount indices, which is where a crash lived.
 *
 * Mounting addresses a view's children by INDEX into its subviews:
 * `-unmountChildComponentView:index:` maps the mutation index to a subview
 * position and requires the child to be there. Anything else the host puts in
 * the same view — painted text runs, a `<button>`'s UIKit chrome, the grouped
 * list drawn behind a run of radios — has to be counted out of that mapping, or
 * every index after it points one slot too far.
 *
 * The bug this pins was worse than a shifted index. A run of `<input
 * type="radio">` rows was drawn as the platform's list by RE-PARENTING each row
 * into a `UICollectionViewListCell`, which took the row out of its Fabric
 * parent entirely: the index then mapped to the wrong view or past the end of
 * the array, and unmounting aborted. Leaving the screen killed the app every
 * time, while jest, Fantom, and both native suites stayed green — none of them
 * mounts and unmounts a real surface, which is exactly why this test is at this
 * level.
 *
 * So the rule is the one these assert: chrome is registered and sits behind,
 * mounted children keep their indices, and a mounted child is never moved.
 */
@interface EXPHostChromeMountIndexTests : XCTestCase
@end

@implementation EXPHostChromeMountIndexTests

- (RCTViewComponentView *)containerWithChildren:(NSArray<RCTViewComponentView *> *)children
{
  RCTViewComponentView *container = [[RCTViewComponentView alloc] initWithFrame:CGRectMake(0, 0, 100, 100)];
  for (NSUInteger i = 0; i < children.count; i++) {
    [container mountChildComponentView:children[i] index:(NSInteger)i];
  }
  return container;
}

- (NSArray<RCTViewComponentView *> *)threeChildren
{
  return @[
    [[RCTViewComponentView alloc] initWithFrame:CGRectZero],
    [[RCTViewComponentView alloc] initWithFrame:CGRectZero],
    [[RCTViewComponentView alloc] initWithFrame:CGRectZero],
  ];
}

- (void)testChromeDoesNotShiftMountIndices
{
  NSArray<RCTViewComponentView *> *children = [self threeChildren];
  RCTViewComponentView *container = [self containerWithChildren:children];

  UIView *chrome = [[UIView alloc] initWithFrame:CGRectZero];
  [container addHostChromeSubview:chrome];

  // Every child unmounts at the index it was mounted at. Without the registry
  // the chrome occupies subview 0 and each of these maps one slot too far —
  // the last one runs past the end, which is the abort.
  XCTAssertNoThrow([container unmountChildComponentView:children[2] index:2]);
  XCTAssertNoThrow([container unmountChildComponentView:children[1] index:1]);
  XCTAssertNoThrow([container unmountChildComponentView:children[0] index:0]);

  XCTAssertEqualObjects(container.subviews, @[ chrome ], @"the chrome should be all that is left");
}

- (void)testChromeStaysBehindMountedChildren
{
  NSArray<RCTViewComponentView *> *children = [self threeChildren];
  RCTViewComponentView *container = [self containerWithChildren:children];

  UIView *chrome = [[UIView alloc] initWithFrame:CGRectZero];
  [container addHostChromeSubview:chrome];

  // A backdrop that is not at the back is not a backdrop: it covers the very
  // content it is chrome for.
  XCTAssertEqual([container.subviews indexOfObject:chrome], 0u);
}

- (void)testAChildMountedAfterChromeStillUnmounts
{
  // The order the run actually produces: the list is installed once the rows
  // are known, and rows keep arriving afterwards.
  NSArray<RCTViewComponentView *> *children = [self threeChildren];
  RCTViewComponentView *container = [self containerWithChildren:@[ children[0] ]];

  UIView *chrome = [[UIView alloc] initWithFrame:CGRectZero];
  [container addHostChromeSubview:chrome];

  [container mountChildComponentView:children[1] index:1];
  [container mountChildComponentView:children[2] index:2];

  XCTAssertEqual([container.subviews indexOfObject:chrome], 0u, @"chrome should still be behind");
  XCTAssertNoThrow([container unmountChildComponentView:children[1] index:1]);
  XCTAssertEqualObjects(
      container.subviews, (@[ chrome, children[0], children[2] ]), @"the wrong child was removed");
}

- (void)testRemovingChromeLeavesTheChildrenAlone
{
  NSArray<RCTViewComponentView *> *children = [self threeChildren];
  RCTViewComponentView *container = [self containerWithChildren:children];

  UIView *chrome = [[UIView alloc] initWithFrame:CGRectZero];
  [container addHostChromeSubview:chrome];
  [container removeHostChromeSubview:chrome];

  XCTAssertNil(chrome.superview);
  XCTAssertEqualObjects(container.subviews, children);
  XCTAssertNoThrow([container unmountChildComponentView:children[1] index:1]);
}

- (void)testRecyclingDropsHostChrome
{
  NSArray<RCTViewComponentView *> *children = [self threeChildren];
  RCTViewComponentView *container = [self containerWithChildren:children];

  UIView *chrome = [[UIView alloc] initWithFrame:CGRectZero];
  [container addHostChromeSubview:chrome];
  [container prepareForRecycle];

  // The view is going back to the pool to become something else. Chrome from
  // what it used to be would be a backdrop under unrelated content, and would
  // go on counting itself out of indices that are no longer its own.
  XCTAssertNil(chrome.superview);
  XCTAssertFalse(container.hasHostChromeSubviews);
}

@end
