/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <React/EXPElementControlComponentView.h>
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/*
 * `<input type="range">`, backed by a real `UISlider`.
 *
 * A `UISlider` rather than a drawn approximation, so it inherits the platform's
 * own metrics, tint handling, dark mode, accessibility (VoiceOver's adjustable
 * increment/decrement), and — the part that is hardest to imitate — its exact
 * touch behaviour, including the thumb's grab area and tracking.
 *
 * It declares that it owns any gesture starting on it, so an enclosing scroll
 * view cannot cancel a scrub. That is UIKit's rule for controls, which React
 * Native's scroll view otherwise overrides; see `EXPElementDragOwnership`.
 */
@interface EXPElementRangeComponentView : EXPElementControlComponentView
@end

NS_ASSUME_NONNULL_END
