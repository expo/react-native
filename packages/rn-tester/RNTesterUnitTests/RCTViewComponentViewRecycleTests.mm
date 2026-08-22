/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <XCTest/XCTest.h>

#import <React/RCTViewComponentView.h>
#import <react/renderer/components/view/ViewProps.h>
#import <react/renderer/components/view/ViewShadowNode.h>

using namespace facebook::react;

/*
 * The recycle contract: after `-prepareForRecycle`, the view's UIKit state and
 * its `_props` must describe the same element — because `-updateProps:` diffs
 * against `_props`, not against the mutation's oldProps.
 *
 * The bug this pins: recycling cleared the pixels (background, border layers)
 * but left `_props` describing the old element, so a view recycled between two
 * elements with EQUAL styling diffed equal, skipped re-applying, and kept the
 * cleared state. On one screen, two of five identical dark code boxes rendered
 * with no background at all — which of the five depended only on which pooled
 * view each happened to get, which is why it looked intermittent.
 */
@interface RCTViewComponentViewRecycleTests : XCTestCase
@end

@implementation RCTViewComponentViewRecycleTests

static Props::Shared propsWithBackground(int32_t argb)
{
  auto props = std::make_shared<ViewProps>();
  props->backgroundColor = SharedColor(argb);
  return props;
}

- (void)testSamePropsAfterRecycleReapplyTheBackground
{
  RCTViewComponentView *view = [[RCTViewComponentView alloc] initWithFrame:CGRectMake(0, 0, 100, 100)];

  // First element: a dark background, applied.
  [view updateProps:propsWithBackground(0xFF34343D) oldProps:nullptr];
  [view finalizeUpdates:RNComponentViewUpdateMaskProps];
  XCTAssertNotNil(view.backgroundColor, @"the first element's background must apply");

  [view prepareForRecycle];
  XCTAssertNil(view.backgroundColor, @"recycling must clear the pixels");

  // Second element: a DIFFERENT props object with the SAME value — the exact
  // shape recycling produces when a pooled view moves between two identically
  // styled code boxes. The restore must run unconditionally, not by diff.
  [view updateProps:propsWithBackground(0xFF34343D) oldProps:nullptr];
  [view finalizeUpdates:RNComponentViewUpdateMaskProps];
  XCTAssertNotNil(view.backgroundColor, @"an equal-valued background must re-apply after recycle");
}

- (void)testRecycleResetsUntouchedStateByRealDiffNotDefaults
{
  // The other half of the contract, and the bug that shipped in a preview
  // build: state prepareForRecycle does NOT clear (opacity, transform) is
  // reset by the ordinary old-vs-new diff, so the old side must be the REAL
  // previous props. Diffing against defaults instead made "previous 0.5,
  // incoming 1.0 (the default)" compare 1.0 == 1.0 and skip — a recycled view
  // kept the previous element's opacity and transform, which is how a header
  // lost its Back button and scroll content sat behind a phantom inset.
  RCTViewComponentView *view = [[RCTViewComponentView alloc] initWithFrame:CGRectMake(0, 0, 100, 100)];

  auto faded = std::make_shared<ViewProps>();
  faded->opacity = 0.5;
  faded->transform = Transform::Translate(0, 40, 0);
  [view updateProps:faded oldProps:nullptr];
  [view finalizeUpdates:RNComponentViewUpdateMaskProps];
  XCTAssertEqualWithAccuracy(view.layer.opacity, 0.5, 0.001);

  [view prepareForRecycle];

  // The next element states nothing — every prop at its default.
  [view updateProps:std::make_shared<ViewProps>() oldProps:nullptr];
  [view finalizeUpdates:RNComponentViewUpdateMaskProps];
  XCTAssertEqualWithAccuracy(view.layer.opacity, 1.0, 0.001, @"a recycled view must not keep the previous element's opacity");
  XCTAssertTrue(
      CATransform3DIsIdentity(view.layer.transform), @"a recycled view must not keep the previous element's transform");
}

- (void)testRecycleKeepsThePropsObjectForSubclassDiffs
{
  // The pixels reset; the PROPS deliberately do not. Subclasses static_cast
  // `_props` to their own type — replacing it with plain ViewProps defaults
  // sent RCTParagraphComponentView a garbage `isSelectable`, whose stale diff
  // called removeInteraction: with nothing installed and aborted. The base
  // reconciles by an explicit unconditional pixel restore instead (the test
  // above), so the old element's typed props may — must — survive recycling.
  RCTViewComponentView *view = [[RCTViewComponentView alloc] initWithFrame:CGRectMake(0, 0, 100, 100)];
  [view updateProps:propsWithBackground(0xFF123456) oldProps:nullptr];
  [view prepareForRecycle];

  const auto &props = static_cast<const ViewProps &>(*view.props);
  XCTAssertTrue(bool(props.backgroundColor), @"recycling must not replace the typed props object");
}

@end
