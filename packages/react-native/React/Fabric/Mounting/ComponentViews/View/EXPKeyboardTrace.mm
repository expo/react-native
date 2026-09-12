/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPKeyboardTrace.h"

#import <QuartzCore/QuartzCore.h>
#import <UIKit/UIKit.h>
#import <os/log.h>

/*
 * Enough for roughly twenty seconds of display-link frames, which is longer than
 * any single interaction being diagnosed and short enough to paste into a
 * message. Oldest lines fall off the front.
 */
static const NSUInteger EXPKeyboardTraceCapacity = 1200;
static NSString *const EXPKeyboardTraceBarOffScreen = @"bar OFF SCREEN";
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

/*
 * The main run loop's own turns, timed.
 *
 * A device dump showed the rise's first frames arriving thirty to fifty
 * milliseconds apart on every send, with no transaction in the gap — no line
 * of any kind. The trace could only say that the main thread had gone quiet,
 * not for how long or where the quiet began and ended. So the loop is watched
 * from the outside: one line for any turn longer than a frame, written as the
 * turn ends, so that the lines before it are what the turn contained.
 */
static CFRunLoopObserverRef turnObserver = NULL;
static CFTimeInterval turnBegan = 0;

static void EXPKeyboardTraceObserveTurn(CFRunLoopObserverRef, CFRunLoopActivity activity, void *)
{
  if (activity == kCFRunLoopAfterWaiting) {
    turnBegan = CACurrentMediaTime();
    return;
  }
  if (activity == kCFRunLoopBeforeWaiting && turnBegan > 0) {
    const double ms = (CACurrentMediaTime() - turnBegan) * 1000.0;
    turnBegan = 0;
    /*
     * A FRAME, and the screen says how long one is.
     *
     * This was 16.0, which is a frame at 60 Hz and two at 120 — so on the
     * phone this trace exists to diagnose, every turn between 8.3 and 16
     * milliseconds WAS a dropped frame and this instrument said nothing about
     * it. Reported as "I still feel there's a frame drop sometimes" against a
     * trace whose only long turn was an unrelated 113. The app opts into
     * ProMotion (`CADisableMinimumFrameDurationOnPhone`) and the links that
     * matter ask for the screen's maximum, so the budget really is 8.3 there.
     *
     * Read once, from the main screen: a trace is started long after the
     * windows are, and a screen does not change its refresh rate under an app.
     */
    static const double frameMs = [] {
      const NSInteger rate = UIScreen.mainScreen.maximumFramesPerSecond;
      return rate > 0 ? 1000.0 / (double)rate : 16.0;
    }();
    if (ms > frameMs) {
      [EXPKeyboardTrace record:@"main loop turn %.1fms", ms];
    }
  }
}

+ (void)start
{
  lastByKey = [NSMutableDictionary new];
  lines = [NSMutableArray arrayWithCapacity:EXPKeyboardTraceCapacity];
  pinned = nil;
  startedAt = CACurrentMediaTime();
  echoToLog = [NSProcessInfo.processInfo.environment[@"EXP_KEYBOARD_TRACE_ECHO"] boolValue];
  /*
   * Which case this app was launched for, when a suite launched it.
   *
   * A trace is read against the run that made it, and a gate's two lanes launch
   * the app thirty-odd times each: a line that fails an invariant could be
   * attributed to a case only by counting launches and indexing into the
   * lane's list, which is as fragile as it sounds. The runner knows the name;
   * it passes it in, and the trace says it.
   */
  NSString *caseName = NSProcessInfo.processInfo.environment[@"EXP_CASE"];
  if (echoToLog && echoLog == NULL) {
    echoLog = os_log_create("dev.expo.keyboard", "trace");
  }
  if (caseName.length > 0) {
    [EXPKeyboardTrace record:@"case %@", caseName];
  }
  if (turnObserver == NULL) {
    turnObserver = CFRunLoopObserverCreate(
        kCFAllocatorDefault, kCFRunLoopAfterWaiting | kCFRunLoopBeforeWaiting, true, 0, EXPKeyboardTraceObserveTurn, NULL);
    CFRunLoopAddObserver(CFRunLoopGetMain(), turnObserver, kCFRunLoopCommonModes);
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

static BOOL gAttributing = NO;
static double gAttributedMs = 0.0;
static NSUInteger gAttributedPasses = 0;
static NSMutableDictionary<NSString *, NSNumber *> *gAttributedDetail = nil;

+ (void)beginAttributing
{
  gAttributing = YES;
  gAttributedMs = 0.0;
  gAttributedPasses = 0;
}

+ (void)endAttributing:(double *)millis passes:(NSUInteger *)passes detail:(NSString **)detail
{
  gAttributing = NO;
  if (millis != NULL) {
    *millis = gAttributedMs;
  }
  if (passes != NULL) {
    *passes = gAttributedPasses;
  }
  if (detail != NULL) {
    NSMutableArray<NSString *> *parts = [NSMutableArray array];
    // Loudest first: the point is to name the expensive one, not to list all.
    NSArray<NSString *> *keys = [gAttributedDetail keysSortedByValueUsingComparator:^(NSNumber *a, NSNumber *b) {
      return [b compare:a];
    }];
    for (NSString *k in keys) {
      [parts addObject:[NSString stringWithFormat:@"%@=%.1f", k, [gAttributedDetail[k] doubleValue]]];
    }
    *detail = parts.count > 0 ? [parts componentsJoinedByString:@" "] : @"nothing of ours";
  }
  gAttributedDetail = nil;
}

+ (void)attributeWork:(const char *)name millis:(double)millis
{
  if (!gAttributing) {
    return;
  }
  gAttributedMs += millis;
  gAttributedPasses++;
  if (gAttributedDetail == nil) {
    gAttributedDetail = [NSMutableDictionary dictionary];
  }
  // Trim `-[Class method]` out of __PRETTY_FUNCTION__ so the line stays legible.
  NSString *key = [NSString stringWithUTF8String:name ?: "?"];
  const NSRange open = [key rangeOfString:@"["];
  if (open.location != NSNotFound) {
    key = [key substringFromIndex:open.location];
  }
  gAttributedDetail[key] = @([gAttributedDetail[key] doubleValue] + millis);
}

+ (double)nowMs
{
  return (CACurrentMediaTime() - startedAt) * 1000.0;
}

+ (NSString *)barOffScreenMarker
{
  return EXPKeyboardTraceBarOffScreen;
}

+ (NSString *)dump
{
  if (lines == nil) {
    return @"(not recording)";
  }
  /*
   * WHICH BUILD, first. A dump that does not say has been read against the
   * wrong source more than once — a fix reported "still there" on a build from
   * before it. Stamped at build time; see `Stamp the build into Info.plist`.
   */
  NSDictionary *info = NSBundle.mainBundle.infoDictionary;
  NSString *header = [NSString stringWithFormat:@"build %@ %@",
                                                info[@"EXPBuildCommit"] ?: @"?",
                                                info[@"EXPBuildStamp"] ?: @"?"];
  if (pinned.count == 0) {
    return [NSString stringWithFormat:@"%@\n%@", header, [lines componentsJoinedByString:@"\n"]];
  }
  // The pinned lines first: they are the rare state changes a flood of
  // per-frame geometry must not evict — see `-recordPinned:`.
  return [NSString stringWithFormat:@"%@\n%@\n---\n%@",
                                    header,
                                    [pinned componentsJoinedByString:@"\n"],
                                    [lines componentsJoinedByString:@"\n"]];
}

@end

EXPWorkAttribution::EXPWorkAttribution(const char *name) : name(name), began(CACurrentMediaTime()) {}

EXPWorkAttribution::~EXPWorkAttribution()
{
  [EXPKeyboardTrace attributeWork:name millis:(CACurrentMediaTime() - began) * 1000.0];
}
