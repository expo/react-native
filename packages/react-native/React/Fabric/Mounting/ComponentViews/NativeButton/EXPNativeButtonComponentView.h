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
 * The view behind `<native:button>`: a `UIButton` whose action is a `UIMenu`,
 * or a press for the app to answer when it has no commands. The glass is an
 * interactive `UIGlassEffect` view hosting the button on iOS 26, the press is
 * the button's own tracking, and the menu is UIKit's, presented in a window the
 * app does not own, which is the only way anything can lie over the keyboard.
 */
@interface EXPNativeButtonComponentView : RCTViewComponentView
@end

NS_ASSUME_NONNULL_END
