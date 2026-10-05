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
 * The component view for `<progress>` and `<meter>`, backed by a real
 * `UIProgressView` — or a `UIActivityIndicatorView` when a `<progress>` is
 * indeterminate, because that is what "running, end unknown" looks like here.
 */
@interface EXPElementProgressComponentView : EXPElementControlComponentView

@end

NS_ASSUME_NONNULL_END
