/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <Foundation/Foundation.h>

/*
 * What the renderer costs, in numbers the running app can read: the mount, in
 * `RCTMountingManager`, and the sweep, in `RCTVirtualViewContainerState`. The
 * counters are monotonic and never reset, so the log line and an app reading
 * them do not disturb each other, and an interval is two readings subtracted.
 * Both instruments run on the main thread, which is why plain counters suffice.
 */

// Every mutation the main thread performed, and what the renderer spent first
typedef struct {
  uint64_t transactions;
  uint64_t creates;
  uint64_t deletes;
  uint64_t inserts;
  uint64_t removes;
  uint64_t updates;
  // Wall time inside `-performTransaction:`, total and by mutation kind
  uint64_t mountNanos;
  uint64_t createNanos;
  uint64_t deleteNanos;
  uint64_t insertNanos;
  uint64_t removeNanos;
  uint64_t updateNanos;
  // The largest single transaction seen: a high-water mark, which does not
  // survive subtraction; for an interval use `bigTransactions`
  uint64_t biggestMutations;
  uint64_t biggestNanos;
  // Transactions over a thousand mutations, counted rather than maximised so an
  // interval can be read
  uint64_t bigTransactions;
  uint64_t bigNanos;
  // The renderer's own phases, from each transaction's telemetry
  uint64_t commitNanos;
  uint64_t diffNanos;
  uint64_t layoutNanos;
  uint64_t textMeasureNanos;
  uint64_t textMeasurements;
  uint64_t layoutNodes;
} RCTRenderMountStats;

// Every geometry sweep a virtualized container ran, summed across containers
typedef struct {
  // Full sweeps, and sweeps of a single view that has just moved or resized
  uint64_t sweeps;
  uint64_t singles;
  // Rows visited, and how they divided
  uint64_t rows;
  uint64_t visible;
  uint64_t prerender;
  // Wall time inside the sweep: the total, and the worst one so far
  uint64_t nanos;
  uint64_t maxNanos;
} RCTRenderSweepStats;

// What the scroll anchor asked for and what it got: `wanted` without `applied`
// is content moving under the reader with nothing cancelling it
typedef struct {
  uint64_t wanted;
  uint64_t applied;
  // The points behind those two, so a drop can be reported in what it cost
  double wantedPoints;
  double appliedPoints;
} RCTRenderAnchorStats;

#ifdef __cplusplus
extern "C" {
#endif

// Whether the counters are being kept; off, each instrument is one relaxed
// load. `EXP_MOUNTING_STATS=1` and `EXP_VIRTUALVIEW_STATS=1` turn a half on at
// launch; `RCTRenderStatsSetEnabled` is for a device, which has no environment.
BOOL RCTRenderMountStatsEnabled(void);
BOOL RCTRenderSweepStatsEnabled(void);
void RCTRenderStatsSetEnabled(BOOL enabled);

// The totals so far, never reset; subtract two readings for an interval
RCTRenderMountStats RCTRenderMountStatsRead(void);
RCTRenderSweepStats RCTRenderSweepStatsRead(void);
RCTRenderAnchorStats RCTRenderAnchorStatsRead(void);

// Counted by the scroll view, whether or not anything is reading
void RCTRenderAnchorStatsRecord(BOOL applied, double points);

#ifdef __cplusplus
}
#endif
