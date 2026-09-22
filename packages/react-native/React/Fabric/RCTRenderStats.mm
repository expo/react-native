/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "RCTRenderStats.h"

#import <atomic>
#import <cmath>

/*
 * The switches, and only the switches — each instrument keeps its own numbers
 * beside the code that produces them.
 *
 * Atomic because `RCTRenderStatsSetEnabled` is a JavaScript call and the
 * counters are read on the main thread. Relaxed, because an instrument turning
 * on a frame late is not a correctness question and an acquire on every
 * mutation would be part of what it measures.
 */
static std::atomic<bool> gMountEnabled{false};
static std::atomic<bool> gSweepEnabled{false};

static bool EXPEnvSaysYes(const char *name)
{
  const char *value = getenv(name);
  return value != nullptr && value[0] == '1';
}

static void EXPReadEnvironmentOnce(void)
{
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    gMountEnabled.store(EXPEnvSaysYes("EXP_MOUNTING_STATS"), std::memory_order_relaxed);
    gSweepEnabled.store(EXPEnvSaysYes("EXP_VIRTUALVIEW_STATS"), std::memory_order_relaxed);
  });
}

BOOL RCTRenderMountStatsEnabled(void)
{
  EXPReadEnvironmentOnce();
  return gMountEnabled.load(std::memory_order_relaxed) ? YES : NO;
}

BOOL RCTRenderSweepStatsEnabled(void)
{
  EXPReadEnvironmentOnce();
  return gSweepEnabled.load(std::memory_order_relaxed) ? YES : NO;
}

void RCTRenderStatsSetEnabled(BOOL enabled)
{
  // The environment first, so that turning the switch off does not then read an
  // environment that turns it back on.
  EXPReadEnvironmentOnce();
  gMountEnabled.store(enabled == YES, std::memory_order_relaxed);
  gSweepEnabled.store(enabled == YES, std::memory_order_relaxed);
}

/*
 * The anchor's two counters, and they are NOT behind the switch.
 *
 * Everything else here costs a timestamp per mutation, which is why it is off
 * unless asked. This is two increments per mounting transaction, on the main
 * thread, and what it answers — whether the reader was held still — is worth
 * more than it costs. A counter nobody has to remember to turn on is a counter
 * that is there when the report arrives.
 */
static RCTRenderAnchorStats gAnchorStats{};

RCTRenderAnchorStats RCTRenderAnchorStatsRead(void)
{
  return gAnchorStats;
}

void RCTRenderAnchorStatsRecord(BOOL applied, double points)
{
  gAnchorStats.wanted++;
  gAnchorStats.wantedPoints += std::fabs(points);
  if (applied) {
    gAnchorStats.applied++;
    gAnchorStats.appliedPoints += std::fabs(points);
  }
}
