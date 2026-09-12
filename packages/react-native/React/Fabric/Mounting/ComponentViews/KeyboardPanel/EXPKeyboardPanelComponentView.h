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
 * The view behind `<native:keyboardpanel>`: a panel that REPLACES the keyboard.
 *
 * The native chat's `+` opens one — the keys go away, a panel takes their
 * place, and the composer stays put. UIKit's primitive for that is
 * `UIResponder.inputView`, and using it hands the system the animation, the
 * height, the safe area and the dismissal. A panel drawn OVER the keyboard
 * would have to imitate all four, and imitating them is what makes a panel feel
 * bolted on rather than part of the keyboard's own machinery.
 *
 * Draws nothing itself. Its children are mounted into a separate view that is
 * given to whichever field is being typed into, the same way
 * `EXPKeyboardAccessoryComponentView` lends its bar.
 */
@interface EXPKeyboardPanelComponentView : RCTViewComponentView

/**
 * What the currently-open panel wants shown in place of the keys, or nil.
 *
 * So the composer bar can answer `-inputView` with it while it is hosted as a
 * real input accessory — the native chat puts both on one responder (its chat
 * controller overrides `inputAccessoryViewController` and
 * `inputViewController`), and two competing responders is why the `+` did
 * nothing with the accessory installed.
 */
+ (nullable UIView *)openPanelInputView;
@end

NS_ASSUME_NONNULL_END
