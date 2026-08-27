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

/**
 * The link at `point`, in the owning View's coordinate space, or nil.
 *
 * The value is UIKit's own `NSLinkAttributeName` payload — an `NSURL`, or an
 * `NSString` for a destination that would not parse. `outRects`, when given, is
 * filled with the link's enclosing rects in that same space, so the platform's
 * context menu can lift exactly the glyphs the link occupies rather than a
 * rectangle around them.
 *
 * Shares `containerFrame` with painting and with touch resolution, for the same
 * reason they share it: a link must lift where it was drawn.
 */
- (nullable id)linkAtContainerPoint:(CGPoint)point rects:(nullable NSMutableArray<NSValue *> *)outRects;

/**
 * The view that draws the link at this point, or nil.
 *
 * Every link in a run is painted by a view of its own, so a lift can be handed
 * a real view rather than a snapshot of some glyphs. `point` is in the owning
 * View's coordinate space, as everywhere else in this class.
 */
- (nullable UIView *)linkViewAtContainerPoint:(CGPoint)point;

/**
 * Whether `view` is one of the views this class uses to paint a link's glyphs.
 *
 * The lift asks, because glyphs and everything else want opposite treatment
 * from `UIPreviewParameters` — see `-[EXPTextLinkInteraction _parametersForLift:]`.
 */
+ (BOOL)isLinkGlyphView:(UIView *)view;

/** Whether any fragment in this run carries an `href`. */
- (BOOL)containsLink;



/**
 * Discards the cached accessibility elements. Called when the run changes,
 * because those elements are positioned on fragment rects that only the current
 * text and layout can produce.
 */
- (void)invalidateAccessibilityElements;

@end

NS_ASSUME_NONNULL_END
