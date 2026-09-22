/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>
#import <XCTest/XCTest.h>

#import <React/EXPChatBubblePath.h>

/**
 * What a chat balloon's shape has to be, stated so it cannot drift: a tail that
 * takes its space out of the width is invisible in a screenshot and obvious
 * with two balloons side by side. The reference numbers come from a rendered
 * iOS 26 balloon, traced at 3x with sub-pixel interpolation of the antialiased
 * coverage.
 */
@interface EXPChatBubbleTailTests : XCTestCase
@end

@implementation EXPChatBubbleTailTests {
  CGRect _bounds;
}

- (void)setUp
{
  [super setUp];
  // Wide enough that the tail is clear of the far corner and tall enough that
  // the radius is not clamped
  _bounds = CGRectMake(0, 0, 200, 60);
}

#pragma mark - helpers

/**
 * Where the outline is at a given height on the side named, sampled by
 * hit-testing across the row rather than by walking the segments.
 */
static CGFloat EdgeAt(UIBezierPath *path, CGRect bounds, CGFloat y, BOOL onRight)
{
  CGFloat found = onRight ? -1 : CGRectGetWidth(bounds) + 1;
  for (CGFloat x = 0; x <= CGRectGetWidth(bounds); x += 0.05) {
    if ([path containsPoint:CGPointMake(x, y)]) {
      found = onRight ? MAX(found, x) : MIN(found, x);
    }
  }
  return found;
}

/** The lowest point of the outline within a horizontal band. */
static CGFloat LowestInkBetween(UIBezierPath *path, CGRect bounds, CGFloat x0, CGFloat x1)
{
  CGFloat lowest = 0;
  for (CGFloat x = x0; x <= x1; x += 0.1) {
    for (CGFloat y = CGRectGetHeight(bounds); y >= 0; y -= 0.05) {
      if ([path containsPoint:CGPointMake(x, y)]) {
        lowest = MAX(lowest, y);
        break;
      }
    }
  }
  return lowest;
}

#pragma mark - the box

/**
 * A tail costs no width: the platform's tailed and tailless balloons measure
 * `L=329.00 R=376.33` both, with their text starting at `346.67`.
 */
- (void)testTailChangesNothingHorizontally
{
  UIBezierPath *tailed = EXPChatBubblePath(_bounds, 20, YES, YES);
  UIBezierPath *plain = EXPChatBubblePath(_bounds, 20, NO, YES);
  const CGRect a = CGPathGetPathBoundingBox(tailed.CGPath);
  const CGRect b = CGPathGetPathBoundingBox(plain.CGPath);
  XCTAssertEqualWithAccuracy(CGRectGetMinX(a), CGRectGetMinX(b), 0.01);
  XCTAssertEqualWithAccuracy(CGRectGetMaxX(a), CGRectGetMaxX(b), 0.01);
  // Nothing is drawn outside the box, since a mask shows nothing beyond its
  // layer
  XCTAssertEqualWithAccuracy(CGRectGetMaxX(a), CGRectGetWidth(_bounds), 0.01);
}

/**
 * A tail costs height and the body gives it up: the tailed body ends
 * `EXPChatBubbleTailDrop` above the box's bottom. Read at the middle of the
 * balloon, away from the tail and the corners.
 */
- (void)testBodyStopsShortOfTheBoxWhenTailed
{
  UIBezierPath *tailed = EXPChatBubblePath(_bounds, 20, YES, YES);
  UIBezierPath *plain = EXPChatBubblePath(_bounds, 20, NO, YES);
  const CGFloat middle = CGRectGetWidth(_bounds) / 2;
  const CGFloat tailedBottom = LowestInkBetween(tailed, _bounds, middle - 5, middle + 5);
  const CGFloat plainBottom = LowestInkBetween(plain, _bounds, middle - 5, middle + 5);
  XCTAssertEqualWithAccuracy(plainBottom, CGRectGetHeight(_bounds), 0.1);
  XCTAssertEqualWithAccuracy(plainBottom - tailedBottom, EXPChatBubbleTailDrop, 0.1);
}

/**
 * The reserve is exactly what the tail draws, measured off the path rather than
 * compared to a literal: the fitted curve reaches 6.649 where the tracing
 * resolved 6.62, and a reserve three hundredths short clips the tip on a
 * twenty-point balloon.
 */
- (void)testTheReserveIsWhatTheTailDraws
{
  UIBezierPath *path = EXPChatBubblePath(_bounds, 20, YES, YES);
  const CGFloat drawn = CGRectGetMaxY(CGPathGetPathBoundingBox(path.CGPath));
  const CGFloat body = CGRectGetHeight(_bounds) - EXPChatBubbleTailDrop;
  XCTAssertEqualWithAccuracy(drawn - body, EXPChatBubbleTailDrop, 0.005);
}

#pragma mark - the tail

/**
 * The tail reaches the bottom of the box only near the trailing edge: its lowest
 * ink is at `dx` 8.3 to 9.7 inward, a blunt point, and the body's bottom edge
 * is flat by `dx` 22.
 */
- (void)testTailHangsBelowTheBodyNearTheTrailingEdge
{
  UIBezierPath *path = EXPChatBubblePath(_bounds, 20, YES, YES);
  const CGFloat w = CGRectGetWidth(_bounds);
  const CGFloat h = CGRectGetHeight(_bounds);
  const CGFloat atTip = LowestInkBetween(path, _bounds, w - 9.7, w - 8.3);
  XCTAssertEqualWithAccuracy(atTip, h, 0.15, @"the tail should reach the box's bottom");
  const CGFloat pastTheTail = LowestInkBetween(path, _bounds, w - 30, w - EXPChatBubbleTailSpan - 1);
  XCTAssertEqualWithAccuracy(
      pastTheTail, h - EXPChatBubbleTailDrop, 0.15, @"the body's bottom edge should have resumed");
}

/**
 * The tail's ink stays inside the balloon's widest place, which distinguishes
 * iOS 26's tail from the older balloon artwork whose tail reaches past the
 * trailing edge: the tip is eight points inside the widest point.
 */
- (void)testTailStaysInsideTheBodysWidestPoint
{
  UIBezierPath *path = EXPChatBubblePath(_bounds, 20, YES, YES);
  const CGFloat w = CGRectGetWidth(_bounds);
  const CGFloat h = CGRectGetHeight(_bounds);
  const CGFloat widest = EdgeAt(path, _bounds, h / 2, YES);
  XCTAssertEqualWithAccuracy(widest, w, 0.1);
  const CGFloat atTail = EdgeAt(path, _bounds, h - 1, YES);
  XCTAssertLessThan(atTail, w - 6, @"the tail should not reach the body's edge");
  XCTAssertGreaterThan(atTail, w - 12, @"...but it should be close to it");
}

#pragma mark - the body

/**
 * A short balloon is a capsule: the design radius of twenty clamped to half the
 * body's height is exactly half for a 40-point one-word balloon, fitted to a
 * real one to 0.05 points.
 */
- (void)testShortBalloonIsACapsule
{
  const CGRect small = CGRectMake(0, 0, 48, 40);
  UIBezierPath *path = EXPChatBubblePath(small, 20, NO, YES);
  const CGFloat r = 20;
  for (CGFloat u = 2; u <= 18; u += 4) {
    // A circle of radius r, measured from the box's left edge.
    const CGFloat expected = r - sqrt(r * r - (r - u) * (r - u));
    XCTAssertEqualWithAccuracy(EdgeAt(path, small, u, NO), expected, 0.15, @"at %g points down", u);
  }
}

/**
 * The corner is circular, not a squircle: the platform's artwork joins its
 * corner with control points 9.665 along a 17.5 radius, the circle's kappa, and
 * a squircle differs by more than a point a quarter of the way down.
 */
- (void)testCornerIsCircular
{
  UIBezierPath *path = EXPChatBubblePath(_bounds, 20, NO, YES);
  const CGFloat r = 20;
  const CGFloat u = 5;
  const CGFloat circular = r - sqrt(r * r - (r - u) * (r - u));
  XCTAssertEqualWithAccuracy(EdgeAt(path, _bounds, u, NO), circular, 0.15);
}

/** The two sides are reflections of one another, because one table draws both. */
- (void)testLeadingTailMirrorsTrailing
{
  UIBezierPath *right = EXPChatBubblePath(_bounds, 20, YES, YES);
  UIBezierPath *left = EXPChatBubblePath(_bounds, 20, YES, NO);
  const CGFloat w = CGRectGetWidth(_bounds);
  for (CGFloat y = 2; y < CGRectGetHeight(_bounds); y += 3) {
    XCTAssertEqualWithAccuracy(EdgeAt(right, _bounds, y, YES), w - EdgeAt(left, _bounds, y, NO), 0.11, @"at y=%g", y);
  }
}

/**
 * A balloon narrower than `EXPChatBubbleTailSpan` (22 points) plus a corner
 * draws a plain balloon rather than an outline that doubles back through its
 * body.
 */
- (void)testTinyBalloonDoesNotSelfIntersect
{
  const CGRect tiny = CGRectMake(0, 0, 24, 20);
  UIBezierPath *path = EXPChatBubblePath(tiny, 20, YES, YES);
  XCTAssertFalse(path.isEmpty);
  const CGRect box = CGPathGetPathBoundingBox(path.CGPath);
  XCTAssertEqualWithAccuracy(CGRectGetWidth(box), CGRectGetWidth(tiny), 0.01);
  XCTAssertLessThanOrEqual(CGRectGetMaxY(box), CGRectGetHeight(tiny) + 0.01);
}

@end

#pragma mark - ground truth

#import <dlfcn.h>

/**
 * The platform's own outline, read out of `BubbleKit`: `BubblePath.init(frame:
 * configuration:)` leaves a Swift array of cubic segments at `self + 0x40`,
 * which `cgPath()` only replays, so the array is the outline. Layouts from the
 * initialiser's disassembly:
 *     BubblePath     frame @0x00 (4 doubles), configuration @0x20, segments @0x40  (0x48)
 *     Configuration  radius @0x00, tailStyle @0x08 (16 bytes), cornerStyle @0x18   (0x19)
 *     segment        start @0x00, control1 @0x10, control2 @0x20, end @0x30        (0x48)
 * `TailStyle` is `tailed(TailEdge, CGFloat)`; its sixteen bytes are tried in
 * every plausible spelling and the one that produces a tail is the answer.
 * Skipped unless `EXP_BUBBLEKIT_TRUTH` is set: an instrument for checking our
 * numbers against the platform's, depending on a private framework's layout.
 */
typedef struct {
  double fx, fy, fw, fh;
  double radius;
  uint64_t tail0, tail1;
  uint64_t cornerAndPadding;
  const void *segments;
} EXPBubbleKitPath;

@interface EXPBubbleKitGroundTruth : XCTestCase
@end

@implementation EXPBubbleKitGroundTruth

- (void)testDumpApplesOutline
{
  if (getenv("EXP_BUBBLEKIT_TRUTH") == NULL) {
    return;
  }
  void *handle = dlopen("/System/Library/PrivateFrameworks/BubbleKit.framework/BubbleKit", RTLD_NOW);
  XCTAssertTrue(handle != NULL, "BubbleKit did not load");
  void *sym = dlsym(handle, "$s9BubbleKit0A4PathV5frame13configurationACSo6CGRectV_AC13ConfigurationVtcfC");
  XCTAssertTrue(sym != NULL, "no BubblePath initialiser");

  typedef EXPBubbleKitPath (*Initialiser)(double, double, double, double, const void *);
  const Initialiser makePath = (Initialiser)sym;
  XCTAssertEqual(sizeof(EXPBubbleKitPath), (size_t)0x48);

  for (int tag = 0; tag <= 3; tag++) {
    for (int edge = 0; edge <= 1; edge++) {
      uint8_t config[32] = {0};
      *(double *)(config + 0) = 20.0;
      // the payload's CGFloat, which the API calls `percentTailVisible`
      *(double *)(config + 8) = 1.0;
      config[16] = (uint8_t)edge;
      config[17] = (uint8_t)tag;
      config[24] = 0; // circular

      const EXPBubbleKitPath path = makePath(0, 0, 200, 60, config);
      if (path.segments == NULL) {
        continue;
      }
      const long count = *(const long *)((const uint8_t *)path.segments + 0x10);
      if (count <= 0 || count > 200) {
        continue;
      }
      NSMutableString *out = [NSMutableString stringWithFormat:@"BKTRUTH tag=%d edge=%d n=%ld\n", tag, edge, count];
      const uint8_t *base = (const uint8_t *)path.segments + 0x20;
      const CGPoint start = *(const CGPoint *)base;
      [out appendFormat:@"  M %.4f %.4f\n", start.x, start.y];
      for (long i = 0; i < count; i++) {
        const uint8_t *e = base + i * 0x48;
        const CGPoint c1 = *(const CGPoint *)(e + 0x10);
        const CGPoint c2 = *(const CGPoint *)(e + 0x20);
        const CGPoint to = *(const CGPoint *)(e + 0x30);
        [out appendFormat:@"  C %.4f %.4f  %.4f %.4f  %.4f %.4f\n", c1.x, c1.y, c2.x, c2.y, to.x, to.y];
      }
      NSLog(@"%@", out);
    }
  }
}

@end
