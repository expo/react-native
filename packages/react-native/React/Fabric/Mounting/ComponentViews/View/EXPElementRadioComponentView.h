/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>

#import <React/EXPElementControlComponentView.h>

NS_ASSUME_NONNULL_BEGIN

/*
 * The component view for `<input type="radio">`. UIKit supplies no radio
 * control, so this draws the one Safari draws on this platform — see
 * `ElementRadioShadowNode.h` for why that is the right answer here.
 */
@interface EXPElementRadioComponentView : EXPElementControlComponentView

@end

NS_ASSUME_NONNULL_END
