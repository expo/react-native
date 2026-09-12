/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "RCTVirtualViewComponentView.h"

#import <React/RCTAssert.h>
#import <React/RCTConversions.h>
#import <React/RCTScrollViewComponentView.h>
#import <React/RCTScrollableProtocol.h>
#import <React/RCTVirtualViewContainerProtocol.h>
#import <React/RCTVirtualViewContainerState.h>
#import <React/UIView+React.h>
#import <jsi/jsi.h>

#import <react/renderer/components/FBReactNativeSpec/ComponentDescriptors.h>
#import <react/renderer/components/FBReactNativeSpec/EventEmitters.h>
#import <react/renderer/components/FBReactNativeSpec/Props.h>
#import <react/renderer/components/virtualview/VirtualViewComponentDescriptor.h>
#import <react/renderer/components/virtualview/VirtualViewShadowNode.h>

#import "RCTFabricComponentsPlugins.h"
#import "RCTVirtualViewMode.h"
#import "RCTVirtualViewRenderState.h"

using namespace facebook;
using namespace facebook::react;

@interface RCTVirtualViewComponentView () {
  NSString *_virtualViewID;
}

@end

@implementation RCTVirtualViewComponentView {
  /* The frame, remembered where it is set — see `-virtualViewGeometry`. */
  CGRect _lastSetFrame;
  /*
   * The parent, written in `-didMoveToSuperview` — see `-virtualViewGeometry`.
   *
   * `__unsafe_unretained` rather than `__weak`: a weak read goes through the
   * side table under a lock, which is the cost this exists to avoid. It cannot
   * dangle — UIKit removes a view's subviews before deallocating it, and the
   * removal is a `-didMoveToSuperview` with `nil`, which is written here.
   */
  __unsafe_unretained UIView *_lastKnownSuperview;
  id<RCTVirtualViewContainerProtocol> _parentVirtualViewContainer;
  std::optional<RCTVirtualViewMode> _mode;
  RCTVirtualViewRenderState _renderState;
  std::optional<CGRect> _targetRect;
  NSString *_nativeId;
  BOOL _didLayout;
}

#pragma mark - Public API

- (instancetype)initWithFrame:(CGRect)frame
{
  if ((self = [super initWithFrame:frame]) != nil) {
    _props = VirtualViewShadowNode::defaultSharedProps();
    // `-initWithFrame:` does not go through `-setFrame:`, so the remembered
    // frame starts here or it reads zero until the first layout.
    _lastSetFrame = frame;
    _renderState = RCTVirtualViewRenderStateUnknown;
    _virtualViewID = [[NSUUID UUID] UUIDString];
    _didLayout = NO;
  }

  return self;
}

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps
{
  const auto &newViewProps = static_cast<const VirtualViewProps &>(*props);

  if (!_mode.has_value()) {
    _mode = newViewProps.initialHidden ? RCTVirtualViewModeHidden : RCTVirtualViewModeVisible;
  }

  switch (newViewProps.renderState) {
    case 1:
      _renderState = RCTVirtualViewRenderStateRendered;
      break;
    case 2:
      _renderState = RCTVirtualViewRenderStateNone;
      break;
    default:
      _renderState = RCTVirtualViewRenderStateUnknown;
      break;
  }

  const auto &newBaseViewProps = static_cast<const ViewProps &>(*props);
  const auto nativeId = RCTNSStringFromStringNilIfEmpty(newBaseViewProps.nativeId);
  _virtualViewID = nativeId == nil ? _virtualViewID : nativeId;

  [super updateProps:props oldProps:oldProps];
}

/**
 * Static flag that tracks whether accessibility services are being used.
 * When accessibility is detected, virtual views will remain visible even when
 * they would normally be hidden when off-screen, ensuring that accessibility
 * features will work correctly.
 */
static BOOL sIsAccessibilityUsed = NO;

- (NSInteger)accessibilityElementCount
{
  // From empirical testing, method `accessibilityElementCount` is called lazily only
  // when accessibility is used.
  [self _unhideIfNeeded];
  return [super accessibilityElementCount];
}

- (NSArray<id<UIFocusItem>> *)focusItemsInRect:(CGRect)rect
{
  // From empirical testing, method `focusItemsInRect:` is called lazily only
  // when keyboard navigation is used.
  [self _unhideIfNeeded];
  return [super focusItemsInRect:rect];
}

- (NSString *)virtualViewID
{
  // Return a unique identifier for this virtual view
  // Using the tag as a unique identifier since it's already unique per view
  return _virtualViewID;
}

- (void)prepareForRecycle
{
  [super prepareForRecycle];

  [[_parentVirtualViewContainer virtualViewContainerState] remove:self];
  self.hidden = NO;
  _didLayout = NO;
  _mode.reset();
  _targetRect.reset();
  _parentVirtualViewContainer = nil;
}

// Handles case when sibling changes size.
// TODO(T202601695): This doesn't yet handle the case of elements in the ScrollView outside a VirtualColumn changing
// size.
- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics
           oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics
{
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:_layoutMetrics];
  _didLayout = YES;
  [self updateState];
}

- (void)updateState
{
  [[_parentVirtualViewContainer virtualViewContainerState] onChange:self];
}

/**
 * A move is reported even when the window does not change.
 *
 * `-didMoveToWindow` is not called for a view that changes parents inside the
 * same window, and both things this needs — the container it belongs to, and
 * the parent the container measures it against — can change exactly then.
 */
- (void)didMoveToSuperview
{
  [super didMoveToSuperview];
  _lastKnownSuperview = self.superview;
  _parentVirtualViewContainer = [self _getParentVirtualViewContainer];
  if (_parentVirtualViewContainer != nil && self.window != nil && _didLayout) {
    [self updateState];
  }
}

- (void)didMoveToWindow
{
  [super didMoveToWindow];
  // here we will set the pointer to the virtualView container
  // and if there was a layout, update

  _parentVirtualViewContainer = [self _getParentVirtualViewContainer];
  if (_parentVirtualViewContainer != nil && self.window != nil && _didLayout) {
    [self updateState];
  }
}

/**
 * This view's rect in the scroll view's CONTENT coordinates.
 *
 * Arithmetic up the superview chain rather than `-convertRect:toView:`, and the
 * difference is the whole cost of a long list. The container asks every
 * registered `VirtualView` for this on every `scrollViewDidScroll:`, and
 * `-convertRect:toView:` goes through `CALayer`: a shared-ancestor search, a
 * render-tree lock and a 4x4 matrix per view. Sampled on a ten-thousand-row
 * list mid-flick it was 899 of the main thread's 1767 busy samples — more than
 * everything else the app did put together — and all of it inside
 * `CA::Layer::map_geometry`.
 *
 * A frame walk gives the same answer for the case that actually occurs: a row
 * inside a content view inside the scroll view, two or three steps, no
 * transforms. Converting a point out of a view's coordinate space into its
 * superview's is `- bounds.origin + frame.origin`, which is what each step
 * does, and stopping AT the scroll view leaves the rect in its bounds space —
 * content coordinates, which is what the caller compares against
 * `contentOffset`.
 *
 * It falls back to UIKit's own conversion the moment either assumption breaks:
 * a transform anywhere in the chain, or a chain that does not reach the scroll
 * view at all. Both are answers this cannot compute, rather than answers it
 * computes badly.
 */
/*
 * Every way a frame is set, so the remembered one cannot drift from the real
 * one. `-setFrame:` is what layout uses; `-setBounds:` and `-setCenter:` are
 * the other two ways UIKit moves a view, and they are rare enough that reading
 * the frame back is free.
 */
- (void)setFrame:(CGRect)frame
{
  [super setFrame:frame];
  _lastSetFrame = frame;
}

- (void)setBounds:(CGRect)bounds
{
  [super setBounds:bounds];
  _lastSetFrame = self.frame;
}

- (void)setCenter:(CGPoint)center
{
  [super setCenter:center];
  _lastSetFrame = self.frame;
}

- (RCTVirtualViewGeometry)virtualViewGeometry
{
  return (RCTVirtualViewGeometry){.frame = _lastSetFrame, .superview = _lastKnownSuperview};
}

- (CGRect)containerRelativeRect:(UIView *)scrollView
{
  CGRect rect = self.bounds;
  UIView *view = self;
  while (view != nil && view != scrollView) {
    if (!CATransform3DIsIdentity(view.layer.transform)) {
      return [self convertRect:self.bounds toView:scrollView];
    }
    const CGRect frame = view.frame;
    const CGRect bounds = view.bounds;
    rect.origin.x += frame.origin.x - bounds.origin.x;
    rect.origin.y += frame.origin.y - bounds.origin.y;
    view = view.superview;
  }
  if (view == nil) {
    // Not a descendant of the scroll view — which happens while a view is being
    // moved between parents, and is UIKit's question to answer.
    return [self convertRect:self.bounds toView:scrollView];
  }
  return rect;
}

- (void)onModeChange:(RCTVirtualViewMode)newMode targetRect:(CGRect)targetRect thresholdRect:(CGRect)thresholdRect
{
  if (_mode.has_value() && newMode == _mode.value()) {
    return;
  }

  // NOTE: Make sure to keep these props in sync with dispatchSyncModeChange below where we have to explicitly copy
  // all props.
  VirtualViewEventEmitter::OnModeChange event = {
      .mode = (int)newMode,
      .targetRect =
          {.x = targetRect.origin.x,
           .y = targetRect.origin.y,
           .width = targetRect.size.width,
           .height = targetRect.size.height},
      .thresholdRect =
          {.x = thresholdRect.origin.x,
           .y = thresholdRect.origin.y,
           .width = thresholdRect.size.width,
           .height = thresholdRect.size.height},
  };

  const std::optional<RCTVirtualViewMode> oldMode = _mode;
  _mode = newMode;

  switch (newMode) {
    case RCTVirtualViewModeVisible:
      // If the previous mode was hidden, emit a mode change even if `renderState` is rendered,
      // because the hidden mode change is still pending and will eventually be committed. Only
      // skip emitting a mode change if the previous mode was prerender and the result of that
      // event has already been committed.
      if (!oldMode.has_value() || oldMode == RCTVirtualViewModeHidden ||
          _renderState != RCTVirtualViewRenderStateRendered) {
        [self _dispatchSyncModeChange:event];
      }
      break;
    case RCTVirtualViewModePrerender:
      if (!oldMode.has_value() || oldMode != RCTVirtualViewModeVisible) {
        [self _dispatchAsyncModeChange:event];
      }
      break;
    case RCTVirtualViewModeHidden:
      [self _dispatchAsyncModeChange:event];
      break;
  }
}

#pragma mark - Private API

- (void)_unhideIfNeeded
{
  if (!sIsAccessibilityUsed) {
    // accessibility is detected for the first time. Make views visible.
    sIsAccessibilityUsed = YES;
  }

  if (self.hidden) {
    self.hidden = NO;
  }
}

- (id<RCTVirtualViewContainerProtocol>)_getParentVirtualViewContainer
{
  UIView *view = self.superview;
  while (view != nil) {
    if ([view respondsToSelector:@selector(virtualViewContainerState)]) {
      return (id<RCTVirtualViewContainerProtocol>)view;
    }
    view = view.superview;
  }
  return nil;
}

- (void)_dispatchAsyncModeChange:(VirtualViewEventEmitter::OnModeChange &)event
{
  if (!_eventEmitter) {
    return;
  }

  auto &emitter = static_cast<const VirtualViewEventEmitter &>(*_eventEmitter);
  emitter.onModeChange(event);
}

- (void)_dispatchSyncModeChange:(VirtualViewEventEmitter::OnModeChange &)event
{
  if (!_eventEmitter) {
    return;
  }

  auto &emitter = static_cast<const VirtualViewEventEmitter &>(*_eventEmitter);

  // TODO: Move this into a custom event emitter. We had to duplicate the codegen code here from onModeChange in order
  // to dispatch synchronously and discrete.
  emitter.experimental_flushSync([&emitter, &event]() {
    emitter.dispatchEvent(
        "modeChange",
        [event](jsi::Runtime &runtime) {
          auto payload = jsi::Object(runtime);
          payload.setProperty(runtime, "mode", event.mode);
          {
            auto targetRect = jsi::Object(runtime);
            targetRect.setProperty(runtime, "x", event.targetRect.x);
            targetRect.setProperty(runtime, "y", event.targetRect.y);
            targetRect.setProperty(runtime, "width", event.targetRect.width);
            targetRect.setProperty(runtime, "height", event.targetRect.height);
            payload.setProperty(runtime, "targetRect", targetRect);
          }
          {
            auto thresholdRect = jsi::Object(runtime);
            thresholdRect.setProperty(runtime, "x", event.thresholdRect.x);
            thresholdRect.setProperty(runtime, "y", event.thresholdRect.y);
            thresholdRect.setProperty(runtime, "width", event.thresholdRect.width);
            thresholdRect.setProperty(runtime, "height", event.thresholdRect.height);
            payload.setProperty(runtime, "thresholdRect", thresholdRect);
          }
          return payload;
        },
        RawEvent::Category::Discrete);
  });
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<VirtualViewComponentDescriptor>();
}

@end

Class<RCTComponentViewProtocol> VirtualViewCls(void)
{
  return RCTVirtualViewComponentView.class;
}
