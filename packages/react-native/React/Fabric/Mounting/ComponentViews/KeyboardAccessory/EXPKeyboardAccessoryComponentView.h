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
 * The view behind `<native:keyboardaccessory>`. It draws nothing itself; its
 * children are mounted into the bar, a subview of the screen's view with its
 * bottom on the screen's `keyboardLayoutGuide` while a field inside it has the
 * keyboard and on the screen's bottom edge otherwise, the home indicator's strip
 * reserved inside its own height. The bar travels with its screen's card and is
 * never re-hosted, as the platform's chat hosts its entry view.
 *
 * Not an input accessory, which UIKit hides for the length of an interactive
 * pop; the reach an accessory gives comes from the guide's
 * `keyboardDismissPadding`, set to the bar's height.
 */
@interface EXPKeyboardAccessoryComponentView : RCTViewComponentView

// Whether a field in this bar will take the keyboard as the bar enters the
// window; the screen being covered asks, to hand the keyboard over instead of
// dismissing it
- (BOOL)asksForKeyboardOnArrival;

// Holds the bar where it is drawn while a picture of the keys stands in for
// them, so its field can resign without the bar dropping to the screen's edge;
// the anchor, the reserve and the dock event are frozen while held
@property (nonatomic, assign) BOOL holdsItsPlace;

// The bar whose content `view` is inside, if any
+ (nullable EXPKeyboardAccessoryComponentView *)barHosting:(UIView *)view;

@end

NS_ASSUME_NONNULL_END
