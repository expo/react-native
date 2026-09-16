/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <Foundation/Foundation.h>

/*
 * What the renderer costs, in numbers the running app can read.
 *
 * Two instruments live behind this header: the MOUNT, in `RCTMountingManager`,
 * which is every mutation the main thread performs and the phases the renderer
 * timed before handing them over; and the SWEEP, in
 * `RCTVirtualViewContainerState`, which is the geometry pass a virtualized list
 * runs on every scroll event.
 *
 * Both used to report only to `os_log`, and they still do — but a log is
 * readable from a Mac with a cable, and the question these answer is asked on a
 * phone. So the counters are also monotonic and readable, and a caller that
 * wants "what did this gesture cost" takes a copy before and after and
 * subtracts. Nothing here resets, which is what makes two readers possible:
 * the log line and the app do not disturb each other.
 *
 * Both instruments run on the main thread, which is the only reason plain
 * counters are enough.
 */

/** Every mutation the main thread performed, and what the renderer spent first. */
typedef struct {
  uint64_t transactions;
  uint64_t creates;
  uint64_t deletes;
  uint64_t inserts;
  uint64_t removes;
  uint64_t updates;
  /** Wall time inside `-performTransaction:`, total and by mutation kind. */
  uint64_t mountNanos;
  uint64_t createNanos;
  uint64_t deleteNanos;
  uint64_t insertNanos;
  uint64_t removeNanos;
  uint64_t updateNanos;
  /*
   * The largest single transaction seen, in mutations and in nanoseconds.
   *
   * A HIGH-WATER MARK and not a total, so unlike everything else here it does
   * not survive being subtracted: two readings give the largest so far, not the
   * largest between them. It is kept because the one number that says whether a
   * list is expensive to open is the size of the transaction that opens it.
   */
  uint64_t biggestMutations;
  uint64_t biggestNanos;
  /** The renderer's own phases, from each transaction's telemetry. */
  uint64_t commitNanos;
  uint64_t diffNanos;
  uint64_t layoutNanos;
  uint64_t textMeasureNanos;
  uint64_t textMeasurements;
  uint64_t layoutNodes;
} RCTRenderMountStats;

/**
 * Every geometry sweep a virtualized container ran.
 *
 * Summed across containers rather than per container, because the question is
 * what the app spent and a screen has one scrolling list.
 */
typedef struct {
  /** Full sweeps, and sweeps of a single view that has just moved or resized. */
  uint64_t sweeps;
  uint64_t singles;
  /** Rows visited, and how they divided. */
  uint64_t rows;
  uint64_t visible;
  uint64_t prerender;
  /** Wall time inside the sweep: the total, and the worst one so far. */
  uint64_t nanos;
  uint64_t maxNanos;
} RCTRenderSweepStats;

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Whether the counters are being kept.
 *
 * Off, which is the default, each instrument is one relaxed load — the counting
 * itself is cheap but the timing around it is not, and a demo of how an app
 * performs should not be measuring itself unless asked. `EXP_MOUNTING_STATS=1`
 * and `EXP_VIRTUALVIEW_STATS=1` turn their own half on at launch, which is how
 * a simulator run asks; `RCTRenderStatsSetEnabled` is how a device does, since
 * an app started from the home screen has no environment to set.
 */
BOOL RCTRenderMountStatsEnabled(void);
BOOL RCTRenderSweepStatsEnabled(void);
void RCTRenderStatsSetEnabled(BOOL enabled);

/** The totals so far. Never reset; subtract two readings for an interval. */
RCTRenderMountStats RCTRenderMountStatsRead(void);
RCTRenderSweepStats RCTRenderSweepStatsRead(void);

#ifdef __cplusplus
}
#endif
