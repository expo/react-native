/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <React/RCTLog.h>
#import <React/RCTRenderStats.h>
#import <React/RCTScrollViewComponentView.h>
#import <React/RCTVirtualViewMode.h>
#import <UIKit/UIKit.h>
#import <os/log.h>
#import <react/featureflags/ReactNativeFeatureFlags.h>
#import <unordered_map>

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
  // Arithmetic rather than `CGRectGetMinY` and friends, which are real calls
  // into CoreGraphics on every view of every sweep; neither rect has a negative
  // size, so there is nothing for the accessors' standardising to do
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
 * The origin of `view`'s coordinate space in the scroll view's content
 * coordinates, by adding `frame.origin - bounds.origin` up the chain; every row
 * shares the chain, so it is walked once per sweep. `NO` for a transform in the
 * chain or a chain that does not reach the scroll view, and the caller asks UIKit.
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

/*
 * What a sweep costs, when asked for it: sweeps a second, rows per sweep and
 * how they divide, microseconds inside `-_updateModes:`, and the skip budget,
 * the shortest scroll that could change any row's mode. One line a second to
 * `dev.expo.virtualview`, and `RCTRenderSweepStatsRead` for an app; the tally is
 * monotonic and summed across containers, while the skip budget, a minimum,
 * stays with the log. See `RCTRenderStats.h` for the switch.
 */

// Everything counted, ever; main thread only, where a sweep runs
static RCTRenderSweepStats gSweepStats{};

RCTRenderSweepStats RCTRenderSweepStatsRead(void)
{
  return gSweepStats;
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

// How long after a teleport the hides wait. The window alone is not enough:
// the animation a jump belongs to can start half a second after it, so the
// catch-up also waits for sweeps to stop arriving, bounded by the cap.
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
  /*
   * Each parent's origin in content coordinates, for the length of one sweep.
   *
   * Rebuilt every sweep rather than kept, because a layout moves the boxes the
   * rows are in and nothing tells this object when. Within a sweep it is a
   * pointer keyed cache of the chain walk above each row.
   */
  std::unordered_map<const void *, CGPoint> _originByParent;
  /* The log's own last reading, so its line stays a report on one second —
     see `RCTRenderSweepStatsEnabled` for the switch over all of this. */
  RCTRenderSweepStats _statLogged;
  CGFloat _statMinSkip;
  CFTimeInterval _statSince;
}
@end

@implementation RCTVirtualViewContainerState

- (instancetype)initWithScrollView:(UIView<RCTVirtualViewScrollHost> *)scrollView
{
  if (self = [super init]) {
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

// The sweep a teleport promised, delivering the hides once things are quiet
- (void)_catchUpDeferredHides
{
  const CFTimeInterval now = CACurrentMediaTime();
  const BOOL windowOpen = now < _deferHidesUntil;
  const BOOL stillMoving = now - _lastFullSweepTime < kExpoDeferHidesQuiet;
  const BOOL capped = now - _deferHidesOpenedAt >= kExpoDeferHidesCap;
  if ((windowOpen || stillMoving) && !capped) {
    // Re-armed by another jump, or the offset is still being written
    const CFTimeInterval wait = windowOpen ? MAX(_deferHidesUntil - now, kExpoDeferHidesQuiet) : kExpoDeferHidesQuiet;
    __weak RCTVirtualViewContainerState *weakSelf = self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(wait * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
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
  const BOOL stats = RCTRenderSweepStatsEnabled();
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
   * A teleport defers the hides; only the arrivals may cost this frame. An
   * offset that moved more than a viewport since the last sweep is a jump, and
   * the rows leaving ride the same event beat as the rows arriving, so telling
   * them now adds every departed unmount to the one synchronous commit the
   * arrivals need. A jump opens a quiet window in which sweeps dispatch only
   * visible transitions; a catch-up sweep delivers the rest. Scrolling never
   * opens the window.
   */
  const CFTimeInterval now = CACurrentMediaTime();
  if (virtualView == nullptr) {
    if (_hasLastSweepOffset && fabs(visibleRect.origin.y - _lastSweepOffsetY) > visibleRect.size.height) {
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

  // The last parent, then every parent: a flat list's rows share one box, so
  // the previous row's parent answers for all of them, while grouped rows
  // arrive in set order and fall through to the map
  __unsafe_unretained UIView *memoParent = nil;
  CGPoint memoOrigin = CGPointZero;
  BOOL memoValid = NO;
  _originByParent.clear();

  for (id<RCTVirtualViewProtocol> vv in virtualViewsIt) {
    CGRect rect;
    const RCTVirtualViewGeometry geometry = [vv virtualViewGeometry];
    __unsafe_unretained UIView *parent = geometry.superview;
    if (parent != memoParent) {
      memoParent = parent;
      if (parent == nil) {
        memoValid = NO;
      } else {
        const void *key = (__bridge const void *)parent;
        const auto known = _originByParent.find(key);
        if (known != _originByParent.end()) {
          memoOrigin = known->second;
          memoValid = YES;
        } else {
          memoValid = RCTOriginInContent(parent, scrollView, &memoOrigin);
          if (memoValid) {
            _originByParent.emplace(key, memoOrigin);
          }
        }
      }
    }
    if (memoValid) {
      // The view's frame is already in its parent's space: a remembered rect
      // and two additions, no `CALayer`
      const CGRect frame = geometry.frame;
      rect =
          CGRectMake(memoOrigin.x + frame.origin.x, memoOrigin.y + frame.origin.y, frame.size.width, frame.size.height);
    } else {
      rect = [vv containerRelativeRect:scrollView];
    }

    if (stats) {
      gSweepStats.rows++;
      // How far this row's mode is from changing: the nearest crossing of a
      // visible or prerender edge with one of the row's edges
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
        gSweepStats.visible++;
      }
    } else if (CGRectOverlaps(rect, _prerenderRect)) {
      if (deferHides) {
        // Prerender is opportunistic, and inside a teleport's quiet window its
        // beats would stall the animation the hides were moved out of
        continue;
      }
      mode = RCTVirtualViewModePrerender;
      thresholdRect = _prerenderRect;
      if (stats) {
        gSweepStats.prerender++;
      }
    } else if (deferHides) {
      // Inside a teleport's quiet window; the catch-up sweep will say it
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

// One line a second while anything is moving
- (void)_recordSweep:(uint64_t)startedAt single:(BOOL)single
{
  const uint64_t nanos = clock_gettime_nsec_np(CLOCK_UPTIME_RAW) - startedAt;
  gSweepStats.nanos += nanos;
  gSweepStats.maxNanos = MAX(gSweepStats.maxNanos, nanos);
  if (single) {
    gSweepStats.singles++;
  } else {
    gSweepStats.sweeps++;
  }
  const CFTimeInterval now = CACurrentMediaTime();
  if (_statSince == 0) {
    _statSince = now;
    _statLogged = gSweepStats;
    _statMinSkip = CGFLOAT_MAX;
    return;
  }
  const CFTimeInterval elapsed = now - _statSince;
  if (elapsed < 1.0) {
    return;
  }
  // Since the last line, except `max_us`, a high-water mark for the whole run
  const RCTRenderSweepStats &was = _statLogged;
  const uint64_t sweeps = gSweepStats.sweeps - was.sweeps;
  const uint64_t singles = gSweepStats.singles - was.singles;
  const uint64_t rows = gSweepStats.rows - was.rows;
  os_log_info(
      EXPVirtualViewStatsLog(),
      "sweeps=%llu singles=%llu rows=%llu rows/sweep=%.0f visible=%.1f prerender=%.1f "
      "us/sweep=%.1f max_us=%.1f total_ms=%.1f skip=%.1fpt in %.2fs",
      sweeps,
      singles,
      rows,
      sweeps > 0 ? (double)rows / (double)sweeps : 0.0,
      sweeps > 0 ? (double)(gSweepStats.visible - was.visible) / (double)sweeps : 0.0,
      sweeps > 0 ? (double)(gSweepStats.prerender - was.prerender) / (double)sweeps : 0.0,
      (sweeps + singles) > 0 ? (double)(gSweepStats.nanos - was.nanos) / 1000.0 / (double)(sweeps + singles) : 0.0,
      (double)gSweepStats.maxNanos / 1000.0,
      (double)(gSweepStats.nanos - was.nanos) / 1e6,
      (double)(_statMinSkip == CGFLOAT_MAX ? -1 : _statMinSkip),
      elapsed);
  _statLogged = gSweepStats;
  _statMinSkip = CGFLOAT_MAX;
  _statSince = now;
}

#pragma mark - UIScrollViewDelegate

- (void)scrollViewDidScroll:(UIScrollView *)scrollView
{
  [self _updateModes:nil];
}
@end
