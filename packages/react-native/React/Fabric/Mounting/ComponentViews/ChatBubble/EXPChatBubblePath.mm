/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPChatBubblePath.h"

#import <react/renderer/components/view/ExpoChatBubbleShadowNode.h>

#import <cmath>

const CGFloat EXPChatBubbleTailDrop = facebook::react::kExpoChatBubbleTailDrop;
const CGFloat EXPChatBubbleTailRise = 5.0;
const CGFloat EXPChatBubbleTailSpan = 22.0;

/**
 * The tail, from where it leaves the corner arc to where the bottom edge
 * resumes, as offsets from the box's trailing edge and the body's bottom. `dx`
 * runs inward and `dy` down, so one table serves both sides and the leading
 * tail is this one mirrored by transform. Traced off a rendered balloon at 3x
 * and fitted segment by segment, each cubic meeting its neighbour's tangent:
 *     segment   samples   max error
 *     neck        17        0.157
 *     bulge       17        0.041
 *     tip          7        0.032
 *     inner a     19        0.041
 *     inner b     18        0.049
 * Fitted rather than taken from the platform's published balloon artwork,
 * which draws a different balloon: its tail reaches past the body's trailing
 * edge, where the shipping one hangs below the body inside its width.
 */
static const CGFloat kNeckDx = 9.940;
static const CGFloat kNeckDy = 0.380;

/**
 * The distance from the departure point to the first control point, along the
 * arc's own tangent so the join is smooth for any radius.
 */
static const CGFloat kNeckLeadIn = 2.153;

/**
 * One corner of the body, as a circular arc: the platform's balloon artwork
 * joins (24.5, 35) to (42, 17.5) with control points 9.665 along each tangent,
 * 9.665 / 17.5 being the circle's kappa, and a circle of radius 20 fits a
 * rendered corner to 0.05 points.
 */
static void EXPAddCorner(UIBezierPath *path, CGPoint centre, CGFloat r, CGFloat from, CGFloat to)
{
  [path addArcWithCenter:centre radius:r startAngle:from endAngle:to clockwise:YES];
}

UIBezierPath *EXPChatBubblePath(CGRect bounds, CGFloat radius, CGFloat tailAmount, BOOL tailOnRight)
{
  const CGFloat w = CGRectGetWidth(bounds);
  const CGFloat h = CGRectGetHeight(bounds);

  /*
   * The tail costs height and only height: the platform's tailed and tailless
   * balloons share their left and right edges and their text position, and the
   * tailed one is 6.6 points taller.
   */
  /*
   * How much of a tail there is, between none and all of one. The platform's tail
   * shrinks over about three frames rather than switching, so every part of the
   * shape scales with the amount: the body's bottom rises as the reserve opens,
   * the departure point slides down the corner, and the tail's control points
   * collapse onto the bottom edge; at zero `rise` is 0, so `sin(theta)` is 1 and
   * the corner sweeps its full quarter, which is the tailless balloon. The caller
   * reads the amount out of the padding the element reserves, and the reserve is
   * what animates. See `ExpoChatBubbleProps::tailBasePadding`.
   */
  const CGFloat amount = MAX((CGFloat)0, MIN((CGFloat)1, tailAmount));
  const BOOL tailed = amount > 0;
  const CGFloat bodyH = MAX(h - EXPChatBubbleTailDrop * amount, 0);
  const CGFloat r = MIN(radius, MIN(w, bodyH) / 2);
  UIBezierPath *path = [UIBezierPath bezierPath];

  if (r <= 0 || w <= 0 || bodyH <= 0) {
    return path;
  }

  // Where the tail leaves the arc and rejoins the bottom edge, clamped so a
  // balloon too small for the tail degrades to a shorter one rather than a
  // self-crossing outline
  const CGFloat rise = MIN(EXPChatBubbleTailRise, r) * amount;
  const CGFloat span = MIN(EXPChatBubbleTailSpan, w - r);
  const BOOL drawTail = tailed && span > kNeckDx;

  const CGFloat sinT = (r - rise) / r;
  const CGFloat cosT = std::sqrt(MAX(1 - sinT * sinT, (CGFloat)0));
  const CGFloat departDx = r - r * cosT;

  // `dx` inward from the trailing edge, `dy` down from the body's bottom.
  const auto P = [&](CGFloat dx, CGFloat dy) { return CGPointMake(w - dx, bodyH + dy); };
  /*
   * The same for the tail's own points, which shrink on both axes about `(r, 0)`,
   * where the bottom corner ends and the tail begins, so the tail keeps its shape
   * and loses its size as the platform's does; scaling `dy` alone leaves a wide
   * shallow scoop half way. At zero every tail point lands on the corner's end.
   * Separate from `P` because the neck's lead-in control point is built from
   * `rise`, `sinT` and `cosT`, which already carry the amount.
   */
  const auto Pt = [&](CGFloat dx, CGFloat dy) { return P(r + (dx - r) * amount, dy * amount); };

  [path moveToPoint:CGPointMake(r, 0)];
  [path addLineToPoint:CGPointMake(w - r, 0)];
  EXPAddCorner(path, CGPointMake(w - r, r), r, -M_PI_2, 0);
  [path addLineToPoint:CGPointMake(w, bodyH - r)];

  if (drawTail) {
    // Down the bottom-trailing corner as far as the tail's neck; the rest of
    // that corner is the tail
    EXPAddCorner(path, CGPointMake(w - r, bodyH - r), r, 0, std::asin(sinT));
    [path addCurveToPoint:Pt(kNeckDx, kNeckDy)
            controlPoint1:P(departDx + kNeckLeadIn * sinT, -rise + kNeckLeadIn * cosT)
            controlPoint2:Pt(kNeckDx, -1.987)];
    // Out to the tail's widest point, round the blunt tip, and back up its
    // inside to the body's bottom edge
    [path addCurveToPoint:Pt(7.810, 5.720) controlPoint1:Pt(kNeckDx, 3.394) controlPoint2:Pt(7.401, 5.038)];
    [path addCurveToPoint:Pt(10.000, 6.500) controlPoint1:Pt(8.146, 6.280) controlPoint2:Pt(7.730, 6.954)];
    [path addCurveToPoint:Pt(16.000, 3.210) controlPoint1:Pt(11.881, 5.910) controlPoint2:Pt(14.805, 4.012)];
    /*
     * The last control point is on the bottom line so the curve is tangent to the
     * edge it joins, as the platform's is (flat to a hundredth of a point out to
     * `dx` 22); a free fit put a visible crease there, and the fit is better with
     * the constraint, 0.049 against 0.125.
     */
    [path addCurveToPoint:Pt(span, 0) controlPoint1:Pt(18.231, 1.711) controlPoint2:Pt(19.962, 0)];
  } else {
    EXPAddCorner(path, CGPointMake(w - r, bodyH - r), r, 0, M_PI_2);
  }

  [path addLineToPoint:CGPointMake(r, bodyH)];
  EXPAddCorner(path, CGPointMake(r, bodyH - r), r, M_PI_2, M_PI);
  [path addLineToPoint:CGPointMake(0, r)];
  EXPAddCorner(path, CGPointMake(r, r), r, M_PI, 3 * M_PI_2);
  [path closePath];

  if (!tailOnRight) {
    // The mirror image by transform; a fill does not care that the outline is
    // traversed the other way round
    [path applyTransform:CGAffineTransformMake(-1, 0, 0, 1, w, 0)];
  }
  return path;
}
