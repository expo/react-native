/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>
#import <XCTest/XCTest.h>

#include <cmath>
#include <vector>

#import <react/renderer/textlayoutmanager/RCTAttributedTextUtils.h>
#import <react/renderer/textlayoutmanager/RCTTextLayoutManager.h>

/*
 * WHERE THE INK LANDS in a line taller than its font.
 *
 * `line-height` bigger than the font's own puts half the difference above the
 * glyphs and half below — CSS2 §10.8's half-leading, and what every browser
 * does. `RCTApplyBaselineOffset` says so by adding that half as a baseline
 * offset, once, in the attributed string.
 *
 * It was then applied a SECOND time at drawing, by an override that translated
 * the context by `NSBaselineOffsetAttributeName` in the belief that TextKit
 * ignored the attribute in layout. TextKit does not ignore it. Every piece of
 * text with a stated line height sat a full leading high instead of half a
 * leading — for 96 commits, through every suite, because nothing measured
 * PIXELS. Structure tests cannot see this: the string is right, the metrics are
 * right, the frames are right, and the glyphs are in the wrong place.
 *
 * So this test draws. It renders through the real layout manager and asks the
 * bitmap where the ink is, which is the only question the bug ever answered
 * wrongly.
 *
 * The measurement is DIFFERENTIAL — the same string drawn twice, once at the
 * font's natural line height and once at a stated one — so it asserts nothing
 * about a particular font's metrics and holds if the system font changes.
 */
@interface EXPLineHeightInkTests : XCTestCase
@end

@implementation EXPLineHeightInkTests

/** The string this test draws: one glyph with ink above and below the baseline. */
static NSMutableAttributedString *TextWithLineHeight(CGFloat lineHeight, UIFont *font)
{
  NSMutableParagraphStyle *style = [NSMutableParagraphStyle new];
  if (lineHeight > 0) {
    style.minimumLineHeight = lineHeight;
    style.maximumLineHeight = lineHeight;
  }
  NSMutableAttributedString *text =
      [[NSMutableAttributedString alloc] initWithString:@"Hp"
                                             attributes:@{NSFontAttributeName : font, NSParagraphStyleAttributeName : style}];
  // The production path: this is what states the half-leading, and it is the
  // one that used to be applied twice.
  RCTApplyBaselineOffset(text);
  return text;
}

/**
 * The topmost row of the drawn glyphs, in points from the top of the line box,
 * or NAN when nothing was drawn.
 *
 * Drawn at 1x into a bitmap context — CoreText needs no render server, so
 * unlike a view snapshot this is the same everywhere, including on a machine
 * with no display.
 */
static CGFloat TopOfInk(NSAttributedString *text, CGSize size)
{
  const size_t width = (size_t)size.width;
  const size_t height = (size_t)size.height;
  const size_t bytesPerRow = width * 4;
  std::vector<uint8_t> pixels(bytesPerRow * height, 0);

  CGColorSpaceRef space = CGColorSpaceCreateDeviceRGB();
  CGContextRef context = CGBitmapContextCreate(
      pixels.data(), width, height, 8, bytesPerRow, space, kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
  CGColorSpaceRelease(space);

  NSTextStorage *storage = [[NSTextStorage alloc] initWithAttributedString:text];
  // The SHIPPING layout manager, not a bare one: the defect lived in this
  // class, so a test that laid out with `NSLayoutManager` would have passed
  // throughout.
  RCTGlyphHuggingLayoutManager *layoutManager = [RCTGlyphHuggingLayoutManager new];
  layoutManager.usesFontLeading = NO;
  NSTextContainer *container = [[NSTextContainer alloc] initWithSize:size];
  container.lineFragmentPadding = 0;
  [layoutManager addTextContainer:container];
  [storage addLayoutManager:layoutManager];

  UIGraphicsPushContext(context);
  // Flipped, so row 0 of the bitmap is the top of the line box and the numbers
  // read the way the layout does.
  CGContextTranslateCTM(context, 0, (CGFloat)height);
  CGContextScaleCTM(context, 1, -1);
  const NSRange glyphs = [layoutManager glyphRangeForTextContainer:container];
  [layoutManager drawGlyphsForGlyphRange:glyphs atPoint:CGPointZero];
  UIGraphicsPopContext();

  CGFloat top = NAN;
  for (size_t y = 0; y < height && std::isnan(top); y++) {
    for (size_t x = 0; x < width; x++) {
      if (pixels[y * bytesPerRow + x * 4 + 3] > 32) {
        top = (CGFloat)y;
        break;
      }
    }
  }
  CGContextRelease(context);
  return top;
}

- (void)testTheHalfLeadingIsAppliedONCE
{
  UIFont *font = [UIFont systemFontOfSize:12];
  const CGFloat natural = font.lineHeight;
  const CGFloat extra = 12;
  const CGSize size = CGSizeMake(60, natural + extra + 20);

  const CGFloat naturalTop = TopOfInk(TextWithLineHeight(0, font), size);
  const CGFloat statedTop = TopOfInk(TextWithLineHeight(natural + extra, font), size);

  XCTAssertFalse(std::isnan(naturalTop), @"nothing was drawn — the instrument, not the layout");
  XCTAssertFalse(std::isnan(statedTop), @"nothing was drawn — the instrument, not the layout");

  /*
   * Half of the extra room, above the glyphs. The whole of it is the bug: that
   * is the drawing-time offset landing on top of the layout-time one, and it
   * puts the text where the line BELOW it should start.
   */
  XCTAssertEqualWithAccuracy(
      statedTop - naturalTop, extra / 2, 1.0, @"the leading above the glyphs must be half the extra room, not all of it");
}

- (void)testTextWithNoStatedLineHeightIsNotMovedAtAll
{
  // The other half of the rule, and the reason the bug went unseen: text
  // without a line height carries no offset, so most of the screen looked
  // right. Only styled text moved.
  UIFont *font = [UIFont systemFontOfSize:12];
  const CGSize size = CGSizeMake(60, font.lineHeight + 20);

  NSMutableAttributedString *plain =
      [[NSMutableAttributedString alloc] initWithString:@"Hp" attributes:@{NSFontAttributeName : font}];
  const CGFloat before = TopOfInk(plain, size);
  RCTApplyBaselineOffset(plain);
  const CGFloat after = TopOfInk(plain, size);

  XCTAssertFalse(std::isnan(before));
  XCTAssertEqualWithAccuracy(after, before, 0.5);
}

@end
