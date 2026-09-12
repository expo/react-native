/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * A system material drawn BEHIND a view's content, optionally fading in from
 * its top edge.
 *
 * This is `-apple-visual-effect`'s implementation, and it lives on its own
 * because two very different things need it: an element box, where an author
 * writes the property on a `<div>`, and the keyboard accessory, where the bar's
 * whole surface is a material and no child box can be the right size for it —
 * a child is only ever as tall as the content React laid out, and a docked bar
 * extends past that, through the home indicator, to the bottom of the screen.
 *
 * Two things here are not obvious and were each found the hard way.
 *
 * **The effect view is never touched except to size it.** A
 * `UIVisualEffectView` does not survive having a mask put on its own layer —
 * the effect stops rendering rather than thinning out. So the material sits
 * inside a plain host view, and it is the host that is rounded, clipped and
 * masked.
 *
 * **A box that draws only a material still has to form a view.** Fabric
 * flattens away anything that does not visibly paint, and its list of what
 * counts is a fixed set of `ViewProps`. Whoever adds a material to a new
 * component has to make sure the shadow node says it forms a view, or this
 * class is handed a view that does not exist.
 */
@interface EXPMaterialSurface : NSObject

/**
 * Install, update or remove the material behind `container`'s content.
 *
 * `keyword` is `CSSValueKeywords.in`'s spelling — nil or empty removes it.
 * `fade` is how far the material fades in from its own top edge, in points; 0
 * is a hard edge, which is what a card or a field wants.
 *
 * Cheap to call on every commit: it does nothing when neither argument has
 * changed, and building a `UIVisualEffect` is not free.
 */
- (void)applyKeyword:(nullable NSString *)keyword fade:(CGFloat)fade inContainer:(UIView *)container;

/**
 * How strongly the material is applied, 0 to 1, and 1 is the platform's own.
 *
 * The effect view's opacity, which blends the rendered material toward the
 * UNBLURRED content behind it — so this attenuates the blur and the tint
 * together. Lower is a surface that both sits closer to the page and smears
 * less; it is a trade, not a transparency dial.
 *
 * Separate from `-applyKeyword:fade:inContainer:` rather than another argument
 * to it: three component views call that method and none of the others has any
 * use for this, and widening a shared signature for one caller is how a
 * parameter ends up passed as a constant in every call site but one.
 */
- (void)setStrength:(CGFloat)strength;

/**
 * Where a GLASS surface's element children belong, and nil for every other
 * material.
 *
 * Glass wraps; everything else backs. A blur or a thin material is a backdrop —
 * it goes behind the element's content so the author's own background and
 * border paint over it — and glass cannot be one, because the two things that
 * make glass glass are things UIKit does only for what is INSIDE the effect
 * view:
 *
 *  - `UIGlassEffect.interactive` reacts to a touch delivered inside it, and a
 *    backdrop is a sibling BELOW the element's content, so every touch lands on
 *    something else.
 *  - `UIGlassContainerEffect` renders the glass nested in its `contentView` as
 *    ONE shape: two pills that come within `spacing` of each other merge, the
 *    way the `+` and the composer's field do natively when the `+` is held.
 *
 * Nothing is re-parented individually and no element changes shape: the
 * children stay exactly where they are in the tree, each keeping its own view,
 * its own glass and its own touches. Measured before this was built — a glass
 * button and an effect view each wrapped one level down in a plain view still
 * merge, so the nesting the element tree already has is not in the way.
 *
 * `-[RCTViewComponentView currentContainerView]` returns this when it exists,
 * which is the same hook the mounting layer already uses to put a view between
 * a component and its children.
 */
- (nullable UIView *)childContainerView;

/** The view this surface owns in its container, so a caller can tell it apart from React's children. */
- (nullable UIView *)hostView;

/**
 * A colour drawn as the surface itself, under the same fade.
 *
 * Not the element's own `background-color`, which a view's layer draws below
 * every subview and therefore below this one. It is here because the fade is
 * here: a mask on this host covers whatever it contains, and a bar that wants a
 * soft top edge on a plain colour has nowhere else to put one.
 *
 * A fill with no keyword is a surface with no blur, which is a real
 * arrangement — measured on the native composer, its surface behaves as a
 * near-white at 87% and no `UIBlurEffectStyle` is that light.
 */
- (void)setFill:(nullable UIColor *)fill;

/**
 * Whether there is a MATERIAL here, as opposed to a fill or nothing.
 *
 * Asked by the box that owns this, to decide who paints `background-color`. CSS
 * paints a background OVER a backdrop, and a view's layer paints its own
 * background UNDER every subview — so a box with a material has to hand its
 * colour to this class instead of drawing it, or the two come out in the wrong
 * order. See `-[RCTViewComponentView invalidateLayer]`.
 */
@property (nonatomic, readonly) BOOL hasEffect;

/**
 * Re-size to the container and take its corners. Call from `layoutSubviews`.
 */
- (void)layOutInContainer:(UIView *)container cornerRadius:(CGFloat)radius cornerCurve:(CALayerCornerCurve)curve;

/**
 * One line describing everything that decides whether this surface draws
 * correctly, for the device trace.
 *
 * Written for the flat-sheet report — the docked bar's blur and fade gone
 * until the next reveal — which only reproduces on a device. The candidate
 * causes each have a field here: the fade MASK dropped (`mask=`, and its
 * geometry against the host's), the FILL painted on the wrong layer
 * (`fill=`/`hostBg=`/`contentBg=`), the EFFECT dead (`effect=`), the host
 * detached or reordered (`hostWindow=`/`hostIndex=`), or the appearance
 * resolving the colour opaque (`style=` and the resolved RGBA). Recorded on
 * change, so the trace shows the before and the after of whatever transition
 * breaks it.
 */
- (NSString *)stateDescription;

/**
 * The same, with the surface extended BELOW the container.
 *
 * For a bar that sits on the keyboard, which needs both ends.
 *
 * BELOW: the keyboard's own top corners are rounded, so a material that stops
 * exactly at the bar's bottom edge leaves two small notches at the corners
 * where neither surface covers the page.
 *
 * ABOVE: the fade should begin before the bar does, so the surface has already
 * started appearing where the bar's own frame — and therefore its touch
 * region — begins. A gradient that starts exactly at the top of the touchable
 * area makes the two look like the same edge, and they are not.
 *
 * The fade is measured from the top of the whole surface, overhang included.
 * The container must not clip, or the overhang is the one part that is.
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
