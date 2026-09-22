/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <ChatDemoSpecs/ChatDemoSpecs.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTRenderStats.h>
#import <React/EXPKeyboardTrace.h>

/**
 * Exposes the `RCTRenderStats.h` counters to NativeRenderStats.js. The keys
 * returned by `read` are used by name in screens/ChatScreen.js.
 */
@interface RenderStatsModule : NSObject <NativeRenderStatsSpec>
@end

@implementation RenderStatsModule

RCT_EXPORT_MODULE(RenderStats)

/*
 * `read` runs on the JavaScript thread and copies counters that the main thread
 * writes without a lock, so a value can be one increment stale.
 */
+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (void)setEnabled:(BOOL)enabled
{
  RCTRenderStatsSetEnabled(enabled);
}

- (void)trace:(NSString *)line
{
  [EXPKeyboardTrace record:@"%@", line];
}

- (NSDictionary *)read
{
  const RCTRenderMountStats mount = RCTRenderMountStatsRead();
  const RCTRenderSweepStats sweep = RCTRenderSweepStatsRead();
  const RCTRenderAnchorStats anchor = RCTRenderAnchorStatsRead();
  return @{
    @"enabled" : @(RCTRenderMountStatsEnabled() ? 1 : 0),
    // Written by the "Stamp the build into Info.plist" phase in project.yml.
    @"buildCommit" : NSBundle.mainBundle.infoDictionary[@"EXPBuildCommit"] ?: @"?",
    @"buildStamp" : NSBundle.mainBundle.infoDictionary[@"EXPBuildStamp"] ?: @"?",
    @"transactions" : @(mount.transactions),
    @"creates" : @(mount.creates),
    @"deletes" : @(mount.deletes),
    @"inserts" : @(mount.inserts),
    @"removes" : @(mount.removes),
    @"updates" : @(mount.updates),
    @"biggestMutations" : @(mount.biggestMutations),
    @"bigTransactions" : @(mount.bigTransactions),
    @"bigMs" : @((double)mount.bigNanos / 1e6),
    @"mountMs" : @((double)mount.mountNanos / 1e6),
    @"createMs" : @((double)mount.createNanos / 1e6),
    @"deleteMs" : @((double)mount.deleteNanos / 1e6),
    @"insertMs" : @((double)mount.insertNanos / 1e6),
    @"removeMs" : @((double)mount.removeNanos / 1e6),
    @"updateMs" : @((double)mount.updateNanos / 1e6),
    @"commitMs" : @((double)mount.commitNanos / 1e6),
    @"diffMs" : @((double)mount.diffNanos / 1e6),
    @"layoutMs" : @((double)mount.layoutNanos / 1e6),
    @"textMeasureMs" : @((double)mount.textMeasureNanos / 1e6),
    @"textMeasurements" : @(mount.textMeasurements),
    @"layoutNodes" : @(mount.layoutNodes),
    @"sweeps" : @(sweep.sweeps),
    @"sweepSingles" : @(sweep.singles),
    @"sweptRows" : @(sweep.rows),
    @"sweptVisible" : @(sweep.visible),
    @"sweptPrerender" : @(sweep.prerender),
    @"sweepMs" : @((double)sweep.nanos / 1e6),
    @"worstSweepUs" : @((double)sweep.maxNanos / 1e3),
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
