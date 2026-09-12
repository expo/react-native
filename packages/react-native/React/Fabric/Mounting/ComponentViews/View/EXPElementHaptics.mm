/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPElementHaptics.h"

@implementation EXPElementHaptics

/*
 * One generator for the process.
 *
 * A generator is a handle on the haptic engine, and making one per press is
 * what makes the first press of a session arrive late — `prepare` exists
 * precisely so the engine is already running when the moment comes. The
 * platform's own composer keeps its generator alive for the same reason.
 */
+ (UISelectionFeedbackGenerator *)_generator
{
  static UISelectionFeedbackGenerator *generator;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    generator = [UISelectionFeedbackGenerator new];
  });
  return generator;
}

+ (void)prepareSelection
{
  [[self _generator] prepare];
}

+ (void)selectionChanged
{
  [[self _generator] selectionChanged];
}

@end
