// Copyright (c) Meta Platforms, Inc. and affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

#import <ExpoModulesCore/ExpoFabricViewObjC.h>

NS_ASSUME_NONNULL_BEGIN

@interface ExpoFabricViewObjC (SynchronousEvents)

/**
 Dispatches an event and returns once JavaScript has handled it, so what it
 renders has mounted by then: inside the UIKit animation the caller is in, if
 any. The main thread waits on JavaScript meanwhile, so this is for a change
 UIKit animates, never for one per frame. Returns NO, having dispatched
 nothing, when there is nothing to dispatch to yet; the caller then dispatches
 as usual.
 */
- (BOOL)dispatchEventNow:(NSString *)eventName
                 payload:(nullable NSDictionary<NSString *, id> *)payload NS_SWIFT_NAME(dispatchEventNow(_:payload:));

@end

NS_ASSUME_NONNULL_END
