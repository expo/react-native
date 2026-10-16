/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPTopLayerComponentView.h"

#import <React/RCTComponentViewFactory.h>
#import <React/RCTSurfaceTouchHandler.h>
#import <react/renderer/components/view/ExpoTopLayerShadowNode.h>

using namespace facebook::react;

@class EXPTopLayerOverlayView;

@interface EXPTopLayerComponentView ()
- (void)_outsidePressBeganAt:(CGPoint)point;
@end

/**
 * The container at the handle's origin. It is empty of size, as the handle is,
 * and its children lie outside it, where UIKit's hit-testing never looks: a
 * touch is offered to each child instead, topmost first.
 */
@interface EXPTopLayerContainerView : UIView
@end

@implementation EXPTopLayerContainerView

- (UIView *)hitTest:(CGPoint)point withEvent:(UIEvent *)event
{
  for (UIView *subview in [self.subviews reverseObjectEnumerator]) {
    if (subview.hidden || subview.alpha < 0.01 || !subview.userInteractionEnabled) {
      continue;
    }
    UIView *hit = [subview hitTest:[self convertPoint:point toView:subview] withEvent:event];
    if (hit != nil) {
      return hit;
    }
  }
  return nil;
}

@end

/**
 * The overlay on the window: as large as the window and transparent to every
 * touch that does not land on what it holds. Its one subview, the container,
 * sits at the handle's origin, so the children keep the frames layout gave them
 * relative to the handle.
 */
@interface EXPTopLayerOverlayView : UIView
@property (nonatomic, weak) EXPTopLayerComponentView *owner;
@property (nonatomic, readonly) UIView *container;
@end

@implementation EXPTopLayerOverlayView {
  // The touch whose outside press was last reported: UIKit hit-tests one touch
  // more than once
  NSTimeInterval _reportedTimestamp;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    self.backgroundColor = UIColor.clearColor;
    _container = [[EXPTopLayerContainerView alloc] initWithFrame:CGRectZero];
    _container.clipsToBounds = NO;
    [self addSubview:_container];
  }
  return self;
}

- (UIView *)hitTest:(CGPoint)point withEvent:(UIEvent *)event
{
  UIView *hit = [super hitTest:point withEvent:event];
  if (hit != nil && hit != self && hit != _container) {
    return hit;
  }
  // Outside everything in the layer: the touch goes on to whatever is under
  // it, and a touch that is beginning light-dismisses
  if (event.type == UIEventTypeTouches && event.timestamp != _reportedTimestamp) {
    _reportedTimestamp = event.timestamp;
    [self.owner _outsidePressBeganAt:point];
  }
  return nil;
}

@end

@implementation EXPTopLayerComponentView {
  EXPTopLayerOverlayView *_overlay;
  // Its own touch handler: the overlay is outside the surface's hierarchy
  RCTSurfaceTouchHandler *_touchHandler;
  // Keeps the container at the handle's place in the window while the layer is
  // up, so the layer moves with the page under it as an anchored popover does
  CADisplayLink *_displayLink;
  BOOL _active;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<ExpoTopLayerComponentDescriptor>();
}

+ (void)load
{
  [[RCTComponentViewFactory currentComponentViewFactory] registerComponentViewClass:self];
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    static const auto defaultProps = std::make_shared<const ExpoTopLayerProps>();
    _props = defaultProps;
    _overlay = [[EXPTopLayerOverlayView alloc] initWithFrame:CGRectZero];
    _overlay.owner = self;
    _touchHandler = [RCTSurfaceTouchHandler new];
    [_touchHandler attachToView:_overlay];
  }
  return self;
}

// React's children go into the overlay's container; this view is an empty
// handle. Unmount is overridden too, since the base class asserts the child's
// superview is this view.
- (void)mountChildComponentView:(UIView<RCTComponentViewProtocol> *)childComponentView index:(NSInteger)index
{
  [_overlay.container insertSubview:childComponentView atIndex:index];
}

- (void)unmountChildComponentView:(UIView<RCTComponentViewProtocol> *)childComponentView index:(NSInteger)index
{
  [childComponentView removeFromSuperview];
}

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps
{
  const auto &newProps = static_cast<const ExpoTopLayerProps &>(*props);
  _active = newProps.active;
  [super updateProps:props oldProps:oldProps];
  [self _updateOverlay];
}

- (void)didMoveToWindow
{
  [super didMoveToWindow];
  [self _updateOverlay];
}

// Up while the layer is active and the handle is on screen: the overlay last on
// the window, so above everything there and above every layer already up, as
// the top layer is a stack; down otherwise, with no display link running
- (void)_updateOverlay
{
  UIWindow *window = self.window;
  if (!_active || window == nil) {
    [_displayLink invalidate];
    _displayLink = nil;
    [_overlay removeFromSuperview];
    return;
  }
  if (_overlay.superview != window) {
    [window addSubview:_overlay];
  }
  [self _followHandle];
  if (_displayLink == nil) {
    _displayLink = [CADisplayLink displayLinkWithTarget:self selector:@selector(_followHandle)];
    [_displayLink addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];
  }
}

- (void)_followHandle
{
  UIWindow *window = self.window;
  if (window == nil) {
    return;
  }
  if (!CGRectEqualToRect(_overlay.frame, window.bounds)) {
    _overlay.frame = window.bounds;
  }
  const CGPoint origin = [self convertPoint:CGPointZero toView:window];
  if (!CGPointEqualToPoint(_overlay.container.frame.origin, origin)) {
    _overlay.container.frame = CGRectMake(origin.x, origin.y, 0, 0);
  }
}

- (void)_outsidePressBeganAt:(CGPoint)point
{
  if (const auto emitter = std::static_pointer_cast<const ExpoTopLayerEventEmitter>(_eventEmitter)) {
    // The overlay covers the window from its origin, so its point is the
    // window's
    emitter->onOutsidePress(point.x, point.y);
  }
}

- (void)prepareForRecycle
{
  [super prepareForRecycle];
  _active = NO;
  [self _updateOverlay];
}

- (void)dealloc
{
  [_displayLink invalidate];
  [_overlay removeFromSuperview];
}

@end
