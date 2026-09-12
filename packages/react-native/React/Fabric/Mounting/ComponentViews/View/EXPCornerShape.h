/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>
#import <react/renderer/components/view/primitives.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * The outline of a view with a `corner-shape` Core Animation cannot draw itself.
 *
 * Round corners are the layer's own and cost nothing; this is for everything
 * else — a squircle, a bevel, a scoop — traced as a superellipse per corner and
 * handed to a mask. Shared by the plain view and the element box, which paint
 * the same outline for the same metrics.
 */
UIBezierPath *EXPCornerShapePath(CGRect bounds, const facebook::react::BorderMetrics &metrics);

NS_ASSUME_NONNULL_END
