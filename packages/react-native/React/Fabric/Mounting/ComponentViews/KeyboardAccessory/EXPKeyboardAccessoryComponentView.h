/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>

#import <React/RCTViewComponentView.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * The view behind `<native:keyboardaccessory>`.
 *
 * It draws nothing itself. Its children are mounted into a separate view, the bar, which is a
 * subview of the SCREEN's view: its bottom on the screen's `keyboardLayoutGuide` while a field inside
 * it has the keyboard, and on the screen's bottom edge otherwise, the home indicator's strip
 * reserved inside its own height. UIKit moves the guide with the keyboard and freezes it for a
 * navigation transition, so
 * the bar docks to the keys, travels with its screen's card, and is never re-hosted. A screen popped with the
 * keyboard up keeps its field, which UIKit slides with the card and restores if the pop is
 * cancelled; a screen covered by a push lets its field go. This is how the native chat hosts
 * its entry view.
 *
 * It is not an input accessory. Measured on a phone with a plain-UIKit probe: UIKit hides every
 * input accessory for the length of an interactive pop while sliding only the keys with the card.
 * The reach an accessory gave — a transcript drag that begins dismissing the keyboard when it
 * reaches the composer rather than the keys — comes from the guide's `keyboardDismissPadding`,
 * set to the bar's height.
 */
@interface EXPKeyboardAccessoryComponentView : RCTViewComponentView

/**
 * Whether a field in this bar will take the keyboard as the bar enters the
 * window. The screen being covered by this bar's screen asks, to hand the
 * keyboard over instead of dismissing it.
 */
- (BOOL)asksForKeyboardOnArrival;

@end

NS_ASSUME_NONNULL_END
