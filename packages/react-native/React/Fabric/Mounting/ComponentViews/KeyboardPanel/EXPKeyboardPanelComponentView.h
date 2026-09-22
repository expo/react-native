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
 * The view behind `<native:keyboardpanel>`: a panel that replaces the keyboard
 * through `UIResponder.inputView`, so the system owns the animation, the
 * height, the safe area and the dismissal. Draws nothing itself; its children
 * are mounted into a separate view given to the field being typed into.
 */
@interface EXPKeyboardPanelComponentView : RCTViewComponentView
@end

NS_ASSUME_NONNULL_END
