/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPCornerShape.h"

/**
 * One corner of a superellipse, appended to a path already at `from`.
 *
 * `n` is the classic exponent — 2 is the circle, 1 a straight bevel, below 1
 * concave, and infinity a square corner. `centre` is the corner box's inner
 * point, `from` and `to` the points on the two edges the curve joins.
 *
 * Sampled at 32 points rather than 12. The samples are even in the PARAMETER
 * and the parameter is very uneven in arc length once `n` leaves 2 — at twelve,
 * a squircle chorded across half its own corner and rendered as a plain circle.
 */
static void EXPAddSuperellipseCorner(UIBezierPath *path, CGPoint centre, CGPoint from, CGPoint to, CGFloat n)
{
  static const NSInteger steps = 32;
  const CGFloat rx = (fabs(from.x - centre.x) > fabs(to.x - centre.x)) ? from.x - centre.x : to.x - centre.x;
  const CGFloat ry = (fabs(from.y - centre.y) > fabs(to.y - centre.y)) ? from.y - centre.y : to.y - centre.y;
  const BOOL startsVertical = fabs(from.y - centre.y) > fabs(from.x - centre.x);

  if (n == 0) {
    // `notch`: the curve collapses onto the centre, so the outline turns in to
    // the far corner of the corner box and back out — a rectangular bite. This
    // is the mirror of `square` below, not the same shape.
    [path addLineToPoint:centre];
    [path addLineToPoint:to];
    return;
  }
  if (isinf(n)) {
    // `square`: the corner is the box's corner.
    [path addLineToPoint:CGPointMake(centre.x + rx, centre.y + ry)];
    [path addLineToPoint:to];
    return;
  }
  const CGFloat power = 2.0 / n;
  for (NSInteger i = 1; i <= steps; i++) {
    const CGFloat t = (CGFloat)i / steps * M_PI_2;
    const CGFloat c = pow(fabs(cos(t)), power);
    const CGFloat sn = pow(fabs(sin(t)), power);
    const CGFloat u = startsVertical ? sn : c;
    const CGFloat v = startsVertical ? c : sn;
    [path addLineToPoint:CGPointMake(centre.x + rx * u, centre.y + ry * v)];
  }
}

/**
 * A box's whole outline, corner by corner.
 *
 * `bevel` and the concave shapes are the reason this exists at all: a layer's
 * own corner can be circular or continuous and nothing else, so anything else
 * has to be clipped.
 */
UIBezierPath *EXPCornerShapePath(CGRect bounds, const facebook::react::BorderMetrics &metrics)
{
  const CGFloat w = CGRectGetWidth(bounds);
  const CGFloat h = CGRectGetHeight(bounds);
  const CGFloat limit = MIN(w, h) / 2;
  const CGFloat tl = MIN((CGFloat)metrics.borderRadii.topLeft.horizontal, limit);
  const CGFloat tr = MIN((CGFloat)metrics.borderRadii.topRight.horizontal, limit);
  const CGFloat br = MIN((CGFloat)metrics.borderRadii.bottomRight.horizontal, limit);
  const CGFloat bl = MIN((CGFloat)metrics.borderRadii.bottomLeft.horizontal, limit);

  UIBezierPath *path = [UIBezierPath bezierPath];
  [path moveToPoint:CGPointMake(tl, 0)];
  [path addLineToPoint:CGPointMake(w - tr, 0)];
  EXPAddSuperellipseCorner(
      path,
      CGPointMake(w - tr, tr),
      CGPointMake(w - tr, 0),
      CGPointMake(w, tr),
      metrics.cornerShapes.topRight.exponent());
  [path addLineToPoint:CGPointMake(w, h - br)];
  EXPAddSuperellipseCorner(
      path,
      CGPointMake(w - br, h - br),
      CGPointMake(w, h - br),
      CGPointMake(w - br, h),
      metrics.cornerShapes.bottomRight.exponent());
  [path addLineToPoint:CGPointMake(bl, h)];
  EXPAddSuperellipseCorner(
      path,
      CGPointMake(bl, h - bl),
      CGPointMake(bl, h),
      CGPointMake(0, h - bl),
      metrics.cornerShapes.bottomLeft.exponent());
  [path addLineToPoint:CGPointMake(0, tl)];
  EXPAddSuperellipseCorner(
      path, CGPointMake(tl, tl), CGPointMake(0, tl), CGPointMake(tl, 0), metrics.cornerShapes.topLeft.exponent());
  [path closePath];
  return path;
}
