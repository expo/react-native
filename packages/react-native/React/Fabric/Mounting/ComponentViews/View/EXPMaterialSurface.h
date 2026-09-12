/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * A system material drawn behind a view's content, optionally fading in from
 * its top edge: the implementation of `-apple-visual-effect`, shared by the
 * element box and the keyboard accessory, whose surface is taller than any
 * child React lays out.
 *
 * The effect view is only ever sized. A `UIVisualEffectView` stops rendering
 * when its own layer is masked, so the material sits inside a plain host view
 * that is rounded, clipped and masked instead.
 *
 * A box that draws only a material still has to form a view: Fabric flattens
 * anything that does not paint, judged by a fixed set of `ViewProps`, so a
 * shadow node that carries a material must say it forms a view.
 */
@interface EXPMaterialSurface : NSObject

/**
 * Installs, updates or removes the material behind `container`'s content.
 * `keyword` is WebKit's `CSSValueKeywords.in` spelling; nil or empty removes
 * it. `fade` is how far the material fades in from its top edge, in points.
 * Does nothing when neither argument changed, so it is safe on every commit.
 */
- (void)applyKeyword:(nullable NSString *)keyword fade:(CGFloat)fade inContainer:(UIView *)container;

/**
 * How strongly the material is applied, 0 to 1. This is the effect view's
 * opacity, which blends the rendered material toward the unblurred content
 * behind it, so it attenuates the blur and the tint together.
 */
- (void)setStrength:(CGFloat)strength;

/**
 * Where a glass surface's element children belong; nil for every other
 * material. A blur is a backdrop behind the element's content, but glass has
 * to wrap it: `UIGlassEffect.interactive` reacts only to touches delivered
 * inside the effect view, and `UIGlassContainerEffect` merges only the glass
 * nested in its `contentView`. `-[RCTViewComponentView currentContainerView]`
 * returns this when it exists.
 */
- (nullable UIView *)childContainerView;

/** The view this surface owns in its container, so a caller can tell it apart from React's children. */
- (nullable UIView *)hostView;

/**
 * The effect view itself, else nil. A zoom transition given this morphs the
 * glass; given the host around it, it snapshots a plain view.
 */
- (nullable UIVisualEffectView *)effectView;

/**
 * A colour drawn as the surface itself, under the same fade. It lives here
 * rather than as the element's `background-color` because the fade mask is on
 * this host. A fill with no keyword is a surface with no blur, which no
 * `UIBlurEffectStyle` can produce.
 */
- (void)setFill:(nullable UIColor *)fill;

/**
 * Whether there is a material here, as opposed to a fill or nothing. CSS paints
 * a background over a backdrop while a view's layer paints its own background
 * under every subview, so a box with a material hands its colour to this class
 * instead of drawing it. See `-[RCTViewComponentView invalidateLayer]`.
 */
@property (nonatomic, readonly) BOOL hasEffect;

/** Resizes to the container and takes its corners; call from `layoutSubviews` */
- (void)layOutInContainer:(UIView *)container cornerRadius:(CGFloat)radius cornerCurve:(CALayerCornerCurve)curve;

/**
 * One line with everything that decides whether this surface draws: the fade
 * mask and its geometry, the fill and the layers it lands on, the effect, the
 * host's window and index, and the resolved appearance. For the device trace.
 */
- (NSString *)stateDescription;

/**
 * The same, with the surface extended past the container at either end. Below:
 * the keyboard's top corners are rounded, and a material that stops at the
 * bar's bottom edge leaves notches where neither surface covers the page.
 * Above: the fade begins before the bar's frame does, so its touch region does
 * not read as the surface's edge. The fade is measured from the top of the
 * whole surface, overhang included; the container must not clip.
 */
- (void)layOutInContainer:(UIView *)container
             cornerRadius:(CGFloat)radius
              cornerCurve:(CALayerCornerCurve)curve
              topOverhang:(CGFloat)topOverhang
           bottomOverhang:(CGFloat)bottomOverhang;

/** Whether anything is currently installed. */
@property (nonatomic, readonly) BOOL isInstalled;

@end

NS_ASSUME_NONNULL_END
