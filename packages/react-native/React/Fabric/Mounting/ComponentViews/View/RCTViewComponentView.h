/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>

#import <React/RCTComponentViewProtocol.h>
#import <React/RCTConstants.h>
#import <React/RCTTouchableComponentViewProtocol.h>
#import <React/UIView+ComponentViewProtocol.h>
#import <react/renderer/components/view/ViewEventEmitter.h>
#import <react/renderer/components/view/ViewProps.h>
#import <react/renderer/core/EventEmitter.h>
#import <react/renderer/core/LayoutMetrics.h>
#import <react/renderer/core/Props.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * Told when a finger is on this view, for chrome that draws a pressed state.
 *
 * The touches, not a gesture recognizer, and that is the whole point. A scroll
 * view's `delaysContentTouches` holds a touch back for a moment to see whether
 * a scroll was meant, and it does so by delaying delivery *to the view*.
 * Recognizers are outside that — UIKit hands them the touch immediately,
 * whatever the scroll view decides later — so recognizer-driven feedback lights
 * up under a finger that was only passing through. `UIControl` tracks touches
 * at the view level for exactly this reason, and so does
 * `EXPElementButtonComponentView`.
 *
 * Chrome that needs this cannot get it any other way: the view a run of
 * `<input type="radio">` rows hangs from is whatever ancestor survived
 * flattening and is nobody's subclass, so there is no `touchesBegan:` of its
 * own to override.
 *
 * Reports press state only. It does not activate anything.
 */
@protocol RCTViewPressObserver <NSObject>
- (void)pressedView:(UIView *_Nonnull)view didBecomePressed:(BOOL)pressed;
@end

/**
 * UIView class for <View> component.
 */
@interface RCTViewComponentView : UIView <RCTComponentViewProtocol, RCTTouchableComponentViewProtocol> {
 @protected
  facebook::react::LayoutMetrics _layoutMetrics;
  facebook::react::SharedViewProps _props;
  facebook::react::SharedViewEventEmitter _eventEmitter;
}

/**
 * The material hooks the base class calls and the element box answers.
 *
 * Declared here because `-currentContainerView` is the base's and the material
 * is the subclass's: the base has to ask a question only the box can answer.
 * Both return nil for every view without a material, which is nearly all of
 * them.
 */
- (nullable UIView *)exp_glassChildContainerView;
- (nullable UIView *)exp_materialHostView;

/**
 * Given by a CHILD the shape this view should be LIFTED in.
 *
 * A peek's preview is a rounded rectangle unless it is handed a path, so a
 * balloon lifted without one grows a tail-less square out of a shape that has a
 * tail. The interaction belongs to the box — that is what receives the touch and
 * what has to come up with the words inside it — but the box is a rectangle and
 * knows nothing about balloons. So the shape travels the other way: the surface
 * that draws it hands its outline up, in the box's coordinates, and the box
 * gives it to UIKit.
 *
 * The block is called when UIKit asks, at the moment of the lift, rather than
 * stored as a path: a send animation resizes the balloon every frame and a
 * reveal drag slides the whole column.
 *
 * A no-op here; the element box is the only view with a peek to shape.
 */
- (void)exp_setPeekShapeProvider:(UIBezierPath *_Nullable (^_Nullable)(void))provider;

/**
 * Represents the `UIView` instance that is being automatically attached to
 * the component view and laid out using on `layoutMetrics` (especially `size`
 * and `padding`) of the component.
 * This view must not be a component view; it's just a convenient way
 * to embed/bridge pure native views as component views.
 * Defaults to `nil`. Assign `nil` to remove view as subview.
 */
@property (nonatomic, strong, nullable) UIView *contentView;

/**
 * Provides access to `nativeId` prop of the component.
 * It might be used by subclasses (which need to refer to the view from
 * other platform-specific external views or systems by some id) or
 * by debugging/inspection tools.
 * Defaults to `nil`.
 */
@property (nonatomic, strong, nullable) NSString *nativeId;

/**
 * Re-place any `background-attachment: fixed` background in this subtree.
 *
 * A fixed background is measured against the viewport rather than the element,
 * so scrolling changes what it should look like without changing anything the
 * mounting layer reports. The scroll container calls this as it scrolls, which
 * is the same arrangement browsers make for the same feature.
 *
 * Cheap on a tree that has none: one boolean test per view.
 */
- (void)exp_repositionFixedBackgrounds;

/**
 * Whether anything in the process has `background-attachment: fixed` at all.
 *
 * The walk above passes through every view under a scroll and runs on every
 * scroll frame, so an app that never writes the property must not pay for it.
 * Ask this first.
 */
FOUNDATION_EXPORT BOOL EXPAnyFixedBackgrounds(void);

/**
 * Returns the object - usually (sub)view - which represents this
 * component view in terms of accessibility.
 * All accessibility properties will be applied to this object.
 * May be overridden in subclass which needs to be accessiblitywise
 * transparent in favour of some subview.
 * Defaults to `self`.
 */
@property (nonatomic, strong, nullable, readonly) NSObject *accessibilityElement;

/**
 * Insets used when hit testing inside this view.
 */
@property (nonatomic, assign) UIEdgeInsets hitTestEdgeInsets;

/**
 * A subclass hook for subviews the HOST inserts rather than the mutation
 * stream — platform chrome like the real `UIButton` behind `<button>`. Such
 * subviews must be excluded from mount-index bookkeeping, exactly as painted
 * text runs are: counting them as mounted children shifts every mutation index
 * after them. A subclass that installs chrome returns YES from
 * `hasHostChromeSubviews` and identifies its views in `isHostChromeSubview:`.
 * Defaults: NO / NO.
 */
@property (nonatomic, readonly) BOOL hasHostChromeSubviews;
- (BOOL)isHostChromeSubview:(UIView *_Nonnull)view;

/**
 * Where this view's own chrome goes: backgrounds, borders, materials — every
 * view a component owns rather than one React mounted.
 *
 * It is `-currentContainerView` without the glass container below, and the two
 * are the same view for every box that has no glass container. They have to be
 * told apart because a glass container's children live INSIDE the material,
 * and the material cannot be put inside itself. A subclass that installs a
 * material of its own puts it here.
 */
@property (nonatomic, readonly) UIView *_Nonnull chromeContainerView;

/**
 * Installs host chrome BEHIND this view's mounted children, and remembers it as
 * chrome so the mount-index bookkeeping skips it.
 *
 * The subclass hooks above answer for chrome a component view installs in
 * ITSELF, which is the common case. This is for chrome installed from outside,
 * into a view whose class knows nothing about it — a run of `<input
 * type="radio">` rows drawing the platform's grouped list behind them, where
 * the view holding the rows is whatever ancestor survived flattening and is
 * nobody's subclass.
 *
 * Behind, always: chrome is a backdrop, and a mounted child that ends up under
 * it disappears. Use this rather than `addSubview:` — an unregistered extra
 * subview shifts every mount index after it, which lands children at the wrong
 * z-position and aborts on valid removals.
 *
 * NEVER re-parent a mounted child to put it inside chrome. Mounting addresses
 * children by index into this view's subviews, so a child that has moved
 * elsewhere is not merely misplaced, it is unaddressable: the index maps to the
 * wrong view or past the end, and unmounting aborts.
 */
- (void)addHostChromeSubview:(UIView *_Nonnull)view;

/**
 * The same, but behind ONE child rather than behind all of them.
 *
 * "At the back" is right for chrome that backs the whole view, and wrong for
 * chrome that backs a RUN of children, because a flattened ancestor is not
 * absent from the tree: Fabric hoists its children into this view and leaves the
 * ancestor itself here as a CHILDLESS SIBLING carrying its background, ordered
 * before the children it used to hold. Chrome at index 0 therefore sits behind
 * that backdrop, and any ancestor with a background hides it — which is what a
 * radio group inside a plain coloured `<View>` did: rows, no card.
 *
 * Behind its own first child, chrome lands between that backdrop and the run,
 * which is where a backdrop for those children belongs whatever else the
 * container holds. `sibling` must be a subview of this view; chrome goes to the
 * back if it is not.
 */
- (void)addHostChromeSubview:(UIView *_Nonnull)view behindSubview:(UIView *_Nonnull)sibling;
- (void)removeHostChromeSubview:(UIView *_Nonnull)view;


/**
 * Nil for every view unless chrome asks for it, and weak so that chrome going
 * away cannot leave a view reporting to nothing.
 */
@property (nonatomic, weak, nullable) id<RCTViewPressObserver> pressObserver;

/**
 * Enforcing `call super` semantic for overridden methods from `RCTComponentViewProtocol`.
 * The methods update the instance variables.
 */
- (void)updateProps:(const facebook::react::Props::Shared &)props
           oldProps:(const facebook::react::Props::Shared &)oldProps NS_REQUIRES_SUPER;
- (void)updateEventEmitter:(const facebook::react::EventEmitter::Shared &)eventEmitter NS_REQUIRES_SUPER;
- (void)updateLayoutMetrics:(const facebook::react::LayoutMetrics &)layoutMetrics
           oldLayoutMetrics:(const facebook::react::LayoutMetrics &)oldLayoutMetrics NS_REQUIRES_SUPER;
- (void)finalizeUpdates:(RNComponentViewUpdateMask)updateMask NS_REQUIRES_SUPER;
- (void)prepareForRecycle NS_REQUIRES_SUPER;
- (UIView *)betterHitTest:(CGPoint)point withEvent:(UIEvent *)event;

/**
 * Rebuild everything about the layer that props decide: its background, its
 * borders, its corners, its shadow — and its MASK, which this sets to `nil` and
 * then puts back from the border metrics.
 *
 * Declared for subclasses because that last part makes it a hook whether it
 * meant to be one or not. A component view whose layer wears a mask of its own —
 * a chat balloon's outline, say — has to re-apply it here, or the mask survives
 * until the first time UIKit asks the layer to rebuild and then silently goes.
 * Coming back from the background is one of those times, which is a long way
 * from any code that looks related.
 */
- (void)invalidateLayer NS_REQUIRES_SUPER;

/*
 * This is the label that would be coopted by another element
 */
- (NSString *)accessibilityLabelForCoopting;

/*
 * This View has no label and will look to coopt something below it
 */
- (BOOL)wantsToCooptLabel;

/*
 * This is a fragment of temporary workaround that we need only temporary and will get rid of soon.
 */
- (NSString *)componentViewName_DO_NOT_USE_THIS_IS_BROKEN;

@end

NS_ASSUME_NONNULL_END
