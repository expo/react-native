/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>

#import <react/renderer/components/view/ViewState.h>
#import <react/renderer/components/view/ViewEventEmitter.h>
#import <react/renderer/textlayoutmanager/TextLayoutManager.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * One lightweight paint view per anonymous text run of a View's inline
 * formatting context (text-children-plan.md §3.B).
 *
 * One view per run, rather than a single content view drawing all of them, is
 * what lets the mounting layer interleave runs with mounted child views in
 * authored order — CSS painting order — by z-ordering in `layoutSubviews`.
 *
 * These views are component-view-internal: never differ-driven, never part of
 * the React child indices. They live here rather than inside
 * `RCTViewComponentView` because they are a self-contained concept, and
 * because that class is the one every React Native change touches — text-run
 * painting has no business making its diff bigger.
 */
@interface RCTAnonymousTextRunView : UIView {
 @public
  facebook::react::ViewState::TextRun _run;
  std::weak_ptr<const facebook::react::TextLayoutManager> _layoutManager;
}

/**
 * Sizes this run's canvas to the owning View's content box, plus whatever its
 * inline elements' decorations paint outside the line box.
 */
- (void)setContainerBounds:(CGRect)containerBounds;

/**
 * Resolves a touch, in the owning View's coordinate space, to an inline
 * fragment's event emitter — `<b onPress>` and the like — or `nullptr` when
 * the point misses this run or lands on emitter-less bare text, so the tap
 * falls through to the View itself.
 *
 * Shares `containerFrame` with painting: one geometry for both, so a tap
 * always lands where the glyphs were drawn.
 */
- (facebook::react::SharedTouchEventEmitter)touchEventEmitterAtContainerPoint:(CGPoint)point;

@end

NS_ASSUME_NONNULL_END
