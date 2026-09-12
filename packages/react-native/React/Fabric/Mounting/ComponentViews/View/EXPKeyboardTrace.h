/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * A ring buffer of geometry, so a fault seen on a device can be READ.
 *
 * Everything in this area — the keyboard's frame, the reserve derived from it,
 * the scroll offset, whether an animation is in flight — moves per frame and
 * settles before anyone can look at it. On the simulator that is answered with a
 * display-link log; on someone else's phone there is nothing, and the loop
 * becomes "ship a fix, hear that it is still wrong, guess again". Three fixes
 * went out that way and the report came back unchanged each time.
 *
 * So the app records its own geometry and can hand it back. `-[UIPasteboard
 * general]` is the whole transport: copy, paste into a message, and the trace is
 * as good as one taken here.
 *
 * Off unless something asks for it, and bounded, so it cannot become a leak or a
 * cost in a build that is not being diagnosed.
 */
@interface EXPKeyboardTrace : NSObject

/** Begin recording. Idempotent; clears whatever was there. */
+ (void)start;

/** Stop, and drop the buffer. */
+ (void)stop;

+ (BOOL)isRecording;

/**
 * Append one line, tagged with a time relative to the start.
 *
 * A no-op when not recording, so call sites need no guard of their own and cost
 * a single load when the trace is off.
 */
+ (void)record:(NSString *)format, ... NS_FORMAT_FUNCTION(1, 2);

/**
 * Append one line the per-frame flood cannot evict.
 *
 * For rare-by-construction events — a material's state change, a window
 * handover — that must still be in the dump minutes and thousands of
 * geometry lines later. Same no-op-when-off contract as `record:`.
 */
+ (void)recordPinned:(NSString *)format, ... NS_FORMAT_FUNCTION(1, 2);
/**
 * Records the line only when it differs from the last one recorded under `key`,
 * so a reading taken every frame is written once per change. `pinned` keeps it
 * in the dump past the ring's capacity.
 */
+ (void)recordChanged:(NSString *)key pinned:(BOOL)pinned format:(NSString *)format, ... NS_FORMAT_FUNCTION(3, 4);
/**
 * Who called the current method: the caller's frames, our own in full and the
 * framework's only until the first of ours, for a line that asks "who did this".
 */
+ (NSString *)callers;

/**
 * Now, on THIS trace's clock, in milliseconds.
 *
 * For rebasing another timeline onto it. The transition engine keeps its own
 * ring stamped from `steady_clock` since boot; both derive from mach time, but
 * the origins differ, so the two cannot be read against each other until one is
 * expressed in the other's terms.
 */
+ (double)nowMs;

/** Everything recorded, pinned lines first, oldest first, newline separated. */
+ (NSString *)dump;

@end

NS_ASSUME_NONNULL_END
