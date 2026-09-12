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
   * The mask, kept rather than rebuilt from scratch, so that a layout that does
   * not change the bounds costs nothing.
   */
  CAShapeLayer *_maskLayer;
  /* Last geometry announced to the trace, so only changes are recorded. */
  CGRect _tracedFrame;
  /** The last window position recorded, and when — see the JUMP line below. */
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
   * The view whose lift this balloon shapes, held weakly so that taking the
   * shape back does not depend on still being its subview — a recycled balloon
   * is removed first and `superview` is nil by then.
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
 * Which side the tail is on, resolved against the writing direction.
 *
 * `leading` and `trailing` rather than left and right because a balloon's tail
 * is on the side its message came from, and in a right-to-left layout that is
 * the other side of the screen. Resolved here, where the layout direction is
 * known, rather than by the app — which would have to know it too.
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
 * Mask this view to a balloon outline, or stop doing so.
 *
 * Rebuilt whenever the bounds change, because the path is a function of them and
 * the bounds change on every frame of a send animation.
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
   * Actions off: frames and paths are animatable and this runs during layout, so
   * a balloon that changed size would morph a quarter second behind itself.
   */
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  _maskLayer.frame = bounds;
  _maskLayer.path = EXPChatBubblePath(bounds, _appliedRadius, _appliedTailAmount, [self _tailIsOnRight]).CGPath;
  self.layer.mask = _maskLayer;
  [CATransaction commit];
}

/**
 * Re-apply the mask when the layer is invalidated.
 *
 * `invalidateLayer` nils `self.layer.mask` — the base class owns that property
 * and clears it when it rebuilds the layer's appearance from props, which UIKit
 * asks for on a foreground among other times. Without this the balloons lost
 * their shape on the app's return and came back as plain rectangles, having been
 * masked correctly since launch.
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
  // The reserve arrives here, freshly interpolated on every frame of a layout
  // transition — see `-_tailAmountForInsets:`.
  const CGFloat amount = [self _tailAmountForInsets:layoutMetrics];
  if (amount != _appliedTailAmount) {
    _appliedTailAmount = amount;
    _appliedTail = amount > 0 ? _lastSide : std::string{};
  }
  [self _updateMask];

  /*
   * The balloon's own numbers, for the reports this cannot be settled without.
   *
   * "The bubble grew when it lost its tail" and "the row jumped" are both claims
   * about geometry over time, and reading them off pixels is unreliable — a
   * balloon passing under the translucent header measures short because the blur
   * lightens its top rows, which is exactly how one round of this was misread.
   * So the view says what it is: its own frame and how much tail it is drawing,
   * on the frames where that actually changes.
   *
   * Only while the trace is recording, and only on change, so it costs a
   * comparison in a build nobody is diagnosing. Dumped with everything else by
   * the two-finger double-tap.
   */
  if ([EXPKeyboardTrace isRecording]) {
    const CGRect frame = self.frame;
    if (!CGRectEqualToRect(frame, _tracedFrame) || amount != _tracedTailAmount) {
      // Kept before the overwrite: the jump test below compares this balloon's
      // size against its PREVIOUS one, and reading it after the assignment made
      // every sample look settled.
      const CGRect previousFrame = _tracedFrame;
      _tracedFrame = frame;
      _tracedTailAmount = amount;
      /*
       * In the WINDOW, because that is the position a reader is describing.
       * `self.frame` is inside the balloon's own wrapper and reads ~0 forever,
       * so it can say how tall a balloon is but nothing about the row jumping.
       */
      const CGPoint inWindow = [self convertPoint:CGPointZero toView:nil];
      /*
       * How far this balloon MOVED since its last sample, and whether that was
       * a jump.
       *
       * "The bubbles jump down" is a claim about one row between two frames, and
       * the numbers to test it were all here except the difference — reading a
       * jump off a column of absolute positions means eyeballing subtraction
       * across a thousand lines, which is how it has been missed. A glide moves
       * a fraction of a point per frame; anything past a few points inside one
       * frame interval is the report.
       *
       * Only when the samples are ADJACENT in time: this trace records on
       * change, so two samples either side of a quiet second are not a jump, they
       * are a row that sat still and then moved for a good reason.
       */
      const CFTimeInterval now = CACurrentMediaTime();
      const CGFloat dy = inWindow.y - _tracedWinY;
      const CFTimeInterval since = now - _tracedWinAt;
      const BOOL adjacent = _tracedWinAt > 0 && since < 0.05;
      _tracedWinY = inWindow.y;
      _tracedWinAt = now;
      /*
       * Only a SETTLED balloon can jump.
       *
       * A send flight moves its balloon about seven points a frame by design, so
       * a bare distance threshold flags every send — the first run of this
       * printed twenty-three "jumps", all of them the throw doing its job. What
       * the report describes is a row that is not animating anything of its own
       * being moved by the column underneath it, and the balloon's own size is
       * what tells the two apart: a flight changes width every frame, a settled
       * row does not.
       */
      const BOOL settled = fabs(CGRectGetWidth(frame) - CGRectGetWidth(previousFrame)) < 0.5 &&
          fabs(CGRectGetHeight(frame) - CGRectGetHeight(previousFrame)) < 0.5;
      /*
       * The threshold, overridable with `EXP_JUMP_PT`.
       *
       * Six points is "more than a glide" — a receipt handover moves a settled
       * row thirteen points over a quarter second, which is under a point a
       * frame. The override exists so the detector can be PROVEN to fire:
       * a run at 0.5 must produce lines for that same handover, and a detector
       * that has never been seen to fire is indistinguishable from a bug that
       * never happened. Read once.
       */
      static const CGFloat threshold = [] {
        const char *value = getenv("EXP_JUMP_PT");
        const double parsed = value != nullptr ? atof(value) : 0;
        return parsed > 0 ? (CGFloat)parsed : (CGFloat)6;
      }();
      if (adjacent && settled && fabs(dy) > threshold) {
        [EXPKeyboardTrace record:@"balloon#%lld JUMP dy=%+.1f over %.0fms (winY=%.1f)",
                                 (long long)self.tag, dy, since * 1000.0, inWindow.y];
      }
      /*
       * The BOX's height alongside the surface's, because they answer different
       * questions and the difference is the diagnosis: the surface fills the box
       * unless it was given an explicit height by the send flight. A device trace
       * showed the surface frozen at 47.0 while the tail retracted inside it —
       * either the flight's pin never released, or the box itself stopped
       * shrinking, and only `box` tells them apart.
       */
      /*
       * The TAG, because "the bubbles jump" is a claim about one row over time
       * and this trace could not tell two rows apart. A capture of a send showed
       * a balloon's top moving 4.7pt and there was no way to say whether that
       * was the arriving bubble, the one above it losing its tail, or two
       * different rows sampled alternately. React's tag is stable for the life
       * of the row and is what every other layer already calls it.
       */
      [EXPKeyboardTrace record:@"balloon#%lld winY=%.1f h=%.1f box=%.1f w=%.1f tail=%.2f body=%.1f",
                               (long long)self.tag, inWindow.y, CGRectGetHeight(frame),
                               self.superview == nil ? -1 : CGRectGetHeight(self.superview.bounds),
                               CGRectGetWidth(frame),
                               amount,
                               CGRectGetHeight(frame) -
                                   amount * (CGFloat)facebook::react::kExpoChatBubbleTailDrop];
    }
  }
}

#pragma mark - the peek's shape

/**
 * The balloon does not own the peek; it owns the SHAPE of it.
 *
 * `wantsContextMenu` and the `<menu>` belong to the box — that is what receives
 * the touch and what has to come up with the words inside it — and a box is a
 * rectangle that knows nothing about balloons. So the outline travels the other
 * way: the surface that draws it hands a block up to its superview, and the box
 * gives it to UIKit when the lift begins.
 *
 * Given on being added and taken back on being removed, because the box is
 * recycled and would otherwise lift the next message in this one's shape.
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
 * The lifted outline, in the box's coordinates.
 *
 * Read when UIKit asks — at the moment of the lift — rather than stored,
 * because the balloon's size and its place in the box both change: a send
 * animation resizes it every frame, and a reveal drag slides the whole column.
 */
- (UIBezierPath *)_liftPath
{
  UIView *host = self.superview;
  if (host == nil || CGRectIsEmpty(self.bounds)) {
    return nil;
  }
  UIBezierPath *path =
      EXPChatBubblePath(self.bounds, _appliedRadius, _appliedTailAmount, [self _tailIsOnRight]);
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
 * How much tail this balloon currently has, read out of its own reserve — the
 * MOUNTED reserve, not the declared one.
 *
 * A tail hangs below the body, so a tailed balloon reserves
 * `kExpoChatBubbleTailDrop` of `padding-bottom` for it. That reserve is a
 * TRANSITIONABLE property, so a tail arriving or leaving can be animated by
 * animating the space it needs — and then the outline follows from the box
 * rather than being a second animation kept in step with it.
 *
 * Read from the layout metrics' content insets, because that is where the
 * animation happens. A layout transition commits the author's end value at
 * once and glides the MOUNTED METRICS between the two layouts, so the props
 * hold the destination for the whole flight — deriving from them snapped the
 * tail off on the commit frame while the rows around it were still sliding.
 * The insets are the same quantity after resolution (padding plus border, and
 * a balloon has no border), delivered here freshly interpolated on every
 * frame of the flight.
 *
 * `tailBasePadding` is the element's own padding without the reserve, so the
 * difference between the two is the reserve, and dividing gives the amount.
 */
- (CGFloat)_tailAmountForInsets:(const facebook::react::LayoutMetrics &)layoutMetrics
{
  const CGFloat reserved = (CGFloat)layoutMetrics.contentInsets.bottom -
      (CGFloat)layoutMetrics.borderWidth.bottom - _appliedBasePadding;
  const CGFloat amount = reserved / (CGFloat)facebook::react::kExpoChatBubbleTailDrop;
  return MAX((CGFloat)0, MIN((CGFloat)1, amount));
}

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps
{
  const auto &newProps = static_cast<const ExpoChatBubbleProps &>(*props);
  [super updateProps:props oldProps:oldProps];

  /*
   * The SIDE outlives the prop that carries it, and is remembered SEPARATELY
   * from the side in use.
   *
   * `tail` says which side, and it goes empty the moment a message stops ending
   * its run — while the reserve is still unwinding and there is still a tail to
   * draw. An earlier version held `_appliedTail` instead, which looked
   * equivalent and was not: the moment the prop clears, the side was taken as
   * empty, and every later frame of the leave then had an empty side to hold.
   * `_tailIsOnRight` answers NO to that, and the tail spent the rest of its
   * morph mirrored onto the other side of the balloon. Reported from a device:
   * "the tail jumps sides when disappearing. It must stay on its side."
   *
   * So the last side ASKED FOR is kept in its own field, which no frame of the
   * animation can clear, and it is used whenever there is any tail at all.
   *
   * The AMOUNT is deliberately not read here. Props carry the destination for
   * the whole of a layout transition, so the reserve is read from the mounted
   * metrics in `-updateLayoutMetrics:oldLayoutMetrics:`, where the animated
   * value actually arrives.
   */
  if (!newProps.tail.empty()) {
    _lastSide = newProps.tail;
  }
  _appliedBasePadding = (CGFloat)newProps.tailBasePadding;
  if (_appliedTailAmount > 0 && _appliedTail.empty()) {
    // A reserve already mounted with no side on record — whichever order this
    // mount delivered them in, the side is known now.
    _appliedTail = _lastSide;
  }
  if (newProps.bubbleRadius != _appliedRadius) {
    _appliedRadius = newProps.bubbleRadius;
  }
  [self _updateMask];
}

- (void)prepareForRecycle
{
  [super prepareForRecycle];
  /*
   * The shape is state, and a recycled view arrives with the last balloon's.
   *
   * `_appliedTail` in particular: without clearing it a reused view keeps the
   * previous message's tail until the tail prop happens to differ, so a balloon
   * that should have none has one — which is what a round trip between screens
   * produced.
   */
  _appliedTail.clear();
  // The remembered side too, or a recycled view starts a tailless balloon with
  // the last message's side already in hand.
  _lastSide.clear();
  _appliedTailAmount = 0;
  _appliedRadius = kExpoChatBubbleRadius;
  // The traced geometry is state too: leaving it would compare the next
  // message's frame against the last one's and skip the first line of a report.
  _tracedFrame = CGRectNull;
  _tracedTailAmount = -1;
  self.layer.mask = nil;
  _maskLayer = nil;
  /*
   * The interaction is on a view this one does not own, so leaving it installed
   * would give the NEXT message's box the last one's menu.
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
