/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>
#import <react/renderer/components/view/ElementControlMetrics.h>

NS_ASSUME_NONNULL_BEGIN

/*
 * Ask the platform's own controls how big they are, once, before anything is
 * laid out.
 *
 * The form elements are drawn by real controls, so their intrinsic sizes are
 * the platform's to state. Layout runs on the shadow thread, where UIKit
 * cannot be touched, so the asking happens here and the answers are published
 * for layout to read — exactly the shape of `RCTSwitchSize()`, and for the
 * same reason.
 *
 * Called from `RCTInstance`'s main-queue module setup, which the JavaScript
 * thread WAITS on before it evaluates the bundle. That is what makes this
 * race-free rather than merely early: no surface exists yet, so no layout can
 * already be asking.
 */
void EXPPrewarmElementControlMetrics(void);

/*
 * Each element fills its own part, from its own file.
 *
 * Deliberately not gathered into one place: a probe that built its own
 * `UITextView` or its own `UIButton` would measure a control that resembles
 * the one the element mounts, and resemblance is exactly the failure this is
 * meant to end. Each lives beside the code that configures the real one.
 *
 * Main thread only.
 */
void EXPProbeTextAreaMetrics(facebook::react::ElementControlMetrics &metrics);
void EXPProbeSelectMetrics(facebook::react::ElementControlMetrics &metrics);
void EXPProbeFileInputMetrics(facebook::react::ElementControlMetrics &metrics);
void EXPProbeButtonMetrics(facebook::react::ElementControlMetrics &metrics);
void EXPProbeTextFieldMetrics(facebook::react::ElementControlMetrics &metrics);
void EXPProbeDatePickerMetrics(facebook::react::ElementControlMetrics &metrics);
void EXPProbeColorWellMetrics(facebook::react::ElementControlMetrics &metrics);

/*
 * Where a label's text baseline sits in `view`'s coordinates: the label draws
 * one line centred in its bounds, so the baseline is that line's ascender down
 * from the top of the line.
 */
CGFloat EXPTextBaselineInView(UILabel *label, UIView *view);

/** The first `UILabel` in `view`'s subtree, depth first, or nil. */
UILabel *_Nullable EXPFirstLabelIn(UIView *view);

NS_ASSUME_NONNULL_END
