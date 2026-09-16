/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <React/RCTLog.h>
#import <React/RCTScrollViewComponentView.h>
#import <React/RCTVirtualViewMode.h>
#import <UIKit/UIKit.h>
#import <os/log.h>
#import <react/featureflags/ReactNativeFeatureFlags.h>

#import "RCTVirtualViewContainerState.h"

using namespace facebook;
using namespace facebook::react;

#define ENABLE_DEBUG_LOGGING 0 && RCT_DEBUG

#if ENABLE_DEBUG_LOGGING
static void debugLog(NSString *msg, ...)
{
  va_list args;
  va_start(args, msg);
  NSString *msgString = [[NSString alloc] initWithFormat:msg arguments:args];
  RCTLogInfo(@"%@", msgString);
  va_end(args); // Don't forget to call va_end to clean up
}

#define DEBUG_LOG(...) debugLog(__VA_ARGS__)
#else
#define DEBUG_LOG(...) ((void)0)
#endif

/**
 * Checks whether one CGRect overlaps with another CGRect.
 *
 * This is different from CGRectIntersectsRect because a CGRect representing
 * a line or a point is considered to overlap with another CGRect if the line
 * or point is within the rect bounds. However, two CGRects are not considered
 * to overlap if they only share a boundary.
 */
static BOOL CGRectOverlaps(CGRect rect1, CGRect rect2)
{
  /*
   * The edges by arithmetic rather than `CGRectGetMinY` and friends, which are
   * real calls into CoreGraphics and are not inlined even in a Release build —
   * six of them per view, ten thousand views, sixty times a second. Both rects
   * come from frames and from the scroll view's own geometry, so neither has a
   * negative size and there is nothing for the accessors' standardising to do.
   */
  CGFloat minY1 = rect1.origin.y;
  CGFloat maxY1 = rect1.origin.y + rect1.size.height;
  CGFloat minY2 = rect2.origin.y;
  CGFloat maxY2 = rect2.origin.y + rect2.size.height;
  if (minY1 >= maxY2 || minY2 >= maxY1) {
    // No overlap on the y-axis.
    return NO;
  }
  CGFloat minX1 = rect1.origin.x;
  CGFloat maxX1 = rect1.origin.x + rect1.size.width;
  CGFloat minX2 = rect2.origin.x;
  CGFloat maxX2 = rect2.origin.x + rect2.size.width;
  if (minX1 >= maxX2 || minX2 >= maxX1) {
    // No overlap on the x-axis.
    return NO;
  }
  return YES;
}


/**
 * The origin of `view`'s coordinate space, in the scroll view's CONTENT
 * coordinates — or `NO` if that cannot be had by adding origins.
 *
 * Converting a point out of a view's space into its superview's is
 * `- bounds.origin + frame.origin`, so the origin of a view's space is its
 * parent's plus that. Walking it here rather than asking each view for a
 * converted rect is what makes a long list cheap: every row in a list shares
 * this chain, so it is walked ONCE per scan and each row then costs a single
 * `-frame` read.
 *
 * `NO` for a transform anywhere in the chain, or a chain that does not reach
 * the scroll view. Both are answers this cannot compute rather than answers it
 * computes badly, and the caller asks UIKit instead.
 */
static BOOL RCTOriginInContent(UIView *view, UIView *scrollView, CGPoint *origin)
{
  CGPoint result = CGPointZero;
  while (view != nil && view != scrollView) {
    if (!CATransform3DIsIdentity(view.layer.transform)) {
      return NO;
    }
    const CGRect frame = view.frame;
    const CGRect bounds = view.bounds;
    result.x += frame.origin.x - bounds.origin.x;
    result.y += frame.origin.y - bounds.origin.y;
    view = view.superview;
  }
  if (view == nil) {
    return NO;
  }
  *origin = result;
  return YES;
}

/**
 * How long after a teleport the hides wait, and what "waited long enough"
 * means.
 *
 * The window is not the whole story, because the animation a jump belongs to
 * does not start at the jump: a composer being focused teleports the
 * transcript first and the keyboard's rise begins about half a second later,
 * once UIKit has installed the responder — measured off the trace, a
 * fixed-length window expired mid-rise and delivered the unmount as a ~30ms
 * stall inside the very animation it was moved out of. So the catch-up also
 * requires QUIET: sweeps still arriving mean the offset is still being
 * written, and the deadline pushes out until they stop. The cap bounds the
 * wait during continuous scrolling, where hides are incremental anyway once
 * the window is allowed to close.
 */
/*
 * What a sweep costs, when asked for it.
 *
 * `EXP_VIRTUALVIEW_STATS=1` makes the container measure itself: how many sweeps
 * a second, how many rows each visits, how they divide between visible,
 * prerender and hidden, the microseconds spent inside `-_updateModes:`, and the
 * SKIP BUDGET — the shortest scroll that could change any row's mode, which is
 * what says whether a sweep could have been skipped at all. One line a second,
 * to `dev.expo.virtualview`.
 *
 * Off, which is the default, it costs one `dispatch_once`-guarded read.
 */
static BOOL EXPVirtualViewStatsEnabled(void)
{
  static BOOL enabled = NO;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    const char *value = getenv("EXP_VIRTUALVIEW_STATS");
    enabled = value != NULL && value[0] == '1';
  });
  return enabled;
}

static os_log_t EXPVirtualViewStatsLog(void)
{
  static os_log_t log;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    log = os_log_create("dev.expo.virtualview", "sweep");
  });
  return log;
}

static const CFTimeInterval kExpoDeferHidesWindow = 0.7;
static const CFTimeInterval kExpoDeferHidesQuiet = 0.25;
static const CFTimeInterval kExpoDeferHidesCap = 3.0;

@interface RCTVirtualViewContainerState () <UIScrollViewDelegate>
@end

@interface RCTVirtualViewContainerState () {
  NSMutableSet<id<RCTVirtualViewProtocol>> *_virtualViews;
  /*
   * `_virtualViews` in iteration order, kept so that a scroll does not allocate.
   *
   * `-allObjects` builds a fresh array every call, and the call is on every
   * `scrollViewDidScroll:` — ten thousand elements copied sixty times a second
   * on a long list. Nil means "rebuild", which is what adding or removing a
   * view sets it to.
   */
  NSArray<id<RCTVirtualViewProtocol>> *_virtualViewsSnapshot;
  CGRect _emptyRect;
  CGRect _prerenderRect;
  __weak UIView<RCTVirtualViewScrollHost> *_scrollViewComponentView;
  CGFloat _prerenderRatio;
  /*
   * Where the last full sweep saw the offset, and until when rows may not be
   * told they are hidden — see the teleport note in `-_updateModes:`.
   */
  CGFloat _lastSweepOffsetY;
  BOOL _hasLastSweepOffset;
  /* Suppression is a FLAG, not a deadline: it holds until the catch-up sweep
   * actually runs, however long the quiet takes to arrive. */
  BOOL _hidesDeferred;
  CFTimeInterval _deferHidesUntil;
  CFTimeInterval _lastFullSweepTime;
  CFTimeInterval _deferHidesOpenedAt;
  /* Instrumentation — see `EXPVirtualViewStatsEnabled`; all zero unless asked. */
  uint64_t _statSweeps;
  uint64_t _statSingles;
  uint64_t _statRows;
  uint64_t _statVisible;
  uint64_t _statPrerender;
  uint64_t _statNanos;
  uint64_t _statMaxNanos;
  CGFloat _statMinSkip;
  CFTimeInterval _statSince;
}
@end

@implementation RCTVirtualViewContainerState

- (instancetype)initWithScrollView:(UIView<RCTVirtualViewScrollHost> *)scrollView
{
  self = [super init];
  if (self != nil) {
    _virtualViews = [NSMutableSet set];
    _emptyRect = CGRectZero;
    _prerenderRect = CGRectZero;
    _scrollViewComponentView = scrollView;
    _prerenderRatio = ReactNativeFeatureFlags::virtualViewPrerenderRatio();
    [_scrollViewComponentView addScrollListener:self];

    DEBUG_LOG(@"initWithScrollView");
  }
  return self;
}

- (void)dealloc
{
  DEBUG_LOG(@"dealloc");
  if (_scrollViewComponentView != nil) {
    [_scrollViewComponentView removeScrollListener:self];
    _scrollViewComponentView = nil;
  }
  [_virtualViews removeAllObjects];
  _virtualViewsSnapshot = nil;
}

#pragma mark - Public API

- (void)onChange:(id<RCTVirtualViewProtocol>)virtualView
{
  if (![_virtualViews containsObject:virtualView]) {
    [_virtualViews addObject:virtualView];
    _virtualViewsSnapshot = nil;
    DEBUG_LOG(@"Add virtualViewID=%@", virtualView.virtualViewID);
  } else {
    DEBUG_LOG(@"Update virtualViewID=%@", virtualView.virtualViewID);
  }
  [self _updateModes:virtualView];
}

- (void)remove:(id<RCTVirtualViewProtocol>)virtualView
{
  if (![_virtualViews containsObject:virtualView]) {
    RCTLogError(@"Attempting to remove non-existent VirtualView: %@", virtualView.virtualViewID);
  }

  [_virtualViews removeObject:virtualView];
  _virtualViewsSnapshot = nil;
  DEBUG_LOG(@"Remove virtualViewID=%@", virtualView.virtualViewID);
}

#pragma mark - Private Helpers

/** The sweep a teleport promised — delivers the hides once things are quiet. */
- (void)_catchUpDeferredHides
{
  const CFTimeInterval now = CACurrentMediaTime();
  const BOOL windowOpen = now < _deferHidesUntil;
  const BOOL stillMoving = now - _lastFullSweepTime < kExpoDeferHidesQuiet;
  const BOOL capped = now - _deferHidesOpenedAt >= kExpoDeferHidesCap;
  if ((windowOpen || stillMoving) && !capped) {
    // Re-armed by another jump, or the offset is still being written — the
    // animation the jump belongs to has not finished. Come back later.
    const CFTimeInterval wait = windowOpen
        ? MAX(_deferHidesUntil - now, kExpoDeferHidesQuiet)
        : kExpoDeferHidesQuiet;
    __weak RCTVirtualViewContainerState *weakSelf = self;
    dispatch_after(
        dispatch_time(DISPATCH_TIME_NOW, (int64_t)(wait * NSEC_PER_SEC)),
        dispatch_get_main_queue(),
        ^{
          [weakSelf _catchUpDeferredHides];
        });
    return;
  }
  _deferHidesUntil = 0;
  _hidesDeferred = NO;
  [self _updateModes:nil];
}

- (void)_updateModes:(id<RCTVirtualViewProtocol>)virtualView
{
  const BOOL stats = EXPVirtualViewStatsEnabled();
  const uint64_t statsStart = stats ? clock_gettime_nsec_np(CLOCK_UPTIME_RAW) : 0;
  auto scrollView = _scrollViewComponentView.scrollView;
  CGRect visibleRect = CGRectMake(
      scrollView.contentOffset.x,
      scrollView.contentOffset.y,
      scrollView.frame.size.width,
      scrollView.frame.size.height);

  _prerenderRect = visibleRect;
  _prerenderRect = CGRectInset(
      _prerenderRect, -_prerenderRect.size.width * _prerenderRatio, -_prerenderRect.size.height * _prerenderRatio);

  /*
   * A TELEPORT defers the hides; only the arrivals may cost this frame.
   *
   * An offset that moved more than a viewport since the last sweep is a jump,
   * not a scroll — a composer being focused far from the bottom, a
   * scroll-to-top. The rows arriving at the destination must materialise
   * synchronously (they are about to be on screen), but the rows LEAVING are
   * off screen by definition, and their mode-change events ride the same
   * event beat as the arrivals' — so telling them now adds the unmount of
   * everything departed to the one synchronous commit the arrivals need,
   * exactly when UIKit is also installing the keyboard. Measured at 29–44ms
   * of dropped frames on a 253-row transcript.
   *
   * So a jump opens a quiet window: sweeps inside it dispatch only VISIBLE
   * transitions (a stale mode on an off-screen row shows nothing, and
   * prerender's beats were stalling the rise just the same — see below), and
   * a catch-up sweep after the window delivers the rest, when nothing is
   * animating. Scrolling never opens the window — rows leave a moving
   * viewport a few at a time, and those changes are cheap where they are.
   */
  const CFTimeInterval now = CACurrentMediaTime();
  if (virtualView == nullptr) {
    if (_hasLastSweepOffset &&
        fabs(visibleRect.origin.y - _lastSweepOffsetY) > visibleRect.size.height) {
      _deferHidesUntil = now + kExpoDeferHidesWindow;
      if (!_hidesDeferred) {
        _hidesDeferred = YES;
        _deferHidesOpenedAt = now;
        __weak RCTVirtualViewContainerState *weakSelf = self;
        dispatch_after(
            dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kExpoDeferHidesWindow * NSEC_PER_SEC)),
            dispatch_get_main_queue(),
            ^{
              [weakSelf _catchUpDeferredHides];
            });
      }
    }
    _lastSweepOffsetY = visibleRect.origin.y;
    _lastFullSweepTime = now;
    _hasLastSweepOffset = YES;
  }
  const BOOL deferHides = _hidesDeferred;

  if (virtualView == nullptr && _virtualViewsSnapshot == nil) {
    _virtualViewsSnapshot = [_virtualViews allObjects];
  }
  NSArray<id<RCTVirtualViewProtocol>> *virtualViewsIt =
      (virtualView != nullptr) ? @[ virtualView ] : _virtualViewsSnapshot;

  /*
   * One entry, because a list's rows are contiguous and share a parent: the
   * chain above them is walked for the first row and compared by pointer for
   * the rest. A map would hash ten thousand times a frame to answer the same
   * question.
   */
  __unsafe_unretained UIView *memoParent = nil;
  CGPoint memoOrigin = CGPointZero;
  BOOL memoValid = NO;

  for (id<RCTVirtualViewProtocol> vv = nullptr in virtualViewsIt) {
    CGRect rect;
    const RCTVirtualViewGeometry geometry = [vv virtualViewGeometry];
    __unsafe_unretained UIView *parent = geometry.superview;
    if (parent != memoParent) {
      memoParent = parent;
      memoValid = parent != nil && RCTOriginInContent(parent, scrollView, &memoOrigin);
    }
    if (memoValid) {
      // The view's own frame is already in its parent's space, so the rect is
      // a remembered rect and two additions — no UIKit, no `CALayer`, no lock.
      const CGRect frame = geometry.frame;
      rect = CGRectMake(
          memoOrigin.x + frame.origin.x, memoOrigin.y + frame.origin.y, frame.size.width, frame.size.height);
    } else {
      rect = [vv containerRelativeRect:scrollView];
    }

    if (stats) {
      _statRows++;
      /*
       * How far this row's mode is from changing: the visible and prerender
       * edges each cross one of the row's edges, and the nearest of those four
       * crossings is the scroll that would change it. The minimum over the
       * sweep is the budget a "skip while nothing can change" rule would have.
       */
      const CGFloat a = rect.origin.y;
      const CGFloat b = rect.origin.y + rect.size.height;
      const CGFloat edges[4] = {
          visibleRect.origin.y,
          visibleRect.origin.y + visibleRect.size.height,
          _prerenderRect.origin.y,
          _prerenderRect.origin.y + _prerenderRect.size.height};
      for (size_t i = 0; i < 4; i++) {
        const CGFloat toTop = fabs(edges[i] - a);
        const CGFloat toBottom = fabs(edges[i] - b);
        _statMinSkip = MIN(_statMinSkip, MIN(toTop, toBottom));
      }
    }

    RCTVirtualViewMode mode = RCTVirtualViewModeHidden;
    CGRect thresholdRect = _emptyRect;

    if (CGRectOverlaps(rect, visibleRect)) {
      thresholdRect = visibleRect;
      mode = RCTVirtualViewModeVisible;
      if (stats) {
        _statVisible++;
      }
    } else if (CGRectOverlaps(rect, _prerenderRect)) {
      if (deferHides) {
        /*
         * Prerender is opportunistic work, and inside a teleport's quiet
         * window the opportunity has not arrived: its render beats were
         * landing as 25–35ms stalls in the middle of the keyboard's rise —
         * the very animation the hides were moved out of. The catch-up sweep
         * dispatches it with them.
         */
        continue;
      }
      mode = RCTVirtualViewModePrerender;
      thresholdRect = _prerenderRect;
      if (stats) {
        _statPrerender++;
      }
    } else if (deferHides) {
      // Inside a teleport's quiet window — the catch-up sweep will say it.
      continue;
    }

    DEBUG_LOG(
        @"UpdateModes virtualView=%@ mode=%ld rect=%@ thresholdRect=%@",
        vv.virtualViewID,
        (long)mode,
        NSStringFromCGRect(rect),
        NSStringFromCGRect(thresholdRect));
    [vv onModeChange:mode targetRect:rect thresholdRect:thresholdRect];
  }

  if (stats) {
    [self _recordSweep:statsStart single:virtualView != nullptr];
  }
}

/** One line a second while anything is moving — see `EXPVirtualViewStatsEnabled`. */
- (void)_recordSweep:(uint64_t)startedAt single:(BOOL)single
{
  const uint64_t nanos = clock_gettime_nsec_np(CLOCK_UPTIME_RAW) - startedAt;
  _statNanos += nanos;
  _statMaxNanos = MAX(_statMaxNanos, nanos);
  if (single) {
    _statSingles++;
  } else {
    _statSweeps++;
  }
  const CFTimeInterval now = CACurrentMediaTime();
  if (_statSince == 0) {
    _statSince = now;
    _statMinSkip = CGFLOAT_MAX;
    return;
  }
  const CFTimeInterval elapsed = now - _statSince;
  if (elapsed < 1.0) {
    return;
  }
  os_log_info(
      EXPVirtualViewStatsLog(),
      "sweeps=%llu singles=%llu rows=%llu rows/sweep=%.0f visible=%.1f prerender=%.1f "
      "us/sweep=%.1f max_us=%.1f total_ms=%.1f skip=%.1fpt in %.2fs",
      _statSweeps,
      _statSingles,
      _statRows,
      _statSweeps > 0 ? (double)_statRows / (double)_statSweeps : 0.0,
      _statSweeps > 0 ? (double)_statVisible / (double)_statSweeps : 0.0,
      _statSweeps > 0 ? (double)_statPrerender / (double)_statSweeps : 0.0,
      (_statSweeps + _statSingles) > 0 ? (double)_statNanos / 1000.0 / (double)(_statSweeps + _statSingles) : 0.0,
      (double)_statMaxNanos / 1000.0,
      (double)_statNanos / 1e6,
      (double)(_statMinSkip == CGFLOAT_MAX ? -1 : _statMinSkip),
      elapsed);
  _statSweeps = _statSingles = _statRows = _statVisible = _statPrerender = 0;
  _statNanos = _statMaxNanos = 0;
  _statMinSkip = CGFLOAT_MAX;
  _statSince = now;
}

#pragma mark - UIScrollViewDelegate

- (void)scrollViewDidScroll:(UIScrollView *)scrollView
{
  [self _updateModes:nil];
}
@end
