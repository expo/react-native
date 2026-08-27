/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * Holds a context menu's glass down while the menu collapses.
 *
 * A menu's material does not fade with the menu. The panel shrinks while the
 * material keeps full strength, so it drags a lens across the text behind it.
 *
 * Call from `-contextMenuInteraction:willEndForConfiguration:animator:`. The
 * materials are put back when the dismissal ends, and also if UIKit never says
 * that it has.
 */
void EXPHoldContextMenuGlassDown(UIWindow *_Nullable window, id<UIContextMenuInteractionAnimating> _Nullable animator);

NS_ASSUME_NONNULL_END
