/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <XCTest/XCTest.h>

#import <react/renderer/attributedstring/AttributedString.h>
#import <react/renderer/attributedstring/TextAttributes.h>
#import <react/renderer/core/LayoutConstraints.h>
#import <react/renderer/textlayoutmanager/RCTAttributedTextUtils.h>
#import <react/renderer/textlayoutmanager/RCTTextLayoutManager.h>
#import <react/renderer/textlayoutmanager/TextLayoutContext.h>

using namespace facebook::react;

/*
 * What a run reports after it WRAPS (`experimental_hugsWrappedLines`).
 *
 * A wrapped run fills the width it was given, and a box that shrinks to fit
 * around it therefore stands at that width with the space the last line did
 * not use inside it. That is the CSS answer (css-sizing-3 §5.2.2) and the one
 * a paragraph in a column wants. A chat balloon wants the other one — the
 * longest line — because that is the shape the platform's own balloon takes.
 *
 * Each test carries its own instrument check: the control measure must come
 * back at exactly the container width, or the string did not wrap and the
 * assertion below it is about nothing.
 */
@interface RCTWrappedRunHugTests : XCTestCase
@end

@implementation RCTWrappedRunHugTests

// Two words that are the same width, so the run wraps into two lines whose
// longest is one word — comfortably short of the container.
static AttributedString MakeRun()
{
  auto textAttributes = TextAttributes::defaultTextAttributes();
  textAttributes.fontSize = 20;

  auto fragment = AttributedString::Fragment{};
  fragment.string = "mmmm mmmm";
  fragment.textAttributes = textAttributes;

  auto string = AttributedString{};
  string.appendFragment(std::move(fragment));
  string.setBaseTextAttributes(textAttributes);
  return string;
}

static TextMeasurement Measure(const AttributedString &string, CGFloat width, bool hugs)
{
  auto layoutContext = TextLayoutContext{};
  layoutContext.pointScaleFactor = 1;
  layoutContext.hugsWrappedLines = hugs;

  auto layoutConstraints = LayoutConstraints{};
  layoutConstraints.maximumSize = {static_cast<Float>(width), std::numeric_limits<Float>::infinity()};

  // A fresh manager per measure: the measurement cache is per-manager, and two
  // measures of the same string at the same width differ only in the flag.
  return [[RCTTextLayoutManager new] measureAttributedString:string
                                        paragraphAttributes:{}
                                              layoutContext:layoutContext
                                          layoutConstraints:layoutConstraints];
}

// The longest line TextKit actually laid out, measured independently of the
// code under test.
static CGFloat LongestLine(const AttributedString &string, CGFloat width)
{
  NSTextContainer *container = [[NSTextContainer alloc] initWithSize:CGSizeMake(width, CGFLOAT_MAX)];
  container.lineFragmentPadding = 0;
  NSLayoutManager *layoutManager = [NSLayoutManager new];
  layoutManager.usesFontLeading = NO;
  [layoutManager addTextContainer:container];
  NSTextStorage *storage =
      [[NSTextStorage alloc] initWithAttributedString:RCTNSAttributedStringFromAttributedString(string)];
  [storage addLayoutManager:layoutManager];

  __block CGFloat longest = 0;
  NSRange glyphRange = [layoutManager glyphRangeForTextContainer:container];
  [layoutManager enumerateLineFragmentsForGlyphRange:glyphRange
                                          usingBlock:^(
                                              CGRect,
                                              CGRect usedRect,
                                              NSTextContainer *,
                                              NSRange,
                                              BOOL *) {
                                            longest = MAX(longest, CGRectGetWidth(usedRect));
                                          }];
  return longest;
}

- (void)testAWrappedRunFillsTheWidthItWasGiven
{
  const CGFloat width = 100;
  auto string = MakeRun();

  auto measurement = Measure(string, width, false);
  XCTAssertEqualWithAccuracy(
      measurement.size.width,
      width,
      0.01,
      @"a wrapped run reports the width it was given — this is the CSS shrink-to-fit answer");
}

- (void)testAWrappedRunThatHugsReportsItsLongestLine
{
  const CGFloat width = 100;
  auto string = MakeRun();

  auto given = Measure(string, width, false);
  XCTAssertEqualWithAccuracy(
      given.size.width,
      width,
      0.01,
      @"instrument check failed: the run did not wrap, so hugging it proves nothing");

  auto hugged = Measure(string, width, true);
  XCTAssertEqualWithAccuracy(
      hugged.size.width,
      ceil(LongestLine(string, width)),
      0.01,
      @"a hugging run must report the longest line TextKit laid out");
  XCTAssertLessThan(hugged.size.width, given.size.width, @"and that line is narrower than the container");
  XCTAssertEqualWithAccuracy(
      hugged.size.height, given.size.height, 0.01, @"hugging changes the width reported, not the lines");
}

- (void)testAnUnwrappedRunIsTheSameEitherWay
{
  // Wide enough for both words: nothing wrapped, so there is nothing to hug
  // and the two answers must agree.
  const CGFloat width = 500;
  auto string = MakeRun();

  auto given = Measure(string, width, false);
  auto hugged = Measure(string, width, true);
  XCTAssertLessThan(given.size.width, width, @"instrument check failed: this run was supposed to fit on one line");
  XCTAssertEqualWithAccuracy(hugged.size.width, given.size.width, 0.01);
}

@end
