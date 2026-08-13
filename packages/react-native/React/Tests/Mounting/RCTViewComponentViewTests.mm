/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <React/RCTConversions.h>
#import <React/RCTViewComponentView.h>
#import <XCTest/XCTest.h>
#import <react/renderer/components/root/RootComponentDescriptor.h>
#import <react/renderer/components/text/TextNodeShadowNode.h>
#import <react/renderer/components/view/ViewComponentDescriptor.h>
#import <react/renderer/components/view/ViewProps.h>
#import <react/renderer/components/view/ViewShadowNode.h>
#import <react/renderer/components/view/ViewState.h>
#import <react/renderer/element/ComponentBuilder.h>
#import <react/renderer/element/Element.h>
#import <react/renderer/element/testUtils.h>

using namespace facebook::react;

static Props::Shared makeViewProps(bool removeClippedSubviews)
{
  auto props = std::make_shared<ViewProps>();
  props->removeClippedSubviews = removeClippedSubviews;
  return props;
}

@interface RCTViewComponentViewTests : XCTestCase
@end

@implementation RCTViewComponentViewTests

#pragma mark - removeClippedSubviews toggle

- (void)testToggleRemoveClippedSubviewsOffRemountsClippedChildren
{
  RCTViewComponentView *parent = [RCTViewComponentView new];
  UIView *child1 = [UIView new];
  child1.frame = CGRectMake(0, 0, 50, 50);
  UIView *child2 = [UIView new];
  child2.frame = CGRectMake(0, 200, 50, 50);
  UIView *child3 = [UIView new];
  child3.frame = CGRectMake(0, 400, 50, 50);

  // Mount children normally
  [parent mountChildComponentView:(id)child1 index:0];
  [parent mountChildComponentView:(id)child2 index:1];
  [parent mountChildComponentView:(id)child3 index:2];

  XCTAssertEqual(parent.subviews.count, 3u);

  // Toggle removeClippedSubviews ON via props
  auto propsOn = makeViewProps(true);
  [parent updateProps:propsOn oldProps:ViewShadowNode::defaultSharedProps()];

  // Simulate clipping: remove child2 and child3 from superview (as updateClippedSubviewsWithClipRect would)
  [child2 removeFromSuperview];
  [child3 removeFromSuperview];
  XCTAssertEqual(parent.subviews.count, 1u);
  XCTAssertNil(child2.superview);
  XCTAssertNil(child3.superview);

  // Toggle removeClippedSubviews OFF via props
  auto propsOff = makeViewProps(false);
  [parent updateProps:propsOff oldProps:propsOn];

  // All children should be re-mounted
  XCTAssertEqual(parent.subviews.count, 3u);
  XCTAssertEqual(child1.superview, parent);
  XCTAssertEqual(child2.superview, parent);
  XCTAssertEqual(child3.superview, parent);
}

- (void)testToggleRemoveClippedSubviewsOffPreservesOrder
{
  RCTViewComponentView *parent = [RCTViewComponentView new];
  UIView *child1 = [UIView new];
  child1.frame = CGRectMake(0, 0, 50, 50);
  UIView *child2 = [UIView new];
  child2.frame = CGRectMake(0, 100, 50, 50);
  UIView *child3 = [UIView new];
  child3.frame = CGRectMake(0, 200, 50, 50);

  [parent mountChildComponentView:(id)child1 index:0];
  [parent mountChildComponentView:(id)child2 index:1];
  [parent mountChildComponentView:(id)child3 index:2];

  // Toggle ON and clip child1 (first child)
  auto propsOn = makeViewProps(true);
  [parent updateProps:propsOn oldProps:ViewShadowNode::defaultSharedProps()];
  [child1 removeFromSuperview];
  XCTAssertEqual(parent.subviews.count, 2u);

  // Toggle OFF — all children re-mounted in correct order
  auto propsOff = makeViewProps(false);
  [parent updateProps:propsOff oldProps:propsOn];

  XCTAssertEqual(parent.subviews.count, 3u);
  XCTAssertEqual(parent.subviews[0], child1);
  XCTAssertEqual(parent.subviews[1], child2);
  XCTAssertEqual(parent.subviews[2], child3);
}

- (void)testToggleRemoveClippedSubviewsOffClearsReactSubviews
{
  RCTViewComponentView *parent = [RCTViewComponentView new];
  UIView *child1 = [UIView new];
  child1.frame = CGRectMake(0, 0, 50, 50);

  [parent mountChildComponentView:(id)child1 index:0];

  // Toggle ON
  auto propsOn = makeViewProps(true);
  [parent updateProps:propsOn oldProps:ViewShadowNode::defaultSharedProps()];

  // Toggle OFF
  auto propsOff = makeViewProps(false);
  [parent updateProps:propsOff oldProps:propsOn];

  // _reactSubviews should be cleared
  NSMutableArray *reactSubviews = [parent valueForKey:@"_reactSubviews"];
  XCTAssertEqual(reactSubviews.count, 0u);
}

- (void)testUnmountAfterToggleOffCleansUpReactSubviews
{
  RCTViewComponentView *parent = [RCTViewComponentView new];
  UIView *child1 = [UIView new];
  child1.frame = CGRectMake(0, 0, 50, 50);
  UIView *child2 = [UIView new];
  child2.frame = CGRectMake(0, 100, 50, 50);

  // Toggle ON first, then mount children
  auto propsOn = makeViewProps(true);
  [parent updateProps:propsOn oldProps:ViewShadowNode::defaultSharedProps()];
  [parent mountChildComponentView:(id)child1 index:0];
  [parent mountChildComponentView:(id)child2 index:1];

  // Toggle OFF — re-mounts children
  auto propsOff = makeViewProps(false);
  [parent updateProps:propsOff oldProps:propsOn];

  XCTAssertEqual(parent.subviews.count, 2u);

  // Unmount child2 — should succeed without assert failures
  [parent unmountChildComponentView:(id)child2 index:1];
  XCTAssertEqual(parent.subviews.count, 1u);
  XCTAssertNil(child2.superview);
}

#pragma mark - hitTest against non-invertible transforms (#50797)

- (void)testHitTestReturnsNilForZeroScaleYView
{
  RCTViewComponentView *view = [RCTViewComponentView new];
  view.frame = CGRectMake(0, 0, 100, 100);
  view.layer.transform = CATransform3DMakeScale(1, 0, 1);

  XCTAssertNil([view hitTest:CGPointMake(50, 50) withEvent:nil]);
}

- (void)testHitTestReturnsNilForZeroScaleXView
{
  RCTViewComponentView *view = [RCTViewComponentView new];
  view.frame = CGRectMake(0, 0, 100, 100);
  view.layer.transform = CATransform3DMakeScale(0, 1, 1);

  XCTAssertNil([view hitTest:CGPointMake(50, 50) withEvent:nil]);
}

- (void)testHitTestReturnsSelfForIdentityTransform
{
  RCTViewComponentView *view = [RCTViewComponentView new];
  view.frame = CGRectMake(0, 0, 100, 100);

  XCTAssertEqual([view hitTest:CGPointMake(50, 50) withEvent:nil], view);
}

- (void)testHitTestAfterScaleTransitionedToZeroReturnsNil
{
  // #50797 variant: a view scaled to 0.9 first and then to 0.0 should stop receiving hits.
  RCTViewComponentView *view = [RCTViewComponentView new];
  view.frame = CGRectMake(0, 0, 100, 100);

  view.layer.transform = CATransform3DMakeScale(1, 0.9, 1);
  XCTAssertEqual([view hitTest:CGPointMake(50, 50) withEvent:nil], view);

  view.layer.transform = CATransform3DMakeScale(1, 0, 1);
  XCTAssertNil([view hitTest:CGPointMake(50, 50) withEvent:nil]);
}

#pragma mark - text children run geometry (paint & hit-test single source of truth)

// `containerFrame` is the one geometry both painting (-drawRect:) and hit-testing
// (-touchEventEmitterAtContainerPoint:) consume, read here via KVC (CGRect boxed
// into NSValue).
- (CGRect)implicitRunContainerFrameForView:(RCTViewComponentView *)view
{
  NSArray *runViews = [view valueForKey:@"_textRunViews"];
  XCTAssertEqual(runViews.count, 1u, @"expected exactly one anonymous text run");
  return [[runViews.firstObject valueForKey:@"containerFrame"] CGRectValue];
}

// Regression guard for the tapped-text-reposition bug: the anonymous run's
// paint/hit geometry must be a pure function of the run's own layout frame, never
// the owning view's content inset applied at update time.
//
// The original bug: -drawRect: drew at `run.frame - contentInset` (from layout
// metrics) while hit-testing used `run.frame` directly. On mount, `updateState:`
// runs before `updateLayoutMetrics:`, so the inset was still zero and paint looked
// correct; on the first relayout after a state change the inset became the padding
// and the drawn text jumped to the top-left. This drives the two updates in BOTH
// orders and asserts the geometry is identical and equals the run frame — i.e.
// relayout is idempotent and paint and touch share one coordinate space.
- (void)testAnonymousTextRunGeometryIsStableRegardlessOfUpdateOrder
{
  std::shared_ptr<RootShadowNode> rootShadowNode;
  std::shared_ptr<ViewShadowNode> viewShadowNode;

  auto element =
      Element<RootShadowNode>()
          .reference(rootShadowNode)
          .tag(1)
          .props([] {
            auto sharedProps = std::make_shared<RootProps>();
            sharedProps->layoutConstraints =
                LayoutConstraints{.minimumSize = {.width = 0, .height = 0}, .maximumSize = {.width = 500, .height = 500}};
            sharedProps->yogaStyle.setDimension(yoga::Dimension::Width, yoga::StyleSizeLength::points(200));
            sharedProps->yogaStyle.setDimension(yoga::Dimension::Height, yoga::StyleSizeLength::points(200));
            return sharedProps;
          })
          .children({
              Element<ViewShadowNode>()
                  .reference(viewShadowNode)
                  .props([] {
                    auto sharedProps = std::make_shared<ViewProps>();
                    auto &yogaStyle = sharedProps->yogaStyle;
                    // A padding inset is what the bug shifted the run by.
                    yogaStyle.setPadding(yoga::Edge::All, yoga::StyleLength::points(6));
                    yogaStyle.setDimension(yoga::Dimension::Width, yoga::StyleSizeLength::points(150));
                    yogaStyle.setDimension(yoga::Dimension::Height, yoga::StyleSizeLength::points(40));
                    return sharedProps;
                  })
                  .children({
                      // A bare string child → an anonymous text-children run.
                      Element<TextNodeShadowNode>().props([] {
                        auto sharedProps = std::make_shared<TextNodeProps>("hello");
                        return sharedProps;
                      }),
                  }),
          });

  ComponentBuilder builder = simpleComponentBuilder();
  builder.build(element);
  rootShadowNode->layoutIfNeeded();

  auto state = std::static_pointer_cast<const ViewShadowNode::ConcreteState>(viewShadowNode->getState());
  auto layoutMetrics = viewShadowNode->getLayoutMetrics();

  // Text children must be active: exactly one anonymous run, laid out inside the
  // padding (origin at the 6pt inset, not the border box).
  XCTAssertEqual(state->getData().textRuns.size(), 1u);
  CGRect runFrame = RCTCGRectFromRect(state->getData().textRuns[0].frame);
  XCTAssertEqualWithAccuracy(runFrame.origin.x, 6.0, 0.01);
  XCTAssertEqualWithAccuracy(runFrame.origin.y, 6.0, 0.01);

  // Order A: state, then layout metrics.
  RCTViewComponentView *viewA = [RCTViewComponentView new];
  [viewA updateProps:viewShadowNode->getProps() oldProps:nullptr];
  [viewA updateState:state oldState:nil];
  [viewA updateLayoutMetrics:layoutMetrics oldLayoutMetrics:LayoutMetrics{}];

  // Order B: layout metrics, then state — the ordering a relayout produces, which
  // is what exposed the bug.
  RCTViewComponentView *viewB = [RCTViewComponentView new];
  [viewB updateProps:viewShadowNode->getProps() oldProps:nullptr];
  [viewB updateLayoutMetrics:layoutMetrics oldLayoutMetrics:LayoutMetrics{}];
  [viewB updateState:state oldState:nil];

  CGRect frameA = [self implicitRunContainerFrameForView:viewA];
  CGRect frameB = [self implicitRunContainerFrameForView:viewB];

  XCTAssertTrue(
      CGRectEqualToRect(frameA, runFrame), @"paint geometry must equal the run frame regardless of update order");
  XCTAssertTrue(
      CGRectEqualToRect(frameB, runFrame), @"paint geometry must not depend on when layout metrics are applied");
  XCTAssertTrue(CGRectEqualToRect(frameA, frameB), @"update order must not change the run geometry");
}

@end
