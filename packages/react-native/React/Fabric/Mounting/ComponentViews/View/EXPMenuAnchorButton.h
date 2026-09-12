/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * The invisible button a menu is presented from, with UIKit's platter removed.
 *
 * Two elements need this and it belongs to neither: `<button>` with a `<menu>`
 * child, and `<native:menubutton>`. Both present their menu from an anchor
 * rather than from the real button wherever the lift would not be visible — see
 * `_installMenuSource` in either — and both then have the same problem with what
 * UIKit draws for that anchor.
 *
 * Presenting a menu draws a PREVIEW of its source behind the menu's attachment
 * point: a rounded platter filled with `systemBackgroundColor`, which replaces
 * whatever the source view's own background was. For a real button that platter
 * IS the button, and the effect is the menu growing out of it. For an anchor
 * with nothing in it, it is a pale empty chip — seen as a nub under the menu for
 * the length of the animation.
 *
 * The override supplies a preview with an empty visible path and a clear
 * background, which is the same presentation with nothing drawn for it.
 * Returning nil is NOT the same thing: nil means "use the default", and the
 * default is the platter.
 */
@interface EXPMenuAnchorButton : UIButton
@end

NS_ASSUME_NONNULL_END
