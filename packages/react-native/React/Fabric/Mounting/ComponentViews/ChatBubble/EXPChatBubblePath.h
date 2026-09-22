/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * How far below the BODY the tail hangs, in points.
 *
 * The same number the shadow node reserves as bottom padding
 * (`kExpoChatBubbleTailDrop`); asserted equal by a test, because the box is
 * sized in C++ and drawn here and a disagreement between them is a tail that is
 * clipped or a gap under the balloon.
 */
FOUNDATION_EXPORT const CGFloat EXPChatBubbleTailDrop;

/** How far ABOVE the body's bottom the tail leaves the corner arc. */
FOUNDATION_EXPORT const CGFloat EXPChatBubbleTailRise;

/** How far IN from the trailing edge the tail rejoins the body's bottom edge. */
FOUNDATION_EXPORT const CGFloat EXPChatBubbleTailSpan;

/**
 * A chat balloon's whole outline — body and tail — as ONE path.
 *
 * `bounds` is the WHOLE box, tail included: when `tailed`, the body is
 * `EXPChatBubbleTailDrop` shorter than the box and the tail hangs in the strip
 * below it. Nothing is ever drawn outside `bounds`, because this path is used as
 * a mask and a mask shows nothing beyond its own layer.
 *
 * Declared here so the geometry can be asserted rather than only looked at. Two
 * balloons differing by a couple of points are indistinguishable in a screenshot
 * and obvious side by side, which is the worst combination to review by eye.
 */
/**
 * The balloon's outline, with a tail of the given SIZE.
 *
 * `tailAmount` is 0 for no tail, 1 for a whole one, and anything between for a
 * tail on its way in or out — every part of the shape scales with it, so at 0
 * the arithmetic degenerates exactly into the tailless balloon. The caller does
 * not animate it: it reads it out of the `padding-bottom` the element currently
 * reserves, and the reserve is what transitions.
 */
FOUNDATION_EXPORT UIBezierPath *EXPChatBubblePath(CGRect bounds, CGFloat radius, CGFloat tailAmount, BOOL tailOnRight);

NS_ASSUME_NONNULL_END
