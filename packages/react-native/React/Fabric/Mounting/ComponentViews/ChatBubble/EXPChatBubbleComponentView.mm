/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPChatBubbleComponentView.h"

#import <react/renderer/components/view/ExpoChatBubbleShadowNode.h>

#import <React/RCTComponentViewFactory.h>
#import <React/RCTConversions.h>
#import <React/RCTViewComponentView.h>

#import "EXPChatBubblePath.h"
#import "EXPKeyboardTrace.h"

using namespace facebook::react;

@implementation EXPChatBubbleComponentView {
  /*
   * The mask, kept so a layout that does not change the bounds costs nothing.
   */
  CAShapeLayer *_maskLayer;
  /* Last geometry announced to the trace, so only changes are recorded. */
  CGRect _tracedFrame;
  /** The last window position recorded, and when; see the jump line below. */
  /** Samples the flying copy's drawn position; see `-_watchFlierDrawn`. */
  CADisplayLink *_flierWatch;
  CGFloat _flierWatchLastY;
  CGFloat _tracedWinY;
  CFTimeInterval _tracedWinAt;
  CGFloat _tracedTailAmount;
  std::string _appliedTail;
  CGFloat _appliedRadius;
  /* How much tail there is, derived from the mounted reserve — see `_tailAmountForInsets:`. */
  CGFloat _appliedTailAmount;
  CGFloat _appliedBasePadding;
  /* The last side actually asked for, which outlives the prop — see below. */
  std::string _lastSide;

  /*
   * The view whose lift this balloon shapes, held weakly: a recycled balloon is
   * removed first and `superview` is nil by the time the shape is taken back.
   */
  __weak UIView *_peekHost;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    _props = ExpoChatBubbleShadowNode::defaultSharedProps();
    _appliedRadius = kExpoChatBubbleRadius;
    _appliedTailAmount = 0;
    _appliedBasePadding = 0;
    _lastSide = "";
  }
  return self;
}

#pragma mark - the shape

/**
 * Which side the tail is on, resolved against the writing direction here, where
 * the layout direction is known.
 */
- (BOOL)_tailIsOnRight
{
  const BOOL rtl = _layoutMetrics.layoutDirection == LayoutDirection::RightToLeft;
  if (_appliedTail == "trailing") {
    return !rtl;
  }
  return rtl;
}

/**
 * Masks this view to a balloon outline, or stops. Rebuilt whenever the bounds
 * change, which is every frame of a send animation.
 */
- (void)_updateMask
{
  const CGRect bounds = self.bounds;
  if (CGRectIsEmpty(bounds)) {
    return;
  }
  if (_maskLayer == nil) {
    _maskLayer = [CAShapeLayer layer];
    _maskLayer.fillColor = UIColor.blackColor.CGColor;
  }
  /*
   * Actions off: frames and paths are animatable and this runs during layout.
   */
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  _maskLayer.frame = bounds;
  _maskLayer.path = EXPChatBubblePath(bounds, _appliedRadius, _appliedTailAmount, [self _tailIsOnRight]).CGPath;
  self.layer.mask = _maskLayer;
  [CATransaction commit];
}

/**
 * Re-applies the mask when the layer is invalidated: `invalidateLayer` nils
 * `self.layer.mask` when it rebuilds the layer's appearance from props, which
 * UIKit asks for on a foreground among other times.
 */
- (void)invalidateLayer
{
  [super invalidateLayer];
  [self _updateMask];
}

- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics
           oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics
{
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];
  // The reserve arrives here, interpolated on every frame of a layout
  // transition; see `-_tailAmountForInsets:`
  const CGFloat amount = [self _tailAmountForInsets:layoutMetrics];
  if (amount != _appliedTailAmount) {
    _appliedTailAmount = amount;
    _appliedTail = amount > 0 ? _lastSide : std::string{};
  }
  [self _updateMask];

  /*
   * The balloon's own frame and tail amount, on the frames where they change,
   * since geometry over time cannot be read reliably off pixels (a balloon under
   * the translucent header measures short). Only while the trace is recording.
   */
  if ([EXPKeyboardTrace isRecording]) {
    const CGRect frame = self.frame;
    if (!CGRectEqualToRect(frame, _tracedFrame) || amount != _tracedTailAmount) {
      // Kept before the overwrite: the jump test compares against the previous
      // size
      const CGRect previousFrame = _tracedFrame;
      _tracedFrame = frame;
      _tracedTailAmount = amount;
      /*
       * In the window, the position a reader describes; `self.frame` is inside the
       * balloon's own wrapper and reads ~0.
       */
      const CGPoint inWindow = [self convertPoint:CGPointZero toView:nil];
      /*
       * How far this balloon moved since its last sample, and whether that was a
       * jump: a glide moves a fraction of a point per frame, anything past a few
       * points inside one frame interval is a jump. Only when the samples are
       * adjacent in time, since the trace records on change.
       */
      const CFTimeInterval now = CACurrentMediaTime();
      const CGFloat dy = inWindow.y - _tracedWinY;
      const CFTimeInterval since = now - _tracedWinAt;
      const BOOL adjacent = _tracedWinAt > 0 && since < 0.05;
      _tracedWinY = inWindow.y;
      _tracedWinAt = now;
      /*
       * Only a settled balloon can jump: a send flight moves its balloon seven
       * points a frame by design and changes width every frame, a settled row does
       * not.
       */
      const BOOL settled = fabs(CGRectGetWidth(frame) - CGRectGetWidth(previousFrame)) < 0.5 &&
          fabs(CGRectGetHeight(frame) - CGRectGetHeight(previousFrame)) < 0.5;
      /*
       * The threshold, overridable with `EXP_JUMP_PT`: six points is more than a
       * glide (a receipt handover moves a settled row under a point a frame). The
       * override lets the detector be proven to fire. Read once.
       */
      static const CGFloat threshold = [] {
        const char *value = getenv("EXP_JUMP_PT");
        const double parsed = value != nullptr ? atof(value) : 0;
        return parsed > 0 ? (CGFloat)parsed : (CGFloat)6;
      }();
      if (adjacent && settled && fabs(dy) > threshold) {
        [EXPKeyboardTrace record:@"balloon#%lld JUMP dy=%+.1f over %.0fms (winY=%.1f)",
                                 (long long)self.tag,
                                 dy,
                                 since * 1000.0,
                                 inWindow.y];
      }
      /*
       * The box's height alongside the surface's: the surface fills the box unless
       * the send flight gave it an explicit height, and only `box` tells a pinned
       * surface from a box that stopped shrinking.
       */
      /*
       * The tag, so two rows sampled alternately can be told apart; React's tag is
       * stable for the life of the row.
       */
      [EXPKeyboardTrace record:@"balloon#%lld winY=%.1f h=%.1f box=%.1f w=%.1f tail=%.2f body=%.1f",
                               (long long)self.tag,
                               inWindow.y,
                               CGRectGetHeight(frame),
                               self.superview == nil ? -1 : CGRectGetHeight(self.superview.bounds),
                               CGRectGetWidth(frame),
                               amount,
                               CGRectGetHeight(frame) - amount * (CGFloat)facebook::react::kExpoChatBubbleTailDrop];
    }
  }
}

#pragma mark - the peek's shape

/**
 * The balloon owns the shape of the peek, not the peek: `wantsContextMenu` and
 * the `<menu>` belong to the box, which receives the touch, so the surface
 * hands its outline up to its superview for the lift. Given on being added and
 * taken back on being removed, since the box is recycled.
 */
- (void)_updatePeekShape
{
  UIView *host = self.superview;
  if (host == _peekHost) {
    return;
  }
  if ([_peekHost respondsToSelector:@selector(exp_setPeekShapeProvider:)]) {
    [(RCTViewComponentView *)_peekHost exp_setPeekShapeProvider:nil];
  }
  _peekHost = host;
  if ([host respondsToSelector:@selector(exp_setPeekShapeProvider:)]) {
    __weak __typeof(self) weakSelf = self;
    [(RCTViewComponentView *)host exp_setPeekShapeProvider:^UIBezierPath *_Nullable {
      return [weakSelf _liftPath];
    }];
  }
}

/**
 * The lifted outline in the box's coordinates, read when UIKit asks rather than
 * stored, since a send animation resizes the balloon every frame and a reveal
 * drag slides the column.
 */
- (UIBezierPath *)_liftPath
{
  UIView *host = self.superview;
  if (host == nil || CGRectIsEmpty(self.bounds)) {
    return nil;
  }
  UIBezierPath *path = EXPChatBubblePath(self.bounds, _appliedRadius, _appliedTailAmount, [self _tailIsOnRight]);
  const CGPoint origin = [self convertPoint:CGPointZero toView:host];
  [path applyTransform:CGAffineTransformMakeTranslation(origin.x, origin.y)];
  return path;
}

- (void)didMoveToSuperview
{
  [super didMoveToSuperview];
  [self _updatePeekShape];
}

#pragma mark - RCTComponentViewProtocol

/**
 * How much tail this balloon currently has, read out of the mounted reserve. A
 * tailed balloon reserves `kExpoChatBubbleTailDrop` of `padding-bottom`, a
 * transitionable property, so a tail arriving or leaving is animated by
 * animating the space it needs and the outline follows from the box. Read from
 * the layout metrics' content insets because a layout transition commits the
 * author's end value at once and glides the mounted metrics, so the props hold
 * the destination for the whole flight; the insets are padding plus border, and
 * a balloon has no border. `tailBasePadding` is the padding without the
 * reserve, so the difference is the reserve.
 */
- (CGFloat)_tailAmountForInsets:(const facebook::react::LayoutMetrics &)layoutMetrics
{
  const CGFloat reserved =
      (CGFloat)layoutMetrics.contentInsets.bottom - (CGFloat)layoutMetrics.borderWidth.bottom - _appliedBasePadding;
  const CGFloat amount = reserved / (CGFloat)facebook::react::kExpoChatBubbleTailDrop;
  return MAX((CGFloat)0, MIN((CGFloat)1, amount));
}

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps
{
  const auto &newProps = static_cast<const ExpoChatBubbleProps &>(*props);
  [super updateProps:props oldProps:oldProps];

  /*
   * The side outlives the prop that carries it: `tail` goes empty the moment a
   * message stops ending its run, while the reserve is still unwinding and there
   * is still a tail to draw, so the last side asked for is kept in a field no
   * frame of the animation clears. The amount is not read here, since props carry
   * the destination for the whole transition; see
   * `-updateLayoutMetrics:oldLayoutMetrics:`.
   */
  if (!newProps.tail.empty()) {
    _lastSide = newProps.tail;
  }
  _appliedBasePadding = (CGFloat)newProps.tailBasePadding;
  if (_appliedTailAmount > 0 && _appliedTail.empty()) {
    // A reserve already mounted with no side on record: the side is known now
    _appliedTail = _lastSide;
  }
  if (newProps.bubbleRadius != _appliedRadius) {
    _appliedRadius = newProps.bubbleRadius;
  }
  [self _updateMask];
}

/**
 * Where this balloon was when it left the window. A send's flying copy is moved
 * by a transform and stops changing its box before it is taken away, so the
 * position that matters for the handover had no frame line; the row's
 * `balloon shown` is the other half.
 */
/**
 * What a send's flying copy is drawn at, frame by frame: the copy is hidden the
 * instant it hands its message to the row and rides the keyboard's bar in
 * between, so the presentation layer sampled while it flies is the position a
 * reader last saw. Only the copy (the app names it `flier`), only while the
 * trace is recording, only when it moves.
 */
- (void)_watchFlierDrawn
{
  if (_flierWatch != nil || ![EXPKeyboardTrace isRecording] || ![self.nativeId isEqualToString:@"flier"]) {
    return;
  }
  _flierWatchLastY = CGFLOAT_MAX;
  _flierWatch = [CADisplayLink displayLinkWithTarget:self selector:@selector(_flierWatchTick)];
  /*
   * At the screen's own rate: a display link left to itself runs at 60 where the
   * app is allowed 120, and a stutter between two unsampled frames cannot appear
   * in the numbers. The same range as the keyboard's and the rise's sampler.
   */
  const float maximum = (float)(self.window.screen ?: UIScreen.mainScreen).maximumFramesPerSecond;
  if (maximum > 0) {
    _flierWatch.preferredFrameRateRange = CAFrameRateRangeMake(maximum, maximum, maximum);
  }
  [_flierWatch addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];
}

- (void)_flierWatchTick
{
  UIWindow *window = self.window;
  if (window == nil) {
    [_flierWatch invalidate];
    _flierWatch = nil;
    return;
  }
  CALayer *drawn = self.layer.presentationLayer ?: self.layer;
  const CGFloat y = CGRectGetMinY([drawn convertRect:drawn.bounds toLayer:window.layer]);
  if (_flierWatchLastY == CGFLOAT_MAX || fabs(y - _flierWatchLastY) > 0.01) {
    [EXPKeyboardTrace record:@"flier drawn at %.2f", y];
    _flierWatchLastY = y;
  }
}

- (void)willMoveToWindow:(UIWindow *)newWindow
{
  [super willMoveToWindow:newWindow];
  if (newWindow != nil) {
    [self _watchFlierDrawn];
  }
  if (newWindow == nil && self.window != nil && [EXPKeyboardTrace isRecording]) {
    const CGPoint inWindow = [self convertPoint:CGPointZero toView:nil];
    // With its `nativeID`: every balloon leaving the window writes this line,
    // and only the send's flying copy, which the app names `flier`, is the
    // handover
    [EXPKeyboardTrace record:@"balloon#%lld gone%@ winY=%.1f h=%.1f w=%.1f",
                             (long long)self.tag,
                             self.nativeId.length > 0 ? [NSString stringWithFormat:@"[%@]", self.nativeId] : @"",
                             inWindow.y,
                             CGRectGetHeight(self.frame),
                             CGRectGetWidth(self.frame)];
  }
}

- (void)prepareForRecycle
{
  [super prepareForRecycle];
  [_flierWatch invalidate];
  _flierWatch = nil;
  /*
   * The shape is state: without clearing `_appliedTail` a reused view keeps the
   * previous message's tail until the prop happens to differ.
   */
  _appliedTail.clear();
  // The remembered side too
  _lastSide.clear();
  _appliedTailAmount = 0;
  _appliedRadius = kExpoChatBubbleRadius;
  // The traced geometry too, or the next message compares against the last
  _tracedFrame = CGRectNull;
  _tracedTailAmount = -1;
  self.layer.mask = nil;
  _maskLayer = nil;
  /*
   * The interaction is on a view this one does not own; left installed it would
   * give the next message's box this one's menu.
   */
  if ([_peekHost respondsToSelector:@selector(exp_setPeekShapeProvider:)]) {
    [(RCTViewComponentView *)_peekHost exp_setPeekShapeProvider:nil];
  }
  _peekHost = nil;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<ExpoChatBubbleComponentDescriptor>();
}

+ (void)load
{
  [[RCTComponentViewFactory currentComponentViewFactory] registerComponentViewClass:self];
}

@end
