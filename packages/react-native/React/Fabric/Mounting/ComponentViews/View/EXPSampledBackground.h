/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * The colour a region of the screen is actually painted — measured, not deduced.
 *
 * Asking WHO painted a surface does not work in a React Native tree. Walking the
 * ancestors for a non-clear `backgroundColor` finds nothing: instrumented in
 * dark mode, every view from a link up to the root reports no colour at all,
 * and the only one that has any is `RCTSurfaceHostingProxyRootView` — black —
 * while the page renders (28,28,30). Backgrounds arrive from too many places to
 * enumerate: a view property, a layer, a gradient, an image, something not in
 * the ancestor chain at all.
 *
 * So this looks at the pixels. It renders the WINDOW over the given rects and
 * takes the MOST COMMON colour, which is the background: glyphs and controls
 * are a minority of any region, and the mode ignores them rather than averaging
 * them in and coming back with a muddy grey.
 *
 * The window, specifically, and not some view nearer the region. The nearer ones
 * paint nothing — that is the whole problem — and rendering a transparent view
 * into an opaque context returns the context's own fill, which is to say black,
 * which is the exact wrong answer dressed up as a measurement.
 *
 * Returns nil when there is no flat colour there — a photograph, a gradient —
 * so a caller can leave whatever it was going to change alone.
 *
 * @param view  the view whose coordinate space `rects` are in.
 * @param rects the regions to measure, in `view`'s space.
 */
UIColor *_Nullable EXPSampledBackgroundColor(UIView *view, NSArray<NSValue *> *rects);

NS_ASSUME_NONNULL_END
