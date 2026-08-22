/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <XCTest/XCTest.h>

#import <react/renderer/attributedstring/AttributedString.h>
#import <react/renderer/attributedstring/TextAttributes.h>
#import <react/renderer/components/view/ViewShadowNode.h>
#import <react/renderer/textlayoutmanager/RCTAttributedTextUtils.h>
#import <react/renderer/textlayoutmanager/RCTTextLayoutManager.h>
#import <react/renderer/textlayoutmanager/TextLayoutContext.h>

using namespace facebook::react;

/*
 * CSS half-leading around ATTACHMENT lines (css-inline / CSS2 §10.8).
 *
 * A paragraph with `line-height: 26px` at 15px type puts (26 - (ascent +
 * descent)) / 2 of leading on each side of the glyphs — including on the line
 * an atomic inline (an <img>, an inline-block) wraps onto. Safari and Android
 * both show ~4-5px of air between a text line and a 56px box on the next
 * line; iOS showed 1-2px, because the attachment's TextKit bounds accounted
 * for the strut's font descent but NOT the half-leading share below the
 * baseline — the line under a box was missing exactly the leading the
 * stylesheet asked for.
 */
@interface RCTAttachmentLineLeadingTests : XCTestCase
@end

@implementation RCTAttachmentLineLeadingTests

static AttributedString BuildParagraph(CGFloat lineHeight)
{
  auto textAttributes = TextAttributes::defaultTextAttributes();
  textAttributes.fontSize = 15;
  textAttributes.lineHeight = lineHeight;

  auto string = AttributedString{};

  auto text = AttributedString::Fragment{};
  text.string = "Ag mmmm";
  text.textAttributes = textAttributes;
  string.appendFragment(std::move(text));

  auto attachment = AttributedString::Fragment{};
  attachment.string = AttributedString::Fragment::AttachmentCharacter();
  attachment.textAttributes = textAttributes;
  auto metrics = LayoutMetrics{};
  metrics.frame.size = {56, 56};
  attachment.parentShadowView.layoutMetrics = metrics;
  // A box with no baseline of its own: the bottom edge is the baseline
  // (CSS2 §10.8.1), so nothing hangs below it but the strut.
  attachment.atomicInlineBaseline = 56;
  string.appendFragment(std::move(attachment));

  string.setBaseTextAttributes(textAttributes);
  return string;
}

// Lays the paragraph out narrow enough that the box wraps to its own line,
// and returns the line fragment rects.
static NSArray<NSValue *> *LineFragments(const AttributedString &string, CGFloat width)
{
  NSMutableAttributedString *converted =
      [RCTNSAttributedStringFromAttributedString(string) mutableCopy];
  RCTApplyBaselineOffset(converted);

  NSTextContainer *container = [[NSTextContainer alloc] initWithSize:CGSizeMake(width, CGFLOAT_MAX)];
  container.lineFragmentPadding = 0;
  NSLayoutManager *layoutManager = [RCTGlyphHuggingLayoutManager new];
  layoutManager.usesFontLeading = NO;
  [layoutManager addTextContainer:container];
  NSTextStorage *storage = [[NSTextStorage alloc] initWithAttributedString:converted];
  [storage addLayoutManager:layoutManager];

  NSMutableArray<NSValue *> *rects = [NSMutableArray new];
  [layoutManager enumerateLineFragmentsForGlyphRange:[layoutManager glyphRangeForTextContainer:container]
                                          usingBlock:^(CGRect rect,
                                                       CGRect usedRect,
                                                       NSTextContainer *_Nonnull textContainer,
                                                       NSRange glyphRange,
                                                       BOOL *_Nonnull stop) {
                                            [rects addObject:[NSValue valueWithCGRect:rect]];
                                          }];
  return rects;
}

// The demo's actual shape: the line ABOVE the tall box itself carries small
// inline images. CSS: that line's below-baseline extent is still the strut's
// descent + half-leading, so the ink-to-box air is ~4px at 15px/26px — which
// Safari and Android both show and the device screenshot puts at 1px.
- (void)testMixedTextAndImageLineKeepsItsBelowBaselineLeading
{
  const CGFloat lineHeight = 26;
  UIFont *font = [UIFont systemFontOfSize:15];
  const CGFloat ascent = std::abs(font.ascender);
  const CGFloat descent = std::abs(font.descender);
  const CGFloat halfLeading = (lineHeight - (ascent + descent)) / 2;

  auto textAttributes = TextAttributes::defaultTextAttributes();
  textAttributes.fontSize = 15;
  textAttributes.lineHeight = lineHeight;

  auto string = AttributedString{};
  auto text = AttributedString::Fragment{};
  text.string = "Small then ";
  text.textAttributes = textAttributes;
  string.appendFragment(std::move(text));

  auto small = AttributedString::Fragment{};
  small.string = AttributedString::Fragment::AttachmentCharacter();
  small.textAttributes = textAttributes;
  auto smallMetrics = LayoutMetrics{};
  smallMetrics.frame.size = {32, 32};
  small.parentShadowView.layoutMetrics = smallMetrics;
  small.atomicInlineBaseline = 32;
  string.appendFragment(std::move(small));

  auto more = AttributedString::Fragment{};
  more.string = " and more words to wrap";
  more.textAttributes = textAttributes;
  string.appendFragment(std::move(more));

  auto big = AttributedString::Fragment{};
  big.string = AttributedString::Fragment::AttachmentCharacter();
  big.textAttributes = textAttributes;
  auto bigMetrics = LayoutMetrics{};
  bigMetrics.frame.size = {56, 56};
  big.parentShadowView.layoutMetrics = bigMetrics;
  big.atomicInlineBaseline = 56;
  string.appendFragment(std::move(big));

  string.setBaseTextAttributes(textAttributes);

  NSArray<NSValue *> *lines = LineFragments(string, 200);
  XCTAssertGreaterThanOrEqual(lines.count, 2u);
  CGRect first = [lines[0] CGRectValue];

  // CSS: the first line's height = (32 img ascent above the baseline) +
  // (strut descent + half-leading below it). A capped or descent-starved
  // line loses exactly the half-leading.
  const CGFloat expectedFirst = 32 + descent + halfLeading;
  XCTAssertEqualWithAccuracy(first.size.height, expectedFirst, 1.0);
}

// The whole device path in one: RCTTextLayoutManager's measure — the API the
// attachment-placement pass uses to position the real view — must put the
// box's frame on the line the fragments describe, a full 26px line below the
// text, not tucked up into its leading.
- (void)testMeasuredAttachmentFrameSitsBelowTheFullFirstLine
{
  const CGFloat lineHeight = 26;
  UIFont *font = [UIFont systemFontOfSize:16];
  const CGFloat ascent = std::abs(font.ascender);
  const CGFloat descent = std::abs(font.descender);
  const CGFloat halfLeading = (lineHeight - (ascent + descent)) / 2;

  auto textAttributes = TextAttributes::defaultTextAttributes();
  textAttributes.fontSize = 16;
  textAttributes.lineHeight = lineHeight;

  auto string = AttributedString{};
  auto text = AttributedString::Fragment{};
  text.string = "Small then medium then large and more words to force a wrap ";
  text.textAttributes = textAttributes;
  string.appendFragment(std::move(text));

  auto big = AttributedString::Fragment{};
  big.string = AttributedString::Fragment::AttachmentCharacter();
  big.textAttributes = textAttributes;
  auto bigMetrics = LayoutMetrics{};
  bigMetrics.frame.size = {56, 56};
  big.parentShadowView.layoutMetrics = bigMetrics;
  big.atomicInlineBaseline = 56;
  string.appendFragment(std::move(big));

  auto trailing = AttributedString::Fragment{};
  trailing.string = " trailing text after the tall box";
  trailing.textAttributes = textAttributes;
  string.appendFragment(std::move(trailing));

  string.setBaseTextAttributes(textAttributes);

  RCTTextLayoutManager *manager = [RCTTextLayoutManager new];
  auto measurement = [manager measureAttributedString:string
                                  paragraphAttributes:ParagraphAttributes{}
                                        layoutContext:TextLayoutContext{.pointScaleFactor = 3}
                                    layoutConstraints:LayoutConstraints{
                                        .minimumSize = {0, 0},
                                        .maximumSize = {360, CGFLOAT_MAX}}];

  XCTAssertEqual(measurement.attachments.size(), 1u);
  const auto frame = measurement.attachments[0].frame;
  // The wrap puts the box at the start of line 2. CSS says line 1 is 26px
  // tall — glyphs centred, half-leading on each side — so the box's top is at
  // least 26 minus nothing: a smaller y means the line above lost its
  // below-glyph leading and the box rode up into it (the 1px-vs-4px gap the
  // device screenshots show against Safari and Android).
  XCTAssertGreaterThanOrEqual(frame.origin.y, 26 - 0.5);
  // And not absurdly far down either — one full line, not two.
  XCTAssertLessThan(frame.origin.y, 26 + (lineHeight - 1));
  // The half-leading itself is real at these metrics, or the assertions above
  // would be too loose to mean anything.
  XCTAssertGreaterThan(halfLeading, 2.0);
  (void)ascent;
  (void)descent;
}

- (void)testAttachmentLineCarriesTheStrutsHalfLeading
{
  const CGFloat lineHeight = 26;
  UIFont *font = [UIFont systemFontOfSize:15];
  const CGFloat ascent = std::abs(font.ascender);
  const CGFloat descent = std::abs(font.descender);
  const CGFloat halfLeading = (lineHeight - (ascent + descent)) / 2;

  NSArray<NSValue *> *lines = LineFragments(BuildParagraph(lineHeight), 80);
  XCTAssertEqual(lines.count, 2u, @"the box must wrap to its own line for this to measure anything");

  CGRect textLine = [lines[0] CGRectValue];
  CGRect boxLine = [lines[1] CGRectValue];

  // The text line is exactly the stylesheet's line box: 26px.
  XCTAssertEqualWithAccuracy(textLine.size.height, lineHeight, 0.5);
  // And the box's line starts where the text line ends.
  XCTAssertEqualWithAccuracy(boxLine.origin.y, CGRectGetMaxY(textLine), 0.5);

  // The line the box sits on: the box's 56px above the baseline, and BELOW it
  // the strut still hangs its descent plus the half-leading the line-height
  // distributes — which is the air Safari and Android both show under a box
  // and iOS was missing.
  const CGFloat expected = 56 + descent + halfLeading;
  XCTAssertEqualWithAccuracy(boxLine.size.height, expected, 1.0);
}

@end

/*
 * The half-leading a run with an ATTACHMENT was losing.
 *
 * `RCTUnclampLineHeightForAtomicInlines` lifts `maximumLineHeight` to 0 — the
 * TextKit spelling of "no ceiling" — so a box taller than the strut can grow
 * its line (CSS2 §10.8). The line height moves to the MINIMUM and stays there.
 * `RCTApplyBaselineOffset` read only the maximum, saw 0, concluded no line
 * height had been asked for, and returned: every such run lost the offset that
 * centres its glyphs, and the text sat high by exactly that amount.
 */
@interface RCTUnclampedStrutLeadingTests : XCTestCase
@end

@implementation RCTUnclampedStrutLeadingTests

extern void RCTApplyBaselineOffset(NSMutableAttributedString *attributedText);

- (NSMutableAttributedString *)_stringWithMinimum:(CGFloat)minimum maximum:(CGFloat)maximum font:(UIFont *)font
{
  NSMutableParagraphStyle *paragraphStyle = [NSMutableParagraphStyle new];
  paragraphStyle.minimumLineHeight = minimum;
  paragraphStyle.maximumLineHeight = maximum;
  return [[NSMutableAttributedString alloc]
      initWithString:@"Save"
          attributes:@{NSFontAttributeName : font, NSParagraphStyleAttributeName : paragraphStyle}];
}

- (CGFloat)_offsetOf:(NSAttributedString *)string
{
  NSNumber *offset = [string attribute:NSBaselineOffsetAttributeName atIndex:0 effectiveRange:NULL];
  return offset != nil ? offset.doubleValue : 0;
}

static AttributedString ParagraphWithAttachmentOfHeight(CGFloat lineHeight, CGFloat attachmentHeight)
{
  auto textAttributes = TextAttributes::defaultTextAttributes();
  textAttributes.fontSize = 14;
  textAttributes.lineHeight = lineHeight;

  auto string = AttributedString{};
  auto text = AttributedString::Fragment{};
  text.string = "Save";
  text.textAttributes = textAttributes;
  string.appendFragment(std::move(text));

  auto attachment = AttributedString::Fragment{};
  attachment.string = AttributedString::Fragment::AttachmentCharacter();
  attachment.textAttributes = textAttributes;
  auto metrics = LayoutMetrics{};
  metrics.frame.size = {attachmentHeight, attachmentHeight};
  attachment.parentShadowView.layoutMetrics = metrics;
  attachment.atomicInlineBaseline = attachmentHeight;
  string.appendFragment(std::move(attachment));

  string.setBaseTextAttributes(textAttributes);
  return string;
}

static CGFloat CeilingOf(const AttributedString &string)
{
  NSAttributedString *converted = RCTNSAttributedStringFromAttributedString(string);
  NSParagraphStyle *paragraphStyle = [converted attribute:NSParagraphStyleAttributeName
                                                  atIndex:0
                                           effectiveRange:NULL];
  return paragraphStyle.maximumLineHeight;
}

- (void)testAnICONThatFitsKeepsTheLinesCeiling
{
  /*
   * A 16pt icon on a 20pt line needs nothing lifted — the strut is already as
   * tall as the line has to be. Keeping the ceiling is what lets
   * `RCTApplyBaselineOffset` centre the glyphs in it; without it the text drew
   * high, which is what shadcn's buttons and tabs showed.
   */
  XCTAssertEqualWithAccuracy(CeilingOf(ParagraphWithAttachmentOfHeight(20, 16)), 20, 0.01);
}

- (void)testABOXTallerThanTheLineStillLiftsIt
{
  // The case the unclamping was written for: a 50pt box on a 20pt line has to
  // be able to push the line open (CSS2 §10.8) rather than overflow upwards.
  XCTAssertEqual(CeilingOf(ParagraphWithAttachmentOfHeight(20, 50)), 0);
}

- (void)testAClampedLineIsUnchanged
{
  // Text-only runs pin both bounds to the same number, and must keep exactly
  // the offset they had — `<Text>` does not move.
  UIFont *font = [UIFont systemFontOfSize:14];
  NSMutableAttributedString *string = [self _stringWithMinimum:30 maximum:30 font:font];

  RCTApplyBaselineOffset(string);

  XCTAssertEqualWithAccuracy([self _offsetOf:string], (30 - font.lineHeight) / 2, 0.01);
}

- (void)testNoLineHeightStillMeansNoOffset
{
  UIFont *font = [UIFont systemFontOfSize:14];
  NSMutableAttributedString *string = [self _stringWithMinimum:0 maximum:0 font:font];

  RCTApplyBaselineOffset(string);

  XCTAssertEqual([self _offsetOf:string], 0, @"nothing was asked for, so nothing is applied");
}

@end

