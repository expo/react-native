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
 * The view behind `<native:toplayer>`, HTML's top layer: a hidden handle where
 * React renders the element, whose children are mounted into an overlay on the
 * window instead, above every other view, at the handle's place in the window.
 * The overlay takes no touch that lands outside its children; a touch that
 * begins there is reported as `onOutsidePress`.
 */
@interface EXPTopLayerComponentView : RCTViewComponentView
@end

NS_ASSUME_NONNULL_END
