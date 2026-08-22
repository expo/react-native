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
 * The component view for `<select>`, backed by a `UIButton` presenting a real
 * `UIMenu` — the pop-up button UIKit uses for choosing one of a short list.
 */
@interface EXPElementSelectComponentView : EXPElementControlComponentView

@end

NS_ASSUME_NONNULL_END
