/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "RCTViewComponentView.h"

NS_ASSUME_NONNULL_BEGIN

/*
 * The box-backed flavor of a DOM element (`element-box`): a plain view, since
 * everything that distinguishes it lives in layout, not in drawing. The
 * renderer swaps an element onto this component when its display generates a
 * box — see ElementBoxShadowNode.h.
 */
@interface EXPElementBoxComponentView : RCTViewComponentView
@end

NS_ASSUME_NONNULL_END
