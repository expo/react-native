/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <ChatDemoSpecs/ChatDemoSpecs.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTRenderStats.h>

/**
 * The renderer's own counters, handed to JavaScript.
 *
 * See `NativeRenderStats.js` for why the app needs them and `RCTRenderStats.h`
 * for what they mean. There is no logic here on purpose: the module is a
 * window onto two structs, and anything it decided would be a second opinion
 * about numbers whose whole value is that they are the renderer's.
 */
@interface RenderStatsModule : NSObject <NativeRenderStatsSpec>
@end

@implementation RenderStatsModule

RCT_EXPORT_MODULE(RenderStats)

/*
 * On the JavaScript thread, which is where a sync TurboModule method runs.
 *
 * Both instruments write from the main thread and nothing here writes at all,
 * so the read is a copy of a struct being incremented elsewhere: a report can
 * be one increment stale, which is a property of counting anything without a
 * lock and is not worth a lock. `setEnabled` is a relaxed store — see
 * `RCTRenderStats.mm`.
 */
+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (void)setEnabled:(BOOL)enabled
{
  RCTRenderStatsSetEnabled(enabled);
}

- (NSDictionary *)read
{
  const RCTRenderMountStats mount = RCTRenderMountStatsRead();
  const RCTRenderSweepStats sweep = RCTRenderSweepStatsRead();
  const RCTRenderAnchorStats anchor = RCTRenderAnchorStatsRead();
  /*
   * Microseconds and milliseconds rather than the nanoseconds they are kept in.
   * A double holds an integer exactly up to 2^53, which nanoseconds of uptime
   * pass in a hundred days — and every one of these crosses into JavaScript as
   * a double. Divided here, the same number is exact for years.
   */
  return @{
    @"enabled" : @(RCTRenderMountStatsEnabled() ? 1 : 0),
    // The mount, in transactions and mutations.
    @"transactions" : @(mount.transactions),
    @"creates" : @(mount.creates),
    @"deletes" : @(mount.deletes),
    @"inserts" : @(mount.inserts),
    @"removes" : @(mount.removes),
    @"updates" : @(mount.updates),
    @"biggestMutations" : @(mount.biggestMutations),
    // What the main thread spent performing them, by kind.
    @"mountMs" : @((double)mount.mountNanos / 1e6),
    @"createMs" : @((double)mount.createNanos / 1e6),
    @"deleteMs" : @((double)mount.deleteNanos / 1e6),
    @"insertMs" : @((double)mount.insertNanos / 1e6),
    @"removeMs" : @((double)mount.removeNanos / 1e6),
    @"updateMs" : @((double)mount.updateNanos / 1e6),
    // What the renderer spent before it, from each transaction's telemetry.
    @"commitMs" : @((double)mount.commitNanos / 1e6),
    @"diffMs" : @((double)mount.diffNanos / 1e6),
    @"layoutMs" : @((double)mount.layoutNanos / 1e6),
    @"textMeasureMs" : @((double)mount.textMeasureNanos / 1e6),
    @"textMeasurements" : @(mount.textMeasurements),
    @"layoutNodes" : @(mount.layoutNodes),
    // The virtualized container's geometry pass.
    @"sweeps" : @(sweep.sweeps),
    @"sweepSingles" : @(sweep.singles),
    @"sweptRows" : @(sweep.rows),
    @"sweptVisible" : @(sweep.visible),
    @"sweptPrerender" : @(sweep.prerender),
    @"sweepMs" : @((double)sweep.nanos / 1e6),
    @"worstSweepUs" : @((double)sweep.maxNanos / 1e3),
    // What the scroll anchor asked for, and what it got.
    @"anchorWanted" : @(anchor.wanted),
    @"anchorApplied" : @(anchor.applied),
    @"anchorWantedPoints" : @(anchor.wantedPoints),
    @"anchorAppliedPoints" : @(anchor.appliedPoints),
  };
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeRenderStatsSpecJSI>(params);
}

@end
