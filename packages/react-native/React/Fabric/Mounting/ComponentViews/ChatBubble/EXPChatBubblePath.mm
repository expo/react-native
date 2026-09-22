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
 * resumes, in offsets from the box's trailing edge and the BODY's bottom.
 *
 * `dx` runs INWARD from the trailing edge and `dy` DOWN from the body's bottom,
 * so every number below is positive where the shape is and the same table serves
 * both sides — the leading-side tail is this one mirrored, by transform, rather
 * than a second table written out backwards. (It was written out backwards once.
 * The two copies disagreed.)
 *
 * Traced off a rendered balloon at 3x and fitted segment by segment, each cubic
 * constrained to meet its neighbour's tangent. Worst residual over the five
 * segments is 0.16 points, and three of them are under 0.05:
 *
 *     segment   samples   max error
 *     neck        17        0.157
 *     bulge       17        0.041
 *     tip          7        0.032
 *     inner a     19        0.041
 *     inner b     18        0.049
 *
 * A note on why these are fitted numbers rather than published ones. The
 * platform's older balloon artwork is available as vector control points, and an
 * earlier version of this file used them verbatim. But that artwork draws a
 * DIFFERENT balloon from the one iOS 26 renders — its tail reaches five points
 * PAST the body's trailing edge, where the shipping one hangs below the body and
 * stays inside its width; the live outline is computed in code and only the
 * previous generations survive as artwork. So the choice was exact numbers for
 * the wrong shape or a fit to the right one.
 */
static const CGFloat kNeckDx = 9.940;
static const CGFloat kNeckDy = 0.380;

/**
 * The distance from the departure point to the first control point.
 *
 * Placed along the ARC's own tangent rather than at a fixed offset, so the join
 * is smooth for any radius: a balloon shorter than 40 points has a smaller
 * corner, and a control point measured from one radius kinks against another.
 */
static const CGFloat kNeckLeadIn = 2.153;

/**
 * One corner of the body, as a circular arc.
 *
 * Circular, not continuous, and not a squircle. The platform's own balloon
 * artwork settles it: its corner joins (24.5, 35) to (42, 17.5) with control
 * points 9.665 along each tangent, and 9.665 / 17.5 is 0.55228 — the circle's
 * kappa. Confirmed against a rendered balloon, where a circle of radius 20 fits
 * the corner to 0.05 points.
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
   * The tail costs HEIGHT, and only height.
   *
   * This is the whole difference from the shape that shipped before, which
   * reserved a strip on the trailing edge and so made a balloon with a tail
   * wider than one without — with its text pushed the same distance away from
   * the edge. Measured on a real conversation, Apple's two balloons have the
   * same left and right edges to a third of a point and their text starts at
   * exactly the same place; the tailed one is 6.6 points TALLER.
   */
  /*
   * How much of a tail there is, between none and all of one.
   *
   * A BOOLEAN until a balloon had to lose its tail while a reader watched. The
   * tail is two things — an outline and `EXPChatBubbleTailDrop` of reserved
   * height — and switching both at once snaps. The native balloon does not: measured off
   * a recording, its tail is full on one frame, visibly smaller two frames
   * later and gone on the third, about 50ms.
   *
   * So the tail has a SIZE, and every part of it scales with that size: the
   * body's bottom rises as the reserve opens, the departure point slides down
   * the corner, and the tail's own control points collapse onto the bottom
   * edge. At zero the arithmetic degenerates exactly — `rise` is 0, so
   * `sin(theta)` is 1 and the corner sweeps its full quarter, and every tail
   * offset is on the body's bottom line — which is the tailless balloon.
   *
   * The caller does not animate this. It reads it out of the padding the
   * element currently reserves, and the RESERVE is what animates. One quantity,
   * so the shape cannot drift out of step with the box it is drawn in. See
   * `ExpoChatBubbleProps::tailBasePadding`.
   */
  const CGFloat amount = MAX((CGFloat)0, MIN((CGFloat)1, tailAmount));
  const BOOL tailed = amount > 0;
  const CGFloat bodyH = MAX(h - EXPChatBubbleTailDrop * amount, 0);
  const CGFloat r = MIN(radius, MIN(w, bodyH) / 2);
  UIBezierPath *path = [UIBezierPath bezierPath];

  if (r <= 0 || w <= 0 || bodyH <= 0) {
    return path;
  }

  // Where the tail leaves the arc, and where it rejoins the bottom edge. Both
  // clamped so that a balloon too small to hold the tail degrades to a shorter
  // one rather than a self-crossing outline.
  const CGFloat rise = MIN(EXPChatBubbleTailRise, r) * amount;
  const CGFloat span = MIN(EXPChatBubbleTailSpan, w - r);
  const BOOL drawTail = tailed && span > kNeckDx;

  const CGFloat sinT = (r - rise) / r;
  const CGFloat cosT = std::sqrt(MAX(1 - sinT * sinT, (CGFloat)0));
  const CGFloat departDx = r - r * cosT;

  // `dx` inward from the trailing edge, `dy` down from the body's bottom.
  const auto P = [&](CGFloat dx, CGFloat dy) { return CGPointMake(w - dx, bodyH + dy); };
  /*
   * The same, for the tail's own points — which shrink toward the ROOT it hangs
   * from rather than flattening onto the bottom edge.
   *
   * Scaling `dy` alone was tried and is wrong to look at. The tail keeps its
   * full footprint while losing its depth, so half way through it is a wide
   * shallow scallop under the balloon — a scoop, not a tail. Reported from a
   * device: "the tip of the tail looks very awkward when it animates towards an
   * end state where only its y-coordinate changes."
   *
   * Both axes, about `(r, 0)` — the point where the bottom corner ends and the
   * tail begins. The tail then keeps its SHAPE and loses its SIZE, which is
   * what the native balloon does: measured off a recording, its tail is narrower as well
   * as shallower two frames before it goes. At zero every tail point lands on
   * the corner's end, where the full quarter-corner has just arrived, so the
   * outline is the tailless balloon exactly.
   *
   * Separate from `P` because the neck's lead-in control point is built from
   * `rise`, `sinT` and `cosT` — all of which already carry the amount — and
   * scaling it again would square it. It collapses on its own: at zero `rise`
   * is zero and `cos(theta)` is zero with it.
   */
  const auto Pt = [&](CGFloat dx, CGFloat dy) {
    return P(r + (dx - r) * amount, dy * amount);
  };

  [path moveToPoint:CGPointMake(r, 0)];
  [path addLineToPoint:CGPointMake(w - r, 0)];
  EXPAddCorner(path, CGPointMake(w - r, r), r, -M_PI_2, 0);
  [path addLineToPoint:CGPointMake(w, bodyH - r)];

  if (drawTail) {
    // Down the bottom-trailing corner, but only as far as the tail's neck: the
    // rest of that corner is the tail.
    EXPAddCorner(path, CGPointMake(w - r, bodyH - r), r, 0, std::asin(sinT));
    [path addCurveToPoint:Pt(kNeckDx, kNeckDy)
            controlPoint1:P(departDx + kNeckLeadIn * sinT, -rise + kNeckLeadIn * cosT)
            controlPoint2:Pt(kNeckDx, -1.987)];
    // Out to the tail's widest point, round the blunt tip, and back up its
    // inside — which is the body's bottom edge, sweeping down to meet it.
    [path addCurveToPoint:Pt(7.810, 5.720) controlPoint1:Pt(kNeckDx, 3.394) controlPoint2:Pt(7.401, 5.038)];
    [path addCurveToPoint:Pt(10.000, 6.500) controlPoint1:Pt(8.146, 6.280) controlPoint2:Pt(7.730, 6.954)];
    [path addCurveToPoint:Pt(16.000, 3.210) controlPoint1:Pt(11.881, 5.910) controlPoint2:Pt(14.805, 4.012)];
    /*
     * The last control point is ON the bottom line, which is the point of it.
     *
     * Leaving the curve to meet the bottom edge at whatever angle a free fit
     * chose put a visible CREASE there — the edge ran flat and then turned down
     * by ten degrees in one step. Apple's does not: its bottom edge is flat to
     * within a hundredth of a point out to `dx` 22 and only then falls away, so
     * the curve is tangent to the edge it joins. Constraining `c2` to `dy = 0`
     * is that tangent, and it costs nothing — the fit is BETTER with it, 0.049
     * against 0.125, because it is what the balloon actually does.
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
    // The mirror image, by transform. The outline is then traversed the other
    // way round, which a fill does not care about — and one table of numbers
    // cannot disagree with itself.
    [path applyTransform:CGAffineTransformMake(-1, 0, 0, 1, w, 0)];
  }
  return path;
}
