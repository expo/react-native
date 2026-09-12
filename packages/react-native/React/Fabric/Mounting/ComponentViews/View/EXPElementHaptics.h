/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * The feedback a control gives when it opens something.
 *
 * A SELECTION generator, matching the platform rather than chosen: the system's
 * own composer gives its `+` a `UISelectionFeedbackGenerator`, kept around with
 * a prepare/fire cycle, and reserves `UIImpactFeedbackGenerator` for the
 * separate job of docking — so the two jobs use different families and this is
 * the one that belongs to the `+`.
 *
 * Nothing here is needed for a long press: `UIContextMenuInteraction` plays its
 * own haptic when the menu commits, which is why the platform's composer has no
 * generator for it. A hand-rolled hold has to supply one, which is a reason to
 * prefer the interaction rather than to add a second haptic beside it.
 */
@interface EXPElementHaptics : NSObject

/** Warm the generator up, so the first fire is not late. Cheap to call often. */
+ (void)prepareSelection;

/** A control opened a menu, a panel, or anything else that replaces the view. */
+ (void)selectionChanged;

@end

NS_ASSUME_NONNULL_END
