/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>
#import <XCTest/XCTest.h>

#import <React/EXPElementTextAreaComponentView.h>
#import <react/renderer/components/view/ElementTextAreaShadowNode.h>
#import <react/renderer/core/LayoutMetrics.h>

using namespace facebook::react;

/*
 * A `<textarea>`'s placeholder sits on its first line whatever height the field
 * has. A `UILabel` centres its text vertically, so a label given the text
 * container's whole box lands in the middle of a tall field.
 */
@interface EXPTextAreaPlaceholderTests : XCTestCase
@end

@implementation EXPTextAreaPlaceholderTests

static Props::Shared placeholderProps(const std::string &placeholder)
{
  auto props = std::make_shared<ElementTextAreaProps>();
  props->nodeName = "textarea";
  props->placeholder = placeholder;
  return props;
}

// The placeholder label, a `UILabel` inside the view's text view
static UILabel *placeholderIn(UIView *view)
{
  for (UIView *child in view.subviews) {
    if ([child isKindOfClass:UILabel.class]) {
      return (UILabel *)child;
    }
    UILabel *found = placeholderIn(child);
    if (found != nil) {
      return found;
    }
  }
  return nil;
}

// A box the way the mounting path gives one: the text view is framed from the
// layout metrics' content frame, and `self.frame` alone leaves it at zero
static LayoutMetrics metricsOfSize(CGFloat width, CGFloat height)
{
  LayoutMetrics metrics;
  // Qualified: `Rect` and `Point` are Carbon's too
  metrics.frame = facebook::react::Rect{
      facebook::react::Point{0, 0}, facebook::react::Size{static_cast<Float>(width), static_cast<Float>(height)}};
  return metrics;
}

static UITextView *textViewIn(UIView *view)
{
  for (UIView *child in view.subviews) {
    if ([child isKindOfClass:UITextView.class]) {
      return (UITextView *)child;
    }
    UITextView *found = textViewIn(child);
    if (found != nil) {
      return found;
    }
  }
  return nil;
}

- (void)testThePlaceholderStaysOnTheFirstLineOfATallField
{
  EXPElementTextAreaComponentView *view = [[EXPElementTextAreaComponentView alloc] initWithFrame:CGRectZero];
  [view updateProps:placeholderProps("Message") oldProps:{}];

  const LayoutMetrics oneLine = metricsOfSize(300, 40);
  [view updateLayoutMetrics:oneLine oldLayoutMetrics:{}];

  UITextView *field = textViewIn(view);
  UILabel *placeholder = placeholderIn(view);
  XCTAssertNotNil(field, "the component view has no text view");
  XCTAssertNotNil(placeholder, "the component view has no placeholder label");

  // One line
  [view layoutIfNeeded];
  const CGFloat oneLineTop = CGRectGetMinY(placeholder.frame);
  const CGFloat oneLineHeight = CGRectGetHeight(placeholder.frame);
  XCTAssertGreaterThan(oneLineHeight, 0, "the placeholder has no box at all");

  // Four lines: the label's top is the container's top and its height its own
  [view updateLayoutMetrics:metricsOfSize(300, 40 + 3 * oneLineHeight) oldLayoutMetrics:oneLine];
  [view layoutIfNeeded];

  XCTAssertEqualWithAccuracy(
      CGRectGetMinY(placeholder.frame), oneLineTop, 0.5, "the placeholder moved down when the field grew");
  XCTAssertEqualWithAccuracy(
      CGRectGetHeight(placeholder.frame),
      oneLineHeight,
      0.5,
      "the placeholder's box grew with the field, so its line is drawn centred in it");
}

@end
