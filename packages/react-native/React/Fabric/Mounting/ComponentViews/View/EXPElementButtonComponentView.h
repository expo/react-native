/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <React/RCTViewComponentView.h>
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/*
 * The view backing `<button>` and the other pressable elements.
 *
 * Its press behavior comes from a real `UIGestureRecognizer` rather than the
 * JavaScript responder system, so arbitration happens in UIKit's arena: an
 * enclosing scroll view claiming the gesture cancels the press directly, with
 * no round trip through JS. Gated on `enableNativeGestureRecognizers`.
 */
@interface EXPElementButtonComponentView : RCTViewComponentView
@end

NS_ASSUME_NONNULL_END
