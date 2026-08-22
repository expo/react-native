/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>
#import <XCTest/XCTest.h>

#import <React/RCTViewComponentView.h>
#import <react/renderer/components/view/ElementButtonShadowNode.h>
#import <react/renderer/components/view/ViewProps.h>

using namespace facebook::react;

/*
 * What VoiceOver hears is what the view draws, even after the view is recycled.
 *
 * A component view is reused for another element of the same type, and the name it announces must
 * be the new element's. A copy of the old element's `accessibilityLabel` survived one such reuse:
 * a `<button>accept</button>` announced itself as the previous button's "Increment update count"
 * while drawing "accept". The name is now read from the current props, or from the painted text,
 * when it is asked for, so there is no copy to go stale.
 */
@interface RCTViewAccessibilityLabelRecycleTests : XCTestCase
@end

@implementation RCTViewAccessibilityLabelRecycleTests

template <typename PropsT>
static Props::Shared labelledProps(const char *label)
{
  auto props = std::make_shared<PropsT>();
  props->accessible = true;
  props->accessibilityLabel = label;
  return props;
}

template <typename PropsT>
static void assertRecycleDropsTheLabel(RCTViewComponentView *view, Props::Shared defaults)
{
  [view updateProps:labelledProps<PropsT>("Increment update count") oldProps:defaults];
  [view finalizeUpdates:RNComponentViewUpdateMaskProps];
  XCTAssertEqualObjects(view.accessibilityLabel, @"Increment update count");

  [view prepareForRecycle];
  [view updateProps:labelledProps<PropsT>("") oldProps:defaults];
  [view finalizeUpdates:RNComponentViewUpdateMaskProps];

  // Nothing is drawn inside, so there is no name to give: above all not the previous element's
  XCTAssertNil(view.accessibilityLabel);
}

- (void)testARecycledViewDoesNotKeepThePreviousElementsName
{
  RCTViewComponentView *view = [[RCTViewComponentView alloc] initWithFrame:CGRectMake(0, 0, 100, 44)];
  assertRecycleDropsTheLabel<ViewProps>(view, nullptr);
}

- (void)testARecycledButtonDoesNotKeepThePreviousButtonsName
{
  Class cls = NSClassFromString(@"EXPElementButtonComponentView");
  XCTAssertNotNil(cls, @"EXPElementButtonComponentView is not linked into the test host");
  RCTViewComponentView *view = [[cls alloc] initWithFrame:CGRectMake(0, 0, 100, 44)];
  assertRecycleDropsTheLabel<ElementButtonProps>(view, ElementButtonShadowNode::defaultSharedProps());
}

@end
