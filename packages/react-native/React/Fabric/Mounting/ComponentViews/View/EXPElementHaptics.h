/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * The feedback a control gives when it opens something: a
 * `UISelectionFeedbackGenerator` kept warm with a prepare/fire cycle, as the
 * platform's own menu buttons use. A long press needs none of this, since
 * `UIContextMenuInteraction` plays its own haptic when the menu commits.
 */
@interface EXPElementHaptics : NSObject

/** Warms the generator up so the first fire is not late; cheap to call often */
+ (void)prepareSelection;

/** A control opened a menu, a panel, or anything else that replaces the view */
+ (void)selectionChanged;

@end

NS_ASSUME_NONNULL_END
