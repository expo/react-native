/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPScrollViewComponentView.h"

#import "../View/EXPKeyboardTrace.h"

#import <React/RCTConversions.h>
#import <react/renderer/components/view/ExpoScrollViewShadowNode.h>
#import <react/renderer/components/view/TransitionPrimitives.h>

#import <React/EXPElementDragOwnership.h>
#import <React/RCTGenericDelegateSplitter.h>
#import "RCTVirtualViewContainerState.h"
#import "EXPKeyboardInsets.h"
#import "RCTComponentViewFactory.h"

using namespace facebook::react;

#pragma mark - The scroll view itself

/**
 * A `UIScrollView` that asks its content whether a touch may be stolen, and that
 * can be listened to by more than one delegate.
 *
 * UIKit's own rule. `-touchesShouldCancelInContentView:` returns NO for a `UIControl` and
 * YES for everything else, which is why dragging a slider inside a table moves the slider while
 * dragging a row scrolls the table. React Native's scroll view overrides that to YES for
 * everything, so a control whose gesture IS a drag cannot work inside a scrollable at all.
 *
 * The SPLITTER is the same pattern `RCTEnhancedScrollView` uses, and it is here
 * for the same reason: `UIScrollView` has one delegate, and more than one thing
 * needs to hear about scrolling. The component view is one of them; a
 * `VirtualView`'s container state is another, and it arrives long after the
 * delegate has been set. Overriding `delegate` rather than exposing a second
 * property means the ordinary assignment in `-initWithFrame:` keeps working and
 * anything that reads `.delegate` back gets what it set.
 *
 * With exactly one delegate registered the splitter subscribes it directly, so
 * the common case costs nothing.
 */
/** One edge's effect from the prop: a style, or hidden. */
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

@interface EXPScrollViewInner : UIScrollView

@property (nonatomic, strong, readonly) RCTGenericDelegateSplitter<id<UIScrollViewDelegate>> *delegateSplitter;

@end

@implementation EXPScrollViewInner {
  __weak id<UIScrollViewDelegate> _publicDelegate;
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
  // KVO around the change, because `delegate` is a documented observable
  // property and this override is the only place it now changes.
  [self willChangeValueForKey:@"delegate"];
  _publicDelegate = delegate;
  [self didChangeValueForKey:@"delegate"];
  if (_publicDelegate != nil) {
    [_delegateSplitter addDelegate:_publicDelegate];
  }
}

/*
 * Empty, and it has to exist.
 *
 * The splitter subscribes ITSELF when there is more than one delegate, and
 * `UIScrollView` caches which optional methods its delegate implements at the
 * moment it is set. A splitter that does not answer `scrollViewDidScroll:`
 * therefore never receives it, and every listener behind it goes silent — the
 * same reason `RCTEnhancedScrollView` carries this method.
 */
- (void)scrollViewDidScroll:(__unused UIScrollView *)scrollView
{
}

@end

#pragma mark - The component view

@interface EXPScrollViewComponentView () <UIScrollViewDelegate, EXPKeyboardInsetObserving>
@end

@implementation EXPScrollViewComponentView {
  /* Set while UIKit owns the offset for a status-bar scroll-to-top. */
  BOOL _scrollingToTop;
  EXPScrollViewInner *_scrollView;
  UIView *_containerView;
  /** The author's own dismiss mode, which the keyboard's window can override. */
  ExpoScrollKeyboardDismissMode _appliedDismissMode;
  ExpoScrollViewShadowNode::ConcreteState::Shared _state;
  CGSize _contentSize;
  /** The last offset written to the trace, so only real movement is recorded. */
  CGFloat _tracedOffsetY;
  /**
   * Set across the `setContentSize:` clamp and its undo — see below. While it is
   * on, the offset is a value UIKit invented and this view is about to erase, so
   * nothing downstream may act on it.
   */
  BOOL _offsetIsMidRepair;

  /** The keyboard's claim on the bottom edge, in points, as of the last frame it moved. */
  CGFloat _keyboardInset;

  /** The insets last written, so an unchanged composition costs nothing. */
  UIEdgeInsets _appliedInset;

  /**
   * Whether the view was at the end when the content last changed size.
   *
   * Sampled BEFORE the new size is adopted, because afterwards the question is unanswerable: every
   * position looks like "not at the bottom" once something has been added below it.
   */
  BOOL _wasAtBottom;

  /**
   * Set while an animated scroll to the newest content is in flight.
   *
   * It counts as being at the bottom. Without that, sending a message while the keyboard is still
   * rising loses the anchor: the animated scroll aims at the maximum as it was when it started, the
   * inset keeps growing underneath it, and the checks that would re-target see a scroll view that is
   * mid-animation and therefore "not at the bottom". A quick send races the rising
   * keyboard and lands under the composer.
   */
  BOOL _scrollingToLatest;

  /**
   * The rise itself, which is RETARGETABLE — and that is the whole point of it
   * existing rather than `-[UIScrollView setContentOffset:animated:]`.
   *
   * The end of a transcript moves while a rise towards it is in flight, all the
   * time and for ordinary reasons: a balloon is measured, a composer collapses
   * back to one line, a receipt's row opens over a quarter of a second. UIKit's
   * animated setter fixes its target when it is called, so the only way to aim
   * it somewhere new is to call it again — which does not retarget the movement,
   * it REPLACES it, from a standing start at the current position.
   *
   * Doing that once is a stutter. Doing it on every frame of a CSS transition,
   * which is what following a `height` animation amounts to, is a movement that
   * never gets past the first frame of its own easing: measured off a device
   * recording, the content grows about 0.9 points per frame and the offset
   * follows at 0.34, so the transcript falls behind the content it is pinned to
   * and then catches up in a lurch when the growth stops.
   *
   * So the rise keeps its own start, target and clock, and moving the target
   * leaves the other two alone. A target that moves smoothly produces a
   * trajectory that moves smoothly; a target that moves once produces exactly
   * the animation UIKit would have. Nothing anywhere decides which of those is
   * happening, which is what makes it robust — there is no threshold on speed or
   * distance to get wrong.
   */
  CADisplayLink *_riseLink;
  CGFloat _riseFrom;
  CGFloat _riseTarget;
  CFTimeInterval _riseStart;

  __weak EXPKeyboardInsets *_observedKeyboardInsets;

  /** Whether this view currently holds the sampler open. Balanced, so a drag
   * interrupted by the view leaving the window cannot leave it running. */
  BOOL _holdsKeyboardTracking;
  /** The editing field inside this view, from the notification that said so, so no frame walks the tree for it. */
  __weak UIView *_focusedDescendant;

  /** Built on demand, and only if something inside actually asks to be virtualized. */
  RCTVirtualViewContainerState *_virtualViewContainerState;

  /**
   * The first row that was on screen when the current mounting transaction
   * began, and where it was — see `-mountingTransactionWillMount:`.
   */
  __weak UIView *_firstVisibleView;
  CGRect _firstVisibleFrameBefore;
  NSInteger _firstVisibleTag;
  /** Set when this transaction has already moved the offset to the end itself. */
  BOOL _followedEndInTransaction;
  /*
   * Content grew while the reader was at the end, and the transaction has not
   * mounted yet. Whether that is a follow or a hold is decided once it has:
   * growth ABOVE what is on screen holds it still, growth at the end follows.
   */
  BOOL _followEndAfterMount;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    static const auto defaultProps = std::make_shared<const ExpoScrollViewProps>();
    _props = defaultProps;

    _scrollView = [[EXPScrollViewInner alloc] initWithFrame:self.bounds];
    _scrollView.delegate = self;
    /*
     * The safe area is composed here rather than by UIKit, so that it can be enabled per edge:
     * `contentInsetAdjustmentBehavior` has four modes and none of them is "the top but not the
     * bottom". Setting it to never means `contentInset` IS the whole story, which also makes the
     * arithmetic legible — there is one number per edge and this file computes it.
     */
    _scrollView.contentInsetAdjustmentBehavior = UIScrollViewContentInsetAdjustmentNever;
    /*
     * And the indicator's insets are ours too, for the same reason and one more.
     *
     * `automaticallyAdjustsScrollIndicatorInsets` defaults to YES, and what it does is ADD the
     * safe area to whatever `verticalScrollIndicatorInsets` is set to. `-_applyIndicatorInsets`
     * already composes the safe area into that number, so leaving this on counts it twice and
     * puts the scroll bar one whole top safe area below the content it belongs to.
     *
     * The native transcript sets it to NO as well; see `-_applyIndicatorInsets`.
     */
    _scrollView.automaticallyAdjustsScrollIndicatorInsets = NO;
    /*
     * On, which is the platform default and NOT React Native's. With it off, a press is delivered
     * at touch-down and cancelled a moment later when the pan wins — a flicker on every scroll that
     * begins over a control, and the clearest tell that a UI was not built with the platform's
     * gestures.
     */
    _scrollView.delaysContentTouches = YES;
    _scrollView.keyboardDismissMode = UIScrollViewKeyboardDismissModeInteractive;
    /*
     * Pan vertically even when the content fits.
     *
     * Plain `UIScrollView` does not — `bounces` alone only governs what happens PAST an end that
     * exists, so a short list has no vertical pan at all. `UITableView` sets this, every native
     * list rubber-bands whether or not it has anywhere to go, and it is what a list feels dead
     * without.
     *
     * It is also, unexpectedly, what makes interactive keyboard dismissal work on a short screen:
     * that dismissal is driven by this scroll view's own pan, so without it a screen with three
     * messages offers no gesture to dismiss with and the keyboard cannot be pulled down at all.
     * The native chat app's transcript dismisses interactively with two messages in it.
     */
    _scrollView.alwaysBounceVertical = YES;
    /*
     * Tapping the status bar scrolls to the top — the earliest loaded message in a chat.
     *
     * `YES` is UIScrollView's default, and it is stated here because it is a behaviour this element
     * promises rather than one it happens to inherit. UIKit only honours it when exactly ONE scroll
     * view in the window claims it, so a screen with two of them gets nothing from either; that is
     * UIKit's rule and not something to work around.
     */
    _scrollView.scrollsToTop = YES;
    [self addSubview:_scrollView];

    _containerView = [[UIView alloc] initWithFrame:CGRectZero];
    [_scrollView addSubview:_containerView];

    _appliedInset = UIEdgeInsetsZero;

    // The END of editing is heard as well as the beginning, because whose
    // keyboard it is decides whether this list may dismiss it — see
    // `-_applyKeyboardDismissMode`.
    for (NSNotificationName name in @[
           UITextFieldTextDidBeginEditingNotification,
           UITextViewTextDidBeginEditingNotification,
           UITextFieldTextDidEndEditingNotification,
           UITextViewTextDidEndEditingNotification
         ]) {
      [[NSNotificationCenter defaultCenter] addObserver:self
                                               selector:@selector(_focusDidMove:)
                                                   name:name
                                                 object:nil];
    }
  }
  return self;
}

- (void)dealloc
{
  [[NSNotificationCenter defaultCenter] removeObserver:self];
  /*
   * A `CADisplayLink` retains its target, so a live one here means this can never
   * get to `dealloc` at all — it is invalidated on the way out of the window,
   * and this is the backstop for the paths that do not go through one.
   */
  [_riseLink invalidate];
  _riseLink = nil;
  /*
   * The splitter holds the scroll view's real delegate, and a `UIScrollView`
   * deallocating with a stale one crashes. `RCTScrollViewComponentView` empties
   * its splitter here for the same reason.
   */
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
 * A bottom-anchored list holds the CONTENT still, not the offset.
 *
 * The offset is measured from the top, so anything that changes the content
 * ABOVE the viewport — older messages loaded in, a row that was a placeholder
 * being measured for the first time, an edit two hundred rows back — moves
 * everything the reader is looking at down by however much it added. Following
 * the end when AT the end is only half of what the anchor means: a reader who
 * has scrolled up needs anchoring too, or the page jumps under them.
 *
 * The mechanism is `maintainVisibleContentPosition`'s, because it is the right
 * one: remember the first partially-visible row and where it was, look for it
 * again once the transaction has mounted, and move the offset by however far it
 * travelled. It needs no estimate of what changed and no cooperation from
 * whatever changed it.
 *
 * Unconditional, and for BOTH anchors. Keeping the reader's place is not a
 * property of which end is fixed — a list anchored at the top has the same
 * problem the moment anything is inserted above the viewport — and a reader who
 * has to be told twice to keep their place has been told once too often. React
 * Native gates the same mechanism behind a prop; this does not.
 */
- (void)mountingTransactionWillMount:(const facebook::react::MountingTransaction &)transaction
                withSurfaceTelemetry:(const facebook::react::SurfaceTelemetry &)surfaceTelemetry
{
  _firstVisibleView = nil;
  _firstVisibleFrameBefore = CGRectZero;
  _firstVisibleTag = 0;
  _followedEndInTransaction = NO;
  _followEndAfterMount = NO;

  /*
   * The ROWS, which are a level deeper than they look.
   *
   * `<native:scroll>` always mounts exactly one child — the content container
   * that `contentContainerStyle` styles — because a scrolling container is a
   * viewport and one thing inside it. So this view's own subviews are that
   * single container, and the rows are ITS subviews. Iterating one level too
   * high finds one view that never moves, which is a delta of zero on every
   * transaction and an anchor that quietly does nothing.
   */
  UIView *content = _containerView.subviews.firstObject;
  if (content == nil) {
    return;
  }

  /*
   * WHICH visible row to hold depends on which END is anchored, and getting this
   * wrong is invisible until something resizes BETWEEN the pinned row and the
   * one the reader is actually watching.
   *
   * A TOP-anchored list holds the first visible row: the reader's eye is at the
   * top, changes happen below it, and pinning the top keeps the page still.
   *
   * A BOTTOM-anchored transcript is the mirror image and must hold the LAST
   * visible row. The reader's eye is on the newest message at the bottom; the
   * churn — a receipt arriving or leaving under an OLDER message — happens above
   * it. Pinning the first visible row there anchors the wrong end: that row's
   * TOP does not move when a receipt collapses lower down, so the delta reads
   * zero and the correction never runs, while every row below it — the newest
   * message included — rises by the receipt's height: the newest balloon jumps
   * by a receipt line as an older message's `Delivered` leaves, because nothing
   * holds it.
   */
  const auto &anchorProps = static_cast<const ExpoScrollViewProps &>(*_props);
  const BOOL bottomAnchored = anchorProps.contentAnchor == ExpoScrollContentAnchor::Bottom;

  if (bottomAnchored) {
    // The last row whose TOP is above the visible bottom — the bottom-most row
    // any of which can be seen. The visible bottom excludes the bottom inset,
    // which is the composer's reserve: a row hidden behind the bar is not what
    // the reader is watching.
    const CGFloat visibleBottom = _scrollView.contentOffset.y + _scrollView.bounds.size.height -
        _scrollView.adjustedContentInset.bottom;
    for (UIView *row in content.subviews.reverseObjectEnumerator) {
      if (CGRectGetMinY([self _rowFrame:row]) < visibleBottom) {
        _firstVisibleView = row;
        _firstVisibleFrameBefore = [self _rowFrame:row];
        _firstVisibleTag = row.tag;
        return;
      }
    }
    // Everything is below the viewport (content just grew past a short rest).
    // The first row is then the nearest thing to an anchor there is.
    UIView *first = content.subviews.firstObject;
    if (first != nil) {
      _firstVisibleView = first;
      _firstVisibleFrameBefore = [self _rowFrame:first];
      _firstVisibleTag = first.tag;
    }
    return;
  }

  /*
   * The first row whose BOTTOM is past the top of the viewport — the first one
   * any of which can be seen. Not the first FULLY visible one: a row half off
   * the top is still what the reader's eye is anchored to, and choosing the next
   * one down would let that half-row resize unnoticed.
   */
  const CGFloat top = _scrollView.contentOffset.y;
  for (UIView *row in content.subviews) {
    if (CGRectGetMaxY([self _rowFrame:row]) > top) {
      _firstVisibleView = row;
      _firstVisibleFrameBefore = [self _rowFrame:row];
      _firstVisibleTag = row.tag;
      return;
    }
  }
  // Everything is above the viewport, which happens when the content has just
  // shrunk. The last row is then the nearest thing to an anchor there is.
  UIView *last = content.subviews.lastObject;
  if (last != nil) {
    _firstVisibleView = last;
    _firstVisibleFrameBefore = [self _rowFrame:last];
    _firstVisibleTag = last.tag;
  }
}

/**
 * A row's frame in the SCROLL VIEW's own space, which is the space the offset is
 * in.
 *
 * Not `row.frame`, which is relative to the content container — and the content
 * container can move too, so a delta taken in its space would miss exactly the
 * case where everything shifted together.
 */
- (CGRect)_rowFrame:(UIView *)row
{
  return [row.superview convertRect:row.frame toView:_scrollView];
}

- (void)mountingTransactionDidMount:(const facebook::react::MountingTransaction &)transaction
               withSurfaceTelemetry:(const facebook::react::SurfaceTelemetry &)surfaceTelemetry
{
  UIView *row = _firstVisibleView;
  _firstVisibleView = nil;
  const BOOL followEnd = _followEndAfterMount;
  _followEndAfterMount = NO;
  if (row == nil || row.superview == nil) {
    [self _followEndIfAsked:followEnd];
    return;
  }
  /*
   * The row has to be the SAME row. View recycling reuses a view for different
   * content, and a tag that has changed means the frame being compared belongs
   * to something else — an adjustment computed from that is a jump rather than
   * a correction.
   */
  if (row.tag != _firstVisibleTag) {
    [self _followEndIfAsked:followEnd];
    return;
  }
  /*
   * Nothing to do if this transaction already took the offset to the end: the
   * end moved by exactly what was added, the scroll went with it, and adding the
   * delta on top would push the list past its own content.
   */
  if (_followedEndInTransaction) {
    return;
  }
  /*
   * A bottom-anchored list pins the anchor row's BOTTOM edge; a top-anchored one
   * its TOP. This is the anchor's whole meaning — keep the bottom stable, or the
   * top — and using the wrong edge is invisible until the row itself changes
   * HEIGHT rather than just moving.
   *
   * The case it fixes: the newest balloon's own read-indicator opens its space
   * BELOW the bubble while the list sits at the bottom. The row's top does not
   * move, so a top-edge delta reads zero and nothing follows — the receipt opens
   * behind the composer and the content never rises to clear it. Its
   * bottom edge extends by exactly the receipt's height, so a bottom-edge delta
   * drives the offset down by that much and the transcript rises to keep the
   * newest and its receipt in view. The mirror case — an OLDER receipt leaving
   * above the newest — moves the whole row up rigidly, so top and bottom deltas
   * agree there and the newest still holds. One edge, both behaviours, tracked
   * per layout-transition frame.
   */
  const auto &anchorProps = static_cast<const ExpoScrollViewProps &>(*_props);
  const BOOL bottomAnchored = anchorProps.contentAnchor == ExpoScrollContentAnchor::Bottom;
  const CGRect nowFrame = [self _rowFrame:row];
  CGFloat delta = bottomAnchored
      ? CGRectGetMaxY(nowFrame) - CGRectGetMaxY(_firstVisibleFrameBefore)
      : CGRectGetMinY(nowFrame) - CGRectGetMinY(_firstVisibleFrameBefore);
  if (followEnd) {
    /*
     * Content grew under a reader at the end. Growth ABOVE the row moves its
     * top; growth of the row itself — a receipt opening under the newest
     * balloon — or below it does not. The first is held still by the top's
     * travel; the second is the arrival the rise is for.
     */
    const CGFloat topDelta = CGRectGetMinY(nowFrame) - CGRectGetMinY(_firstVisibleFrameBefore);
    if (fabs(topDelta) <= 0.5) {
      [self _scrollToBottomAnimated:YES];
      return;
    }
    delta = topDelta;
  }
  // Half a point, which is the same threshold RN uses: below that it is
  // rounding, and writing the offset for rounding costs a scroll event.
  if (fabs(delta) <= 0.5) {
    return;
  }
  [EXPKeyboardTrace record:@"pin delta=%.1f offset %.1f", delta, _scrollView.contentOffset.y];

  /*
   * Not while the offset is owned elsewhere — two writers on one number is the
   * trap this file keeps a rule about.
   *
   * A rise is already aimed at the end, and cleverness here — nudging its
   * endpoints per mount, retargeting it from live content — either accumulates
   * or does nothing. A FINGER and the bounce it leaves behind own it just as
   * much: past the end the offset is where someone put it, and holding an anchor
   * against a rubber band writes a position the bounce is already leaving, which
   * is the jump seen when a message is sent from an over-scrolled transcript.
   * UIKit brings a bounce home on its own; the mount has nothing to correct.
   */
  if (![self _mayMoveOffset]) {
    [self _followEndIfAsked:followEnd];
    return;
  }
  /*
   * Inside the list's own range, always.
   *
   * A hold keeps what is on screen still by moving the offset against the
   * content — which only makes sense where there is somewhere to move it. A
   * transcript SHORTER than its viewport has one legal position, its resting
   * one, and holding an anchor there writes an offset the list cannot honour:
   * the content slides down by the delta and stays there, over-scrolled. That is
   * the "sending pulls the transcript down" report — the first messages in an
   * empty chat, where each receipt closing under the previous balloon shrinks
   * the content by its height and the hold pushed the whole stack down by the
   * same amount, again per message until the screen filled.
   *
   * When the content does fit, `resting` and the limit are the same number, so
   * this reads as "no hold at all" without a case of its own.
   */
  const CGFloat resting = -_appliedInset.top;
  const CGFloat wanted = _scrollView.contentOffset.y + delta;
  const CGFloat next = MAX(resting, MIN([self _maxOffsetY], wanted));
  if (fabs(next - _scrollView.contentOffset.y) <= 0.5) {
    return;
  }
  _scrollView.contentOffset = CGPointMake(_scrollView.contentOffset.x, next);
}

/** The follow a transaction's growth asked for, once the hold has had its say. */
- (void)_followEndIfAsked:(BOOL)asked
{
  if (asked) {
    [self _scrollToBottomAnimated:YES];
  }
}

#pragma mark - RCTVirtualViewContainerProtocol

/**
 * The state a `VirtualView` inside this scroll view attaches itself to.
 *
 * `RCTVirtualViewComponentView` finds its container by walking `superview` for
 * anything that answers this selector, so implementing it is the whole of being
 * a virtualization container — the state does the rest, computing each virtual
 * view's mode from this view's `contentOffset` and bounds and re-computing it on
 * every scroll it hears about.
 *
 * Built on demand: a scroll view with no `VirtualView` in it never makes one,
 * and therefore never registers a listener.
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
 * The composed inset: what the author asked for, plus the safe area on the edges this view runs
 * past and that are switched on, plus whatever the keyboard is claiming at the bottom.
 *
 * The author's inset is ADDED rather than replacing the automatic part: asking for eight points of
 * breathing room at the bottom means eight more than the keyboard needs, not eight instead of it.
 *
 * The keyboard and the bottom safe area do not sum. The keyboard is drawn OVER the home indicator,
 * so reserving for both would reserve the same points twice and leave a gap under the keyboard —
 * the larger claim is the true one.
 */
/**
 * Where the scroll indicator may be drawn.
 *
 * Separate from the content's inset because it does not depend only on it: a
 * rounded, clipping ancestor cuts the indicator's ends off without changing
 * anything about where content sits, so this has to run on layout rather than
 * only when an inset changes.
 */
- (void)_applyIndicatorInsets
{
  UIEdgeInsets safeArea = self.safeAreaInsets;
  UIEdgeInsets composed = [self _composedInset];
  /*
   * The indicator takes the content's top and bottom but the SAFE AREA's sides.
   *
   * Vertically it must follow the content, or an indicator running under the keyboard reports a
   * scroll position the reader cannot see. Horizontally it must not: the author's `contentInset`
   * is about where content sits, and an indicator is chrome, which belongs inside the safe area
   * whatever the content is doing. In landscape on a notched device those differ — content may go
   * edge to edge on purpose while the indicator must not sit under the cutout.
   *
   * This is what the native transcript does, read rather than reasoned:
   * its collection view's `setScrollIndicatorInsets:` override passes the caller's top and bottom
   * through untouched and replaces left and right with `self.safeAreaInsets`, picking the side by
   * layout direction. Apple also sets `automaticallyAdjustsScrollIndicatorInsets` to NO, which is
   * the same decision said the other way: UIKit's automatic answer ties them together, and a
   * transcript wants them apart.
   */
  /*
   * And past the CORNERS of whatever is clipping it.
   *
   * An indicator is drawn inside the scroll view, so a rounded ancestor with
   * `overflow: hidden` cuts both of its ends off — the arc crosses the
   * indicator's own column for the first and last `radius` points. It reads as
   * a scroll bar that stops short of the list it belongs to, which is what it
   * is.
   *
   * The radius is the ancestor's rather than this view's, because that is where
   * an author puts it: a card with rounded corners holding a plain list is the
   * shape this came from, and the scroll view in it has no radius at all.
   */
  const CGFloat corner = [self _clippingCornerRadius];
  UIEdgeInsets indicator = UIEdgeInsetsMake(
      composed.top + corner, safeArea.left, composed.bottom + corner, safeArea.right);
  _scrollView.verticalScrollIndicatorInsets = indicator;
  _scrollView.horizontalScrollIndicatorInsets = indicator;
}

/**
 * The author's inset, plus whatever the safe area and the keyboard add to it.
 */
- (UIEdgeInsets)_composedInset
{
  const auto &props = static_cast<const ExpoScrollViewProps &>(*_props);
  UIEdgeInsets safeArea = self.safeAreaInsets;

  UIEdgeInsets composed;
  composed.top = props.contentInset.top + (props.automaticInsets.top ? safeArea.top : 0);
  composed.left = props.contentInset.left + (props.automaticInsets.left ? safeArea.left : 0);
  composed.right = props.contentInset.right + (props.automaticInsets.right ? safeArea.right : 0);
  composed.bottom =
      props.contentInset.bottom + MAX(props.automaticInsets.bottom ? safeArea.bottom : 0, _keyboardInset);
  return composed;
}

- (void)_applyInsets
{
  const auto &props = static_cast<const ExpoScrollViewProps &>(*_props);
  UIEdgeInsets safeArea = self.safeAreaInsets;
  UIEdgeInsets composed = [self _composedInset];

  if (UIEdgeInsetsEqualToEdgeInsets(composed, _appliedInset)) {
    /*
     * The CONTENT has nothing to do, but the indicator still might.
     *
     * Its inset depends on the corners clipping it as well as on the content
     * inset, and a scroll view whose content inset never changes returns here on
     * its very first layout — which is what the composer's panel list does, and
     * without this call it would never reach the indicator code at all.
     */
    [self _applyIndicatorInsets];
    return;
  }

  [EXPKeyboardTrace record:@"insets top=%.1f bottom=%.1f | safeArea=%.1f,%.1f kbInset=%.1f authored=%.1f",
                           composed.top, composed.bottom, safeArea.top, safeArea.bottom, _keyboardInset,
                           props.contentInset.bottom];

  /*
   * Asked BEFORE the inset moves, because the inset moving is what makes the answer change.
   *
   * This is the case the platform's transcript models with a scroll intent its composer can update: focusing the
   * composer raises the keyboard, and typing a second line makes the composer taller, and both
   * change how much of the transcript is covered. A reader at the newest message expects to still
   * be at the newest message afterwards — without this the content stays put and the last row
   * slides behind the composer.
   */
  /*
   * The remembered intent, not a measurement taken now.
   *
   * `_wasAtBottom` is what the view was the last time it scrolled or was placed there, which is
   * the platform transcript's model: the scroll INTENT is state that the user's scrolling updates,
   * and layout changes ENFORCE it. Asking "am I at the bottom" at the moment an inset changes
   * looks equivalent and is not — inside a native stack the screen is being resized at the same
   * time, and the question gets answered against a view that is briefly neither where it was nor
   * where it is going. Measured: the same chat follows the keyboard on its own and does not
   * inside a react-native-screens stack, with the newest two messages ending up behind the
   * composer.
   */
  const auto &anchorProps = static_cast<const ExpoScrollViewProps &>(*_props);
  BOOL followBottom = anchorProps.contentAnchor == ExpoScrollContentAnchor::Bottom &&
      (_wasAtBottom || [self _isAtBottom] || _scrollingToLatest);

  /*
   * A scroll view rests at `-contentInset.top`, not at zero, so a top inset that arrives AFTER the
   * content leaves the view scrolled by exactly that much.
   *
   * Without this, a first layout that composes a 62 point top inset for the status bar leaves the
   * offset where it was and the screen opens 62 points down, with its first row under the clock.
   * `contentInsetAdjustmentBehavior` is `Never` here — deliberately, since UIKit has no mode for
   * "the top but not the bottom" — and this is the part of the automatic behaviour that comes
   * with it.
   *
   * Applying the DELTA rather than assigning `-composed.top` is what makes it safe for a reader
   * who is not at the top: the content stays where they are looking. At rest the delta does the
   * obvious thing, because their offset is the old rest position by definition.
   */
  const CGFloat topDelta = composed.top - _appliedInset.top;
  /*
   * Read BEFORE the inset is assigned, because assigning it moves this.
   *
   * `UIScrollView` clamps `contentOffset` into the range the new inset allows as part of the
   * setter. Reading afterwards therefore reads a number that has already been corrected, and
   * applying the delta to THAT applies it twice: turning reservation off takes a view resting at
   * -62, UIKit clamps it to 0, and adding the 62 back leaves the content scrolled a full inset
   * above its own top, offscreen above the viewport with empty space under the status bar. It is
   * the one case the delta cannot be read late for.
   */
  const CGPoint offsetBeforeInset = _scrollView.contentOffset;

  _appliedInset = composed;
  // UIKit clamps the offset inside this setter and reports a scroll for it; that
  // is a repair, not a scroll, and is put back below.
  _offsetIsMidRepair = YES;
  _scrollView.contentInset = composed;
  _offsetIsMidRepair = NO;

  /*
   * Not while a finger is down, and not while an ANIMATION is in flight.
   *
   * The offset belongs to whatever is currently moving it. A drag owns it, and so
   * does a programmatic scroll — including the one UIKit runs when you tap the
   * status bar to go to the top. During that scroll a large title expands, which
   * changes this view's safe-area top on every frame, and adjusting the offset by
   * that delta means two things are writing the same number in the same frame.
   *
   * Two writers in one frame read as the header jumping and jumping back;
   * neither animation is wrong, they fight.
   *
   * `animationKeys` is how a UIScrollView says it is mid-flight without reaching
   * for private API.
   */
  /*
   * `animationKeys` alone is not enough: during a status-bar scroll-to-top it
   * reads EMPTY, because UIKit drives that scroll with its own animator rather
   * than a layer animation, and the header jumps.
   *
   * `scrollViewShouldScrollToTop:` / `scrollViewDidScrollToTop:` is the pair
   * UIKit provides to bracket exactly that scroll, so the flag they set is the
   * honest answer. `animationKeys` stays in the test because it does catch other
   * animated scrolls, and neither alone covers both.
   */
  const BOOL mayMove = [self _mayMoveOffset];
  if (topDelta != 0) {
    [EXPKeyboardTrace record:@"topDelta=%.1f applied=%d (track=%d decel=%d) safeTop=%.1f", topDelta,
                             (int)mayMove, (int)_scrollView.isTracking, (int)_scrollView.isDecelerating,
                             self.safeAreaInsets.top];
  }
  if (topDelta != 0 && mayMove) {
    CGPoint offset = offsetBeforeInset;
    offset.y -= topDelta;
    // Clamped into what the NEW inset allows. Keeping a reader's position is only meaningful
    // where that position still exists; a shrinking inset can leave the old one past the top.
    offset.y = MAX(-composed.top, MIN([self _maxOffsetY], offset.y));
    _scrollView.contentOffset = offset;
  } else if (!mayMove && !CGPointEqualToPoint(_scrollView.contentOffset, offsetBeforeInset)) {
    /*
     * PUT IT BACK. Assigning the inset moved it, and it was not ours to move.
     *
     * `-[UIScrollView setContentInset:]` clamps `contentOffset` into the range
     * the new inset allows, and that is a write like any other — so the rule the
     * guard above states, that a drag owns the offset, has to be enforced here as
     * well as obeyed. Skipping this view's own write is only half of it: UIKit
     * has already made one.
     *
     * A short, bottom-anchored transcript rests BELOW the minimum the inset
     * allows — the content is held above the keyboard rather than scrolled to,
     * so the offset is legitimately out of range while the keyboard is up. Every
     * frame of an interactive dismissal shrinks the inset, so every one of them
     * clamps. Traced on a device with the finger down: the offset goes -131.3,
     * -132.3, -122.0, -118.0, -115.3, -115.0 over six frames of the drag,
     * nineteen points of lurch, and then sits still for the remaining twenty
     * points of keyboard.
     *
     * Restoring rather than clamping is right for the same reason: the value read
     * at the top of this function IS the drag's own current position, since
     * nothing else has written it this frame. When the finger lifts, `mayMove`
     * becomes true and the ordinary path settles it — and anything still out of
     * range rubber-bands, which is a spring rather than a step.
     */
    _offsetIsMidRepair = YES;
    _scrollView.contentOffset = offsetBeforeInset;
    _offsetIsMidRepair = NO;
  } else {
    [self _clampOffsetIfPastEnd];
  }
  [self _applyIndicatorInsets];

  // Both of these WRITE the offset, so both answer to the same rule as the two
  // above. A drag that is moving the content is not to be argued with.
  if (followBottom && ![self _offsetOwnedElsewhere]) {
    /*
     * ANIMATED while a rise is already in flight, instant otherwise.
     *
     * The composer collapsing back to one line at the end of a send changes this
     * inset in the frame AFTER the message is appended — and the append starts
     * an animated scroll to the end. An instant follow here cuts that animation
     * and jumps: traced, `from=-115.7 to=-75.3` in one frame, in the middle of
     * a rise from -116 to -55.3.
     *
     * Re-issuing it animated retargets the same movement at the end's new place,
     * which is what the reader is watching: one rise, to wherever the end has
     * settled.
     */
    [self _scrollToBottomAnimated:[self _isRising]];
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

  // Subviews of a scroll view are already in content coordinates, so this rect and contentOffset
  // are in the same space.
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

  // Clamped to what the scroll view can actually reach, or a field near the end would ask for an
  // offset past the content and the scroll would rubber-band back.
  CGFloat minOffset = -_appliedInset.top;
  CGFloat maxOffset =
      MAX(minOffset, _scrollView.contentSize.height - CGRectGetHeight(_scrollView.bounds) + _appliedInset.bottom);
  CGFloat target = MIN(MAX(offsetY + delta, minOffset), maxOffset);

  // Not animated: this runs on every frame of the keyboard's own animation, so the content tracks
  // the keyboard instead of chasing it with a second animation of its own.
  _scrollView.contentOffset = CGPointMake(_scrollView.contentOffset.x, target);
}

/**
 * Focus can also move while the keyboard is already up — tabbing from one field to the next — and
 * then no inset changes and nothing above would run.
 */
- (void)_focusDidMove:(NSNotification *)notification
{
  UIView *field = [notification.object isKindOfClass:UIView.class] ? notification.object : nil;
  const BOOL beginning =
      [notification.name isEqualToString:UITextFieldTextDidBeginEditingNotification] ||
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
  /*
   * The overlap with this view, not the obstruction's height: a scroll view that already stops
   * above the keyboard needs nothing, and one running to the window's edge needs all of it.
   */
  UIWindow *window = self.window;
  if (window == nil) {
    return;
  }
  CGRect inWindow = [self convertRect:self.bounds toView:window];
  /*
   * The obstruction is the keyboard AND whatever rides on it. A composer docked to the keyboard
   * covers the messages behind it exactly as the keyboard does, and clearing only the keyboard
   * leaves the newest one underneath the bar.
   *
   * A dock wins whenever one answers, not the smaller of it and the guide: before the keyboard has
   * moved once in a run the guide can still report the outgoing screen's accessory, and a stale
   * answer winning reads as the transcript stepping backwards as the keyboard begins to rise. See
   * `-[EXPKeyboardInsets _measuredObstructionTopForObstruction:]`.
   */
  CGFloat obstructionTop = [_observedKeyboardInsets obstructionTopInWindowForObstruction:geometry.height];
  _keyboardInset = MAX(CGRectGetMaxY(inWindow) - obstructionTop, 0);
  [EXPKeyboardTrace
      record:@"kb h=%.1f obstrTop=%.1f -> inset=%.1f | screen#%ld offset=%.1f track=%d decel=%d anim=%lu csH=%.1f bH=%.1f max=%.1f",
             geometry.height, obstructionTop, _keyboardInset, (long)_observedKeyboardInsets.identifier,
             _scrollView.contentOffset.y,
             (int)_scrollView.isTracking, (int)_scrollView.isDecelerating,
             (unsigned long)_scrollView.layer.animationKeys.count, _scrollView.contentSize.height,
             CGRectGetHeight(_scrollView.bounds), [self _maxOffsetY]];

  [self _applyInsets];
}

/**
 * Tell the view controller that THIS is its content scroll view.
 *
 * `-[UIViewController setContentScrollView:forEdge:]` is what a navigation bar
 * watches, and handing it over is the whole of a long list of platform
 * behaviour an app otherwise has to fake: a large title that shrinks into the
 * bar as you scroll, the bar's scroll-edge appearance changing when content
 * goes under it, and tapping the status bar to return to the top.
 *
 * UIKit will guess if nobody says — `_contentScrollViewHeuristic` walks the
 * hierarchy looking for one — but it does not find this one. The scroll view is
 * not the screen's view, it is a `UIScrollView` nested inside a component view
 * inside whatever the navigator mounted, and without this the large title does
 * not move on scroll: measured at 40.7 points tall before a drag and 40.7 after.
 * `react-native-screens` registers a scroll view explicitly on its newer stack
 * for the same reason and does not on the one in use here.
 *
 * Said from THIS side rather than the navigator's, because it is true wherever
 * this element is mounted — under `react-native-screens`, under a
 * `UINavigationController` an app wrote itself, or under nothing at all, where
 * there is no controller and this does nothing.
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

/*
 * The corner inset is a LAYOUT fact, so it is applied from layout.
 *
 * `_applyInsets` runs when something about the insets changes — the safe area,
 * the keyboard, the props, the metrics — and a scroll view whose insets never
 * change never reaches it. The list inside the composer's panel is exactly
 * that: it has no insets of its own and sits in a card whose radius is the only
 * thing cutting its indicator, so this is the only path that reaches it.
 */
- (void)layoutSubviews
{
  [super layoutSubviews];
  if (@available(iOS 26.0, *)) {
    // Recorded so a run shows the style the view ended up with.
    UIScrollEdgeEffect *top = _scrollView.topEdgeEffect;
    NSString *style = top.style == UIScrollEdgeEffectStyle.softStyle ? @"soft"
        : top.style == UIScrollEdgeEffectStyle.hardStyle          ? @"hard"
                                                                   : @"automatic";
    [EXPKeyboardTrace recordChanged:@"edge" pinned:NO format:@"edge top=%@ hidden=%d", style, (int)top.hidden];
  }
  // Only the INDICATOR. `_applyInsets` also moves the content offset when the
  // inset changes, and running that from layout would put an offset adjustment
  // on a path that had never carried one.
  [self _applyIndicatorInsets];
}

/**
 * A list INSIDE the keyboard cannot be the thing that dismisses it.
 *
 * `keyboardDismissMode` defaults to interactive, which is right for a page: drag
 * the content and the keyboard follows your finger down. It is incoherent for a
 * list that is part of the keyboard — `<native:keyboardpanel>`'s card is hosted
 * in `UIRemoteKeyboardWindow`, so scrolling it drags the keys up and down under
 * it, and the drag catches on the accessory.
 *
 * Decided from the WINDOW rather than from a prop, because it is not the
 * author's choice to get wrong: nothing an app puts inside the keyboard should
 * be able to pull the keyboard away. The author's own value is remembered and
 * takes effect again the moment the list is somewhere else.
 */
- (UIScrollViewKeyboardDismissMode)_wantedKeyboardDismissMode
{
  // A list INSIDE the keyboard cannot be the thing that dismisses it; see the
  // comment above. Decided from the window, never from the author's value.
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
 * Write the mode, and ONLY when it differs from the one already there.
 *
 * The guard is the point of this method, not an optimisation. This runs from
 * `-updateProps` — so from every commit — and from `-didMoveToWindow`, which
 * fires during a navigation transition. Assigning `keyboardDismissMode` while
 * UIScrollView is tracking an interactive dismissal ends the tracking, and the
 * keyboard stops following the finger and animates away instead — it vanishes
 * mid-drag.
 *
 * Fixing the VALUE cannot help, because the decision above is already right and
 * it is the WRITE that does the damage. A property whose assignment has a side
 * effect on an in-flight gesture is not idempotent, and code that recomputes it
 * every commit has to treat it that way.
 *
 * Split from `-_wantedKeyboardDismissMode` so there is exactly one place that
 * decides and exactly one that writes.
 */
- (void)_applyKeyboardDismissMode
{
  const UIScrollViewKeyboardDismissMode wanted = [self _wantedKeyboardDismissMode];
  if (_scrollView.keyboardDismissMode == wanted) {
    return;
  }
  _scrollView.keyboardDismissMode = wanted;
  // Only on a real WRITE. An evaluation that changes nothing is not an event,
  // and the question this answers is whether a write landed during a drag.
  [EXPKeyboardTrace record:@"dismissMode WROTE %ld (tracking=%d dragging=%d)",
                           (long)wanted,
                           (int)_scrollView.isTracking,
                           (int)_scrollView.isDragging];
}

- (void)didMoveToWindow
{
  [super didMoveToWindow];
  // The window decides this, so it is revisited whenever the window changes.
  [self _applyKeyboardDismissMode];
  // A hold on the sampler is released before the sampler is let go of, or the
  // hold is stranded and its display link never parks.
  [self _endKeyboardTracking];
  [_observedKeyboardInsets removeObserver:self];
  _observedKeyboardInsets = nil;
  if (self.window != nil) {
    // Held BEFORE registering: `addObserver:` calls back at once with the
    // current geometry, and the callback asks this reference for the top.
    _observedKeyboardInsets = [EXPKeyboardInsets insetsForView:self];
    [_observedKeyboardInsets addObserver:self];
    [self _becomeTheContentScrollView];
  } else {
    // Nothing will recompute this until the keyboard next moves, so a view that leaves the window
    // mid-transition would come back still inset for a keyboard that has gone.
    _keyboardInset = 0;
    /*
     * And a rise stops at the edge of the window, both because there is nothing
     * to see and because the link retains this view — a transcript pushed off
     * screen mid-rise would otherwise stay alive, and keep writing an offset, for
     * as long as the animation had left to run.
     */
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
  // Both axes get the same answer, and UIScrollView shows only the indicator for an axis that can
  // actually scroll — so there is no `horizontal` prop to decide between them.
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
  // After super, which is what installs `_props`: the inset composition reads the new props off it.
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

  // Both read BEFORE the new size is adopted, or the questions become unanswerable: afterwards
  // there is nothing left to compare against.
  BOOL wasEmpty = CGSizeEqualToSize(_contentSize, CGSizeZero);
  BOOL grew = contentSize.height > _contentSize.height;
  if (contentSize.height != _contentSize.height) {
    [EXPKeyboardTrace record:@"state cs %.1f -> %.1f", _contentSize.height, contentSize.height];
  }
  BOOL followContent = grew && (_wasAtBottom || _scrollingToLatest) && !wasEmpty;

  _contentSize = contentSize;
  _containerView.frame = CGRect{RCTCGPointFromPoint(data.contentBoundingRect.origin), contentSize};
  /*
   * `-[UIScrollView setContentSize:]` CLAMPS the offset, and that clamp is not
   * this view's decision to make.
   *
   * The same rule the inset already follows, for the same reason and with a
   * more visible cost. A short bottom-anchored transcript legitimately rests
   * BELOW the minimum the inset allows — the content is held above the keyboard
   * rather than scrolled to — so a new message arriving finds the offset out of
   * range and UIKit snaps it into range in the same frame the size changes.
   * Traced on a send from a two-line composer: offset -15 before, content
   * 407 to 419.3, and the offset at -63 by the time the code below runs, so the
   * ANIMATED scroll that is supposed to show the transcript rising to meet the
   * message has `from` and `to` both -63 and nothing left to do. Forty-eight
   * points in one frame.
   *
   * Put back, and then the decision below — follow the end, or clamp — owns the
   * offset and gets to animate it.
   */
  /*
   * The undo is not enough on its own: the clamp is DELIVERED before it.
   *
   * `setContentSize:` clamps synchronously and UIKit calls `scrollViewDidScroll:`
   * for that write, so the phantom offset reaches `-_updateStateWithContentOffset`
   * — and the `_wasAtBottom` sampling — a line before it is put back. Traced on
   * every send:
   *
   *     state cs 14244.7 -> 14232.0
   *     offset 13749.7 d=-12.7      <- UIKit clamps by the receipt's height
   *     offset 13762.3 d=+12.7      <- put back here
   *
   * A negative step is content moving DOWN, and 12.7 is exactly the row that
   * closed. Both writes land in one runloop turn so the LAYER should never show
   * the intermediate — but React does, because state is pushed per callback
   * rather than per commit, and a transcript that virtualises off the offset can
   * act on a position the reader was never at.
   *
   * So the repair is announced. The offset between these two lines is not a
   * position anybody chose; it is UIKit's arithmetic about a size this view has
   * not finished changing, and the decision below is what actually owns it.
   */
  const CGPoint offsetBeforeSize = _scrollView.contentOffset;
  _offsetIsMidRepair = YES;
  _scrollView.contentSize = contentSize;
  if (!CGPointEqualToPoint(_scrollView.contentOffset, offsetBeforeSize)) {
    _scrollView.contentOffset = offsetBeforeSize;
  }
  _offsetIsMidRepair = NO;

  const auto &props = static_cast<const ExpoScrollViewProps &>(*_props);
  if (props.contentAnchor == ExpoScrollContentAnchor::Bottom) {
    // Either the first content, which is where a chat starts, or more of it arriving under a reader
    // who was already at the end. Someone who has scrolled up to read something older is left
    // alone, because moving them is the bug rather than the feature.
    /*
     * ANIMATED when content arrives, instant when it is the first content.
     *
     * A message appended under a reader who is already at the end should be
     * seen to arrive — the transcript rising to meet it is the arrival. Setting
     * the offset outright makes it a cut: the balloon is simply already there,
     * and the eye reads that as the list flinching.
     *
     * The first fill is the exception and must not animate: there is no
     * previous position for it to have come from, so animating it would show a
     * conversation scrolling in from nowhere every time the screen opened.
     *
     * Arriving content is followed once the transaction has mounted, when it
     * is known whether it arrived at the end or above the reader — rows above
     * the viewport taking their real height must not read as an arrival. See
     * `_followEndAfterMount`.
     */
    if (wasEmpty) {
      [self _scrollToBottom];
      return;
    }
    if (followContent) {
      _followEndAfterMount = YES;
      return;
    }
  }
  /*
   * Content that SHRANK moves the end without moving the reader, so the offset
   * can be left past it — unless a RISE is in flight, which is the one case
   * where leaving it is not enough.
   *
   * An animated follow is aiming at the end as it was when it started. If the
   * content shrinks while it is running — a balloon measured at one width and
   * re-measured narrower, a receipt appearing and settling — the animation lands
   * past the new end and leaves a gap under the last message — too much space
   * under a new bubble — and clamping the offset here is overwritten by the
   * animation's next frame. Rare, because it needs the shrink to fall inside
   * the third of a second the rise takes.
   *
   * Re-issuing the rise retargets it at the end's new place, which is the same
   * movement arriving somewhere slightly different.
   */
  if ([self _isRising]) {
    [self _scrollToBottomAnimated:YES];
    return;
  }
  /*
   * A bottom-anchored reader AT the end when the content shrinks rides down
   * ANIMATED, not clamped. The state's content size arrives in one jump — a
   * receipt's row closing commits its end height at once while the mounted
   * rows glide over the next quarter second — so an instant clamp here snaps
   * the transcript down by the whole change and the gliding rows then chase
   * it. Ridden on the rise, the offset and the rows arrive together.
   *
   * Only within a viewport of the end, which is the distance at which a
   * movement is legible at all; past that it is a cut either way, and the
   * clamp is the cheaper cut.
   */
  const auto &shrinkProps = static_cast<const ExpoScrollViewProps &>(*_props);
  if (shrinkProps.contentAnchor == ExpoScrollContentAnchor::Bottom &&
      _wasAtBottom && [self _mayMoveOffset]) {
    const CGFloat limit = [self _maxOffsetY];
    const CGFloat past = _scrollView.contentOffset.y - limit;
    if (past > 0.5 && past < CGRectGetHeight(_scrollView.bounds)) {
      [EXPKeyboardTrace record:@"shrink-follow past=%.1f", past];
      [self _riseTo:limit animated:YES];
      return;
    }
  }
  [self _clampOffsetIfPastEnd];
}

/**
 * The furthest this can scroll, which is the resting offset while the content still fits.
 *
 * That is what makes a chat start at the TOP: a conversation with three messages shows them from
 * the top of the screen, and only once the content outgrows the viewport does "the bottom" become a
 * different place. Nothing special-cases the short case — it falls out of the clamp.
 */
- (CGFloat)_maxOffsetY
{
  CGFloat resting = -_appliedInset.top;
  CGFloat furthest =
      _scrollView.contentSize.height - CGRectGetHeight(_scrollView.bounds) + _appliedInset.bottom;
  return MAX(resting, furthest);
}

/**
 * An offset PAST the end is not a position anyone chose, so it is corrected as soon as it appears.
 *
 * `UIScrollView` clamps `contentOffset` when a finger lets go of it, not when the inset or the
 * content size that define the limit move underneath it. Either one shrinking therefore leaves the
 * view over-scrolled — empty space below the last row — until the next thing that writes the
 * offset, which is typically the first frame of the keyboard rising.
 *
 * Measured in the chat: opening the `+` panel grows the obstruction and the transcript follows it
 * down; closing it shrinks the obstruction again and leaves the offset twenty-three points past the
 * end. Nothing looks wrong until the composer is focused, at which point the transcript lurches
 * BACKWARDS by exactly that much on the first frame of the keyboard's animation, and then follows
 * it up.
 *
 * Not `_scrollToBottom`: a clamp, not an intent. A reader who is somewhere in the middle is left
 * where they are; only an impossible position is corrected, and only to the nearest possible one.
 *
 * Never while something else owns the offset — a finger, a deceleration, an animation — because
 * the limit it would be clamped to is the one those are travelling towards.
 */
/**
 * Whether this view may move the content offset right now.
 *
 * The offset belongs to whatever is currently moving it: a finger, a
 * deceleration, or an animation. Writing it from here at the same time is two
 * things assigning one number every frame, and it looks like the scroll view
 * letting go of the touch.
 *
 * Every writer answers to it, not just the inset delta and the clamp:
 * `_scrollToBottom` and `_keepFocusedFieldVisible` run on every frame of a
 * keyboard move, which includes every frame of an INTERACTIVE dismissal, when the
 * finger is down. Unguarded, they read as the scroll letting go of the touch.
 *
 * Worst with little content, which is the tell: `_maxOffsetY` moves with the
 * bottom inset, and with a short transcript that target swings the full height of
 * the keyboard while a short list has almost no range to swing in. With a long
 * list the same fight moves the content by a point or two and nobody sees it.
 *
 * `animationKeys` is how a `UIScrollView` says it is mid-flight without private
 * API, and `_scrollingToTop` covers the one animated scroll it does not report —
 * UIKit drives the status-bar scroll with its own animator.
 */
/** Whether the follow's own animation is running — see `-_riseTo:animated:`. */
- (BOOL)_isRising
{
  return _riseLink != nil;
}

- (BOOL)_offsetOwnedElsewhere
{
  const BOOL animating = _scrollView.layer.animationKeys.count > 0 || _scrollingToTop;
  return _scrollView.isTracking || _scrollView.isDecelerating || animating;
}

/**
 * Whether a one-off correction — a clamp, an inset delta — may write the offset.
 *
 * The rise counts as an owner here and does NOT count in `-_offsetOwnedElsewhere`,
 * and the difference between those two questions is the whole reason there are
 * two of them. A correction that fires mid-rise is a second writer and loses to
 * the next frame of the animation anyway; a FOLLOW that fires mid-rise is the
 * same writer, aiming the movement it already owns at a new place.
 */
- (BOOL)_mayMoveOffset
{
  return ![self _offsetOwnedElsewhere] && ![self _isRising];
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
  [EXPKeyboardTrace record:@"clamp %.1f -> %.1f", _scrollView.contentOffset.y, limit];
  _scrollView.contentOffset = CGPointMake(_scrollView.contentOffset.x, limit);
}

- (void)_scrollToBottom
{
  [self _scrollToBottomAnimated:NO];
}

- (void)_scrollToBottomAnimated:(BOOL)animated
{
  _followedEndInTransaction = YES;
  [self _riseTo:[self _maxOffsetY] animated:animated];
  _wasAtBottom = YES;
}

/**
 * How long a rise takes, and on what curve.
 *
 * Measured off a recording of the native chat app rather than taken from UIKit's default,
 * by cross-correlating the row-average profile of the transcript between
 * consecutive frames: a receipt appearing moves the column 24 rows over fourteen
 * frames, and the per-frame deltas are `+1 +1 +2 +2 +2 +2 +2 +2 +2 +2 +2 +2 +1
 * +1`. Fourteen frames at 59.94fps is 234ms with the first and last partial, so
 * a quarter of a second — and SYMMETRIC, which rules out the spring a transcript
 * animation is usually assumed to be.
 *
 * The same quarter second and the same curve as the layout transitions this
 * follows, deliberately: a transcript whose content animates on one clock and
 * whose offset chases it on another moves twice.
 */
static const CFTimeInterval kExpoScrollRiseDuration = 0.25;

static facebook::react::TransitionTimingFunction ExpoScrollRiseCurve()
{
  // `ease-in-out`, spelled the way `TransitionConversions` spells it — and
  // evaluated by the renderer's own solver, so the offset and the boxes it is
  // following cannot drift apart on rounding.
  return facebook::react::TransitionTimingFunction{0.42f, 0.0f, 0.58f, 1.0f};
}

/**
 * Move to `target`, either at once or over `kExpoScrollRiseDuration`.
 *
 * Animated and ALREADY rising means retarget: the start and the clock are left
 * alone and only the destination changes, so the movement the reader is watching
 * carries on to somewhere slightly different instead of starting again. That is
 * the case UIKit has no API for and the reason this exists.
 */
- (void)_riseTo:(CGFloat)target animated:(BOOL)animated
{
  if (!animated) {
    [self _endRise];
    _scrollView.contentOffset = CGPointMake(_scrollView.contentOffset.x, target);
    return;
  }
  if ([self _isRising]) {
    if (_riseTarget != target) {
      [EXPKeyboardTrace record:@"rise retarget %.1f (cs=%.1f inset=%.1f)", target,
                               _scrollView.contentSize.height, _appliedInset.bottom];
    }
    _riseTarget = target;
    return;
  }
  /*
   * A rise that has nowhere to go is not started at all.
   *
   * Otherwise every commit that leaves the end where it already is costs a
   * display link for a quarter of a second, and — worse — makes `-_isRising`
   * true, which tells the inset and clamp paths that someone owns the offset when
   * nobody is moving it.
   */
  if (fabs(target - _scrollView.contentOffset.y) < 0.5) {
    _scrollView.contentOffset = CGPointMake(_scrollView.contentOffset.x, target);
    // Arrived without a scroll event to say so.
    _scrollingToLatest = NO;
    return;
  }
  [EXPKeyboardTrace record:@"rise start %.1f -> %.1f", _scrollView.contentOffset.y, target];
  _riseFrom = _scrollView.contentOffset.y;
  _riseTarget = target;
  _riseStart = CACurrentMediaTime();
  _riseLink = [CADisplayLink displayLinkWithTarget:self selector:@selector(_riseTick)];
  /*
   * At the DISPLAY's rate, not the default one — the same request the insets
   * sampler makes, for the same reason: left to itself a display link runs at
   * 60 on a ProMotion screen, so the offset stepped every OTHER frame of a
   * keyboard rise sampled at 120 and the transcript juddered at half the rate
   * of the keys it was following.
   */
  const float riseRate = (float)self.window.screen.maximumFramesPerSecond;
  if (riseRate > 0) {
    _riseLink.preferredFrameRateRange = CAFrameRateRangeMake(riseRate / 2, riseRate, riseRate);
  }
  [_riseLink addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];
}

- (void)_riseTick
{
  /*
   * A finger beats a rise, always. `-_scrollToBottomAnimated:` is a follow, and
   * following stops the moment the reader takes the list over — otherwise the
   * two write the offset in the same frame and neither wins.
   */
  if (_scrollView.isTracking || _scrollView.isDecelerating) {
    [self _endRise];
    return;
  }
  const CFTimeInterval elapsed = CACurrentMediaTime() - _riseStart;
  const double linear = MIN(1.0, MAX(0.0, elapsed / kExpoScrollRiseDuration));
  const double eased = ExpoScrollRiseCurve().evaluate(static_cast<facebook::react::Float>(linear));
  _scrollView.contentOffset = CGPointMake(_scrollView.contentOffset.x, _riseFrom + (_riseTarget - _riseFrom) * eased);
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
 * Scroll to the newest content — what an app calls after sending a message.
 *
 * Animated by default because it answers something the user just did: a message they sent should be
 * seen to arrive, where the same jump on someone else's message would be a lurch.
 */
- (void)_scrollToLatestAnimated:(BOOL)animated
{
  /*
   * A present intent beats a flick. A FOLLOW yields to deceleration — content
   * growing under a reader mid-flick must not steal the list — but this is the
   * opposite case: the user just did something (sent, focused) whose answer is
   * the newest message, and in the native chat app a transcript flicked toward history
   * switches to scrolling to the latest the moment the keyboard is revealed.
   * Left running, the momentum survives the rise's first tick and wins.
   * `setContentOffset:animated:NO` is UIKit's documented way to stop it.
   */
  if (_scrollView.isDecelerating) {
    [_scrollView setContentOffset:_scrollView.contentOffset animated:NO];
  }
  if (!animated) {
    _scrollingToLatest = NO;
    [self _scrollToBottom];
    return;
  }
  /*
   * FAR from the bottom is not an animation, and that is the fix for a lurch.
   *
   * An animated `setContentOffset:` fixes its target at the moment it is called.
   * The commonest caller is a composer being focused, and focusing raises the
   * keyboard — so the bottom inset then grows by the whole height of the keys
   * WHILE the animation is in flight, and `-_applyInsets` writes the offset on
   * every frame of that to keep the newest message above the keys. Two writers
   * on one property, one animated and one not, and they do not cancel: traced
   * from a transcript scrolled to its first message, the target is fixed at
   * 2915.8 with a bottom inset of 82.8, the inset grows to 399, and the offset
   * goes PAST the maximum — the newest balloon flies to 241 points above where
   * it belongs and is pulled back over the next 160ms.
   *
   * A viewport is the threshold because it is the distance at which an
   * animation stops being legible anyway: everything in it is replaced, so
   * there is no motion for a reader to follow, only a blur. Below that the
   * animation is the point — a sent message should be seen to arrive — and the
   * inset is not moving, because the keyboard is already where it is going.
   */
  const CGFloat distance = ABS([self _maxOffsetY] - _scrollView.contentOffset.y);
  if (distance > CGRectGetHeight(_scrollView.bounds)) {
    _scrollingToLatest = NO;
    [self _scrollToBottom];
    return;
  }
  _scrollingToLatest = YES;
  [self _riseTo:[self _maxOffsetY] animated:YES];
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
    [_scrollView setContentOffset:CGPointMake(_scrollView.contentOffset.x, -_appliedInset.top)
                         animated:animated];
    return;
  }
  [super handleCommand:commandName args:args];
}

/** Whether the view is at the end, within a tolerance a settled scroll can land inside. */
/**
 * At the end, within two points.
 *
 * NOT a loose threshold — on the order of 170 points — which answers a different
 * question: a reader three balloons up would still count as being at the end and
 * would be pulled down by an arriving message. The native transcript's scrolling
 * is driven by a remembered scroll intent rather than by a distance threshold,
 * and the behaviour a threshold would change is the one this demo is about.
 */
- (BOOL)_isAtBottom
{
  return _scrollView.contentOffset.y >= [self _maxOffsetY] - 2;
}

- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics
           oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics
{
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];
  _scrollView.frame = self.bounds;
  // The view may have moved relative to the safe area or the keyboard without changing size.
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
  static const auto defaultProps = std::make_shared<const ExpoScrollViewProps>();
  _props = defaultProps;
  _state.reset();
  _contentSize = CGSizeZero;
  _keyboardInset = 0;
  _appliedInset = UIEdgeInsetsZero;
  _wasAtBottom = NO;
  _scrollingToTop = NO;
  _scrollingToLatest = NO;
  _focusedDescendant = nil;
  [self _endKeyboardTracking];
  [self _endRise];
  _scrollView.contentInset = UIEdgeInsetsZero;
  _scrollView.contentOffset = CGPointZero;
  _scrollView.contentSize = CGSizeZero;
  /*
   * DROPPED on recycle, not reused. The state holds the virtual views that were
   * inside the old content and is registered as a listener on this view; a
   * recycled scroll view has different content, and keeping the old state would
   * keep computing modes for rows that are gone.
   */
  _virtualViewContainerState = nil;
}

#pragma mark - Events

- (ExpoScrollEvent)_scrollEvent
{
  ExpoScrollEvent event;
  event.contentOffset = RCTPointFromCGPoint(_scrollView.contentOffset);
  event.contentSize = RCTSizeFromCGSize(_scrollView.contentSize);
  event.containerSize = RCTSizeFromCGSize(_scrollView.bounds.size);
  event.inset = EdgeInsets{
      .left = static_cast<Float>(_appliedInset.left),
      .top = static_cast<Float>(_appliedInset.top),
      .right = static_cast<Float>(_appliedInset.right),
      .bottom = static_cast<Float>(_appliedInset.bottom)};
  event.timestamp = CACurrentMediaTime();
  return event;
}

/**
 * How far a rounded, clipping ancestor eats into this view's edges.
 *
 * The largest corner radius on any ancestor that clips, in this view's own
 * coordinates — walked rather than asked for, because the radius belongs to a
 * view that has no idea a scroll view is inside it.
 *
 * Stops at the first ancestor that does NOT clip: a rounded view that lets its
 * children paint outside itself is not cutting anything off, and counting it
 * would inset the indicator for a corner that is not there.
 */
- (CGFloat)_clippingCornerRadius
{
  CGFloat radius = 0;
  UIView *ancestor = self.superview;
  while (ancestor != nil && ancestor.clipsToBounds) {
    radius = MAX(radius, ancestor.layer.cornerRadius);
    ancestor = ancestor.superview;
  }
  // This view's own radius clips its indicator too, and does so whether or not
  // it clips its content — the indicator is in the layer being masked.
  radius = MAX(radius, self.layer.cornerRadius);
  // Never more than half the view: a radius that large is a capsule, and
  // insetting by it would leave no indicator at all.
  return MIN(radius, CGRectGetHeight(self.bounds) / 2);
}

/**
 * Tell the shadow tree where the content has been scrolled to.
 *
 * `ExpoScrollViewShadowNode::getContentOriginOffset` subtracts this from every
 * descendant's position, and it is what makes `measureInWindow` on something
 * inside a scroll view answer where that thing actually IS. Left unwritten the
 * offset reads zero: a balloon paints 109 points below where it measures, and
 * the send flight — which is the difference between two measurements — flies
 * from the wrong place. Only the y is wrong; there is no horizontal scrolling
 * here.
 *
 * A no-op when the offset has not moved. `updateState` takes a function that
 * may return `nullptr` to mean "nothing to commit", so a scroll that ends where
 * it began costs a comparison rather than a tree revision.
 */
- (void)_updateStateWithContentOffset
{
  if (!_state) {
    return;
  }
  const auto contentOffset = RCTPointFromCGPoint(_scrollView.contentOffset);
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

- (void)_emitInsetChange
{
  if (_eventEmitter == nullptr) {
    return;
  }
  std::static_pointer_cast<const ExpoScrollViewEventEmitter>(_eventEmitter)->onInsetChange([self _scrollEvent]);
}

- (void)scrollViewDidScroll:(UIScrollView *)scrollView
{
  /*
   * `background-attachment: fixed` is measured against the VIEWPORT, so a
   * fixed background has to be re-placed as its element travels through one.
   * Nothing else would: scrolling changes no props and no layout metrics, so
   * there is no commit to repaint on. Browsers repaint fixed backgrounds on
   * scroll for the same reason, and it is the expensive half of the feature —
   * which is why it is skipped outright unless something in the process is
   * actually using it.
   */
  if (EXPAnyFixedBackgrounds()) {
    [self exp_repositionFixedBackgrounds];
  }

  // A `setContentSize:` clamp being undone in the same breath; see the repair
  // above. Reporting it would tell the tree the reader moved, which they did not.
  if (_offsetIsMidRepair) {
    return;
  }

  [self _updateStateWithContentOffset];

  /*
   * Every offset change, with the STEP between consecutive ones.
   *
   * A bubble jumping is a claim about the offset, and the balloon trace cannot
   * see one: it fires when a balloon's own frame changes, and scrolling changes
   * no frame — a row's window position moves because the offset moved underneath
   * it, which that trace never samples. A capture of a send accordingly shows
   * one 62pt "step" spanning seven seconds with nothing in between, and reading
   * a jump off that is reading the sampling rate.
   *
   * This is called for programmatic writes as well as for a finger, so a clamp,
   * a rise tick and a drag all land here. `d=` is the whole point: a glide steps
   * by a fraction of a point per frame and a jump does not, so a jump is one
   * greppable line rather than a shape to be eyeballed across a hundred.
   */
  if ([EXPKeyboardTrace isRecording]) {
    const CGFloat y = scrollView.contentOffset.y;
    if (fabs(y - _tracedOffsetY) > 0.01) {
      [EXPKeyboardTrace record:@"offset %.1f d=%+.1f cs=%.1f track=%d decel=%d rise=%d",
                               y, y - _tracedOffsetY, scrollView.contentSize.height,
                               (int)scrollView.isTracking, (int)scrollView.isDecelerating,
                               (int)[self _isRising]];
      _tracedOffsetY = y;
    }
  }

  // Sampled here so that it is the state BEFORE the content next changes size.
  //
  // A RISE counts as being there. Every rise aims at the end — all three of
  // its callers pass `_maxOffsetY` — so mid-flight the offset is short of the
  // bottom precisely because it is on its way to the bottom. Sampling the raw
  // position during those frames reads "not at bottom", and the next content
  // growth — a virtualized row materialising under a long jump — is then not
  // followed. Measured with two hundred rows: focus from the top lands the
  // newest message 27 to 34 points under the composer, exactly the estimate
  // error of the rows that materialise while the first correction is still
  // in flight.
  _wasAtBottom = [self _isAtBottom] || [self _isRising];
  if (_scrollingToLatest && _wasAtBottom) {
    _scrollingToLatest = NO;
  }
  if (_eventEmitter == nullptr) {
    return;
  }
  std::static_pointer_cast<const ExpoScrollViewEventEmitter>(_eventEmitter)->onScroll([self _scrollEvent]);
}

/*
 * The scroll-to-top bracket.
 *
 * UIKit asks whether it may, then tells us when it has finished — which is
 * exactly the window in which the offset belongs to UIKit and not to us. A large
 * title expands during that window, changing this view's safe-area top on every
 * frame, and adjusting the offset by that delta means two things writing the same
 * number in the same frame.
 */
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

/* A scroll that never arrives — interrupted by a finger — must not leave it set. */
- (void)scrollViewDidEndScrollingAnimation:(UIScrollView *)scrollView
{
  /*
   * Not the rise's business — that ends itself, on its own clock. This is still
   * needed for the animated scrolls UIKit does run: `-_scrollToTop`, and the one
   * the status bar triggers.
   */
  _scrollingToTop = NO;
}

/**
 * Balanced holds on the keyboard sampler, so an interactive dismissal is
 * FOLLOWED rather than discovered at the end of it.
 *
 * The sampler parks itself when nothing is moving, and wakes on the keyboard's
 * notifications. A finger-driven dismissal posts none — UIKit sends nothing at
 * any point while the keyboard is being dragged down — so without a hold the
 * link stays parked for the whole gesture and the first sample after it is the
 * keyboard already gone.
 *
 * Without the hold a dismissal produces one sample — the keyboard already
 * gone — and everything driven from it, the bottom inset and the reserve, snaps
 * at the end instead of riding down with the keys.
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
  // ABOVE the early return: an interactive dismissal has to be followed whether
  // or not anything is listening for scroll events.
  [self _beginKeyboardTracking];

  _scrollingToTop = NO;
  // A finger on the list outranks a scroll the app asked for a moment ago.
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
  std::static_pointer_cast<const ExpoScrollViewEventEmitter>(_eventEmitter)->onMomentumScrollBegin(
      [self _scrollEvent]);
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
