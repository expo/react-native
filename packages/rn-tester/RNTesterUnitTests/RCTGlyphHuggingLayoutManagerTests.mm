/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <XCTest/XCTest.h>

#import <react/renderer/textlayoutmanager/RCTTextLayoutManager.h>

/*
 * The wrapped-highlight contract: a CSS background hugs the glyphs. TextKit's
 * own convention is the SELECTION one — a wrapped range's background runs on
 * to the line's wrap edge — which painted the first line of every wrapped
 * highlighted span to the end of the line while Safari and Android ended it
 * at the last glyph.
 *
 * The control half of each test IS the instrument check: a plain
 * NSLayoutManager must show the line-end overhang on the same text, or the
 * pixel being asserted on proves nothing.
 */
@interface RCTGlyphHuggingLayoutManagerTests : XCTestCase
@end

@implementation RCTGlyphHuggingLayoutManagerTests

static NSTextStorage *MakeStorage(NSLayoutManager *layoutManager, CGFloat width)
{
  NSTextContainer *container = [[NSTextContainer alloc] initWithSize:CGSizeMake(width, CGFLOAT_MAX)];
  container.lineFragmentPadding = 0;
  [layoutManager addTextContainer:container];
  NSDictionary *attributes = @{
    NSFontAttributeName : [UIFont systemFontOfSize:20],
    NSBackgroundColorAttributeName : UIColor.redColor,
  };
  NSTextStorage *storage = [[NSTextStorage alloc] initWithString:@"mmmm mmmm" attributes:attributes];
  [storage addLayoutManager:layoutManager];
  return storage;
}

// Renders the text and returns whether any red landed in the gap between the
// first line's used (glyph) extent and the container's right edge.
static BOOL RedInFirstLineWrapGap(NSLayoutManager *layoutManager, CGFloat width)
{
  NSTextStorage *storage = MakeStorage(layoutManager, width);
  (void)storage;
  NSTextContainer *container = layoutManager.textContainers.firstObject;
  NSRange glyphRange = [layoutManager glyphRangeForTextContainer:container];
  CGRect usedRect = [layoutManager lineFragmentUsedRectForGlyphAtIndex:0 effectiveRange:nil];

  UIGraphicsImageRendererFormat *format = [UIGraphicsImageRendererFormat new];
  format.scale = 1;
  UIGraphicsImageRenderer *renderer =
      [[UIGraphicsImageRenderer alloc] initWithSize:CGSizeMake(width, 100) format:format];
  UIImage *image = [renderer imageWithActions:^(UIGraphicsImageRendererContext *context) {
    [UIColor.whiteColor setFill];
    [context fillRect:CGRectMake(0, 0, width, 100)];
    [layoutManager drawBackgroundForGlyphRange:glyphRange atPoint:CGPointZero];
  }];

  // Sample the middle of the gap on the first line.
  CGFloat x = (CGRectGetMaxX(usedRect) + width) / 2;
  CGFloat y = CGRectGetMidY(usedRect);
  CGImageRef cg = image.CGImage;
  NSCParameterAssert(cg != nullptr);
  uint8_t pixel[4] = {0, 0, 0, 0};
  CGContextRef bitmap = CGBitmapContextCreate(
      pixel, 1, 1, 8, 4, CGColorSpaceCreateDeviceRGB(), kCGImageAlphaPremultipliedLast);
  CGContextDrawImage(
      bitmap, CGRectMake(-x * image.scale, -(image.size.height - y) * image.scale, image.size.width, image.size.height), cg);
  CGContextRelease(bitmap);
  return pixel[0] > 128 && pixel[1] < 100;
}

- (void)testWrappedBackgroundHugsTheGlyphs
{
  // Wide enough for one word, not two: "mmmm mmmm" wraps after the space.
  const CGFloat width = 80;

  BOOL controlOverhangs = RedInFirstLineWrapGap([NSLayoutManager new], width);
  XCTAssertTrue(
      controlOverhangs,
      @"instrument check failed: a plain NSLayoutManager should paint the wrap gap — "
       "if it does not, this test's pixel proves nothing");

  BOOL subjectOverhangs = RedInFirstLineWrapGap([RCTGlyphHuggingLayoutManager new], width);
  XCTAssertFalse(
      subjectOverhangs, @"the first line of a wrapped highlight must end at the last glyph, not the wrap edge");
}

- (void)testUnwrappedBackgroundIsUntouched
{
  // A single line has no wrap gap; the clamp must not eat legitimate
  // background inside the glyph extent.
  NSLayoutManager *layoutManager = [RCTGlyphHuggingLayoutManager new];
  NSTextStorage *storage = MakeStorage(layoutManager, 500);
  (void)storage;
  NSTextContainer *container = layoutManager.textContainers.firstObject;
  NSRange glyphRange = [layoutManager glyphRangeForTextContainer:container];
  CGRect usedRect = [layoutManager lineFragmentUsedRectForGlyphAtIndex:0 effectiveRange:nil];

  UIGraphicsImageRendererFormat *format = [UIGraphicsImageRendererFormat new];
  format.scale = 1;
  UIGraphicsImageRenderer *renderer = [[UIGraphicsImageRenderer alloc] initWithSize:CGSizeMake(500, 100) format:format];
  UIImage *image = [renderer imageWithActions:^(UIGraphicsImageRendererContext *context) {
    [UIColor.whiteColor setFill];
    [context fillRect:CGRectMake(0, 0, 500, 100)];
    [layoutManager drawBackgroundForGlyphRange:glyphRange atPoint:CGPointZero];
  }];

  // Sample the middle of the glyph run — must be red.
  CGFloat x = CGRectGetMidX(usedRect);
  CGFloat y = CGRectGetMidY(usedRect);
  uint8_t pixel[4] = {0, 0, 0, 0};
  CGContextRef bitmap = CGBitmapContextCreate(
      pixel, 1, 1, 8, 4, CGColorSpaceCreateDeviceRGB(), kCGImageAlphaPremultipliedLast);
  CGContextDrawImage(
      bitmap,
      CGRectMake(-x * image.scale, -(image.size.height - y) * image.scale, image.size.width, image.size.height),
      image.CGImage);
  CGContextRelease(bitmap);
  XCTAssertTrue(pixel[0] > 128 && pixel[1] < 100, @"the background inside the glyph extent must still paint");
}

@end
