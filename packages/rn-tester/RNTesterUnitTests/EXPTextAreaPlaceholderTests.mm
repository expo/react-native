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
 * A `<textarea>`'s placeholder sits on its FIRST LINE, whatever height the
 * field has.
 *
 * A `UILabel` draws its text vertically centred in its frame, so a label given
 * the text container's whole box lands in the middle of it. In a field that is
 * one line that is exactly where the first typed character goes, which is why
 * it looked right for a year; in a field that has grown to four it is two lines
 * too low. A composer collapsing after a send passes through every height on
 * its way back, and the placeholder appears during those frames — reported from
 * a device as the placeholder jumping to the middle of the text area.
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

/** The placeholder label: a `UILabel` inside the view's text view. */
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

/*
 * A box the way the MOUNTING path gives one, which is the only way this view
 * takes one: the text view is the component view's content view, and a content
 * view is framed from the layout metrics' content frame. Setting `self.frame`
 * alone leaves it at zero, and every question about the placeholder's line then
 * has the same answer — nothing — whatever the code under test does.
 */
static LayoutMetrics metricsOfSize(CGFloat width, CGFloat height)
{
  LayoutMetrics metrics;
  // Qualified: `Rect` and `Point` are Carbon's too, and UIKit brings them in.
  metrics.frame = facebook::react::Rect{
      facebook::react::Point{0, 0},
      facebook::react::Size{static_cast<Float>(width), static_cast<Float>(height)}};
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

  // One line, which is the shape this has always been right in.
  [view layoutIfNeeded];
  const CGFloat oneLineTop = CGRectGetMinY(placeholder.frame);
  const CGFloat oneLineHeight = CGRectGetHeight(placeholder.frame);
  XCTAssertGreaterThan(oneLineHeight, 0, "the placeholder has no box at all");

  // And now four lines of it, the height a composer reaches before it collapses
  // back. The label's frame must not grow with the field: its top is the
  // container's top and its height is its own.
  [view updateLayoutMetrics:metricsOfSize(300, 40 + 3 * oneLineHeight) oldLayoutMetrics:oneLine];
  [view layoutIfNeeded];

  XCTAssertEqualWithAccuracy(
      CGRectGetMinY(placeholder.frame),
      oneLineTop,
      0.5,
      "the placeholder moved down when the field grew");
  XCTAssertEqualWithAccuracy(
      CGRectGetHeight(placeholder.frame),
      oneLineHeight,
      0.5,
      "the placeholder's box grew with the field, so its line is drawn centred in it");
}

@end
