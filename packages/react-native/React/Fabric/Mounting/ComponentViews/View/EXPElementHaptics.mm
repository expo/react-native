/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPElementHaptics.h"

@implementation EXPElementHaptics

// One generator for the process: a generator made per press arrives late, and
// `prepare` exists so the engine is already running when the moment comes
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
