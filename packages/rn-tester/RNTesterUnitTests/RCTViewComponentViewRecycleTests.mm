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
  // styled code boxes. The diff must run against defaults, not the old element.
  [view updateProps:propsWithBackground(0xFF34343D) oldProps:nullptr];
  [view finalizeUpdates:RNComponentViewUpdateMaskProps];
  XCTAssertNotNil(view.backgroundColor, @"an equal-valued background must re-apply after recycle");
}

- (void)testRecycleKeepsThePropsObjectForSubclassDiffs
{
  // The pixels reset; the PROPS deliberately do not. Subclasses static_cast
  // `_props` to their own type — replacing it with plain ViewProps defaults
  // sent RCTParagraphComponentView a garbage `isSelectable`, whose stale diff
  // called removeInteraction: with nothing installed and aborted. The base
  // reconciles by diffing against defaults exactly once instead (the test
  // above), so the old element's typed props may — must — survive recycling.
  RCTViewComponentView *view = [[RCTViewComponentView alloc] initWithFrame:CGRectMake(0, 0, 100, 100)];
  [view updateProps:propsWithBackground(0xFF123456) oldProps:nullptr];
  [view prepareForRecycle];

  const auto &props = static_cast<const ViewProps &>(*view.props);
  XCTAssertTrue(bool(props.backgroundColor), @"recycling must not replace the typed props object");
}

@end
