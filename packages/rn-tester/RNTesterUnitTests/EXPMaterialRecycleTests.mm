/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <XCTest/XCTest.h>

#import <React/EXPElementBoxComponentView.h>
#import <React/EXPElementButtonComponentView.h>
#import <React/RCTViewComponentView.h>
#import <react/renderer/components/view/ElementBoxShadowNode.h>
#import <react/renderer/components/view/ElementButtonShadowNode.h>

using namespace facebook::react;

/*
 * The material's lifecycle is the base component view's, for every element
 * kind that wears one.
 *
 * A glass surface WRAPS the element's content: React's children are mounted
 * into its effect view's content view, and its host is chrome the base view
 * removes on recycle. When the surface was owned by each subclass, the button
 * forgot to tear its own down before that removal: a recycled `+` kept a
 * surface whose host was gone, the keyword read as unchanged for the next
 * element, and that element's icon was mounted into a view nothing displayed.
 * Seen as the composer's `+` vanishing after a screen was popped and pushed
 * with the keyboard up.
 *
 * So the contract, per kind: after a recycle and a fresh application of the
 * same keyword, a mounted child is reachable from the view, and the material's
 * host is in it. And a recycle with no keyword afterwards leaves no material.
 */
@interface EXPMaterialRecycleTests : XCTestCase
@end

@implementation EXPMaterialRecycleTests

static Props::Shared glassBoxProps(void)
{
  auto props = std::make_shared<ElementBoxProps>();
  props->appleVisualEffect = "-apple-system-glass-material";
  return props;
}

static Props::Shared glassButtonProps(void)
{
  auto props = std::make_shared<ElementButtonProps>();
  props->appleVisualEffect = "-apple-system-glass-material";
  props->buttonStyle = "standard";
  return props;
}

- (void)assertGlassSurvivesRecycleOn:(RCTViewComponentView *)view
                               props:(Props::Shared (*)(void))props
                                kind:(NSString *)kind
{
  [view updateProps:props() oldProps:nullptr];
  [view finalizeUpdates:RNComponentViewUpdateMaskProps];
  XCTAssertNotNil(view.exp_materialHostView.superview, @"%@: the first element's glass never installed", kind);

  RCTViewComponentView *first = [[RCTViewComponentView alloc] initWithFrame:CGRectMake(0, 0, 20, 20)];
  [view mountChildComponentView:first index:0];
  XCTAssertTrue([first isDescendantOfView:view], @"%@: the first element's child is not in the view", kind);
  [view unmountChildComponentView:first index:0];

  [view prepareForRecycle];
  XCTAssertNil(view.exp_materialHostView, @"%@: a recycled view still has a material host", kind);
  XCTAssertNil(view.exp_glassChildContainerView, @"%@: a recycled view still offers a glass container", kind);

  // The next element, with the SAME keyword: the shape recycling produces when
  // a pooled view moves between two composers.
  [view updateProps:props() oldProps:nullptr];
  [view finalizeUpdates:RNComponentViewUpdateMaskProps];
  UIView *host = view.exp_materialHostView;
  XCTAssertNotNil(host, @"%@: the next element's glass never installed", kind);
  XCTAssertTrue([host isDescendantOfView:view], @"%@: the next element's glass host is not in the view", kind);

  RCTViewComponentView *second = [[RCTViewComponentView alloc] initWithFrame:CGRectMake(0, 0, 20, 20)];
  [view mountChildComponentView:second index:0];
  XCTAssertTrue(
      [second isDescendantOfView:view],
      @"%@: the next element's child was mounted into a view that is not in the tree", kind);
  [view unmountChildComponentView:second index:0];

  // And a recycle leaves nothing behind for an element with no keyword.
  [view prepareForRecycle];
  XCTAssertNil(view.exp_materialHostView, @"%@: a recycled view still has a material host", kind);
}

- (void)testAGlassBoxSurvivesRecycling
{
  EXPElementBoxComponentView *box = [[EXPElementBoxComponentView alloc] initWithFrame:CGRectMake(0, 0, 100, 40)];
  [self assertGlassSurvivesRecycleOn:box props:glassBoxProps kind:@"box"];
}

- (void)testAGlassButtonSurvivesRecycling
{
  EXPElementButtonComponentView *button =
      [[EXPElementButtonComponentView alloc] initWithFrame:CGRectMake(0, 0, 40, 40)];
  [self assertGlassSurvivesRecycleOn:button props:glassButtonProps kind:@"button"];
}

@end
