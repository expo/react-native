/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>

#import <react/renderer/components/view/ViewEventEmitter.h>
#import <react/renderer/components/view/ViewState.h>
#import <react/renderer/textlayoutmanager/TextLayoutManager.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * One lightweight paint view per anonymous text run of a View's inline
 * formatting context.
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
 * fragment's event emitter, or `nullptr` when the point misses this run or
 * lands on a fragment without one, as bare text is, so the tap falls through
 * to the View itself.
 *
 * Shares `containerFrame` with painting: one geometry for both, so a tap
 * always lands where the glyphs were drawn.
 */
- (facebook::react::SharedTouchEventEmitter)touchEventEmitterAtContainerPoint:(CGPoint)point;

/**
 * Takes a new run from the owning View's state, announcing any live-region
 * leaf whose text changed since the previous run.
 */
- (void)updateRun:(const facebook::react::ViewState::TextRun &)run;

/**
 * This run's accessibility leaves, one per element of its `InlineAccessibilityContent` and in
 * that order, made for `container`: the view that presents them, interleaved with its mounted
 * children.
 *
 * An `Attachment` element is `NSNull` here, because its mounted view is the leaf and only the
 * container can resolve that view; every other element is a `UIAccessibilityElement` whose
 * `accessibilityContainer` is `container` and whose frame is placed on the text engine's fragment
 * rects, the same layout that paints the run.
 */
- (NSArray *)accessibilityLeavesInContainer:(id)container;

/**
 * Discards the cached accessibility elements. Called when the run changes,
 * because those elements are positioned on fragment rects that only the current
 * text and layout can produce.
 */
- (void)invalidateAccessibilityElements;

@end

NS_ASSUME_NONNULL_END
