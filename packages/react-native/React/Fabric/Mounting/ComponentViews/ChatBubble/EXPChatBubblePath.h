/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * How far below the body the tail hangs, in points: the same number the shadow
 * node reserves as bottom padding (`kExpoChatBubbleTailDrop`), asserted equal by
 * a test, since a disagreement is a clipped tail or a gap under the balloon.
 */
FOUNDATION_EXPORT const CGFloat EXPChatBubbleTailDrop;

/** How far ABOVE the body's bottom the tail leaves the corner arc. */
FOUNDATION_EXPORT const CGFloat EXPChatBubbleTailRise;

/** How far IN from the trailing edge the tail rejoins the body's bottom edge. */
FOUNDATION_EXPORT const CGFloat EXPChatBubbleTailSpan;

/**
 * A chat balloon's whole outline, body and tail, as one path. `bounds` is the
 * whole box, tail included: when `tailed`, the body is `EXPChatBubbleTailDrop`
 * shorter and the tail hangs in the strip below it. Nothing is drawn outside
 * `bounds`, since the path is used as a mask. Declared so the geometry can be
 * asserted rather than only looked at.
 */
/**
 * The balloon's outline with a tail of the given size: 0 for none, 1 for a
 * whole one, and anything between for a tail on its way in or out; at 0 the
 * arithmetic degenerates into the tailless balloon. The caller reads the amount
 * out of the `padding-bottom` the element currently reserves; the reserve is
 * what transitions.
 */
FOUNDATION_EXPORT UIBezierPath *EXPChatBubblePath(CGRect bounds, CGFloat radius, CGFloat tailAmount, BOOL tailOnRight);

NS_ASSUME_NONNULL_END
