/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <React/RCTViewComponentView.h>
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * Draws one vector path, for the `<svg>` intrinsics.
 *
 * Receives geometry already parsed, flattened and scaled by
 * `js/astryx/svg/pathData.js`, so there is no SVG knowledge on this side —
 * only "replay these moves, lines and curves".
 */
@interface AstryxVectorShapeComponentView : RCTViewComponentView
@end

NS_ASSUME_NONNULL_END
