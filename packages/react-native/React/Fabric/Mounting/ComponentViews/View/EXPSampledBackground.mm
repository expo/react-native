/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPSampledBackground.h"


/** Whether a pixel of the rendered area falls inside any of the asked-for rects. */
static BOOL EXPPixelIsWanted(NSArray<NSValue *> *wanted, size_t x, size_t y)
{
  const CGPoint point = CGPointMake((CGFloat)x + 0.5, (CGFloat)y + 0.5);
  for (NSValue *value in wanted) {
    if (CGRectContainsPoint(value.CGRectValue, point)) {
      return YES;
    }
  }
  return NO;
}

UIColor *_Nullable EXPSampledBackgroundColor(UIView *view, NSArray<NSValue *> *rects)
{
  UIWindow *canvas = view.window;
  if (canvas == nil || rects.count == 0) {
    return nil;
  }

  CGRect area = CGRectNull;
  for (NSValue *value in rects) {
    const CGRect inCanvas = [view convertRect:value.CGRectValue toView:canvas];
    area = CGRectIsNull(area) ? inCanvas : CGRectUnion(area, inCanvas);
  }
  area = CGRectIntersection(CGRectIntegral(area), canvas.bounds);
  if (CGRectIsEmpty(area) || CGRectIsNull(area)) {
    return nil;
  }

  /*
   * The rects THEMSELVES, in the rendered bitmap's own coordinates.
   *
   * The bitmap has to cover their union — that is one render — but the census
   * below must only count pixels that are actually inside one of the rects.
   * Counting the whole union instead is a bug with a very plausible answer:
   * asked for two narrow strips down either side of a card, the union is the
   * card, and the modal colour comes back as the CARD'S OWN — so "what is
   * behind me" answers "me", every card looks like it is on a page its own
   * colour, and the caller draws an edge everywhere. Measured exactly that way:
   * the strips beside a white card on a grey page reported (255, 255, 255).
   */
  NSMutableArray<NSValue *> *wanted = [NSMutableArray arrayWithCapacity:rects.count];
  for (NSValue *value in rects) {
    const CGRect inCanvas = CGRectIntersection([view convertRect:value.CGRectValue toView:canvas], area);
    if (!CGRectIsEmpty(inCanvas) && !CGRectIsNull(inCanvas)) {
      [wanted addObject:[NSValue valueWithCGRect:CGRectOffset(inCanvas, -area.origin.x, -area.origin.y)]];
    }
  }
  if (wanted.count == 0) {
    return nil;
  }

  /*
   * A bitmap context of OUR OWN format, rather than whatever
   * `UIGraphicsImageRenderer` hands back. Its images come out BGRA on this
   * platform, and reading those bytes as RGBA silently returns the right shade
   * with red and blue swapped — a purple page produced a pink chip, which looks
   * enough like a colour to pass for one. Naming the layout here removes the
   * question.
   *
   * The context is also flipped into UIKit's orientation before rendering. A
   * bitmap context draws from the bottom left, and while that does not matter to
   * a census of colours, it absolutely matters to WHICH pixels are counted: left
   * unflipped, the sample lands on a mirrored band of the screen. That was
   * invisible against a page of one flat colour and produced a BLACK chip on a
   * white page.
   */
  const size_t width = (size_t)ceil(area.size.width);
  const size_t height = (size_t)ceil(area.size.height);
  if (width == 0 || height == 0) {
    return nil;
  }
  CGColorSpaceRef space = CGColorSpaceCreateDeviceRGB();
  CGContextRef context = CGBitmapContextCreate(
      NULL,
      width,
      height,
      8,
      width * 4,
      space,
      (uint32_t)kCGImageAlphaPremultipliedLast | (uint32_t)kCGBitmapByteOrder32Big);
  CGColorSpaceRelease(space);
  if (context == NULL) {
    return nil;
  }
  CGContextTranslateCTM(context, 0, (CGFloat)height);
  CGContextScaleCTM(context, 1, -1);
  CGContextTranslateCTM(context, -area.origin.x, -area.origin.y);
  /*
   * Rendered under the LINK's traits.
   *
   * Drawing a layer tree off screen re-resolves every dynamic colour in it, and
   * outside a view's own update the current trait collection is the default —
   * light. So a dark app sampled its own page and got the LIGHT variant back:
   * a white chip on a black page, which is the same bug as the black chip and
   * points the other way.
   */
  [canvas.traitCollection performAsCurrentTraitCollection:^{
    [canvas.layer renderInContext:context];
  }];

  const uint8_t *bytes = (const uint8_t *)CGBitmapContextGetData(context);
  if (bytes == NULL) {
    CGContextRelease(context);
    return nil;
  }

  // A census over 16-bit-packed RGB, so near-identical shades count together
  // rather than splitting the vote between them.
  NSCountedSet<NSNumber *> *census = [NSCountedSet set];
  // Counted rather than derived from the area: only the asked-for rects are
  // sampled, so the area's size says nothing about how many pixels there were.
  NSUInteger sampled = 0;
  for (size_t y = 0; y < height; y++) {
    for (size_t x = 0; x < width; x++) {
      if (!EXPPixelIsWanted(wanted, x, y)) {
        continue;
      }
      const uint8_t *pixel = bytes + y * width * 4 + x * 4;
      if (pixel[3] < 128) {
        continue; // nothing painted here
      }
      const NSUInteger key = ((pixel[0] >> 3) << 10) | ((pixel[1] >> 3) << 5) | (pixel[2] >> 3);
      [census addObject:@(key)];
      sampled++;
    }
  }
  NSNumber *winner = nil;
  NSUInteger best = 0;
  for (NSNumber *candidate in census) {
    const NSUInteger count = [census countForObject:candidate];
    if (count > best) {
      best = count;
      winner = candidate;
    }
  }
  if (winner == nil) {
    CGContextRelease(context);
    return nil;
  }
  // Fewer than a third of the pixels agreeing means there is no flat background
  // here — a photograph, a gradient. Better to leave UIKit's platter alone than
  // to pick one shade out of many.
  if (best * 3 < sampled) {
    CGContextRelease(context);
    return nil;
  }

  /*
   * Second pass: the exact colour, averaged over the pixels that voted for the
   * winning bucket.
   *
   * The buckets are five bits a channel so that near-identical shades count
   * together, but handing that back would put the platter up to eight levels off
   * the page it is meant to match — near enough to look like a mistake rather
   * than a match.
   */
  const NSUInteger key = winner.unsignedIntegerValue;
  double sums[3] = {0, 0, 0};
  double counted = 0;
  for (size_t y = 0; y < height; y++) {
    for (size_t x = 0; x < width; x++) {
      if (!EXPPixelIsWanted(wanted, x, y)) {
        continue;
      }
      const uint8_t *pixel = bytes + y * width * 4 + x * 4;
      if (pixel[3] < 128) {
        continue;
      }
      const NSUInteger bucket = ((pixel[0] >> 3) << 10) | ((pixel[1] >> 3) << 5) | (pixel[2] >> 3);
      if (bucket != key) {
        continue;
      }
      sums[0] += pixel[0];
      sums[1] += pixel[1];
      sums[2] += pixel[2];
      counted += 1;
    }
  }
  CGContextRelease(context);
  if (counted == 0) {
    return nil;
  }
  CGFloat channels[3] = {sums[0] / counted / 255.0, sums[1] / counted / 255.0, sums[2] / counted / 255.0};
  /*
   * Never hand back pure black.
   *
   * UIKit treats an exactly-black `backgroundColor` on `UIPreviewParameters` as
   * no colour at all and substitutes its own light platter, so a page that is
   * genuinely #000 — which RNTester's dark theme is — produced a WHITE chip on a
   * black page. One level up is indistinguishable to the eye and is taken as an
   * answer. Measured: a page of #050509 lifts a chip of exactly #050509, while
   * #000000 lifts UIKit's #F2F2F7.
   */
  if (channels[0] <= 0 && channels[1] <= 0 && channels[2] <= 0) {
    channels[0] = channels[1] = channels[2] = 1.0 / 255.0;
  }
  return [UIColor colorWithRed:channels[0] green:channels[1] blue:channels[2] alpha:1];
}
