/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>
#import <XCTest/XCTest.h>

#import <React/EXPElementControlMetricsProbe.h>
#import <React/EXPElementTextAreaComponentView.h>
#import <react/renderer/components/view/ElementTextAreaShadowNode.h>
#import <react/renderer/core/LayoutMetrics.h>

using namespace facebook::react;

/*
 * A `<textarea>` is as tall as `rows` lines of the control's own text, and its
 * text sits where a plain `UITextView` puts it.
 *
 * `rows` cannot be answered by the control — neither platform's sizes itself
 * from it — so layout multiplies `rows` by what the control said its line box
 * is and adds what it said its inset is. Both came from the platform at
 * startup (`EXPPrewarmElementControlMetrics`).
 *
 * So these tests assert no numbers of their own. They check that the probe
 * REPORTS THE CONTROL — that the pair it published reproduces what a real
 * `UITextView` measures — which is the only thing that can actually be wrong
 * now. The two numbers that used to live in the user-agent sheet were 30 and
 * 21 against a platform that says 16 and 20.2871: a box 72 points tall at
 * HTML's default two rows where a native one is 57, wrong for months because
 * nothing they described could contradict them.
 */
@interface EXPElementTextAreaGeometryTests : XCTestCase
@end

@implementation EXPElementTextAreaGeometryTests

static LayoutMetrics metricsOfSize(CGFloat width, CGFloat height)
{
  LayoutMetrics metrics;
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

/* The element's control, laid out the way mounting lays it out. */
static UITextView *MountedField(void)
{
  EXPElementTextAreaComponentView *view = [[EXPElementTextAreaComponentView alloc] initWithFrame:CGRectZero];
  auto props = std::make_shared<ElementTextAreaProps>();
  props->nodeName = "textarea";
  [view updateProps:props oldProps:{}];
  [view updateLayoutMetrics:metricsOfSize(240, 60) oldLayoutMetrics:{}];
  [view layoutIfNeeded];
  return textViewIn(view);
}

/*
 * OUR control's inner spacing is the platform's, not something restated.
 *
 * An author who states no padding gets `textContainerInset` back — it is not
 * interchangeable with layout padding, because the inset lets long text scroll
 * THROUGH it where a smaller content box clips. This asserts the handing-back
 * actually happened: for a while it did not, and the field's text sat flush in
 * the corner of its box.
 */
- (void)testAnUnstyledFieldHasThePlatformsOwnSpacing
{
  UITextView *ours = MountedField();
  XCTAssertNotNil(ours, "the component view has no text view");
  UITextView *plain = [[UITextView alloc] initWithFrame:CGRectMake(0, 0, 240, 60)];

  const UIEdgeInsets mine = ours.textContainerInset;
  const UIEdgeInsets theirs = plain.textContainerInset;
  XCTAssertEqualWithAccuracy(mine.top, theirs.top, 0.01, @"top inset is not the platform's");
  XCTAssertEqualWithAccuracy(mine.bottom, theirs.bottom, 0.01, @"bottom inset is not the platform's");
  XCTAssertEqualWithAccuracy(mine.left, theirs.left, 0.01, @"left inset is not the platform's");
  XCTAssertEqualWithAccuracy(mine.right, theirs.right, 0.01, @"right inset is not the platform's");
  XCTAssertEqualWithAccuracy(
      ours.textContainer.lineFragmentPadding,
      plain.textContainer.lineFragmentPadding,
      0.01,
      @"the line fragment padding is not the platform's");
}

/*
 * The probe published what the control actually measures.
 *
 * Derived from ONE line and TWO so both terms are the control's: the line box
 * is what a second line cost, the inset is what was left over. If UIKit
 * changes either, this fails — and the layout that reads them has already
 * changed with it, which is the point.
 */
- (void)testTheProbeReportsWhatARealTextViewMeasures
{
  EXPPrewarmElementControlMetrics();
  const auto metrics = facebook::react::elementControlMetrics();

  UITextView *plain = [[UITextView alloc] initWithFrame:CGRectMake(0, 0, 240, 400)];
  plain.font = [UIFont systemFontOfSize:17];
  plain.text = @"Xg";
  const CGFloat oneLine = [plain sizeThatFits:CGSizeMake(240, CGFLOAT_MAX)].height;
  plain.text = @"Xg\nXg";
  const CGFloat twoLines = [plain sizeThatFits:CGSizeMake(240, CGFLOAT_MAX)].height;

  XCTAssertEqualWithAccuracy(
      metrics.textAreaLineBox, twoLines - oneLine, 0.01, @"the published line box is not the control's");
  XCTAssertEqualWithAccuracy(
      metrics.textAreaInsetBlock,
      oneLine - (twoLines - oneLine),
      0.01,
      @"the published block inset is not the control's");
  XCTAssertGreaterThan(metrics.textAreaLineBox, 0, @"the probe published no line box at all");
}

/*
 * And the sum: a `rows={n}` box is as tall as a native text view showing n
 * lines.
 *
 * Measured against the real thing rather than against the two terms, so a
 * mistake in how they are COMBINED fails too. The tolerance is the pixel grid:
 * TextKit rounds each line fragment up to a whole pixel, and the probe took
 * the line box as the DIFFERENCE between one line and two, so the rounding
 * appears once in the probe and n times in the sum.
 */
- (void)testARowsBoxIsAsTallAsThatManyNativeLines
{
  EXPPrewarmElementControlMetrics();
  const auto metrics = facebook::react::elementControlMetrics();
  UITextView *plain = [[UITextView alloc] initWithFrame:CGRectMake(0, 0, 240, 400)];
  plain.font = [UIFont systemFontOfSize:17];

  for (NSInteger rows = 1; rows <= 8; rows++) {
    NSMutableString *lines = [NSMutableString string];
    for (NSInteger line = 0; line < rows; line++) {
      [lines appendString:(line == 0 ? @"Xg" : @"\nXg")];
    }
    plain.text = lines;
    const CGFloat native = [plain sizeThatFits:CGSizeMake(240, CGFLOAT_MAX)].height;
    const CGFloat sheet = metrics.textAreaInsetBlock + rows * metrics.textAreaLineBox;
    NSLog(@"@@TEXTAREAGEO rows=%ld native=%.2f sheet=%.2f", (long)rows, native, sheet);
    XCTAssertEqualWithAccuracy(
        sheet,
        native,
        rows * 0.25 + 0.01,
        @"a rows=%ld textarea is not as tall as %ld native lines",
        (long)rows,
        (long)rows);
  }
}

@end
