/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPKeyboardTrace.h"

#import <QuartzCore/QuartzCore.h>
#import <os/log.h>

/*
 * Enough for roughly twenty seconds of display-link frames, which is longer than
 * any single interaction being diagnosed and short enough to paste into a
 * message. Oldest lines fall off the front.
 */
static const NSUInteger EXPKeyboardTraceCapacity = 1200;
/*
 * A second, small buffer the per-frame flood cannot evict. A keyboard rise
 * writes tens of geometry lines a frame, so the ring holds only the last few
 * seconds — and the lines that explain a fault seen minutes ago (a material's
 * state change, a window handover) were always gone by the time anyone
 * double-tapped. Rare-by-construction lines go here and survive to the dump.
 */
static const NSUInteger EXPKeyboardTracePinnedCapacity = 120;
static NSMutableArray<NSString *> *pinned;
/** The last line recorded under each key; see `recordChanged:`. */
static NSMutableDictionary<NSString *, NSString *> *lastByKey;

@implementation EXPKeyboardTrace {
}

static NSMutableArray<NSString *> *lines = nil;
static CFTimeInterval startedAt = 0;

/*
 * Also to the system log, when asked for by name.
 *
 * The pasteboard is the right transport from someone else's phone, but it needs
 * a two-finger double-tap and there is no way to send one to a simulator — so
 * diagnosing here meant rebuilding to add a print, every time. With
 * `EXP_KEYBOARD_TRACE_ECHO=1` in the scheme (or `simctl launch`'s environment)
 * the same lines stream out of `log stream --predicate 'subsystem == "dev.expo.keyboard"'`
 * and the buffer can be read continuously without touching the device at all.
 */
static BOOL echoToLog = NO;
static os_log_t echoLog = NULL;

+ (void)start
{
  lastByKey = [NSMutableDictionary new];
  lines = [NSMutableArray arrayWithCapacity:EXPKeyboardTraceCapacity];
  pinned = nil;
  startedAt = CACurrentMediaTime();
  echoToLog = [NSProcessInfo.processInfo.environment[@"EXP_KEYBOARD_TRACE_ECHO"] boolValue];
  if (echoToLog && echoLog == NULL) {
    echoLog = os_log_create("dev.expo.keyboard", "trace");
  }
}

+ (void)stop
{
  lines = nil;
  pinned = nil;
}

+ (BOOL)isRecording
{
  return lines != nil;
}

+ (void)record:(NSString *)format, ...
{
  if (lines == nil) {
    return;
  }
  va_list args;
  va_start(args, format);
  NSString *body = [[NSString alloc] initWithFormat:format arguments:args];
  va_end(args);

  // Milliseconds since the start: the absolute time is meaningless, the spacing
  // between lines is the whole point.
  [lines addObject:[NSString stringWithFormat:@"%6.0f %@", (CACurrentMediaTime() - startedAt) * 1000.0, body]];
  if (echoToLog) {
    // Info level: streamed to a listener and kept in memory only, never written
    // to the device's log store. Debug would not be emitted at all by default.
    os_log_info(echoLog, "%{public}s", body.UTF8String);
  }
  if (lines.count > EXPKeyboardTraceCapacity) {
    [lines removeObjectsInRange:NSMakeRange(0, lines.count - EXPKeyboardTraceCapacity)];
  }
}

+ (void)recordPinned:(NSString *)format, ...
{
  if (lines == nil) {
    return;
  }
  va_list args;
  va_start(args, format);
  NSString *body = [[NSString alloc] initWithFormat:format arguments:args];
  va_end(args);
  if (pinned == nil) {
    pinned = [NSMutableArray arrayWithCapacity:EXPKeyboardTracePinnedCapacity];
  }
  [pinned addObject:[NSString stringWithFormat:@"%6.0f %@", (CACurrentMediaTime() - startedAt) * 1000.0, body]];
  if (echoToLog) {
    // Info level: streamed to a listener and kept in memory only, never written
    // to the device's log store. Debug would not be emitted at all by default.
    os_log_info(echoLog, "%{public}s", body.UTF8String);
  }
  if (pinned.count > EXPKeyboardTracePinnedCapacity) {
    [pinned removeObjectsInRange:NSMakeRange(0, pinned.count - EXPKeyboardTracePinnedCapacity)];
  }
}

+ (void)recordChanged:(NSString *)key pinned:(BOOL)pinned format:(NSString *)format, ...
{
  if (lines == nil) {
    return;
  }
  va_list args;
  va_start(args, format);
  NSString *body = [[NSString alloc] initWithFormat:format arguments:args];
  va_end(args);
  if ([lastByKey[key] isEqualToString:body]) {
    return;
  }
  lastByKey[key] = body;
  if (pinned) {
    [self recordPinned:@"%@", body];
  } else {
    [self record:@"%@", body];
  }
}

+ (NSString *)callers
{
  NSArray<NSString *> *stack = [NSThread callStackSymbols];
  NSMutableString *who = [NSMutableString string];
  NSString *ours = NSProcessInfo.processInfo.processName;
  BOOL sawOurs = NO;
  // From 2: this method and the one asking are not the answer.
  for (NSUInteger i = 2; i < MIN((NSUInteger)60, stack.count); i++) {
    NSString *frame = stack[i];
    const BOOL isOurs = [frame containsString:ours];
    if (isOurs || !sawOurs) {
      [who appendFormat:@"%@ | ", frame];
    }
    sawOurs = sawOurs || isOurs;
  }
  return who;
}

+ (double)nowMs
{
  return (CACurrentMediaTime() - startedAt) * 1000.0;
}

+ (NSString *)dump
{
  if (lines == nil) {
    return @"(not recording)";
  }
  if (pinned.count == 0) {
    return [lines componentsJoinedByString:@"\n"];
  }
  // The pinned lines first: they are the rare state changes a flood of
  // per-frame geometry must not evict — see `-recordPinned:`.
  return [NSString stringWithFormat:@"%@\n---\n%@",
                                    [pinned componentsJoinedByString:@"\n"],
                                    [lines componentsJoinedByString:@"\n"]];
}

@end
