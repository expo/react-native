/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * The invisible button a menu is presented from where the real button's lift
 * would not be visible (see `_installMenuSource` in `<button>` and
 * `<native:button>`), with UIKit's platter removed: presenting a menu draws a
 * `systemBackgroundColor` platter behind the attachment point, which for an
 * empty anchor is a pale chip. The override supplies a preview with an empty
 * visible path; nil would mean the default, which is the platter.
 */
@interface EXPMenuAnchorButton : UIButton
@end

NS_ASSUME_NONNULL_END
