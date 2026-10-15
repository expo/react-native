// Copyright (c) Meta Platforms, Inc. and affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

#import "ExpoFabricViewObjC+SynchronousEvents.h"

#import <ExpoModulesCore/ExpoViewEventEmitter.h>
#import <ExpoModulesJSI/EXJSIConversions.h>

// The name Expo's own `dispatchEvent:payload:` sends: `onModeChange` is `modeChange`.
static NSString *EventNameWithoutOn(NSString *eventName)
{
  if ([eventName hasPrefix:@"on"]) {
    NSString *firstLetter = [[eventName substringWithRange:NSMakeRange(2, 1)] lowercaseString];
    return [firstLetter stringByAppendingString:[eventName substringFromIndex:3]];
  }
  return eventName;
}

@implementation ExpoFabricViewObjC (SynchronousEvents)

- (BOOL)dispatchEventNow:(NSString *)eventName payload:(nullable NSDictionary<NSString *, id> *)payload
{
  if (!_eventEmitter) {
    return NO;
  }
  // Expo's `dispatchEvent:payload:` leaves the event to the next beat, a frame
  // or more later. Run the beat now instead: an Expo view event is discrete
  // outside a continuous gesture, so React commits what it renders before the
  // beat ends, and the beat mounts it.
  const auto &eventEmitter = static_cast<const expo::ExpoViewEventEmitter &>(*_eventEmitter);
  return eventEmitter.experimental_dispatchSyncNow([&]() {
    eventEmitter.dispatch(EventNameWithoutOn(eventName).UTF8String, [payload](facebook::jsi::Runtime &runtime) {
      return facebook::jsi::Value(runtime, expo::convertObjCObjectToJSIValue(runtime, payload));
    });
  });
}

@end
