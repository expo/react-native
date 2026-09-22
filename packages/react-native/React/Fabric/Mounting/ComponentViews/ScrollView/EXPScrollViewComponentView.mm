/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPScrollViewComponentView.h"

#import <cmath>
#import <vector>

#import "../View/EXPKeyboardTrace.h"

#import <React/RCTConversions.h>
#import <React/RCTRenderStats.h>
#import <react/renderer/components/view/ExpoScrollViewShadowNode.h>
#import <react/renderer/components/view/TransitionPrimitives.h>

#import <React/EXPElementDragOwnership.h>
#import <React/RCTGenericDelegateSplitter.h>
#import "EXPKeyboardInsets.h"
#import "RCTComponentViewFactory.h"
#import "RCTVirtualViewContainerState.h"

using namespace facebook::react;

#pragma mark - The scroll view itself

static void EXPApplyEdgeEffect(UIScrollEdgeEffect *effect, ExpoScrollEdgeEffect wanted) API_AVAILABLE(ios(26.0))
{
  effect.hidden = wanted == ExpoScrollEdgeEffect::Hidden;
  switch (wanted) {
    case ExpoScrollEdgeEffect::Soft:
      effect.style = UIScrollEdgeEffectStyle.softStyle;
      break;
    case ExpoScrollEdgeEffect::Hard:
      effect.style = UIScrollEdgeEffectStyle.hardStyle;
      break;
    case ExpoScrollEdgeEffect::Automatic:
    case ExpoScrollEdgeEffect::Hidden:
      effect.style = UIScrollEdgeEffectStyle.automaticStyle;
      break;
  }
}

/**
 * A `UIScrollView` that lets a control inside it own a drag, and that more than
 * one delegate can listen to.
 *
 * `-touchesShouldCancelInContentView:` follows UIKit's own rule rather than
 * React Native's blanket YES: a control whose gesture is a drag answers for
 * itself through `EXPElementDragOwnership`. The delegate is a splitter, as in
 * `RCTEnhancedScrollView`, because a `VirtualView`'s container state needs to
 * hear about scrolling long after the component view set itself as delegate;
 * overriding `delegate` keeps the ordinary assignment working.
 */
@interface EXPScrollViewInner : UIScrollView

@property (nonatomic, strong, readonly) RCTGenericDelegateSplitter<id<UIScrollViewDelegate>> *delegateSplitter;

/**
 * Runs `block` with UIKit's own writes to the offset ignored.
 *
 * `setContentSize:` and `setContentInset:` re-derive the offset from the new
 * geometry and deliver `scrollViewDidScroll:` to every delegate for it before
 * this view has decided what the change means. Undoing the write afterwards
 * is too late, so it is never made: the decision that follows is the only
 * thing that moves the offset.
 */
- (void)holdOffsetWhile:(void(NS_NOESCAPE ^)(void))block;

@end

@implementation EXPScrollViewInner {
  __weak id<UIScrollViewDelegate> _publicDelegate;
  BOOL _holdingOffset;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    __weak __typeof(self) weakSelf = self;
    _delegateSplitter = [[RCTGenericDelegateSplitter alloc] initWithDelegateUpdateBlock:^(id delegate) {
      [weakSelf setPrivateDelegate:delegate];
    }];
  }
  return self;
}

- (void)holdOffsetWhile:(void(NS_NOESCAPE ^)(void))block
{
  _holdingOffset = YES;
  block();
  _holdingOffset = NO;
}

- (void)setContentOffset:(CGPoint)contentOffset
{
  if (_holdingOffset) {
    if (fabs(contentOffset.y - self.contentOffset.y) > 0.05) {
      [EXPKeyboardTrace record:@"held %.1f (uikit wanted %.1f)", self.contentOffset.y, contentOffset.y];
    }
    return;
  }
  [super setContentOffset:contentOffset];
}

- (BOOL)touchesShouldCancelInContentView:(UIView *)view
{
  for (UIView *candidate = view; candidate != nil && candidate != self; candidate = candidate.superview) {
    if ([candidate conformsToProtocol:@protocol(EXPElementDragOwnership)] &&
        [(id<EXPElementDragOwnership>)candidate elementOwnsDragGesture]) {
      return NO;
    }
  }
  return [super touchesShouldCancelInContentView:view];
}

#pragma mark - The delegate, which is a splitter

- (void)setPrivateDelegate:(nullable id<UIScrollViewDelegate>)delegate
{
  [super setDelegate:delegate];
}

- (nullable id<UIScrollViewDelegate>)delegate
{
  return _publicDelegate;
}

- (void)setDelegate:(nullable id<UIScrollViewDelegate>)delegate
{
  if (_publicDelegate == delegate) {
    return;
  }
  if (_publicDelegate != nil) {
    [_delegateSplitter removeDelegate:_publicDelegate];
  }
  // KVO around the change, because `delegate` is a documented observable property
  [self willChangeValueForKey:@"delegate"];
  _publicDelegate = delegate;
  [self didChangeValueForKey:@"delegate"];
  if (_publicDelegate != nil) {
    [_delegateSplitter addDelegate:_publicDelegate];
  }
}

/*
 * Empty on purpose: `UIScrollView` caches which optional delegate methods exist
 * when the delegate is set, so the splitter must answer `scrollViewDidScroll:`
 * or no listener behind it ever hears it.
 */
- (void)scrollViewDidScroll:(__unused UIScrollView *)scrollView
{
}

@end

#pragma mark - The component view

@interface EXPScrollViewComponentView () <UIScrollViewDelegate, EXPKeyboardInsetObserving>
@end

@implementation EXPScrollViewComponentView {
  // Set while UIKit owns the offset for a status-bar scroll-to-top
  BOOL _scrollingToTop;
  EXPScrollViewInner *_scrollView;
  UIView *_containerView;
  // The author's dismiss mode, which the keyboard's window can override
  ExpoScrollKeyboardDismissMode _appliedDismissMode;
  ExpoScrollViewShadowNode::ConcreteState::Shared _state;
  CGSize _contentSize;
  // The last offset written to the trace, so only real movement is recorded
  CGFloat _tracedOffsetY;
  // The offset last told to the tree, and the shift last told to JS; the first
  // against the live offset is `-_contentShift`, the second is so news is sent once
  CGPoint _reportedOffset;
  CGPoint _emittedShift;

  // The keyboard's claim on the bottom edge, in points, as of its last frame
  CGFloat _keyboardInset;

  // The insets last written, so an unchanged composition costs nothing
  UIEdgeInsets _appliedInset;

  // Whether the view was at the end when the content last changed size. Sampled
  // before the new size is adopted; afterwards every position reads as not at the end.
  BOOL _wasAtBottom;
  // Offset writes since this mounting transaction began, see `_writeOffset:`
  NSUInteger _offsetWritesThisTransaction;
  CFTimeInterval _transactionStartedAt;
  // Watches where the last row is drawn, frame by frame, see `-_watchLastRowDrawn`
  CADisplayLink *_drawnWatch;
  CGFloat _drawnWatchLastY;
  NSUInteger _drawnWatchTicks;
  BOOL _transactionIsOpen;
  // The end intent, held while a transaction is open, see `_settleEndIfWanted`
  BOOL _endWanted;
  BOOL _endWantedAnimated;
  NSString *_endWantedBy;
  // Every row's height at the last content-size change, see `updateState`
  std::vector<CGFloat> _rowHeights;
  NSUInteger _tailRowCount;

  // Set while an animated scroll to the newest content is in flight. It counts as
  // being at the bottom, or a send during a keyboard rise loses the anchor: the
  // scroll aims at the end as it was, the inset grows under it, and mid-animation
  // the view reads as not at the end.
  BOOL _scrollingToLatest;

  // The rise, which keeps its own start, target and clock so the target can move
  // while it runs. `-[UIScrollView setContentOffset:animated:]` fixes its target
  // when called and restarts from a standstill when called again, which stutters
  // once and, under a `height` transition, never gets past its first frame.
  CADisplayLink *_riseLink;
  CGFloat _riseFrom;
  CGFloat _riseTarget;
  CFTimeInterval _riseStart;

  __weak EXPKeyboardInsets *_observedKeyboardInsets;

  // Whether this view holds the sampler open; balanced so a drag interrupted by
  // leaving the window cannot leave it running
  BOOL _holdsKeyboardTracking;
  // The editing field inside this view, from the notification, so no frame walks the tree
  __weak UIView *_focusedDescendant;

  // Built on demand, only if something inside asks to be virtualized
  RCTVirtualViewContainerState *_virtualViewContainerState;

  // The first row on screen when the current mounting transaction began, and
  // where it was, see `-mountingTransactionWillMount:`
  __weak UIView *_firstVisibleView;
  CGRect _firstVisibleFrameBefore;
  NSInteger _firstVisibleTag;
  // Set when this transaction has already moved the offset to the end itself
  BOOL _followedEndInTransaction;
  // Content grew while the reader was at the end and the transaction has not
  // mounted yet; growth above the viewport holds, growth at the end follows
  BOOL _followEndAfterMount;
  // Following the drawn end through an animated content change, see
  // `-_followDrawnEnd`; cleared when the drawn end reaches the laid-out one,
  // when a rise takes over, or when a finger does
  BOOL _followingDrawnEnd;
  // This view's own box changed size in the transaction being mounted. After a
  // rotation no row is where it was, so no row can be the reader's anchor.
  BOOL _boundsResized;
  CGSize _lastBoundsSize;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    static const auto defaultProps = std::make_shared<const ExpoScrollViewProps>();
    _props = defaultProps;

    _scrollView = [[EXPScrollViewInner alloc] initWithFrame:self.bounds];
    _scrollView.delegate = self;
    // The safe area is composed per edge by `-_composedInset`; UIKit has no mode
    // for "the top but not the bottom", so `contentInset` is the whole story here
    _scrollView.contentInsetAdjustmentBehavior = UIScrollViewContentInsetAdjustmentNever;
    // `-_applyIndicatorInsets` composes the safe area itself; left on, UIKit adds
    // it a second time and the indicator sits a safe area below its content
    _scrollView.automaticallyAdjustsScrollIndicatorInsets = NO;
    // The platform default, not React Native's: without it a press over a control
    // is delivered at touch-down and cancelled when the pan wins
    _scrollView.delaysContentTouches = YES;
    _scrollView.keyboardDismissMode = UIScrollViewKeyboardDismissModeInteractive;
    // Pan vertically even when the content fits, as every native list does. It is
    // also what drives interactive keyboard dismissal on a short screen, since that
    // dismissal rides this scroll view's own pan.
    _scrollView.alwaysBounceVertical = YES;
    // UIScrollView's default, stated because this element promises it. UIKit
    // honours it only when exactly one scroll view in the window claims it.
    _scrollView.scrollsToTop = YES;
    [self addSubview:_scrollView];

    _containerView = [[UIView alloc] initWithFrame:CGRectZero];
    [_scrollView addSubview:_containerView];

    _appliedInset = UIEdgeInsetsZero;

    // The end of editing is heard as well as the beginning, because whose keyboard
    // it is decides whether this list may dismiss it, see `-_applyKeyboardDismissMode`
    for (NSNotificationName name in @[
           UITextFieldTextDidBeginEditingNotification,
           UITextViewTextDidBeginEditingNotification,
           UITextFieldTextDidEndEditingNotification,
           UITextViewTextDidEndEditingNotification
         ]) {
      [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(_focusDidMove:) name:name object:nil];
    }
  }
  return self;
}

- (void)dealloc
{
  [[NSNotificationCenter defaultCenter] removeObserver:self];
  // A `CADisplayLink` retains its target; the window exit invalidates it and this
  // is the backstop
  [_riseLink invalidate];
  _riseLink = nil;
  // A `UIScrollView` deallocating with a stale delegate crashes, as in `RCTScrollViewComponentView`
  [self.scrollViewDelegateSplitter removeAllDelegates];
}

#pragma mark - Listening to the scroll

- (RCTGenericDelegateSplitter<id<UIScrollViewDelegate>> *)scrollViewDelegateSplitter
{
  return ((EXPScrollViewInner *)_scrollView).delegateSplitter;
}

- (void)addScrollListener:(NSObject<UIScrollViewDelegate> *)scrollListener
{
  [self.scrollViewDelegateSplitter addDelegate:scrollListener];
}

- (void)removeScrollListener:(NSObject<UIScrollViewDelegate> *)scrollListener
{
  [self.scrollViewDelegateSplitter removeDelegate:scrollListener];
}

#pragma mark - Keeping the reader still

/**
 * Holds the content still across a commit, not the offset.
 *
 * Anything that changes the content above the viewport moves what the reader is
 * looking at by that much. As with `maintainVisibleContentPosition`, the
 * partially visible row nearest the anchored end is remembered with its frame,
 * found again once the transaction has mounted, and the offset moved by however
 * far it travelled. Unconditional for both anchors; React Native gates the same
 * mechanism behind a prop.
 */
- (void)mountingTransactionWillMount:(const facebook::react::MountingTransaction &)transaction
                withSurfaceTelemetry:(const facebook::react::SurfaceTelemetry &)surfaceTelemetry
{
  _offsetWritesThisTransaction = 0;
  _transactionIsOpen = YES;
  _transactionStartedAt = CACurrentMediaTime();
  _firstVisibleView = nil;
  _firstVisibleFrameBefore = CGRectZero;
  _firstVisibleTag = 0;
  _followedEndInTransaction = NO;
  _followEndAfterMount = NO;

  // The rows are the subviews of the single content container `<native:scroll>`
  // mounts, one level below this view's own subviews
  UIView *content = _containerView.subviews.firstObject;
  if (content == nil) {
    return;
  }

  /*
   * A top-anchored list holds the first visible row; a bottom-anchored one must
   * hold the last, because the churn happens above the newest message and a row
   * pinned above the churn reads a delta of zero while everything below it moves.
   */
  const auto &anchorProps = static_cast<const ExpoScrollViewProps &>(*_props);
  const BOOL bottomAnchored = anchorProps.contentAnchor == ExpoScrollContentAnchor::Bottom;

  if (bottomAnchored) {
    // The last row whose top is above the visible bottom, which excludes the
    // bottom inset: a row hidden behind the bar is not what the reader is watching
    const CGFloat visibleBottom =
        _scrollView.contentOffset.y + _scrollView.bounds.size.height - _scrollView.adjustedContentInset.bottom;
    for (UIView *row in content.subviews.reverseObjectEnumerator) {
      if (CGRectGetMinY([self _rowFrame:row]) < visibleBottom) {
        _firstVisibleView = row;
        _firstVisibleFrameBefore = [self _rowFrame:row];
        _firstVisibleTag = row.tag;
        return;
      }
    }
    // Everything is below the viewport; the first row is the nearest thing to an anchor
    UIView *first = content.subviews.firstObject;
    if (first != nil) {
      _firstVisibleView = first;
      _firstVisibleFrameBefore = [self _rowFrame:first];
      _firstVisibleTag = first.tag;
    }
    return;
  }

  // The first row whose bottom is past the top of the viewport, not the first
  // fully visible one: a half-visible row resizing would otherwise go unnoticed
  const CGFloat top = _scrollView.contentOffset.y;
  for (UIView *row in content.subviews) {
    if (CGRectGetMaxY([self _rowFrame:row]) > top) {
      _firstVisibleView = row;
      _firstVisibleFrameBefore = [self _rowFrame:row];
      _firstVisibleTag = row.tag;
      return;
    }
  }
  // Everything is above the viewport; the last row is the nearest thing to an anchor
  UIView *last = content.subviews.lastObject;
  if (last != nil) {
    _firstVisibleView = last;
    _firstVisibleFrameBefore = [self _rowFrame:last];
    _firstVisibleTag = last.tag;
  }
}

// A row's frame in the scroll view's space, which is the offset's space; the
// content container can move too, so a delta taken in its space misses that
- (CGRect)_rowFrame:(UIView *)row
{
  return [row.superview convertRect:row.frame toView:_scrollView];
}

/**
 * Where the end intent is evaluated, see `-_scrollToBottomAnimated:reason:`.
 * A wrapper because the body has several early returns, each of which may have
 * asked for the end.
 */
- (void)mountingTransactionDidMount:(const facebook::react::MountingTransaction &)transaction
               withSurfaceTelemetry:(const facebook::react::SurfaceTelemetry &)surfaceTelemetry
{
  [self _mountingTransactionDidMount:transaction withSurfaceTelemetry:surfaceTelemetry];
  // Settled before the transaction is declared closed, so its write counts as
  // part of the transaction that asked for it
  [self _settleEndIfWanted];
  _transactionIsOpen = NO;
  _offsetWritesThisTransaction = 0;
  // A transaction that mounts for longer than a frame at 120 Hz is a dropped frame
  const double mountedMs = (CACurrentMediaTime() - _transactionStartedAt) * 1000.0;
  if (mountedMs > 8.0) {
    [EXPKeyboardTrace record:@"slow transaction %.0fms rows=%lu",
                             mountedMs,
                             (unsigned long)_containerView.subviews.firstObject.subviews.count];
  }
}

- (void)_mountingTransactionDidMount:(const facebook::react::MountingTransaction &)transaction
                withSurfaceTelemetry:(const facebook::react::SurfaceTelemetry &)surfaceTelemetry
{
  UIView *row = _firstVisibleView;
  _firstVisibleView = nil;
  const BOOL followEnd = _followEndAfterMount;
  _followEndAfterMount = NO;
  // A box that changed size answers before any row does: a rotation moves every
  // row, so no row's place is the reader's place, and a reader at the end wants
  // the end. Instant, since a rotation is a cut already.
  const BOOL resized = _boundsResized;
  _boundsResized = NO;
  if (resized) {
    const auto &resizeProps = static_cast<const ExpoScrollViewProps &>(*_props);
    if (resizeProps.contentAnchor == ExpoScrollContentAnchor::Bottom && _wasAtBottom) {
      [self _scrollToBottom];
      return;
    }
  }
  if (_followingDrawnEnd) {
    if (followEnd) {
      // Content arrived while the drawn end was being followed; the rise owns the offset from here
      _followingDrawnEnd = NO;
    } else {
      [self _followDrawnEnd];
      return;
    }
  }
  if (row == nil || row.superview == nil) {
    [self _followEndIfAsked:followEnd];
    return;
  }
  // A recycled view with a different tag is different content; its frame would
  // compute a jump, not a correction
  if (row.tag != _firstVisibleTag) {
    [self _followEndIfAsked:followEnd];
    return;
  }
  // A transaction that already took the offset to the end moved it by what was
  // added; the delta on top would push past the content
  if (_followedEndInTransaction) {
    return;
  }
  /*
   * A bottom-anchored list pins the anchor row's bottom edge, a top-anchored one
   * its top. The edge matters when the row itself changes height: a receipt
   * opening under the newest balloon leaves the row's top where it was, and only
   * a bottom-edge delta keeps the receipt in view.
   */
  const auto &anchorProps = static_cast<const ExpoScrollViewProps &>(*_props);
  const BOOL bottomAnchored = anchorProps.contentAnchor == ExpoScrollContentAnchor::Bottom;
  const CGRect nowFrame = [self _rowFrame:row];
  CGFloat delta = bottomAnchored ? CGRectGetMaxY(nowFrame) - CGRectGetMaxY(_firstVisibleFrameBefore)
                                 : CGRectGetMinY(nowFrame) - CGRectGetMinY(_firstVisibleFrameBefore);
  if (followEnd) {
    /*
     * Content grew under a reader at the end. Growth above the row moves its top
     * and is held still by the pin; growth of the row or below it is the arrival
     * the rise is for. Both apply when both happen: the pin is an instant
     * compensation, the rise an animated journey, and a send landing while the
     * previous receipt is still sliding calls for both in one transaction.
     */
    delta = CGRectGetMinY(nowFrame) - CGRectGetMinY(_firstVisibleFrameBefore);
  }
  // Half a point, React Native's threshold: below that it is rounding, and a
  // write costs a scroll event
  if (fabs(delta) <= 0.5) {
    [self _followEndIfAsked:followEnd];
    return;
  }
  [EXPKeyboardTrace
      record:@"pin delta=%.1f offset %.1f%@", delta, _scrollView.contentOffset.y, followEnd ? @" then follow" : @""];

  const BOOL mayHold = [self _mayHoldAnchor];
  // Counted whether or not it is allowed: a correction computed and discarded is
  // what the reader sees jump, see `RCTRenderAnchorStats`
  RCTRenderAnchorStatsRecord(mayHold, delta);
  if (!mayHold) {
    [self _followEndIfAsked:followEnd];
    return;
  }
  // Clamped into the list's own range: a transcript shorter than its viewport
  // has one legal position, and a hold written past it leaves the content
  // over-scrolled. When the content fits, `resting` and the limit coincide.
  const CGFloat resting = -_appliedInset.top;
  const CGFloat wanted = _scrollView.contentOffset.y + delta;
  const CGFloat next = MAX(resting, MIN([self _maxOffsetY], wanted));
  if (fabs(next - _scrollView.contentOffset.y) > 0.5) {
    [self _writeOffsetY:next reason:@"anchor"];
  }
  // After the pin, never instead of it: the rise starts from where the
  // compensation left the offset
  [self _followEndIfAsked:followEnd];
}

// The follow a transaction's growth asked for, once the hold has had its say
- (void)_followEndIfAsked:(BOOL)asked
{
  if (asked) {
    [self _scrollToBottomAnimated:YES reason:@"anchor-follow-end"];
  }
}

#pragma mark - RCTVirtualViewContainerProtocol

/**
 * The state a `VirtualView` inside this scroll view attaches to.
 * `RCTVirtualViewComponentView` finds its container by walking `superview` for
 * this selector; the state computes each virtual view's mode from this view's
 * offset and bounds. Built on demand so a scroll view without virtual views
 * registers no listener.
 */
- (RCTVirtualViewContainerState *)virtualViewContainerState
{
  if (_virtualViewContainerState == nil) {
    _virtualViewContainerState = [[RCTVirtualViewContainerState alloc] initWithScrollView:self];
  }
  return _virtualViewContainerState;
}

- (UIScrollView *)scrollView
{
  return _scrollView;
}

#pragma mark - Insets

/**
 * Where the scroll indicator may be drawn. Separate from the content inset
 * because a rounded, clipping ancestor cuts the indicator's ends off without
 * changing where content sits, so this runs on layout too.
 */
- (void)_applyIndicatorInsets
{
  UIEdgeInsets safeArea = self.safeAreaInsets;
  UIEdgeInsets composed = [self _composedInset];
  /*
   * The content's top and bottom, but the safe area's sides: an indicator under
   * the keyboard would report a position the reader cannot see, while an
   * indicator is chrome and belongs inside the safe area whatever the content
   * does. This matches the platform's transcript, which also sets
   * `automaticallyAdjustsScrollIndicatorInsets` to NO.
   *
   * Plus the corners of whatever clips it: a rounded ancestor with
   * `overflow: hidden` cuts off the indicator's ends for the first and last
   * `radius` points.
   */
  const CGFloat corner = [self _clippingCornerRadius];
  UIEdgeInsets indicator =
      UIEdgeInsetsMake(composed.top + corner, safeArea.left, composed.bottom + corner, safeArea.right);
  _scrollView.verticalScrollIndicatorInsets = indicator;
  _scrollView.horizontalScrollIndicatorInsets = indicator;
}

/**
 * The author's inset, plus the safe area on the edges that are switched on, plus
 * the keyboard's claim at the bottom. The author's inset adds to the automatic
 * part rather than replacing it. The keyboard and the bottom safe area do not
 * sum: the keyboard is drawn over the home indicator, so the larger claim is the
 * true one.
 */
- (UIEdgeInsets)_composedInset
{
  const auto &props = static_cast<const ExpoScrollViewProps &>(*_props);
  UIEdgeInsets safeArea = self.safeAreaInsets;

  UIEdgeInsets composed;
  composed.top = props.contentInset.top + (props.automaticInsets.top ? safeArea.top : 0);
  composed.left = props.contentInset.left + (props.automaticInsets.left ? safeArea.left : 0);
  composed.right = props.contentInset.right + (props.automaticInsets.right ? safeArea.right : 0);
  composed.bottom = props.contentInset.bottom + MAX(props.automaticInsets.bottom ? safeArea.bottom : 0, _keyboardInset);
  return composed;
}

- (void)_applyInsets
{
  const auto &props = static_cast<const ExpoScrollViewProps &>(*_props);
  UIEdgeInsets safeArea = self.safeAreaInsets;
  UIEdgeInsets composed = [self _composedInset];

  if (UIEdgeInsetsEqualToEdgeInsets(composed, _appliedInset)) {
    // The indicator inset also depends on the clipping corners, and a scroll view
    // whose content inset never changes returns here on its first layout
    [self _applyIndicatorInsets];
    return;
  }

  [EXPKeyboardTrace record:@"insets top=%.1f bottom=%.1f | safeArea=%.1f,%.1f kbInset=%.1f authored=%.1f",
                           composed.top,
                           composed.bottom,
                           safeArea.top,
                           safeArea.bottom,
                           _keyboardInset,
                           props.contentInset.bottom];

  /*
   * The remembered intent, asked before the inset moves. `_wasAtBottom` is the
   * platform transcript's model: scrolling updates the intent and layout changes
   * enforce it. Measuring at the moment an inset changes answers against a view
   * that a native stack may be resizing at the same time.
   */
  const auto &anchorProps = static_cast<const ExpoScrollViewProps &>(*_props);
  BOOL followBottom = anchorProps.contentAnchor == ExpoScrollContentAnchor::Bottom &&
      (_wasAtBottom || [self _isAtBottom] || _scrollingToLatest);

  /*
   * A scroll view rests at `-contentInset.top`, so a top inset arriving after
   * the content would leave the view scrolled by that much. The delta, rather
   * than `-composed.top`, keeps a reader who is not at the top where they are.
   * Read before the inset is assigned: the setter clamps the offset into the new
   * range, and a delta applied to the clamped value is applied twice.
   */
  const CGFloat topDelta = composed.top - _appliedInset.top;
  const CGPoint offsetBeforeInset = _scrollView.contentOffset;

  _appliedInset = composed;
  // UIKit re-derives the offset inside this setter; only the branches below may
  // move it, see `-[EXPScrollViewInner holdOffsetWhile:]`. During an interactive
  // dismissal the value read above is the drag's own position and stays.
  [_scrollView holdOffsetWhile:^{
    self->_scrollView.contentInset = composed;
  }];

  /*
   * Not while a finger or an animation owns the offset, and not when the bottom
   * is about to be held: this delta preserves the top of the content, and a
   * bottom-anchored view at its end wants the opposite, which `followBottom`
   * writes below. Writing both is two answers in one pass.
   */
  const BOOL mayMove = [self _mayMoveOffset];
  const BOOL bottomWillAnswer = followBottom && ![self _offsetOwnedElsewhere];
  if (topDelta != 0) {
    [EXPKeyboardTrace record:@"topDelta=%.1f applied=%d (track=%d decel=%d) safeTop=%.1f bottom=%d",
                             topDelta,
                             (int)(mayMove && !bottomWillAnswer),
                             (int)_scrollView.isTracking,
                             (int)_scrollView.isDecelerating,
                             self.safeAreaInsets.top,
                             (int)bottomWillAnswer];
  }
  if (topDelta != 0 && mayMove && !bottomWillAnswer) {
    CGPoint offset = offsetBeforeInset;
    offset.y -= topDelta;
    // Clamped into what the new inset allows; a shrinking inset can leave the old
    // position past the top
    offset.y = MAX(-composed.top, MIN([self _maxOffsetY], offset.y));
    [self _writeOffset:offset reason:@"inset-delta"];
  } else {
    [self _clampOffsetIfPastEnd];
  }
  [self _applyIndicatorInsets];

  if (bottomWillAnswer) {
    // Animated while a rise is in flight, so the composer collapsing after a send
    // retargets the rise instead of cutting it; instant otherwise
    [self _scrollToBottomAnimated:[self _isRising] reason:@"inset-follow-bottom"];
  }
  if (mayMove) {
    [self _keepFocusedFieldVisible];
  }
  [self _emitInsetChange];
}

- (void)_keepFocusedFieldVisible
{
  UIView *responder = _focusedDescendant;
  if (responder == nil || !responder.isFirstResponder) {
    return;
  }

  // Subviews of a scroll view are in content coordinates, the offset's space
  CGRect focus = [responder convertRect:responder.bounds toView:_scrollView];
  CGFloat offsetY = _scrollView.contentOffset.y;
  CGFloat visibleTop = offsetY + _appliedInset.top;
  CGFloat visibleBottom = offsetY + CGRectGetHeight(_scrollView.bounds) - _appliedInset.bottom;

  CGFloat delta = 0;
  if (CGRectGetMaxY(focus) > visibleBottom) {
    delta = CGRectGetMaxY(focus) - visibleBottom;
  } else if (CGRectGetMinY(focus) < visibleTop) {
    delta = CGRectGetMinY(focus) - visibleTop;
  }
  if (delta == 0) {
    return;
  }

  // Clamped to what the scroll view can reach, or a field near the end would ask
  // past the content and rubber-band back
  CGFloat minOffset = -_appliedInset.top;
  CGFloat maxOffset =
      MAX(minOffset, _scrollView.contentSize.height - CGRectGetHeight(_scrollView.bounds) + _appliedInset.bottom);
  CGFloat target = MIN(MAX(offsetY + delta, minOffset), maxOffset);

  // Not animated: this runs on every frame of the keyboard's own animation
  [self _writeOffsetY:target reason:@"focused-field"];
}

// Focus can move while the keyboard is already up, when no inset changes
- (void)_focusDidMove:(NSNotification *)notification
{
  UIView *field = [notification.object isKindOfClass:UIView.class] ? notification.object : nil;
  const BOOL beginning = [notification.name isEqualToString:UITextFieldTextDidBeginEditingNotification] ||
      [notification.name isEqualToString:UITextViewTextDidBeginEditingNotification];
  if (field == nil || ![field isDescendantOfView:_containerView]) {
    return;
  }
  _focusedDescendant = beginning ? field : nil;
  if (beginning) {
    [self _keepFocusedFieldVisible];
  }
}

- (void)safeAreaInsetsDidChange
{
  [super safeAreaInsetsDidChange];
  [self _applyInsets];
}

#pragma mark - Keyboard

- (void)keyboardGeometryDidChange:(EXPKeyboardGeometry)geometry
{
  const auto &props = static_cast<const ExpoScrollViewProps &>(*_props);
  if (!props.avoidsKeyboard) {
    return;
  }
  // The overlap with this view, not the obstruction's height: a scroll view that
  // stops above the keyboard needs nothing
  UIWindow *window = self.window;
  if (window == nil) {
    return;
  }
  CGRect inWindow = [self convertRect:self.bounds toView:window];
  // The obstruction is the keyboard and whatever docks on it, see
  // `-[EXPKeyboardInsets _measuredObstructionTopForObstruction:]`
  CGFloat obstructionTop = [_observedKeyboardInsets obstructionTopInWindowForObstruction:geometry.height];
  _keyboardInset = MAX(CGRectGetMaxY(inWindow) - obstructionTop, 0);
  [EXPKeyboardTrace
      record:
          @"kb h=%.1f obstrTop=%.1f -> inset=%.1f | screen#%ld offset=%.1f track=%d decel=%d anim=%lu csH=%.1f bH=%.1f max=%.1f",
          geometry.height,
          obstructionTop,
          _keyboardInset,
          (long)_observedKeyboardInsets.identifier,
          _scrollView.contentOffset.y,
          (int)_scrollView.isTracking,
          (int)_scrollView.isDecelerating,
          (unsigned long)_scrollView.layer.animationKeys.count,
          _scrollView.contentSize.height,
          CGRectGetHeight(_scrollView.bounds),
          [self _maxOffsetY]];

  [self _applyInsets];
}

/**
 * Registers this as the view controller's content scroll view.
 * `-[UIViewController setContentScrollView:forEdge:]` is what a navigation bar
 * watches for its large title, scroll-edge appearance and status-bar tap, and
 * UIKit's own heuristic does not find a scroll view nested this deep. Said from
 * this side so it holds under any navigator, or none.
 */
- (void)_becomeTheContentScrollView
{
  UIResponder *responder = self.nextResponder;
  while (responder != nil && ![responder isKindOfClass:UIViewController.class]) {
    responder = responder.nextResponder;
  }
  UIViewController *controller = (UIViewController *)responder;
  if (controller == nil) {
    return;
  }
  [controller setContentScrollView:_scrollView forEdge:NSDirectionalRectEdgeAll];
}

// The corner inset is a layout fact, and a scroll view whose insets never
// change never reaches `_applyInsets`
- (void)layoutSubviews
{
  [super layoutSubviews];
  if (@available(iOS 26.0, *)) {
    UIScrollEdgeEffect *top = _scrollView.topEdgeEffect;
    NSString *style = top.style == UIScrollEdgeEffectStyle.softStyle ? @"soft"
        : top.style == UIScrollEdgeEffectStyle.hardStyle             ? @"hard"
                                                                     : @"automatic";
    [EXPKeyboardTrace recordChanged:@"edge" pinned:NO format:@"edge top=%@ hidden=%d", style, (int)top.hidden];
  }
  // Only the indicator: `_applyInsets` also moves the offset, which layout must not
  [self _applyIndicatorInsets];
}

/**
 * A list inside the keyboard cannot be the thing that dismisses it:
 * `<native:keyboardpanel>`'s card is hosted in `UIRemoteKeyboardWindow`, where
 * an interactive dismissal would drag the keys under it. Decided from the
 * window rather than a prop, since it is not the author's choice to get wrong;
 * the author's value applies again elsewhere.
 */
- (UIScrollViewKeyboardDismissMode)_wantedKeyboardDismissMode
{
  const BOOL insideTheKeyboard =
      self.window != nil && [NSStringFromClass(self.window.class) containsString:@"RemoteKeyboard"];
  if (insideTheKeyboard) {
    return UIScrollViewKeyboardDismissModeNone;
  }
  switch (_appliedDismissMode) {
    case ExpoScrollKeyboardDismissMode::None:
      return UIScrollViewKeyboardDismissModeNone;
    case ExpoScrollKeyboardDismissMode::OnDrag:
      return UIScrollViewKeyboardDismissModeOnDrag;
    case ExpoScrollKeyboardDismissMode::Interactive:
      return UIScrollViewKeyboardDismissModeInteractive;
  }
}

/**
 * Writes the mode only when it differs. Assigning `keyboardDismissMode` while
 * UIScrollView is tracking an interactive dismissal ends the tracking and the
 * keyboard animates away mid-drag, and this runs from every commit.
 */
- (void)_applyKeyboardDismissMode
{
  const UIScrollViewKeyboardDismissMode wanted = [self _wantedKeyboardDismissMode];
  if (_scrollView.keyboardDismissMode == wanted) {
    return;
  }
  _scrollView.keyboardDismissMode = wanted;
  // Only on a real write: the question is whether one landed during a drag
  [EXPKeyboardTrace record:@"dismissMode WROTE %ld (tracking=%d dragging=%d)",
                           (long)wanted,
                           (int)_scrollView.isTracking,
                           (int)_scrollView.isDragging];
}

- (void)didMoveToWindow
{
  [super didMoveToWindow];
  // The window decides the dismiss mode
  [self _applyKeyboardDismissMode];
  // Release the hold before letting go of the sampler, or its display link never parks
  [self _endKeyboardTracking];
  [_observedKeyboardInsets removeObserver:self];
  _observedKeyboardInsets = nil;
  if (self.window != nil) {
    // Held before registering: `addObserver:` calls back at once and the callback reads it
    _observedKeyboardInsets = [EXPKeyboardInsets insetsForView:self];
    [_observedKeyboardInsets addObserver:self];
    [self _becomeTheContentScrollView];
  } else {
    // Nothing recomputes this until the keyboard next moves, so a view leaving
    // mid-transition would come back inset for a keyboard that has gone
    _keyboardInset = 0;
    // A rise ends at the edge of the window: nothing to see, and the link retains this view
    [self _endRise];
  }
  [self _applyInsets];
}

#pragma mark - RCTComponentViewProtocol

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<ExpoScrollViewComponentDescriptor>();
}

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps
{
  const auto &newProps = static_cast<const ExpoScrollViewProps &>(*props);

  _scrollView.scrollEnabled = newProps.scrollEnabled;
  _scrollView.bounces = newProps.bounces;
  // Both axes: UIScrollView shows only the indicator for an axis that can scroll
  _scrollView.showsVerticalScrollIndicator = newProps.showsScrollIndicator;
  _scrollView.showsHorizontalScrollIndicator = newProps.showsScrollIndicator;

  _appliedDismissMode = newProps.keyboardDismissMode;
  [self _applyKeyboardDismissMode];
  if (@available(iOS 26.0, *)) {
    EXPApplyEdgeEffect(_scrollView.topEdgeEffect, newProps.edgeEffects.top);
    EXPApplyEdgeEffect(_scrollView.bottomEdgeEffect, newProps.edgeEffects.bottom);
    EXPApplyEdgeEffect(_scrollView.leftEdgeEffect, newProps.edgeEffects.left);
    EXPApplyEdgeEffect(_scrollView.rightEdgeEffect, newProps.edgeEffects.right);
  }

  [super updateProps:props oldProps:oldProps];
  // After super, which installs `_props`
  [self _applyInsets];
}

- (void)updateState:(const State::Shared &)state oldState:(const State::Shared &)oldState
{
  _state = std::static_pointer_cast<const ExpoScrollViewShadowNode::ConcreteState>(state);
  const auto &data = _state->getData();

  CGSize contentSize = RCTCGSizeFromSize(data.getContentSize());
  if (CGSizeEqualToSize(_contentSize, contentSize)) {
    return;
  }

  // Read before the new size is adopted
  BOOL wasEmpty = CGSizeEqualToSize(_contentSize, CGSizeZero);
  BOOL grew = contentSize.height > _contentSize.height;
  BOOL followContent = grew && (_wasAtBottom || _scrollingToLatest) && !wasEmpty;
  if (contentSize.height != _contentSize.height) {
    // The trace names the inputs of the follow decision and which rows resized,
    // since a content-size total cannot say what moved. Every row is compared, by
    // index and only while the count is unchanged; diagnostic, priced as one.
    UIView *content = _containerView.subviews.lastObject;
    NSArray<UIView *> *rows = content.subviews;
    NSMutableString *tail = [NSMutableString string];
    std::vector<CGFloat> heights;
    heights.reserve(rows.count);
    NSUInteger changed = 0;
    for (NSUInteger i = 0; i < rows.count; i++) {
      const CGFloat h = rows[i].frame.size.height;
      heights.push_back(h);
      if (i < _rowHeights.size() && rows.count == _tailRowCount) {
        const CGFloat was = _rowHeights[i];
        if (std::fabs(was - h) > 0.05) {
          changed++;
          // The first few, or the line becomes the whole transcript
          if (changed <= 6) {
            [tail appendFormat:@" [%lu] %.2f->%.2f", (unsigned long)i, was, h];
          }
        }
      }
    }
    if (changed > 6) {
      [tail appendFormat:@" (+%lu more)", (unsigned long)(changed - 6)];
    }
    _rowHeights = std::move(heights);
    _tailRowCount = rows.count;
    if (tail.length == 0) {
      [tail appendString:@" none"];
    }
    [EXPKeyboardTrace record:
                          @"state cs %.1f -> %.1f follow=%d (was=%d latest=%d atEnd=%d grew=%d) "
                          @"rows=%lu resized%@",
                          _contentSize.height,
                          contentSize.height,
                          (int)followContent,
                          (int)_wasAtBottom,
                          (int)_scrollingToLatest,
                          (int)[self _isAtBottom],
                          (int)grew,
                          (unsigned long)rows.count,
                          tail];
  }

  _contentSize = contentSize;
  _containerView.frame = CGRect{RCTCGPointFromPoint(data.contentBoundingRect.origin), contentSize};
  // `setContentSize:` would clamp the offset to the new end and deliver that to
  // every delegate; a short bottom-anchored transcript legitimately rests out of
  // range, and the decision below is the only thing that moves the offset
  [_scrollView holdOffsetWhile:^{
    self->_scrollView.contentSize = contentSize;
  }];
  [self _watchLastRowDrawn];

  const auto &props = static_cast<const ExpoScrollViewProps &>(*_props);
  if (props.contentAnchor == ExpoScrollContentAnchor::Bottom) {
    // The first content jumps to the end; content arriving under a reader at the
    // end is followed, animated, once the transaction has mounted and it is known
    // whether it arrived at the end or above the reader. A reader who scrolled
    // up is left alone.
    if (wasEmpty) {
      [self _scrollToBottom];
      return;
    }
    if (followContent) {
      _followEndAfterMount = YES;
      return;
    }
  }
  // Content that shrank under a rise in flight would leave the rise landing past
  // the new end; re-issuing it retargets the same movement
  if ([self _isRising]) {
    [self _scrollToBottomAnimated:YES reason:@"rise-retarget"];
    return;
  }
  // A bottom-anchored reader at the end rides a shrink down on the drawn end
  // rather than being clamped: the state's size arrives at once while the rows
  // glide. Only within a viewport of the end, where a movement is legible.
  const auto &shrinkProps = static_cast<const ExpoScrollViewProps &>(*_props);
  if (shrinkProps.contentAnchor == ExpoScrollContentAnchor::Bottom && _wasAtBottom && [self _mayMoveOffset]) {
    const CGFloat limit = [self _maxOffsetY];
    const CGFloat past = _scrollView.contentOffset.y - limit;
    if (past > 0.5 && past < CGRectGetHeight(_scrollView.bounds)) {
      // The follow runs in each mounting transaction from here, since the
      // transition engine's frames are transactions, and lands on the
      // transition's own curve
      [EXPKeyboardTrace record:@"follow drawn end from %.1f to %.1f", _scrollView.contentOffset.y, limit];
      _followingDrawnEnd = YES;
      return;
    }
  }
  [self _clampOffsetIfPastEnd];
}

// The furthest this can scroll, which is the resting offset while the content
// fits; that is what makes a short chat start at the top
- (CGFloat)_maxOffsetY
{
  CGFloat resting = -_appliedInset.top;
  CGFloat furthest = _scrollView.contentSize.height - CGRectGetHeight(_scrollView.bounds) + _appliedInset.bottom;
  return MAX(resting, furthest);
}

// Whether the follow's own animation is running, see `-_riseTo:animated:`
- (BOOL)_isRising
{
  return _riseLink != nil;
}

/**
 * Whether a finger, a deceleration or an animation owns the offset. Writing it
 * from here at the same time reads as the scroll view letting go of the touch.
 * `animationKeys` is how a `UIScrollView` reports a layer animation;
 * `_scrollingToTop` covers the status-bar scroll, which UIKit drives with its
 * own animator and `animationKeys` does not see.
 */
- (BOOL)_offsetOwnedElsewhere
{
  const BOOL animating = _scrollView.layer.animationKeys.count > 0 || _scrollingToTop;
  return _scrollView.isTracking || _scrollView.isDecelerating || animating;
}

/**
 * Whether the anchor may write the offset, which is a different question from
 * `-_mayMoveOffset`. A clamp or an inset delta is a second writer with an
 * opinion about where the list should be; the anchor cancels a movement of the
 * content, which moves whether or not anyone is scrolling, and refusing drops
 * the correction rather than deferring it. React Native's
 * `maintainVisibleContentPosition` writes with no state check at all.
 *
 * The two refusals are where writing means something else: an animation, ours
 * or UIKit's scroll-to-top, is a genuine second writer that
 * `-_followEndIfAsked:` re-aims instead; and past the end under a finger or a
 * deceleration the offset is where a rubber band is taking it. Past the end
 * because the content shrank is neither, and the write is clamped into range.
 */
- (BOOL)_mayHoldAnchor
{
  if (_scrollingToTop || [self _isRising] || _scrollView.layer.animationKeys.count > 0) {
    return NO;
  }
  const CGFloat y = _scrollView.contentOffset.y;
  if (y >= -_appliedInset.top - 0.5 && y <= [self _maxOffsetY] + 0.5) {
    return YES;
  }
  return !_scrollView.isTracking && !_scrollView.isDecelerating;
}

/**
 * Whether a one-off correction, a clamp or an inset delta, may write the offset.
 * The rise counts as an owner here and not in `-_offsetOwnedElsewhere`: a
 * correction mid-rise is a second writer that loses to the next frame, while a
 * follow mid-rise re-aims the movement it already owns.
 */
- (BOOL)_mayMoveOffset
{
  return ![self _offsetOwnedElsewhere] && ![self _isRising];
}

/**
 * The one place this view writes the offset. It decides nothing; it writes what
 * it is given and traces it with a count per mounting transaction, so a second
 * write within one transaction shows up as a collision between writers whose
 * order UIKit and Fabric decide.
 */
- (void)_writeOffset:(CGPoint)offset reason:(NSString *)reason
{
  if (CGPointEqualToPoint(_scrollView.contentOffset, offset)) {
    return;
  }
  // Counted only inside a transaction: between mounts a keyboard animation
  // delivers a sequence of inset changes, not a collision
  if (_transactionIsOpen) {
    _offsetWritesThisTransaction++;
    [EXPKeyboardTrace record:@"write %.1f -> %.1f #%lu %@",
                             _scrollView.contentOffset.y,
                             offset.y,
                             (unsigned long)_offsetWritesThisTransaction,
                             reason];
  } else {
    [EXPKeyboardTrace record:@"write %.1f -> %.1f #- %@", _scrollView.contentOffset.y, offset.y, reason];
  }
  _scrollView.contentOffset = offset;
}

// The same, for the writers that only move vertically
- (void)_writeOffsetY:(CGFloat)y reason:(NSString *)reason
{
  [self _writeOffset:CGPointMake(_scrollView.contentOffset.x, y) reason:reason];
}

/**
 * One transaction's step of following the drawn end, see `_followingDrawnEnd`.
 * The transition engine animates the content view's frame while the content
 * size is the final layout; the follow writes the offset that shows the drawn
 * bottom, ends when it reaches the laid-out one, and stands down for a finger.
 */
- (void)_followDrawnEnd
{
  UIView *content = _containerView.subviews.firstObject;
  if (content == nil || ![self _mayMoveOffset]) {
    _followingDrawnEnd = NO;
    return;
  }
  const CGFloat drawnBottom = CGRectGetMaxY([content.superview convertRect:content.frame toView:_scrollView]);
  const CGFloat resting = -_appliedInset.top;
  // On the pixel grid, where UIKit stores the offset, or the next transaction
  // writes the same pixel again and costs a scroll event
  const CGFloat scale = self.window.screen.scale > 0 ? self.window.screen.scale : 1;
  const CGFloat drawnMax =
      std::round(MAX(resting, drawnBottom - CGRectGetHeight(_scrollView.bounds) + _appliedInset.bottom) * scale) /
      scale;
  [self _writeOffsetY:drawnMax reason:@"drawn-end"];
  // The last row's top edge in the window, which should not move while the
  // follow pays for the content above it; a balloon moved by its row writes no
  // trace line of its own
  UIView *lastRow = content.subviews.lastObject;
  if (lastRow != nil) {
    [EXPKeyboardTrace record:@"last row winY=%.2f (drawnBottom=%.2f offset=%.2f)",
                             CGRectGetMinY([lastRow convertRect:lastRow.bounds toView:nil]),
                             drawnBottom,
                             drawnMax];
  }
  if (fabs(drawnMax - [self _maxOffsetY]) < 0.05) {
    [EXPKeyboardTrace record:@"drawn end reached %.1f", drawnMax];
    _followingDrawnEnd = NO;
  }
}

/*
 * Traces where the last row is drawn for the second after the content changed.
 * Every other instrument reads a model position, which shows a transition as a
 * single step; the presentation layer is the drawn one. Only while the trace is
 * recording, and only when the row moves.
 */
- (void)_watchLastRowDrawn
{
  if (![EXPKeyboardTrace isRecording]) {
    return;
  }
  _drawnWatchTicks = 0;
  if (_drawnWatch != nil) {
    return;
  }
  _drawnWatchLastY = CGFLOAT_MAX;
  _drawnWatch = [CADisplayLink displayLinkWithTarget:self selector:@selector(_drawnWatchTick)];
  [_drawnWatch addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];
}

- (void)_drawnWatchTick
{
  UIView *content = _containerView.subviews.firstObject;
  UIView *lastRow = content.subviews.lastObject;
  if (lastRow == nil || ++_drawnWatchTicks > 90) {
    [_drawnWatch invalidate];
    _drawnWatch = nil;
    return;
  }
  CALayer *drawn = lastRow.layer.presentationLayer ?: lastRow.layer;
  const CGRect inWindow = [drawn convertRect:drawn.bounds toLayer:self.window.layer];
  const CGFloat y = CGRectGetMinY(inWindow);
  if (_drawnWatchLastY == CGFLOAT_MAX) {
    _drawnWatchLastY = y;
    return;
  }
  if (fabs(y - _drawnWatchLastY) > 0.01) {
    [EXPKeyboardTrace record:@"last row drawn at %.2f (%+.2f)", y, y - _drawnWatchLastY];
    _drawnWatchLastY = y;
  }
}

- (void)_clampOffsetIfPastEnd
{
  if (![self _mayMoveOffset]) {
    return;
  }
  const CGFloat limit = [self _maxOffsetY];
  if (_scrollView.contentOffset.y <= limit) {
    return;
  }
  [self _writeOffsetY:limit reason:@"clamp"];
}

- (void)_scrollToBottom
{
  [self _scrollToBottomAnimated:NO reason:@"jump-to-end"];
}

/**
 * Be at the end: an intent, recorded, evaluated once.
 *
 * Several askers say this during one mounting transaction, and each would
 * freeze a different `-_maxOffsetY` as the insets settle. So the intent is
 * recorded while a transaction is open and evaluated at its end; outside a
 * transaction it is evaluated at once. Animation is OR-ed rather than taken
 * from the last asker, so a rise under way is not turned into a cut.
 */
- (void)_scrollToBottomAnimated:(BOOL)animated reason:(NSString *)reason
{
  _followedEndInTransaction = YES;
  _wasAtBottom = YES;
  if (_transactionIsOpen) {
    _endWanted = YES;
    _endWantedAnimated = _endWantedAnimated || animated;
    _endWantedBy = _endWantedBy == nil ? reason : [NSString stringWithFormat:@"%@+%@", _endWantedBy, reason];
    return;
  }
  [self _riseTo:[self _maxOffsetY] animated:animated reason:reason];
}

// The end intent, evaluated against the state the transaction settled on
- (void)_settleEndIfWanted
{
  if (!_endWanted) {
    return;
  }
  const BOOL animated = _endWantedAnimated;
  NSString *reason = _endWantedBy ?: @"end";
  _endWanted = NO;
  _endWantedAnimated = NO;
  _endWantedBy = nil;
  [self _riseTo:[self _maxOffsetY] animated:animated reason:reason];
}

/**
 * How long a rise takes, and on what curve: fitted to a 60fps recording of the
 * platform's chat, one balloon's edge over 22 frames. The same duration and
 * curve as the layout transitions this follows, so content and offset move on
 * one clock; `chatBubbleMetrics.js` carries them as `CHAT_BUBBLE_TAIL_MORPH`
 * and `CHAT_BUBBLE_TAIL_MORPH_CURVE`, and these two change with them.
 */
static const CFTimeInterval kExpoScrollRiseDuration = 0.335;

static facebook::react::TransitionTimingFunction ExpoScrollRiseCurve()
{
  // A critically damped spring (omega 19.5 rad/s, zeta 0.98) as the bezier the
  // renderer takes, so the offset and the boxes it follows share one solver
  return facebook::react::TransitionTimingFunction{0.2f, 0.05f, 0.15f, 1.0f};
}

/**
 * Moves to `target`, at once or over `kExpoScrollRiseDuration`. Animated while
 * already rising means retarget: the start and the clock stay and only the
 * destination changes, which UIKit has no API for.
 */
- (void)_riseTo:(CGFloat)target animated:(BOOL)animated reason:(NSString *)reason
{
  // A rise owns the offset from here; a follow of the drawn end stands down
  _followingDrawnEnd = NO;
  if (!animated) {
    [self _endRise];
    [self _writeOffsetY:target reason:reason];
    return;
  }
  if ([self _isRising]) {
    if (_riseTarget != target) {
      [EXPKeyboardTrace record:@"rise retarget %.1f (cs=%.1f inset=%.1f)",
                               target,
                               _scrollView.contentSize.height,
                               _appliedInset.bottom];
    }
    _riseTarget = target;
    // A new end, said so a flight aimed at the old one can re-aim
    [self _emitInsetChange];
    return;
  }
  // A rise with nowhere to go is not started, or `-_isRising` would claim the
  // offset while nobody moves it
  if (fabs(target - _scrollView.contentOffset.y) < 0.5) {
    [self _writeOffsetY:target reason:reason];
    // Arrived without a scroll event to say so
    _scrollingToLatest = NO;
    return;
  }
  [EXPKeyboardTrace record:@"rise start %.1f -> %.1f", _scrollView.contentOffset.y, target];
  _riseFrom = _scrollView.contentOffset.y;
  _riseTarget = target;
  _riseStart = CACurrentMediaTime();
  _riseLink = [CADisplayLink displayLinkWithTarget:self selector:@selector(_riseTick)];
  // At the display's rate: a display link defaults to 60 on a ProMotion screen,
  // half the rate of the keys the transcript follows
  const float riseRate = (float)self.window.screen.maximumFramesPerSecond;
  if (riseRate > 0) {
    _riseLink.preferredFrameRateRange = CAFrameRateRangeMake(riseRate / 2, riseRate, riseRate);
  }
  [_riseLink addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];
  // The end this rise is going to, said after the link exists so the rest offset
  // reads as rising
  [self _emitInsetChange];
}

- (void)_riseTick
{
  // A finger beats a rise: following stops when the reader takes the list over
  if (_scrollView.isTracking || _scrollView.isDecelerating) {
    [self _endRise];
    return;
  }
  const CFTimeInterval elapsed = CACurrentMediaTime() - _riseStart;
  const double linear = MIN(1.0, MAX(0.0, elapsed / kExpoScrollRiseDuration));
  const double eased = ExpoScrollRiseCurve().evaluate(static_cast<facebook::react::Float>(linear));
  // Through `-_writeOffsetY:` like every writer, so the trace sees a second
  // writer appearing mid-rise
  [self _writeOffsetY:_riseFrom + (_riseTarget - _riseFrom) * eased reason:@"rise"];
  if (linear >= 1.0) {
    [EXPKeyboardTrace record:@"rise end at %.1f", _scrollView.contentOffset.y];
    [self _endRise];
  }
}

- (void)_endRise
{
  [_riseLink invalidate];
  _riseLink = nil;
  _scrollingToLatest = NO;
}

/**
 * Scrolls to the newest content, what an app calls after sending a message.
 * Animated by default because it answers something the user just did.
 */
- (void)_scrollToLatestAnimated:(BOOL)animated
{
  // A present intent beats a flick, unlike a follow, which yields to
  // deceleration; `setContentOffset:animated:NO` is UIKit's way to stop momentum
  if (_scrollView.isDecelerating) {
    [_scrollView setContentOffset:_scrollView.contentOffset animated:NO];
  }
  if (!animated) {
    _scrollingToLatest = NO;
    [self _scrollToBottom];
    return;
  }
  // Farther than a viewport is a cut, not an animation: everything on screen is
  // replaced anyway, and the commonest caller, a composer being focused, has the
  // keyboard growing the inset under an animation that fixed its target
  const CGFloat distance = ABS([self _maxOffsetY] - _scrollView.contentOffset.y);
  if (distance > CGRectGetHeight(_scrollView.bounds)) {
    _scrollingToLatest = NO;
    [self _scrollToBottom];
    return;
  }
  _scrollingToLatest = YES;
  [self _riseTo:[self _maxOffsetY] animated:YES reason:@"scroll-to-latest"];
  _wasAtBottom = YES;
}

- (void)handleCommand:(const NSString *)commandName args:(const NSArray *)args
{
  BOOL animated = args.count > 0 ? [args[0] boolValue] : YES;
  if ([commandName isEqualToString:@"scrollToLatest"]) {
    [self _scrollToLatestAnimated:animated];
    return;
  }
  if ([commandName isEqualToString:@"scrollToTop"]) {
    [_scrollView setContentOffset:CGPointMake(_scrollView.contentOffset.x, -_appliedInset.top) animated:animated];
    return;
  }
  [super handleCommand:commandName args:args];
}

// At the end within two points, a tolerance a settled scroll lands inside. A
// loose threshold would count a reader three balloons up as at the end.
- (BOOL)_isAtBottom
{
  return _scrollView.contentOffset.y >= [self _maxOffsetY] - 2;
}

- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics
           oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics
{
  // Asked before the new box is adopted. `_wasAtBottom` alone will not do: a
  // transcript that never had to scroll never wrote the intent.
  const BOOL wasAtEnd = _wasAtBottom || [self _isAtBottom];
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];
  _scrollView.frame = self.bounds;
  // Noted before the insets are applied, since applying them writes the offset.
  // After a resize no row is where it was: `-scrollViewDidScroll:` must not read
  // the repair as the reader's, and the mount must not pin a row to a layout
  // that no longer exists.
  if (!CGSizeEqualToSize(self.bounds.size, _lastBoundsSize)) {
    _lastBoundsSize = self.bounds.size;
    _boundsResized = YES;
    _wasAtBottom = wasAtEnd;
  }
  // The view may have moved relative to the safe area or the keyboard without changing size
  [self _applyInsets];
}

- (void)mountChildComponentView:(UIView<RCTComponentViewProtocol> *)childComponentView index:(NSInteger)index
{
  [_containerView insertSubview:childComponentView atIndex:index];
}

- (void)unmountChildComponentView:(UIView<RCTComponentViewProtocol> *)childComponentView index:(NSInteger)index
{
  [childComponentView removeFromSuperview];
}

- (void)prepareForRecycle
{
  [super prepareForRecycle];
  _state.reset();
  _contentSize = CGSizeZero;
  _keyboardInset = 0;
  _appliedInset = UIEdgeInsetsZero;
  _wasAtBottom = NO;
  _rowHeights.clear();
  _tailRowCount = 0;
  _boundsResized = NO;
  _lastBoundsSize = CGSizeZero;
  _scrollingToTop = NO;
  _scrollingToLatest = NO;
  _focusedDescendant = nil;
  _followingDrawnEnd = NO;
  [_drawnWatch invalidate];
  _drawnWatch = nil;
  [self _endKeyboardTracking];
  [self _endRise];
  _scrollView.contentInset = UIEdgeInsetsZero;
  _scrollView.contentOffset = CGPointZero;
  _scrollView.contentSize = CGSizeZero;
  // Dropped on recycle: the state holds the old content's virtual views and
  // listens to this view
  _virtualViewContainerState = nil;
}

#pragma mark - Events

// Where the offset will rest, see `ExpoScrollEvent::restOffset`
- (CGFloat)_restOffsetY
{
  if ([self _isRising]) {
    return _riseTarget;
  }
  if (_followingDrawnEnd) {
    return [self _maxOffsetY];
  }
  return MAX(-_appliedInset.top, MIN([self _maxOffsetY], _scrollView.contentOffset.y));
}

- (ExpoScrollEvent)_scrollEvent
{
  ExpoScrollEvent event;
  event.contentOffset = RCTPointFromCGPoint(_scrollView.contentOffset);
  event.contentSize = RCTSizeFromCGSize(_scrollView.contentSize);
  event.containerSize = RCTSizeFromCGSize(_scrollView.bounds.size);
  // The offset this view moved for its own insets, which the tree does not
  // know, see `ExpoScrollEvent::contentShift`
  event.contentShift = RCTPointFromCGPoint([self _contentShift]);
  event.restOffset = static_cast<Float>([self _restOffsetY]);
  event.inset = EdgeInsets{
      .left = static_cast<Float>(_appliedInset.left),
      .top = static_cast<Float>(_appliedInset.top),
      .right = static_cast<Float>(_appliedInset.right),
      .bottom = static_cast<Float>(_appliedInset.bottom)};
  event.timestamp = CACurrentMediaTime();
  return event;
}

/**
 * The largest corner radius on any clipping ancestor, stopping at the first one
 * that does not clip: a rounded view that lets children paint outside it cuts
 * nothing off.
 */
- (CGFloat)_clippingCornerRadius
{
  CGFloat radius = 0;
  UIView *ancestor = self.superview;
  while (ancestor != nil && ancestor.clipsToBounds) {
    radius = MAX(radius, ancestor.layer.cornerRadius);
    ancestor = ancestor.superview;
  }
  // This view's own radius clips its indicator whether or not it clips content
  radius = MAX(radius, self.layer.cornerRadius);
  // Never more than half the view, or a capsule would leave no indicator at all
  return MIN(radius, CGRectGetHeight(self.bounds) / 2);
}

/**
 * Tells the shadow tree where the content is scrolled to.
 * `ExpoScrollViewShadowNode::getContentOriginOffset` subtracts this from every
 * descendant's position, which is what makes `measureInWindow` inside a scroll
 * view answer where a thing is. Returning `nullptr` from the updater means
 * nothing to commit, so an unchanged offset costs no tree revision.
 */
- (void)_updateStateWithContentOffset
{
  if (!_state) {
    return;
  }
  const auto contentOffset = RCTPointFromCGPoint(_scrollView.contentOffset);
  // What the tree is told, which `-_contentShift` measures against
  _reportedOffset = _scrollView.contentOffset;
  _state->updateState(
      [contentOffset](const ExpoScrollViewShadowNode::ConcreteState::Data &oldData)
          -> ExpoScrollViewShadowNode::ConcreteState::SharedData {
        if (oldData.contentOffset == contentOffset) {
          return nullptr;
        }
        auto newData = oldData;
        newData.contentOffset = contentOffset;
        return std::make_shared<const ExpoScrollViewShadowNode::ConcreteState::Data>(newData);
      });
}

// How far this view moved the offset on its own, composing an inset, since it
// last told the tree; the reader's moves are reported, these are not. See
// `ExpoScrollEvent::contentShift`.
- (CGPoint)_contentShift
{
  return CGPointMake(_scrollView.contentOffset.x - _reportedOffset.x, _scrollView.contentOffset.y - _reportedOffset.y);
}

- (void)_emitInsetChange
{
  if (_eventEmitter == nullptr) {
    return;
  }
  _emittedShift = [self _contentShift];
  [EXPKeyboardTrace record:@"inset event rest=%.1f bottom=%.1f rising=%d",
                           [self _restOffsetY],
                           _appliedInset.bottom,
                           (int)[self _isRising]];
  std::static_pointer_cast<const ExpoScrollViewEventEmitter>(_eventEmitter)->onInsetChange([self _scrollEvent]);
}

// The shift can change without an inset changing; emitting only on a change
// keeps this off the per-frame path, since an ordinary scroll reports itself
- (void)_emitInsetChangeIfShiftChanged
{
  const CGPoint shift = [self _contentShift];
  if (std::abs(shift.x - _emittedShift.x) < 0.01 && std::abs(shift.y - _emittedShift.y) < 0.01) {
    return;
  }
  [self _emitInsetChange];
}

- (void)scrollViewDidScroll:(UIScrollView *)scrollView
{
  // `background-attachment: fixed` is measured against the viewport, and
  // scrolling produces no commit to repaint on; skipped unless something uses it
  if (EXPAnyFixedBackgrounds()) {
    [self exp_repositionFixedBackgrounds];
  }

  [self _updateStateWithContentOffset];
  [self _emitInsetChangeIfShiftChanged];

  // Every offset change with the step between consecutive ones; a glide steps by
  // a fraction of a point per frame and a jump does not
  if ([EXPKeyboardTrace isRecording]) {
    const CGFloat y = scrollView.contentOffset.y;
    if (fabs(y - _tracedOffsetY) > 0.01) {
      // `past`: how far beyond the end, so a bounce can be told from a scroll
      [EXPKeyboardTrace record:@"offset %.1f d=%+.1f cs=%.1f track=%d decel=%d rise=%d past=%.1f",
                               y,
                               y - _tracedOffsetY,
                               scrollView.contentSize.height,
                               (int)scrollView.isTracking,
                               (int)scrollView.isDecelerating,
                               (int)[self _isRising],
                               MAX(0.0, y - [self _maxOffsetY])];
      _tracedOffsetY = y;
    }
  }

  // Sampled here so it is the state before the content next changes size. A
  // rise counts as being there, since every rise aims at the end. Not
  // re-sampled while this view's own box changes size: that offset is nobody's
  // decision and the mount's repair is about to need the intent.
  if (!_boundsResized) {
    _wasAtBottom = [self _isAtBottom] || [self _isRising] || _followingDrawnEnd;
  }
  if (_scrollingToLatest && _wasAtBottom) {
    _scrollingToLatest = NO;
  }
  if (_eventEmitter == nullptr) {
    return;
  }
  std::static_pointer_cast<const ExpoScrollViewEventEmitter>(_eventEmitter)->onScroll([self _scrollEvent]);
}

// The scroll-to-top bracket: the window in which the offset belongs to UIKit,
// while a large title expanding changes the safe-area top on every frame
- (BOOL)scrollViewShouldScrollToTop:(UIScrollView *)scrollView
{
  _scrollingToTop = YES;
  [EXPKeyboardTrace record:@"scrollToTop begin"];
  return YES;
}

- (void)scrollViewDidScrollToTop:(UIScrollView *)scrollView
{
  _scrollingToTop = NO;
  [EXPKeyboardTrace record:@"scrollToTop end"];
}

// For the animated scrolls UIKit runs; the rise ends itself on its own clock
- (void)scrollViewDidEndScrollingAnimation:(UIScrollView *)scrollView
{
  _scrollingToTop = NO;
}

/**
 * Balanced holds on the keyboard sampler, so an interactive dismissal is
 * followed rather than discovered at its end: the sampler parks when nothing
 * moves and wakes on keyboard notifications, and a finger-driven dismissal
 * posts none.
 */
- (void)_beginKeyboardTracking
{
  if (_holdsKeyboardTracking || _observedKeyboardInsets == nil) {
    return;
  }
  _holdsKeyboardTracking = YES;
  [_observedKeyboardInsets beginTracking];
}

- (void)_endKeyboardTracking
{
  if (!_holdsKeyboardTracking) {
    return;
  }
  _holdsKeyboardTracking = NO;
  [_observedKeyboardInsets endTracking];
}

- (void)scrollViewWillBeginDragging:(UIScrollView *)scrollView
{
  _followingDrawnEnd = NO;
  // Above the early return: a dismissal is followed whether or not anything
  // listens for scroll events
  [self _beginKeyboardTracking];

  _scrollingToTop = NO;
  // A finger on the list outranks a scroll the app asked for a moment ago
  _scrollingToLatest = NO;
  if (_eventEmitter == nullptr) {
    return;
  }
  std::static_pointer_cast<const ExpoScrollViewEventEmitter>(_eventEmitter)->onScrollBeginDrag([self _scrollEvent]);
}

- (void)scrollViewDidEndDragging:(UIScrollView *)scrollView willDecelerate:(BOOL)decelerate
{
  [self _endKeyboardTracking];

  if (_eventEmitter == nullptr) {
    return;
  }
  ExpoScrollEndDragEvent event{[self _scrollEvent]};
  std::static_pointer_cast<const ExpoScrollViewEventEmitter>(_eventEmitter)->onScrollEndDrag(event);
}

- (void)scrollViewWillBeginDecelerating:(UIScrollView *)scrollView
{
  if (_eventEmitter == nullptr) {
    return;
  }
  std::static_pointer_cast<const ExpoScrollViewEventEmitter>(_eventEmitter)->onMomentumScrollBegin([self _scrollEvent]);
}

- (void)scrollViewDidEndDecelerating:(UIScrollView *)scrollView
{
  if (_eventEmitter == nullptr) {
    return;
  }
  std::static_pointer_cast<const ExpoScrollViewEventEmitter>(_eventEmitter)->onMomentumScrollEnd([self _scrollEvent]);
}

+ (void)load
{
  [[RCTComponentViewFactory currentComponentViewFactory] registerComponentViewClass:self];
}

@end
