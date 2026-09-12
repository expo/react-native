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
 * What a chat balloon's shape has to be, stated so it cannot drift.
 *
 * A balloon with a slightly wrong tail looks like a balloon, which is why this
 * is a test and not a comment. The version these replaced was wrong in exactly
 * that way for months: its tail took its space out of the balloon's WIDTH, so a
 * message that happened to end a run was five points wider than the same message
 * in the middle of one and its text sat five points further from the edge.
 * Nobody sees that in a screenshot. It is obvious the moment two balloons are
 * side by side, which is how a real conversation always shows it.
 *
 * The reference numbers come from a rendered iOS 26 balloon, traced at 3x with
 * sub-pixel interpolation of the antialiased coverage.
 */
@interface EXPChatBubbleTailTests : XCTestCase
@end

@implementation EXPChatBubbleTailTests {
  CGRect _bounds;
}

- (void)setUp
{
  [super setUp];
  // Wide enough that the tail is nowhere near the far corner, and tall enough
  // that the corner radius is not clamped by the height.
  _bounds = CGRectMake(0, 0, 200, 60);
}

#pragma mark - helpers

/**
 * Where the outline is at a given height, on the side named.
 *
 * Sampled by hit-testing across the row: a path knows whether a point is inside
 * it, and that is a more honest reading of "where is the edge" than walking the
 * segments and hoping the sampling matches the renderer's.
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
 * A tail costs no width. This is the bug these tests exist for.
 *
 * Apple's two balloons, measured off a real conversation: `L=329.00 R=376.33`
 * for the tailed one and `L=329.00 R=376.33` for the tailless one, and their
 * text starts at `346.67` in both.
 */
- (void)testTailChangesNothingHorizontally
{
  UIBezierPath *tailed = EXPChatBubblePath(_bounds, 20, YES, YES);
  UIBezierPath *plain = EXPChatBubblePath(_bounds, 20, NO, YES);
  const CGRect a = CGPathGetPathBoundingBox(tailed.CGPath);
  const CGRect b = CGPathGetPathBoundingBox(plain.CGPath);
  XCTAssertEqualWithAccuracy(CGRectGetMinX(a), CGRectGetMinX(b), 0.01);
  XCTAssertEqualWithAccuracy(CGRectGetMaxX(a), CGRectGetMaxX(b), 0.01);
  // And the box is the box: nothing is drawn outside it, because a mask cannot
  // show anything beyond its own layer.
  XCTAssertEqualWithAccuracy(CGRectGetMaxX(a), CGRectGetWidth(_bounds), 0.01);
}

/**
 * A tail costs HEIGHT, and the body gives it up.
 *
 * The tailed balloon's body ends `EXPChatBubbleTailDrop` above the box's bottom
 * and the tail hangs in the strip below it. Read at the middle of the balloon,
 * away from both the tail and the corners.
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
 * The reserve is exactly what the tail DRAWS, not a number beside it.
 *
 * Measured off the path rather than compared to a literal, because a literal
 * cannot catch the thing that went wrong: the constant was set to 6.62, the
 * lowest point the tracing could resolve, and the curve fitted to that tracing
 * reaches 6.649. The shadow node then reserved three hundredths less than the
 * renderer drew and the mask clipped the tip — invisible at any ordinary size
 * and caught on a balloon twenty points tall.
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
 * The tail reaches the bottom of the box, and only near the trailing edge.
 *
 * Traced: the tail's lowest ink is at `dx` 8.3 to 9.7 inward from the trailing
 * edge — a blunt point, not a spike — and the body's bottom edge is flat by
 * `dx` 22.
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
 * The tail's own ink stays INSIDE the balloon's widest place.
 *
 * This is what distinguishes iOS 26's tail from the platform's older balloon
 * artwork, whose tail reaches five and a half points PAST the body's trailing
 * edge. Measured on a rendered balloon: the widest point is at mid-height and
 * the tail's tip is eight points inside it.
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
 * A short balloon is a capsule.
 *
 * The radius is a design radius of twenty CLAMPED to half the body's height,
 * which for the 40-point balloon a one-word message makes is exactly half — so
 * its sides are semicircles and it has no straight edge at all. Fitted to a real
 * one to 0.05 points.
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
 * The corner is CIRCULAR, not a squircle.
 *
 * The platform's own balloon artwork settles it: its corner is joined with
 * control points 9.665 along a 17.5 radius, and 9.665 / 17.5 is 0.55228 —
 * the circle's kappa. A squircle of the same radius is measurably fuller; at a
 * quarter of the way down the corner it differs by more than a point, which is
 * what this would catch.
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
    XCTAssertEqualWithAccuracy(
        EdgeAt(right, _bounds, y, YES), w - EdgeAt(left, _bounds, y, NO), 0.11, @"at y=%g", y);
  }
}

/**
 * A balloon too small to hold a tail degrades rather than crossing itself.
 *
 * `EXPChatBubbleTailSpan` is 22 points, so a balloon narrower than that plus a
 * corner has nowhere to put the tail's inner side. It draws a plain balloon
 * instead of an outline that doubles back through its own body.
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
 * Apple's own outline, read out of `BubbleKit` rather than fitted to a picture.
 *
 * `BubblePath.init(frame:configuration:)` stores its two arguments and calls a
 * builder that leaves a Swift array of cubic segments at `self + 0x40`.
 * `cgPath()` does nothing else with it: move to the first element's start point,
 * then `addCurve` through every element's remaining three. So the array IS the
 * outline, and reaching it needs only the initialiser — which is an ordinary
 * Swift ABI call, a large struct returned indirectly and a pointer to the
 * configuration.
 *
 * The layouts come from the initialiser's own disassembly:
 *
 *     BubblePath     frame @0x00 (4 doubles), configuration @0x20, segments @0x40  (0x48)
 *     Configuration  radius @0x00, tailStyle @0x08 (16 bytes), cornerStyle @0x18   (0x19)
 *     segment        start @0x00, control1 @0x10, control2 @0x20, end @0x30        (0x48)
 *
 * `TailStyle` is `tailed(TailEdge, CGFloat)` and its sixteen bytes are the one
 * thing the disassembly does not settle, so every plausible spelling is tried
 * and the one that produces a tail is the answer. That is cheaper than reading
 * the builder's two thousand instructions and it cannot be wrong in a way the
 * output would hide.
 *
 * Skipped unless `EXP_BUBBLEKIT_TRUTH` is set: it is an instrument for checking
 * our own numbers against Apple's, not an assertion about our code, and it
 * depends on a private framework's struct layout.
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
  void *sym =
      dlsym(handle, "$s9BubbleKit0A4PathV5frame13configurationACSo6CGRectV_AC13ConfigurationVtcfC");
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
