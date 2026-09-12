/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>
#import <XCTest/XCTest.h>

#import <React/RCTViewComponentView.h>
#import <react/renderer/components/view/ViewProps.h>

using namespace facebook::react;

/*
 * `background-attachment: fixed` measures a background against the window, so a
 * view that paints before it is in one falls back to its own box, and that
 * painting has to be redone when the view arrives, not only on the next scroll.
 */
@interface RCTViewFixedBackgroundTests : XCTestCase
@end

@implementation RCTViewFixedBackgroundTests

static Props::Shared fixedGradientProps(void)
{
  auto props = std::make_shared<ViewProps>();
  props->backgroundAttachmentFixed = true;
  props->backgroundImage = {LinearGradient{
      .direction = Float{180},
      .colorStops =
          {ColorStop{.color = SharedColor(0xFF6ACBFB), .position = ValueUnit{0, UnitType::Percent}},
           ColorStop{.color = SharedColor(0xFF1E7CFA), .position = ValueUnit{100, UnitType::Percent}}},
  }};
  return props;
}

// The tallest layer under `layer` is the gradient; its size is the positioning area's
static CGFloat tallestSublayerHeight(CALayer *layer)
{
  CGFloat tallest = 0;
  for (CALayer *sublayer in layer.sublayers) {
    tallest = MAX(tallest, MAX(sublayer.bounds.size.height, tallestSublayerHeight(sublayer)));
  }
  return tallest;
}

- (void)testAFixedBackgroundPaintedOutsideAWindowIsReplacedWhenTheViewArrives
{
  RCTViewComponentView *view = [[RCTViewComponentView alloc] initWithFrame:CGRectZero];
  LayoutMetrics metrics;
  metrics.frame = facebook::react::Rect{.origin = {0, 0}, .size = {120, 40}};
  [view updateProps:fixedGradientProps() oldProps:nullptr];
  [view updateLayoutMetrics:metrics oldLayoutMetrics:EmptyLayoutMetrics];
  [view finalizeUpdates:RNComponentViewUpdateMaskProps | RNComponentViewUpdateMaskLayoutMetrics];
  XCTAssertEqualWithAccuracy(
      tallestSublayerHeight(view.layer), 40, 0.5, @"outside a window the gradient can only fill the view's own box");

  UIWindow *window = [[UIWindow alloc] initWithFrame:CGRectMake(0, 0, 400, 800)];
  [window addSubview:view];

  XCTAssertEqualWithAccuracy(
      tallestSublayerHeight(view.layer), 800, 0.5, @"in a window the gradient must span the window");
  [view removeFromSuperview];
}

@end
