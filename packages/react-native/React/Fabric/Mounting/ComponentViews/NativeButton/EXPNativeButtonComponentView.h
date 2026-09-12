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
 * The view behind `<native:button>`: a real `UIButton` whose action is a
 * `UIMenu`, or a press for the app to answer when it has no commands.
 *
 * Nothing here is reproduced. The glass is an interactive `UIGlassEffect`
 * view hosting the plain button on iOS 26 (a glass configuration before that),
 * the press is the button's own tracking, and the menu is presented,
 * positioned and composited by UIKit — which is the only way anything can lie
 * over the keyboard, because the keys are drawn by another process and a
 * system menu is in a window the app does not own.
 *
 * It exists as the control group for the composer's `+`, and stands on its own
 * as the element an app should reach for when a button's whole action is to
 * offer a list of commands.
 */
@interface EXPNativeButtonComponentView : RCTViewComponentView
@end

NS_ASSUME_NONNULL_END
