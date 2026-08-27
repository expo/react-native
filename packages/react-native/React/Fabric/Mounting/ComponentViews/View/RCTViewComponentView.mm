/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "RCTViewComponentView.h"

#if TARGET_OS_IOS
#endif
#import <React/RCTSurfaceHostingProxyRootView.h>

#import <CoreGraphics/CoreGraphics.h>
#import <MobileCoreServices/UTCoreTypes.h>
#import <QuartzCore/QuartzCore.h>
#import <objc/runtime.h>
#import <ranges>
#import <string_view>
#import <unordered_set>

#import <RCTSwiftUIWrapper/RCTSwiftUIContainerViewWrapper.h>
#import <React/RCTAssert.h>
#import <React/RCTBackgroundImageUtils.h>
#import <React/RCTBorderDrawing.h>
#import <React/RCTBoxShadow.h>
#import <React/RCTConversions.h>
#import <React/RCTLinearGradient.h>
#import <React/RCTLocalizedString.h>
#import <React/RCTLog.h>
#import <React/RCTRadialGradient.h>
#import <react/featureflags/ReactNativeFeatureFlags.h>
#import <react/renderer/animationbackend/CSSTransitionsTrace.h>
#import <react/renderer/components/view/ViewComponentDescriptor.h>
#import <react/renderer/components/view/ViewEventEmitter.h>
#import <react/renderer/components/view/ViewProps.h>
#import <react/renderer/components/view/ViewShadowNode.h>
#import <react/renderer/components/view/ViewState.h>
#import <react/renderer/components/view/accessibilityPropsConversions.h>
#import <react/renderer/graphics/BlendMode.h>
#import <react/renderer/textlayoutmanager/RCTAttributedTextUtils.h>
#import <react/renderer/textlayoutmanager/RCTTextLayoutManager.h>
#import <react/renderer/textlayoutmanager/TextLayoutManager.h>
#import <react/utils/ManagedObjectWrapper.h>

// The generic-box component view (EXPElementBoxComponentView) self-registers
// with the factory, so both headers are needed unconditionally.
#import <React/RCTComponentViewFactory.h>
#import <react/renderer/components/view/ElementBoxShadowNode.h>

// Per-run text painting lives in its own file: it is a self-contained concept,
// and this class is the one every React Native change touches.
#import "EXPTextLinkInteraction.h"
#import "RCTAnonymousTextRunView.h"

// Per-run text painting lives in its own file: it is a self-contained concept,
// and this class is the one every React Native change touches.
#import "RCTAnonymousTextRunView.h"

using namespace facebook::react;

const CGFloat BACKGROUND_COLOR_ZPOSITION = -1024.0f;

#if !TARGET_OS_TV
// iOS Full Keyboard Access only focuses a view when it is an accessibility
// element that also exposes an interactive trait. Views that surface their
// interactivity through a grouping accessibility element (rather than the
// underlying control) are otherwise skipped by the focus engine, leaving
// keyboard-only users unable to reach them.
//
// The trait mask alone is not sufficient, because it is a lossy projection of
// the role: `checkbox`, `radio`, `combobox`, `menuitem`, `spinbutton`, `tab`
// and friends deliberately carry no interactive trait, since VoiceOver conveys
// them through `accessibilityValue` instead. The role is therefore consulted
// as well, otherwise those controls stay unreachable by keyboard.
static BOOL RCTViewIsInteractiveAccessibilityElement(UIView *view, const ViewProps &props)
{
  if (!view.isAccessibilityElement) {
    return NO;
  }

  UIAccessibilityTraits interactiveTraits = UIAccessibilityTraitButton | UIAccessibilityTraitLink |
      UIAccessibilityTraitSearchField | UIAccessibilityTraitKeyboardKey | UIAccessibilityTraitAdjustable;
  if ((view.accessibilityTraits & interactiveTraits) != 0) {
    return YES;
  }

  // `role` wins over the legacy `accessibilityRole` when both are set, matching
  // how the traits themselves are resolved.
  if (props.role != Role::None) {
    static const std::unordered_set<Role> interactiveRoles{
        Role::Button,
        Role::Checkbox,
        Role::Combobox,
        Role::Link,
        Role::Menuitem,
        Role::Option,
        Role::Radio,
        Role::Searchbox,
        Role::Slider,
        Role::Spinbutton,
        Role::Switch,
        Role::Tab,
        Role::Treeitem};
    return interactiveRoles.contains(props.role);
  }

  static const std::unordered_set<std::string_view> interactiveAccessibilityRoles{
      "adjustable",
      "button",
      "checkbox",
      "combobox",
      "dropdownlist",
      "imagebutton",
      "keyboardkey",
      "link",
      "menuitem",
      "radio",
      "search",
      "spinbutton",
      "switch",
      "tab",
      "togglebutton"};
  return interactiveAccessibilityRoles.contains(props.accessibilityRole);
}
#endif

#if !TARGET_OS_TV
@interface RCTViewComponentView () <UIEditMenuInteractionDelegate>
@property (nonatomic, nullable) UIEditMenuInteraction *textSelectionEditMenuInteraction API_AVAILABLE(ios(16.0));
@end
#endif

@implementation RCTViewComponentView {
  UIColor *_backgroundColor;
  CALayer *_backgroundColorLayer;
  __weak CALayer *_borderLayer;
  CALayer *_outlineLayer;
  NSMutableArray<CALayer *> *_boxShadowLayers;
  CALayer *_filterLayer;
  NSMutableArray<CALayer *> *_backgroundImageLayers;
  BOOL _needsInvalidateLayer;
  BOOL _isJSResponder;
  BOOL _removeClippedSubviews;
  // Set by the recycle pixel clear, consumed by the next -updateProps:'s
  // unconditional pixel restore, asserted spent in -finalizeUpdates. See the
  // RECYCLE PIXEL CONTRACT comment on the clear/restore pair.
  BOOL _propsAreStaleFromRecycle;
  // The props a recycle left in place, so the next -updateProps: can assert it still diffs against
  // them; see the assertion there
  Props::Shared _propsKeptByRecycle;
  NSMutableArray<UIView *> *_reactSubviews;
  NSSet<NSString *> *_Nullable _propKeysManagedByAnimated_DO_NOT_USE_THIS_IS_BROKEN;
  UIView *_containerView;
  BOOL _useCustomContainerView;
  NSMutableSet<NSString *> *_accessibilityOrderNativeIDs;
  RCTSwiftUIContainerViewWrapper *_swiftUIWrapper;
  BOOL _focusable;
  // One paint view per anonymous text run, interleaved with mounted children in
  // document order. Internal, never differ-driven.
  NSMutableArray<RCTAnonymousTextRunView *> *_textRunViews;
  EXPTextLinkInteraction *_textLinkInteraction;
  // Chrome installed from outside by a host, kept out of the mount indices
  NSMutableArray<UIView *> *_hostChromeSubviews;
#if !TARGET_OS_TV
  // Installed only while this View both paints text and asks for it to be
  // selectable. See the `user-select` section below.
  UILongPressGestureRecognizer *_textSelectionLongPress;
#endif
}

#ifdef RCT_DYNAMIC_FRAMEWORKS
+ (void)load
{
  [RCTComponentViewFactory.currentComponentViewFactory registerComponentViewClass:self];
}
#endif

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    _props = ViewShadowNode::defaultSharedProps();
    _reactSubviews = [NSMutableArray new];
#if !TARGET_OS_TV
    self.multipleTouchEnabled = YES;
#endif
    _useCustomContainerView = NO;
    _removeClippedSubviews = NO;
  }
  return self;
}

- (facebook::react::Props::Shared)props
{
  return _props;
}

- (void)setContentView:(UIView *)contentView
{
  if (_contentView) {
    [_contentView removeFromSuperview];
  }

  _contentView = contentView;

  if (_contentView) {
    [self.currentContainerView addSubview:_contentView];
    _contentView.frame = RCTCGRectFromRect(_layoutMetrics.getContentFrame());
  }
}

// Rejects hits against views whose 2D transform collapses an axis (e.g. `scaleX: 0`,
// `scaleY: 0`, or any other non-invertible affine). Such views are visually degenerate, and
// UIKit's `-convertPoint:fromView:` falls back to the original matrix when
// `CGAffineTransformInvert` can't invert, so without this check the degenerate transform is
// applied to the touch point and the view can still register hits along the collapsed axis.
static BOOL RCTLayerTransformCollapsesAxis(CALayer *layer)
{
  CATransform3D t = layer.transform;
  // Determinant of the 2x2 projection onto the XY plane. Anything non-zero is invertible; we
  // treat values within float epsilon as zero to avoid numerical issues near machine precision.
  CGFloat det = t.m11 * t.m22 - t.m12 * t.m21;
  return fabs(det) < (CGFloat)1e-6;
}

- (BOOL)pointInside:(CGPoint)point withEvent:(UIEvent *)event
{
  if (RCTLayerTransformCollapsesAxis(self.layer)) {
    return NO;
  }
  if (UIEdgeInsetsEqualToEdgeInsets(self.hitTestEdgeInsets, UIEdgeInsetsZero)) {
    return [super pointInside:point withEvent:event];
  }
  CGRect hitFrame = UIEdgeInsetsInsetRect(self.bounds, self.hitTestEdgeInsets);
  return CGRectContainsPoint(hitFrame, point);
}

- (UIColor *)backgroundColor
{
  return _backgroundColor;
}

- (void)setBackgroundColor:(UIColor *)backgroundColor
{
  _backgroundColor = backgroundColor;
}

- (void)traitCollectionDidChange:(UITraitCollection *)previousTraitCollection
{
  [super traitCollectionDidChange:previousTraitCollection];

  if ([self.traitCollection hasDifferentColorAppearanceComparedToTraitCollection:previousTraitCollection]) {
    [self invalidateLayer];
  }
}

#pragma mark - RCTComponentViewProtocol

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  RCTAssert(
      self == [RCTViewComponentView class],
      @"`+[RCTComponentViewProtocol componentDescriptorProvider]` must be implemented for all subclasses (and `%@` particularly).",
      NSStringFromClass([self class]));
  return concreteComponentDescriptorProvider<ViewComponentDescriptor>();
}

// Anonymous text run views are the container's own paint layers (plain
// UIViews, tag 0), interleaved BETWEEN mounted children to honor CSS painting
// order. Mounting instructions know nothing about them: a mutation's index
// counts only Fabric children. With run views present, that logical index and
// the UIKit subview index diverge — using one as the other mounts children at
// the wrong z-position and trips the unmount assertions on perfectly valid
// removals. This maps a mutation's index to the UIKit position of that slot,
// counting only non-run subviews.
- (BOOL)hasHostChromeSubviews
{
  return _hostChromeSubviews.count > 0;
}

- (BOOL)isHostChromeSubview:(UIView *)view
{
  return [_hostChromeSubviews containsObject:view];
}

- (void)rememberHostChromeSubview:(UIView *)view
{
  if (_hostChromeSubviews == nil) {
    _hostChromeSubviews = [NSMutableArray new];
  }
  if (![_hostChromeSubviews containsObject:view]) {
    [_hostChromeSubviews addObject:view];
  }
}

- (void)addHostChromeSubview:(UIView *)view
{
  [self rememberHostChromeSubview:view];
  // At the back, so no mounted child is ever covered by a backdrop.
  [self.currentContainerView insertSubview:view atIndex:0];
}

- (void)addHostChromeSubview:(UIView *)view behindSubview:(UIView *)sibling
{
  [self rememberHostChromeSubview:view];
  UIView *container = self.currentContainerView;
  if (sibling.superview != container) {
    [container insertSubview:view atIndex:0];
    return;
  }
  // `belowSubview:` rather than an index: UIKit removes a view that is already a
  // subview before re-inserting it, so a precomputed index is off by one when
  // the chrome is moved rather than added
  [container insertSubview:view belowSubview:sibling];
}

- (void)removeHostChromeSubview:(UIView *)view
{
  [_hostChromeSubviews removeObject:view];
  if (view.superview == self.currentContainerView) {
    [view removeFromSuperview];
  }
}

- (NSInteger)_containerIndexForMountIndex:(NSInteger)index
{
  if (_textRunViews.count == 0 && !self.hasHostChromeSubviews) {
    return index;
  }
  NSArray<UIView *> *subviews = self.currentContainerView.subviews;
  NSInteger mountedSeen = 0;
  for (NSUInteger position = 0; position < subviews.count; position++) {
    // Skips the subviews the HOST put there rather than the mutation stream:
    // painted text runs, and a subclass's platform chrome (`<button>`'s
    // UIButton layer). Counting either as a mounted child shifts every
    // mutation index after it, which lands children at the wrong z-position
    // and trips the unmount assertions on valid removals.
    if ([subviews[position] isKindOfClass:[RCTAnonymousTextRunView class]] ||
        [self isHostChromeSubview:subviews[position]]) {
      continue;
    }
    if (mountedSeen == index) {
      return (NSInteger)position;
    }
    mountedSeen++;
  }
  return (NSInteger)subviews.count;
}

- (void)mountChildComponentView:(UIView<RCTComponentViewProtocol> *)childComponentView index:(NSInteger)index
{
  RCTAssert(
      childComponentView.superview == nil,
      @"Attempt to mount already mounted component view. (parent: %@, child: %@, index: %@, existing parent: %@)",
      self,
      childComponentView,
      @(index),
      @([childComponentView.superview tag]));

  if (_removeClippedSubviews) {
    [_reactSubviews insertObject:childComponentView atIndex:index];
  } else {
    [self.currentContainerView insertSubview:childComponentView atIndex:[self _containerIndexForMountIndex:index]];
  }
}

- (void)unmountChildComponentView:(UIView<RCTComponentViewProtocol> *)childComponentView index:(NSInteger)index
{
  if (_removeClippedSubviews) {
    [_reactSubviews removeObjectAtIndex:index];
  } else {
    RCTAssert(
        childComponentView.superview != nil,
        @"Attempt to unmount a view which is not mounted. (parent: %@, child: %@, index: %@)",
        self,
        childComponentView,
        @(index));
    RCTAssert(
        childComponentView.superview == self.currentContainerView,
        @"Attempt to unmount a view which is mounted inside a different view. (parent: %@, child: %@, index: %@, existing parent: %@)",
        self,
        childComponentView,
        @(index),
        @([childComponentView.superview tag]));
#ifndef NS_BLOCK_ASSERTIONS
    NSInteger containerIndex = [self _containerIndexForMountIndex:index];
    NSArray<UIView *> *containerSubviews = self.currentContainerView.subviews;
    BOOL isIndexInBounds = containerIndex >= 0 && (NSUInteger)containerIndex < containerSubviews.count;
    RCTAssert(
        isIndexInBounds && [containerSubviews objectAtIndex:containerIndex] == childComponentView,
        @"Attempt to unmount a view which has a different index. (parent: %@, child: %@, index: %@, actual index: %@, tag at index: %@)",
        self,
        childComponentView,
        @(index),
        @([containerSubviews indexOfObject:childComponentView]),
        isIndexInBounds ? @([[containerSubviews objectAtIndex:containerIndex] tag]) : @"out of bounds");
#endif
  }

  [childComponentView removeFromSuperview];
}

- (void)_updateRemoveClippedSubviewsState
{
  if (_removeClippedSubviews) {
    // Toggled ON: populate _reactSubviews from the current view hierarchy.
    // Actual clipping will happen on the next scroll event.
    RCTAssert(
        _reactSubviews.count == 0,
        @"_reactSubviews should be empty when toggling removeClippedSubviews on. (view: %@, count: %@)",
        self,
        @(_reactSubviews.count));
    if (self.currentContainerView.subviews.count > 0) {
      _reactSubviews = [NSMutableArray new];
      for (UIView *subview in self.currentContainerView.subviews) {
        // The container's own text-run paint layers are not React children.
        if (![subview isKindOfClass:[RCTAnonymousTextRunView class]]) {
          [_reactSubviews addObject:subview];
        }
      }
    }
  } else {
    // Toggled OFF: re-mount all children in the correct order, then clear the tracking array.
    // addSubview: on an already-present child moves it to the front, so iterating in order
    // produces the correct subview ordering.
    for (UIView *view in _reactSubviews) {
      [self.currentContainerView addSubview:view];
    }
    [_reactSubviews removeAllObjects];
  }
}

- (void)updateClippedSubviewsWithClipRect:(CGRect)clipRect relativeToView:(UIView *)clipView
{
  if (!_removeClippedSubviews) {
    // Use default behavior if unmounting is disabled
    return [super updateClippedSubviewsWithClipRect:clipRect relativeToView:clipView];
  }

  if (_reactSubviews.count == 0) {
    // Do nothing if we have no subviews
    return;
  }

  if (CGSizeEqualToSize(self.bounds.size, CGSizeZero)) {
    // Do nothing if layout hasn't happened yet
    return;
  }

  // Convert clipping rect to local coordinates
  clipRect = [clipView convertRect:clipRect toView:self];

  // Mount / unmount views
  for (UIView *view in _reactSubviews) {
    if (CGRectIntersectsRect(clipRect, view.frame)) {
      // View is at least partially visible, so remount it if unmounted
      [self.currentContainerView addSubview:view];
      // View is visible, update clipped subviews
      [view updateClippedSubviewsWithClipRect:clipRect relativeToView:self];
    } else if (view.superview) {
      // View is completely outside the clipRect, so unmount it
      [view removeFromSuperview];
    }
  }
}

- (void)updateState:(const facebook::react::State::Shared &)state
           oldState:(const facebook::react::State::Shared &)oldState
{
  const auto *viewState =
      std::dynamic_pointer_cast<const facebook::react::ConcreteState<facebook::react::ViewState>>(state).get();
  if (viewState == nullptr) {
    return;
  }

  const auto &data = viewState->getData();

  // Remove surplus run views when the run count shrinks (incl. to zero).
  while (_textRunViews.count > data.textRuns.size()) {
    [_textRunViews.lastObject removeFromSuperview];
    [_textRunViews removeLastObject];
  }
  if (data.textRuns.empty()) {
    // The last run just went away: there is nothing left to select.
    [self _updateTextSelectionInteraction];
    return;
  }

  if (_textRunViews == nil) {
    _textRunViews = [NSMutableArray new];
  }
  for (size_t i = 0; i < data.textRuns.size(); i++) {
    RCTAnonymousTextRunView *runView = nil;
    if (i < _textRunViews.count) {
      runView = _textRunViews[i];
      // A recycled View keeps its run views but detaches them (see
      // -prepareForRecycle), so one being reused for text again is re-attached
      // rather than allocated.
      if (runView.superview == nil) {
        [self.currentContainerView addSubview:runView];
      }
    } else {
      runView = [[RCTAnonymousTextRunView alloc] initWithFrame:self.currentContainerView.bounds];
      [_textRunViews addObject:runView];
      [self.currentContainerView addSubview:runView];
    }
    // Host chrome stays BELOW the content it is chrome for. Props and state
    // interleave differently across mount, re-paint and recycle reuse, so
    // "insert the chrome at index 0 once" does not survive: a run attached in
    // a later state update appends above it in one ordering and below it in
    // another, and a label under opaque chrome is invisible. Reasserting after
    // every attach makes the z-order a stated invariant rather than an
    // accident of ordering.
    if (self.hasHostChromeSubviews) {
      for (UIView *subview in self.currentContainerView.subviews) {
        if ([self isHostChromeSubview:subview]) {
          [self.currentContainerView sendSubviewToBack:subview];
        }
      }
    }
    [runView updateRun:data.textRuns[i]];
    runView->_layoutManager = data.layoutManager;
    [runView setContainerBounds:self.currentContainerView.bounds];
    // The run's accessibility elements are laid out from this text; a new run
    // invalidates them for the same reason it invalidates the drawing.
    [runView invalidateAccessibilityElements];
    [runView setNeedsDisplay];
  }
  // Re-establish authored paint order relative to mounted children.
  [self setNeedsLayout];
  [self _updateTextSelectionInteraction];
  [self _updateTextLinkInteraction];
}

// Interleaves the internal per-run paint views with mounted child views in
// authored document order (CSS painting order): a run with
// `documentOrder == d` is placed just below the d-th mounted child, so text
// authored before a child paints under it and text after paints over it.
- (void)reorderAnonymousTextRunViewsIfNeeded
{
  // Skip a pooled-but-detached run view (see -prepareForRecycle): it is not in
  // the hierarchy and has no order to establish.
  if (_textRunViews.count == 0 || _textRunViews.firstObject.superview == nil) {
    return;
  }
  UIView *container = self.currentContainerView;

  // Nothing to interleave WITH is the overwhelmingly common case — a row, a
  // cell, a label: a view whose only content is its own text. Its run views
  // were appended in order and there is no mounted child to sit above or
  // below, so there is nothing to do.
  if (container.subviews.count == _textRunViews.count) {
    return;
  }

  NSMutableArray<UIView *> *mountedChildren = [NSMutableArray new];
  for (UIView *subview in container.subviews) {
    // Host chrome is not a mounted child and must be invisible to document
    // order: counting it made `documentOrder == 0` mean "just below the
    // chrome", which filed a <button>'s label UNDER its own platform surface —
    // invisible under the opaque filled style, and under the translucent gray
    // one the labels showed through dimmed and *looked* correct, which is why
    // it survived the first screenshots. Chrome keeps its place at the very
    // back through the attach-time invariant instead.
    if (![subview isKindOfClass:[RCTAnonymousTextRunView class]] && ![self isHostChromeSubview:subview]) {
      [mountedChildren addObject:subview];
    }
  }
  for (NSUInteger i = 0; i < _textRunViews.count; i++) {
    RCTAnonymousTextRunView *runView = _textRunViews[i];
    int documentOrder = runView->_run.documentOrder;
    if (documentOrder >= (int)mountedChildren.count) {
      // After all mounted children: on top.
      [container bringSubviewToFront:runView];
    } else {
      // Just below the child it precedes in document order.
      [container insertSubview:runView belowSubview:mountedChildren[documentOrder]];
    }
  }
}

#pragma mark - `user-select` on a View's own text

/*
 * A View that paints its own text is not a text view, so none of UIKit's
 * text-selection machinery reaches it. What `<Text selectable>` gives on iOS
 * is not range selection either — it is a long press that offers **Copy**,
 * and copies the whole string (`RCTParagraphComponentView`'s context menu).
 * This gives a View with `userSelect: 'text'` exactly that, from the runs it
 * already holds, so bare strings and `<Text selectable>` behave identically
 * on this platform.
 *
 * Range selection with drag handles does not exist for either one on iOS.
 */

- (BOOL)_hasSelectableText
{
  // Report no text while the run views are absent or pooled and detached (see
  // -prepareForRecycle)
  if (_textRunViews.count == 0 || _textRunViews.firstObject.superview == nil) {
    return NO;
  }
  return selectsText(static_cast<const ViewProps &>(*_props).userSelect);
}

#if !TARGET_OS_TV
/*
 * iOS's own press-and-hold behaviour for a link this view drew.
 *
 * Installed only when some run actually carries one — the check is over the C++
 * fragments, so it costs a walk of the runs and no text shaping. A view whose
 * text has no link adds no gesture recognizer and behaves exactly as before.
 */
- (void)_updateTextLinkInteraction
{
  BOOL wanted = NO;
  for (RCTAnonymousTextRunView *runView in _textRunViews) {
    if ([runView containsLink]) {
      wanted = YES;
      break;
    }
  }
  if (_textLinkInteraction == nil) {
    if (!wanted) {
      return;
    }
    __weak __typeof(self) weakSelf = self;
    _textLinkInteraction = [[EXPTextLinkInteraction alloc]
        initWithView:self
            resolver:^id _Nullable(
                CGPoint point, NSMutableArray<NSValue *> *rects, UIView *_Nullable *_Nullable outLinkView) {
              return [weakSelf _linkAtPoint:point rects:rects linkView:outLinkView];
            }];
  }
  [_textLinkInteraction setInstalled:wanted];
}

/*
 * A lift is a picture of glyphs this view drew. If the view leaves the screen
 * while the OS is showing that picture, the picture has to go with it.
 *
 * Recycling already tears the interaction down, but an ordinary unmount does
 * not: the view is simply removed, and UIKit would go on floating a lifted link
 * over the app until the user dismissed it — offering Open on a URL belonging to
 * a screen they have already left. Leaving the window is the signal that covers
 * both, because a recycled view leaves it too.
 */
- (void)didMoveToWindow
{
  [super didMoveToWindow];
  if (self.window == nil) {
    [_textLinkInteraction dismissMenuIfPresenting];
  }
}

/*
 * The link under a point, resolved through the same run views and the same
 * `containerFrame` that painting and touch hit-testing use — so the menu lifts
 * the glyphs the user actually pressed. Runs do not overlap, so the first one
 * containing the point answers.
 */
- (nullable id)_linkAtPoint:(CGPoint)point
                      rects:(NSMutableArray<NSValue *> *)rects
                   linkView:(UIView *_Nullable *_Nullable)outLinkView
{
  for (RCTAnonymousTextRunView *runView in _textRunViews) {
    if (id link = [runView linkAtContainerPoint:point rects:rects]) {
      /*
       * The link's OWN VIEW, not the run's.
       *
       * Every link is painted by a view of its own precisely so that a lift can
       * be handed a real view — something UIKit can hide, animate and put back
       * by itself, the way it does for a `UITextView`. Handing back the run
       * instead would be handing back the whole paragraph.
       */
      if (outLinkView != nullptr) {
        *outLinkView = [self _viewForLinkContentInRects:rects fallingBackTo:[runView linkViewAtContainerPoint:point]];
      }
      return link;
    }
  }
  return nil;
}

/*
 * Where a view was LAID OUT, ignoring any transform it is wearing.
 *
 * `frame` cannot be used for this. UIKit documents it as undefined once
 * `transform` is not the identity, and it really is: it reports the bounding
 * box of the transformed shape, so a 72pt square turned 45° claims a frame of
 * about 102pt. Anything animating a rotation or a scale — which is most things
 * worth putting inside a link — therefore never matched the line box the text
 * laid it out in, fell through to the glyph view, and lifted an EMPTY CHIP,
 * because a link whose whole content is that view has no glyphs of its own.
 *
 * `center` and `bounds` are the pair that survives a transform: the view's own
 * transform is applied about its anchor point and moves neither. That is also
 * the geometry the question is really asking about — the box the line was laid
 * out around, not wherever an animation has since swung the pixels.
 */
static CGRect RCTUntransformedFrame(UIView *view)
{
  const CGSize size = view.bounds.size;
  const CGPoint anchor = view.layer.anchorPoint;
  const CGPoint position = view.center;
  // `center` is the anchor point's position, which is the middle only for the
  // default anchor; `transform-origin` can move it.
  return CGRectMake(position.x - size.width * anchor.x, position.y - size.height * anchor.y, size.width, size.height);
}

/*
 * The view that IS this link's content, for the OS to lift.
 *
 * A link is not always glyphs. `<a><img></a>` puts an image inside the anchor,
 * and that image is already a MOUNTED VIEW of its own, riding in the text as an
 * attachment — so the thing to lift is that view, not a drawing of the text
 * around it. The same holds for anything else an author nests in a link: a
 * video, a custom component. Whatever it is, it is a real view and UIKit can
 * hide, lift and restore it natively.
 *
 * This is the difference between pointing at content that exists and
 * manufacturing a copy of it. Earlier versions captured the link's pixels into
 * an image, which meant the capture had to learn about every kind of content
 * separately — and silently produced an EMPTY chip for `<a><img>`, because an
 * image is not painted by the text run at all.
 *
 * A mounted child counts only if it sits INSIDE the link's own rects: an image
 * merely on the same line belongs to the sentence, not to the link. The rects
 * come from the link's CHARACTER RANGE, and an attachment character carries
 * `href` like any other, so an `<img>` written inside the `<a>` is in that
 * range and an `<img>` beside it is not — pinned from the text stack's side by
 * `EXPAtomicInlineLinkRangeTests`.
 *
 * Which leaves the case where the link's content is a picture AND words. Two
 * different views draw those halves — the image is a mounted subview, the text
 * is painted by the run — so no single child is the whole link, and the answer
 * is this container, which draws both.
 *
 * Handing back a container is only safe because the interaction CLIPS its lift
 * to the link's own box (`EXPLinkPress.liftBox`). Without that it pictures the
 * view's whole bounds and aims at the view's centre, which put the page's
 * surroundings in the chip and started it in the wrong place — the first
 * attempt at this shipped exactly that. A child is still preferred wherever one
 * really is the link, because UIKit can hide and restore a real view natively.
 */
- (nullable UIView *)_viewForLinkContentInRects:(NSArray<NSValue *> *)rects fallingBackTo:(nullable UIView *)glyphView
{
  if (rects.count == 0) {
    return glyphView;
  }
  CGRect linkBounds = CGRectNull;
  for (NSValue *value in rects) {
    linkBounds = CGRectIsNull(linkBounds) ? value.CGRectValue : CGRectUnion(linkBounds, value.CGRectValue);
  }
  if (CGRectIsNull(linkBounds)) {
    return glyphView;
  }
  for (UIView *subview in self.currentContainerView.subviews) {
    if ([subview isKindOfClass:[RCTAnonymousTextRunView class]] || subview.hidden) {
      continue;
    }
    if ([self isHostChromeSubview:subview]) {
      continue;
    }
    // Grown by a point: an attachment's box and the line rect around it are
    // computed by different paths and agree only to within rounding.
    const CGRect grown = CGRectInset(linkBounds, -1, -1);
    const CGRect frame = RCTUntransformedFrame(subview);
    if (!CGRectContainsRect(grown, frame)) {
      continue;
    }
    /*
     * The child is the link when it spans the link's INLINE extent.
     *
     * Not full containment: a line box is routinely TALLER than the picture
     * sitting on it, because the leading belongs to the line rather than to the
     * image, so an `<a><img></a>` would fail a height test and be treated as a
     * region of its container — which lifts a slab of line padding around the
     * picture instead of the picture. Width is the honest question, because a
     * picture beside a caption spans only part of the link and a picture that is
     * the whole link spans all of it.
     */
    const CGRect frameNow = RCTUntransformedFrame(subview);
    const BOOL spansTheLink =
        frameNow.origin.x <= CGRectGetMinX(linkBounds) + 1 && CGRectGetMaxX(frameNow) >= CGRectGetMaxX(linkBounds) - 1;
    if (spansTheLink) {
      return subview;
    }
    return self;
  }
  return glyphView;
}

- (void)_updateTextSelectionInteraction
{
  BOOL wanted = [self _hasSelectableText];
  BOOL installed = _textSelectionLongPress != nil;
  if (wanted == installed) {
    return;
  }

  if (wanted) {
    _textSelectionLongPress =
        [[UILongPressGestureRecognizer alloc] initWithTarget:self action:@selector(_handleTextSelectionLongPress:)];
    [self addGestureRecognizer:_textSelectionLongPress];
    if (@available(iOS 16.0, *)) {
      self.textSelectionEditMenuInteraction = [[UIEditMenuInteraction alloc] initWithDelegate:self];
      [self addInteraction:self.textSelectionEditMenuInteraction];
    }
  } else {
    [self removeGestureRecognizer:_textSelectionLongPress];
    _textSelectionLongPress = nil;
    if (@available(iOS 16.0, *)) {
      if (self.textSelectionEditMenuInteraction != nil) {
        [self removeInteraction:self.textSelectionEditMenuInteraction];
        self.textSelectionEditMenuInteraction = nil;
      }
    }
  }
}

- (void)_handleTextSelectionLongPress:(UILongPressGestureRecognizer *)gesture
{
  if (gesture.state != UIGestureRecognizerStateBegan) {
    return;
  }
  if (![self becomeFirstResponder]) {
    return;
  }
  if (@available(iOS 16.0, *)) {
    UIEditMenuInteraction *interaction = self.textSelectionEditMenuInteraction;
    if (interaction != nil) {
      CGPoint location = [gesture locationInView:self];
      UIEditMenuConfiguration *config = [UIEditMenuConfiguration configurationWithIdentifier:nil sourcePoint:location];
      [interaction presentEditMenuWithConfiguration:config];
    }
  }
}

/*
 * Every run this View paints, in authored document order, joined by newlines —
 * the same text a reader sees, in the order they see it. The run views are
 * kept in the order of the state's runs, which is document order; their
 * `documentOrder` is a paint position, which a `zIndex` can reorder, so it is
 * not used here.
 */
- (NSAttributedString *)_selectableAttributedText
{
  NSMutableAttributedString *text = [NSMutableAttributedString new];
  for (RCTAnonymousTextRunView *runView in _textRunViews) {
    NSAttributedString *runText = RCTNSAttributedStringFromAttributedString(runView->_run.attributedString);
    if (runText.length == 0) {
      continue;
    }
    if (text.length > 0) {
      [text appendAttributedString:[[NSAttributedString alloc] initWithString:@"\n"]];
    }
    [text appendAttributedString:runText];
  }
  return text;
}
#else
- (void)_updateTextSelectionInteraction
{
}
#endif
- (void)layoutSubviews
{
  [super layoutSubviews];
  if (_textRunViews.count > 0) {
    for (RCTAnonymousTextRunView *runView in _textRunViews) {
      [runView setContainerBounds:self.currentContainerView.bounds];
    }
    [self reorderAnonymousTextRunViewsIfNeeded];
  }
}

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps
{
  RCTAssert(props, @"`props` must not be `null`.");

#ifndef NS_BLOCK_ASSERTIONS
  auto propsRawPtr = _props.get();
  RCTAssert(
      propsRawPtr &&
          ([self class] == [RCTViewComponentView class] ||
           typeid(*propsRawPtr).hash_code() != typeid(const ViewProps).hash_code()),
      @"`RCTViewComponentView` subclasses (and `%@` particularly) must setup `_props`"
       " instance variable with a default value in the constructor.",
      NSStringFromClass([self class]));
#endif

  /*
   * The old props are the real previous props: the diffs below reason about
   * UIKit state `prepareForRecycle` does not touch (transform, opacity,
   * accessibility, hit slop), and substituting defaults after a recycle would
   * leave any stale value that equals its default unreset. The cleared pixels
   * are restored by `-_restorePixelStateClearedByRecycleWith:` instead. Nor
   * is `_props` replaced on recycle: subclasses static_cast it to their own
   * props type.
   */
  const auto &oldViewProps = static_cast<const ViewProps &>(*_props);
  const auto &newViewProps = static_cast<const ViewProps &>(*props);

  /*
   * Assert the baseline is still the one the recycle left, because a subclass that replaces
   * `_props` in its own -prepareForRecycle breaks every diff below without failing any of them:
   * a value the next element leaves at its default diffs equal to the default and keeps what the
   * previous element set, its `accessibilityLabel` included.
   */
  RCTAssert(
      _propsKeptByRecycle == nullptr || _props == _propsKeptByRecycle,
      @"%@ replaced _props in -prepareForRecycle; the next update diffs against it, so it must stay the previous element's props.",
      self.class);
  _propsKeptByRecycle = nullptr;

  BOOL needsInvalidateLayer = NO;
  if (_propsAreStaleFromRecycle) {
    _propsAreStaleFromRecycle = NO;
    [self _restorePixelStateClearedByRecycleWith:newViewProps];
    // Every layer family the clear removed is rebuilt from the new props by
    // -invalidateLayer, which runs in -finalizeUpdates after `_props` below
    // has been swapped to `props`.
    needsInvalidateLayer = YES;
  }

  // `opacity`
  if (oldViewProps.opacity != newViewProps.opacity &&
      ![_propKeysManagedByAnimated_DO_NOT_USE_THIS_IS_BROKEN containsObject:@"opacity"]) {
    self.layer.opacity = (float)newViewProps.opacity;
    needsInvalidateLayer = YES;
  }

  // Disable `removeClippedSubviews` when Fabric View Culling is enabled.
  if (!ReactNativeFeatureFlags::enableViewCulling()) {
    if (oldViewProps.removeClippedSubviews != newViewProps.removeClippedSubviews) {
      _removeClippedSubviews = newViewProps.removeClippedSubviews;
      [self _updateRemoveClippedSubviewsState];
    }
  }

  // `backgroundColor`
  if (oldViewProps.backgroundColor != newViewProps.backgroundColor) {
    self.backgroundColor = RCTUIColorFromSharedColor(newViewProps.backgroundColor);
    needsInvalidateLayer = YES;
  }

  // `shadowColor`
  if (oldViewProps.shadowColor != newViewProps.shadowColor) {
    UIColor *shadowColor = RCTUIColorFromSharedColor(newViewProps.shadowColor);
    self.layer.shadowColor = shadowColor.CGColor;
    needsInvalidateLayer = YES;
  }

  // `shadowOffset`
  if (oldViewProps.shadowOffset != newViewProps.shadowOffset) {
    self.layer.shadowOffset = RCTCGSizeFromSize(newViewProps.shadowOffset);
    needsInvalidateLayer = YES;
  }

  // `shadowOpacity`
  if (oldViewProps.shadowOpacity != newViewProps.shadowOpacity) {
    self.layer.shadowOpacity = (float)newViewProps.shadowOpacity;
    needsInvalidateLayer = YES;
  }

  // `shadowRadius`
  if (oldViewProps.shadowRadius != newViewProps.shadowRadius) {
    self.layer.shadowRadius = (CGFloat)newViewProps.shadowRadius;
    needsInvalidateLayer = YES;
  }

  // `backfaceVisibility`
  if (oldViewProps.backfaceVisibility != newViewProps.backfaceVisibility) {
    self.layer.doubleSided = newViewProps.backfaceVisibility == BackfaceVisibility::Visible;
  }

  // `cursor`
  if (oldViewProps.cursor != newViewProps.cursor) {
    needsInvalidateLayer = YES;
  }

  // `shouldRasterize`
  if (oldViewProps.shouldRasterize != newViewProps.shouldRasterize) {
    self.layer.shouldRasterize = newViewProps.shouldRasterize;
    self.layer.rasterizationScale = newViewProps.shouldRasterize ? self.traitCollection.displayScale : 1.0;
  }

  // `pointerEvents`
  if (oldViewProps.pointerEvents != newViewProps.pointerEvents) {
    self.userInteractionEnabled = newViewProps.pointerEvents != PointerEventsMode::None;
  }

  // `transform`
  if ((oldViewProps.transform != newViewProps.transform ||
       oldViewProps.transformOrigin != newViewProps.transformOrigin) &&
      ![_propKeysManagedByAnimated_DO_NOT_USE_THIS_IS_BROKEN containsObject:@"transform"]) {
    auto newTransform = newViewProps.resolveTransform(_layoutMetrics);
    CATransform3D caTransform = RCTCATransform3DFromTransformMatrix(newTransform);

    self.layer.transform = caTransform;
    // Enable edge antialiasing in rotation, skew, or perspective transforms
    self.layer.allowsEdgeAntialiasing = caTransform.m12 != 0.0f || caTransform.m21 != 0.0f || caTransform.m34 != 0.0f;
  }

  // `hitSlop`
  if (oldViewProps.hitSlop != newViewProps.hitSlop) {
    self.hitTestEdgeInsets = {
        -newViewProps.hitSlop.top,
        -newViewProps.hitSlop.left,
        -newViewProps.hitSlop.bottom,
        -newViewProps.hitSlop.right};
  }

  // `overflow`
  if (oldViewProps.getClipsContentToBounds() != newViewProps.getClipsContentToBounds()) {
    self.currentContainerView.clipsToBounds = newViewProps.getClipsContentToBounds();
    needsInvalidateLayer = YES;
  }

  // `border`
  if (oldViewProps.borderStyles != newViewProps.borderStyles || oldViewProps.borderRadii != newViewProps.borderRadii ||
      oldViewProps.borderColors != newViewProps.borderColors) {
    needsInvalidateLayer = YES;
  }

  // `outline`
  if (oldViewProps.outlineStyle != newViewProps.outlineStyle ||
      oldViewProps.outlineColor != newViewProps.outlineColor ||
      oldViewProps.outlineOffset != newViewProps.outlineOffset ||
      oldViewProps.outlineWidth != newViewProps.outlineWidth) {
    needsInvalidateLayer = YES;
  }

  // `nativeId`
  if (oldViewProps.nativeId != newViewProps.nativeId) {
    self.nativeId = RCTNSStringFromStringNilIfEmpty(newViewProps.nativeId);
  }

  // `accessible`
  if (oldViewProps.accessible != newViewProps.accessible) {
    self.accessibilityElement.isAccessibilityElement = newViewProps.accessible;
  }

  // `accessibilityLabel`, stored only on an accessibility element that is not this view; this view
  // reads its own from `_props` when asked (see `-exp_propsAccessibilityLabel`)
  if (oldViewProps.accessibilityLabel != newViewProps.accessibilityLabel && self.accessibilityElement != self) {
    self.accessibilityElement.accessibilityLabel = RCTNSStringFromStringNilIfEmpty(newViewProps.accessibilityLabel);
  }

  // `accessibilityLanguage`
  if (oldViewProps.accessibilityLanguage != newViewProps.accessibilityLanguage) {
    self.accessibilityElement.accessibilityLanguage =
        RCTNSStringFromStringNilIfEmpty(newViewProps.accessibilityLanguage);
  }

  // `accessibilityHint`
  if (oldViewProps.accessibilityHint != newViewProps.accessibilityHint) {
    self.accessibilityElement.accessibilityHint = RCTNSStringFromStringNilIfEmpty(newViewProps.accessibilityHint);
  }

  // `accessibilityViewIsModal`
  if (oldViewProps.accessibilityViewIsModal != newViewProps.accessibilityViewIsModal) {
    self.accessibilityElement.accessibilityViewIsModal = newViewProps.accessibilityViewIsModal;
  }

  // `accessibilityElementsHidden`
  if (oldViewProps.accessibilityElementsHidden != newViewProps.accessibilityElementsHidden) {
    self.accessibilityElement.accessibilityElementsHidden = newViewProps.accessibilityElementsHidden;
  }

  // `accessibilityShowsLargeContentViewer`
  if (oldViewProps.accessibilityShowsLargeContentViewer != newViewProps.accessibilityShowsLargeContentViewer) {
#if !TARGET_OS_TV
    if (@available(iOS 13.0, *)) {
      if (newViewProps.accessibilityShowsLargeContentViewer) {
        self.showsLargeContentViewer = YES;
        UILargeContentViewerInteraction *interaction = [[UILargeContentViewerInteraction alloc] init];
        [self addInteraction:interaction];
      } else {
        self.showsLargeContentViewer = NO;
      }
    }
#endif
  }

  // `accessibilityLargeContentTitle`
  if (oldViewProps.accessibilityLargeContentTitle != newViewProps.accessibilityLargeContentTitle) {
#if !TARGET_OS_TV
    if (@available(iOS 13.0, *)) {
      self.largeContentTitle = RCTNSStringFromStringNilIfEmpty(newViewProps.accessibilityLargeContentTitle);
    }
#endif
  }

  // `accessibilityOrder`
  if (oldViewProps.accessibilityOrder != newViewProps.accessibilityOrder &&
      ReactNativeFeatureFlags::enableAccessibilityOrder()) {
    // Creating a set since a lot of logic requires lookups in here. However,
    // we still need to preserve the orginal order. So just read from props
    // if need to access that
    _accessibilityOrderNativeIDs = [NSMutableSet new];
    for (const std::string &childId : newViewProps.accessibilityOrder) {
      [_accessibilityOrderNativeIDs addObject:RCTNSStringFromString(childId)];
    }

    // If we are prop updating and have children we can go ahead and assign this prop.
    // Otherwise, we might not have children attached yet and need to wait before then.
    if (self.currentContainerView.subviews.count > 0) {
      [self updateAccessibilityElements];
    }
  }

  // `accessibilityTraits`
  if (oldViewProps.accessibilityTraits != newViewProps.accessibilityTraits) {
    self.accessibilityElement.accessibilityTraits =
        RCTUIAccessibilityTraitsFromAccessibilityTraits(newViewProps.accessibilityTraits);
  }

  // `accessibilityIgnoresInvertColors`
  if (oldViewProps.accessibilityIgnoresInvertColors != newViewProps.accessibilityIgnoresInvertColors) {
    self.accessibilityIgnoresInvertColors = newViewProps.accessibilityIgnoresInvertColors;
  }

  // `accessibilityValue`
  if (oldViewProps.accessibilityValue != newViewProps.accessibilityValue) {
    if (newViewProps.accessibilityValue.text.has_value()) {
      self.accessibilityElement.accessibilityValue =
          RCTNSStringFromStringNilIfEmpty(newViewProps.accessibilityValue.text.value());
    } else if (
        newViewProps.accessibilityValue.now.has_value() && newViewProps.accessibilityValue.min.has_value() &&
        newViewProps.accessibilityValue.max.has_value()) {
      CGFloat val = (CGFloat)(newViewProps.accessibilityValue.now.value()) /
          (newViewProps.accessibilityValue.max.value() - newViewProps.accessibilityValue.min.value());
      self.accessibilityElement.accessibilityValue =
          [NSNumberFormatter localizedStringFromNumber:@(val) numberStyle:NSNumberFormatterPercentStyle];
      ;
    } else {
      self.accessibilityElement.accessibilityValue = nil;
    }
  }

  if (oldViewProps.accessibilityRespondsToUserInteraction != newViewProps.accessibilityRespondsToUserInteraction) {
    self.accessibilityElement.accessibilityRespondsToUserInteraction =
        newViewProps.accessibilityRespondsToUserInteraction;
  }

  // `testId`
  if (oldViewProps.testId != newViewProps.testId) {
    SEL setAccessibilityIdentifierSelector = @selector(setAccessibilityIdentifier:);
    NSString *identifier = RCTNSStringFromString(newViewProps.testId);
    if ([self.accessibilityElement respondsToSelector:setAccessibilityIdentifierSelector]) {
      UIView *accessibilityView = (UIView *)self.accessibilityElement;
      accessibilityView.accessibilityIdentifier = identifier;
    } else {
      self.accessibilityIdentifier = identifier;
    }
  }

  // `filter`
  if (oldViewProps.filter != newViewProps.filter) {
    needsInvalidateLayer = YES;
  }

  // `focusable`
#if TARGET_OS_TV
  if (oldViewProps.focusable != newViewProps.focusable) {
    _focusable = (bool)newViewProps.focusable;
  }
#endif

  // `mixBlendMode`
  if (oldViewProps.mixBlendMode != newViewProps.mixBlendMode) {
    switch (newViewProps.mixBlendMode) {
      case BlendMode::Multiply:
        self.layer.compositingFilter = @"multiplyBlendMode";
        break;
      case BlendMode::Screen:
        self.layer.compositingFilter = @"screenBlendMode";
        break;
      case BlendMode::Overlay:
        self.layer.compositingFilter = @"overlayBlendMode";
        break;
      case BlendMode::Darken:
        self.layer.compositingFilter = @"darkenBlendMode";
        break;
      case BlendMode::Lighten:
        self.layer.compositingFilter = @"lightenBlendMode";
        break;
      case BlendMode::ColorDodge:
        self.layer.compositingFilter = @"colorDodgeBlendMode";
        break;
      case BlendMode::ColorBurn:
        self.layer.compositingFilter = @"colorBurnBlendMode";
        break;
      case BlendMode::HardLight:
        self.layer.compositingFilter = @"hardLightBlendMode";
        break;
      case BlendMode::SoftLight:
        self.layer.compositingFilter = @"softLightBlendMode";
        break;
      case BlendMode::Difference:
        self.layer.compositingFilter = @"differenceBlendMode";
        break;
      case BlendMode::Exclusion:
        self.layer.compositingFilter = @"exclusionBlendMode";
        break;
      case BlendMode::Hue:
        self.layer.compositingFilter = @"hueBlendMode";
        break;
      case BlendMode::Saturation:
        self.layer.compositingFilter = @"saturationBlendMode";
        break;
      case BlendMode::Color:
        self.layer.compositingFilter = @"colorBlendMode";
        break;
      case BlendMode::Luminosity:
        self.layer.compositingFilter = @"luminosityBlendMode";
        break;
      case BlendMode::PlusLighter:
        self.layer.compositingFilter = @"linearDodgeBlendMode";
        break;
      case BlendMode::Normal:
        self.layer.compositingFilter = nil;
        break;
    }
  }

  // `backgroundImage`
  if (oldViewProps.backgroundImage != newViewProps.backgroundImage ||
      oldViewProps.backgroundPosition != newViewProps.backgroundPosition ||
      oldViewProps.backgroundRepeat != newViewProps.backgroundRepeat ||
      oldViewProps.backgroundSize != newViewProps.backgroundSize) {
    needsInvalidateLayer = YES;
  }

  // `boxShadow`
  if (oldViewProps.boxShadow != newViewProps.boxShadow) {
    needsInvalidateLayer = YES;
  }

  _needsInvalidateLayer = _needsInvalidateLayer || needsInvalidateLayer;

  /*
   * Compared BEFORE `_props` is reassigned, and acted on after.
   *
   * `oldViewProps` is a reference *into the object `_props` owns* (bound at the
   * top of this method). The assignment below drops the last strong reference
   * to that object, so it is freed and every `oldViewProps` member is dangling
   * from that point on. Reading one is a use-after-free: AddressSanitizer stops
   * the app on the first mount with a 1-byte read — the size of this enum.
   *
   * The call still has to happen after the assignment, because
   * `_updateTextSelectionInteraction` reads `_hasSelectableText`, which reads
   * the *new* `_props`. So the comparison and the action are split rather than
   * either being moved.
   */
  const bool userSelectChanged = oldViewProps.userSelect != newViewProps.userSelect;

  _props = std::static_pointer_cast<const ViewProps>(props);

  if (userSelectChanged) {
    [self _updateTextSelectionInteraction];
  }
}

- (void)updateEventEmitter:(const EventEmitter::Shared &)eventEmitter
{
  assert(std::dynamic_pointer_cast<const ViewEventEmitter>(eventEmitter));
  _eventEmitter = std::static_pointer_cast<const ViewEventEmitter>(eventEmitter);
}

- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics
           oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics
{
  // Using stored `_layoutMetrics` as `oldLayoutMetrics` here to avoid
  // re-applying individual sub-values which weren't changed.
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:_layoutMetrics];

  // Capture the frame size that was used by updateProps to resolve the
  // transform, before overwriting _layoutMetrics. This is important because
  // _layoutMetrics may be stale (e.g., from a recycled view) and differ from
  // the oldLayoutMetrics parameter (which comes from the shadow tree).
  auto previousFrameSize = _layoutMetrics.frame.size;

  _layoutMetrics = layoutMetrics;
  _needsInvalidateLayer = YES;

  _borderLayer.frame = self.layer.bounds;

  if (_contentView) {
    _contentView.frame = RCTCGRectFromRect(_layoutMetrics.getContentFrame());
  }

  if (_containerView) {
    _containerView.frame = CGRectMake(0, 0, self.layer.bounds.size.width, self.layer.bounds.size.height);
  }

  if (_backgroundColorLayer) {
    _backgroundColorLayer.frame = CGRectMake(0, 0, self.layer.bounds.size.width, self.layer.bounds.size.height);
  }

  // Recompute the transform whenever the layout size differs from what was
  // used in updateProps. Using previousFrameSize (the stored _layoutMetrics)
  // instead of the oldLayoutMetrics parameter ensures correctness even when
  // the view was recycled with stale dimensions.
  if ((_props->transformOrigin.isSet() || !_props->transform.operations.empty()) &&
      layoutMetrics.frame.size != previousFrameSize) {
    auto newTransform = _props->resolveTransform(layoutMetrics);
    self.layer.transform = RCTCATransform3DFromTransformMatrix(newTransform);
  }

  if (_swiftUIWrapper != nullptr) {
    [_swiftUIWrapper updateLayoutWithBounds:self.bounds];
  }
}

- (BOOL)isJSResponder
{
  return _isJSResponder;
}

- (void)setIsJSResponder:(BOOL)isJSResponder
{
  _isJSResponder = isJSResponder;
}

- (void)finalizeUpdates:(RNComponentViewUpdateMask)updateMask
{
  [super finalizeUpdates:updateMask];
  // RECYCLE PIXEL CONTRACT invariant (see the clear/restore pair below): by
  // the time an update batch finalizes, a recycled view must have had
  // -updateProps: run its unconditional pixel restore. A stale flag here
  // means some mount path skipped it, and the view would reach the screen
  // with its background/border/outline layers cleared.
  RCTAssert(
      !_propsAreStaleFromRecycle || (updateMask & RNComponentViewUpdateMaskProps) == 0,
      @"%@ finalized a props update without restoring recycle-cleared pixels.",
      self.class);
  _useCustomContainerView = [self styleWouldClipOverflowInk];
  if (!_needsInvalidateLayer) {
    return;
  }

  _needsInvalidateLayer = NO;
  [self invalidateLayer];
}

- (void)prepareForRecycle
{
  [super prepareForRecycle];

  /*
   * Host chrome installed from outside belongs to what this view was; left
   * attached through recycling it would back unrelated content and keep
   * counting itself out of the mount indices.
   */
  for (UIView *chrome in _hostChromeSubviews) {
    [chrome removeFromSuperview];
  }
  [_hostChromeSubviews removeAllObjects];

  // If view was managed by animated, its props need to align with UIView's properties.
  const auto &props = static_cast<const ViewProps &>(*_props);
  if ([_propKeysManagedByAnimated_DO_NOT_USE_THIS_IS_BROKEN containsObject:@"transform"]) {
    self.layer.transform = RCTCATransform3DFromTransformMatrix(props.transform);
  }
  if ([_propKeysManagedByAnimated_DO_NOT_USE_THIS_IS_BROKEN containsObject:@"opacity"]) {
    self.layer.opacity = (float)props.opacity;
  }

  // Detach the per-run text paint views rather than destroying them, so a
  // recycled View that is given text again re-attaches them instead of
  // allocating new ones, as a recycled `<Text>` reuses its paragraph view.
  // Detaching keeps this safe: a recycled View that is given no text displays
  // nothing, because nothing is in its hierarchy until `updateState` puts it
  // back. A few spare views held by a pooled container is the whole cost.
  static const NSUInteger kMaxPooledRunViews = 4;
  if (_textRunViews != nil) {
    for (RCTAnonymousTextRunView *runView in _textRunViews) {
      [runView removeFromSuperview];
    }
    while (_textRunViews.count > kMaxPooledRunViews) {
      [_textRunViews removeLastObject];
    }
  }
  // No runs left, so this tears the selection interaction down with them.
  [self _updateTextSelectionInteraction];
  /*
   * The link interaction is torn down OUTRIGHT rather than re-derived.
   *
   * `_updateTextLinkInteraction` asks the pooled run views whether they contain
   * a link, and a pooled run still holds the text it was recycled with — so
   * asking would answer "yes" and leave a long-press recognizer installed on a
   * view that is about to be handed to something else entirely.
   */
  [_textLinkInteraction setInstalled:NO];

  [self _clearPixelStateForRecycle];

  _propKeysManagedByAnimated_DO_NOT_USE_THIS_IS_BROKEN = nil;
  _eventEmitter.reset();
  _isJSResponder = NO;
  // Chrome that asked for this is gone by now, and the view is about to become
  // something with no list behind it.
  _passesTouchesToHostChrome = NO;
  _reactSubviews = [NSMutableArray new];
  _layoutMetrics = EmptyLayoutMetrics;
}

/*
 * RECYCLE PIXEL CONTRACT — these two methods are a PAIR.
 *
 * `_clearPixelStateForRecycle` destroys props-derived pixels while `_props`
 * keeps describing the old element, so the value diffs in -updateProps:
 * cannot see the loss: a view recycled between two elements with EQUAL
 * styling diffs equal, skips re-applying, and would keep the cleared state
 * (two of five identical dark code boxes rendered bare; which two depended on
 * pooling). `_restorePixelStateClearedByRecycleWith:` is the inverse the
 * first -updateProps: after a recycle applies UNCONDITIONALLY — restoration
 * must not depend on a diff, for the same reason the diff cannot see the
 * clear.
 *
 * The invariant that keeps this correct as it grows: everything the first
 * method clears, the second restores (directly, or via the forced
 * -invalidateLayer rebuild its caller schedules — the layer families:
 * background color, border, outline, filter, box shadow, background image).
 * Nothing else belongs in either: state prepareForRecycle does NOT clear is
 * restored by the ordinary old-vs-new diffs and must NOT be force-applied
 * here from a defaults baseline — that variant broke transform/opacity for
 * every recycled view whose incoming prop equalled the default.
 * -finalizeUpdates asserts the flag was consumed, so a recycled view can
 * never reach the screen with its pixels cleared and no restore run.
 */
- (void)_clearPixelStateForRecycle
{
  // Box shadow layers, then every other visual layer family, to prevent
  // cross-component contamination.
  if (_boxShadowLayers != nullptr) {
    for (CALayer *boxShadowLayer in _boxShadowLayers) {
      [boxShadowLayer removeFromSuperlayer];
    }
    [_boxShadowLayers removeAllObjects];
    _boxShadowLayers = nil;
  }
  [_backgroundColorLayer removeFromSuperlayer];
  _backgroundColorLayer = nil;
  // The plain background too, not only its layer object, or a view recycled
  // out of an author-styled `<button style={{backgroundColor}}>` keeps drawing
  // that author's colour under the next button's platform chrome
  _backgroundColor = nil;
  self.layer.backgroundColor = nil;
  [_borderLayer removeFromSuperlayer];
  _borderLayer = nil;
  [_outlineLayer removeFromSuperlayer];
  _outlineLayer = nil;
  [_filterLayer removeFromSuperlayer];
  _filterLayer = nil;
  [self clearExistingBackgroundImageLayers];
  _removeClippedSubviews = NO;

  _propsAreStaleFromRecycle = YES;
  _propsKeptByRecycle = _props;
}

- (void)_restorePixelStateClearedByRecycleWith:(const ViewProps &)newViewProps
{
  self.backgroundColor = RCTUIColorFromSharedColor(newViewProps.backgroundColor);
  if (!ReactNativeFeatureFlags::enableViewCulling()) {
    _removeClippedSubviews = newViewProps.removeClippedSubviews;
    [self _updateRemoveClippedSubviewsState];
  }
  // The removed layers are rebuilt from the new props by -invalidateLayer;
  // the caller forces that by setting `needsInvalidateLayer`.
}

- (void)setPropKeysManagedByAnimated_DO_NOT_USE_THIS_IS_BROKEN:(NSSet<NSString *> *_Nullable)props
{
  _propKeysManagedByAnimated_DO_NOT_USE_THIS_IS_BROKEN = props;
}

- (NSSet<NSString *> *_Nullable)propKeysManagedByAnimated_DO_NOT_USE_THIS_IS_BROKEN
{
  return _propKeysManagedByAnimated_DO_NOT_USE_THIS_IS_BROKEN;
}

- (UIView *)betterHitTest:(CGPoint)point withEvent:(UIEvent *)event
{
  // This is a classic textbook implementation of `hitTest:` with a couple of improvements:
  //   * It does not stop algorithm if some touch is outside the view
  //     which does not have `clipToBounds` enabled.
  //   * Taking `layer.zIndex` field into an account is not required because
  //     lists of `ShadowView`s are already sorted based on `zIndex` prop.

  if (!self.userInteractionEnabled || self.hidden || self.alpha < 0.01) {
    return nil;
  }

  BOOL isPointInside = [self pointInside:point withEvent:event];

  UIView *currentContainerView = self.currentContainerView;

  BOOL clipsToBounds = currentContainerView.clipsToBounds;

  clipsToBounds = clipsToBounds || _layoutMetrics.overflowInset == EdgeInsets{};

  if (clipsToBounds && !isPointInside) {
    return nil;
  }

  for (UIView *subview in [currentContainerView.subviews reverseObjectEnumerator]) {
    UIView *hitView = [subview hitTest:[subview convertPoint:point fromView:currentContainerView] withEvent:event];
    if (hitView) {
      return hitView;
    }
  }

  return isPointInside ? self : nil;
}

- (BOOL)hasTouchHandlers
{
  return _props->events.bits.any();
}

/*
 * Whether a hit view is worth interrupting the host chrome for. Anything that is
 * not a React view is assumed to want its own touches (a `UIControl`, a text
 * run that answered because a link is under the point); only a React view with
 * no handler is safe to pass over.
 */
static BOOL RCTViewWouldActOnTheTouch(UIView *view)
{
  if (![view isKindOfClass:[RCTViewComponentView class]]) {
    return YES;
  }
  return ((RCTViewComponentView *)view).hasTouchHandlers;
}

- (UIView *)hitTest:(CGPoint)point withEvent:(UIEvent *)event
{
  switch (_props->pointerEvents) {
    case PointerEventsMode::Auto: {
      /*
       * `passesTouchesToHostChrome` reaches further than `BoxNone`, which gives
       * up only this view's area: a child that merely draws (the label in a
       * radio row) must not swallow a tap meant for the row, so the whole
       * subtree is passed over except what would act on the touch, as `UILabel`
       * defaults `userInteractionEnabled` off. Only `Auto` becomes this; `None`
       * and `BoxOnly` are the author's and chrome does not overrule them.
       */
      UIView *view = [self betterHitTest:point withEvent:event];
      if (_passesTouchesToHostChrome && (view == self || !RCTViewWouldActOnTheTouch(view))) {
        return nil;
      }
      return view;
    }
    case PointerEventsMode::None:
      return nil;
    case PointerEventsMode::BoxOnly:
      return [self pointInside:point withEvent:event] ? self : nil;
    case PointerEventsMode::BoxNone:
      UIView *view = [self betterHitTest:point withEvent:event];
      return view != self ? view : nil;
  }
}

static RCTCornerRadii RCTCornerRadiiFromBorderRadii(BorderRadii borderRadii)
{
  return RCTCornerRadii{
      .topLeftHorizontal = (CGFloat)borderRadii.topLeft.horizontal,
      .topLeftVertical = (CGFloat)borderRadii.topLeft.vertical,
      .topRightHorizontal = (CGFloat)borderRadii.topRight.horizontal,
      .topRightVertical = (CGFloat)borderRadii.topRight.vertical,
      .bottomLeftHorizontal = (CGFloat)borderRadii.bottomLeft.horizontal,
      .bottomLeftVertical = (CGFloat)borderRadii.bottomLeft.vertical,
      .bottomRightHorizontal = (CGFloat)borderRadii.bottomRight.horizontal,
      .bottomRightVertical = (CGFloat)borderRadii.bottomRight.vertical};
}

static RCTCornerRadii
RCTCreateOutlineCornerRadiiFromBorderRadii(const BorderRadii &borderRadii, CGFloat outlineWidth, CGFloat outlineOffset)
{
  return RCTCornerRadii{
      borderRadii.topLeft.horizontal != 0 ? borderRadii.topLeft.horizontal + outlineWidth + outlineOffset : 0,
      borderRadii.topLeft.vertical != 0 ? borderRadii.topLeft.vertical + outlineWidth + outlineOffset : 0,
      borderRadii.topRight.horizontal != 0 ? borderRadii.topRight.horizontal + outlineWidth + outlineOffset : 0,
      borderRadii.topRight.vertical != 0 ? borderRadii.topRight.vertical + outlineWidth + outlineOffset : 0,
      borderRadii.bottomLeft.horizontal != 0 ? borderRadii.bottomLeft.horizontal + outlineWidth + outlineOffset : 0,
      borderRadii.bottomLeft.vertical != 0 ? borderRadii.bottomLeft.vertical + outlineWidth + outlineOffset : 0,
      borderRadii.bottomRight.horizontal != 0 ? borderRadii.bottomRight.horizontal + outlineWidth + outlineOffset : 0,
      borderRadii.bottomRight.vertical != 0 ? borderRadii.bottomRight.vertical + outlineWidth + outlineOffset : 0};
}

// To be used for CSS properties like `border` and `outline`.
static void RCTAddContourEffectToLayer(
    CALayer *layer,
    const RCTCornerRadii &cornerRadii,
    const RCTBorderColors &contourColors,
    const UIEdgeInsets &contourInsets,
    const RCTBorderStyle &contourStyle)
{
  UIImage *image = RCTGetBorderImage(
      contourStyle, layer.bounds.size, cornerRadii, contourInsets, contourColors, [UIColor clearColor], NO);

  if (image == nil) {
    layer.contents = nil;
  } else {
    CGSize imageSize = image.size;
    UIEdgeInsets imageCapInsets = image.capInsets;
    CGRect contentsCenter = CGRect{
        CGPoint{imageCapInsets.left / imageSize.width, imageCapInsets.top / imageSize.height},
        CGSize{(CGFloat)1.0 / imageSize.width, (CGFloat)1.0 / imageSize.height}};
    layer.contents = (id)image.CGImage;
    layer.contentsScale = image.scale;

    BOOL isResizable = !UIEdgeInsetsEqualToEdgeInsets(image.capInsets, UIEdgeInsetsZero);
    if (isResizable) {
      layer.contentsCenter = contentsCenter;
    } else {
      layer.contentsCenter = CGRect{CGPoint{0.0, 0.0}, CGSize{1.0, 1.0}};
    }
  }

  // If mutations are applied inside of Animation block, it may cause layer to be animated.
  // To stop that, imperatively remove all animations from layer.
  [layer removeAllAnimations];
}

static RCTBorderColors RCTCreateRCTBorderColorsFromBorderColors(BorderColors borderColors)
{
  return RCTBorderColors{
      .top = RCTUIColorFromSharedColor(borderColors.top),
      .left = RCTUIColorFromSharedColor(borderColors.left),
      .bottom = RCTUIColorFromSharedColor(borderColors.bottom),
      .right = RCTUIColorFromSharedColor(borderColors.right)};
}

static CALayerCornerCurve CornerCurveFromBorderCurve(BorderCurve borderCurve)
{
  // The constants are available only starting from iOS 13
  // CALayerCornerCurve is a typealias on NSString *
  switch (borderCurve) {
    case BorderCurve::Continuous:
      return @"continuous"; // kCACornerCurveContinuous;
    case BorderCurve::Circular:
      return @"circular"; // kCACornerCurveCircular;
  }
}

static RCTBorderStyle RCTBorderStyleFromBorderStyle(BorderStyle borderStyle)
{
  switch (borderStyle) {
    case BorderStyle::Solid:
      return RCTBorderStyleSolid;
    case BorderStyle::Dotted:
      return RCTBorderStyleDotted;
    case BorderStyle::Dashed:
      return RCTBorderStyleDashed;
  }
}

static RCTBorderStyle RCTBorderStyleFromOutlineStyle(OutlineStyle outlineStyle)
{
  switch (outlineStyle) {
    case OutlineStyle::Solid:
      return RCTBorderStyleSolid;
    case OutlineStyle::Dotted:
      return RCTBorderStyleDotted;
    case OutlineStyle::Dashed:
      return RCTBorderStyleDashed;
  }
}

- (BOOL)styleWouldClipOverflowInk
{
  const auto borderMetrics = _props->resolveBorderMetrics(_layoutMetrics);
  BOOL nonZeroBorderWidth = !(borderMetrics.borderWidths.isUniform() && borderMetrics.borderWidths.left == 0);
  BOOL clipToPaddingBox = ReactNativeFeatureFlags::enableIOSViewClipToPaddingBox();
  return _props->getClipsContentToBounds() &&
      ((!_props->boxShadow.empty() || (clipToPaddingBox && nonZeroBorderWidth)) || _props->outlineWidth != 0);
}

// The view that is used as the receiver for all styling (borders, background,
// etc.). Most of the time, this is just `self`. When a view has a filter like
// `blur` applied, we need to wrap it in a SwiftUI view to render the effect.
// In this case, `effectiveContentView` will be the content view inside the
// SwiftUI wrapper.
- (UIView *)effectiveContentView
{
  if (!ReactNativeFeatureFlags::enableSwiftUIBasedFilters()) {
    return self;
  }

  UIView *effectiveContentView = self;

  if (self.styleNeedsSwiftUIContainer) {
    if (_swiftUIWrapper == nullptr) {
      _swiftUIWrapper = [RCTSwiftUIContainerViewWrapper new];
      UIView *swiftUIContentView = [[UIView alloc] init];
      for (UIView *subview in self.subviews) {
        [swiftUIContentView addSubview:subview];
      }
      swiftUIContentView.clipsToBounds = self.clipsToBounds;
      self.clipsToBounds = NO;
      swiftUIContentView.layer.mask = self.layer.mask;
      self.layer.mask = nil;
      [_swiftUIWrapper updateContentView:swiftUIContentView];
      [_swiftUIWrapper updateLayoutWithBounds:self.bounds];
      [self addSubview:_swiftUIWrapper.hostingView];

      [self transferVisualPropertiesFromView:self toView:swiftUIContentView];
    }

    effectiveContentView = _swiftUIWrapper.contentView;
  } else {
    if (_swiftUIWrapper != nullptr) {
      UIView *swiftUIContentView = _swiftUIWrapper.contentView;
      for (UIView *subview in swiftUIContentView.subviews) {
        [self addSubview:subview];
      }
      self.clipsToBounds = swiftUIContentView.clipsToBounds;
      self.layer.mask = swiftUIContentView.layer.mask;

      [self transferVisualPropertiesFromView:swiftUIContentView toView:self];

      [_swiftUIWrapper.hostingView removeFromSuperview];
      _swiftUIWrapper = nil;
    }
  }

  return effectiveContentView;
}

// This UIView is the UIView that holds all subviews. It is sometimes not self
// because we want to render "overflow ink" that extends beyond the bounds of
// the view and is not affected by clipping.
- (UIView *)currentContainerView
{
  UIView *effectiveContentView = self.effectiveContentView;

  if (_useCustomContainerView) {
    if (!_containerView) {
      _containerView = [[UIView alloc] initWithFrame:CGRectMake(0, 0, self.bounds.size.width, self.bounds.size.height)];
      for (UIView *subview in effectiveContentView.subviews) {
        [_containerView addSubview:subview];
      }
      _containerView.clipsToBounds = effectiveContentView.clipsToBounds;
      effectiveContentView.clipsToBounds = NO;
      _containerView.layer.mask = effectiveContentView.layer.mask;
      effectiveContentView.layer.mask = nil;
      [effectiveContentView addSubview:_containerView];
    }

    effectiveContentView = _containerView;
  } else {
    if (_containerView) {
      for (UIView *subview in _containerView.subviews) {
        [effectiveContentView addSubview:subview];
      }
      effectiveContentView.clipsToBounds = _containerView.clipsToBounds;
      effectiveContentView.layer.mask = _containerView.layer.mask;
      [_containerView removeFromSuperview];
      _containerView = nil;
    }
  }
  return effectiveContentView;
}

- (void)invalidateLayer
{
  CALayer *layer = self.effectiveContentView.layer;

  if (CGSizeEqualToSize(layer.bounds.size, CGSizeZero)) {
    return;
  }

  const auto borderMetrics = _props->resolveBorderMetrics(_layoutMetrics);

  // Stage 1. Shadow Path
  BOOL const layerHasShadow = layer.shadowOpacity > 0 && CGColorGetAlpha(layer.shadowColor) > 0;
  if (layerHasShadow) {
    if (CGColorGetAlpha(_backgroundColor.CGColor) > 0.999) {
      // If view has a solid background color, calculate shadow path from border.
      const RCTCornerInsets cornerInsets =
          RCTGetCornerInsets(RCTCornerRadiiFromBorderRadii(borderMetrics.borderRadii), UIEdgeInsetsZero);
      CGPathRef shadowPath = RCTPathCreateWithRoundedRect(self.bounds, cornerInsets, nil, NO);
      layer.shadowPath = shadowPath;
      CGPathRelease(shadowPath);
    } else {
      // Can't accurately calculate box shadow, so fall back to pixel-based shadow.
      layer.shadowPath = nil;

      RCTLogAdvice(
          @"View #%ld of type %@ has a shadow set but cannot calculate "
           "shadow efficiently. Consider setting a solid background color to "
           "fix this or applying the shadow to a more specific component.",
          (long)self.tag,
          [self class]);
    }
  } else {
    layer.shadowPath = nil;
  }

#if !TARGET_OS_TV && defined(__IPHONE_OS_VERSION_MAX_ALLOWED) && \
    __IPHONE_OS_VERSION_MAX_ALLOWED >= 170000 /* __IPHONE_17_0 */
  // Stage 1.5. Cursor / Hover Effects
  if (@available(iOS 17.0, *)) {
    UIHoverStyle *hoverStyle = nil;
    if (_props->cursor == Cursor::Pointer) {
      const RCTCornerInsets cornerInsets =
          RCTGetCornerInsets(RCTCornerRadiiFromBorderRadii(borderMetrics.borderRadii), UIEdgeInsetsZero);
#if TARGET_OS_IOS
      // Due to an Apple bug, it seems on iOS, UIShapes made with `[UIShape shapeWithBezierPath:]`
      // evaluate their shape on the superviews' coordinate space. This leads to the hover shape
      // rendering incorrectly on iOS, iOS apps in compatibility mode on visionOS, but not on visionOS.
      // To work around this, for iOS, we can calculate the border path based on `view.frame` (the
      // superview's coordinate space) instead of view.bounds.
      CGPathRef borderPath = RCTPathCreateWithRoundedRect(self.frame, cornerInsets, NULL, NO);
#else // TARGET_OS_VISION
      CGPathRef borderPath = RCTPathCreateWithRoundedRect(self.bounds, cornerInsets, NULL, NO);
#endif
      UIBezierPath *bezierPath = [UIBezierPath bezierPathWithCGPath:borderPath];
      CGPathRelease(borderPath);
      UIShape *shape = [UIShape shapeWithBezierPath:bezierPath];

      hoverStyle = [UIHoverStyle styleWithEffect:[UIHoverAutomaticEffect effect] shape:shape];
    }
    [self setHoverStyle:hoverStyle];
  }
#endif
  const bool useCoreAnimationBorderRendering =
      borderMetrics.borderColors.isUniform() && borderMetrics.borderWidths.isUniform() &&
      borderMetrics.borderStyles.isUniform() && borderMetrics.borderStyles.left == BorderStyle::Solid &&
      areBorderRadiiCircular(borderMetrics.borderRadii) &&
      (
          // iOS draws borders in front of the content whereas CSS draws them behind
          // the content. For this reason, only use iOS border drawing when clipping
          // or when the border is hidden.
          borderMetrics.borderWidths.left == 0 || self.currentContainerView.clipsToBounds ||
          (colorComponentsFromColor(borderMetrics.borderColors.left).alpha == 0 &&
           (*borderMetrics.borderColors.left).getUIColor() != nullptr));

  // background color
  UIColor *backgroundColor = [_backgroundColor resolvedColorWithTraitCollection:self.traitCollection];
  // The reason we sometimes do not set self.layer's backgroundColor is because
  // we want to support non-uniform border radii, which apple does not natively
  // support. To get this behavior we need to create a CGPath in the shape that
  // we want. If we mask self.layer to this path, we would be clipping subviews
  // which we may not want to do. The generalized solution in this case is just
  // create a new layer
  if (useCoreAnimationBorderRendering) {
    [_backgroundColorLayer removeFromSuperlayer];
    _backgroundColorLayer = nil;
    layer.backgroundColor = backgroundColor.CGColor;
  } else {
    layer.backgroundColor = nil;
    if (!_backgroundColorLayer) {
      _backgroundColorLayer = [CALayer layer];
      _backgroundColorLayer.zPosition = BACKGROUND_COLOR_ZPOSITION;
      [layer addSublayer:_backgroundColorLayer];
    }
    [self shapeLayerToMatchView:_backgroundColorLayer borderMetrics:borderMetrics];
    _backgroundColorLayer.backgroundColor = backgroundColor.CGColor;
    [_backgroundColorLayer removeAllAnimations];
  }

  // borders
  if (useCoreAnimationBorderRendering) {
    [_borderLayer removeFromSuperlayer];
    _borderLayer = nil;

    layer.borderWidth = (CGFloat)borderMetrics.borderWidths.left;
    UIColor *borderColor = RCTUIColorFromSharedColor(borderMetrics.borderColors.left);
    layer.borderColor = borderColor.CGColor;
    layer.cornerRadius = (CGFloat)borderMetrics.borderRadii.topLeft.horizontal;
    layer.cornerCurve = CornerCurveFromBorderCurve(borderMetrics.borderCurves.topLeft);
  } else {
    if (!_borderLayer) {
      CALayer *borderLayer = [CALayer new];
      borderLayer.zPosition = BACKGROUND_COLOR_ZPOSITION + 1;
      borderLayer.frame = layer.bounds;
      borderLayer.magnificationFilter = kCAFilterNearest;
      [layer addSublayer:borderLayer];
      _borderLayer = borderLayer;
    }

    layer.borderWidth = 0;
    layer.borderColor = nil;
    layer.cornerRadius = 0;

    RCTBorderColors borderColors = RCTCreateRCTBorderColorsFromBorderColors(borderMetrics.borderColors);

    RCTAddContourEffectToLayer(
        _borderLayer,
        RCTCornerRadiiFromBorderRadii(borderMetrics.borderRadii),
        borderColors,
        RCTUIEdgeInsetsFromEdgeInsets(borderMetrics.borderWidths),
        RCTBorderStyleFromBorderStyle(borderMetrics.borderStyles.left));
  }

  // outline
  [_outlineLayer removeFromSuperlayer];
  _outlineLayer = nil;
  if (_props->outlineWidth != 0) {
    if (!_outlineLayer) {
      CALayer *outlineLayer = [CALayer new];
      outlineLayer.magnificationFilter = kCAFilterNearest;
      outlineLayer.zPosition = BACKGROUND_COLOR_ZPOSITION + 2;

      [layer addSublayer:outlineLayer];
      _outlineLayer = outlineLayer;
    }
    _outlineLayer.frame = CGRectInset(
        layer.bounds, -_props->outlineOffset - _props->outlineWidth, -_props->outlineOffset - _props->outlineWidth);

    // Core Animation can only draw solid contours, so dotted and dashed outlines
    // have to be drawn with Core Graphics, the same way non-solid borders are.
    if (_props->outlineStyle == OutlineStyle::Solid && areBorderRadiiCircular(borderMetrics.borderRadii) &&
        borderMetrics.borderRadii.topLeft.horizontal == 0) {
      UIColor *outlineColor = RCTUIColorFromSharedColor(_props->outlineColor);
      _outlineLayer.borderWidth = _props->outlineWidth;
      _outlineLayer.borderColor = outlineColor.CGColor;
    } else {
      UIColor *outlineColor = RCTUIColorFromSharedColor(_props->outlineColor);

      RCTAddContourEffectToLayer(
          _outlineLayer,
          RCTCreateOutlineCornerRadiiFromBorderRadii(
              borderMetrics.borderRadii, _props->outlineWidth, _props->outlineOffset),
          RCTBorderColors{outlineColor, outlineColor, outlineColor, outlineColor},
          UIEdgeInsets{_props->outlineWidth, _props->outlineWidth, _props->outlineWidth, _props->outlineWidth},
          RCTBorderStyleFromOutlineStyle(_props->outlineStyle));
    }
  }

  // filter
  [_filterLayer removeFromSuperlayer];
  _filterLayer = nil;
  if (_swiftUIWrapper != nullptr) {
    [_swiftUIWrapper resetStyles];
  }
  self.layer.opacity = (float)_props->opacity;
  if (!_props->filter.empty()) {
    float multiplicativeBrightness = 1;
    bool hasBrightnessFilter = false;
    for (const auto &primitive : _props->filter) {
      if (primitive.type == FilterType::DropShadow) {
        if (_swiftUIWrapper != nullptr && std::holds_alternative<DropShadowParams>(primitive.parameters)) {
          const auto &dropShadowParams = std::get<DropShadowParams>(primitive.parameters);
          UIColor *shadowColor = RCTUIColorFromSharedColor(dropShadowParams.color);
          [_swiftUIWrapper updateDropShadow:@(dropShadowParams.standardDeviation)
                                          x:@(dropShadowParams.offsetX)
                                          y:@(dropShadowParams.offsetY)
                                      color:shadowColor];
        }
      } else if (std::holds_alternative<Float>(primitive.parameters)) {
        if (primitive.type == FilterType::Brightness) {
          multiplicativeBrightness *= std::get<Float>(primitive.parameters);
          hasBrightnessFilter = true;
        } else if (primitive.type == FilterType::Opacity) {
          self.layer.opacity *= std::get<Float>(primitive.parameters);
        } else if (primitive.type == FilterType::Blur) {
          if (_swiftUIWrapper != nullptr) {
            Float blurRadius = std::get<Float>(primitive.parameters);
            [_swiftUIWrapper updateBlurRadius:@(blurRadius)];
          }
        } else if (primitive.type == FilterType::Grayscale) {
          if (_swiftUIWrapper != nullptr) {
            Float grayscale = std::get<Float>(primitive.parameters);
            [_swiftUIWrapper updateGrayscale:@(grayscale)];
          }
        } else if (primitive.type == FilterType::Saturate) {
          if (_swiftUIWrapper != nullptr) {
            Float saturation = std::get<Float>(primitive.parameters);
            [_swiftUIWrapper updateSaturation:@(saturation)];
          }
        } else if (primitive.type == FilterType::Contrast) {
          if (_swiftUIWrapper != nullptr) {
            Float contrast = std::get<Float>(primitive.parameters);
            [_swiftUIWrapper updateContrast:@(contrast)];
          }
        } else if (primitive.type == FilterType::HueRotate) {
          if (_swiftUIWrapper != nullptr) {
            Float hueRotateDegrees = std::get<Float>(primitive.parameters);
            [_swiftUIWrapper updateHueRotate:@(hueRotateDegrees)];
          }
        }
      }
    }

    if (hasBrightnessFilter) {
      _filterLayer = [CALayer layer];
      [self shapeLayerToMatchView:_filterLayer borderMetrics:borderMetrics];
      _filterLayer.compositingFilter = @"multiplyBlendMode";
      _filterLayer.backgroundColor = [UIColor colorWithRed:multiplicativeBrightness
                                                     green:multiplicativeBrightness
                                                      blue:multiplicativeBrightness
                                                     alpha:self.layer.opacity]
                                         .CGColor;
      // So that this layer is always above any potential sublayers this view may
      // add
      _filterLayer.zPosition = CGFLOAT_MAX;
      [layer addSublayer:_filterLayer];
    }
  }

  // background image
  [self clearExistingBackgroundImageLayers];
  if (!_props->backgroundImage.empty()) {
    const auto borderMetricsBI = _props->resolveBorderMetrics(_layoutMetrics);

    // background-origin: padding-box
    CGRect backgroundPositioningArea = RCTCGRectFromRect(_layoutMetrics.getPaddingFrame());
    // background-clip: border-box
    CGRect backgroundPaintingArea = self.layer.bounds;

    size_t imageIndex = _props->backgroundImage.size() - 1;
    // iterate in reverse to match CSS specification
    for (const auto &backgroundImage : std::ranges::reverse_view(_props->backgroundImage)) {
      BackgroundSize backgroundSize = BackgroundSizeLengthPercentage{};
      if (!_props->backgroundSize.empty()) {
        backgroundSize = _props->backgroundSize[imageIndex % _props->backgroundSize.size()];
      }

      BackgroundPosition backgroundPosition;
      if (!_props->backgroundPosition.empty()) {
        backgroundPosition = _props->backgroundPosition[imageIndex % _props->backgroundPosition.size()];
      }

      BackgroundRepeat backgroundRepeat;
      if (!_props->backgroundRepeat.empty()) {
        backgroundRepeat = _props->backgroundRepeat[imageIndex % _props->backgroundRepeat.size()];
      }

      CGSize backgroundImageSize = [RCTBackgroundImageUtils calculateBackgroundImageSize:backgroundPositioningArea
                                                                       itemIntrinsicSize:backgroundPositioningArea.size
                                                                          backgroundSize:backgroundSize
                                                                        backgroundRepeat:backgroundRepeat];

      CALayer *gradientLayer;

      if (std::holds_alternative<LinearGradient>(backgroundImage)) {
        const auto &linearGradient = std::get<LinearGradient>(backgroundImage);
        gradientLayer = [RCTLinearGradient gradientLayerWithSize:backgroundImageSize gradient:linearGradient];
      } else if (std::holds_alternative<RadialGradient>(backgroundImage)) {
        const auto &radialGradient = std::get<RadialGradient>(backgroundImage);
        gradientLayer = [RCTRadialGradient gradientLayerWithSize:backgroundImageSize gradient:radialGradient];
      }

      if (gradientLayer != nil) {
        CALayer *backgroundImageLayer =
            [RCTBackgroundImageUtils createBackgroundImageLayerWithSize:backgroundPositioningArea
                                                           paintingArea:backgroundPaintingArea
                                                               itemSize:backgroundImageSize
                                                     backgroundPosition:backgroundPosition
                                                       backgroundRepeat:backgroundRepeat
                                                              itemLayer:gradientLayer];
        [self shapeLayerToMatchView:backgroundImageLayer borderMetrics:borderMetricsBI];
        backgroundImageLayer.masksToBounds = YES;
        backgroundImageLayer.zPosition = BACKGROUND_COLOR_ZPOSITION;
        [layer addSublayer:backgroundImageLayer];
        [_backgroundImageLayers addObject:backgroundImageLayer];
      }

      imageIndex--;
    }
  }

  // box shadow
  for (CALayer *boxShadowLayer in _boxShadowLayers) {
    [boxShadowLayer removeFromSuperlayer];
  }
  [_boxShadowLayers removeAllObjects];
  if (!_props->boxShadow.empty()) {
    if (!_boxShadowLayers) {
      _boxShadowLayers = [NSMutableArray new];
    }
    for (auto it = _props->boxShadow.rbegin(); it != _props->boxShadow.rend(); ++it) {
      CALayer *shadowLayer = RCTGetBoxShadowLayer(
          *it,
          RCTCornerRadiiFromBorderRadii(borderMetrics.borderRadii),
          RCTUIEdgeInsetsFromEdgeInsets(borderMetrics.borderWidths),
          self.layer.bounds.size);
      shadowLayer.zPosition = _borderLayer.zPosition;
      [layer addSublayer:shadowLayer];
      [_boxShadowLayers addObject:shadowLayer];
    }
  }

  // clipping
  self.currentContainerView.layer.mask = nil;
  if (self.currentContainerView.clipsToBounds) {
    BOOL clipToPaddingBox = ReactNativeFeatureFlags::enableIOSViewClipToPaddingBox();
    if (!clipToPaddingBox) {
      if (areBorderRadiiCircular(borderMetrics.borderRadii)) {
        self.currentContainerView.layer.cornerRadius = borderMetrics.borderRadii.topLeft.horizontal;
      } else {
        CALayer *maskLayer =
            [self createMaskLayer:self.bounds
                     cornerInsets:RCTGetCornerInsets(
                                      RCTCornerRadiiFromBorderRadii(borderMetrics.borderRadii), UIEdgeInsetsZero)];
        self.currentContainerView.layer.mask = maskLayer;
      }

      for (UIView *subview in self.currentContainerView.subviews) {
        if ([subview isKindOfClass:[UIImageView class]]) {
          RCTCornerInsets cornerInsets = RCTGetCornerInsets(
              RCTCornerRadiiFromBorderRadii(borderMetrics.borderRadii),
              RCTUIEdgeInsetsFromEdgeInsets(borderMetrics.borderWidths));

          // If the subview is an image view, we have to apply the mask directly to the image view's layer,
          // otherwise the image might overflow with the border radius.
          subview.layer.mask = [self createMaskLayer:subview.bounds cornerInsets:cornerInsets];
        }
      }
    } else if (
        !borderMetrics.borderWidths.isUniform() || borderMetrics.borderWidths.left != 0 ||
        !areBorderRadiiCircular(borderMetrics.borderRadii)) {
      CALayer *maskLayer = [self createMaskLayer:RCTCGRectFromRect(_layoutMetrics.getPaddingFrame())
                                    cornerInsets:RCTGetCornerInsets(
                                                     RCTCornerRadiiFromBorderRadii(borderMetrics.borderRadii),
                                                     RCTUIEdgeInsetsFromEdgeInsets(borderMetrics.borderWidths))];
      self.currentContainerView.layer.mask = maskLayer;
    } else {
      self.currentContainerView.layer.cornerRadius = borderMetrics.borderRadii.topLeft.horizontal;
    }
  }
}

// Shapes the given layer to match the shape of this View's layer. This is
// basically just accounting for size, position, and border radius.
- (void)shapeLayerToMatchView:(CALayer *)layer borderMetrics:(BorderMetrics)borderMetrics
{
  // Bounds is needed here to account for scaling transforms properly and ensure
  // we do not scale twice
  layer.frame = CGRectMake(0, 0, self.layer.bounds.size.width, self.layer.bounds.size.height);
  if (areBorderRadiiCircular(borderMetrics.borderRadii)) {
    layer.mask = nil;
    layer.cornerRadius = borderMetrics.borderRadii.topLeft.horizontal;
    layer.cornerCurve = CornerCurveFromBorderCurve(borderMetrics.borderCurves.topLeft);
  } else {
    CAShapeLayer *maskLayer = [self
        createMaskLayer:self.bounds
           cornerInsets:RCTGetCornerInsets(RCTCornerRadiiFromBorderRadii(borderMetrics.borderRadii), UIEdgeInsetsZero)];
    layer.mask = maskLayer;
    layer.cornerRadius = 0;
  }
}

- (CAShapeLayer *)createMaskLayer:(CGRect)bounds cornerInsets:(RCTCornerInsets)cornerInsets
{
  CGPathRef path = RCTPathCreateWithRoundedRect(bounds, cornerInsets, nil, NO);
  CAShapeLayer *maskLayer = [CAShapeLayer layer];
  maskLayer.path = path;
  CGPathRelease(path);
  return maskLayer;
}

- (void)clearExistingBackgroundImageLayers
{
  if (_backgroundImageLayers == nil) {
    _backgroundImageLayers = [NSMutableArray new];
    return;
  }
  for (CALayer *backgroundImageLayer in _backgroundImageLayers) {
    [backgroundImageLayer removeFromSuperlayer];
  }
  [_backgroundImageLayers removeAllObjects];
}

#pragma mark - Accessibility

- (NSObject *)accessibilityElement
{
  return self;
}

- (void)didMoveToSuperview
{
  // At this point we are guaranteed to have subviews, if we are going to have them
  if (ReactNativeFeatureFlags::enableAccessibilityOrder()) {
    [self updateAccessibilityElements];
  }
}

/*
 * The reading order of a view that paints text: its runs' accessibility leaves interleaved with its
 * mounted children, in document order.
 *
 * Only an explicit order does this. Left to UIKit, the run views and the mounted children are
 * sibling containers read one after another, which reads an inline `<button>` or `<img>`, a mounted
 * child laid out inside the sentence, after the whole paragraph instead of where it stands.
 * Each run's `InlineAccessibilityContent` already lists its attachments at their positions, so it
 * is the single source of that order: an attachment's mounted view is presented where its element
 * stands and nowhere else, which is also what keeps it from being announced twice.
 *
 * An authored order (`accessibilityOrder`, which sets `accessibilityElements`) and a view that is
 * itself the accessibility element keep UIKit's behaviour.
 */
- (NSArray *)accessibilityElements
{
  NSArray *elements = super.accessibilityElements;
  if (elements != nil || _textRunViews.count == 0 || self.isAccessibilityElement) {
    return elements;
  }
  return [self _textRunReadingOrder];
}

- (NSArray *)_textRunReadingOrder
{
  UIView *container = self.currentContainerView;
  NSMutableArray<RCTAnonymousTextRunView *> *runViews = [NSMutableArray arrayWithCapacity:_textRunViews.count];
  for (RCTAnonymousTextRunView *runView in _textRunViews) {
    // A pooled run view detached by a recycle has nothing to present
    if (runView.superview == container) {
      [runViews addObject:runView];
    }
  }
  // Stable, so runs that share a position keep their state order
  [runViews sortWithOptions:NSSortStable
            usingComparator:^NSComparisonResult(RCTAnonymousTextRunView *a, RCTAnonymousTextRunView *b) {
              return [@(a->_run.documentOrder) compare:@(b->_run.documentOrder)];
            }];

  NSMutableSet<NSNumber *> *runAttachmentTags = [NSMutableSet set];
  for (RCTAnonymousTextRunView *runView in runViews) {
    for (const auto tag : runView->_run.accessibilityContent.attachmentTags) {
      [runAttachmentTags addObject:@(tag)];
    }
  }

  // Mounted children in React order: the mutation stream inserts them in it, and z-index is a
  // layer property that leaves the subview order alone
  NSArray<UIView *> *mountedChildren = _removeClippedSubviews ? [_reactSubviews copy] : container.subviews;
  NSMutableArray *elements = [NSMutableArray array];
  NSMutableDictionary<NSNumber *, UIView *> *attachmentsByTag = [NSMutableDictionary dictionary];
  NSMutableArray<UIView *> *blockChildren = [NSMutableArray array];
  for (UIView *child in mountedChildren) {
    if ([child isKindOfClass:[RCTAnonymousTextRunView class]]) {
      continue;
    }
    if ([self isHostChromeSubview:child]) {
      // Chrome sits behind everything it is chrome for, so it reads first, as UIKit would read it
      if (!child.hidden) {
        [elements addObject:child];
      }
    } else if ([runAttachmentTags containsObject:@(child.tag)]) {
      attachmentsByTag[@(child.tag)] = child;
    } else {
      [blockChildren addObject:child];
    }
  }

  // `documentOrder` counts the block-level children before a run; inline attachments are the
  // run's own and are not counted
  NSUInteger nextBlockChild = 0;
  void (^presentView)(UIView *_Nullable) = ^(UIView *_Nullable view) {
    // A clipped or hidden view is not on screen to be read
    if (view != nil && view.superview != nil && !view.hidden) {
      [elements addObject:view];
    }
  };
  for (RCTAnonymousTextRunView *runView in runViews) {
    for (; nextBlockChild < blockChildren.count && (int)nextBlockChild < runView->_run.documentOrder;
         nextBlockChild++) {
      presentView(blockChildren[nextBlockChild]);
    }
    const auto &models = runView->_run.accessibilityContent.elements;
    NSArray *leaves = [runView accessibilityLeavesInContainer:self];
    for (size_t i = 0; i < models.size() && i < leaves.count; i++) {
      if (leaves[i] != NSNull.null) {
        [elements addObject:leaves[i]];
      }
      for (const auto tag : models[i].attachmentTags) {
        presentView(attachmentsByTag[@(tag)]);
      }
    }
  }
  for (; nextBlockChild < blockChildren.count; nextBlockChild++) {
    presentView(blockChildren[nextBlockChild]);
  }
  return elements;
}

- (void)updateAccessibilityElements
{
  if ([_accessibilityOrderNativeIDs count] == 0) {
    self.accessibilityElements = nil;
    return;
  }

  NSMutableDictionary<NSString *, UIView *> *nativeIdToView = [NSMutableDictionary new];
  [RCTViewComponentView collectAccessibilityElements:self
                                      intoDictionary:nativeIdToView
                                           nativeIds:_accessibilityOrderNativeIDs];

  NSMutableArray *accessibilityElements = [NSMutableArray new];
  for (const auto &childId : _props->accessibilityOrder) {
    NSString *nsStringChildId = RCTNSStringFromString(childId);

    UIView *viewWithMatchingNativeId = [nativeIdToView objectForKey:nsStringChildId];
    if (viewWithMatchingNativeId != nil) {
      [accessibilityElements addObject:viewWithMatchingNativeId];
    }
  }

  self.accessibilityElements = accessibilityElements;
}

+ (void)collectAccessibilityElements:(UIView *)view
                      intoDictionary:(NSMutableDictionary<NSString *, UIView *> *)dict
                           nativeIds:(NSSet<NSString *> *)nativeIds
{
  for (UIView *subview in view.subviews) {
    if ([subview isKindOfClass:[RCTViewComponentView class]] &&
        [nativeIds containsObject:((RCTViewComponentView *)subview).nativeId]) {
      [dict setObject:subview forKey:((RCTViewComponentView *)subview).nativeId];
    }
    [RCTViewComponentView collectAccessibilityElements:subview intoDictionary:dict nativeIds:nativeIds];
  }
}

static NSString *RCTRecursiveAccessibilityLabel(UIView *view)
{
  // Result string is initialized lazily to prevent useless but costly allocations.
  NSMutableString *result = nil;
  for (UIView *subview in view.subviews) {
    // Skip subviews that have accessibilityElementsHidden set to YES
    if (subview.accessibilityElementsHidden) {
      continue;
    }
    NSString *label = subview.accessibilityLabel;
    if (!label) {
      label = RCTRecursiveAccessibilityLabel(subview);
    }
    if (label && label.length > 0) {
      if (result == nil) {
        result = [NSMutableString string];
      }
      if (result.length > 0) {
        [result appendString:@", "];
      }
      [result appendString:label];
    }
  }
  return result;
}

/**
 * The name the props give this view, read from the props every time it is asked for.
 *
 * Never a copy kept beside them. A copy is written when a props diff says the name changed, and a
 * recycled view whose diff baseline was reset kept the name of the element it last showed: a
 * `<button>accept</button>` announced itself as the previous button's "Increment update count"
 * while drawing "accept". A name read from the current props, or else from the painted text below,
 * cannot drift from what is on screen.
 */
- (nullable NSString *)exp_propsAccessibilityLabel
{
  return _props != nullptr ? RCTNSStringFromStringNilIfEmpty(_props->accessibilityLabel) : nil;
}

- (NSString *)accessibilityLabel
{
  NSString *label = [self exp_propsAccessibilityLabel] ?: super.accessibilityLabel;
  if (label) {
    return label;
  }

  if (self.isAccessibilityElement) {
    return RCTRecursiveAccessibilityLabel(self.currentContainerView);
  }
  return nil;
}

- (NSString *)accessibilityLabelForCoopting
{
  return [self exp_propsAccessibilityLabel] ?: super.accessibilityLabel;
}

- (BOOL)wantsToCooptLabel
{
  return !self.accessibilityLabelForCoopting && super.isAccessibilityElement;
}

- (BOOL)canBecomeFocused
{
#if !TARGET_OS_TV
  return _focusable || RCTViewIsInteractiveAccessibilityElement(self, static_cast<const ViewProps &>(*_props));
#else
  return _focusable;
#endif
}

- (BOOL)isAccessibilityElement
{
  if (self.contentView != nil) {
    return self.contentView.isAccessibilityElement;
  }

  return [super isAccessibilityElement];
}

- (NSString *)accessibilityValue
{
  const auto &props = static_cast<const ViewProps &>(*_props);
  const auto accessibilityState = props.accessibilityState.value_or(AccessibilityState{});

  // Handle Switch.
  if ((self.accessibilityTraits & AccessibilityTraitSwitch) == AccessibilityTraitSwitch) {
    if (accessibilityState.checked == AccessibilityState::Checked) {
      return @"1";
    } else if (accessibilityState.checked == AccessibilityState::Unchecked) {
      return @"0";
    }
  }

  NSMutableArray *valueComponents = [NSMutableArray new];
  NSString *roleString = (props.role != Role::None) ? [NSString stringWithUTF8String:toString(props.role).c_str()]
                                                    : [NSString stringWithUTF8String:props.accessibilityRole.c_str()];

  // In iOS, checkbox and radio buttons aren't recognized as traits. However,
  // because our apps use checkbox and radio buttons often, we should announce
  // these to screenreader users.  (They should already be familiar with them
  // from using web).
  if ([roleString isEqualToString:@"checkbox"]) {
    [valueComponents addObject:RCTLocalizedString("checkbox", "checkable interactive control")];
  }

  if ([roleString isEqualToString:@"radio"]) {
    [valueComponents
        addObject:
            RCTLocalizedString(
                "radio button",
                "a checkable input that when associated with other radio buttons, only one of which can be checked at a time")];
  }

  // Handle states which haven't already been handled.
  if (accessibilityState.checked == AccessibilityState::Checked) {
    [valueComponents
        addObject:RCTLocalizedString("checked", "a checkbox, radio button, or other widget which is checked")];
  }
  if (accessibilityState.checked == AccessibilityState::Unchecked) {
    [valueComponents
        addObject:RCTLocalizedString("unchecked", "a checkbox, radio button, or other widget which is unchecked")];
  }
  if (accessibilityState.checked == AccessibilityState::Mixed) {
    [valueComponents
        addObject:RCTLocalizedString(
                      "mixed", "a checkbox, radio button, or other widget which is both checked and unchecked")];
  }
  if (const auto expanded = accessibilityState.expanded; expanded.has_value()) {
    if (expanded.value()) {
      [valueComponents addObject:RCTLocalizedString(
                                     "expanded", "a menu, dialog, accordian panel, or other widget which is expanded")];
    } else {
      [valueComponents
          addObject:RCTLocalizedString(
                        "collapsed", "a menu, dialog, accordian panel, or other widget which is collapsed")];
    }
  }

  if (accessibilityState.busy) {
    [valueComponents addObject:RCTLocalizedString("busy", "an element currently being updated or modified")];
  }

  // Using super.accessibilityValue:
  // 1. to access the value that is set to accessibilityValue in updateProps
  // 2. can't access from self.accessibilityElement because it resolves to self
  if (super.accessibilityValue) {
    [valueComponents addObject:super.accessibilityValue];
  }

  if (valueComponents.count > 0) {
    return [valueComponents componentsJoinedByString:@", "];
  }

  return nil;
}

#pragma mark - Accessibility Events

- (BOOL)shouldGroupAccessibilityChildren
{
  return YES;
}

- (NSArray<UIAccessibilityCustomAction *> *)accessibilityCustomActions
{
  const auto &accessibilityActions = _props->accessibilityActions;

  if (accessibilityActions.empty()) {
    return nil;
  }

  NSMutableArray<UIAccessibilityCustomAction *> *customActions = [NSMutableArray array];
  for (const auto &accessibilityAction : accessibilityActions) {
    NSString *actionName = RCTNSStringFromString(accessibilityAction.name);
    NSString *actionLabel = actionName;

    if (accessibilityAction.label.has_value()) {
      actionLabel = RCTNSStringFromString(accessibilityAction.label.value());
    }

    [customActions
        addObject:[[UIAccessibilityCustomAction alloc] initWithName:actionLabel
                                                             target:self
                                                           selector:@selector(didActivateAccessibilityCustomAction:)]];
  }

  return [customActions copy];
}

- (BOOL)accessibilityActivate
{
  if (_eventEmitter && _props->onAccessibilityTap) {
    _eventEmitter->onAccessibilityTap();
    return YES;
  } else {
    return NO;
  }
}

- (BOOL)accessibilityPerformMagicTap
{
  if (_eventEmitter && _props->onAccessibilityMagicTap) {
    _eventEmitter->onAccessibilityMagicTap();
    return YES;
  } else {
    return NO;
  }
}

- (BOOL)accessibilityPerformEscape
{
  if (_eventEmitter && _props->onAccessibilityEscape) {
    _eventEmitter->onAccessibilityEscape();
    return YES;
  } else {
    return NO;
  }
}

- (void)accessibilityIncrement
{
  if (_eventEmitter && _props->onAccessibilityAction) {
    _eventEmitter->onAccessibilityAction("increment");
  }
}

- (void)accessibilityDecrement
{
  if (_eventEmitter && _props->onAccessibilityAction) {
    _eventEmitter->onAccessibilityAction("decrement");
  }
}

- (BOOL)didActivateAccessibilityCustomAction:(UIAccessibilityCustomAction *)action
{
  if (_eventEmitter && _props->onAccessibilityAction) {
    // iOS defines the name as the localized label, so iterate through accessibilityActions to find the matching
    // non-localized action name when passing to JS. This allows for standard action names across platforms.
    NSString *actionName = action.name;
    for (const auto &accessibilityAction : _props->accessibilityActions) {
      if (accessibilityAction.label.has_value() &&
          [RCTNSStringFromString(accessibilityAction.label.value()) isEqualToString:action.name]) {
        actionName = RCTNSStringFromString(accessibilityAction.name);
        break;
      }
    }
    _eventEmitter->onAccessibilityAction(RCTStringFromNSString(actionName));
    return YES;
  } else {
    return NO;
  }
}

- (SharedTouchEventEmitter)touchEventEmitterAtPoint:(CGPoint)point
{
  // A tap that lands on an inline element with its own handler resolves to
  // that element's fragment emitter; a tap on bare text resolves to null here
  // (text-node fragments carry the emitter-less anonymous box) and falls
  // through to the View's own emitter — matching the web, where text nodes are
  // not event targets but the containing element is. Each run view resolves
  // the hit against the same `containerFrame` it paints with, so a tap can
  // never land somewhere the glyphs are not drawn. Runs do not overlap (block
  // children separate them), so the first containing run wins.
  for (RCTAnonymousTextRunView *runView in _textRunViews) {
    // Skip a pooled run view detached by -prepareForRecycle: it still holds the
    // run it painted before the recycle
    if (runView.superview == nil) {
      continue;
    }
    if (auto touchEventEmitter = [runView touchEventEmitterAtContainerPoint:point]) {
      return touchEventEmitter;
    }
  }
  return _eventEmitter;
}

- (NSString *)componentViewName_DO_NOT_USE_THIS_IS_BROKEN
{
  return RCTNSStringFromString([[self class] componentDescriptorProvider].name);
}

- (BOOL)styleNeedsSwiftUIContainer
{
  if (_props->filter.empty()) {
    return NO;
  }

  // A filter must not affect layout, but UIHostingController insets its content by the safe area.
  // To disable the insets we use `safeAreaRegions` which is only available in iOS 16.4 and tvOS 16.4.
  if (@available(iOS 16.4, tvOS 16.4, *)) {
    for (const auto &primitive : _props->filter) {
      if (primitive.type == FilterType::Blur || primitive.type == FilterType::Grayscale ||
          primitive.type == FilterType::DropShadow || primitive.type == FilterType::Saturate ||
          primitive.type == FilterType::Contrast || primitive.type == FilterType::HueRotate) {
        return YES;
      }
    }
  }

  return NO;
}

- (void)transferVisualPropertiesFromView:(UIView *)sourceView toView:(UIView *)destinationView
{
  // shadow
  destinationView.layer.shadowColor = sourceView.layer.shadowColor;
  sourceView.layer.shadowColor = nil;
  destinationView.layer.shadowOffset = sourceView.layer.shadowOffset;
  sourceView.layer.shadowOffset = CGSizeZero;
  destinationView.layer.shadowOpacity = sourceView.layer.shadowOpacity;
  sourceView.layer.shadowOpacity = 0;
  destinationView.layer.shadowRadius = sourceView.layer.shadowRadius;
  sourceView.layer.shadowRadius = 0;

  // background
  destinationView.layer.backgroundColor = sourceView.layer.backgroundColor;
  sourceView.layer.backgroundColor = nil;
  if (_backgroundColorLayer != nullptr) {
    [destinationView.layer addSublayer:_backgroundColorLayer];
  }

  // border
  destinationView.layer.borderColor = sourceView.layer.borderColor;
  sourceView.layer.borderColor = nil;
  destinationView.layer.borderWidth = sourceView.layer.borderWidth;
  sourceView.layer.borderWidth = 0;

  // corner
  destinationView.layer.cornerRadius = sourceView.layer.cornerRadius;
  sourceView.layer.cornerRadius = 0;
  destinationView.layer.cornerCurve = sourceView.layer.cornerCurve;

  // custom layers
  if (_borderLayer != nullptr) {
    [destinationView.layer addSublayer:_borderLayer];
  }
  if (_outlineLayer != nullptr) {
    [destinationView.layer addSublayer:_outlineLayer];
  }
  if (_filterLayer != nullptr) {
    [destinationView.layer addSublayer:_filterLayer];
  }
  for (CALayer *layer in _backgroundImageLayers) {
    [destinationView.layer addSublayer:layer];
  }
  for (CALayer *layer in _boxShadowLayers) {
    [destinationView.layer addSublayer:layer];
  }
}

#pragma mark - Focus Events

- (BOOL)canBecomeFirstResponder
{
  // Presenting the Copy menu requires first-responder status, so a View whose
  // own text is selectable must be able to take it even with imperative focus
  // off.
  return ReactNativeFeatureFlags::enableImperativeFocus() || [self _hasSelectableText];
}

#if !TARGET_OS_TV
- (BOOL)canPerformAction:(SEL)action withSender:(id)sender
{
  if (action == @selector(copy:) && [self _hasSelectableText]) {
    return YES;
  }
  return [super canPerformAction:action withSender:sender];
}

- (void)copy:(id)sender
{
  NSAttributedString *attributedText = [self _selectableAttributedText];
  if (attributedText.length == 0) {
    return;
  }

  NSMutableDictionary *item = [NSMutableDictionary new];
  NSData *rtf = [attributedText dataFromRange:NSMakeRange(0, attributedText.length)
                           documentAttributes:@{NSDocumentTypeDocumentAttribute : NSRTFDTextDocumentType}
                                        error:nil];
  if (rtf) {
    [item setObject:rtf forKey:(id)kUTTypeFlatRTFD];
  }
  [item setObject:attributedText.string forKey:(id)kUTTypeUTF8PlainText];

  UIPasteboard.generalPasteboard.items = @[ item ];
}
#endif

- (void)handleCommand:(const NSString *)commandName args:(const NSArray *)args
{
  if ([commandName isEqualToString:@"focus"]) {
    [self focus];
    return;
  }

  if ([commandName isEqualToString:@"blur"]) {
    [self blur];
    return;
  }
}

#if TARGET_OS_TV
/// Finds the containing RCTSurfaceHostingProxyRootView by walking up the view
/// hierarchy.
- (RCTSurfaceHostingProxyRootView *)containingRootView
{
  UIView *view = self;
  while (view != nil) {
    if ([view isKindOfClass:[RCTSurfaceHostingProxyRootView class]]) {
      return (RCTSurfaceHostingProxyRootView *)view;
    }
    view = view.superview;
  }
  return nil;
}
#endif

- (UIView *)viewToFocus
{
  return self;
}

- (void)focus
{
  UIView *viewToFocus = [self viewToFocus];

#if TARGET_OS_TV
  RCTSurfaceHostingProxyRootView *rootView = [self containingRootView];
  if (rootView == nil) {
    return;
  }

  rootView.reactPreferredFocusedView = viewToFocus;
  [rootView setNeedsFocusUpdate];
  [rootView updateFocusIfNeeded];
#else
  [viewToFocus becomeFirstResponder];
#endif
}

- (void)blur
{
  [self resignFirstResponder];
}

- (BOOL)becomeFirstResponder
{
  if (![super becomeFirstResponder]) {
    return NO;
  }

  if (_eventEmitter && ReactNativeFeatureFlags::enableImperativeFocus()) {
    _eventEmitter->onFocus();
  }

  return YES;
}

- (BOOL)resignFirstResponder
{
  if (![super resignFirstResponder]) {
    return NO;
  }

  if (_eventEmitter && ReactNativeFeatureFlags::enableImperativeFocus()) {
    _eventEmitter->onBlur();
  }

  return YES;
}

#if TARGET_OS_TV

- (void)didUpdateFocusInContext:(UIFocusUpdateContext *)context
       withAnimationCoordinator:(UIFocusAnimationCoordinator *)coordinator
{
  if (context.previouslyFocusedView == context.nextFocusedView) {
    return;
  }

  // Do not resignFirstRespodner if we lost focus, let whoever took focus
  // becomeFirstResponder thereby resigning for us. If we resign here,
  // first responder will be assigned to some ancestor view and they
  // can temporarily call onFocus/onBlur
  if (context.nextFocusedView == self) {
    [self becomeFirstResponder];
  } else if (context.previouslyFocusedView == self && context.nextFocusedView == nil) {
    [self resignFirstResponder];
  }

  [super didUpdateFocusInContext:context withAnimationCoordinator:coordinator];
}

#endif

@end

/*
 * The box-backed flavor of a DOM element (`element-box`): a plain view, since
 * everything that distinguishes it lives in layout, not in drawing. The
 * renderer swaps an element onto this component when its display generates a
 * box — see ElementBoxShadowNode.h.
 */
@interface EXPElementBoxComponentView : RCTViewComponentView
@end

@implementation EXPElementBoxComponentView

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    _props = ElementBoxShadowNode::defaultSharedProps();
  }
  return self;
}

+ (facebook::react::ComponentDescriptorProvider)componentDescriptorProvider
{
  return facebook::react::concreteComponentDescriptorProvider<facebook::react::ElementBoxComponentDescriptor>();
}

+ (void)load
{
  [[RCTComponentViewFactory currentComponentViewFactory] registerComponentViewClass:self];
}

@end

#ifdef __cplusplus
extern "C" {
#endif

// Can't the import generated Plugin.h because plugins are not in this BUCK target
Class<RCTComponentViewProtocol> RCTViewCls(void);

#ifdef __cplusplus
}
#endif

Class<RCTComponentViewProtocol> RCTViewCls(void)
{
  return RCTViewComponentView.class;
}
