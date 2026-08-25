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
 * Host chrome and the mount indices. Mounting addresses a view's children by
 * index into its subviews (`-unmountChildComponentView:index:`), so anything
 * else the host puts in the view, painted text runs, a `<button>`'s chrome, the
 * list behind a run of radios, has to be counted out of that mapping, and a
 * mounted child must never be re-parented into chrome. None of the JavaScript
 * suites mounts and unmounts a real surface, which is why this is tested here.
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

  // Every child unmounts at the index it was mounted at; without the registry
  // the chrome at subview 0 shifts each by one and the last runs past the end
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
  XCTAssertEqualObjects(container.subviews, (@[ chrome, children[0], children[2] ]), @"the wrong child was removed");
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

  // Chrome from what the view was must not back what it becomes
  XCTAssertNil(chrome.superview);
  XCTAssertFalse(container.hasHostChromeSubviews);
}

@end
